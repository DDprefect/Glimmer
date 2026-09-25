/* ==========================================================================
   微光摄影社 · 作品集页
   分类筛选 + 分步加载 + 灯箱浏览
   ========================================================================== */
(function () {
  "use strict";

  var G = window.Glimmer || {};
  var $ = G.$ || function (s, r) { return (r || document).querySelector(s); };
  var $$ = G.$$ || function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var workCard = G.workCard;
  var bindCards = G.bindCards;

  var CATS = [
    { key: "all",      label: "全部作品",   en: "All"      },
    { key: "campus",   label: "校园纪实",   en: "Campus"   },
    { key: "field",    label: "校外采风",   en: "Field"    },
    { key: "city",     label: "城市与远方", en: "City"     },
    { key: "portrait", label: "人像与视觉", en: "Portrait" }
  ];

  var PER_PAGE = 15;
  var state = { cat: "all", shown: PER_PAGE, items: [] };

  function boot() {
    var all = window.WORKS || [];
    if (!all.length) return;

    var grid = $("#works-grid");
    var filterHost = $("#works-filters");
    var moreHost = $("#works-more");
    if (!grid) return;

    /* ---------------- 筛选按钮 ---------------- */
    if (filterHost) {
      filterHost.innerHTML = CATS.map(function (c) {
        var n = c.key === "all" ? all.length : all.filter(function (w) { return w.cat === c.key; }).length;
        return '<button class="filter' + (c.key === "all" ? " is-on" : "") + '" type="button" data-cat="' + c.key + '">' +
                 c.label + " <b>" + n + "</b></button>";
      }).join("");
      $$(".filter", filterHost).forEach(function (b) {
        b.addEventListener("click", function () {
          $$(".filter", filterHost).forEach(function (x) { x.classList.remove("is-on"); });
          b.classList.add("is-on");
          state.cat = b.getAttribute("data-cat");
          state.shown = PER_PAGE;
          render(true);
        });
      });
    }

    /* ---------------- 渲染 ---------------- */
    function current() {
      return state.cat === "all" ? all : all.filter(function (w) { return w.cat === state.cat; });
    }

    function render(reset) {
      state.items = current();
      var slice = state.items.slice(0, state.shown);

      grid.innerHTML = slice.length
        ? slice.map(function (w, i) { return workCard(w, i, reset ? 0 : 30); }).join("")
        : '<div class="works-empty">这一分类下暂时还没有作品。</div>';

      bindCards(grid, state.items);
      if (G.eagerAll) G.eagerAll(grid);

      // 计数与加载更多
      var rest = Math.max(0, state.items.length - state.shown);
      if (moreHost) {
        moreHost.innerHTML = rest > 0
          ? '<button class="btn btn--ghost" type="button" id="load-more">再看 ' + Math.min(rest, PER_PAGE) + ' 张' +
              '<span class="btn__arrow">↓</span></button>' +
            '<span class="tag" style="align-self:center">已展示 ' + slice.length + " / " + state.items.length + " 张</span>"
          : (state.items.length > PER_PAGE
              ? '<span class="tag" style="align-self:center">已展示全部 ' + state.items.length + " 张</span>"
              : "");
        var lm = $("#load-more");
        if (lm) lm.addEventListener("click", function () {
          state.shown += PER_PAGE;
          render(false);
        });
      }

      // 刷新滚动入场
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
        });
      }, { threshold: .1 });
      $$("[data-reveal]", grid).forEach(function (e) { io.observe(e); });
    }

    render(true);

    /* ---------------- 从其它页面的锚点直接进入某个分类 ---------------- */
    function applyHash() {
      var k = (location.hash || "").replace("#", "");
      if (!k) return;
      var hit = CATS.filter(function (c) { return c.key === k; })[0];
      if (!hit) return;
      state.cat = k;
      state.shown = PER_PAGE;
      $$(".filter", filterHost).forEach(function (b) {
        b.classList.toggle("is-on", b.getAttribute("data-cat") === k);
      });
      render(true);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);

    /* ---------------- 键盘：左右切换分类 ---------------- */
    document.addEventListener("keydown", function (e) {
      if (document.querySelector(".lb.is-open")) return;
      var i = CATS.findIndex(function (c) { return c.key === state.cat; });
      if (e.key === "ArrowRight" && i < CATS.length - 1) $$(".filter", filterHost)[i + 1].click();
      if (e.key === "ArrowLeft" && i > 0) $$(".filter", filterHost)[i - 1].click();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
