"use strict";
/* ==========================================================================
   POST /api/admin — 管理后台（社长 / 干部）
   密码校验：请求体携带密码，与服务端 ADMIN_PASSWORD 做恒定时间比对，不符 401。
   动作 action：
     list         待审核 + 已发布 + 报名列表
     approve      审核通过（status → approved）
     delete       删除作品（删数据库行，并尽力删 COS 文件）
     submissions  只看报名列表
     export       导出报名 CSV
   ========================================================================== */

var crypto = require("crypto");
var http = require("./_lib/http");
var db = require("./_lib/supabase");
var cos = require("./_lib/cos");

/* 报名 CSV 列（顺序即导出顺序） */
var SUB_COLS = [
  ["id", "ID"],
  ["name", "姓名"],
  ["class", "年级班级"],
  ["contact", "联系方式"],
  ["interest", "感兴趣方向"],
  ["intro", "想说的话"],
  ["created_at", "提交时间"]
];

function toCsv(rows) {
  function esc(v) {
    var s = v == null ? "" : String(v);
    // 字段内换行规范成 CRLF（RFC 4180），Excel 打开最稳
    s = s.replace(/\r?\n/g, "\r\n");
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  var lines = [SUB_COLS.map(function (c) { return esc(c[1]); }).join(",")];
  (rows || []).forEach(function (r) {
    lines.push(SUB_COLS.map(function (c) { return esc(r[c[0]]); }).join(","));
  });
  return lines.join("\r\n");
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
    var pw = Buffer.from(String(body.password || ""), "utf8");
    var want = Buffer.from(String(process.env.ADMIN_PASSWORD), "utf8");
    if (pw.length !== want.length || !crypto.timingSafeEqual(pw, want)) {
      return http.json(req, res, 401, { ok: false, error: "密码不正确" });
    }

    var action = String(body.action || "");
    var id = http.clean(body.id, 40);

    if (action === "list") {
      var pending = await db.photos.pending();
      var approved = await db.photos.approved();
      var subs = await db.submissions.all();
      http.json(req, res, 200, {
        ok: true,
        pending: pending || [],
        approved: approved || [],
        submissions: subs || []
      });
      return;
    }

    if (action === "approve") {
      if (!id) return http.json(req, res, 400, { ok: false, error: "缺少作品 id" });
      await db.photos.setStatus(id, "approved");
      http.json(req, res, 200, { ok: true });
      return;
    }

    if (action === "delete") {
      if (!id) return http.json(req, res, 400, { ok: false, error: "缺少作品 id" });
      var rows = await db.photos.byId(id);
      var row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return http.json(req, res, 404, { ok: false, error: "作品不存在或已删除" });
      await db.photos.remove(id);
      /* 尽力删 COS 文件；失败不阻塞数据库删除（孤儿图可事后在 COS 控制台清理） */
      var key = cos.keyFromUrl(row.file_url);
      var cosDeleted = false;
      if (key) {
        try {
          var signed = cos.sign("delete", key, 600);
          var del = await fetch(signed.url, { method: "DELETE" });
          cosDeleted = del.ok || del.status === 204;
        } catch (e) {
          cosDeleted = false;
        }
      }
      http.json(req, res, 200, { ok: true, cosDeleted: cosDeleted });
      return;
    }

    if (action === "submissions") {
      var all = await db.submissions.all();
      http.json(req, res, 200, { ok: true, submissions: all || [] });
      return;
    }

    if (action === "export") {
      var allRows = await db.submissions.all();
      http.applyCors(req, res);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="glimmer-submissions.csv"');
      res.setHeader("Cache-Control", "no-store");
      /* 带 BOM：Excel 直接双击打开不乱码 */
      res.end("\uFEFF" + toCsv(allRows));
      return;
    }

    http.json(req, res, 400, { ok: false, error: "未知操作" });
  } catch (e) {
    http.json(req, res, 500, { ok: false, error: e.message || "服务器错误" });
  }
};
