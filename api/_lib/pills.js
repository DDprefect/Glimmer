"use strict";
/* ==========================================================================
   微光摄影社 · 首屏胶囊配置（v2.9.0）

   hero 区的胶囊（招新 / 活动 / 自定义公告）统一由这份配置驱动：
     存储：COS 对象 _config/hero-pills.json
       {
         "recruit": { "enabled": true, "text": "秋季招新进行中",
                      "link": "join.html#form", "tone": "gold" },
         "eventPill": true,
         "custom": [ { "id": "c1731", "text": "校庆影展开幕",
                       "link": "event.html?id=3", "tone": "red", "enabled": true } ]
       }
   - recruit：招新胶囊。干部可在后台改文字/链接或整体隐藏（不可删除——
     它是常驻入口，避免误删后招新入口从首屏消失）。
   - eventPill：活动胶囊总开关（活动本体在「活动」标签管理，发布即出现）。
   - custom：自定义公告胶囊，增删改自由，最多 6 条。

   读写走签名（cos.sign），同 staticworks 的降级原则：
   - 配置读不到（还没保存过）→ 返回 null，前端用代码内置默认（平滑升级）；
   - 后台写操作失败显式报错，不静默吞掉。
   ========================================================================== */

var cos = require("./cos");

var KEY = "_config/hero-pills.json";
var MAX_CUSTOM = 6;

function cleanText(s, cap) {
  return String(s == null ? "" : s).trim().slice(0, cap || 40);
}

function cleanPill(p) {
  if (!p || typeof p !== "object") return null;
  var text = cleanText(p.text, 30);
  var link = cleanText(p.link, 120);
  var tone = p.tone === "red" ? "red" : "gold";
  if (!text || !link) return null;
  return { text: text, link: link, tone: tone, enabled: p.enabled !== false };
}

function normalize(v) {
  if (!v || typeof v !== "object") return null;
  var out = { recruit: null, eventPill: v.eventPill !== false, custom: [] };
  var rec = cleanPill(v.recruit);
  if (rec) {
    out.recruit = {
      enabled: rec.enabled, text: rec.text, link: rec.link, tone: rec.tone
    };
  }
  var seen = {};
  (Array.isArray(v.custom) ? v.custom : []).forEach(function (c) {
    if (out.custom.length >= MAX_CUSTOM) return;
    var clean = cleanPill(c);
    if (!clean) return;
    var id = String(c.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) ||
      "c" + (out.custom.length + 1) + Date.now().toString(36);
    if (seen[id]) return;
    seen[id] = 1;
    clean.id = id;
    out.custom.push(clean);
  });
  return out;
}

/* 读取配置。404/403 = 还没保存过 → null（前端走内置默认） */
async function read() {
  var res;
  try {
    /* v3.0.0：走统一多域名 + 网络重试请求层 */
    res = await cos.request("get", KEY, { method: "GET" }, null, "胶囊配置读取失败");
  } catch (e) {
    throw new Error(e.message || "胶囊配置读取失败");
  }
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error("胶囊配置读取失败（HTTP " + res.status + "）");
  try {
    return normalize(await res.json());
  } catch (e) {
    throw new Error("胶囊配置格式错误：" + (e.message || "无法解析 JSON"));
  }
}

async function write(cfg) {
  var clean = normalize(cfg);
  if (!clean) throw new Error("胶囊配置格式不合法");
  try {
    await cos.putBuffer(KEY, Buffer.from(JSON.stringify(clean), "utf8"), "application/json");
  } catch (e) {
    throw new Error("胶囊配置写入失败：" + (e.message || "未知错误"));
  }
  return clean;
}

module.exports = { KEY: KEY, normalize: normalize, read: read, write: write, MAX_CUSTOM: MAX_CUSTOM };
