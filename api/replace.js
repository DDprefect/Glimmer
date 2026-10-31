"use strict";
/* ==========================================================================
   POST /api/replace — 干部替换作品图片（v2.2.0）
   解决「图选错了只能删掉让同学重投」：待审核/已发布/已下架的作品都可直接换图。
   请求形态：
     POST /api/replace?id=<作品id>&shot_date=YYYY-MM-DD(可选，更新拍摄日期)
     header: x-admin-pw: <管理密码>（不进 URL，避免落日志）
     body:   图片二进制（前端 canvas 压缩后提交）
   流程：验密（恒定时间 + 失败锁定，与 /api/admin 同款）→ 查作品 →
        JPG 魔数 → 覆盖公开 key → _original/ 私有原图若已存在则同步覆盖
        （保证原图与公开位始终是同一张图）→ 已发布作品自动重打水印
        （新图不带水印）→ 可选更新拍摄日期。
   注意：数据库里的 EXIF 展示参数不随换图更新（干部如需修正可后续支持）。
   ========================================================================== */

var crypto = require("crypto");
var http = require("./_lib/http");
var db = require("./_lib/supabase");
var cos = require("./_lib/cos");
var notifyLib = require("./_lib/notify");
var rl = require("./_lib/ratelimit");
var watermarkLib = require("./_lib/watermark");

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var MAX_BYTES = 4 * 1024 * 1024;
var MIN_BYTES = 2 * 1024;

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  try {
    var miss = http.missingEnv([
      "SUPABASE_URL", "SUPABASE_SERVICE_KEY",
      "COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION",
      "ADMIN_PASSWORD"
    ]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置环境变量：" + miss.join(", ") });
    }

    if (!(await rl.guard(req, "replace", 10, 10 * 60 * 1000))) {
      return http.json(req, res, 429, { ok: false, error: "操作太频繁，请 10 分钟后再试" });
    }

    var u = new URL(req.url, "http://localhost");
    var id = http.clean(u.searchParams.get("id"), 40);
    if (!id) return http.json(req, res, 400, { ok: false, error: "缺少作品 id" });

    /* 密码校验（与 /api/admin 同款：恒定时间比对 + 连错 5 次锁 10 分钟） */
    var failKey = rl.clientIp(req) + ":admin-fail";
    if (!(await rl.allow(failKey, 5, 10 * 60 * 1000))) {
      return http.json(req, res, 429, { ok: false, error: "密码错误次数过多，已锁定 10 分钟" });
    }
    var pw = Buffer.from(String(req.headers["x-admin-pw"] || ""), "utf8");
    var want = Buffer.from(String(process.env.ADMIN_PASSWORD), "utf8");
    if (pw.length !== want.length || !crypto.timingSafeEqual(pw, want)) {
      return http.json(req, res, 401, { ok: false, error: "密码不正确" });
    }
    await rl.reset(failKey);

    var rows = await db.photos.byId(id);
    var row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return http.json(req, res, 404, { ok: false, error: "作品不存在或已删除" });
    var key = cos.keyFromUrl(row.file_url);
    if (!key) return http.json(req, res, 400, { ok: false, error: "图片地址不属于本站存储桶，无法替换" });

    var buf = await http.readRaw(req, MAX_BYTES);
    if (buf.length < MIN_BYTES || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return http.json(req, res, 400, { ok: false, error: "只能上传 JPG 图片" });
    }

    /* 覆盖公开位 */
    var s1 = cos.sign("put", key, 600);
    var put1 = await fetch(s1.url, { method: "PUT", body: buf, headers: { "Content-Type": "image/jpeg" } });
    if (!put1.ok) throw new Error("图片写入存储失败（HTTP " + put1.status + "）");

    /* 私有原图副本若存在则同步覆盖——换图之后原图也必须是新图，否则
       重打水印会拿旧图当源。不存在（如待审核作品）则跳过 */
    var originalSynced = false;
    var oKey = watermarkLib.originalKeyOf(key);
    try {
      if (await cos.objectExists(oKey)) {
        var s2 = cos.sign("put", oKey, 600);
        var put2 = await fetch(s2.url, { method: "PUT", body: buf, headers: { "Content-Type": "image/jpeg" } });
        originalSynced = put2.ok;
      }
    } catch (e2) {
      /* 同步失败不阻塞：公开位已换新，但此时不宜重打水印（会拿旧图当源） */
      originalSynced = false;
    }

    /* 可选：更新拍摄日期 */
    var patch = {};
    var shot = http.clean(u.searchParams.get("shot_date"), 10);
    if (shot) {
      if (!DATE_RE.test(shot)) {
        return http.json(req, res, 400, { ok: false, error: "拍摄日期格式应为 YYYY-MM-DD" });
      }
      patch.shot_date = shot;
    }
    if (Object.keys(patch).length) await db.photos.update(id, patch);

    /* 已发布作品：新图不带水印，自动重打（拿刚同步的 _original/ 为源）；
       同步失败时跳过重打并告知——此时公开位是新原图，干部可稍后点「打水印」 */
    var wmError = null;
    var watermarked = false;
    if (row.status === "approved") {
      if (originalSynced) {
        try {
          await watermarkLib.applyWatermark(key);
          watermarked = true;
        } catch (e3) {
          wmError = e3.message;
        }
      } else {
        wmError = "私有原图同步失败，为避免水印打在旧图上已跳过；请稍后手动点「打水印」";
      }
    }

    http.json(req, res, 200, {
      ok: true,
      originalSynced: originalSynced,
      watermarked: watermarked,
      wmError: wmError
    });
  } catch (e) {
    try { await notifyLib.errorOccurred(req, "替换作品图片", e.message); } catch (e2) { /* 吞掉 */ }
    http.json(req, res, 500, { ok: false, error: e.message || "替换失败" });
  }
};
