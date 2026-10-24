"use strict";
/* ==========================================================================
   POST /api/register — 新生报名提交
   写 submissions 表（name / class / contact / interest / intro）
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");
var notifyLib = require("./_lib/notify");

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  try {
    var miss = http.missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置数据库环境变量：" + miss.join(", ") });
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
    http.json(req, res, 500, { ok: false, error: e.message || "提交失败" });
  }
};
