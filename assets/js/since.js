/* ==========================================================================
   微光摄影社 · 运行时长度量
   自 2016-09-10 00:00 起持续走动的「年 / 天 / 时 / 分 / 秒」。
   数字用纵向滚动的里程表（odometer）呈现，递增方向上滚。
   无依赖，原生实现，file:// 直接打开亦可正常工作。
   ========================================================================== */
(function () {
  "use strict";

  /* 成立时刻：2016-09-10 零点（本地时区） */
  var START = new Date(2016, 8, 10, 0, 0, 0, 0);

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 截图/调试模式：只呈静态真值，不做任何滚动（否则截到滚动中间帧会叠字）
  var SHOT = /[?&]shot=1/.test(location.search);
  var still = reduced || SHOT;

  /* ---------------------------------------------------------------- 时间差 */
  /* 日历口径：整年 + 剩余天/时/分/秒，避免「天数 = 总天数」与「年」重复计数 */
  function breakdown(now) {
    var y = now.getFullYear() - START.getFullYear();
    var anchor = new Date(START.getTime());
    anchor.setFullYear(START.getFullYear() + y);
    // 未到周年：退一年
    if (anchor.getTime() > now.getTime()) {
      y -= 1;
      anchor = new Date(START.getTime());
      anchor.setFullYear(START.getFullYear() + y);
    }
    var diff = Math.max(0, now.getTime() - anchor.getTime());
    var d = Math.floor(diff / 86400000);      diff -= d * 86400000;
    var h = Math.floor(diff / 3600000);       diff -= h * 3600000;
    var m = Math.floor(diff / 60000);         diff -= m * 60000;
    var s = Math.floor(diff / 1000);
    return { y: y, d: d, h: h, m: m, s: s };
  }

  /* ---------------------------------------------------------------- 里程表 */
  /* 每一「位」的取值交替向上/向下滚动，视觉上整组数字朝同一方向推进 */
  function Reel(el) {
    this.el = el;
    this.digits = [];   // { up: bool }
    this.text = null;
  }

  Reel.prototype.render = function (value) {
    var next = String(value);
    if (this.text === next) return;

    // 首次渲染：直接落在终值，绝不做 0 → 真值 的补间
    // 注意不能靠 DOM 是否为空判断 —— HTML 里已放了占位数字，首帧一定是「有内容」的
    var fresh = this.text === null;
    if (fresh) {
      this.el.textContent = next;
      this.text = next;
      this._build();
      return;
    }

    var recompose = next.length !== this.text.length;
    if (recompose) {
      // 位数变化（如 999 → 1000）：拆解重建，此帧不做位移
      this.el.textContent = next;
      this.text = next;
      this._build();
      return;
    }

    // 逐位对比，只滚动发生变化的位
    for (var i = 0; i < next.length; i++) {
      if (next[i] !== this.text[i]) this._spin(i, next[i]);
    }
    this.text = next;
  };

  Reel.prototype._build = function () {
    var str = this.text;
    this.el.textContent = "";
    this.digits = [];
    var self = this;

    Array.prototype.forEach.call(str, function (ch, i) {
      var slot = document.createElement("span");
      slot.className = "since__reel";
      var d = document.createElement("span");
      d.className = "since__digit";
      d.textContent = ch;
      slot.appendChild(d);
      self.el.appendChild(slot);
      // 交替方向：相邻位一上一下，滚动时像机械牌翻面
      self.digits.push({ up: i % 2 === 0, node: slot, value: ch, settle: null, timer: null });
    });

    // 位数增长（如 9→10）时重建，只需落到正确读数；不做额外动效，避免整块闪动
  };

  /* 单次滚动：在当前数字正上方（或正下方）补一位，滚动到它。
     关键：每次滚动都从「干净的单个数字」基线出发 —— 若上一次滚动尚未收敛
     （快速连续 tick / 切回前台），先把它一次性收尾，避免多个副本叠加导致读数串位。 */
  Reel.prototype._spin = function (i, ch) {
    var d = this.digits[i];
    if (!d) return;
    var slot = d.node;

    // 收尾上一轮未完成的滚动
    if (d.timer) { clearTimeout(d.timer); d.timer = null; }
    if (d.settle) { slot.removeEventListener("transitionend", d.settle); d.settle = null; }
    slot.style.transition = "none";
    slot.style.transform = "none";
    slot.textContent = d.value;                               // 只留上一轮终值单个数字

    d.value = ch;

    if (still) { slot.textContent = ch; return; }

    // 单格高度以 CSS 的 --digit-h 为准（与视窗高度、位移步长同源）
    var step = this.step || "1.34em";
    var ghost = document.createElement("span");
    ghost.className = "since__digit";
    ghost.textContent = ch;
    ghost.setAttribute("aria-hidden", "true");   // 过渡用的临时数字，读屏不读

    if (d.up) {
      slot.insertBefore(ghost, slot.firstChild);              // 新值在上，向下滑入
    } else {
      slot.appendChild(ghost);                                // 新值在下，视窗上移
    }
    slot.style.transform = "translateY(calc(-1 * " + step + "))";  // 停在「旧值」那一格

    var settle = function () {
      slot.removeEventListener("transitionend", settle);
      if (d.timer) { clearTimeout(d.timer); d.timer = null; }
      d.settle = null;
      slot.textContent = ch;                                  // 收敛为单个终值
      slot.style.transition = "none";
      slot.style.transform = "none";
      void slot.offsetWidth;
      slot.style.transition = "";
    };
    d.settle = settle;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        slot.style.transition = "transform .62s cubic-bezier(.34,.06,.16,1)";
        slot.style.transform = "none";                        // 滑到目标位
        slot.addEventListener("transitionend", settle);
        d.timer = setTimeout(settle, 720);                     // 兜底：transitionend 偶发丢失
      });
    });
  };

  /* ---------------------------------------------------------------- 装配 */
  function boot() {
    var root = $("[data-since]");
    if (!root) return;

    var dims = ["y", "d", "h", "m", "s"];
    var reels = {};
    reels.y = new Reel($('[data-since-reel="y"]', root));
    reels.d = new Reel($('[data-since-reel="d"]', root));
    reels.h = new Reel($('[data-since-reel="h"]', root));
    reels.m = new Reel($('[data-since-reel="m"]', root));
    reels.s = new Reel($('[data-since-reel="s"]', root));

    // 与 CSS 的 --digit-h 对齐：位移步长 = 视窗高度 = 单格高度
    var refNum = reels.y.el;
    var step = "1.34em";
    if (window.getComputedStyle) {
      var sz = window.getComputedStyle(refNum);
      if (sz && sz.height && sz.height !== "auto") step = sz.height;
    }
    dims.forEach(function (k) { reels[k].step = step; });

    var sr = $("[data-since-sr]", root);
    var seen = false;

    function tick() {
      var t = breakdown(new Date());
      for (var i = 0; i < dims.length; i++) {
        var k = dims[i];
        var v = t[k];
        // 天/时/分/秒固定两位，滚动更整齐；年不补零
        if (k !== "y" && v < 10) v = "0" + v;
        reels[k].render(v);
      }
      if (sr) {
        sr.textContent = "微光摄影社自 2016 年 9 月 10 日成立至今，已走过 " +
          t.y + " 年 " + t.d + " 天 " + t.h + " 小时 " + t.m + " 分 " + t.s + " 秒。";
      }
    }

    // 先给初值再做入场，避免从 0 起跳
    tick();
    seen = true;

    // 秒针走动的节拍：对齐到整秒，读数始终真实
    var timer = null;
    function loop() {
      clearTimeout(timer);
      if (document.hidden) return;
      tick();
      var ms = 1000 - (Date.now() % 1000);
      timer = setTimeout(loop, ms + 12);
    }
    // 截图模式只呈现一帧静态真值，不让数字继续跳动
    if (!SHOT) loop();

    // 切回前台立即校准（后台节流会让定时器漂移，这里一次性拉正）
    if (!SHOT) {
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) loop();
      });
      window.addEventListener("focus", function () { if (!document.hidden) loop(); });
    }

    // 设备时间/时区被调整时，重新对表
    window.addEventListener("pageshow", function () { tick(); });

    // 暴露给截图模式复用
    window.Glimmer = window.Glimmer || {};
    window.Glimmer.sinceTick = tick;
    window.Glimmer.sinceSeen = function () { return seen; };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
