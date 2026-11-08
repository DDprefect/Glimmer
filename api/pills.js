"use strict";
/* ==========================================================================
   GET /api/pills — 首屏胶囊配置（公开只读，v2.9.0）

   hero 区胶囊（招新 / 活动 / 自定义公告）由后台配置驱动。配置里只有
   文字、链接与开关，不含敏感信息；活动胶囊的动态内容（活动名）由前端
   另行从 /api/events 取。

   降级：配置不存在（从未保存过）→ { ok: true, config: null }，前端用
   代码内置默认（招新胶囊 + 活动胶囊），站点行为与升级前完全一致。
   ========================================================================== */

var http = require("./_lib/http");
var pillsLib = require("./_lib/pills");

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["GET"])) return;

  try {
    var cfg = await pillsLib.read();
    http.json(req, res, 200, { ok: true, config: cfg });
  } catch (e) {
    /* 读失败 → 未配置降级，hero 不能因配置抖动消失 */
    http.json(req, res, 200, { ok: true, config: null });
  }
};
