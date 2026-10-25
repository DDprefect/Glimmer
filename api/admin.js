"use strict";
/* ==========================================================================
   POST /api/admin — 管理后台（社长 / 干部）
   密码校验：请求体携带密码，与服务端 ADMIN_PASSWORD 做恒定时间比对，不符 401。
   动作 action：
     list           待审核 + 已发布 + 已下架 + 报名列表
     approve        审核通过（pending → approved）
     unpublish      下架（approved → offline，数据与图片保留）
     restore        恢复上架（offline → approved）
     delete         删除作品（删数据库行，并尽力删 COS 文件）
     batch          批量操作 { ids: [...], op: "approve" | "delete" }
     update         编辑作品 { id, title, author, category, shot_date }
     submissions    只看报名列表
     mark_handled   标记报名已 / 未联系 { id, handled }
     export         导出报名 CSV
     export_photos  导出全部投稿 CSV
     backup         立即备份（导出 CSV 写入 COS _backup/ 目录并推送通知）
   ========================================================================== */

var crypto = require("crypto");
var http = require("./_lib/http");
var db = require("./_lib/supabase");
var cos = require("./_lib/cos");
var csvLib = require("./_lib/csv");
var backupLib = require("./_lib/backup");
var notifyLib = require("./_lib/notify");
var rl = require("./_lib/ratelimit");

var CATEGORIES = ["校园纪实", "校外采风", "城市与远方", "人像与视觉"];
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

var SUB_COLS = csvLib.SUB_COLS;
var PHOTO_COLS = csvLib.PHOTO_COLS;
var STATUS_TEXT = csvLib.STATUS_TEXT;
var toCsv = csvLib.toCsv;

function sendCsv(req, res, filename, csv) {
  http.applyCors(req, res);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
  res.setHeader("Cache-Control", "no-store");
  res.end("\uFEFF" + csv);
}

/* 尽力删除 COS 文件；返回成功删除数 */
async function deleteCosFiles(rows) {
  var deleted = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    var key = cos.keyFromUrl(rows[i].file_url);
    if (!key) continue;
    try {
      var signed = cos.sign("delete", key, 600);
      var del = await fetch(signed.url, { method: "DELETE" });
      if (del.ok || del.status === 204) deleted++;
    } catch (e) {
      /* 单文件失败不阻塞其余 */
    }
  }
  return deleted;
}

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  try {
    var miss = http.missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ADMIN_PASSWORD", "COS_BUCKET", "COS_REGION"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置环境变量：" + miss.join(", ") });
    }

    var body = await http.readJson(req);

    /* ---- 密码比对（恒定时间，防时序侧信道） ---- */
    /* 防暴力破解：同一 IP 连续错 5 次锁 10 分钟；验证成功即清零 */
    var failKey = rl.clientIp(req) + ":admin-fail";
    if (!rl.allow(failKey, 5, 10 * 60 * 1000)) {
      return http.json(req, res, 429, { ok: false, error: "密码错误次数过多，已锁定 10 分钟" });
    }
    var pw = Buffer.from(String(body.password || ""), "utf8");
    var want = Buffer.from(String(process.env.ADMIN_PASSWORD), "utf8");
    if (pw.length !== want.length || !crypto.timingSafeEqual(pw, want)) {
      return http.json(req, res, 401, { ok: false, error: "密码不正确" });
    }
    rl.reset(failKey);

    var action = String(body.action || "");
    var id = http.clean(body.id, 40);

    /* ---------------- list ---------------- */
    if (action === "list") {
      var pending = await db.photos.pending();
      var approved = await db.photos.approved();
      var offline = await db.photos.offline();
      var subs = await db.submissions.all();
      http.json(req, res, 200, {
        ok: true,
        pending: pending || [],
        approved: approved || [],
        offline: offline || [],
        submissions: subs || []
      });
      return;
    }

    /* ---------------- 单个状态动作 ---------------- */
    if (action === "approve" || action === "unpublish" || action === "restore") {
      if (!id) return http.json(req, res, 400, { ok: false, error: "缺少作品 id" });
      var status = action === "approve" ? "approved" : action === "unpublish" ? "offline" : "approved";
      await db.photos.setStatus(id, status);
      http.json(req, res, 200, { ok: true });
      return;
    }

    /* ---------------- 删除单个 ---------------- */
    if (action === "delete") {
      if (!id) return http.json(req, res, 400, { ok: false, error: "缺少作品 id" });
      var rows1 = await db.photos.byId(id);
      var row1 = Array.isArray(rows1) ? rows1[0] : null;
      if (!row1) return http.json(req, res, 404, { ok: false, error: "作品不存在或已删除" });
      await db.photos.remove(id);
      var cosDeleted = (await deleteCosFiles([row1])) > 0;
      http.json(req, res, 200, { ok: true, cosDeleted: cosDeleted });
      return;
    }

    /* ---------------- 批量 ---------------- */
    if (action === "batch") {
      var ids = Array.isArray(body.ids) ? body.ids.map(function (x) { return http.clean(x, 40); }).filter(Boolean) : [];
      var op = String(body.op || "");
      if (!ids.length) return http.json(req, res, 400, { ok: false, error: "没有选中的作品" });
      if (ids.length > 100) return http.json(req, res, 400, { ok: false, error: "单次最多处理 100 条" });

      if (op === "approve") {
        await db.photos.setStatusMany(ids, "approved");
        http.json(req, res, 200, { ok: true, done: ids.length });
        return;
      }
      if (op === "delete") {
        var rowsN = await db.photos.byIds(ids);
        await db.photos.removeMany(ids);
        var cosDeletedN = await deleteCosFiles(rowsN);
        http.json(req, res, 200, { ok: true, done: ids.length, cosDeleted: cosDeletedN });
        return;
      }
      http.json(req, res, 400, { ok: false, error: "未知批量操作" });
      return;
    }

    /* ---------------- 编辑作品 ---------------- */
    if (action === "update") {
      if (!id) return http.json(req, res, 400, { ok: false, error: "缺少作品 id" });
      var patch = {};
      var title = http.clean(body.title, 50);
      var author = http.clean(body.author, 30);
      var category = http.clean(body.category, 20);
      var shot_date = http.clean(body.shot_date, 10);
      if (title) patch.title = title;
      if (author !== undefined) patch.author = author;
      if (category) {
        if (CATEGORIES.indexOf(category) === -1) {
          return http.json(req, res, 400, { ok: false, error: "分类不合法（仅限四个官方分类）" });
        }
        patch.category = category;
      }
      if (shot_date && !DATE_RE.test(shot_date)) {
        return http.json(req, res, 400, { ok: false, error: "拍摄日期格式应为 YYYY-MM-DD" });
      }
      if (shot_date) patch.shot_date = shot_date;
      if (!Object.keys(patch).length) {
        return http.json(req, res, 400, { ok: false, error: "没有要修改的内容" });
      }
      await db.photos.update(id, patch);
      http.json(req, res, 200, { ok: true });
      return;
    }

    /* ---------------- 报名已联系 ---------------- */
    if (action === "mark_handled") {
      if (!id) return http.json(req, res, 400, { ok: false, error: "缺少报名 id" });
      await db.submissions.setHandled(id, !!body.handled);
      http.json(req, res, 200, { ok: true });
      return;
    }

    if (action === "submissions") {
      var all = await db.submissions.all();
      http.json(req, res, 200, { ok: true, submissions: all || [] });
      return;
    }

    /* ---------------- 导出报名 CSV ---------------- */
    if (action === "export") {
      var allRows = await db.submissions.all();
      sendCsv(req, res, "glimmer-submissions.csv", toCsv(allRows, SUB_COLS, function (v, key) {
        if (key === "handled") return v ? "已联系" : "未联系";
        return v;
      }));
      return;
    }

    /* ---------------- 导出投稿 CSV ---------------- */
    if (action === "export_photos") {
      var allPhotos = await db.photos.all();
      sendCsv(req, res, "glimmer-photos.csv", toCsv(allPhotos, PHOTO_COLS, function (v, key, row) {
        if (key === "status") return STATUS_TEXT[v] || v || "";
        if (key === "exif") return csvLib.exifText(row.exif);
        return v;
      }));
      return;
    }

    /* ---------------- 立即备份（写 COS _backup/ 目录，并推送通知） ---------------- */
    if (action === "backup") {
      var result = await backupLib.runBackup();
      await notifyLib.backupDone(result);
      http.json(req, res, 200, { ok: true, backup: result });
      return;
    }

    http.json(req, res, 400, { ok: false, error: "未知操作" });
  } catch (e) {
    if (e && e.unauthorized) {
      return http.json(req, res, 401, { ok: false, error: "密码不正确" });
    }
    /* 同 upload：错误上报自身不许再抛，保证错误信息能发回前端（v2.0.11） */
    try { await notifyLib.errorOccurred(req, "管理后台", e && e.message); } catch (e2) { /* 吞掉 */ }
    http.json(req, res, 500, { ok: false, error: e.message || "服务器错误" });
  }
};
