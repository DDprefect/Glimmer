"use strict";
/* ==========================================================================
   GET /api/backup — 月度自动备份（Vercel Cron 每月 1 日调用）
   把 photos / submissions 导出成 CSV 写入 COS 的 _backup/ 目录并推送通知。
   鉴权：配置 CRON_SECRET 后，Vercel Cron 请求会自动带上
   Authorization: Bearer <CRON_SECRET>，本接口做恒定时间校验；
   未配置时直接放行——靠「URL 不公开 + 单 IP 限流」兜底，
   备份本身是幂等操作（同月覆盖写），最坏结果只是多几条通知。
   ========================================================================== */

var crypto = require("crypto");
var http = require("./_lib/http");
var backupLib = require("./_lib/backup");
var notifyLib = require("./_lib/notify");
var rl = require("./_lib/ratelimit");

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["GET"])) return;

  try {
    var miss = http.missingEnv([
      "SUPABASE_URL", "SUPABASE_SERVICE_KEY",
      "COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION"
    ]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置环境变量：" + miss.join(", ") });
    }

    /* 可选鉴权：配了 CRON_SECRET 才校验（恒定时间比对） */
    var secret = process.env.CRON_SECRET;
    if (secret) {
      var got = Buffer.from(String(req.headers.authorization || ""), "utf8");
      var want = Buffer.from("Bearer " + secret, "utf8");
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
        return http.json(req, res, 401, { ok: false, error: "未授权" });
      }
    } else if (!rl.guard(req, "backup", 5, 10 * 60 * 1000)) {
      return http.json(req, res, 429, { ok: false, error: "备份请求太频繁，请 10 分钟后再试" });
    }

    var result = await backupLib.runBackup();
    await notifyLib.backupDone(result);
    http.json(req, res, 200, { ok: true, backup: result });
  } catch (e) {
    /* 同 upload：错误上报自身不许再抛（v2.0.11） */
    try { await notifyLib.errorOccurred(req, "月度备份", e && e.message); } catch (e2) { /* 吞掉 */ }
    http.json(req, res, 500, { ok: false, error: e.message || "备份失败" });
  }
};
