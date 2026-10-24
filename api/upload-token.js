"use strict";
/* ==========================================================================
   POST /api/upload-token — 签发 COS 上传凭证（预签名 PUT URL）
   入参：{ category }
   出参：{ ok, key, uploadUrl, fileUrl, expiresIn }
   对象键由服务端生成（分类目录 + 时间戳 + 随机串），前端无法指定，
   既避免覆盖他人文件，也让删除时能按地址反推对象键。
   ========================================================================== */

var http = require("./_lib/http");
var cos = require("./_lib/cos");

var CATEGORIES = ["校园纪实", "校外采风", "城市与远方", "人像与视觉"];

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  try {
    var miss = http.missingEnv(["COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置存储环境变量：" + miss.join(", ") });
    }

    var body = await http.readJson(req);
    var category = http.clean(body.category, 20);
    if (CATEGORIES.indexOf(category) === -1) {
      return http.json(req, res, 400, { ok: false, error: "分类不合法（仅限四个官方分类）" });
    }

    var key =
      category + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
    var signed = cos.sign("put", key, 600);

    http.json(req, res, 200, {
      ok: true,
      key: signed.key,
      uploadUrl: signed.url,
      fileUrl: cos.publicUrl(signed.key),
      expiresIn: 600
    });
  } catch (e) {
    http.json(req, res, 500, { ok: false, error: e.message || "服务器错误" });
  }
};
