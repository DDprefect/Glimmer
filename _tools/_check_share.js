const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = "D:/ai工作/微光网站";
const html = fs.readFileSync(path.join(root, "share.html"), "utf8");
const js = fs.readFileSync(path.join(root, "assets/js/site.js"), "utf8");

const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
let body = bodyMatch ? bodyMatch[1] : html;
body = body.replace(/<script[\s\S]*?<\/script>/gi, ""); // 去掉外链脚本，避免 jsdom 加载

const dom = new JSDOM("<!DOCTYPE html><html><body>" + body + "</body></html>", {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "https://example.com/share.html",
});
const w = dom.window, d = w.document;
w.addEventListener("error", (e) => console.error("window error:", e.message));

try { w.eval(js); } catch (e) { console.error("eval error:", e.message); }

setTimeout(() => {
  const r = [];
  r.push("nav rendered     = " + !!d.querySelector(".nav"));
  r.push("data-zoom count  = " + d.querySelectorAll("[data-zoom]").length);
  r.push("data-share-qq    = " + d.querySelectorAll("[data-share-qq]").length + "  (期望 0)");
  r.push("wpa.qq.com link  = " + d.querySelectorAll('a[href*="wpa.qq.com"]').length + "  (期望 0)");
  r.push("data-copy-blurb  = " + d.querySelectorAll("[data-copy-blurb]").length + "  (期望 1)");
  r.push("data-copy-link   = " + d.querySelectorAll("[data-copy-link]").length + "  (期望 1)");

  const qr = d.querySelector("[data-zoom]");
  if (!qr) { r.push("NO [data-zoom] FOUND"); console.log(r.join("\n")); return; }
  qr.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const z = d.querySelector(".zoom");
  r.push("zoom built       = " + !!z);
  r.push("zoom is-open     = " + (z ? z.classList.contains("is-open") : "n/a"));
  const zi = z && z.querySelector("img");
  r.push("zoom img src     = ..." + (zi ? (zi.getAttribute("src") || "").slice(-22) : "n/a"));
  if (z) {
    z.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    r.push("zoom closed      = " + !z.classList.contains("is-open"));
  }

  // 复制兜底验证：jsdom 无 Clipboard API，应走 execCommand 兜底
  d.execCommand = function () { return true; };
  const blurb = d.querySelector("[data-copy-blurb]");
  blurb.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  setTimeout(() => {
    r.push("copy-blurb 反馈  = " + JSON.stringify(blurb.textContent.trim()));
    const link = d.querySelector("[data-copy-link]");
    link.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    setTimeout(() => {
      r.push("copy-link 反馈   = " + JSON.stringify(link.textContent.trim()));
      console.log(r.join("\n"));
    }, 150);
  }, 150);
}, 500);
