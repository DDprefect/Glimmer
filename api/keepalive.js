"use strict";
/* ==========================================================================
   GET /api/keepalive — 保活（由 Vercel Cron 每周调用一次）
   Supabase 免费项目 7 天无任何访问会被暂停，此接口用一次最廉价的查询
   保持项目活跃。公开无副作用，不返回任何业务数据。
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["GET"])) return;

  try {
    var miss = http.missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置数据库环境变量：" + miss.join(", ") });
    }
    /* 取一行最小字段，成本可忽略 */
    await db.rest("GET", "submissions?select=id&limit=1");
    http.json(req, res, 200, { ok: true, alive: true });
  } catch (e) {
    http.json(req, res, 500, { ok: false, error: e.message || "保活查询失败" });
  }
};
