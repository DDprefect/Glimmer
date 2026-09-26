/* 灯箱切换回归断言：验证「切换时二次抽动」的两个根因都已消除
   跑法：NODE_PATH=C:\Users\兜\.workbuddy\binaries\node\workspace\node_modules node _tools/_check_lightbox.js
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}

const dom = new JSDOM(
  "<!DOCTYPE html><html><body><div id='works-grid'></div></body></html>",
  { url: "http://localhost/gallery.html", pretendToBeVisual: true, runScripts: "outside-only" }
);
const w = dom.window;
w.eval(read("assets/js/site.js"));

const site = read("assets/js/site.js");
const css = read("assets/css/main.css");

console.log("\n=== 1. 源码层：旧的两处「强制回流 + 重挂动画」必须消失 ===");
ok("site.js 不再有 animation = \"none\"", !/style\.animation\s*=\s*["']none["']/.test(site));
ok("site.js 不再有 void offsetWidth 强制回流", !/void\s+\w+\.offsetWidth/.test(site));
ok("site.js 不再有 transitionend 重置 Ken Burns", !/img\.style\.animation/.test(site));

console.log("\n=== 2. 灯箱切换：DOM 级行为断言 ===");
const LB = w.Lightbox;
ok("Lightbox 已导出", !!LB);

const ITEMS = [
  { id: "a", src: "assets/img/works/portrait-01.webp", thumb: "assets/img/works/portrait-01-t.webp",
    title: "甲", group: "人像与视觉", shot: { camera: "Canon EOS R6", aperture: "f/1.8", shutter: "1/200s", iso: "ISO 400", focal: "85mm", date: "2026-02-17" } },
  { id: "b", src: "assets/img/works/portrait-02.webp", thumb: "assets/img/works/portrait-02-t.webp",
    title: "乙", group: "人像与视觉", shot: null }
];
LB.open(ITEMS, 0);

const lbEl = w.document.querySelector(".lb");
ok("灯箱已构建 .lb 节点", !!lbEl);
const img = w.document.querySelector(".lb__img");
const exif = w.document.querySelector(".lb__exif");
ok("存在 .lb__exif 容器", !!exif);
ok("打开即渲染第一张", img.getAttribute("src") === ITEMS[0].src, img.getAttribute("src"));
ok("拍摄信息行已填充", /Canon EOS R6/.test(exif.innerHTML), exif.innerHTML);
ok("拍摄信息含光圈/焦段", /f\/1\.8/.test(exif.innerHTML) && /85mm/.test(exif.innerHTML));
ok("切换按钮存在", !!w.document.querySelector(".lb__nav--next"));

console.log("\n=== 3. 切换动作：不再碰 transform，只做透明度过渡 ===");
const nextBtn = w.document.querySelector(".lb__nav--next");
img.style.transform = "scale(1)";           // 记录切换前 transform
const before = img.style.transform;
nextBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const clsAfter = img.className;
ok("切换后挂上 is-step 类", /is-step/.test(clsAfter), clsAfter);
ok("切换过程中 transform 未被改写", img.style.transform === before, img.style.transform);
ok("切换过程中内联 animation 未被改写", !img.style.animation, "animation=" + img.style.animation);

setTimeout(() => {
  console.log("\n=== 4. 切换完成：图片与元数据都已推进到第二张 ===");
  ok("图片 src 已换到第二张", img.getAttribute("src") === ITEMS[1].src, img.getAttribute("src"));
  ok("标题已换到第二张", w.document.querySelector(".lb__cap h3").textContent === "乙");
  ok("计数已更新", /02\s*\/\s*02/.test(w.document.querySelector(".lb__count").textContent),
     w.document.querySelector(".lb__count").textContent);
  ok("无 EXIF 时信息行为空（自动隐藏）", exif.innerHTML === "", JSON.stringify(exif.innerHTML));
  ok("切换完成后 is-step 已摘除", !/is-step/.test(img.className), img.className);

  console.log("\n=== 5. CSS 层：静态基准态与动画终态必须对齐 ===");
  const staticT = (css.match(/\.hero__slide img\s*\{[^}]*transform:\s*scale\(([\d.]+)\)/) || [])[1];
  const kbTo = (css.match(/@keyframes kenburns\s*\{[^}]*to\s*\{[^}]*scale\(([\d.]+)\)/) || [])[1];
  ok("hero 静态基准 scale 已取到", !!staticT, staticT);
  ok("hero 静态基准 === kenburns 终态（关键：否则重挂动画必抽一下）",
     staticT && kbTo && staticT === kbTo, staticT + " vs " + kbTo);
  ok("lbIn 终态是 scale 1（与静态态一致）", /@keyframes lbIn[^}]*to\s*\{[^}]*transform:\s*none/.test(css.replace(/\s+/g, " ")));
  ok(".lb__img.is-step 显式关掉 animation", /\.lb__img\.is-step\s*\{[^}]*animation:\s*none/.test(css.replace(/\s+/g, " ")));
  ok("hero 交叉淡入：下层带 transition-delay", /\.hero__slide\s*\{[^}]*transition:\s*opacity[^}]*\d+m?s/.test(css.replace(/\s+/g, " ")));

  console.log("\n=== 6. 数据层：新增人像与 shot 字段 ===");
  w.eval(read("assets/data/works.js"));
  const WORKS = w.WORKS;
  ok("作品总数 78", WORKS.length === 78, String(WORKS.length));
  const portrait = WORKS.filter((x) => x.cat === "portrait");
  ok("人像分类 21 张", portrait.length === 21, String(portrait.length));
  const withShot = WORKS.filter((x) => x.shot);
  ok("有拍摄信息的作品数 > 50", withShot.length > 50, String(withShot.length));
  const sample = WORKS.filter((x) => x.id === "portrait-04")[0];
  ok("portrait-04 有 shot", !!(sample && sample.shot));
  ok("shot.camera 是机型字符串", sample && typeof sample.shot.camera === "string", sample && sample.shot.camera);
  ok("shot.aperture 形如 f/N", sample && /^f\/[\d.]+$/.test(sample.shot.aperture), sample && sample.shot.aperture);
  ok("shot.shutter 形如 1/Ns", sample && /^1\/\d+s$/.test(sample.shot.shutter), sample && sample.shot.shutter);
  ok("shot.iso 形如 ISO N", sample && /^ISO \d+$/.test(sample.shot.iso), sample && sample.shot.iso);
  ok("shot.focal 形如 Nmm", sample && /^\d+mm$/.test(sample.shot.focal), sample && sample.shot.focal);
  ok("每个 shot.date 形如 YYYY-MM-DD",
     withShot.every((x) => !x.shot.date || /^\d{4}-\d{2}-\d{2}$/.test(x.shot.date)));

  console.log("\n========================================");
  console.log("  通过 " + pass + " / " + (pass + fail) + (fail ? "  ❌ 失败 " + fail : "  ✅ 全部通过"));
  console.log("========================================\n");
  process.exit(fail ? 1 : 0);
}, 400);
