"use strict";
/* ==========================================================================
   微光摄影社 · 新消息推送（可选）
   配置 NOTIFY_URL 后，有新投稿 / 新报名时向干部推送一条微信消息。
   默认按 Server 酱（sctapi.ftqq.com）的 GET 约定拼 title/desp 参数，
   任何其它「URL 后接 ?title=..&desp=..」即可收到通知的服务都能用。
   推送失败绝不影响主流程（5 秒超时，静默吞掉）。
   ========================================================================== */

var rl = require("./ratelimit");

function notify(title, desp) {
  var url = process.env.NOTIFY_URL;
  if (!url) return Promise.resolve(false);
  var sep = url.indexOf("?") === -1 ? "?" : "&";
  var full =
    url + sep +
    "title=" + encodeURIComponent(title) +
    "&desp=" + encodeURIComponent(desp);
  return fetch(full, { method: "GET", signal: AbortSignal.timeout(5000) })
    .then(function (r) { return r.ok; })
    .catch(function () { return false; });
}

/* 投稿通知 */
function photoSubmitted(p) {
  var lines = [
    "分类：" + (p.category || "—"),
    "标题：" + (p.title || "—"),
    "署名：" + (p.author || "匿名"),
    p.shot_date ? "拍摄日期：" + p.shot_date : "",
    "",
    "请到管理后台审核：https://lityzglimmer.top/admin.html"
  ].filter(Boolean).join("\n");
  return notify("新投稿待审核 · " + (p.title || ""), lines);
}

/* 报名通知 */
function signupSubmitted(s) {
  var lines = [
    "姓名：" + (s.name || "—"),
    s["class"] ? "班级：" + s["class"] : "",
    "联系方式：" + (s.contact || "—"),
    s.interest ? "兴趣方向：" + s.interest : "",
    "",
    "请到管理后台查看：https://lityzglimmer.top/admin.html"
  ].filter(Boolean).join("\n");
  return notify("新同学报名 · " + (s.name || ""), lines);
}

/* 接口异常通知（500 路径用；按 IP 限 3 条/10 分钟，防止刷屏） */
function errorOccurred(req, where, message) {
  if (!process.env.NOTIFY_URL) return Promise.resolve(false);
  if (!rl.guard(req, "err-notify", 3, 10 * 60 * 1000)) return Promise.resolve(false);
  var lines = [
    "接口：" + where,
    "时间：" + new Date().toISOString(),
    "错误：" + String(message || "").slice(0, 500),
    "",
    "请到 Vercel 后台 → Deployments → Logs 查看详情"
  ].join("\n");
  return notify("接口异常 · " + where, lines);
}

module.exports = { notify: notify, photoSubmitted: photoSubmitted, signupSubmitted: signupSubmitted, errorOccurred: errorOccurred };
