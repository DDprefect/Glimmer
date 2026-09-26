/* ==========================================================================
   微光摄影社 · 运行时长度量
   自 2016-09-10 00:00 起持续走动的「年 / 天 / 时 / 分 / 秒」。
   数字用纵向滚动的里程表（odometer）呈现：数值递增时画面向下推进。
   无依赖，原生实现，file:// 直接打开亦可正常工作。

   —— 滚动实现要点（别改回去）——
   每一位渲染成一条「静态条带」，读数变化只改 CSS 变量 --n，
   位移交给 transform 表达：滚动过程零 DOM 增删、零强制回流，全程走合成层。
   早期版本是「每次变化现场造一个临时数字节点」，带来了三重问题：
     ① 旧值被写成裸文本节点、新值才是元素 → 两者行高不同，相邻顺序还会
        因 i % 2 而互换，于是出现「4 上方是 3」而不是 5；
     ② .since__num 的 align-items:center 会把变高后的条带居中掉半格 → 错位；
     ③ 每帧强制回流 + 双 rAF 起步 + 兜底定时器 → 每秒一次重排，观感卡顿。
   ========================================================================== */
(function () {
  "use strict";

  /* 成立时刻：2016-09-10 零点（本地时区） */
  var START = new Date(2016, 8, 10, 0, 0, 0, 0);

  var $  = function (s, r) { return (r || document).querySelector(s); };

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
  /* 条带自上而下数值递减 —— 与「递增时画面下移」严格对应：
     显示在窗口里的数字，其正上方永远比它大 1（4 的上方是 5）。
       idx :  0 | 1  2  3  4  5  6  7  8  9  10 | 11 12 13 ... 20
       val :  0 | 9  8  7  6  5  4  3  2  1   0 |  9  8  7  ...  0
                └─ 上环（绕回 / 进位时借用）──┘└─── 常驻环 ───┘
     同一数值在条带上至少有两处（常驻环 + 上环），每次取「严格高于当前位置、
     且距离最近」的那一个，于是任何变化（含 9→0、进位 5→0）都只向下走一格，
     永远不会倒着滚回去。                                                    */
  var HOME  = 20;   // 常驻环：数值 v 的常驻下标 = HOME - v
  var UPPER = 10;   // 上环：  数值 v 的上环下标 = UPPER - v（v = 0 额外还有下标 0）

  /* 条带上第 k 格是什么数字 */
  function cellValue(k) {
    if (k === 0) return 0;
    return k <= UPPER ? UPPER - k : HOME - k;
  }

  /* 从当前下标 cur 出发，找到数值 v 的那个「向下可及、且最近」的下标 */
  function nearestBelow(cur, v) {
    var cand = [HOME - v, UPPER - v];
    if (v === 0) cand.push(0);
    var best = -1, i;
    for (i = 0; i < cand.length; i++) {
      if (cand[i] < cur && cand[i] > best) best = cand[i];
    }
    if (best < 0) {                       // 兜底：已在条带顶端，取最近的一处
      best = cand[0];
      for (i = 1; i < cand.length; i++) if (cand[i] < best) best = cand[i];
    }
    return best;
  }

  function Reel(el) {
    this.el = el;
    this.slots = [];   // { node, v, idx }
    this.value = null;
  }

  /* 一次性铺好每一位整整 21 格，此后不再碰 DOM 结构 */
  Reel.prototype._build = function (text) {
    this.value = text;
    this.el.textContent = "";
    this.slots = [];
    // 条带里含 0–9 全部数字，读屏会把它们读成一串乱码：视觉层整体隐藏，
    // 真正的读数走 [data-since-sr] 那条 aria-live 通道。
    this.el.setAttribute("aria-hidden", "true");

    for (var i = 0; i < text.length; i++) {
      var slot = document.createElement("span");
      slot.className = "since__reel";
      for (var k = 0; k <= HOME; k++) {
        var cell = document.createElement("span");
        cell.className = "since__digit";
        cell.textContent = String(cellValue(k));
        slot.appendChild(cell);
      }
      this.el.appendChild(slot);

      var v = +text.charAt(i);
      var idx = HOME - v;
      slot.style.setProperty("--n", idx);      // 初值：直接落在真值，不做 0 → 真值 的补间
      this.slots.push({ node: slot, v: v, idx: idx });
    }
  };

  /* 单个数位推进到新值 */
  Reel.prototype._roll = function (i, v, animate) {
    var slot = this.slots[i];
    if (!slot || slot.v === v) return;

    if (!animate) {
      var j = HOME - v;
      slot.node.style.setProperty("--n", j);
      slot.v = v;
      slot.idx = j;
      return;
    }

    // 上一个读数停在了上环（例如进位后借道），先不动声色地归位到常驻环。
    // 这里的一次强制回流约每十来次变化才发生一次，而非每秒一次。
    if (slot.idx <= UPPER) {
      var back = HOME - slot.v;
      this.el.classList.add("is-jam");        // 临时掐掉过渡，归位不能被看见
      slot.node.style.setProperty("--n", back);
      slot.idx = back;
      void this.el.offsetHeight;              // 冲刷样式，让归位真正生效
      this.el.classList.remove("is-jam");
    }

    var target = nearestBelow(slot.idx, v);
    slot.node.style.setProperty("--n", target);
    slot.v = v;
    slot.idx = target;
  };

  Reel.prototype.render = function (value, animate) {
    var next = String(value);
    var prev = this.value;

    // 首次渲染 / 位数变化（如 099 → 100）：拆解重建，直接落到真值，此帧不做位移
    if (prev === null || next.length !== prev.length) {
      this._build(next);
      return;
    }
    if (next === prev) return;

    // 逐位对比，只推进发生变化的位
    for (var i = 0; i < next.length; i++) {
      if (next.charAt(i) !== prev.charAt(i)) this._roll(i, +next.charAt(i), animate);
    }
    this.value = next;
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

    var sr = $("[data-since-sr]", root);
    var seen = false;

    function tick(animate) {
      var t = breakdown(new Date());
      for (var i = 0; i < dims.length; i++) {
        var k = dims[i];
        var v = t[k];
        // 天/时/分/秒固定两位，滚动更整齐；年不补零
        if (k !== "y" && v < 10) v = "0" + v;
        reels[k].render(v, animate);
      }
      if (sr) {
        sr.textContent = "微光摄影社自 2016 年 9 月 10 日成立至今，已走过 " +
          t.y + " 年 " + t.d + " 天 " + t.h + " 小时 " + t.m + " 分 " + t.s + " 秒。";
      }
    }

    // 先给初值（无动画），确认落稳后再打开过渡 —— 首屏绝不会从 0 起跳
    tick(false);
    seen = true;

    if (!still) {
      // 下一帧才允许动画：避免开门第一帧就把过渡算进来
      requestAnimationFrame(function () {
        dims.forEach(function (k) { reels[k].el.classList.add("is-live"); });
      });
    }

    // 秒针走动的节拍：对齐到整秒，读数始终真实
    var timer = null;
    function loop() {
      clearTimeout(timer);
      if (document.hidden) return;
      tick(true);
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
    window.addEventListener("pageshow", function () { tick(true); });

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
