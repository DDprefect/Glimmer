/* ==========================================================================
   微光摄影社 · 首页
   电影感 Hero 轮播 + 精选作品渲染
   ========================================================================== */
(function () {
  "use strict";

  var G = window.Glimmer || {};
  var $ = G.$ || function (s, r) { return (r || document).querySelector(s); };
  var $$ = G.$$ || function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var byId = function (list, id) {
    var out = [];
    id.forEach(function (k) {
      var hit = list.filter(function (w) { return w.id === k; })[0];
      if (hit) out.push(hit);
    });
    return out;
  };

  /* ------------------------------------------------ Hero 轮播 */
  var SLIDES = [
    { src: "assets/img/hero/hero-campus.webp",  place: "校园 · 雕塑广场",   note: "晨光落在不锈钢雕塑上" },
    { src: "assets/img/hero/hero-night.webp",   place: "2026 凤麒喊楼",     note: "高三喊楼的夜" },
    { src: "assets/img/hero/hero-city.webp",    place: "柳州 · 柳江之上",   note: "黄金时刻的群峰" },
    { src: "assets/img/hero/hero-sports.webp",  place: "春季运动会",        note: "百米冲刺的瞬间" },
    { src: "assets/img/hero/hero-field.webp",   place: "玉武三江 · 采风",   note: "风雨桥上的迎宾队伍" }
  ];

  var HERO_MS = 7000;     // 每屏停留
  var FADE_MS = 1650;     // 与 CSS 的淡入淡出总时长保持一致

  function initHero() {
    var host = $("#hero-slides");
    var dots = $("#hero-dots");
    if (!host || !SLIDES.length) return;

    // 首屏图优先、其余懒加载；但懒加载的图也要在轮播前解码好，
    // 否则第一次切到它时是“半张图慢慢刷出来”，看起来就是二次抽动。
    var slides = SLIDES.map(function (s, i) {
      var im = new Image();
      im.src = s.src;
      im.alt = s.place;
      if (i === 0) im.setAttribute("fetchpriority", "high");
      else im.setAttribute("loading", "lazy");
      im.decoding = "async";
      return im;
    });

    host.innerHTML = "";
    slides.forEach(function (im, i) {
      var box = document.createElement("div");
      box.className = "hero__slide" + (i === 0 ? " is-on" : "");
      box.setAttribute("data-i", String(i));
      box.appendChild(im);
      host.appendChild(box);
    });

    var placeEl = $("#hero-place");
    var noteEl = $("#hero-note");
    var idx = 0;
    var timer = null;

    // 预解码：轮播进行时把下一张提前解好，切换时直接出图，不闪不抽
    function preload(n) {
      var im = slides[(n + slides.length) % slides.length];
      if (!im) return;
      var hint = function () { if (im.decode) im.decode().catch(function () {}); };
      if (im.complete) hint();
      else im.addEventListener("load", hint, { once: true });
    }

    if (dots) {
      dots.innerHTML = SLIDES.map(function (s, i) {
        return '<button class="hero__dot' + (i === 0 ? " is-on" : "") + '" type="button" ' +
               'data-i="' + i + '" aria-label="切换到：' + s.place + '"></button>';
      }).join("");
      $$(".hero__dot", dots).forEach(function (b) {
        b.addEventListener("click", function () {
          go(parseInt(b.getAttribute("data-i"), 10));
          restart();
        });
      });
    }

    // 注意：不要在这里做任何「取消/重挂 animation」的操作。
    // Ken Burns 由 CSS 挂在 .is-on 上，靠关键帧本身与静态基准态严丝合缝地对齐，
    // 一旦 JS 插手重置动画，就会出现“动画被砍 → 跳回基准态 → 重新推近”的二次抽动。
    function go(n) {
      idx = (n + SLIDES.length) % SLIDES.length;
      $$(".hero__slide", host).forEach(function (el, i) {
        el.classList.toggle("is-on", i === idx);
      });
      if (dots) $$(".hero__dot", dots).forEach(function (b, i) { b.classList.toggle("is-on", i === idx); });
      if (placeEl) placeEl.textContent = SLIDES[idx].place;
      if (noteEl) noteEl.textContent = SLIDES[idx].note;
      preload(idx + 1);
    }

    function restart() {
      clearInterval(timer);
      timer = setInterval(function () { go(idx + 1); }, HERO_MS);
    }

    // 首屏与下一张先解码，再启动轮播
    preload(0);
    preload(1);

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) restart();

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) clearInterval(timer);
      else restart();
    });
  }

  /* ------------------------------------------------ 精选作品 */
  function renderSections() {
    var all = window.WORKS || [];
    if (!all.length) return;

    var groups = [
      { host: "#pick-campus",   ids: ["hanlou-06", "sports-02", "view-07", "hanlou-04", "sports-07", "view-11"] },
      { host: "#pick-field",    ids: ["sanjiang-01", "sanjiang-08", "sanjiang-03", "sanjiang-09", "sanjiang-17", "sanjiang-14"] },
      { host: "#pick-city",     ids: ["city-01", "city-02", "city-05", "city-10"] },
      { host: "#pick-portrait", ids: ["portrait-06", "portrait-15", "portrait-18", "portrait-05", "portrait-11", "portrait-13"] }
    ];

    groups.forEach(function (g) {
      var host = $(g.host);
      if (!host) return;
      var items = byId(all, g.ids);
      host.innerHTML = items.map(function (w, i) { return G.workCard(w, i, 0); }).join("");
      G.bindCards(host, items);
      if (G.eagerAll) G.eagerAll(host);
    });
  }

  function boot() {
    initHero();
    renderSections();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
