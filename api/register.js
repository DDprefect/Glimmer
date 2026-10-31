"use strict";
/* ==========================================================================
   POST /api/register — 新生报名提交
   写 submissions 表（name / class / contact / interest / intro）
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");
var notifyLib = require("./_lib/notify");
var rl = require("./_lib/ratelimit");

var RL_MAX = 5;                  // 单 IP 10 分钟内最多 5 次
var RL_WINDOW = 10 * 60 * 1000;
var GLOBAL_MAX = 20;             // 全局 10 分钟报名熔断线

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  try {
    var miss = http.missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置数据库环境变量：" + miss.join(", ") });
    }

    /* 防护一：跨站表单 POST 拦截（v2.1.1 恢复上线，与 upload 同步）。
       v2.0.10 下线的真因是白名单域名拼写错误（lityzglimmer.top 未注册），
       域名已修正并经注册局验证，检查恢复；详见 api/upload.js 同位置注释。 */
    if (http.originSuspicious(req)) {
      return http.rejectOrigin(req, res);
    }

    /* 防护二：单 IP 频率限制（v2.0.12 起限流异步化，支持集中存储） */
    if (!(await rl.guard(req, "register", RL_MAX, RL_WINDOW))) {
      return http.json(req, res, 429, { ok: false, error: "提交太频繁，请 10 分钟后再试" });
    }

    /* 防护三：全局熔断 */
    var since = new Date(Date.now() - RL_WINDOW).toISOString();
    var recent = await db.rest("GET", "submissions?select=id&created_at=gte." + encodeURIComponent(since) + "&limit=50");
    if ((recent || []).length >= GLOBAL_MAX) {
      return http.json(req, res, 429, { ok: false, error: "报名通道繁忙，请稍后再试" });
    }

    var body = await http.readJson(req);
    var name = http.clean(body.name, 30);
    var cls = http.clean(body.class, 30);
    var contact = http.clean(body.contact, 60);
    var interest = http.clean(body.interest, 100);
    var intro = http.clean(body.intro, 500);

    if (!name) {
      return http.json(req, res, 400, { ok: false, error: "请填写姓名 / 昵称" });
    }
    if (!contact) {
      return http.json(req, res, 400, { ok: false, error: "请填写联系方式" });
    }

    await db.submissions.create({ name: name, class: cls, contact: contact, interest: interest, intro: intro });
    /* 推送通知（未配置 NOTIFY_URL 时静默跳过；失败不影响提交结果） */
    await notifyLib.signupSubmitted({ name: name, class: cls, contact: contact, interest: interest });
    http.json(req, res, 200, { ok: true });
  } catch (e) {
    /* 同 upload：错误上报自身不许再抛，保证 500 的错误信息能发回前端（v2.0.11） */
    try { await notifyLib.errorOccurred(req, "新生报名", e.message); } catch (e2) { /* 吞掉 */ }
    http.json(req, res, 500, { ok: false, error: e.message || "提交失败" });
  }
};
