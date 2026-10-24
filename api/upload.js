"use strict";
/* ==========================================================================
   POST /api/upload — 作品投稿（服务端转发通道）
   前端把压缩后的图片（原始二进制）POST 到本接口（同源，无跨域问题），
   由服务端签名后写入 COS，并登记作品信息（pending）。
   压缩仍在前端完成（最长边 1600 / 目标 ≤300KB），服务端只做转发。
   元数据走查询参数：?category=..&title=..&author=..&shot_date=..
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");
var cos = require("./_lib/cos");
var notifyLib = require("./_lib/notify");
var rl = require("./_lib/ratelimit");

var CATEGORIES = ["校园纪实", "校外采风", "城市与远方", "人像与视觉"];
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var MAX_BYTES = 4 * 1024 * 1024; // 服务端接收上限（压缩后约 300KB，留足余量）
var MIN_BYTES = 2 * 1024;        // 小于 2KB 不可能是正常照片
var RL_MAX = 15;                 // 单 IP 10 分钟内最多 15 次（正常连拍一组也够）
var RL_WINDOW = 10 * 60 * 1000;
var GLOBAL_MAX = 30;             // 全局 10 分钟投稿熔断线

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  try {
    var miss = http.missingEnv([
      "COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION",
      "SUPABASE_URL", "SUPABASE_SERVICE_KEY"
    ]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置环境变量：" + miss.join(", ") });
    }

    /* 防护一：跨站表单 POST 拦截 */
    if (http.originSuspicious(req)) {
      return http.json(req, res, 403, { ok: false, error: "来源不受支持" });
    }

    /* 防护二：单 IP 频率限制 */
    if (!rl.guard(req, "upload", RL_MAX, RL_WINDOW)) {
      return http.json(req, res, 429, { ok: false, error: "上传太频繁，请 10 分钟后再试" });
    }

    /* 防护三：全局熔断——最近 10 分钟投稿量异常直接拒（防换 IP 的脚本洪峰） */
    var since = new Date(Date.now() - RL_WINDOW).toISOString();
    var recent = await db.rest("GET", "photos?select=id&created_at=gte." + encodeURIComponent(since) + "&limit=50");
    if ((recent || []).length >= GLOBAL_MAX) {
      return http.json(req, res, 429, { ok: false, error: "投稿通道繁忙，请稍后再试" });
    }

    var u = new URL(req.url, "http://localhost");
    var category = http.clean(u.searchParams.get("category"), 20);
    var title = http.clean(u.searchParams.get("title"), 50);
    var author = http.clean(u.searchParams.get("author"), 30);
    var shot_date = http.clean(u.searchParams.get("shot_date"), 10);

    if (CATEGORIES.indexOf(category) === -1) {
      return http.json(req, res, 400, { ok: false, error: "分类不合法（仅限四个官方分类）" });
    }
    if (!title) {
      return http.json(req, res, 400, { ok: false, error: "请填写作品标题" });
    }
    if (shot_date && !DATE_RE.test(shot_date)) {
      return http.json(req, res, 400, { ok: false, error: "拍摄日期格式应为 YYYY-MM-DD" });
    }

    var buf = await http.readRaw(req, MAX_BYTES);
    /* 防护四：JPG 魔数校验，挡掉伪装成图片的其它文件 */
    if (buf.length < MIN_BYTES || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return http.json(req, res, 400, { ok: false, error: "只能上传 JPG 图片" });
    }

    /* 对象键服务端生成：分类目录 + 时间戳 + 随机串 */
    var key =
      category + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";

    /* 服务端直写 COS（无浏览器跨域限制；签名与密钥都不出服务端） */
    var signed = cos.sign("put", key, 600);
    var put = await fetch(signed.url, {
      method: "PUT",
      body: buf,
      headers: { "Content-Type": "image/jpeg" }
    });
    if (!put.ok) {
      throw new Error("图片写入存储失败（HTTP " + put.status + "），请稍后重试或联系干部");
    }

    var fileUrl = cos.publicUrl(key);
    var created = await db.photos.create({
      category: category,
      title: title,
      author: author,
      shot_date: shot_date || null,
      file_url: fileUrl,
      status: "pending"
    });
    var photo = Array.isArray(created) ? created[0] : created;
    if (photo) await notifyLib.photoSubmitted(photo);

    http.json(req, res, 200, { ok: true, photo: photo, fileUrl: fileUrl });
  } catch (e) {
    http.json(req, res, 500, { ok: false, error: e.message || "提交失败" });
  }
};
