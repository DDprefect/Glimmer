"use strict";
/* ==========================================================================
   POST /api/photo-status — 投稿人自查审核进度
   入参：{ author, title }（投稿时填的署名与作品标题，两者都精确匹配）
   出参：{ ok, items: [{ title, category, status, file_url, created_at }] }
   只返回状态与作品本身，不泄露任何联系方式；查不到返回空列表。
   ========================================================================== */

var http = require("./_lib/http");
var db = require("./_lib/supabase");

var STATUS_TEXT = { pending: "待审核", approved: "已发布", offline: "已下架" };

module.exports = async function (req, res) {
  if (req.method === "OPTIONS") return http.preflight(req, res);
  if (!http.requireMethod(req, res, ["POST"])) return;

  try {
    var miss = http.missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
    if (miss.length) {
      return http.json(req, res, 500, { ok: false, error: "服务端未配置数据库环境变量：" + miss.join(", ") });
    }

    var body = await http.readJson(req);
    var title = http.clean(body.title, 50);
    var author = http.clean(body.author, 30);
    if (!title) {
      return http.json(req, res, 400, { ok: false, error: "请填写作品标题" });
    }

    var rows = await db.rest(
      "GET",
      "photos?select=title,category,status,file_url,created_at&title=eq." +
        encodeURIComponent(title) +
        (author ? "&author=eq." + encodeURIComponent(author) : "") +
        "&order=created_at.desc&limit=20"
    );

    var items = (rows || []).map(function (r) {
      /* v2.0.12 安全整改：file_url 只对已发布作品返回——
         待审核/已下架的图不该被按标题反查到可访问的地址（桶公有读，URL 即入口）；
         自查只需要「状态」，所以其余状态置空，功能不受影响 */
      var approved = r.status === "approved";
      return {
        title: r.title,
        category: r.category,
        status: r.status,
        statusText: STATUS_TEXT[r.status] || r.status,
        file_url: approved ? r.file_url : "",
        created_at: r.created_at
      };
    });
    http.json(req, res, 200, { ok: true, items: items });
  } catch (e) {
    http.json(req, res, 500, { ok: false, error: e.message || "查询失败" });
  }
};
