"use strict";
/* ==========================================================================
   /api/photos — 作品列表（只读）
   GET  只返回 status=approved 的作品，按 created_at 倒序（相册懒加载用）
   说明：投稿写入统一走 /api/upload（服务端转发通道，带魔数校验/限流/
   熔断/回删）；本接口不再接受 POST——作品必须先过「待审核」这一关，
   任何直写路径都是后门，关掉。
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["GET"])) return;

  try {
    var rows = await db.photos.approved();
    http.json(req, res, 200, { ok: true, photos: rows || [] });
  } catch (e) {
    http.json(req, res, 500, { ok: false, error: e.message || "读取失败" });
  }
};
