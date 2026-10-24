"use strict";
/* ==========================================================================
   /api/photos — 照片列表 / 写入
   GET  只返回 status=approved 的作品，按 created_at 倒序（相册懒加载用）
   POST 学生提交作品 → 写 photos 表，status 默认 pending，等干部审核
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");
var cos = require("./_lib/cos");

var CATEGORIES = ["校园纪实", "校外采风", "城市与远方", "人像与视觉"];
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);

  /* ---------------- GET：已审核作品列表 ---------------- */
  if (req.method === "GET") {
    try {
      var rows = await db.photos.approved();
      http.json(req, res, 200, { ok: true, photos: rows || [] });
    } catch (e) {
      http.json(req, res, 500, { ok: false, error: e.message || "读取失败" });
    }
    return;
  }

  if (!http.requireMethod(req, res, ["POST"])) return;

  /* ---------------- POST：提交作品（pending） ---------------- */
  try {
    var miss = http.missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "COS_BUCKET", "COS_REGION"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置环境变量：" + miss.join(", ") });
    }

    var body = await http.readJson(req);
    var category = http.clean(body.category, 20);
    var title = http.clean(body.title, 50);
    var author = http.clean(body.author, 30);
    var shot_date = http.clean(body.shot_date, 10);
    var file_url = String(body.file_url || "").trim();

    if (CATEGORIES.indexOf(category) === -1) {
      return http.json(req, res, 400, { ok: false, error: "分类不合法（仅限四个官方分类）" });
    }
    if (!title) {
      return http.json(req, res, 400, { ok: false, error: "请填写作品标题" });
    }
    if (shot_date && !DATE_RE.test(shot_date)) {
      return http.json(req, res, 400, { ok: false, error: "拍摄日期格式应为 YYYY-MM-DD" });
    }

    /* file_url 必须指向本社 COS 桶、且落在所选分类目录下：
       防止把任意外链或他人文件塞进相册 */
    var key = cos.keyFromUrl(file_url);
    if (!key) {
      return http.json(req, res, 400, { ok: false, error: "图片地址不合法" });
    }
    if (key.indexOf(category + "/") !== 0) {
      return http.json(req, res, 400, { ok: false, error: "图片地址与所选分类不符" });
    }
    if (!/\.(jpg|jpeg)$/i.test(key)) {
      return http.json(req, res, 400, { ok: false, error: "仅支持 JPG 格式图片" });
    }

    var row = {
      category: category,
      title: title,
      author: author,
      shot_date: shot_date || null,
      file_url: file_url,
      status: "pending"
    };
    var created = await db.photos.create(row);
    http.json(req, res, 200, { ok: true, photo: Array.isArray(created) ? created[0] : created });
  } catch (e) {
    http.json(req, res, 500, { ok: false, error: e.message || "提交失败" });
  }
};
