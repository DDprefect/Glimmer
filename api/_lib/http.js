"use strict";
/* ==========================================================================
   微光摄影社 · 接口共享层：HTTP 响应 / CORS / 方法分发 / body 解析
   仅服务端运行；密钥一律走 process.env，禁止在本文件出现任何明文密钥。
   ========================================================================== */

/* 来源白名单（纯字符串判定）：
   站点各域（http/https、任意端口、任意层级子域）、Vercel 部署域（任意层级）、
   本地调试地址。不带 Origin（curl 等非浏览器客户端）与 Origin: null
   （沙箱 iframe 等不透明来源）一律放行——投稿/报名另有限流、全局熔断、
   JPG 魔数、蜜罐和人工审核兜底，来源检查从来不是主防线。
   两次放宽的由来：v2.0.8 把「只认 https」放宽为「只拦明确外部来源」后，
   仍有用户（手机 5G 网络）被误拦——收到的 Origin 显示为正常的
   https://www.lityzglimmer.top 却过不了正则。实际是网络侧代理/安全
   软件往头部里插了不可见字符（空格、零宽字符等），肉眼看不出。
   因此匹配前先剥掉所有非可见 ASCII 字符，并按「主机名以本站域结尾」判定。 */
function originAllowedValue(o) {
  if (o == null) return true;
  /* 第一步先把全角标点规范化成 ASCII（：→ :、．→ .、。→ .、／→ /）：
     否则 "top：443" 剥掉全角冒号后会变成 "top443"，端口剥离就失效了。
     第二步剥掉所有非可见 ASCII 字符：空格/换行/零宽/其它杂字一律视为
     注入噪声。Origin 头部按规范只含可见 ASCII，任何其它字节都是被塞进来的。
     规范化只是让畸形字符串回归标准形态，之后照走严格的结尾匹配 */
  o = String(o)
    .replace(/\uff1a/g, ":").replace(/\uff0e/g, ".").replace(/\u3002/g, ".").replace(/\uff0f/g, "/")
    .replace(/[^\x21-\x7e]/g, "").toLowerCase();
  if (!o || o === "null") return true;
  /* 提取主机名。顺序要紧：先剥端口（否则 "localhost:8848" 的 "localhost:"
     会被残缺协议正则当成 scheme 连主机名一起吃掉，只剩 "8848"），
     再剥协议头（标准 ://、冒号丢失的 //、单杠 :/ 三种形态都算），
     最后才剥路径——反过来先剥路径会把 "https//www.lityzglimmer.top"
     整个切没。协议头被代理剥乱时主机名结尾依然是本站域，照样命中 */
  var host = o.replace(/:\d+(\/.*)?$/, "");
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.replace(/^[a-z][a-z0-9+.-]*\/\//, "");
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/*/, "");
  host = host.replace(/\/.*$/, "").replace(/\.+$/, "");
  if (/(^|\.)lityzglimmer\.top$/.test(host)) return true;
  if (/(^|\.)vercel\.app$/.test(host)) return true;
  if (/(^|\.)localhost$/.test(host)) return true;
  if (host === "127.0.0.1") return true;
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

/* 部署版本诊断头：Vercel 为 Git 集成的部署自动注入 VERCEL_GIT_COMMIT_SHA，
   这里把它前 7 位放进每个 JSON 响应头 x-glimmer-rev——线上出问题时用户
   截图 DevTools 的 Response Headers 就能看到跑的是哪个 commit，
   「本地明明修好了线上还报错」一类疑惑从此可自查（v2.0.10 加）。 */
function deployRev() {
  var sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  return sha ? sha.slice(0, 7) : "local";
}

function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", allowOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Glimmer-Rev", deployRev());
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
   那类攻击靠限流 + 全局熔断 + 人工审核兜底（见 api/_lib/ratelimit.js）。
   ⚠️ v2.0.10 起 upload/register 已临时**不再调用**本函数做拦截：
   连续三次修复仍误拦真实用户（本地放行、线上 403，根因疑似 Vercel 部署与
   本地行为不一致），而防护价值本就有限。函数与规则保留，恢复只需在
   api/upload.js、api/register.js 取消注释。originAllowedValue 仍被
   allowOrigin 使用（CORS 反射白名单，浏览器层真实有效，未动）。 */
function originSuspicious(req) {
  return !originAllowedValue(req.headers.origin);
}

/* 来源被拦时的 403：把收到的来源原样带回，且不可见字符以 ·hex· 标出——
   浏览器/网络代理若往 Origin 里塞了空格、零宽字符，截图里能直接看见，
   不用猜（v2.0.9 排查实录：用户手机 5G 网络下 Origin 被插入不可见字节） */
function rejectOrigin(req, res) {
  var raw = String(req.headers.origin || "");
  var shown = raw.length > 60 ? raw.slice(0, 60) + "…" : raw;
  shown = shown.replace(/[^\x21-\x7e]/g, function (ch) {
    var c = ch.codePointAt(0);
    return "·" + (c < 16 ? "0" : "") + c.toString(16) + "·";
  });
  return json(req, res, 403, { ok: false, error: "来源不受支持（origin: " + shown + "）" });
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
