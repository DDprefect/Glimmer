"use strict";
/* ==========================================================================
   POST /api/event-register — 活动报名提交（v2.7.0）
   写 submissions 表（带 event_id 标记），字段与招新报名完全一致：
   name / class / contact / intro（activity 无 interest，留空）。

   安全与防护与 /api/register 同款：
     ① 来源检查（v2.1.1 恢复上线的 originSuspicious）
     ② 单 IP 限流 5 次 / 10 分钟（独立场景 event-register）
     ③ 全局熔断：报名类写入（招新+活动）合计 20 条 / 10 分钟
     ④ 字段清洗与长度上限
   业务校验：
     - 活动必须存在且 status=published 才能报名（归档/草稿一律拒绝）
     - 同一联系方式对同一活动只允许报名一次（精确 + ilike 兜底）

   依赖 events 表与 event_id 列（_tools/EVENTS_SQL.sql）；未建表时明确报
   「活动系统未启用」，不静默。
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");
var notifyLib = require("./_lib/notify");
var rl = require("./_lib/ratelimit");

var RL_MAX = 5;                  // 单 IP 10 分钟内最多 5 次
var RL_WINDOW = 10 * 60 * 1000;
var GLOBAL_MAX = 20;             // 全局 10 分钟报名类写入熔断线

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  try {
    var miss = http.missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置数据库环境变量：" + miss.join(", ") });
    }

    /* 防护一：跨站表单 POST 拦截（与 register/upload 同步） */
    if (http.originSuspicious(req)) {
      return http.rejectOrigin(req, res);
    }

    /* 防护二：单 IP 频率限制 */
    if (!(await rl.guard(req, "event-register", RL_MAX, RL_WINDOW))) {
      return http.json(req, res, 429, { ok: false, error: "提交太频繁，请 10 分钟后再试" });
    }

    var body = await http.readJson(req);
    var eventId = http.clean(body.eventId, 20);
    var name = http.clean(body.name, 30);
    var cls = http.clean(body.class, 30);
    var contact = http.clean(body.contact, 60);
    var intro = http.clean(body.intro, 500);

    if (!/^\d+$/.test(eventId)) {
      return http.json(req, res, 400, { ok: false, error: "活动标识不合法" });
    }
    if (!name) return http.json(req, res, 400, { ok: false, error: "请填写姓名 / 昵称" });
    if (!contact) return http.json(req, res, 400, { ok: false, error: "请填写联系方式" });

    /* 活动必须存在且进行中 */
    var evRows = await db.events.byId(eventId);
    var ev = Array.isArray(evRows) ? evRows[0] : null;
    if (!ev) return http.json(req, res, 404, { ok: false, error: "活动不存在或已结束" });
    if (ev.status !== "published") {
      return http.json(req, res, 400, { ok: false, error: "该活动当前不接受报名" });
    }

    /* 防护三：全局熔断（报名类写入合计，跨招新与活动） */
    var since = new Date(Date.now() - RL_WINDOW).toISOString();
    var recent = await db.rest("GET", "submissions?select=id&created_at=gte." + encodeURIComponent(since) + "&limit=50");
    if ((recent || []).length >= GLOBAL_MAX) {
      return http.json(req, res, 429, { ok: false, error: "报名通道繁忙，请稍后再试" });
    }

    /* 防重复：同联系方式（规范化比较）对同一活动只报一次。
       精确未命中再用 ilike 兜底（学 register-status 的做法）。 */
    var dup = await db.rest(
      "GET",
      "submissions?select=id&event_id=eq." + encodeURIComponent(eventId) +
      "&contact=eq." + encodeURIComponent(contact) + "&limit=1"
    );
    if (!dup || !dup.length) {
      dup = await db.rest(
        "GET",
        "submissions?select=id&event_id=eq." + encodeURIComponent(eventId) +
        "&contact=ilike.*" + encodeURIComponent(contact) + "*&limit=1"
      ).catch(function () { return []; });
    }
    if (dup && dup.length) {
      return http.json(req, res, 200, { ok: true, duplicate: true, message: "这个联系方式已经报过名啦，无需重复提交。" });
    }

    await db.submissions.create({ name: name, "class": cls, contact: contact, interest: "", intro: intro, event_id: Number(eventId) });
    /* 推送通知：带活动名，方便干部分辨是活动报名还是招新报名 */
    await notifyLib.notify(
      "新活动报名 · " + (ev.title || "") + " · " + name,
      [
        "活动：" + (ev.title || "—"),
        "姓名：" + name,
        cls ? "班级：" + cls : "",
        "联系方式：" + contact,
        intro ? "留言：" + intro : "",
        "",
        "请到管理后台「活动」标签查看：https://ltyzglimmer.top/admin.html"
      ].filter(Boolean).join("\n")
    );
    http.json(req, res, 200, { ok: true, message: "报名成功！干部会尽快和你联系。" });
  } catch (e) {
    /* 活动系统未启用（表未建）：给明确指引而不是 500 堆栈 */
    if (db.events.isMissingTable(e)) {
      return http.json(req, res, 503, { ok: false, error: "活动系统未启用，请联系干部（服务端缺 events 表）" });
    }
    try { await notifyLib.errorOccurred(req, "活动报名", e.message); } catch (e2) { /* 吞掉 */ }
    http.json(req, res, 500, { ok: false, error: e.message || "提交失败" });
  }
};
