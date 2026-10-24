"use strict";
/* ==========================================================================
   微光摄影社 · 接口共享层：HTTP 响应 / CORS / 方法分发 / body 解析
   仅服务端运行；密钥一律走 process.env，禁止在本文件出现任何明文密钥。
   ========================================================================== */

/* 允许的跨域来源：站点主域 + Vercel 预览部署（*.vercel.app）。
   生产环境前后端同源，本意只是兜底；本地 file:// 打开时接口调用会失败，
   各页面均已做「接口不可用则退回原静态行为」的降级。 */
function allowOrigin(req) {
  var o = req.headers.origin || "";
  if (/^https:\/\/([a-z0-9-]+\.)*lityzglimmer\.top$/i.test(o)) return o;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(o)) return o;
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

/* 来源软检查：浏览器发起的跨站 POST 拦截掉。
   注意：curl 等非浏览器客户端不带 Origin，拦不住也不打算拦——
   那类攻击靠限流 + 全局熔断 + 人工审核兜底（见 api/_lib/ratelimit.js）。 */
function originSuspicious(req) {
  var o = req.headers.origin;
  if (!o) return false;
  return !/^https:\/\/([a-z0-9-]+\.)*lityzglimmer\.top$/i.test(o) &&
         !/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(o);
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
  applyCors: applyCors,
  json: json,
  preflight: preflight,
  requireMethod: requireMethod,
  readJson: readJson,
  readRaw: readRaw,
  missingEnv: missingEnv,
  originSuspicious: originSuspicious,
  clean: clean
};
