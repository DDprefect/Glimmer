"use strict";
/* ==========================================================================
   微光摄影社 · 月度备份（共享层）
   Supabase 免费项目没有自动备份，且「7 天无访问会被暂停」——
   暂停时官网读不到新数据，万一项目被删则全部记录清零。
   这里把 photos / submissions 两张表导出成 CSV，写入 COS 的
   _backup/ 目录。⚠️ v2.0.12 安全整改：CSV 含报名 PII，下载一律走
   限时预签名 GET（默认 7 天有效），不再生成公有读地址；COS 控制台
   桶策略需对 _backup/* 拒绝匿名读（控制台操作，代码侧无法代办）。
   由 api/backup.js 的 Vercel Cron 每月调用，也可在后台手动触发。
   ========================================================================== */

var db = require("./supabase");
var cos = require("./cos");
var csvLib = require("./csv");

/* 北京时间（UTC+8）的 YYYY-MM：社里按北京时间记账，不用 UTC 月份 */
function stampCN() {
  var now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 7);
}

/* 写一个文本文件到 COS；返回限时预签名 GET 地址（v2.0.12 起不再返回公有读地址：
   备份 CSV 含报名 PII，桶策略对 _backup/* 拒绝匿名读后，只有拿到签名链接才能下载） */
async function putText(key, text) {
  var signed = cos.sign("put", key, 600);
  var put = await fetch(signed.url, {
    method: "PUT",
    body: Buffer.from(text, "utf8"),
    headers: { "Content-Type": "text/csv; charset=utf-8" }
  });
  if (!put.ok) {
    throw new Error("备份写入存储失败（HTTP " + put.status + "）");
  }
  return cos.signedGetUrl(key, 7 * 24 * 3600);
}

/* 执行一次备份：返回 { stamp, photos, subs, photosUrl, subsUrl } */
async function runBackup() {
  var stamp = stampCN();
  var photos = (await db.photos.all()) || [];
  var subs = (await db.submissions.all()) || [];

  var photosCsv = csvLib.toCsv(photos, csvLib.PHOTO_COLS, function (v, key, row) {
    if (key === "status") return csvLib.STATUS_TEXT[v] || v || "";
    if (key === "exif") return csvLib.exifText(row.exif);
    return v;
  });
  var subsCsv = csvLib.toCsv(subs, csvLib.SUB_COLS, function (v, key) {
    if (key === "handled") return v ? "已联系" : "未联系";
    return v;
  });

  var photosUrl = await putText("_backup/" + stamp + "/photos-" + stamp + ".csv", photosCsv);
  var subsUrl = await putText("_backup/" + stamp + "/submissions-" + stamp + ".csv", subsCsv);

  return { stamp: stamp, photos: photos.length, subs: subs.length, photosUrl: photosUrl, subsUrl: subsUrl };
}

module.exports = { runBackup: runBackup, stampCN: stampCN };
