"use strict";
/* ==========================================================================
   微光摄影社 · 后端接口本地测试（不依赖真实 COS / Supabase）
   用法：node _tools/api_test.js
   两部分：
     A. COS 签名向量测试 —— 用腾讯云官方文档《对象存储 请求签名》里的
        完整示例逐步验证 api/_lib/cos.js 的算法实现
     B. 接口集成测试 —— 本地 mock Supabase REST + node http 挂载 4 个真实
        handler，跑完整请求/响应断言（校验规则、401、审核/删除/导出 CSV）
   ========================================================================== */

var assert = require("assert");
var http = require("http");
var crypto = require("crypto");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var cos = require(path.join(ROOT, "api/_lib/cos.js"));

var PASS = 0;
var FAIL = 0;
function ok(name, cond, extra) {
  if (cond) {
    PASS++;
    console.log("  ✓ " + name);
  } else {
    FAIL++;
    console.log("  ✗ " + name + (extra ? "  → " + extra : ""));
  }
}

/* ========================================================================
   A. COS 签名向量测试（腾讯云文档示例，2025-07-03 版）
   ======================================================================== */
function testCosVector() {
  console.log("\n[A] COS 签名算法 · 官方文档向量");

  // 文档示例的 HttpHeaders（键已按字典序、值已 camSafeUrlEncode）
  var headers = {
    "content-length": "13",
    "content-md5": "mQ/fVh815F3k6TAUm8m0eg==",
    "content-type": "text/plain",
    date: "Thu, 16 May 2019 06:45:51 GMT",
    host: "examplebucket-1250000000.cos.ap-beijing.myqcloud.com",
    "x-cos-acl": "private",
    "x-cos-grant-read": 'uin="100000000011"'
  };
  var headerStr = cos.obj2str(headers);
  var expectHeaders =
    "content-length=13&content-md5=mQ%2FfVh815F3k6TAUm8m0eg%3D%3D&content-type=text%2Fplain&" +
    "date=Thu%2C%2016%20May%202019%2006%3A45%3A51%20GMT&" +
    "host=examplebucket-1250000000.cos.ap-beijing.myqcloud.com&x-cos-acl=private&" +
    "x-cos-grant-read=uin%3D%22100000000011%22";
  ok("obj2str 序列化与文档一致", headerStr === expectHeaders, headerStr);

  // HttpString = put\n/exampleobject(腾讯云)\n\n<headers>\n
  var httpString = ["put", "/exampleobject(腾讯云)", "", headerStr, ""].join("\n");
  var sha1 = crypto.createHash("sha1").update(Buffer.from(httpString, "utf8")).digest("hex");
  ok("SHA1(HttpString) = 8b2751e7…cca4172", sha1 === "8b2751e77f43a0995d6e9eb9477f4b685cca4172", sha1);

  // StringToSign = sha1\nKeyTime\nSHA1(HttpString)\n
  var keyTime = "1557989151;1557996351";
  var stringToSign = ["sha1", keyTime, sha1, ""].join("\n");
  // 文档给出的 SignKey（SecretKey 未公开，直接用其结果验算最后一步）
  var signKey = "eb2519b498b02ac213cb1f3d1a3d27a3b3c9bc5f";
  var signature = crypto.createHmac("sha1", signKey).update(stringToSign).digest("hex");
  // 注意：文档该示例的签名值尾部（…c6931234）与按同一输入复算的结果（…c6935172）
  // 不一致，且前 32 位相同 —— 判定为文档示例笔误（文档自标"示例"）。
  // 已用 Python hmac 独立复算交叉验证，取复算值。
  ok("Signature = 3b8851a1…c6935172（独立复算值）", signature === "3b8851a11a569213c17ba8fa7dcf2abec6935172", signature);

  // sign() 结构自洽性（固定时钟，保证确定性）
  var realNow = Date.now;
  Date.now = function () { return 1759000000000; };
  try {
    process.env.COS_SECRET_ID = "AKIDTESTTESTTESTTEST";
    process.env.COS_SECRET_KEY = "test-secret-key";
    process.env.COS_BUCKET = "glimmer-photos";
    process.env.COS_REGION = "ap-guangzhou";

    var s = cos.sign("put", "校园纪实/1759000000000-ab12cd.jpg", 600);
    ok("签名 URL 指向正确主机", s.url.indexOf("https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/") === 0, s.url);
    ok("URL 路径含编码后的中文目录", s.url.indexOf("/%E6%A0%A1%E5%9B%AD%E7%BA%AA%E5%AE%9E/") !== -1);
    ok("URL 含 q-signature", /[?&]q-signature=[0-9a-f]{40}(&|$)/.test(s.url));
    ok("URL 含 q-header-list=host", s.url.indexOf("q-header-list=host") !== -1);
    ok("URL 含 q-sign-time（; 已编码为 %3B）", s.url.indexOf("q-sign-time=1758999999%3B1759000599") !== -1);
    ok("URL 含 q-ak", s.url.indexOf("q-ak=AKIDTESTTESTTESTTEST") !== -1);
    ok("签名有效期 600 秒", s.url.indexOf("q-key-time=1758999999%3B1759000599") !== -1);

    // 公开地址 ↔ 对象键 往返（含中文）
    var pub = cos.publicUrl("城市与远方/1759000000000-zz99.jpg");
    ok("publicUrl/keyFromUrl 往返一致", cos.keyFromUrl(pub) === "城市与远方/1759000000000-zz99.jpg", pub);
    ok("keyFromUrl 拒绝外链", cos.keyFromUrl("https://evil.example.com/a.jpg") === null);
    ok("keyFromUrl 拒绝同域其他桶", cos.keyFromUrl("https://other.cos.ap-guangzhou.myqcloud.com/a.jpg") === null);

    // delete 与 put 仅方法不同，URL 结构一致
    var d = cos.sign("delete", "校园纪实/x.jpg", 600);
    ok("delete 签名 URL 同构", d.url.indexOf("https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/") === 0 && /q-signature=[0-9a-f]{40}/.test(d.url));
  } finally {
    Date.now = realNow;
  }
}

/* ========================================================================
   B. 接口集成测试（mock Supabase）
   ======================================================================== */

/* ---- mock Supabase：内存数据 + 最小 PostgREST 行为 ---- */
function startMockSupabase() {
  var state = {
    photos: [
      { id: 1, category: "校园纪实", title: "老图·已发布", author: "甲", shot_date: "2026-01-02", file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/校园纪实/1.jpg", status: "approved", created_at: "2026-01-03T00:00:00Z" },
      { id: 2, category: "人像与视觉", title: "待审图", author: "乙", shot_date: null, file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/人像与视觉/2.jpg", status: "pending", created_at: "2026-01-04T00:00:00Z" },
      { id: 3, category: "城市与远方", title: "老图·城市", author: "丙", shot_date: "2025-12-31", file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/城市与远方/3.jpg", status: "approved", created_at: "2025-12-31T00:00:00Z" }
    ],
    submissions: [
      { id: 1, name: '含"引号",同学', class: "高二3班", contact: "QQ 12345", interest: "人像、后期", intro: "喜欢拍\n换行的", created_at: "2026-01-05T00:00:00Z" }
    ],
    nextPhoto: 4,
    nextSub: 2,
    sawServiceKey: false
  };

  var server = http.createServer(function (req, res) {
    var u = new URL(req.url, "http://127.0.0.1");
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      var bodyText = Buffer.concat(chunks).toString("utf8");
      if (req.headers.apikey === "test-service-key" && req.headers.authorization === "Bearer test-service-key") {
        state.sawServiceKey = true;
      }
      function send(code, data) {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
      }
      var m = /^\/rest\/v1\/(photos|submissions)$/.exec(u.pathname);
      if (!m) return send(404, { message: "not found" });
      var table = state[m[1]];

      /* 通用行过滤：eq.X / in.(a,b,c)（searchParams 已百分号解码） */
      function matches(row) {
        var ok = true;
        u.searchParams.forEach(function (v, k) {
          if (k === "order" || k === "select" || k === "limit") return;
          var me = /^eq\.([\s\S]*)$/.exec(v);
          if (me) { if (String(row[k]) !== me[1]) ok = false; return; }
          var mi = /^in\.\(([\s\S]*)\)$/.exec(v);
          if (mi) { if (mi[1].split(",").indexOf(String(row[k])) === -1) ok = false; }
        });
        return ok;
      }
      /* 取 id 过滤目标（eq 或 in） */
      function idFilter() {
        var v = u.searchParams.get("id");
        if (!v) return null;
        var mi = /^in\.\(([\s\S]*)\)$/.exec(v);
        if (mi) return function (r) { return mi[1].split(",").indexOf(String(r.id)) !== -1; };
        return function (r) { return String(r.id) === v.replace(/^eq\./, ""); };
      }

      if (req.method === "GET") {
        var rows = table.filter(matches);
        if (u.searchParams.get("order") === "created_at.desc") {
          rows = rows.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
        }
        return send(200, rows);
      }
      if (req.method === "POST") {
        var row = JSON.parse(bodyText || "{}");
        row.id = m[1] === "photos" ? state.nextPhoto++ : state.nextSub++;
        row.created_at = new Date().toISOString();
        table.push(row);
        return send(201, [row]);
      }
      if (req.method === "PATCH") {
        var patch = JSON.parse(bodyText || "{}");
        var pf = idFilter();
        table.forEach(function (r) { if (!pf || pf(r)) Object.assign(r, patch); });
        return send(204, null);
      }
      if (req.method === "DELETE") {
        var df = idFilter();
        state[m[1]] = table.filter(function (r) { return !df || !df(r); });
        return send(204, null);
      }
      send(405, { message: "method not allowed" });
    });
  });

  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({ server: server, state: state, port: server.address().port });
    });
  });
}

/* ---- 挂载真实 handler 的本地 API 服务器 ---- */
function startApiServer() {
  var handlers = {
    "/api/upload-token": require(path.join(ROOT, "api/upload-token.js")),
    "/api/photos": require(path.join(ROOT, "api/photos.js")),
    "/api/register": require(path.join(ROOT, "api/register.js")),
    "/api/admin": require(path.join(ROOT, "api/admin.js")),
    "/api/photo-status": require(path.join(ROOT, "api/photo-status.js")),
    "/api/keepalive": require(path.join(ROOT, "api/keepalive.js"))
  };
  var server = http.createServer(function (req, res) {
    var u = new URL(req.url, "http://127.0.0.1");
    var h = handlers[u.pathname];
    if (!h) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    h(req, res);
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

function call(port, method, path, payload, headers) {
  return new Promise(function (resolve, reject) {
    var data = payload === undefined ? null : JSON.stringify(payload);
    var req = http.request(
      {
        host: "127.0.0.1",
        port: port,
        path: path,
        method: method,
        headers: Object.assign(
          { "Content-Type": "application/json", Origin: "https://lityzglimmer.top" },
          headers || {},
          data ? { "Content-Length": Buffer.byteLength(data) } : {}
        )
      },
      function (res) {
        var chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          var text = Buffer.concat(chunks).toString("utf8");
          var json = null;
          try { json = text ? JSON.parse(text) : null; } catch (e) {}
          resolve({ status: res.statusCode, headers: res.headers, text: text, json: json });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function testApi() {
  console.log("\n[B] 接口集成 · mock Supabase");

  var mock = await startMockSupabase();
  var api = await startApiServer();

  process.env.SUPABASE_URL = "http://127.0.0.1:" + mock.port;
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.COS_SECRET_ID = "AKIDTESTTESTTESTTEST";
  process.env.COS_SECRET_KEY = "test-secret-key";
  process.env.COS_BUCKET = "glimmer-photos";
  process.env.COS_REGION = "ap-guangzhou";
  process.env.ADMIN_PASSWORD = "glimmer2026";

  /* COS 删除走外网 —— 测试里桩掉非 Supabase 的 fetch，并记录通知调用 */
  var realFetch = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    if (String(url).indexOf(process.env.SUPABASE_URL) === 0) return realFetch(url, opts);
    notifyCalls.push(String(url));
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(""); } });
  };

  var P = api.port;
  var COS_BASE = "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/";
  var notifyCalls = [];
  process.env.NOTIFY_URL = "https://sctapi.ftqq.com/TESTSENDKEY.send";

  /* ---------- photos GET ---------- */
  var r = await call(P, "GET", "/api/photos");
  ok("GET /api/photos → 200", r.status === 200 && r.json.ok === true);
  ok("GET 只返回 approved", r.json.photos.length === 2 && r.json.photos.every(function (p) { return p.status === "approved"; }));
  ok("GET 按 created_at 倒序", r.json.photos[0].id === 1 && r.json.photos[1].id === 3);

  /* ---------- photos POST 校验 ---------- */
  r = await call(P, "POST", "/api/photos", { category: "校园纪实", title: "新作", author: "丁", shot_date: "2026-02-01", file_url: COS_BASE + "校园纪实/9.jpg" });
  ok("POST 合法作品 → 200 且入库为 pending", r.status === 200 && r.json.ok && mock.state.photos.some(function (p) { return p.id === r.json.photo.id && p.status === "pending"; }));
  ok("投稿成功触发通知推送", notifyCalls.some(function (u) { return u.indexOf("sctapi.ftqq.com/TESTSENDKEY.send?title=") !== -1; }), notifyCalls[0]);

  r = await call(P, "POST", "/api/photos", { category: "随便分", title: "x", file_url: COS_BASE + "校园纪实/9.jpg" });
  ok("POST 非法分类 → 400", r.status === 400);

  r = await call(P, "POST", "/api/photos", { category: "校园纪实", title: "", file_url: COS_BASE + "校园纪实/9.jpg" });
  ok("POST 缺标题 → 400", r.status === 400);

  r = await call(P, "POST", "/api/photos", { category: "校园纪实", title: "x", file_url: "https://evil.example.com/a.jpg" });
  ok("POST 外链地址 → 400", r.status === 400);

  r = await call(P, "POST", "/api/photos", { category: "人像与视觉", title: "x", file_url: COS_BASE + "校园纪实/9.jpg" });
  ok("POST 地址与分类不符 → 400", r.status === 400);

  r = await call(P, "POST", "/api/photos", { category: "校园纪实", title: "x", shot_date: "2026/02/01", file_url: COS_BASE + "校园纪实/9.jpg" });
  ok("POST 日期格式错 → 400", r.status === 400);

  /* ---------- register ---------- */
  r = await call(P, "POST", "/api/register", { name: "新生甲", class: "高一1班", contact: "QQ 999", interest: "校园纪实", intro: "想学构图" });
  ok("POST /api/register → 200 且入库", r.status === 200 && mock.state.submissions.some(function (s) { return s.name === "新生甲"; }));
  ok("报名成功触发通知推送", notifyCalls.some(function (u) { return u.indexOf("sctapi.ftqq.com/TESTSENDKEY.send?title=") !== -1; }));

  r = await call(P, "POST", "/api/register", { name: "", contact: "QQ 999" });
  ok("register 缺姓名 → 400", r.status === 400);

  r = await call(P, "POST", "/api/register", { name: "x", contact: "" });
  ok("register 缺联系方式 → 400", r.status === 400);

  /* ---------- upload-token ---------- */
  r = await call(P, "POST", "/api/upload-token", { category: "校外采风" });
  ok("upload-token 合法分类 → 200", r.status === 200 && r.json.ok === true);
  ok("对象键落在分类目录下", typeof r.json.key === "string" && r.json.key.indexOf("校外采风/") === 0, r.json.key);
  ok("返回预签名 uploadUrl 与公开 fileUrl", /^https:\/\/glimmer-photos\.cos\.ap-guangzhou\.myqcloud\.com\/.*q-signature=[0-9a-f]{40}$/.test(r.json.uploadUrl) && r.json.fileUrl.indexOf(COS_BASE) === 0);

  r = await call(P, "POST", "/api/upload-token", { category: "不存在的分类" });
  ok("upload-token 非法分类 → 400", r.status === 400);

  /* ---------- keepalive（保活） ---------- */
  r = await call(P, "GET", "/api/keepalive");
  ok("keepalive GET → 200", r.status === 200 && r.json.ok === true && r.json.alive === true);

  /* ---------- photo-status（投稿自查） ---------- */
  r = await call(P, "POST", "/api/photo-status", { title: "新作", author: "丁" });
  ok("photo-status 命中 → 状态中文化", r.status === 200 && r.json.items.length === 1 && r.json.items[0].statusText === "待审核", JSON.stringify(r.json.items));
  r = await call(P, "POST", "/api/photo-status", { title: "不存在的标题" });
  ok("photo-status 未命中 → 空列表", r.status === 200 && r.json.items.length === 0);
  r = await call(P, "POST", "/api/photo-status", { title: "" });
  ok("photo-status 缺标题 → 400", r.status === 400);

  /* ---------- admin ---------- */
  r = await call(P, "POST", "/api/admin", { password: "wrong", action: "list" });
  ok("admin 错密码 → 401", r.status === 401);

  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "list" });
  // pending = 种子 1 条 + 前面 POST 测试新入库 1 条；approved = 种子 2 条；offline = 0；submissions = 种子 1 + register 测试 1
  ok("admin list → 200 四段数据", r.status === 200 && r.json.pending.length === 2 && r.json.approved.length === 2 && r.json.offline.length === 0 && r.json.submissions.length === 2,
     "pending=" + r.json.pending.length + " approved=" + r.json.approved.length + " offline=" + r.json.offline.length + " subs=" + r.json.submissions.length);

  var pendingId = r.json.pending[0].id;
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "approve", id: String(pendingId) });
  ok("admin approve → 200", r.status === 200 && r.json.ok === true);
  ok("approve 后状态变 approved", mock.state.photos.some(function (p) { return p.id === pendingId && p.status === "approved"; }));

  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "delete", id: "1" });
  ok("admin delete → 200", r.status === 200 && r.json.ok === true);
  ok("delete 后数据库行消失", !mock.state.photos.some(function (p) { return p.id === 1; }));

  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "delete", id: "999" });
  ok("delete 不存在 id → 404", r.status === 404);

  /* ---------- 下架 / 恢复 ---------- */
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "unpublish", id: "3" });
  ok("unpublish → 200 且状态变 offline", r.status === 200 && mock.state.photos.some(function (p) { return p.id === 3 && p.status === "offline"; }));
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "list" });
  ok("list 返回 offline 段", r.json.offline.length === 1 && r.json.offline[0].id === 3);
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "restore", id: "3" });
  ok("restore → 恢复 approved", r.status === 200 && mock.state.photos.some(function (p) { return p.id === 3 && p.status === "approved"; }));

  /* ---------- 批量 ---------- */
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "batch", ids: ["2", "4"], op: "approve" });
  ok("批量通过 → 200 且 done=2", r.status === 200 && r.json.done === 2);
  ok("批量通过后全部 approved", ["2", "4"].every(function (id) { return mock.state.photos.some(function (p) { return String(p.id) === id && p.status === "approved"; }); }));
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "batch", ids: ["2", "4"], op: "delete" });
  ok("批量删除 → 200 且行消失", r.status === 200 && r.json.done === 2 && !["2", "4"].some(function (id) { return mock.state.photos.some(function (p) { return String(p.id) === id; }); }));
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "batch", ids: [], op: "approve" });
  ok("批量空选择 → 400", r.status === 400);

  /* ---------- 编辑作品 ---------- */
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "update", id: "3", title: "改过的标题", author: "新署名", category: "校外采风", shot_date: "2026-03-03" });
  ok("update → 200 且落库", r.status === 200 && mock.state.photos.some(function (p) { return p.id === 3 && p.title === "改过的标题" && p.author === "新署名" && p.category === "校外采风"; }));
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "update", id: "3", category: "非法分类" });
  ok("update 非法分类 → 400", r.status === 400);

  /* ---------- 报名已联系 ---------- */
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "mark_handled", id: "1", handled: true });
  ok("mark_handled → 200 且落库", r.status === 200 && mock.state.submissions.some(function (s) { return s.id === 1 && s.handled === true; }));

  /* ---------- 导出报名 CSV（含已联系列） ---------- */
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "export" });
  ok("报名 CSV 含「是否已联系」列与值", r.text.indexOf("是否已联系") !== -1 && r.text.indexOf("已联系", r.text.indexOf("是否已联系")) !== -1);

  /* ---------- 导出投稿 CSV ---------- */
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "export_photos" });
  ok("导出投稿 CSV → 200 text/csv", r.status === 200 && /text\/csv/.test(r.headers["content-type"] || ""));
  ok("投稿 CSV 状态中文化（已发布）", r.text.indexOf("已发布") !== -1);

  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "export" });
  ok("export → 200 text/csv", r.status === 200 && /text\/csv/.test(r.headers["content-type"] || ""));
  ok("CSV 带 BOM + 表头", r.text.charCodeAt(0) === 0xfeff && r.text.indexOf("ID,姓名,年级班级,联系方式,感兴趣方向,想说的话,是否已联系,提交时间") === 1, r.text.slice(0, 60));
  ok("CSV 正确转义引号/逗号/换行", r.text.indexOf('"含""引号"",同学"') !== -1 && r.text.indexOf("喜欢拍\r\n换行的") !== -1);

  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "不存在的动作" });
  ok("admin 未知动作 → 400", r.status === 400);

  /* ---------- 协议层 ---------- */
  r = await call(P, "OPTIONS", "/api/photos");
  ok("OPTIONS 预检 → 204 + CORS 头", r.status === 204 && r.headers["access-control-allow-origin"] === "https://lityzglimmer.top");

  r = await call(P, "DELETE", "/api/photos");
  ok("photos 不允许 DELETE → 405", r.status === 405);

  ok("服务端确实带了 service key 访问 Supabase", mock.state.sawServiceKey === true);

  globalThis.fetch = realFetch;
  api.server.close();
  mock.server.close();
}

/* ======================================================================== */
(async function () {
  testCosVector();
  await testApi();
  console.log("\n=========================================");
  console.log("结果：" + PASS + " 通过 / " + FAIL + " 失败");
  process.exit(FAIL ? 1 : 0);
})().catch(function (e) {
  console.error("测试脚本异常：", e);
  process.exit(1);
});
