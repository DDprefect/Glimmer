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
      /* 网格只加载缩图（数据万象按宽缩放），灯箱再用 src 原图 */
      thumb: G.thumbUrl ? G.thumbUrl(p.file_url, 880) : p.file_url,
      sub: p.author ? p.category + " · " + p.author : p.category,
      shot: exifShot(p),
      ratio: 0,
      db: true,
      /* v2.8.0：活动投稿标记——计入「本期展出」但不进常规网格，只在活动展示页出现 */
      eventId: p.event_id || 0
    };
  }

  /* 数据库存的 exif（投稿时从原图解析）→ 灯箱拍摄信息行字段；
     没有 exif 的老数据退化为只显示拍摄日期 */
  function exifShot(p) {
    var e = p.exif;
    if (!e || typeof e !== "object") return p.shot_date ? { date: p.shot_date } : null;
    var shot = {};
    ["camera", "lens", "aperture", "shutter", "iso", "focal"].forEach(function (k) {
      if (e[k]) shot[k] = e[k];
    });
    shot.date = p.shot_date || e.shotAt || "";
    return Object.keys(shot).length ? shot : null;
  }

  function boot() {
    var staticAll = G.visibleWorks ? G.visibleWorks() : (window.WORKS || []);
    var dbItems = [];
    var all = dbItems.concat(staticAll); // 初始仅静态，接口回来后合并

    /* v2.8.0：常规作品 = 排除活动投稿。活动投稿计入「本期展出」总数，
       但不进分类筛选与网格——它们只在活动展示页出现。 */
    function regular() {
      return all.filter(function (w) { return !w.eventId; });
    }

    /* v2.6.0：静态老作品被干部移入回收站 / 永久移除后，site.js 会派发
       glimmer:static-excluded；这里重算静态来源、刷新筛选计数并重渲染。 */
    function syncStatic() {
      if (!grid || view !== "grid") return; /* 活动视图下清单到达不打断当前视图 */
      staticAll = G.visibleWorks ? G.visibleWorks() : (window.WORKS || []);
      all = dbItems.concat(staticAll);
      if (filterHost) {
        $$(".filter", filterHost).forEach(function (b) {
          var n = b.getAttribute("data-cat");
          var count = n === "all" ? regular().length : regular().filter(function (w) { return w.cat === n; }).length;
          var badge = b.querySelector("b");
          if (badge) badge.textContent = count;
        });
      }
      render(true);
    }
    document.addEventListener("glimmer:static-excluded", syncStatic);

    var grid = $("#works-grid");
    var filterHost = $("#works-filters");
    var moreHost = $("#works-more");
    var statEl = $("[data-count-works]");
    if (!grid) return;

    /* ---------------- 筛选按钮 ---------------- */
    if (filterHost) {
      filterHost.innerHTML = CATS.map(function (c) {
        var n = c.key === "all"
          ? regular().length
          : regular().filter(function (w) { return w.cat === c.key; }).length;
        return '<button class="filter' + (c.key === "all" ? " is-on" : "") + '" type="button" data-cat="' + c.key + '">' +
                 c.label + " <b>" + n + "</b></button>";
      }).join("") +
      /* v2.8.0：活动入口——进行中的活动带脉冲点 */
      '<button class="filter filter--event" type="button" data-event="1" title="活动作品与回顾">' +
        '<i class="filter__dot" aria-hidden="true" hidden></i>活动 <b id="event-tab-n"></b></button>';

      $$(".filter", filterHost).forEach(function (b) {
        b.addEventListener("click", function () {
          $$(".filter", filterHost).forEach(function (x) { x.classList.remove("is-on"); });
          b.classList.add("is-on");
          state.cat = b.getAttribute("data-cat");
          state.shown = PER_PAGE;
          syncCatUrl(state.cat); /* v2.4.0：分类写回 URL，分享/刷新不丢 */
          render(true);
        });
      });

      /* v2.4.0：地址栏带合法分类（gallery.html?cat=portrait）就直接进入该分类 */
      var wantCat = "";
      try { wantCat = new URLSearchParams(location.search).get("cat") || ""; } catch (e) {}
      if (wantCat && wantCat !== "all" && CATS.some(function (c) { return c.key === wantCat; })) {
        state.cat = wantCat;
        $$(".filter", filterHost).forEach(function (b) {
          b.classList.toggle("is-on", b.getAttribute("data-cat") === wantCat);
        });
      }
    }

    /* v2.4.0：把当前分类同步进地址栏（replaceState 不产生历史记录）。
       all 时不写参数，保持地址干净；hash（单作品深链）原样保留。 */
    function syncCatUrl(key) {
      try {
        var u = new URL(location.href);
        if (!key || key === "all") u.searchParams.delete("cat");
        else u.searchParams.set("cat", key);
        history.replaceState(null, "", u.pathname + (u.search ? u.search : "") + u.hash);
      } catch (e) { /* 异常环境静默降级，不影响筛选本身 */ }
    }

    /* ---------------- 渲染 ---------------- */
    function current() {
      var reg = regular();
      return state.cat === "all" ? reg : reg.filter(function (w) { return w.cat === state.cat; });
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

    /* ---------------- 活动视图（v2.8.0） ----------------
       view: "grid" 常规网格 | "eventList" 活动列表 | "eventDetail" 单活动展示。
       活动投稿计入「本期展出」但不进常规网格；详情视图含作品网格 +
       活动时间 + 参与人数 + 名单（归档活动公开姓名与班级，绝无联系方式）。 */
    var view = "grid";
    var moreBtn = $('.filter--event', filterHost);

    function setView(v) {
      view = v;
      /* v2.9.1：活动视图脱离瀑布流分栏（columns:3 会把信息头和列表切碎） */
      grid.classList.toggle("is-eventview", v !== "grid");
      $$(".filter", filterHost).forEach(function (b) {
        b.classList.toggle("is-on", v !== "grid" ? b.hasAttribute("data-event") : b.getAttribute("data-cat") === state.cat);
      });
      if (v === "grid") {
        try {
          var u0 = new URL(location.href);
          u0.searchParams.delete("event");
          history.replaceState(null, "", u0.pathname + (u0.search ? u0.search : "") + u0.hash);
        } catch (e0) {}
      }
    }

    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

    function renderEventList(list) {
      var head =
        '<div class="evhead">' +
          '<div><span class="eyebrow eyebrow--red">Events　活动作品</span>' +
          '<h2 class="h3" style="margin-top:10px">活动拍摄与回顾</h2>' +
          '<p class="evhead__tip">活动投稿会出现在对应活动页；这里可以直达进行中的活动，也能翻看往期回顾（作品、参与人数与名单）。</p></div>' +
        "</div>";
      var groups = [
        { label: "正在进行", items: list.filter(function (e) { return e.status === "published"; }) },
        { label: "往期回顾", items: list.filter(function (e) { return e.status === "archived"; }) }
      ];
      var body = groups.map(function (g) {
        if (!g.items.length) return "";
        return '<h3 class="admin-subhead">' + g.label + "</h3>" +
          '<div class="evlist">' +
          g.items.map(function (e) {
            return '<a class="event-card" href="gallery.html?event=' + encodeURIComponent(e.id) + '">' +
              '<div class="event-card__body"><h3>' + esc(e.title) + "</h3>" +
              "<p>" + esc(e.activity_date ? "活动日期 " + e.activity_date + " · " : "") + esc(e.excerpt || "点开查看作品与回顾") + "</p></div>" +
              '<span class="event-card__end">' + (e.status === "archived" ? "回顾 →" : "查看 / 报名 →") + "</span>" +
            "</a>";
          }).join("") +
          "</div>";
      }).join("");
      grid.innerHTML = head + (body || '<div class="works-empty">还没有活动。活动发布后会出现在这里。</div>');
    }

    function renderEventDetail(j) {
      var ev = j.event || {};
      var regs = j.regs || {};
      var isPast = ev.status === "archived";
      var head =
        '<div class="evhead">' +
          '<a class="evback" href="gallery.html" data-evback>← 返回作品集</a>' +
          '<h2 class="h3" style="margin-top:12px">' + esc(ev.title) +
            ' <span class="admin-event__st is-' + ev.status + '">' + (isPast ? "已结束" : "进行中") + "</span></h2>" +
          (ev.activity_date ? '<p class="evhead__tip">活动日期 · ' + esc(ev.activity_date) + "</p>" : "") +
          '<div class="evstats">' +
            '<span class="tag">作品 ' + (j.works || []).length + " 张</span>" +
            '<span class="tag">参与报名 ' + regs.count + " 人</span>" +
            (isPast ? "" : '<a class="btn btn--sm" href="event.html?id=' + encodeURIComponent(ev.id) + '">去活动页报名 →</a>') +
          "</div>" +
          (regs.names && regs.names.length
            ? '<p class="evhead__tip evnames"><b>参与名单：</b>' + regs.names.map(function (r) {
                return esc(r.name) + (r["class"] ? "（" + esc(r["class"]) + "）" : "");
              }).join("、") + "</p>"
            : "") +
        "</div>";
      var works = (j.works || []).map(dbToWork);
      var body = works.length
        ? '<div class="works" id="evgrid">' + works.map(function (w, i) { return G.workCard(w, i, 0); }).join("") + "</div>"
        : '<div class="works-empty">' + (isPast ? "这次活动没有留下公开作品。" : "活动作品审核通过后会出现在这里，现在可以先去报名。") + "</div>";
      grid.innerHTML = head + body;
      var evHost = $("#evgrid", grid);
      if (evHost && G.bindCards) G.bindCards(evHost, works);
      if (evHost) {
        /* workCard 自带 data-reveal，动态插入没人观察——直接点亮（v2.7.1 教训） */
        $$("[data-reveal]", evHost).forEach(function (el) { el.classList.add("is-in"); });
        if (G.eagerAll) G.eagerAll(evHost);
      }
    }

    function openEventDetail(id) {
      view = "eventDetail";
      grid.classList.add("is-eventview"); /* 脱离瀑布流分栏（v2.9.1） */
      $$(".filter", filterHost).forEach(function (b) {
        b.classList.toggle("is-on", b.hasAttribute("data-event"));
      });
      grid.innerHTML = '<div class="works-empty">活动加载中…</div>';
      fetch("api/events?id=" + encodeURIComponent(id))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok || !j.event) { grid.innerHTML = '<div class="works-empty">活动不存在或已删除。 <a class="evback" href="gallery.html" data-evback>← 返回作品集</a></div>'; return; }
          renderEventDetail(j);
        })
        .catch(function () {
          grid.innerHTML = '<div class="works-empty">活动加载失败，请稍后重试。</div>';
        });
    }

    function openEventList() {
      view = "eventList";
      grid.classList.add("is-eventview"); /* 脱离瀑布流分栏（v2.9.1） */
      $$(".filter", filterHost).forEach(function (b) {
        b.classList.toggle("is-on", b.hasAttribute("data-event"));
      });
      grid.innerHTML = '<div class="works-empty">活动加载中…</div>';
      fetch("api/events")
        .then(function (r) { return r.json(); })
        .then(function (j) {
          renderEventList((j && j.ok && j.current ? j.current : []).concat(j && j.past ? j.past : []));
        })
        .catch(function () {
          grid.innerHTML = '<div class="works-empty">活动加载失败，请稍后重试。</div>';
        });
    }

    if (moreBtn) {
      moreBtn.addEventListener("click", function () {
        if (view !== "grid") { setView("grid"); render(true); return; }
        openEventList();
      });
    }
    grid.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      var back = e.target.closest("[data-evback]");
      if (back) { e.preventDefault(); setView("grid"); render(true); return; }
    });

    /* URL 直达：gallery.html?event=N 打开活动展示 */
    var wantEvent = "";
    try { wantEvent = new URLSearchParams(location.search).get("event") || ""; } catch (eQ) {}
    if (wantEvent) openEventDetail(wantEvent);

    /* 活动按钮上的脉冲点：有进行中的活动就亮 */
    fetch("api/events")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var current = (j && j.ok && j.current) || [];
        var n = $("#event-tab-n");
        var dot = $(".filter__dot", filterHost);
        if (n) n.textContent = current.length ? String(current.length) : "";
        if (dot) dot.hidden = !current.length;
      })
      .catch(function () { /* 静默 */ });

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
        /* 深链（#photo-<id>）指向的作品这时才可能存在，补一次应用 */
        applyHash();
      })
      .catch(function () { /* 静默降级 */ });

    /* ---------------- 从其它页面的锚点进入：分类 或 具体作品 ---------------- */
    function applyHash() {
      var k = (location.hash || "").replace("#", "");
      if (!k) return;

      /* 作品深链 #photo-<id>（首页「最新收录」、灯箱「复制本张链接」点进来）：
         定位卡片并开灯箱。数据库作品 id 形如 db-123，静态作品形如 hanlou-01，
         两种都认——同学把自己的作品甩进 QQ 群时点开就是那一张。 */
      var pm = /^photo-(.+)$/.exec(k);
      if (pm) {
        var hit = all.filter(function (w) {
          return String(w.id) === pm[1] || String(w.id) === "db-" + pm[1];
        })[0];
        if (!hit) return;
        state.cat = "all";
        state.shown = Math.max(PER_PAGE, all.indexOf(hit) + 1);
        $$(".filter", filterHost).forEach(function (b) {
          b.classList.toggle("is-on", b.getAttribute("data-cat") === "all");
        });
        render(true);
        setTimeout(function () {
          var idx = state.items.indexOf(hit);
          var card = $$(".work", grid)[idx];
          if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            if (window.Lightbox) window.Lightbox.open(state.items, idx);
          }
        }, 80);
        return;
      }

      var cat = CATS.filter(function (c) { return c.key === k; })[0];
      if (!cat) return;
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
      if (view !== "grid") return; /* 活动视图下不响应分类键盘切换 */
      var i = CATS.findIndex(function (c) { return c.key === state.cat; });
      if (e.key === "ArrowRight" && i < CATS.length - 1) $$(".filter", filterHost)[i + 1].click();
      if (e.key === "ArrowLeft" && i > 0) $$(".filter", filterHost)[i - 1].click();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
