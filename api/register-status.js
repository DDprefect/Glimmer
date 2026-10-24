"use strict";
/* ==========================================================================
   POST /api/register-status — 报名人自查「有没有人联系我」
   入参：{ name, contact }（报名时填的姓名与联系方式，双因子）
   出参：{ ok, found, status, at }

   设计要点：
   - 只回状态，不回任何联系方式、留言内容等个人信息——和 photo-status 一个口径，
     查询接口一律「能查到就查到，查得到也只给最少的信息」。
   - 姓名 + 联系方式双因子：单靠姓名能撞名，单靠联系方式又不便记忆，两者一起
     足够挡住随手试探，又不需要额外设密码。
   - 先精确匹配；匹配不上再按联系方式做一次包含匹配（同学记不清自己当时填的是
     「QQ 12345」还是「12345」时，别让他白查一趟）。
   - handled 列尚未创建时（旧库）自动降级：不判断「已联系」，只说「已收到」。
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");
var rl = require("./_lib/ratelimit");

function pick(rows) {
  return (rows && rows.length) ? rows[0] : null;
}

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  if (!rl.guard(req, "regstatus", 10, 10 * 60 * 1000)) {
    return http.json(req, res, 429, { ok: false, error: "查询太频繁，请稍后再试" });
  }

  try {
    var miss = http.missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置数据库环境变量：" + miss.join(", ") });
    }

    var body = await http.readJson(req);
    var name = http.clean(body.name, 30);
    var contact = http.clean(body.contact, 40);
    if (!name || !contact) {
      return http.json(req, res, 400, { ok: false, error: "请填写姓名与联系方式" });
    }

    var where = "name=eq." + encodeURIComponent(name);
    var enc = encodeURIComponent(contact);
    var order = "&order=created_at.desc&limit=1";

    var row = null;
    try {
      row = pick(await db.rest(
        "GET",
        "submissions?select=created_at,handled&" + where + "&contact=eq." + enc + order
      ));
      // 精确没中：按联系方式包含匹配再试一次（前提同样是姓名精确）
      if (!row && contact.length >= 4) {
        row = pick(await db.rest(
          "GET",
          "submissions?select=created_at,handled&" + where +
            "&contact=ilike.*" + enc + "*" + order
        ));
      }
      http.json(req, res, 200, {
        ok: true,
        found: !!row,
        status: row ? (row.handled ? "已联系" : "待联系") : "",
        at: row ? row.created_at : ""
      });
      return;
    } catch (e) {
      /* 旧库没有 handled 列（PGRST204 / 42703）：去掉该列重试，
         此时不做「已联系/待联系」判断，只确认报名已收到。 */
      if (!/handled|PGRST204|42703|schema cache/i.test(String(e.message || ""))) throw e;
      var row2 = pick(await db.rest(
        "GET",
        "submissions?select=created_at&" + where + "&contact=eq." + enc + order
      ));
      http.json(req, res, 200, {
        ok: true,
        found: !!row2,
        status: row2 ? "已收到报名" : "",
        at: row2 ? row2.created_at : ""
      });
    }
  } catch (e) {
    http.json(req, res, 500, { ok: false, error: e.message || "查询失败" });
  }
};
