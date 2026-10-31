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
    { href: "upload.html",  label: "投稿",     en: "Submit" },
    { href: "share.html",   label: "分享微光", en: "Share" },
    { href: "join.html",    label: "加入微光", en: "Join"  }
  ];

  /* ---------------------------------------------------------- 招新状态胶囊
     首页首屏 kicker 那一行的小胶囊（不是整条横带——横条会把画面切断）。
     改这里的配置即可切换「招新中 / 已结束 / 不显示」，不用动页面结构。
       show  总开关：false 则胶囊不出现
       open  true=招新中（点了去报名），false=已结束（点了去加群等通知）
     文案尽量短，胶囊一行放得下才不抢画面。 */
  var RECRUIT = {
    show: true,
    open: true,
    openText: "秋季招新进行中",
    openLink: "join.html#form",
    closeText: "本轮招新已结束 · 加群等通知",
    closeLink: "share.html"
  };

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
    // 桌面导航跳过「加入微光」（由右侧 CTA 承担，避免两个同样入口）
    // 与「分享微光」（放抽屉与页脚就够了，桌面主导航保持清爽；抽屉与页脚仍是全量）
    var links = NAV.filter(function (n) {
      return n.href !== "join.html" && n.href !== "share.html";
    }).map(function (n) {
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
              '<a href="upload.html">作品投稿</a>' +
              '<a href="share.html">关注与分享</a>' +
            "</div>" +
            /* 账号可以直接点：复制比抄写靠谱，手机上也省事 */
            '<div class="foot__acct">' +
              '<button class="foot__copy" type="button" data-copy="1159554310">' +
                "<span>官方 QQ</span><b>1159554310</b><i>点击复制</i>" +
              "</button>" +
              '<button class="foot__copy" type="button" data-copy="ltyz_GLIMMER">' +
                "<span>官方抖音</span><b>ltyz_GLIMMER</b><i>点击复制</i>" +
              "</button>" +
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

  /* ---------------------------------------------------------- 招新状态条
     只有首页有 <div id="rbar"> 这个挂载点，其它页面自动跳过。
     招新中：一条深色提示，点右边按钮直接滚到报名表单；
     已结束：导流到官方 QQ 群，别让同学空手而归。 */
  function renderRecruit() {
    var el = $("#rbar");
    if (!el || !RECRUIT.show) return;
    var open = !!RECRUIT.open;
    el.hidden = false;
    el.innerHTML =
      '<a class="hero__recruit" href="' + (open ? RECRUIT.openLink : RECRUIT.closeLink) + '">' +
        '<i aria-hidden="true"></i>' + esc(open ? RECRUIT.openText : RECRUIT.closeText) +
        "<span aria-hidden=\"true\">→</span>" +
      "</a>";
  }

  /* ---------------------------------------------------------- 复制文本
     双击 index.html 走 file:// 时浏览器不是安全上下文，navigator.clipboard
     可能不存在、也可能存在但 writeText 直接 reject。因此只在安全上下文且
     API 可用时才用原生接口，任何失败都回落到 execCommand。
     页脚「点击复制」、灯箱「复制本张链接」、分享按钮共用这一份。 */
  function copyText(text) {
    function legacy() {
      return new Promise(function (resolve, reject) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        ta.remove();
        ok ? resolve() : reject();
      });
    }
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacy(); });
    }
    return legacy();
  }

  /* 临时改文案做反馈：备份 innerHTML，避免把按钮里的图标弄丢 */
  function flash(el, txt) {
    if (!el.dataset.origHtml) el.dataset.origHtml = el.innerHTML;
    el.innerHTML = txt;
    el.classList.add("is-done");
    setTimeout(function () {
      el.innerHTML = el.dataset.origHtml;
      el.classList.remove("is-done");
    }, 1800);
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

  /* ---------------------------------------------------------- 单作品深链
     gallery.html#photo-<id>：数据库作品 id 形如 "db-123"，静态作品形如
     "hanlou-01"，统一去掉 db- 前缀后拼到作品集地址上。
     同学把自己的作品甩进 QQ 群，点开就直接放大那一张——这是全站唯一
     一个「让同学帮社团拉新」的动作，所以灯箱里给了复制按钮。 */
  function workLink(it) {
    if (!it || !it.id) return "";
    var base = location.href.split("#")[0].replace(/[^/]*$/, "");
    return base + "gallery.html#photo-" + String(it.id).replace(/^db-/, "");
  }
  window.GlimmerWorkLink = workLink;

  /* ---------------------------------------------------------- 灯箱 */
  var LB = (function () {
    var el, imgEl, capEl, countEl, exifEl, copyEl, list = [], idx = 0;

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
        '<div class="lb__cap"><h3></h3><p></p>' +
          '<button class="lb__copy" type="button" hidden>复制本张链接</button>' +
          '<button class="lb__copy lb__dl" type="button" hidden title="在浏览器中打开原图，右键或长按即可保存">下载原图</button>' +
        "</div>" +
        '<div class="lb__exif"></div>';

      document.body.appendChild(el);
      imgEl   = $(".lb__img", el);
      capEl   = $(".lb__cap h3", el);
      countEl = $(".lb__count", el);
      exifEl  = $(".lb__exif", el);
      copyEl  = $(".lb__copy", el);
      dlEl    = $(".lb__dl", el);

      /* 复制当前这张的深链。没有 id 的条目（理论上不会有）按钮不出现。 */
      copyEl.addEventListener("click", function () {
        var url = workLink(list[idx]);
        if (!url) return;
        copyText(url).then(
          function () { flash(copyEl, "链接已复制 ✓"); },
          function () { flash(copyEl, "复制失败，请手动复制地址栏"); }
        );
      });

      /* 下载原图（v2.2.0）：新标签页打开原图（带水印版），跨域 file:// 场景
         也能用；浏览器对跨域资源忽略 download 属性，打开后右键/长按保存 */
      dlEl.addEventListener("click", function () {
        var it = list[idx];
        if (!it || !it.src) return;
        window.open(it.src, "_blank", "noopener");
      });

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
      if (copyEl) copyEl.hidden = !workLink(it);
      if (dlEl) dlEl.hidden = !it.src;
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
        imgEl.classList.remove("is-step");
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

  /* ---------------------------------------------------------- 二维码放大
     点击 [data-zoom] 的二维码，弹出可放大查看的浮层，方便手机扫码。
     仅做轻量放大，不依赖任何外部库。 */
  var ZOOM = (function () {
    var el, imgEl;
    function ensure() {
      if (el) return;
      el = document.createElement("div");
      el.className = "zoom";
      el.setAttribute("aria-hidden", "true");
      el.innerHTML =
        '<div class="zoom__inner">' +
          '<img alt="二维码大图">' +
          '<p class="zoom__hint">点击空白处关闭 · 长按可保存</p>' +
        "</div>";
      document.body.appendChild(el);
      imgEl = el.querySelector("img");
      el.addEventListener("click", close);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && el.classList.contains("is-open")) close();
      });
    }
  function open(src, wide) {
    ensure();
    imgEl.src = src;
    el.classList.add("is-open");
    /* wide：照片查看用宽版浮层（二维码用默认窄版） */
    el.classList.toggle("zoom--wide", !!wide);
    document.body.style.overflow = "hidden";
  }
    function close() {
      if (!el || !el.classList.contains("is-open")) return;
      el.classList.remove("is-open");
      document.body.style.overflow = "";
    }
    return { open: open, close: close };
  })();

  function bindZoom() {
    $$("[data-zoom]").forEach(function (img) {
      img.addEventListener("click", function () { ZOOM.open(img.getAttribute("src")); });
    });
  }

  /* ---------------------------------------------------------- 作品缩图地址
     COS 图片按宽度走数据万象缩放（?imageMogr2/thumbnail/<宽>x），
     网格/后台只加载缩图，灯箱与放大才加载原图——移动端流量降一大截。
     桶若未开通数据万象，该参数会被 COS 忽略、原样返回原图（安全降级，
     页面不会坏）；本地静态图（相对路径）直接返回，不追加参数。 */
  function thumbUrl(src, w) {
    var s = String(src == null ? "" : src);
    if (!s || s.indexOf("http") !== 0) return s;
    return s + (s.indexOf("?") === -1 ? "?" : "&") + "imageMogr2/thumbnail/" + (w || 880) + "x";
  }

  /* ---------------------------------------------------------- 作品卡片 */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* URL 进 HTML 属性前的安全过滤（v2.0.12）：
     危险 scheme（javascript: / data: / vbscript: / file: 等）一律拒绝返回空串；
     http(s) 外链与站内相对路径（静态作品全是 assets/img/... 相对路径）放行，
     再过一道 esc 防 " 逃出属性。此前 workCard 的 thumb 是全站唯一裸拼 URL 的点，
     虽然来源当前可信（服务端 COS 地址 / 本地清单），统一转义消除隐患。 */
  function safeUrl(u) {
    var s = String(u == null ? "" : u).trim();
    if (!s) return "";
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s) && !/^https?:/i.test(s)) return "";
    return esc(s);
  }

  function workCard(item, i, delay) {
    // 原始比例做温和钳制：避免超宽/超高的图把网格参差拉得过大。
    // 无 ratio 的条目（数据库投稿，前端未知尺寸）先按 3:2 占位，
    // 打上 data-autorate，图片载入后按真实比例纠正（见 bindCards）。
    var hasRatio = !!item.ratio;
    var ar = hasRatio ? Math.min(1.6, Math.max(0.8, item.ratio)) : 1.5;
    var h = Math.max(1, Math.round(880 / ar));
    return '<button class="work" type="button" data-i="' + i + '" ' +
             'style="--ar:' + ar + ";animation-delay:" + ((delay || 0) + Math.min(i, 12) * 45) + 'ms" ' +
             'aria-label="查看作品：' + esc(item.title) + '">' +
             '<span class="work__ph">' +
               '<img src="' + safeUrl(item.thumb) + '" alt="' + esc(item.title + " · " + item.group) + '" ' +
                 'loading="lazy" decoding="async" width="880" height="' + h + '"' +
                 (hasRatio ? "" : ' data-autorate="1"') + ">" +
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

    /* 无比例信息的图（数据库投稿）：载入后按 naturalWidth/Height 设 --ar，
       并同步宽高属性，避免瀑布流网格被拉伸或留白 */
    $$("img[data-autorate]", root).forEach(function (im) {
      var fix = function () {
        var w = im.naturalWidth, h = im.naturalHeight;
        if (!w || !h) return;
        var ar = Math.min(1.6, Math.max(0.8, w / h));
        var card = im.closest ? im.closest(".work") : null;
        if (card) card.style.setProperty("--ar", ar);
        im.width = 880;
        im.height = Math.max(1, Math.round(880 / ar));
      };
      if (im.complete && im.naturalWidth) fix();
      else im.addEventListener("load", fix);
    });
  }

  /* ---------------------------------------------------------- 可见作品
     条目数据里带 hidden:true 的表示「已下架但保留数据」——
     图片与条目都还在，只是不再出现在任何列表 / 灯箱 / 分类计数里。
     加图、撤图都只改 works.js，不用碰各处渲染逻辑。 */
  function visibleWorks() {
    return (window.WORKS || []).filter(function (w) { return !w.hidden; });
  }

  window.Glimmer = { $: $, $$: $$, esc: esc, safeUrl: safeUrl, workCard: workCard, bindCards: bindCards, visibleWorks: visibleWorks, SHOT: SHOT, ZOOM: ZOOM, thumbUrl: thumbUrl };

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

  /* ---------------------------------------------------------- 分享与复制
     [data-copy]      复制按钮自带的值
     [data-copy-link] 复制当前页链接
     [data-copy-blurb]复制「标题 + 描述 + 链接」的整段分享文案 */
  function shareBits() {
    var pageUrl = location.href.split("#")[0];
    var title = document.title;
    var meta = document.querySelector('meta[name="description"]');
    var desc = (meta && meta.getAttribute("content")) || SITE.slogan;

    // copyText / flash 已提到模块级（灯箱「复制本张链接」也用同一份）
    function bindCopy(sel, getText, okText) {
      $$(sel).forEach(function (b) {
        b.addEventListener("click", function () {
          copyText(getText(b)).then(function () { flash(b, okText); },
            function () { flash(b, "复制失败，请手动选择"); });
        });
      });
    }

    bindCopy("[data-copy]", function (b) { return b.getAttribute("data-copy"); }, "已复制 ✓");
    bindCopy("[data-copy-link]", function () { return pageUrl; }, "链接已复制 ✓");
    bindCopy("[data-copy-blurb]", function () {
      return title + "\n" + desc + "\n" + pageUrl;
    }, "分享文案已复制 ✓");
  }

  /* ---------------------------------------------------------- 字体翻转
     各页字体 <link> 以 media="print" 异步加载避免阻塞渲染。原先靠链接上的
     内联 onload 翻转回 all，v2.0.12 起改由这里统一接管——内联事件处理器
     属于内联脚本，CSP 的 script-src 'self' 不放行（v2.0.12 安全整改）。 */
  function flipFonts() {
    $$('link[rel="stylesheet"][media="print"]').forEach(function (l) { l.media = "all"; });
  }

  /* ---------------------------------------------------------- 错误可见化
     v2.2.4 临时诊断：任何未捕获的 JS 错误 / Promise 拒绝，都在页面左下角
     弹一条红字（15 秒后自动消失）。定位「点击无反应」类故障用——
     不需要用户会按 F12。问题解决后整段移除。 */
  function errorTrap() {
    if (SHOT) return;
    function show(msg) {
      var b = document.createElement("div");
      b.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;max-width:86vw;" +
        "background:#B03A22;color:#fff;font:12px/1.6 Consolas,monospace;padding:8px 12px;" +
        "border-radius:8px;word-break:break-all;box-shadow:0 4px 16px rgba(0,0,0,.35)";
      b.textContent = "JS错误：" + msg;
      document.body.appendChild(b);
      setTimeout(function () { b.remove(); }, 15000);
    }
    window.addEventListener("error", function (e) {
      show((e.message || "未知错误") + " @ " + String(e.filename || "").split("/").pop() + ":" + e.lineno);
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e.reason;
      show("Promise未处理：" + ((r && (r.message || r.code)) || String(r)).slice(0, 200));
    });
  }

  /* ---------------------------------------------------------- 启动 */
  function boot() {
    errorTrap();
    flipFonts();
    curtain();
    renderNav();
    renderRecruit();
    renderFoot();
    reveals();
    counters();
    parallax();
    shareBits();
    bindZoom();
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
