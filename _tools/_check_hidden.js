/* 断言：带 hidden:true 的作品不出现在作品集列表/分类计数/首页精选中 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "gallery.html"), "utf8");
const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  beforeParse: function (window) {
    /* jsdom 缺的浏览器 API：入场动画与片头遮罩用，打桩不影响渲染结果 */
    window.IntersectionObserver = function () {
      return { observe: function () {}, unobserve: function () {}, disconnect: function () {} };
    };
    window.matchMedia = function () {
      return { matches: false, addEventListener: function () {}, removeEventListener: function () {} };
    };
    window.requestAnimationFrame = function (fn) { return setTimeout(fn, 0); };
    window.cancelAnimationFrame = function (id) { clearTimeout(id); };
  }
});
const { window } = dom;

function inject(f) {
  window.eval(fs.readFileSync(path.join(root, f), "utf8"));
}

inject("assets/data/works.js");
inject("assets/js/site.js");
inject("assets/js/gallery.js");

/* gallery.js 在 DOMContentLoaded 后启动，等它跑完再断言 */
function run() {
  const W = window.WORKS;
const vis = W.filter(function (w) { return !w.hidden; });
const fails = [];

if (W.length !== 78) fails.push("总条目应为 78，实际 " + W.length);
if (vis.length !== 76) fails.push("可见条目应为 76，实际 " + vis.length);
if (W.filter(function (w) { return w.hidden; }).length !== 2) fails.push("隐藏条目应为 2");

const c5 = W.find(function (w) { return w.id === "city-05"; });
const s5 = W.find(function (w) { return w.id === "sanjiang-05"; });
if (!c5 || c5.title !== "龙江河") fails.push("city-05 名应为「龙江河」，实际 " + (c5 && c5.title));
if (!s5 || !/茶/.test(s5.title)) fails.push("sanjiang-05 名应含「茶」，实际 " + (s5 && s5.title));

const grid = window.document.querySelector("#works-grid");
const cards = grid ? grid.querySelectorAll(".work") : [];
if (!cards.length) fails.push("作品网格为空，渲染未跑起来");

const hiddenTitles = ["晨光里的广场", "蓝天白云"];
Array.prototype.forEach.call(cards, function (c) {
  const t = c.querySelector(".work__title").textContent;
  if (hiddenTitles.indexOf(t) > -1) fails.push("隐藏作品仍出现在网格：" + t);
});

Array.prototype.forEach.call(window.document.querySelectorAll("#works-filters .filter"), function (b) {
  const label = b.textContent.trim();
  if (label.indexOf("全部作品") === 0 && label.indexOf("76") < 0) fails.push("全部作品计数应为 76，实际「" + label + "」");
  if (label.indexOf("校园纪实") === 0 && label.indexOf("28") < 0) fails.push("校园纪实应为 28，实际「" + label + "」");
  if (label.indexOf("城市与远方") === 0 && label.indexOf("9") < 0) fails.push("城市与远方应为 9，实际「" + label + "」");
});

  console.log(fails.length ? "FAILS:\n" + fails.join("\n") : "fails: none");
  console.log("可见 " + vis.length + " / 总计 " + W.length + "，网格卡片 " + cards.length);
}

if (window.document.readyState === "loading") {
  window.document.addEventListener("DOMContentLoaded", run);
} else {
  run();
}
