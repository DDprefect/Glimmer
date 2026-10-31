"use strict";
/* ==========================================================================
   POST /api/upload — 作品投稿（服务端转发通道）
   前端把压缩后的图片（原始二进制）POST 到本接口（同源，无跨域问题），
   由服务端签名后写入 COS，并登记作品信息（pending）。
   压缩仍在前端完成（最长边 1600 / 目标 ≤300KB），服务端只做转发。
   元数据走查询参数：?category=..&title=..&author=..&shot_date=..&exif=..
   （exif 为可选的 JSON 拍摄参数，前端从原图解析，服务端白名单清洗）
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");
var cos = require("./_lib/cos");
var notifyLib = require("./_lib/notify");
var rl = require("./_lib/ratelimit");
var exifLib = require("./_lib/exif");

var CATEGORIES = ["校园纪实", "校外采风", "城市与远方", "人像与视觉"];
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var MAX_BYTES = 4 * 1024 * 1024; // 服务端接收上限（压缩后约 300KB，留足余量）
var MIN_BYTES = 2 * 1024;        // 小于 2KB 不可能是正常照片
var RL_MAX = 15;                 // 单 IP 10 分钟内最多 15 次（正常连拍一组也够）
var RL_WINDOW = 10 * 60 * 1000;
var GLOBAL_MAX = 30;             // 全局 10 分钟投稿熔断线

/* 入库（带旧库兼容）：photos 表加上 exif 列之前，带 EXIF 的投稿会因
   「列不存在」被 PostgREST 拒绝——这时去掉 exif 字段重试一次，
   平滑升级，不让同学看到莫名其妙的失败。 */
async function createPhoto(row) {
  try {
    return await db.photos.create(row);
  } catch (e) {
    if (row.exif && /exif|PGRST204|42703|schema cache/i.test(String(e.message || ""))) {
      var slim = {};
      Object.keys(row).forEach(function (k) { if (k !== "exif") slim[k] = row[k]; });
      return await db.photos.create(slim);
    }
    throw e;
  }
}

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

    /* 防护一：跨站表单 POST 拦截（v2.1.1 恢复上线）。
       v2.0.8~v2.0.10 曾因「误拦真实用户」临时下线——真因现已查明：白名单里的
       域名拼错了（lityzglimmer.top，一个从未注册的域名），线上真实来源
       www.ltyzglimmer.top 根本不在名单里，与「不可见字符」「部署差异」均无关。
       域名已经 .top 注册局 RDAP 验证并在 v2.1.1 全仓修正，检查随之恢复。
       诚实局限不变：curl 等不带 Origin 的请求拦不住，真正防线是限流、
       全局熔断、JPG 魔数、蜜罐与人工先审后发。 */
    if (http.originSuspicious(req)) {
      return http.rejectOrigin(req, res);
    }

    /* 防护二：单 IP 频率限制（v2.0.12 起限流异步化，支持集中存储） */
    if (!(await rl.guard(req, "upload", RL_MAX, RL_WINDOW))) {
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

    /* EXIF 拍摄参数（可选）：前端从原图解析后随查询参数提交，
       字段级白名单清洗，任何不合法内容一律丢弃，不影响投稿 */
    var exif = null;
    var exifRaw = u.searchParams.get("exif");
    if (exifRaw) {
      try {
        exif = exifLib.cleanExif(JSON.parse(exifRaw));
      } catch (e) {
        exif = null; // 解析失败按无参数处理
      }
    }

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
    var photo = null;
    try {
      var created = await createPhoto({
        category: category,
        title: title,
        author: author,
        shot_date: shot_date || null,
        exif: exif,
        file_url: fileUrl,
        status: "pending"
      });
      photo = Array.isArray(created) ? created[0] : created;
    } catch (e) {
      /* 入库失败：回删刚写入 COS 的图，避免留下后台看不见的孤儿文件 */
      try {
        var rollback = cos.sign("delete", key, 600);
        await fetch(rollback.url, { method: "DELETE" });
      } catch (e2) {
        /* 回删失败也只能留着（COS 控制台可见），不阻塞错误上报 */
      }
      throw e;
    }
    if (photo) await notifyLib.photoSubmitted(photo);

    http.json(req, res, 200, { ok: true, photo: photo, fileUrl: fileUrl });
  } catch (e) {
    /* 错误上报自身不许再抛：原错误发生时 errorOccurred 若崩溃，
       500 响应就发不出去，前端只剩一句「fetch failed」，真正的原因被吞掉。
       notify 内部已有兜底，这里再包一层双保险（v2.0.11 排障实录）。 */
    try { await notifyLib.errorOccurred(req, "上传投稿", e.message); } catch (e2) { /* 吞掉 */ }
    http.json(req, res, 500, { ok: false, error: e.message || "提交失败" });
  }
};
