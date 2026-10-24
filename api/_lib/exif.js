"use strict";
/* ==========================================================================
   微光摄影社 · 投稿 EXIF 拍摄参数清洗（仅服务端）
   前端 assets/js/exif.js 已从原图解析并格式化，这里做字段级白名单校验：
   只放行固定格式的七个字段，任何异常一律丢弃（返回 null）。
   清洗后的对象整体存入 photos.exif（jsonb 列）。
   ========================================================================== */

/* [字段, 最大长度, 格式校验] */
var FIELDS = [
  ["camera",   40, /^[^\x00-\x1f]{1,40}$/],                 // 机型（可含中文）
  ["lens",     60, /^[^\x00-\x1f]{1,60}$/],                 // 镜头
  ["aperture", 10, /^f\/\d+(\.\d+)?$/],                     // f/2.8
  ["shutter",  12, /^(\d+\/\d+|\d+(\.\d+)?)s$/],            // 1/250s 或 2s
  ["iso",       8, /^ISO \d{2,6}$/],                        // ISO 400
  ["focal",     8, /^\d{1,4}mm$/],                          // 35mm
  ["shotAt",   10, /^\d{4}-\d{2}-\d{2}$/]                   // 拍摄日期
];

/* raw：前端传来的已解析对象（或 null）→ 清洗后的对象（无合法字段时返回 null） */
function cleanExif(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  var out = {};
  FIELDS.forEach(function (f) {
    var key = f[0], maxLen = f[1], re = f[2];
    var v = raw[key];
    if (v == null) return;
    if (typeof v === "number") v = String(v);
    if (typeof v !== "string") return;
    v = v.trim();
    if (!v || v.length > maxLen || !re.test(v)) return;
    out[key] = v;
  });
  return Object.keys(out).length ? out : null;
}

module.exports = { cleanExif: cleanExif, FIELDS: FIELDS };
