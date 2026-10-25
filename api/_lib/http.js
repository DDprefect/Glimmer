"use strict";
/* ==========================================================================
   微光摄影社 · 接口共享层：HTTP 响应 / CORS / 方法分发 / body 解析
   仅服务端运行；密钥一律走 process.env，禁止在本文件出现任何明文密钥。
   ========================================================================== */

/* 来源白名单（纯字符串判定）：
   站点各域（http/https、任意子域深度、任意端口）、Vercel 部署域（任意子域
   深度）、本地调试地址。不带 Origin（curl 等非浏览器客户端）与 Origin: null
   （沙箱 iframe 等不透明来源）一律放行——投稿/报名另有限流、全局熔断、
   JPG 魔数、蜜罐和人工审核兜底，来源检查从来不是主防线。
   2026-10-25 放宽：此前只认 https 且拒绝端口/localhost/null，实测有用户从
   http、带端口或镜像域打开页面时投稿被误拦（「来源不受支持」），现只拦
   明确的外部来源。 */
function originAllowedValue(o) {
  if (!o || o === "null") return true;
  if (/^https?:\/\/([a-z0-9-]+\.)*lityzglimmer\.top(:\d+)?$/i.test(o)) return true;
  if (/^https?:\/\/([a-z0-9-]+\.)*vercel\.app(:\d+)?$/i.test(o)) return true;
  if (/^https?:\/\/localhost(:\d+)?$/i.test(o)) return true;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(o)) return true;
  return false;
}

/* 允许的跨域来源：命中白名单就原样反射（含 null），否则回落到主域。
   生产环境前后端同源，本意只是兜底；本地 file:// 打开时接口调用会失败，
   各页面均已做「接口不可用则退回原静态行为」的降级。 */
function allowOrigin(req) {
  var o = req.headers.origin || "";
  if (o && originAllowedValue(o)) return o;
  return "https://lityzglimmer.top";
}

function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", allowOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function json(req, res, code, obj) {
  applyCors(req, res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function preflight(req, res) {
  applyCors(req, res);
  res.statusCode = 204;
  res.end();
}

/* 方法白名单；不符直接 405，返回 false 让调用方中止 */
function requireMethod(req, res, methods) {
  if (methods.indexOf(req.method) === -1) {
    json(req, res, 405, { ok: false, error: "方法不允许" });
    return false;
  }
  return true;
}

/* 读取 JSON body（带体积上限，防止恶意大包） */
function readJson(req, limit) {
  return new Promise(function (resolve, reject) {
    var cap = limit || 64 * 1024;
    var size = 0;
    var buf = "";
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > cap) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      buf += chunk;
    });
    req.on("end", function () {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(new Error("JSON 解析失败"));
      }
    });
    req.on("error", reject);
  });
}

/* 读取原始二进制 body（图片上传用，带体积上限） */
function readRaw(req, limit) {
  return new Promise(function (resolve, reject) {
    var cap = limit || 4 * 1024 * 1024;
    var size = 0;
    var chunks = [];
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > cap) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/* 来源软检查：只拦「明摆着来自别的站」的浏览器 POST。
   注意：curl 等非浏览器客户端不带 Origin，拦不住也不打算拦——
   那类攻击靠限流 + 全局熔断 + 人工审核兜底（见 api/_lib/ratelimit.js）。 */
function originSuspicious(req) {
  return !originAllowedValue(req.headers.origin);
}

/* 来源被拦时的 403：把收到的来源原样带回报错文案，
   用户截图就能看出是从哪个域打开的页面，方便加白名单 */
function rejectOrigin(req, res) {
  var o = String(req.headers.origin || "");
  if (o.length > 80) o = o.slice(0, 80) + "…";
  return json(req, res, 403, { ok: false, error: "来源不受支持（origin: " + o + "）" });
}

/* 环境变量自检：返回缺失的变量名列表 */
function missingEnv(names) {
  return names.filter(function (n) { return !process.env[n]; });
}

/* 字符串清洗：去首尾空白、折叠内部换行，防注入换行破坏 CSV/日志 */
function clean(v, maxLen) {
  var s = String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

module.exports = {
  allowOrigin: allowOrigin,
  originAllowedValue: originAllowedValue,
  applyCors: applyCors,
  json: json,
  preflight: preflight,
  requireMethod: requireMethod,
  readJson: readJson,
  readRaw: readRaw,
  missingEnv: missingEnv,
  originSuspicious: originSuspicious,
  rejectOrigin: rejectOrigin,
  clean: clean
};
