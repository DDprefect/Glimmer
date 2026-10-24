"use strict";
/* ==========================================================================
   微光摄影社 · CSV 生成（共享层）
   admin.js 的后台导出与 backup.js 的月度备份共用；
   BOM 由发送端（响应或写文件时）负责加，这里只产正文。
   ========================================================================== */

/* 报名 CSV 列（顺序即导出顺序） */
var SUB_COLS = [
  ["id", "ID"],
  ["name", "姓名"],
  ["class", "年级班级"],
  ["contact", "联系方式"],
  ["interest", "感兴趣方向"],
  ["intro", "想说的话"],
  ["handled", "是否已联系"],
  ["created_at", "提交时间"]
];

/* 投稿 CSV 列 */
var PHOTO_COLS = [
  ["id", "ID"],
  ["category", "分类"],
  ["title", "标题"],
  ["author", "署名"],
  ["shot_date", "拍摄日期"],
  ["exif", "拍摄参数"],
  ["status", "状态"],
  ["created_at", "提交时间"],
  ["file_url", "图片地址"]
];

var STATUS_TEXT = { pending: "待审核", approved: "已发布", offline: "已下架" };

/* rows：数据行；cols：[[字段, 中文表头]]；map：可选的值映射（如状态中文化） */
function toCsv(rows, cols, map) {
  function esc(v) {
    var s = v == null ? "" : String(v);
    // 字段内换行规范成 CRLF（RFC 4180），Excel 打开最稳
    s = s.replace(/\r?\n/g, "\r\n");
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  var lines = [cols.map(function (c) { return esc(c[1]); }).join(",")];
  (rows || []).forEach(function (r) {
    lines.push(cols.map(function (c) {
      var raw = r[c[0]];
      return esc(map ? map(raw, c[0], r) : raw);
    }).join(","));
  });
  return lines.join("\r\n");
}

/* exif（jsonb）→ 一行人类可读文本，如 "NIKON ZR · f/4 1/50s ISO 450 · 51mm" */
function exifText(e) {
  if (!e || typeof e !== "object") return "";
  return [e.camera, e.lens, e.aperture, e.shutter, e.iso, e.focal]
    .filter(Boolean).join(" ");
}

module.exports = { toCsv: toCsv, SUB_COLS: SUB_COLS, PHOTO_COLS: PHOTO_COLS, STATUS_TEXT: STATUS_TEXT, exifText: exifText };
