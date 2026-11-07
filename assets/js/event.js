/* ==========================================================================
   微光摄影社 · 活动页逻辑（v2.7.0）
   event.html?id=N
   - 拉取 /api/events?id=N：标题、日期、正文、活动作品
   - published → 显示报名表单；archived → 显示「已结束」回顾态
   - 报名提交走 /api/event-register（安全防护在服务端）
   - 作品复用站点统一的 workCard 渲染（比例、灯箱、EXIF 全部一致）
   ========================================================================== */
(function () {
  "use strict";

  var G = window.Glimmer || {};
  var $ = G.$ || function (s, r) { return (r || document).querySelector(s); };
  var esc = G.esc || function (s) { return String(s == null ? "" : s); };

  function showMsg(el, text, kind) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.remove("is-err", "is-ok");
    if (kind) el.classList.add(kind);
  }

  function renderWorks(works) {
    var sec = $("#ev-works-sec");
    var host = $("#ev-works");
    if (!sec || !host) return;
    if (!works || !works.length) return;
    /* 数据库行 → workCard 数据结构（与 gallery.js 的 dbToWork 同款裁剪） */
    var CAT_MAP = { "校园纪实": "campus", "校外采风": "field", "城市与远方": "city", "人像与视觉": "portrait" };
    var items = works.map(function (p) {
      return {
        id: "db-" + p.id,
        cat: CAT_MAP[p.category] || "",
        group: p.category,
        title: p.title,
        author: p.author || "",
        src: p.file_url,
        thumb: G.thumbUrl ? G.thumbUrl(p.file_url, 880) : p.file_url,
        sub: p.author ? p.category + " · " + p.author : p.category,
        ratio: 0,
        db: true
      };
    });
    sec.hidden = false;
    host.innerHTML = items.map(function (w, i) { return G.workCard(w, i, 0); }).join("");
    /* workCard 自带 data-reveal（滚动入场），但这里是动态插入、页面的
       IntersectionObserver 早已初始化完毕，没人再观察它们——结果是
       卡片永久 opacity:0 却占位可点（v2.7.0 事故）。直接补 is-in 立即显示。 */
    Array.prototype.forEach.call(host.querySelectorAll("[data-reveal]"), function (el) {
      el.classList.add("is-in");
    });
    if (G.bindCards) G.bindCards(host, items);
  }

  function boot() {
    var id = "";
    try { id = new URLSearchParams(location.search).get("id") || ""; } catch (e) {}
    if (!id) {
      $("#ev-title").textContent = "活动不存在";
      $("#ev-error").hidden = false;
      return;
    }

    fetch("api/events?id=" + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !j.event) {
          $("#ev-title").textContent = "活动不存在";
          $("#ev-error").hidden = false;
          return;
        }
        var ev = j.event;
        document.title = ev.title + " · 柳铁一中微光摄影社";
        $("#ev-title").textContent = ev.title;
        if (ev.activity_date) {
          var d = $("#ev-date");
          d.hidden = false;
          d.textContent = "活动日期 · " + ev.activity_date;
        }
        var body = $("#ev-content");
        body.hidden = false;
        body.textContent = ev.content || "（活动介绍待补充）";

        if (ev.status === "published") {
          $("#ev-form").hidden = false;
        } else {
          $("#ev-closed").hidden = false;
        }
        renderWorks(j.works);
      })
      .catch(function () {
        $("#ev-title").textContent = "活动加载失败";
        $("#ev-error").hidden = false;
      });
  }

  /* ---------------- 报名提交 ---------------- */
  var form = $("#ev-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msgEl = $("#ev-msg");
      var btn = $("#ev-submit");
      var name = $("#ev-name").value.trim();
      var cls = $("#ev-class").value.trim();
      var contact = $("#ev-contact").value.trim();
      var intro = $("#ev-intro").value.trim();
      /* 蜜罐：正常用户看不到这个输入框，机器人会填 */
      if ($("#ev-hp").value) { showMsg(msgEl, "提交失败，请刷新重试。", "is-err"); return; }
      if (!name) { showMsg(msgEl, "请填写姓名 / 昵称。", "is-err"); return; }
      if (!contact) { showMsg(msgEl, "请填写联系方式。", "is-err"); return; }

      btn.disabled = true;
      showMsg(msgEl, "");
      fetch("api/event-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: new URLSearchParams(location.search).get("id") || "",
          name: name, "class": cls, contact: contact, intro: intro
        })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || "提交失败");
        showMsg(msgEl, j.message || "报名成功！", "is-ok");
        /* 成功后收起表单，防止重复提交 */
        if (!j.duplicate) {
          Array.prototype.forEach.call(form.querySelectorAll("input,textarea"), function (el) {
            if (el.type !== "submit") el.value = "";
          });
        }
      }).catch(function (err) {
        showMsg(msgEl, err.message || "网络异常，请稍后再试。", "is-err");
      }).then(function () { btn.disabled = false; });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
