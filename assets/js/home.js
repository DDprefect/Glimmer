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
    { src: "assets/img/hero/hero-field.webp",   place: "玉武三江 · 采风",   note: "云雾里的远山" }
  ];

  function initHero() {
    var host = $("#hero-slides");
    var dots = $("#hero-dots");
    if (!host || !SLIDES.length) return;

    host.innerHTML = SLIDES.map(function (s, i) {
      return '<div class="hero__slide' + (i === 0 ? " is-on" : "") + '" data-i="' + i + '">' +
               '<img src="' + s.src + '" alt="' + s.place + '" ' +
                 (i === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + ' decoding="async">' +
             "</div>";
    }).join("");

    var placeEl = $("#hero-place");
    var noteEl = $("#hero-note");
    var idx = 0;
    var timer = null;

    $$(".hero__slide", host).forEach(function (el, i) {
      var img = $("img", el);
      // 重新触发 Ken Burns
      el.addEventListener("transitionend", function () {
        if (el.classList.contains("is-on")) {
          img.style.animation = "none";
          void img.offsetWidth;
          img.style.animation = "";
        }
      });
      el.setAttribute("data-idx", i);
    });

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

    function go(n) {
      idx = (n + SLIDES.length) % SLIDES.length;
      $$(".hero__slide", host).forEach(function (el, i) { el.classList.toggle("is-on", i === idx); });
      if (dots) $$(".hero__dot", dots).forEach(function (b, i) { b.classList.toggle("is-on", i === idx); });
      if (placeEl) placeEl.textContent = SLIDES[idx].place;
      if (noteEl) noteEl.textContent = SLIDES[idx].note;
    }

    function restart() {
      clearInterval(timer);
      timer = setInterval(function () { go(idx + 1); }, 7000);
    }

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
      { host: "#pick-field",    ids: ["sanjiang-08", "sanjiang-03", "sanjiang-09", "sanjiang-17", "sanjiang-14"] },
      { host: "#pick-city",     ids: ["city-01", "city-02", "city-05", "city-10"] }
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
