/* ==========================================================================
   微光摄影社 · 共享脚本
   导航 / 页脚注入 · 滚动入场 · 片头遮罩 · 灯箱
   无依赖，原生实现。使用 file:// 直接打开亦可正常工作。
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------- 站点配置 */
  var SITE = {
    name: "柳铁一中微光摄影社",
    en: "Glimmer Photography Agency",
    slogan: "以微小之姿看世界　以虔诚之姿定光影"
  };

  var NAV = [
    { href: "index.html",   label: "首页",     en: "Home"  },
    { href: "gallery.html", label: "作品集",   en: "Works" },
    { href: "about.html",   label: "关于我们", en: "About" },
    { href: "join.html",    label: "加入微光", en: "Join"  }
  ];

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function currentPage() {
    var f = location.pathname.split("/").pop();
    return !f || f === "" ? "index.html" : f;
  }

  /* ---------------------------------------------------------- 片头遮罩 */
  function curtain() {
    if (SHOT) return;
    var el = document.createElement("div");
    el.className = "curtain";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<div class="curtain__inner">' +
        '<div class="curtain__mark">微</div>' +
        '<div class="curtain__bar"></div>' +
      "</div>";
    document.body.appendChild(el);
    var done = false;
    function lift() {
      if (done) return;
      done = true;
      requestAnimationFrame(function () {
        el.classList.add("is-up");
        setTimeout(function () { el.remove(); }, 1000);
      });
    }
    // 不依赖 window.load：外部字体等资源可能长时间未就绪
    if (document.readyState === "complete") {
      setTimeout(lift, 180);
    } else {
      window.addEventListener("load", function () { setTimeout(lift, 180); });
      setTimeout(lift, 900);
    }
  }

  /* ---------------------------------------------------------- 导航 */
  function renderNav() {
    var page = currentPage();
    var onJoin = page === "join.html";
    // 桌面导航跳过「加入微光」——它由右侧 CTA 按钮承担，避免出现两个同样的入口
    var links = NAV.filter(function (n) { return n.href !== "join.html"; }).map(function (n) {
      return '<a class="nav__link' + (n.href === page ? " is-active" : "") +
             '" href="' + n.href + '">' + n.label + "</a>";
    }).join("");

    var drawer = NAV.map(function (n, i) {
      return '<a href="' + n.href + '"><span>' + String(i + 1).padStart(2, "0") + "</span>" + n.label + "</a>";
    }).join("");

    var nav = document.createElement("header");
    nav.className = "nav";
    nav.innerHTML =
      '<div class="wrap">' +
        '<div class="nav__inner">' +
          '<a class="nav__brand" href="index.html" aria-label="' + SITE.name + ' 首页">' +
            '<img src="assets/img/brand/mark.png" alt="">' +
            '<span class="nav__brand-txt">微光摄影社<small>柳铁一中 · Glimmer</small></span>' +
          "</a>" +
          '<nav class="nav__links" aria-label="主导航">' + links +
            '<a class="nav__cta' + (onJoin ? " is-active" : "") + '" href="join.html"' +
              (onJoin ? ' aria-current="page"' : "") + ">加入微光</a>" +
          "</nav>" +
          '<button class="nav__burger" type="button" aria-label="打开菜单" aria-expanded="false">' +
            "<i></i><i></i><i></i>" +
          "</button>" +
        "</div>" +
      "</div>";

    var dr = document.createElement("div");
    dr.className = "nav__drawer";
    dr.innerHTML = drawer +
      '<div class="nav__drawer-foot">' +
        SITE.name + "<br>" + SITE.en + "<br>" +
        "学生自主运营 · 学校社团背书" +
      "</div>";

    var host = $("[data-nav]") || document.body;
    if ($("[data-nav]")) {
      var mount = $("[data-nav]");
      mount.parentNode.insertBefore(nav, mount);
      mount.parentNode.insertBefore(dr, mount);
      mount.remove();
    } else {
      document.body.insertBefore(dr, document.body.firstChild);
      document.body.insertBefore(nav, document.body.firstChild);
    }

    // 滚动状态
    var onScroll = function () {
      nav.classList.toggle("is-stuck", window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // 抽屉
    var burger = $(".nav__burger", nav);
    burger.addEventListener("click", function () {
      var open = dr.classList.toggle("is-open");
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    });
    $$("a", dr).forEach(function (a) {
      a.addEventListener("click", function () {
        dr.classList.remove("is-open");
        burger.classList.remove("is-open");
        document.body.style.overflow = "";
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && dr.classList.contains("is-open")) burger.click();
    });

    return nav;
  }

  /* ---------------------------------------------------------- 页脚 */
  function renderFoot() {
    var el = document.createElement("footer");
    el.className = "foot";
    el.innerHTML =
      '<div class="wrap">' +
        '<div class="foot__grid">' +
          "<div>" +
            '<img class="foot__logo" src="assets/img/brand/logo-ondark.png" alt="' + SITE.name + '">' +
            '<p class="foot__slogan">' + SITE.slogan + "</p>" +
            '<p style="margin:16px 0 0;font-size:.82rem;line-height:1.95;opacity:.62;max-width:36ch">' +
              "汇聚细碎光影，留存滚烫青春。成为微光，与我们一起。" +
            "</p>" +
          "</div>" +
          "<div>" +
            "<h4>浏览</h4>" +
            '<div class="foot__links">' +
              NAV.map(function (n) { return '<a href="' + n.href + '">' + n.label + "</a>"; }).join("") +
            "</div>" +
          "</div>" +
          "<div>" +
            "<h4>联系我们</h4>" +
            '<div class="foot__links">' +
              '<a href="join.html">招新与报名</a>' +
              '<span style="opacity:.6">抖音 · 官网 · 作品展示</span>' +
              '<span style="opacity:.6">校内社团活动中心</span>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="foot__bar">' +
          "<span>© " + new Date().getFullYear() + " " + SITE.name + " · " + SITE.en + "</span>" +
          "<span>本站由学生团队独立运营，拥有学校社团背书，不属于学校官方平台。</span>" +
          "<span>全部作品为社员原创实拍 · 禁止搬运</span>" +
        "</div>" +
      "</div>";
    var host = $("[data-foot]");
    if (host) { host.replaceWith(el); } else { document.body.appendChild(el); }
  }

  /* ---------------------------------------------------------- 滚动入场 */
  var SHOT = /[?&]shot=1/.test(location.search);

  function reveals() {
    var els = $$("[data-reveal]");
    if (!els.length) return;
    // 调试/截图模式：跳过入场动画，直接呈现最终状态
    if (SHOT) {
      document.documentElement.classList.add("no-anim");
      els.forEach(function (e) { e.classList.add("is-in"); });
      $$('img[loading="lazy"]').forEach(function (im) {
        im.loading = "eager";
        if (im.dataset && im.dataset.src) im.src = im.dataset.src;
        else im.src = im.getAttribute("src");
      });
      return;
    }
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (e) { e.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("is-in");
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -9% 0px", threshold: 0.08 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---------------------------------------------------------- 数字滚动 */
  function counters() {
    var els = $$("[data-count]");
    if (!els.length) return;
    var run = function (el) {
      var target = parseFloat(el.getAttribute("data-count"));
      var dec = (el.getAttribute("data-count").split(".")[1] || "").length;
      var dur = 1400, t0 = null;
      function step(t) {
        if (!t0) t0 = t;
        var p = Math.min(1, (t - t0) / dur);
        var e = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * e).toFixed(dec);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = target.toFixed(dec);
      }
      requestAnimationFrame(step);
    };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { run(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.4 });
    if (SHOT) { els.forEach(function (e) { e.textContent = e.getAttribute("data-count"); }); return; }
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---------------------------------------------------------- 视差 */
  function parallax() {
    var els = $$("[data-parallax]");
    if (!els.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var ticking = false;
    function update() {
      var vh = window.innerHeight;
      els.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -80 || r.top > vh + 80) return;
        var speed = parseFloat(el.getAttribute("data-parallax")) || 0.12;
        var p = (r.top + r.height / 2 - vh / 2) / vh;
        el.style.transform = "translate3d(0," + (-p * speed * 100).toFixed(2) + "px,0)";
      });
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ---------------------------------------------------------- 灯箱 */
  var LB = (function () {
    var el, imgEl, capEl, countEl, exifEl, list = [], idx = 0;

    function build() {
      el = document.createElement("div");
      el.className = "lb";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "作品大图查看");
      el.innerHTML =
        '<div class="lb__top">' +
          '<span class="lb__count"></span>' +
          '<button class="lb__close" type="button">关闭 ESC</button>' +
        "</div>" +
        '<div class="lb__stage">' +
          '<button class="lb__nav lb__nav--prev" type="button" aria-label="上一张">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 19l-7-7 7-7"/></svg>' +
          "</button>" +
          '<img class="lb__img" alt="">' +
          '<button class="lb__nav lb__nav--next" type="button" aria-label="下一张">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 5l7 7-7 7"/></svg>' +
          "</button>" +
        "</div>" +
        '<div class="lb__cap"><h3></h3><p></p></div>' +
        '<div class="lb__exif"></div>';

      document.body.appendChild(el);
      imgEl   = $(".lb__img", el);
      capEl   = $(".lb__cap h3", el);
      countEl = $(".lb__count", el);
      exifEl  = $(".lb__exif", el);

      $(".lb__close", el).addEventListener("click", close);
      $(".lb__nav--prev", el).addEventListener("click", function () { go(-1); });
      $(".lb__nav--next", el).addEventListener("click", function () { go(1); });
      el.addEventListener("click", function (e) {
        if (e.target === el || e.target.classList.contains("lb__stage")) close();
      });

      // 手势
      var x0 = null;
      el.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      el.addEventListener("touchend", function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 52) go(dx < 0 ? 1 : -1);
        x0 = null;
      }, { passive: true });

      document.addEventListener("keydown", function (e) {
        if (!el.classList.contains("is-open")) return;
        if (e.key === "Escape") close();
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      });
    }

    function render() {
      var it = list[idx];
      if (!it) return;
      imgEl.src = it.src;
      imgEl.alt = it.title || "";
      capEl.textContent = it.title || "";
      $(".lb__cap p", el).textContent = it.sub || it.group || "";
      countEl.textContent = String(idx + 1).padStart(2, "0") + " / " + String(list.length).padStart(2, "0");
      if (exifEl) exifEl.innerHTML = exifLine(it.shot);
    }

    /* 拍摄信息行：机型 · 镜头 · 光圈 快门 ISO 焦段
       字段由 _tools/build_assets.py 从原图 EXIF 自动抽取，缺字段自动跳过 */
    function exifLine(shot) {
      if (!shot) return "";
      var out = [];
      ["camera", "lens"].forEach(function (k) {
        if (shot[k]) out.push("<i>" + esc(shot[k]) + "</i>");
      });
      var spec = ["aperture", "shutter", "iso", "focal"].map(function (k) {
        return shot[k] ? esc(shot[k]) : "";
      }).filter(Boolean).join(" · ");
      if (spec) out.push(spec);
      if (shot.date) out.push(esc(shot.date));
      return out.join("　");
    }

    /* 切换上下张。
       旧实现是 animation:none → void offsetWidth → animation:""，
       「强制同步布局 + 重挂动画」会让图片先跳回基准态再重新缩放，看起来就是二次抽动。
       现在改为：只做一次极短的透明度过渡（is-step），完全不动 transform。 */
    function step(d) {
      imgEl.classList.add("is-step");
      imgEl.style.opacity = "0";
      var done = false;
      var swap = function () {
        if (done) return;
        done = true;
        imgEl.style.opacity = "";
        render();
      };
      // transitionend 为主，setTimeout 兜底（换图不触发 transition 时也能推进）
      imgEl.addEventListener("transitionend", function onEnd(e) {
        if (e.propertyName !== "opacity") return;
        imgEl.removeEventListener("transitionend", onEnd);
        swap();
      });
      setTimeout(swap, 200);
    }

    function go(d) {
      idx = (idx + d + list.length) % list.length;
      step(d);
    }

    function open(items, i) {
      if (!el) build();
      list = items;
      idx = i || 0;
      render();
      el.classList.add("is-open");
      document.body.style.overflow = "hidden";
    }

    function close() {
      el.classList.remove("is-open");
      document.body.style.overflow = "";
    }

    return { open: open, close: close };
  })();

  window.Lightbox = LB;

  /* ---------------------------------------------------------- 作品卡片 */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function workCard(item, i, delay) {
    // 原始比例做温和钳制：避免超宽/超高的图把网格参差拉得过大
    var ar = Math.min(1.6, Math.max(0.8, item.ratio || 1.5));
    var h = Math.max(1, Math.round(880 / ar));
    return '<button class="work" type="button" data-i="' + i + '" ' +
             'style="--ar:' + ar + ";animation-delay:" + ((delay || 0) + Math.min(i, 12) * 45) + 'ms" ' +
             'aria-label="查看作品：' + esc(item.title) + '">' +
             '<span class="work__ph">' +
               '<img src="' + item.thumb + '" alt="' + esc(item.title + " · " + item.group) + '" ' +
                 'loading="lazy" decoding="async" width="880" height="' + h + '">' +
               '<span class="work__zoom" aria-hidden="true">' +
                 '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                   '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6M11 8v6M8 11h6"/></svg>' +
               "</span>" +
             "</span>" +
             '<span class="work__meta">' +
               '<span class="work__title">' + esc(item.title) + "</span>" +
               '<span class="work__group">' + esc(item.group) + "</span>" +
             "</span>" +
           "</button>";
  }

  /* 绑定一组卡片到灯箱 */
  function bindCards(root, items) {
    var cards = $$(".work", root);
    cards.forEach(function (c) {
      c.addEventListener("click", function () {
        LB.open(items, parseInt(c.getAttribute("data-i"), 10) || 0);
      });
    });
  }

  window.Glimmer = { $: $, $$: $$, esc: esc, workCard: workCard, bindCards: bindCards, SHOT: SHOT };

  /* 动态渲染出来的图片：调试/截图模式下立即加载，避免懒加载留白 */
  function eagerAll(root) {
    if (!SHOT || !root) return;
    $$('img[loading="lazy"]', root).forEach(function (im) {
      im.loading = "eager";
      var s = im.getAttribute("src");
      if (s) im.src = s;
    });
  }
  window.Glimmer.eagerAll = eagerAll;

  /* ---------------------------------------------------------- 启动 */
  function boot() {
    curtain();
    renderNav();
    renderFoot();
    reveals();
    counters();
    parallax();
    // 截图模式下的起始偏移：?shot=1&begin=4000
    if (SHOT) {
      var b = location.search.match(/begin=(\d+)/);
      if (b) document.body.style.marginTop = "-" + b[1] + "px";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
