"use strict";
/* ==========================================================================
   微光摄影社 · 静态老作品（assets/data/works.js）的删除清单

   为什么用清单而不是改文件：works.js 与 assets/img/works/*.webp 属于仓库
   静态资源，Vercel 运行时文件系统只读，后台接口无法物理删除；且改了也会
   被下一次部署覆盖。因此采用「逻辑删除」——把被移除的作品 id 记在 COS
   私有语义对象里，前台（首页 / 作品集）读取后从展示列表中过滤。

   存储：COS 对象 _config/hidden-works.json
     { "hidden": ["hanlou-01", ...],   // 移入回收站，可恢复
       "purged": ["hanlou-02", ...],   // 永久移除，后台不再列出
       "shown":  ["view-04", ...] }    // v2.6.1：强制展示——把 works.js 里
                                       // 历史 hidden:true 的作品重新放出来
   读写一律走签名（cos.sign），服务端自访不受桶匿名策略影响。
   ⚠️ 桶为「公有读私有写」：清单内容只有作品 id（与公开的 works.js 一致），
   不含隐私；若希望完全禁止匿名读，可在控制台按 _backup/* 同款加一条
   Deny 匿名 GetObject 的 _config/* 策略（可选，不影响签名读写）。

   降级原则：清单读不出来时，公开接口返回空清单（宁可多显示作品，
   也不能因配置抖动让整站作品消失）；后台写操作则显式报错，避免
   「读失败 → 当成空清单 → 覆盖写」把已有清单抹掉。
   ========================================================================== */

var cos = require("./cos");

var KEY = "_config/hidden-works.json";
var MAX_IDS = 500;

function emptyList() {
  return { hidden: [], purged: [], shown: [] };
}

/* 只接受字符串 id、去重、限量，防脏数据把清单撑爆 */
function cleanIds(arr) {
  if (!Array.isArray(arr)) return [];
  var seen = {};
  var out = [];
  arr.forEach(function (v) {
    if (typeof v !== "string") return;
    var id = v.trim().slice(0, 80);
    if (!id || seen[id] || out.length >= MAX_IDS) return;
    seen[id] = 1;
    out.push(id);
  });
  return out;
}

function normalize(v) {
  if (!v || typeof v !== "object") return emptyList();
  return { hidden: cleanIds(v.hidden), purged: cleanIds(v.purged), shown: cleanIds(v.shown) };
}

/* 读取清单。404 = 还没建过，视为空清单；其它错误抛带标签的 Error */
async function read() {
  var res;
  try {
    /* v3.0.0：走统一多域名 + 网络重试请求层 */
    res = await cos.request("get", KEY, { method: "GET" }, null, "静态作品清单读取失败");
  } catch (e) {
    throw new Error(e.message || "静态作品清单读取失败");
  }
  if (res.status === 404 || res.status === 403) return emptyList();
  if (!res.ok) {
    throw new Error("静态作品清单读取失败（HTTP " + res.status + "）");
  }
  try {
    return normalize(await res.json());
  } catch (e) {
    throw new Error("静态作品清单格式错误：" + (e.message || "无法解析 JSON"));
  }
}

async function write(list) {
  var body = Buffer.from(JSON.stringify(normalize(list)), "utf8");
  try {
    await cos.putBuffer(KEY, body, "application/json");
  } catch (e) {
    throw new Error("静态作品清单写入失败：" + (e.message || "未知错误"));
  }
  return normalize(list);
}

/* 设置单个作品状态：hidden（回收站）/ purged（永久移除）/ visible（恢复展示）
   三个列表互斥：先摘干净，再按目标状态放回。
   v2.6.1：visible 会额外写入 shown —— works.js 里历史 hidden:true 的作品
   靠它才能重新展示（前台判定：(!w.hidden || shown) && !excluded）。
   对本来就没 hidden 的作品，shown 只是冗余标记，无副作用。 */
async function set(id, state) {
  if (typeof id !== "string" || !id.trim()) throw new Error("缺少作品 id");
  var workId = id.trim().slice(0, 80);
  if (["hidden", "purged", "visible"].indexOf(state) === -1) {
    throw new Error("未知状态：" + state);
  }
  var list = await read();
  ["hidden", "purged", "shown"].forEach(function (k) {
    list[k] = list[k].filter(function (x) { return x !== workId; });
  });
  if (state === "hidden") list.hidden.unshift(workId);
  if (state === "purged") list.purged.unshift(workId);
  if (state === "visible") list.shown.unshift(workId);
  return write(list);
}

/* 前台：excluded 是「不展示」并集，shown 是「强制展示」覆盖名单 */
function publicList(list) {
  var l = normalize(list);
  return {
    hidden: l.hidden,
    purged: l.purged,
    shown: l.shown,
    excluded: l.hidden.concat(l.purged)
  };
}

module.exports = {
  KEY: KEY,
  emptyList: emptyList,
  normalize: normalize,
  read: read,
  write: write,
  set: set,
  publicList: publicList
};
