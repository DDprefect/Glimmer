/* ==========================================================================
   微光摄影社 · 作品集页
   分类筛选 + 分步加载 + 灯箱浏览
   数据来源两部分，合并展示：
     1) 静态 works.js（建站时收录的社员作品，本地数据）
     2) /api/photos 返回的 approved 投稿（后端新增，按提交时间倒序）
   接口不可用（如数据库暂停、本地 file:// 打开）时静默降级为仅静态作品。
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

  /* 数据库里的中文分类 → 站点内部分类键 */
  var DB_CAT_MAP = {
    "校园纪实": "campus",
    "校外采风": "field",
    "城市与远方": "city",
    "人像与视觉": "portrait"
  };

  var PER_PAGE = 15;
  var state = { cat: "all", shown: PER_PAGE, items: [] };

  /* 数据库行 → 作品卡片数据结构（无 ratio，载入后按真实比例纠正） */
  function dbToWork(p) {
    return {
      id: "db-" + p.id,
      cat: DB_CAT_MAP[p.category] || "",
      group: p.category,
      title: p.title,
      author: p.author || "",
      src: p.file_url,
      thumb: p.file_url,
      sub: p.author ? p.category + " · " + p.author : p.category,
      shot: p.shot_date ? { date: p.shot_date } : null,
      ratio: 0,
      db: true
    };
  }

  function boot() {
    var staticAll = G.visibleWorks ? G.visibleWorks() : (window.WORKS || []);
    var dbItems = [];
    var all = dbItems.concat(staticAll); // 初始仅静态，接口回来后合并

    var grid = $("#works-grid");
    var filterHost = $("#works-filters");
    var moreHost = $("#works-more");
    var statEl = $("[data-count-works]");
    if (!grid) return;

    /* ---------------- 筛选按钮 ---------------- */
    if (filterHost) {
      filterHost.innerHTML = CATS.map(function (c) {
        var n = c.key === "all"
          ? all.length
          : all.filter(function (w) { return w.cat === c.key; }).length;
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

      /* 页头统计的「本期展出」跟随实际展出总数（静态 + 数据库已审核），
         避免下架条目后计数与列表对不上（HTML 里的初始值只是静态兜底） */
      if (statEl) {
        statEl.setAttribute("data-count", all.length);
        statEl.textContent = all.length; // 计数动画可能已跑过，直接落真值
      }

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

    /* ---------------- 拉取数据库已审核作品，合并展示 ----------------
       失败（接口未部署 / 数据库暂停 / 本地打开）时保持静态作品，不报错不白屏 */
    fetch("api/photos")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !j.photos || !j.photos.length) return;
        dbItems = j.photos.map(dbToWork);
        all = dbItems.concat(staticAll);
        render(true);
      })
      .catch(function () { /* 静默降级 */ });

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
