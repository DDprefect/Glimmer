"use strict";
/* ==========================================================================
   微光摄影社 · 新消息推送（可选）
   配置 NOTIFY_URL 后，有新投稿 / 新报名时向干部推送一条微信消息。
   默认按 Server 酱（sctapi.ftqq.com）的 GET 约定拼 title/desp 参数，
   任何其它「URL 后接 ?title=..&desp=..」即可收到通知的服务都能用。
   推送失败绝不影响主流程——v2.0.11 起每个导出函数整体包 try/catch：
   线上排查时见过「原错误发生 → errorOccurred 再抛 → catch 块二次崩溃 →
   500 响应发不出来 → 前端只看到 fetch failed」的连锁，通知是锦上添花，
   任何时候都不许它碰主流程，更不许它把真正的错误信息吞掉。
   ========================================================================== */

var rl = require("./ratelimit");

/* 手动超时控制器：不依赖 Node 17.3+ 的 AbortSignal.timeout，
   某些运行时/老版本没有它，放在 fetch 参数里会同步抛 ReferenceError */
function timeoutSignal(ms) {
  var ac = new AbortController();
  var timer = setTimeout(function () { ac.abort(); }, ms);
  if (timer && typeof timer.unref === "function") timer.unref();
  return ac.signal;
}

function notify(title, desp) {
  try {
    var url = process.env.NOTIFY_URL;
    if (!url) return Promise.resolve(false);
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    var full =
      url + sep +
      "title=" + encodeURIComponent(title) +
      "&desp=" + encodeURIComponent(desp);
    return fetch(full, { method: "GET", signal: timeoutSignal(5000) })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  } catch (e) {
    return Promise.resolve(false); // 任何意外都当没配通知处理
  }
}

/* 投稿通知 */
function photoSubmitted(p) {
  try {
    var lines = [
      "分类：" + (p.category || "—"),
      "标题：" + (p.title || "—"),
      "署名：" + (p.author || "匿名"),
      p.shot_date ? "拍摄日期：" + p.shot_date : "",
      p.exif && p.exif.camera ? "机型：" + p.exif.camera : "",
      "",
      "请到管理后台审核：https://ltyzglimmer.top/admin.html"
    ].filter(Boolean).join("\n");
    return notify("新投稿待审核 · " + (p.title || ""), lines);
  } catch (e) {
    return Promise.resolve(false);
  }
}

/* 报名通知 */
function signupSubmitted(s) {
  try {
    var lines2 = [
      "姓名：" + (s.name || "—"),
      s["class"] ? "班级：" + s["class"] : "",
      "联系方式：" + (s.contact || "—"),
      s.interest ? "兴趣方向：" + s.interest : "",
      "",
      "请到管理后台查看：https://ltyzglimmer.top/admin.html"
    ].filter(Boolean).join("\n");
    return notify("新同学报名 · " + (s.name || ""), lines2);
  } catch (e) {
    return Promise.resolve(false);
  }
}

/* 备份完成通知。
   v2.0.12 安全整改：不再推送备份下载链接——CSV 含报名 PII，且 NOTIFY_URL
   通常是第三方服务（Server 酱等），PII 链接不该出站。管理员在后台「立即备份」
   的返回里拿限时预签名链接即可。 */
function backupDone(result) {
  try {
    var r = result || {};
    var lines3 = [
      "备份时间：" + new Date().toISOString(),
      "作品记录：" + (r.photos != null ? r.photos : "—") + " 条",
      "报名记录：" + (r.subs != null ? r.subs : "—") + " 条",
      "",
      "备份文件已写入 COS _backup/ 目录（私有语义，凭限时签名链接下载）；" +
      "Supabase 项目万一被删也能找回数据"
    ].filter(Boolean).join("\n");
    return notify("月度备份完成 · " + (r.stamp || ""), lines3);
  } catch (e) {
    return Promise.resolve(false);
  }
}

/* 接口异常通知（500 路径用；按 IP 限 3 条/10 分钟，防止刷屏）。
   v2.0.12：rl.guard 异步化后本函数改为 async——整体仍在 try/catch 内，
   任何意外（含畸形 req）都 resolve false，绝不把原错误吞成二次崩溃 */
async function errorOccurred(req, where, message) {
  try {
    if (!process.env.NOTIFY_URL) return false;
    if (!(await rl.guard(req, "err-notify", 3, 10 * 60 * 1000))) return false;
    var lines4 = [
      "接口：" + where,
      "时间：" + new Date().toISOString(),
      "错误：" + String(message || "").slice(0, 500),
      "",
      "请到 Vercel 后台 → Deployments → Logs 查看详情"
    ].join("\n");
    return notify("接口异常 · " + where, lines4);
  } catch (e) {
    return false;
  }
}

module.exports = {
  notify: notify,
  photoSubmitted: photoSubmitted,
  signupSubmitted: signupSubmitted,
  backupDone: backupDone,
  errorOccurred: errorOccurred
};
