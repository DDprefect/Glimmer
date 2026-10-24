"use strict";
/* ==========================================================================
   微光摄影社 · 频率限制（尽力而为）
   Vercel 函数每个实例各有一份内存：挡不住刻意换实例的攻击，
   但能拦住绝大多数脚本化滥发。与「全局熔断 + 人工审核」配合使用。
   ========================================================================== */

var buckets = new Map();

function clientIp(req) {
  var f = req.headers["x-forwarded-for"];
  if (f) return String(f).split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "unknown";
}

/* key 维度放行判断：windowMs 内最多 max 次 */
function allow(key, max, windowMs) {
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

/* 按客户端 IP + 场景限流 */
function guard(req, scene, max, windowMs) {
  return allow(clientIp(req) + ":" + scene, max, windowMs);
}

/* 清掉某个 key 的计数（如密码验证成功后） */
function reset(key) {
  buckets.delete(key);
}

module.exports = { clientIp: clientIp, guard: guard, allow: allow, reset: reset, _buckets: buckets };
