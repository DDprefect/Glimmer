"use strict";
/* ==========================================================================
   微光摄影社 · 频率限制（v2.0.12 起支持集中存储）
   旧行为：Vercel 函数每个实例各有一份内存，挡不住刻意换实例的攻击。
   新行为：配置了集中存储（Upstash Redis REST 或 Vercel KV REST）时，
   计数跨实例生效；未配置或集中存储故障时自动回退进程内存——
   宁可退化为旧行为，也不因存储抖动把真实用户挡在门外。
   对外接口不变（guard / allow / reset），但从同步变为 Promise——
   所有调用点须 await（v2.0.12 已同步更新 upload/register/register-status/
   admin/backup/notify 六处）。
   ========================================================================== */

var buckets = new Map();

function clientIp(req) {
  var f = req.headers["x-forwarded-for"];
  if (f) return String(f).split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "unknown";
}

/* ---------------- 本地内存实现（回退路径，行为与旧版一致） ---------------- */
function allowLocal(key, max, windowMs) {
  var now = Date.now();
  var arr = (buckets.get(key) || []).filter(function (t) { return now - t < windowMs; });
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 10000) buckets.clear(); // 防内存膨胀
  return true;
}

/* ---------------- 集中存储实现（REST，零依赖 fetch） ----------------
   兼容两种配置（都是 Upstash 协议，Vercel KV REST 同构）：
     UPSTASH_REDIS_REST_URL      + UPSTASH_REDIS_REST_TOKEN
     RATE_LIMIT_KV_REST_API      + RATE_LIMIT_KV_REST_TOKEN          */
function centralCfg() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return {
      url: String(process.env.UPSTASH_REDIS_REST_URL).replace(/\/+$/, ""),
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    };
  }
  if (process.env.RATE_LIMIT_KV_REST_API && process.env.RATE_LIMIT_KV_REST_TOKEN) {
    return {
      url: String(process.env.RATE_LIMIT_KV_REST_API).replace(/\/+$/, ""),
      token: process.env.RATE_LIMIT_KV_REST_TOKEN
    };
  }
  return null;
}

/* 固定窗口：INCR 计数 + EXPIRE NX（仅首次设置过期——若每次都刷新 TTL，
   持续访问会让窗口无限顺延，等于永久封禁，语义就错了） */
function centralAllow(c, key, max, windowMs) {
  var k = "glimmer-rl:" + key;
  return fetch(c.url + "/pipeline", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + c.token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([
      ["INCR", k],
      ["EXPIRE", k, String(Math.ceil(windowMs / 1000)), "NX"]
    ])
  }).then(function (r) {
    return r.json();
  }).then(function (arr) {
    var n = arr && arr[0] && Number(arr[0].result);
    return !isNaN(n) && n <= max;
  });
}

function centralDelete(c, key) {
  return fetch(c.url + "/pipeline", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + c.token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([["DEL", "glimmer-rl:" + key]])
  }).then(function () {}).catch(function () {});
}

/* ---------------- 对外接口（异步） ---------------- */

/* key 维度放行判断：windowMs 内最多 max 次 */
async function allow(key, max, windowMs) {
  var c = centralCfg();
  if (c) {
    try {
      return await centralAllow(c, key, max, windowMs);
    } catch (e) {
      /* 集中存储故障 → 回退本地，尽力而为 */
      return allowLocal(key, max, windowMs);
    }
  }
  return allowLocal(key, max, windowMs);
}

/* 按客户端 IP + 场景限流 */
async function guard(req, scene, max, windowMs) {
  return allow(clientIp(req) + ":" + scene, max, windowMs);
}

/* 清掉某个 key 的计数（如密码验证成功后） */
async function reset(key) {
  buckets.delete(key);
  var c = centralCfg();
  if (c) await centralDelete(c, key);
}

module.exports = { clientIp: clientIp, guard: guard, allow: allow, reset: reset, _buckets: buckets };
