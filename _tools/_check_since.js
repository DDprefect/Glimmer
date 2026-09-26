/* 秒位（以及其余各列）滚动内核回归断言 —— 开发工具，不属于站点运行时。
   用法：
     NODE_PATH=<含 jsdom 的 node_modules> node _tools/_check_since.js
   覆盖：
     1. 条带排布：显示値的正上方必须是它 +1（4 的上方是 5）
     2. 方向：任何变化都只向下走一步，9→0 也不倒滚
     3. 读数：滚动停止后窗口里的字符 == 应有读数的那一位
     4. 性能相关：走时过程中 DOM 节点数不增长（零增删）
     5. 无运行时错误                                                        */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const KEY = "s";                      // 本次重点：秒位；同时连带检查其它列
const fail = [];
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) fail.push(msg); };

(async () => {
  const html = fs.readFileSync(path.join(ROOT, "about.html"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "assets", "js", "since.js"), "utf8");
  const dom = new JSDOM(html, { url: "http://local.test/about.html", pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  w.addEventListener("error", (e) => fail.push("PAGE ERROR: " + e.message));

  // 冻结时钟到 2026-09-26 10:00:00，随后按 1s 步长手动推进
  const RD = w.Date;
  let now = new RD(2026, 8, 26, 10, 0, 0, 0).getTime();
  class FD extends RD {
    constructor() { if (arguments.length === 0) { super(now); } else { super(...arguments); } }
    static now() { return now; }
  }
  w.Date = FD;
  w.eval(js);

  await new Promise((r) => setTimeout(r, 150));

  const num = w.document.querySelector('[data-since-reel="' + KEY + '"]');
  const slots = Array.from(num.children);

  console.log("\n[1] 结构：每位一条 21 格静态条带");
  ok(slots.length === 2, "秒位由 2 个数位组成（实际 " + slots.length + "）");
  ok(slots.every((s) => s.children.length === 21), "每位数位都是 21 格（实际 " + slots.map((s) => s.children.length).join("/") + "）");
  const strip = Array.from(slots[1].children).map((c) => c.textContent).join("");
  console.log("        个位条带自上而下 = " + strip);
  ok(strip === "098765432109876543210", "条带排布：0 | 9..0 | 9..0");

  const idxOf = (slot) => parseInt(slot.style.getPropertyValue("--n"), 10);
  const shown = (slot) => slot.children[idxOf(slot)].textContent;

  console.log("\n[2] 顺序：静止时显示値的正上方必须是 +1（4 的上方是 5）");
  let orderOk = true;
  for (let v = 0; v < 10; v++) {
    const i = 20 - v;                       // 常驻位
    const above = parseInt(slots[1].children[i - 1].textContent, 10);
    if (above !== (v + 1) % 10) { orderOk = false; console.log("        " + v + " 的上方是 " + above + "，应为 " + ((v + 1) % 10)); }
  }
  ok(orderOk, "10 个数字的邻接关系全部正确");

  console.log("\n[3] 方向 / 读数：连续走 70 秒，逐步核对");
  const before = num.getElementsByTagName("*").length;
  let dirOk = true, readOk = true, jumpSeen = 0;
  let prevOnes = idxOf(slots[1]), prevTens = idxOf(slots[0]);
  for (let n = 1; n <= 70; n++) {
    now += 1000;
    w.Glimmer.sinceTick(true);
    const secs = n % 60;
    const wantT = String(Math.floor(secs / 10));
    const wantO = String(secs % 10);
    if (shown(slots[0]) !== wantT || shown(slots[1]) !== wantO) {
      readOk = false;
      console.log("        n=" + n + " 读出 " + shown(slots[0]) + shown(slots[1]) + "，应为 " + wantT + wantO);
    }
    const iO = idxOf(slots[1]);
    if (iO !== prevOnes) {
      if (iO > prevOnes) jumpSeen++;
      if (iO > prevOnes && prevOnes > 10) { dirOk = false; console.log("        n=" + n + " 个位向上倒滚： " + prevOnes + " -> " + iO); }
      prevOnes = iO;
    }
    const iT = idxOf(slots[0]);
    if (iT !== prevTens) {
      if (iT > prevTens && prevTens > 10) { dirOk = false; console.log("        n=" + n + " 十位向上倒滚： " + prevTens + " -> " + iT); }
      prevTens = iT;
    }
  }
  ok(readOk, "70 秒逐帧读数全部正确");
  ok(dirOk, "没有任何一次向上倒滚（含 9→0 与 5→0 进位）");
  ok(jumpSeen > 0, "发生过条带归位（" + jumpSeen + " 次），归位路径已被覆盖");

  console.log("\n[4] 稳定性：走时过程中不新建 / 不销毁节点");
  const after = num.getElementsByTagName("*").length;
  ok(before === after && after === 2 + 2 * 21, "节点数恒为 " + before + "（事后 " + after + "，应为 44）");
  ok(num.getAttribute("aria-hidden") === "true", "视觉层已 aria-hidden，读数走 aria-live 通道");

  console.log("\n[5] 初值：首帧不带动画类，落在真值上");
  const fresh = new JSDOM(html, { url: "http://local.test/about.html", pretendToBeVisual: true, runScripts: "outside-only" });
  const w2 = fresh.window;
  const RD2 = w2.Date;
  const frozen = new RD2(2026, 8, 26, 10, 0, 0, 0).getTime();
  class FD2 extends RD2 {
    constructor() { if (arguments.length === 0) { super(frozen); } else { super(...arguments); } }
    static now() { return frozen; }
  }
  w2.Date = FD2;
  w2.eval(js);
  await new Promise((r) => setTimeout(r, 150));
  const num2 = w2.document.querySelector('[data-since-reel="' + KEY + '"]');
  const s1 = num2.children[1];
  ok(num2.children.length === 2, "首屏即两位");
  ok(s1.children[parseInt(s1.style.getPropertyValue("--n"), 10)].textContent === "0", "首帧直接落在真值（个位 0），未从 0 起跳");

  console.log("\n[6] 其余各列不受影响");
  const dims = ["y", "d", "h", "m", "s"];
  const cells = dims.map((k) => {
    const el = w.document.querySelector('[data-since-reel="' + k + '"]');
    return el.children.length ? Array.from(el.children).every((s) => s.children.length === 21) : false;
  });
  ok(cells.every(Boolean), "年 / 天 / 时 / 分 / 秒 五列结构一致且完好");

  console.log("\n" + (fail.length ? "=== 失败 " + fail.length + " 项 ===" : "=== 全部通过 ==="));
  process.exit(fail.length ? 1 : 0);
})();
