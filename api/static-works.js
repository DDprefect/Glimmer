"use strict";
/* ==========================================================================
   GET /api/static-works — 静态老作品的「不展示清单」（公开只读）

   为什么需要它：静态 78 张老作品在 works.js 里，Vercel 运行时只读，后台
   无法物理删文件；干部在后台把某张移入回收站 / 永久移除后，id 记在 COS
   私有语义对象 _config/hidden-works.json。首页与作品集读取本接口后从列表
   中过滤，效果等同于「删掉了」。清单只有作品 id，不含任何隐私信息。

   同源接口也顺带解决 CSP：connect-src 'self'，前端不能直连 COS 域名。

   降级：清单读取失败一律返回空清单（宁可多显示，也不能因配置抖动让整站
   作品消失），并把失败写进 ok=false 让前端可以决定是否重试。
   ========================================================================== */

var http = require("./_lib/http");
var staticworks = require("./_lib/staticworks");

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["GET"])) return;

  try {
    var list = await staticworks.read();
    http.json(req, res, 200, {
      ok: true,
      hidden: list.hidden,
      purged: list.purged,
      excluded: list.hidden.concat(list.purged)
    });
  } catch (e) {
    /* 读失败 → 空清单降级；前台照常显示全部静态作品 */
    http.json(req, res, 200, { ok: false, hidden: [], purged: [], excluded: [], error: e.message || "清单读取失败" });
  }
};
