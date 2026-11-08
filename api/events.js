"use strict";
/* ==========================================================================
   /api/events — 活动公开只读接口
   GET               活动列表（published 进行中 + archived 往期；draft 永不外泄）
   GET ?id=N         活动详情：完整内容 + 该活动已审核作品相册 + 报名状态

   降级原则：events 表未建（还没跑 EVENTS_SQL.sql）→ 返回空列表 / 明确
   ok:false，前台区块整体隐藏，站点其余功能零影响。
   安全：本接口只读，写操作全部走 /api/admin（单密码）；draft 只出现在
   admin list，绝不经此接口外泄。
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");

var LIST_FIELDS = "id,title,content,activity_date,status,created_at,updated_at";

function summarize(list) {
  return (list || []).map(function (e) {
    /* 列表只给摘要（正文截断），完整内容走详情接口 */
    var head = String(e.content || "").slice(0, 120);
    return {
      id: e.id,
      title: e.title,
      activity_date: e.activity_date || "",
      status: e.status,
      excerpt: head,
      created_at: e.created_at
    };
  });
}

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["GET"])) return;

  var id = http.clean(new URL(req.url, "http://x").searchParams.get("id") || "", 20);

  try {
    /* 详情 */
    if (id) {
      var rows = await db.events.byId(id);
      var ev = Array.isArray(rows) ? rows[0] : null;
      if (!ev) return http.json(req, res, 404, { ok: false, error: "活动不存在或已删除" });
      /* draft 未发布：只允许后台（带密码）看，公开详情一律 404 */
      if (ev.status === "draft") return http.json(req, res, 404, { ok: false, error: "活动不存在或已删除" });
      var works = await db.photos.byEvent(id).catch(function () { return []; });
      /* v2.8.0：报名汇总——参与人数任何人可见；名单（仅姓名+班级，绝不
         含联系方式/留言）只在活动归档后公开，进行中不公开报名名单。 */
      var regs = { count: 0, names: [] };
      try {
        var regRows = await db.submissions.byEvent(id);
        regs.count = (regRows || []).length;
        if (ev.status === "archived") {
          regs.names = (regRows || []).map(function (r) {
            return { name: String(r.name || "").slice(0, 30), "class": String(r["class"] || "").slice(0, 30) };
          });
        }
      } catch (eRegs) { /* 报名汇总失败不影响作品展示 */ }
      return http.json(req, res, 200, {
        ok: true,
        event: {
          id: ev.id,
          title: ev.title,
          content: ev.content || "",
          activity_date: ev.activity_date || "",
          status: ev.status,
          created_at: ev.created_at
        },
        works: works || [],
        regs: regs
      });
    }

    /* 列表 */
    var list = await db.events.list();
    var all = summarize(list);
    http.json(req, res, 200, {
      ok: true,
      current: all.filter(function (e) { return e.status === "published"; }),
      past: all.filter(function (e) { return e.status === "archived"; })
    });
  } catch (e) {
    if (db.events.isMissingTable(e)) {
      return http.json(req, res, 200, { ok: true, current: [], past: [], disabled: true });
    }
    /* 其它错误也按空降级：活动区块不能拖垮首页 */
    http.json(req, res, 200, { ok: true, current: [], past: [], error: e.message || "读取失败" });
  }
};
