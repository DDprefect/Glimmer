"use strict";
/* ==========================================================================
   微光摄影社 · 页面级冒烟测试（jsdom）
   用法：
     NODE_PATH=C:/Users/兜/.workbuddy/binaries/node/workspace/node_modules \
     node _tools/page_test.js
   覆盖：
     index/gallery  静态作品渲染 + gallery 合并数据库 approved 作品 + 计数
                    + 数据万象缩图地址 + 灯箱 EXIF 拍摄信息
     join           报名提交字段映射 + 成功态 + 接口失败回退文本
     upload         表单校验 + 接口链路（压缩 → api/upload 服务端转发）
     admin          登录 401 / 进后台 / 审核 / 删除 / 导出 / 选项卡 / 备份按钮
   ========================================================================== */

var path = require("path");
var fs = require("fs");
var { JSDOM, VirtualConsole, requestInterceptor } = require("jsdom");

var ROOT = path.join(__dirname, "..");

/* 本地资源拦截器：页面跑在 https://lityzglimmer.top 源下（与生产一致，
   sessionStorage / isSecureContext 等行为才真实），脚本与样式映射到本地文件，
   其它外链（Google Fonts 等）返回空响应，不打网络。 */
var localInterceptor = requestInterceptor(async function (request) {
  var m = /^https:\/\/lityzglimmer\.top\/(.*)$/.exec(request.url);
  if (!m) return new Response("", { status: 200, headers: { "Content-Type": "text/plain" } });
  var local = path.join(ROOT, decodeURIComponent(m[1])).replace(/\\/g, "/");
  var ext = path.extname(local).toLowerCase();
  var type = ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
  try {
    return new Response(fs.readFileSync(local), { headers: { "Content-Type": type } });
  } catch (e) {
    return new Response("", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
});
var PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log("  ✓ " + name); }
  else { FAIL++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

function loadPage(file, beforeParse) {
  /* 支持 "gallery.html#photo-101" 这类带 hash 的文件参数 */
  var hash = "";
  var hi = file.indexOf("#");
  if (hi !== -1) {
    hash = file.slice(hi);
    file = file.slice(0, hi);
  }
  var html = fs.readFileSync(path.join(ROOT, file), "utf8");
  var vc = new VirtualConsole(); // 吞掉 jsdom 的 canvas not implemented 等噪音
  vc.on("jsdomError", function (e) {
    var d = e.detail || e;
    console.log("    [jsdomError] " + (d && d.message ? d.message : d));
  });
  var dom = new JSDOM(html, {
    url: "https://lityzglimmer.top/" + file + hash, // 与生产同源，存储/安全上下文行为真实
    runScripts: "dangerously",
    resources: { interceptors: [localInterceptor] },
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse: beforeParse || function (window) { baseStubs(window); }
  });
  /* 确定性等待：轮询到站点脚本启动完成（.nav 注入即 boot 完成），
     不依赖 load 事件（外链字体资源会让 jsdom 的 load 时快时慢） */
  return new Promise(function (resolve) {
    var t0 = Date.now();
    (function poll() {
      var nav = dom.window.document.querySelector(".nav");
      if (nav || Date.now() - t0 > 5000) {
        setTimeout(function () { resolve(dom); }, 120);
      } else {
        setTimeout(poll, 20);
      }
    })();
  });
}

/* 公共打桩： IntersectionObserver / matchMedia / scrollIntoView */
function baseStubs(window) {
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = function () {
      return { observe: function () {}, unobserve: function () {}, disconnect: function () {} };
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = function () {
      return { matches: false, addListener: function () {}, removeListener: function () {},
               addEventListener: function () {}, removeEventListener: function () {} };
    };
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = function () {};
  }
}

var DB_PHOTOS = [
  { id: 101, category: "校园纪实", title: "数据库新作·喊楼", author: "测试同学", shot_date: "2026-02-02",
    exif: { camera: "NIKON ZR", lens: "NIKKOR Z 24-120mm f/4 S", aperture: "f/4", shutter: "1/50s", iso: "ISO 450", focal: "51mm" },
    file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/校园纪实/101.jpg", status: "approved", created_at: "2026-02-03T00:00:00Z" },
  { id: 102, category: "人像与视觉", title: "数据库新作·人像", author: "", shot_date: null,
    file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/人像与视觉/102.jpg", status: "approved", created_at: "2026-02-04T00:00:00Z" }
];

/* ======================================================================== */
async function testGallery() {
  console.log("\n[gallery] 静态 + 数据库合并");
  var calls = [];
  var dom = await loadPage("gallery.html", function (window) {
    baseStubs(window);
    window.fetch = function (url) {
      calls.push(url);
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, photos: DB_PHOTOS }); } });
    };
  });
  var d = dom.window.document;

  ok("请求了 api/photos", calls.indexOf("api/photos") !== -1);
  var cards = d.querySelectorAll("#works-grid .work");
  // 注意 gallery 是 15 张/页的分步加载，首页只渲染前 15 张
  ok("网格首屏 15 张（分页加载）", cards.length === 15, String(cards.length));
  ok("数据库作品排在最前（2 张 data-autorate）", d.querySelectorAll('#works-grid img[data-autorate="1"]').length === 2);
  ok("数据库卡片 src 指向 COS", Array.prototype.some.call(d.querySelectorAll("#works-grid img"), function (im) { return /myqcloud/.test(im.getAttribute("src")); }));
  ok("数据库卡片加载缩图（数据万象 880px）", Array.prototype.some.call(d.querySelectorAll("#works-grid img"), function (im) { return /imageMogr2\/thumbnail\/880x/.test(im.getAttribute("src")); }), Array.prototype.map.call(d.querySelectorAll("#works-grid img"), function (im) { return im.getAttribute("src"); }).join(" | ").slice(0, 200));
  ok("「本期展出」计数 = 76", d.querySelector("[data-count-works]").textContent === "76", d.querySelector("[data-count-works]").textContent);
  var campusBtn = Array.prototype.filter.call(d.querySelectorAll(".filter"), function (b) { return b.getAttribute("data-cat") === "campus"; })[0];
  ok("校园纪实筛选计数含数据库作品（27+1=28）", campusBtn.querySelector("b").textContent === "28", campusBtn.textContent);
  var portraitBtn = Array.prototype.filter.call(d.querySelectorAll(".filter"), function (b) { return b.getAttribute("data-cat") === "portrait"; })[0];
  ok("人像与视觉筛选计数含数据库作品", parseInt(portraitBtn.querySelector("b").textContent, 10) > 0, portraitBtn.textContent);
  ok("投稿入口已加入 gallery", !!d.querySelector('a[href="upload.html"]'));

  /* 接口失败降级 */
  var dom2 = await loadPage("gallery.html", function (window) {
    baseStubs(window);
    window.fetch = function () { return Promise.reject(new Error("network")); };
  });
  var cards2 = dom2.window.document.querySelectorAll("#works-grid .work");
  ok("接口失败时仍渲染静态作品首屏 15 张（不白屏）", cards2.length === 15, String(cards2.length));
  ok("接口失败时无 data-autorate 卡片", dom2.window.document.querySelectorAll('#works-grid img[data-autorate="1"]').length === 0);

  /* 深链：#photo-101 → 定位数据库作品并开灯箱 */
  var dom3 = await loadPage("gallery.html#photo-101", function (window) {
    baseStubs(window);
    window.fetch = function (url) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, photos: DB_PHOTOS }); } });
    };
  });
  await new Promise(function (r) { setTimeout(r, 350); }); // 等接口回来 + 深链应用 + 灯箱打开
  var lb = dom3.window.document.querySelector(".lb.is-open");
  ok("深链 #photo-101 → 灯箱打开且是数据库作品", !!lb && /myqcloud\.com/.test((lb.querySelector("img") || {}).getAttribute ? lb.querySelector("img").getAttribute("src") || "" : ""), lb ? "opened" : "not opened");
  var exifLine = lb ? (lb.querySelector(".lb__exif") || {}).textContent || "" : "";
  ok("灯箱展示 EXIF 拍摄参数", /NIKON ZR/.test(exifLine) && /f\/4/.test(exifLine) && /1\/50s/.test(exifLine) && /ISO 450/.test(exifLine) && /51mm/.test(exifLine), exifLine);
  ok("灯箱拍摄信息含拍摄日期", /2026-02-02/.test(exifLine), exifLine);
  ok("灯箱加载原图（非缩图）", !!lb && !/imageMogr2/.test(lb.querySelector("img").getAttribute("src") || ""), lb ? lb.querySelector("img").getAttribute("src") : "");
  dom.window.close(); dom2.window.close(); dom3.window.close();
}

/* ======================================================================== */
async function testIndex() {
  console.log("\n[index] 首页无回归");
  var dom = await loadPage("index.html", function (window) {
    baseStubs(window);
    window.fetch = function (url) {
      if (url === "api/photos") {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, photos: DB_PHOTOS }); } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, photos: [] }); } });
    };
  });
  var d = dom.window.document;
  ok("首页导航已注入", !!d.querySelector(".nav"));
  ok("首页页脚已注入", !!d.querySelector(".foot"));
  var works = d.querySelectorAll(".work");
  ok("首页精选区有作品卡片", works.length > 0, String(works.length));
  ok("最新收录区块显示", !d.getElementById("latest").hidden);
  ok("最新收录渲染 2 张卡", d.querySelectorAll("#latest-strip .latest-card").length === 2);
  ok("最新收录加载缩图（640px）", /imageMogr2\/thumbnail\/640x/.test(d.querySelector("#latest-strip img").getAttribute("src")), d.querySelector("#latest-strip img").getAttribute("src"));
  ok("卡片链到作品深链", d.querySelector("#latest-strip .latest-card").getAttribute("href") === "gallery.html#photo-101");

  /* 接口失败 → 区块保持隐藏，不挡首页 */
  var dom2 = await loadPage("index.html", function (window) {
    baseStubs(window);
    window.fetch = function () { return Promise.reject(new Error("network")); };
  });
  ok("接口失败时最新收录保持隐藏", dom2.window.document.getElementById("latest").hidden);
  dom.window.close(); dom2.window.close();
}

/* ======================================================================== */
async function testJoin() {
  console.log("\n[join] 报名提交");

  /* 场景 1：接口正常 → 入库成功态 */
  var payload = null;
  var dom = await loadPage("join.html", function (window) {
    baseStubs(window);
    window.fetch = function (url, opts) {
      if (url === "api/register") {
        payload = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, photos: [] }); } });
    };
  });
  var d = dom.window.document;
  d.getElementById("f-name").value = "小雨";
  d.getElementById("f-class").value = "高一 5 班";
  d.getElementById("f-contact").value = "QQ 123456";
  d.getElementById("f-equip").value = "手机";
  d.getElementById("f-msg").value = "喜欢拍晚霞";
  d.querySelector('input[name="dir"][value="人像"]').checked = true;
  d.querySelector('input[name="dir"][value="后期"]').checked = true;
  d.getElementById("join-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 80); });

  ok("POST 了 api/register", payload !== null);
  ok("字段映射：name/class/contact 正确", payload && payload.name === "小雨" && payload["class"] === "高一 5 班" && payload.contact === "QQ 123456");
  ok("字段映射：多选 interest 合并", payload && payload.interest === "人像、后期", payload && payload.interest);
  ok("字段映射：设备与想说的话进 intro", payload && /拍摄设备：手机/.test(payload.intro) && /晚霞/.test(payload.intro), payload && payload.intro);
  ok("成功后显示报名成功卡", !d.getElementById("join-ok").hidden);
  ok("表单项已隐藏", d.getElementById("f-name").closest(".field").style.display === "none");

  /* 场景 2：接口失败 → 回退生成文本 */
  var dom2 = await loadPage("join.html", function (window) {
    baseStubs(window);
    window.fetch = function () { return Promise.reject(new Error("network")); };
  });
  var d2 = dom2.window.document;
  d2.getElementById("f-name").value = "离线同学";
  d2.getElementById("f-contact").value = "微信 xx";
  d2.getElementById("join-form").dispatchEvent(new dom2.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("接口失败时回退文本生成", !d2.getElementById("join-result").hidden && /离线同学/.test(d2.getElementById("f-out").value));
  ok("回退提示已显示", /网络不稳定/.test(d2.getElementById("copy-tip").textContent));
  ok("STEP 02 文案已改为提交到报名库", /提交到报名库/.test(d2.body.textContent));
  dom.window.close(); dom2.window.close();
}

/* ======================================================================== */
async function testUpload() {
  console.log("\n[upload] 投稿页");
  var dom = await loadPage("upload.html");
  var d = dom.window.document;
  ok("分类四值齐全", d.querySelectorAll("#f-cat option").length === 5); // 含占位
  ok("表单关键字段在位", !!d.getElementById("f-title") && !!d.getElementById("f-file"));
  ok("原创确认勾选在位", !!d.getElementById("f-orig"));
  ok("投稿进度查询区块在位", !!d.getElementById("q-btn") && !!d.getElementById("q-title"));
  ok("noindex 已设置", (d.querySelector('meta[name="robots"]') || {}).content === "noindex");

  /* 缺文件 → 校验提示，不发请求 */
  var reqs = [];
  dom.window.fetch = function (url, opts) {
    reqs.push(url);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
  };
  d.getElementById("f-cat").value = "校园纪实";
  d.getElementById("f-title").value = "测试投稿";
  d.getElementById("upload-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 50); });
  ok("未勾选原创确认 → 提示且不发请求", reqs.length === 0 && /原创/.test(d.getElementById("up-msg").textContent), d.getElementById("up-msg").textContent);

  /* 蜜罐被填 → 静默丢弃（机器人路径） */
  reqs.length = 0;
  d.getElementById("f-web").value = "http://spam.example.com";
  d.getElementById("f-orig").checked = true;
  d.getElementById("upload-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 50); });
  ok("蜜罐被填 → 静默丢弃不发请求", reqs.length === 0);
  d.getElementById("f-web").value = "";

  /* 勾选但未选图 → 图片提示 */
  d.getElementById("f-orig").checked = true;
  d.getElementById("upload-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 50); });
  ok("未选图时给出提示且不发请求", reqs.length === 0 && /选择要上传的图片/.test(d.getElementById("up-msg").textContent));

  /* 状态查询交互 */
  dom.window.fetch = function (url, opts) {
    reqs.push(url);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, items: [{ title: "测试投稿", category: "校园纪实", status: "approved", statusText: "已发布", file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/校园纪实/x.jpg", created_at: "2026-02-01T00:00:00Z" }] }); } });
  };
  d.getElementById("q-title").value = "测试投稿";
  d.getElementById("q-btn").click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("进度查询 → 请求 photo-status 且渲染结果", reqs.some(function (u) { return u === "api/photo-status"; }) && /已发布/.test(d.getElementById("q-result").textContent), d.getElementById("q-result").textContent);

  /* 接口链路（压缩步骤在 jsdom 无 canvas 会 graceful 失败，验证不死页） */
  var fakeFile = new dom.window.File([new Uint8Array([1, 2, 3])], "t.jpg", { type: "image/jpeg" });
  Object.defineProperty(d.getElementById("f-file"), "files", { value: [fakeFile], configurable: true });
  d.getElementById("upload-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 150); });
  ok("canvas 缺失时优雅报错（不白屏）", !d.getElementById("up-msg").hidden && d.getElementById("upload-btn").disabled === false,
     d.getElementById("up-msg").textContent);
  dom.window.close();
}

/* ======================================================================== */
async function testAdmin() {
  console.log("\n[admin] 管理后台");

  var lastBody = null;
  var callLog = [];
  var mode = "ok";
  var dom = await loadPage("admin.html", function (window) {
    baseStubs(window);
    window.fetch = function (url, opts) {
      var b = opts && opts.body ? JSON.parse(opts.body) : null;
      lastBody = b;
      callLog.push(b);
      if (mode === "401") {
        return Promise.resolve({ ok: false, status: 401, json: function () { return Promise.resolve({ ok: false, error: "密码不正确" }); } });
      }
      if (mode === "csv") {
        return Promise.resolve({ ok: true, status: 200, blob: function () { return Promise.resolve({}); } });
      }
      if (b && b.action === "backup") {
        return Promise.resolve({
          ok: true, status: 200,
          json: function () {
            return Promise.resolve({
              ok: true,
              backup: { stamp: "2026-10", photos: 3, subs: 1, photosUrl: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/_backup/2026-10/photos-2026-10.csv", subsUrl: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/_backup/2026-10/submissions-2026-10.csv" }
            });
          }
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: function () {
          return Promise.resolve({
            ok: true,
            pending: [{ id: 7, category: "校园纪实", title: "待审作品", author: "同学甲", shot_date: "2026-02-01", file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/校园纪实/7.jpg", status: "pending", created_at: "2026-02-02T00:00:00Z" }],
            approved: [{ id: 8, category: "城市与远方", title: "已发作品", author: "同学乙", shot_date: null, file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/城市与远方/8.jpg", status: "approved", created_at: "2026-02-01T00:00:00Z" }],
            offline: [{ id: 9, category: "人像与视觉", title: "下架作品", author: "同学丙", shot_date: null, file_url: "https://glimmer-photos.cos.ap-guangzhou.myqcloud.com/人像与视觉/9.jpg", status: "offline", created_at: "2026-01-31T00:00:00Z" }],
            submissions: [{ id: 1, name: "报名人", class: "高一1班", contact: "QQ 1", interest: "人像", intro: "嗨", handled: false, created_at: "2026-02-01T00:00:00Z" }]
          });
        }
      });
    };
  });
  var d = dom.window.document;

  /* 401 场景 */
  mode = "401";
  d.getElementById("f-pw").value = "错密码";
  d.getElementById("admin-login-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 60); });
  ok("错密码 → 401 提示，面板不显示", /密码不正确/.test(d.getElementById("login-msg").textContent) && d.getElementById("panel").hidden);

  /* 正确密码进后台 */
  mode = "ok";
  d.getElementById("f-pw").value = "glimmer2026";
  d.getElementById("admin-login-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("登录后面板显示", !d.getElementById("panel").hidden);
  ok("密码存入了 sessionStorage", dom.window.sessionStorage.getItem("glimmer_admin_pw") === "glimmer2026");
  ok("统计数字渲染（1/1/1/1）", d.getElementById("st-pending").textContent === "1" && d.getElementById("st-approved").textContent === "1" && d.getElementById("st-offline").textContent === "1" && d.getElementById("st-subs").textContent === "1");
  ok("待审核卡片渲染", /待审作品/.test(d.getElementById("pane-pending").textContent));

  /* 缩略图点击放大（宽版浮层，加载原图） */
  var thumb = d.querySelector("#pane-pending .admin-item__img");
  ok("后台缩略图走缩图（400px）且 data-full 存原图", /imageMogr2\/thumbnail\/400x/.test(thumb.getAttribute("src")) && /myqcloud\.com\/校园纪实\/7\.jpg$/.test(thumb.getAttribute("data-full") || ""), thumb.getAttribute("src"));
  thumb.click();
  var zoomEl = d.querySelector(".zoom");
  ok("点缩略图 → 宽版放大浮层打开（用原图）", zoomEl && zoomEl.classList.contains("is-open") && zoomEl.classList.contains("zoom--wide") && zoomEl.querySelector("img").getAttribute("src") === thumb.getAttribute("data-full"), zoomEl ? zoomEl.className : "no zoom");
  /* 关掉浮层，避免遮挡后续交互 */
  zoomEl.classList.remove("is-open");

  ok("已发布卡片含下架/编辑钮", !!d.querySelector('#pane-approved button[data-act="unpublish"]') && !!d.querySelector('#pane-approved button[data-act="edit"]'));
  ok("已下架卡片含恢复钮", !!d.querySelector('#pane-offline button[data-act="restore"]'));

  /* 批量通过 */
  callLog.length = 0;
  var cb = d.querySelector("#pane-pending .batch-cb");
  cb.checked = true;
  cb.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  ok("勾选后计数更新", d.getElementById("batch-n").textContent === "已选 1 项", d.getElementById("batch-n").textContent);
  d.getElementById("batch-approve").click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("批量通过 → 请求 batch 动作", callLog.some(function (b) { return b && b.action === "batch" && b.op === "approve" && b.ids && b.ids.length === 1; }), JSON.stringify(callLog));

  /* 内联编辑 */
  callLog.length = 0;
  var editBtn = d.querySelector('#pane-approved button[data-act="edit"]');
  editBtn.click();
  var editCard = editBtn.closest(".admin-item");
  ok("点编辑 → 卡片进入编辑态", editCard.classList.contains("is-editing"));
  var editForm = editCard.querySelector(".admin-edit");
  editForm.querySelector('[name="title"]').value = "改后的标题";
  editForm.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("编辑表单提交 → 请求 update 动作", callLog.some(function (b) { return b && b.action === "update" && b.title === "改后的标题"; }), JSON.stringify(callLog));

  /* 下架 */
  callLog.length = 0;
  d.querySelector('#pane-approved button[data-act="unpublish"]').click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("点下架 → 请求 unpublish 动作", callLog.some(function (b) { return b && b.action === "unpublish"; }), JSON.stringify(callLog));

  /* 审核通过 */
  var approveBtn = d.querySelector('#pane-pending button[data-act="approve"]');
  callLog.length = 0;
  approveBtn.click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("点击通过 → 请求 approve 动作", callLog.some(function (b) { return b && b.action === "approve" && String(b.id) === "7"; }), JSON.stringify(callLog));

  /* 删除（confirm 打桩） */
  dom.window.confirm = function () { return true; };
  var delBtn = d.querySelector('#pane-pending button[data-act="remove"]');
  callLog.length = 0;
  delBtn.click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("点击删除 → 请求 delete 动作", callLog.some(function (b) { return b && b.action === "delete" && String(b.id) === "7"; }), JSON.stringify(callLog));

  /* 选项卡切换 */
  var subsTab = d.querySelector('.admin-tab[data-tab="subs"]');
  subsTab.click();
  ok("报名选项卡可见且含导出按钮", d.getElementById("pane-subs").classList.contains("is-on") && !!d.getElementById("export-csv"));
  ok("报名表格渲染", /报名人/.test(d.getElementById("subs-table").textContent));

  /* 报名筛选 + 已联系切换 */
  d.querySelector('.admin-filter[data-f="yes"]').click();
  ok("筛选「已联系」→ 无记录时空态", /没有符合条件/.test(d.getElementById("subs-table").textContent));
  d.querySelector('.admin-filter[data-f="all"]').click();
  callLog.length = 0;
  var toggle = d.querySelector('#subs-table button[data-act="toggle"]');
  toggle.click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("点「未联系」→ 请求 mark_handled(true)", callLog.some(function (b) { return b && b.action === "mark_handled" && b.handled === true; }), JSON.stringify(callLog));

  /* 导出投稿 CSV */
  callLog.length = 0;
  mode = "csv";
  d.getElementById("export-photos").click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("导出投稿 → 请求 export_photos", callLog.some(function (b) { return b && b.action === "export_photos"; }), JSON.stringify(callLog));

  /* 导出 */
  mode = "csv";
  d.getElementById("export-csv").click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("导出走 export 动作", lastBody && lastBody.action === "export", JSON.stringify(lastBody));

  /* 立即备份 */
  callLog.length = 0;
  mode = "ok";
  d.getElementById("backup-now").click();
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("立即备份 → 请求 backup 动作", callLog.some(function (b) { return b && b.action === "backup"; }), JSON.stringify(callLog));
  ok("备份结果提示（stamp/条数）", /备份完成（2026-10）/.test(d.getElementById("panel-msg").textContent) && /作品 3 条/.test(d.getElementById("panel-msg").textContent), d.getElementById("panel-msg").textContent);

  ok("noindex 已设置", (d.querySelector('meta[name="robots"]') || {}).content === "noindex");
  dom.window.close();
}

/* ======================================================================== */
async function testCommons() {
  console.log("\n[commons] 招新条 / 动态 / 页脚 / 投稿入口 / 灯箱分享 / 报名自查 / 404");

  function photosFetch(window) {
    window.fetch = function (url) {
      if (url === "api/photos") {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, photos: DB_PHOTOS }); } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, photos: [] }); } });
    };
  }
  function waitCards(d, ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        if (d.querySelectorAll("#works-grid .work").length || Date.now() - t0 > (ms || 3000)) return resolve();
        setTimeout(poll, 20);
      })();
    });
  }

  /* ---- 首页：招新状态条 / 近期动态 / 页脚账号 ---- */
  var dom = await loadPage("index.html", function (w) { baseStubs(w); photosFetch(w); });
  var d = dom.window.document;

  var rbar = d.getElementById("rbar");
  ok("招新胶囊已渲染", rbar && !rbar.hidden && !!rbar.querySelector(".hero__recruit"));
  ok("胶囊文案与跳转", /秋季招新进行中/.test(rbar.textContent) &&
     rbar.querySelector("a").getAttribute("href") === "join.html#form", rbar.textContent.trim());
  ok("胶囊在首屏内容内（不再是一条独立横带）", !!d.querySelector(".hero__main .hero__recruit"));
  ok("近期动态 3 张卡片", d.querySelectorAll("#news .news__item").length === 3,
     String(d.querySelectorAll("#news .news__item").length));
  ok("动态含「进行中」标记", !!d.querySelector("#news .news__tag.is-live"));
  ok("动态卡片不显示时间", !d.querySelector("#news .news__date"));

  var copies = d.querySelectorAll(".foot .foot__copy");
  ok("页脚两个账号可点击复制", copies.length === 2, String(copies.length));
  ok("页脚 QQ 号就位", copies[0].getAttribute("data-copy") === "1159554310" && /1159554310/.test(copies[0].textContent));
  ok("页脚抖音号就位", copies[1].getAttribute("data-copy") === "ltyz_GLIMMER" && /ltyz_GLIMMER/.test(copies[1].textContent));
  ok("页脚有投稿与关注入口", !!d.querySelector('.foot a[href="upload.html"]') && !!d.querySelector('.foot a[href="share.html"]'));
  dom.window.close();

  /* ---- 作品集：常驻投稿按钮 + 灯箱复制深链 ---- */
  var dom2 = await loadPage("gallery.html", function (w) { baseStubs(w); photosFetch(w); });
  var d2 = dom2.window.document;
  await waitCards(d2);
  ok("作品集常驻投稿按钮", !!d2.querySelector('.gbar__submit[href="upload.html"]'));

  /* 拦截剪贴板，验证复制出来的是单作品深链 */
  var copied = "";
  Object.defineProperty(dom2.window.navigator, "clipboard", {
    value: { writeText: function (t) { copied = t; return Promise.resolve(); } },
    configurable: true
  });
  Object.defineProperty(dom2.window, "isSecureContext", { value: true, configurable: true });

  var cards = d2.querySelectorAll("#works-grid .work");
  cards[0].dispatchEvent(new dom2.window.MouseEvent("click", { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 120); });
  var lb = d2.querySelector(".lb");
  ok("灯箱已打开", lb && lb.classList.contains("is-open"));
  var copyBtn = d2.querySelector(".lb__copy");
  ok("灯箱复制按钮可见（该作品有 id）", copyBtn && !copyBtn.hidden);

  copyBtn.dispatchEvent(new dom2.window.MouseEvent("click", { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("复制的是单作品深链", /^https:\/\/lityzglimmer\.top\/gallery\.html#photo-\d+$/.test(copied), copied);
  ok("复制后按钮给出反馈", /已复制/.test(copyBtn.textContent), copyBtn.textContent);
  dom2.window.close();

  /* ---- 静态作品深链：#photo-hanlou-01 也能定位 ---- */
  var dom5 = await loadPage("gallery.html#photo-hanlou-01", function (w) { baseStubs(w); photosFetch(w); });
  await new Promise(function (r) { setTimeout(r, 320); });
  var lb5 = dom5.window.document.querySelector(".lb");
  ok("静态作品深链可直达灯箱", lb5 && lb5.classList.contains("is-open") &&
     /hanlou-01|高三喊楼/.test(dom5.window.document.querySelector(".lb__cap").textContent),
     (dom5.window.document.querySelector(".lb__cap") || {}).textContent);
  dom5.window.close();

  /* ---- join：报名状态自查 ---- */
  var sent = null;
  var dom3 = await loadPage("join.html", function (w) {
    baseStubs(w);
    w.fetch = function (url, opt) {
      if (url === "api/register-status") {
        sent = JSON.parse(opt.body);
        return Promise.resolve({ ok: true, status: 200, json: function () {
          return Promise.resolve({ ok: true, found: true, status: "待联系", at: "2026-02-01T10:00:00Z" });
        } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: false }); } });
    };
  });
  var d3 = dom3.window.document;
  ok("报名页有状态自查卡片", !!d3.getElementById("query"));
  d3.getElementById("s-name").value = "丁";
  d3.getElementById("s-contact").value = "QQ 88888";
  d3.getElementById("s-btn").dispatchEvent(new dom3.window.MouseEvent("click", { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 120); });
  ok("自查请求带上姓名与联系方式", sent && sent.name === "丁" && sent.contact === "QQ 88888", JSON.stringify(sent));
  var smsg = d3.getElementById("s-msg");
  ok("自查结果：显示待联系", !smsg.hidden && /待联系/.test(smsg.textContent) && smsg.className.indexOf("is-ok") !== -1, smsg.textContent);

  d3.getElementById("s-contact").value = "";
  d3.getElementById("s-btn").dispatchEvent(new dom3.window.MouseEvent("click", { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 80); });
  ok("自查缺联系方式 → 报错提示", /请填写报名时用的联系方式/.test(d3.getElementById("s-msg").textContent),
     d3.getElementById("s-msg").textContent);
  dom3.window.close();

  /* ---- 404 页 ---- */
  var dom4 = await loadPage("404.html");
  var d4 = dom4.window.document;
  ok("404 页导航已注入", !!d4.querySelector(".nav"));
  ok("404 页有回首页与作品集入口", !!d4.querySelector('a[href="index.html"]') && !!d4.querySelector('a[href="gallery.html"]'));
  ok("404 页 noindex", (d4.querySelector('meta[name="robots"]') || {}).content === "noindex");
  dom4.window.close();
}

/* ======================================================================== */
(async function () {
  await testIndex();
  await testGallery();
  await testJoin();
  await testUpload();
  await testAdmin();
  await testCommons();
  console.log("\n=========================================");
  console.log("结果：" + PASS + " 通过 / " + FAIL + " 失败");
  process.exit(FAIL ? 1 : 0);
})().catch(function (e) {
  console.error("测试脚本异常：", e);
  process.exit(1);
});
