"use strict";
/* ==========================================================================
   微光摄影社 · 后端接口本地测试（不依赖真实 COS / Supabase）
   用法：node _tools/api_test.js
   两部分：
     A. COS 签名向量测试 —— 用腾讯云官方文档《对象存储 请求签名》里的
        完整示例逐步验证 api/_lib/cos.js 的算法实现
     B. 接口集成测试 —— 本地 mock Supabase REST + node http 挂载真实
        handler，跑完整请求/响应断言（校验规则、401、审核/删除/导出 CSV、
        上传防护、EXIF 清洗、备份、限流/锁定/回删）
   ========================================================================== */

var assert = require("assert");
var http = require("http");
var crypto = require("crypto");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var cos = require(path.join(ROOT, "api/_lib/cos.js"));
var rl = require(path.join(ROOT, "api/_lib/ratelimit.js"));
var httpLib = require(path.join(ROOT, "api/_lib/http.js"));

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
      { id: 1, name: '含"引号",同学', class: "高二3班", contact: "QQ 12345", interest: "人像、后期", intro: "喜欢拍\n换行的", created_at: "2026-01-05T00:00:00Z" },
      /* 报名状态查询用例：一条还没联系、一条已联系 */
      { id: 2, name: "丁", class: "高一7班", contact: "QQ 88888", interest: "校园纪实", intro: "想学构图", handled: false, created_at: "2026-02-01T10:00:00Z" },
      { id: 3, name: "戊", class: "高二1班", contact: "13800138000", interest: "人像、后期", intro: "自带微单", handled: true, created_at: "2026-02-02T10:00:00Z" }
    ],
    nextPhoto: 4,
    nextSub: 4,
    sawServiceKey: false,
    rejectExifCol: false,
    /* 模拟旧库没有 handled 列：select 里含 handled 的查询一律 42703 */
    rejectHandledCol: false
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

      /* 通用行过滤：eq.X / in.(a,b,c) / gte.X（searchParams 已百分号解码） */
      function matches(row) {
        var ok = true;
        u.searchParams.forEach(function (v, k) {
          if (k === "order" || k === "select" || k === "limit") return;
          var me = /^eq\.([\s\S]*)$/.exec(v);
          if (me) { if (String(row[k]) !== me[1]) ok = false; return; }
          var mi = /^in\.\(([\s\S]*)\)$/.exec(v);
          if (mi) { if (mi[1].split(",").indexOf(String(row[k])) === -1) ok = false; return; }
          var mg = /^gte\.([\s\S]*)$/.exec(v);
          if (mg) { if (String(row[k] || "") < mg[1]) ok = false; }
          /* ilike.*关键词*：PostgREST 的包含匹配，报名查询的兜底一次用 */
          var ml = /^ilike\.([\s\S]*)$/.exec(v);
          if (ml) {
            var pat = ml[1].replace(/\*/g, "");
            if (String(row[k] || "").toLowerCase().indexOf(pat.toLowerCase()) === -1) ok = false;
          }
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
        /* 旧库没有 handled 列：select 含 handled 时报错，驱动接口降级重试 */
        if (state.rejectHandledCol && (u.searchParams.get("select") || "").indexOf("handled") !== -1) {
          state.rejectHandledCol = false;
          return send(400, { code: "42703", message: "column submissions.handled does not exist" });
        }
        var rows = table.filter(matches);
        if (u.searchParams.get("order") === "created_at.desc") {
          rows = rows.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
        }
        return send(200, rows);
      }
      if (req.method === "POST") {
        var parsed = JSON.parse(bodyText || "{}");
        if (m[1] === "photos" && state.failPhotoInsert) {
          state.failPhotoInsert = false; // 一次性：模拟一次入库失败
          return send(500, { message: "模拟入库失败" });
        }
        /* 模拟旧库没有 exif 列：带 exif 的插入一律被拒（PGRST204） */
        if (m[1] === "photos" && state.rejectExifCol && parsed.exif !== undefined) {
          state.rejectExifCol = false;
          return send(400, { code: "PGRST204", message: "Could not find the 'exif' column of 'photos' in the schema cache" });
        }
        var row = parsed;
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
    "/api/photos": require(path.join(ROOT, "api/photos.js")),
    "/api/register": require(path.join(ROOT, "api/register.js")),
    "/api/admin": require(path.join(ROOT, "api/admin.js")),
    "/api/photo-status": require(path.join(ROOT, "api/photo-status.js")),
    "/api/register-status": require(path.join(ROOT, "api/register-status.js")),
    "/api/keepalive": require(path.join(ROOT, "api/keepalive.js")),
    "/api/upload": require(path.join(ROOT, "api/upload.js")),
    "/api/backup": require(path.join(ROOT, "api/backup.js"))
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

/* 原始二进制 body 调用（图片上传通道用） */
function callRaw(port, method, path, bodyBuf, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request(
      {
        host: "127.0.0.1",
        port: port,
        path: path,
        method: method,
        headers: Object.assign(
          { "Content-Type": "application/octet-stream", Origin: "https://lityzglimmer.top" },
          headers || {},
          bodyBuf ? { "Content-Length": bodyBuf.length } : {}
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
    if (bodyBuf) req.write(bodyBuf);
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

  /* COS 删除与外网通知都走桩；记录 方法|URL 便于断言 */
  var realFetch = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    if (String(url).indexOf(process.env.SUPABASE_URL) === 0) return realFetch(url, opts);
    notifyCalls.push(String(url) + "|" + ((opts && opts.method) || "GET"));
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(""); } });
  };

  var P = api.port;
  var COS_BASE = "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/";
  var notifyCalls = [];
  process.env.NOTIFY_URL = "https://sctapi.ftqq.com/TESTSENDKEY.send";

  /* 合规的假 JPEG：SOI(FFD8FFE0) + 3KB 载荷 + EOI(FFD9) */
  function fakeJpeg() {
    return Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(3000, 0x55),
      Buffer.from([0xff, 0xd9])
    ]);
  }

  /* ---------- photos GET ---------- */
  var r = await call(P, "GET", "/api/photos");
  ok("GET /api/photos → 200", r.status === 200 && r.json.ok === true);
  ok("GET 只返回 approved", r.json.photos.length === 2 && r.json.photos.every(function (p) { return p.status === "approved"; }));
  ok("GET 按 created_at 倒序", r.json.photos[0].id === 1 && r.json.photos[1].id === 3);

  /* ---------- photos 已收敛为只读（投稿只走 /api/upload） ---------- */
  r = await call(P, "POST", "/api/photos", { category: "校园纪实", title: "x", file_url: COS_BASE + "校园纪实/9.jpg" });
  ok("photos 不再接受 POST → 405", r.status === 405);

  /* 预置一条 pending（走 /api/upload 通道，供后续 photo-status / 管理后台断言） */
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("新作") + "&author=" + encodeURIComponent("丁") + "&shot_date=" + encodeURIComponent("2026-02-01"),
    fakeJpeg());
  ok("upload 预置 pending → 200 且入库", r.status === 200 && mock.state.photos.some(function (p) { return p.title === "新作" && p.author === "丁" && p.status === "pending"; }), JSON.stringify(r.json).slice(0, 120));
  ok("投稿成功触发通知推送", notifyCalls.some(function (u) { return u.indexOf("sctapi.ftqq.com/TESTSENDKEY.send?title=") !== -1; }), notifyCalls[0]);

  /* ---------- register ---------- */
  r = await call(P, "POST", "/api/register", { name: "新生甲", class: "高一1班", contact: "QQ 999", interest: "校园纪实", intro: "想学构图" });
  ok("POST /api/register → 200 且入库", r.status === 200 && mock.state.submissions.some(function (s) { return s.name === "新生甲"; }));
  ok("报名成功触发通知推送", notifyCalls.some(function (u) { return u.indexOf("sctapi.ftqq.com/TESTSENDKEY.send?title=") !== -1; }));

  r = await call(P, "POST", "/api/register", { name: "", contact: "QQ 999" });
  ok("register 缺姓名 → 400", r.status === 400);

  r = await call(P, "POST", "/api/register", { name: "x", contact: "" });
  ok("register 缺联系方式 → 400", r.status === 400);

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
  // pending = 种子 1 条 + 前面 POST 测试新入库 1 条；approved = 种子 2 条；offline = 0
  // submissions = 种子 3 条（含"引号"同学 + 丁 + 戊，后两条是报名自查用例）+ register 测试 1 条
  ok("admin list → 200 四段数据", r.status === 200 && r.json.pending.length === 2 && r.json.approved.length === 2 && r.json.offline.length === 0 && r.json.submissions.length === 4,
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
  ok("投稿 CSV 含拍摄参数列", r.text.indexOf("拍摄参数") !== -1);

  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "export" });
  ok("export → 200 text/csv", r.status === 200 && /text\/csv/.test(r.headers["content-type"] || ""));
  ok("CSV 带 BOM + 表头", r.text.charCodeAt(0) === 0xfeff && r.text.indexOf("ID,姓名,年级班级,联系方式,感兴趣方向,想说的话,是否已联系,提交时间") === 1, r.text.slice(0, 60));
  ok("CSV 正确转义引号/逗号/换行", r.text.indexOf('"含""引号"",同学"') !== -1 && r.text.indexOf("喜欢拍\r\n换行的") !== -1);

  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "不存在的动作" });
  ok("admin 未知动作 → 400", r.status === 400);

  /* ---------- 密码防爆破：连错 5 次锁 10 分钟 ---------- */
  rl._buckets.clear();
  var lockOk = true;
  for (var li = 0; li < 5; li++) {
    var lr = await call(P, "POST", "/api/admin", { password: "wrong" + li, action: "list" });
    if (lr.status !== 401) lockOk = false;
  }
  ok("连错 5 次密码均返回 401", lockOk);
  r = await call(P, "POST", "/api/admin", { password: "wrong6", action: "list" });
  ok("第 6 次 → 429 锁定", r.status === 429 && /锁定/.test(r.json.error || ""), "status=" + r.status);
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "list" });
  ok("锁定期间正确密码也进不来", r.status === 429);
  rl._buckets.clear();
  /* 验证成功即清零：错 4 次后对一次，之后仍可再错 5 次 */
  for (var lj = 0; lj < 4; lj++) await call(P, "POST", "/api/admin", { password: "x", action: "list" });
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "list" });
  ok("错 4 次后正确密码可进（计数器已清零）", r.status === 200);
  rl._buckets.clear();

  /* ---------- 上传通道（服务端转发） ---------- */
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("服务端上传测试") + "&author=" + encodeURIComponent("测试员"),
    fakeJpeg());
  ok("upload 合法 → 200 且入库 pending", r.status === 200 && r.json.ok && mock.state.photos.some(function (p) { return p.title === "服务端上传测试" && p.status === "pending" && p.category === "校园纪实"; }), JSON.stringify(r.json).slice(0, 120));
  ok("upload 的 file_url 指向本桶", typeof r.json.fileUrl === "string" && r.json.fileUrl.indexOf(COS_BASE) === 0, r.json.fileUrl);

  r = await callRaw(P, "POST", "/api/upload?category=" + encodeURIComponent("乱分类") + "&title=x", Buffer.from([1, 2, 3]));
  ok("upload 非法分类 → 400", r.status === 400);

  r = await callRaw(P, "POST", "/api/upload?category=" + encodeURIComponent("校园纪实"), Buffer.from([1, 2, 3]));
  ok("upload 缺标题 → 400", r.status === 400);

  r = await callRaw(P, "POST", "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("空body"), null);
  ok("upload 空 body → 400", r.status === 400);

  /* ---------- EXIF 拍摄参数：合法字段入库，非法/超长字段剥掉 ---------- */
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("人像与视觉") + "&title=" + encodeURIComponent("带参数的作品") +
    "&author=" + encodeURIComponent("测试员") + "&shot_date=" + encodeURIComponent("2026-04-01") +
    "&exif=" + encodeURIComponent(JSON.stringify({
      camera: "NIKON ZR", lens: "NIKKOR Z 24-120mm f/4 S",
      aperture: "f/4", shutter: "1/50s", iso: "ISO 450", focal: "51mm", shotAt: "2026-04-01",
      evil: "<script>alert(1)</script>"
    })),
    fakeJpeg());
  ok("upload 带 EXIF → 200 且参数入库", r.status === 200 && mock.state.photos.some(function (p) {
    return p.title === "带参数的作品" && p.exif && p.exif.camera === "NIKON ZR" &&
      p.exif.aperture === "f/4" && p.exif.shutter === "1/50s" && p.exif.iso === "ISO 450" && p.exif.focal === "51mm";
  }), JSON.stringify(r.json).slice(0, 160));
  ok("upload EXIF 白名单外字段不入库", mock.state.photos.some(function (p) {
    return p.title === "带参数的作品" && p.exif && !("evil" in p.exif);
  }));

  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("人像与视觉") + "&title=" + encodeURIComponent("脏参数作品") +
    "&exif=" + encodeURIComponent(JSON.stringify({
      camera: "x".repeat(100), aperture: "不是光圈", shutter: "1/250s", iso: "ISO-abc"
    })),
    fakeJpeg());
  ok("upload EXIF 超长/非法格式字段被丢弃", mock.state.photos.some(function (p) {
    return p.title === "脏参数作品" && p.exif && !p.exif.camera && !p.exif.aperture && !p.exif.iso && p.exif.shutter === "1/250s";
  }), JSON.stringify(r.json).slice(0, 160));

  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("人像与视觉") + "&title=" + encodeURIComponent("坏JSON作品") +
    "&exif=" + encodeURIComponent("{这不是合法JSON"),
    fakeJpeg());
  ok("upload EXIF 不是合法 JSON → 不影响投稿", r.status === 200 && mock.state.photos.some(function (p) {
    return p.title === "坏JSON作品" && !p.exif;
  }), "status=" + r.status);

  /* 旧库尚未加 exif 列：服务端自动去掉该字段重试，投稿不失败 */
  mock.state.rejectExifCol = true;
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("旧库无列作品") +
    "&exif=" + encodeURIComponent(JSON.stringify({ camera: "NIKON ZR", aperture: "f/4" })),
    fakeJpeg());
  ok("旧库缺 exif 列 → 去掉该字段重试，投稿仍成功", r.status === 200 && mock.state.photos.some(function (p) {
    return p.title === "旧库无列作品" && !("exif" in p) && p.status === "pending";
  }), "status=" + r.status + " " + JSON.stringify(r.json).slice(0, 120));

  /* ---------- 上传防护 ---------- */
  /* 魔数校验：非 JPEG 载荷拒绝 */
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("伪装文件"),
    Buffer.from("这不是图片，是一段伪装成图片的文本内容，长度足够超过 2KB " + "x".repeat(3000)));
  ok("upload 非 JPEG 魔数 → 400", r.status === 400 && /JPG/.test(r.json.error || ""), JSON.stringify(r.json));

  /* ---------- 来源白名单（2026-10-25 放宽：http/端口/多级 vercel.app/localhost/null 放行） ---------- */
  ok("白名单：站点 https 主域放行", httpLib.originAllowedValue("https://lityzglimmer.top") === true);
  ok("白名单：站点 www 子域放行", httpLib.originAllowedValue("https://www.lityzglimmer.top") === true);
  ok("白名单：站点 http 放行（用户实测被误拦的场景）", httpLib.originAllowedValue("http://www.lityzglimmer.top") === true);
  ok("白名单：站点带端口放行", httpLib.originAllowedValue("https://lityzglimmer.top:8443") === true);
  ok("白名单：多级子域放行", httpLib.originAllowedValue("https://foo.bar.lityzglimmer.top") === true);
  ok("白名单：单级 vercel.app 放行", httpLib.originAllowedValue("https://glimmer-abc123.vercel.app") === true);
  ok("白名单：多级 vercel.app 放行", httpLib.originAllowedValue("https://foo.bar.vercel.app") === true);
  ok("白名单：localhost 放行", httpLib.originAllowedValue("http://localhost:8848") === true);
  ok("白名单：127.0.0.1 放行", httpLib.originAllowedValue("http://127.0.0.1:3000") === true);
  ok("白名单：Origin: null 放行（沙箱 iframe 等不透明来源）", httpLib.originAllowedValue("null") === true);
  ok("白名单：无 Origin 放行（非浏览器客户端）", httpLib.originAllowedValue(undefined) === true);
  ok("白名单：外部 https 域拦截", httpLib.originAllowedValue("https://evil.example.com") === false);
  ok("白名单：外部 http 域拦截", httpLib.originAllowedValue("http://evil.example.com") === false);
  ok("白名单：仿冒后缀域拦截", httpLib.originAllowedValue("https://lityzglimmer.top.evil.com") === false);
  /* v2.0.9：网络侧代理/安全软件会往 Origin 头里塞不可见字符（用户手机 5G 实测被误拦），
     全角标点先规范化成 ASCII、其余非可见字符剥掉，之后按正常域名放行 */
  ok("白名单：尾部空格剥除后放行", httpLib.originAllowedValue("https://www.lityzglimmer.top ") === true);
  ok("白名单：首部空格剥除后放行", httpLib.originAllowedValue(" https://www.lityzglimmer.top") === true);
  ok("白名单：尾部换行剥除后放行", httpLib.originAllowedValue("https://www.lityzglimmer.top\n") === true);
  ok("白名单：零宽字符剥除后放行", httpLib.originAllowedValue("https://www.lityzglimmer.top\u200b") === true);
  ok("白名单：全角冒号规范化为 ASCII 后放行", httpLib.originAllowedValue("https：//www.lityzglimmer.top") === true);
  ok("白名单：全角冒号端口规范化后放行", httpLib.originAllowedValue("https://www.lityzglimmer.top：443") === true);
  ok("白名单：中文句号规范化后放行", httpLib.originAllowedValue("https://www.lityzglimmer。top") === true);
  ok("白名单：协议头被剥乱仍按结尾放行", httpLib.originAllowedValue("https//www.lityzglimmer.top") === true);
  ok("白名单：大小写混合放行", httpLib.originAllowedValue("HTTPS://WWW.LityzGlimmer.TOP") === true);
  ok("白名单：全角标点的外部站照拦", httpLib.originAllowedValue("https：//evil。com") === false);

  /* 来源检查：明确的外部 Origin 拒绝，且报错带回收到的来源便于截图定位 */
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("跨站测试"),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]),
    { Origin: "https://evil.example.com" });
  ok("upload 恶意 Origin → 403 且报错带回来源", r.status === 403 && /evil\.example\.com/.test(r.json.error || ""), JSON.stringify(r.json));

  /* 被拦时报错把不可见字符以 ·hex· 标出，用户截图即可定位（v2.0.9） */
  var roReq = { headers: { origin: "https://evil.example.com\u200b" } };
  var roRes = {
    statusCode: 0, headers: {},
    setHeader: function (k, v) { this.headers[k] = v; },
    end: function (s) { this._body = s; }
  };
  httpLib.rejectOrigin(roReq, roRes);
  var roJson = JSON.parse(roRes._body);
  ok("rejectOrigin 把零宽字符标为 ·200b·", roRes.statusCode === 403 && roJson.error.indexOf("·200b·") !== -1, roJson.error);

  /* 放宽后端到端验证：http 来源的真实投稿不再被 403 挡下 */
  rl._buckets.clear();
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("http来源投稿") +
    "&author=" + encodeURIComponent("测试员"),
    fakeJpeg(), { Origin: "http://www.lityzglimmer.top" });
  ok("upload Origin: http://www.lityzglimmer.top → 放行入库", r.status === 200 && r.json.ok, "status=" + r.status + " " + JSON.stringify(r.json).slice(0, 120));
  rl._buckets.clear();

  /* 频率限制：单 IP 10 分钟 15 次，第 16 次 429 */
  rl._buckets.clear();
  var jpeg = fakeJpeg();
  var rateOk = true;
  for (var n = 0; n < 15; n++) {
    var rr = await callRaw(P, "POST",
      "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("限流测试" + n),
      jpeg);
    if (rr.status !== 200) { rateOk = false; break; }
  }
  ok("前 15 次上传全部放行", rateOk);
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("限流测试越界"),
    jpeg);
  ok("第 16 次上传 → 429 限流", r.status === 429 && /频繁|繁忙/.test(r.json.error || ""), "status=" + r.status + " " + JSON.stringify(r.json));
  rl._buckets.clear();

  /* ---------- 孤儿图回删：COS 写入成功但入库失败 ---------- */
  var photosBefore = mock.state.photos.length;
  mock.state.failPhotoInsert = true;
  rl._buckets.clear();
  notifyCalls.length = 0;
  r = await callRaw(P, "POST",
    "/api/upload?category=" + encodeURIComponent("校园纪实") + "&title=" + encodeURIComponent("入库失败回滚"),
    fakeJpeg());
  ok("入库失败 → 500 且不入库", r.status === 500 && mock.state.photos.length === photosBefore, "status=" + r.status);
  ok("已回删 COS 文件（DELETE 签名请求在案）", notifyCalls.some(function (u) { return u.indexOf("https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/") === 0 && u.indexOf("|DELETE") !== -1; }), notifyCalls.join(" ; ").slice(0, 200));
  ok("接口异常推送已触发", notifyCalls.some(function (u) { return u.indexOf("sctapi.ftqq.com/TESTSENDKEY.send?title=") !== -1 && u.indexOf("|GET") !== -1; }), notifyCalls.join(" ; ").slice(0, 200));
  rl._buckets.clear();

  /* ---------- 备份：CSV 写 COS _backup/ ---------- */
  rl._buckets.clear();
  notifyCalls.length = 0;
  r = await call(P, "POST", "/api/admin", { password: "glimmer2026", action: "backup" });
  ok("admin backup → 200 且返回 stamp/计数", r.status === 200 && r.json.ok && r.json.backup && /^\d{4}-\d{2}$/.test(r.json.backup.stamp || "") && typeof r.json.backup.photos === "number", JSON.stringify(r.json).slice(0, 160));
  ok("备份 CSV 已写 COS _backup/（PUT 签名请求在案）", notifyCalls.some(function (u) {
    return u.indexOf("https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/_backup/") === 0 && u.indexOf("|PUT") !== -1;
  }), notifyCalls.join(" ; ").slice(0, 240));
  ok("备份完成推送通知", notifyCalls.some(function (u) {
    return u.indexOf("sctapi.ftqq.com/TESTSENDKEY.send?title=") !== -1 && u.indexOf("|GET") !== -1;
  }), notifyCalls.join(" ; ").slice(0, 240));

  /* ---------- cron 备份通道（可选 CRON_SECRET 鉴权） ---------- */
  delete process.env.CRON_SECRET;
  r = await call(P, "GET", "/api/backup");
  ok("GET /api/backup 无 CRON_SECRET → 200", r.status === 200 && r.json.ok && r.json.backup, "status=" + r.status);

  process.env.CRON_SECRET = "cron-secret-123";
  r = await call(P, "GET", "/api/backup");
  ok("配了 CRON_SECRET 但缺 Authorization → 401", r.status === 401, "status=" + r.status);
  r = await call(P, "GET", "/api/backup", null, { Authorization: "Bearer wrong-secret" });
  ok("Bearer 不对 → 401", r.status === 401, "status=" + r.status);
  r = await call(P, "GET", "/api/backup", null, { Authorization: "Bearer cron-secret-123" });
  ok("Bearer 正确 → 200", r.status === 200 && r.json.ok && r.json.backup, "status=" + r.status);
  delete process.env.CRON_SECRET;

  /* ---------- 报名状态自查（只回状态，不回任何个人信息） ---------- */
  rl._buckets.clear();
  r = await call(P, "POST", "/api/register-status", { name: "丁", contact: "QQ 88888" });
  ok("报名自查：还没被联系 → 待联系", r.status === 200 && r.json.ok && r.json.found === true && r.json.status === "待联系", JSON.stringify(r.json));
  ok("报名自查：不回联系方式等个人信息", r.json.contact === undefined && r.json.intro === undefined && r.json.class === undefined, JSON.stringify(r.json));

  r = await call(P, "POST", "/api/register-status", { name: "戊", contact: "13800138000" });
  ok("报名自查：已被联系 → 已联系", r.status === 200 && r.json.found === true && r.json.status === "已联系", JSON.stringify(r.json));

  r = await call(P, "POST", "/api/register-status", { name: "丁", contact: "88888" });
  ok("报名自查：联系方式记不全也能含糊命中", r.status === 200 && r.json.found === true, JSON.stringify(r.json));

  r = await call(P, "POST", "/api/register-status", { name: "查无此人", contact: "00000" });
  ok("报名自查：查无记录 → found=false", r.status === 200 && r.json.ok && r.json.found === false, JSON.stringify(r.json));

  r = await call(P, "POST", "/api/register-status", { name: "丁", contact: "13800138000" });
  ok("报名自查：姓名与联系方式不属同一人 → 查不到", r.status === 200 && r.json.found === false, JSON.stringify(r.json));

  r = await call(P, "POST", "/api/register-status", { name: "丁" });
  ok("报名自查：缺联系方式 → 400", r.status === 400 && !r.json.ok, "status=" + r.status);

  r = await call(P, "POST", "/api/register-status", { contact: "QQ 88888" });
  ok("报名自查：缺姓名 → 400", r.status === 400 && !r.json.ok, "status=" + r.status);

  /* 旧库没有 handled 列：不判断已联系/待联系，只说「已收到报名」，不能报错 */
  mock.state.rejectHandledCol = true;
  r = await call(P, "POST", "/api/register-status", { name: "丁", contact: "QQ 88888" });
  ok("报名自查：旧库无 handled 列 → 降级为「已收到报名」", r.status === 200 && r.json.found === true && r.json.status === "已收到报名", JSON.stringify(r.json));

  /* 限流：10 次/10 分钟，第 11 次挡下（上面已用掉 8 次配额） */
  await call(P, "POST", "/api/register-status", { name: "丁", contact: "QQ 88888" });
  await call(P, "POST", "/api/register-status", { name: "丁", contact: "QQ 88888" });
  r = await call(P, "POST", "/api/register-status", { name: "丁", contact: "QQ 88888" });
  ok("报名自查：第 11 次 → 429 限流", r.status === 429, "status=" + r.status);
  rl._buckets.clear();

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
