/* ==========================================================================
   微光摄影社 · 管理后台
   单密码登录（密码只存 sessionStorage，每次请求都带给服务端比对）；
   动作：审核通过 / 删除作品（连 COS 文件）/ 查看与导出报名。
   ========================================================================== */
(function () {
  "use strict";

  var G = window.Glimmer || {};
  var $ = G.$ || function (s, r) { return (r || document).querySelector(s); };
  var esc = G.esc || function (s) { return String(s == null ? "" : s); };

  var PW_KEY = "glimmer_admin_pw";
  var password = "";
  try { password = sessionStorage.getItem(PW_KEY) || ""; } catch (e) {}

  var loginSec = $("#login");
  var panelSec = $("#panel");
  var loginMsg = $("#login-msg");
  var panelMsg = $("#panel-msg");

  function showMsg(el, text, kind) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.remove("is-err", "is-ok");
    if (kind) el.classList.add(kind);
  }

  /* ---------------- 服务端调用 ---------------- */
  function api(action, extra) {
    var body = Object.assign({ password: password, action: action }, extra || {});
    return fetch("api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401) {
        var err = new Error("密码不正确");
        err.unauthorized = true;
        throw err;
      }
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || "操作失败（HTTP " + r.status + "）");
        return j;
      });
    });
  }

  /* ---------------- 渲染 ---------------- */
  function fmtTime(s) {
    if (!s) return "—";
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    function p(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function photoCard(p, approved) {
    var ops = approved
      ? '<button class="admin-op admin-op--del" type="button" data-act="remove" data-id="' + p.id + '">删除</button>'
      : '<button class="admin-op admin-op--ok" type="button" data-act="approve" data-id="' + p.id + '">通过</button>' +
        '<button class="admin-op admin-op--del" type="button" data-act="remove" data-id="' + p.id + '">删除</button>';
    return '<article class="admin-item">' +
      '<img class="admin-item__img" src="' + esc(p.file_url) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async">' +
      '<div class="admin-item__meta">' +
        "<h3>" + esc(p.title) + "</h3>" +
        "<p>" + esc(p.category) +
          (p.author ? " · " + esc(p.author) : "") +
          (p.shot_date ? " · 摄于 " + esc(p.shot_date) : "") +
          " · " + fmtTime(p.created_at) + "</p>" +
      "</div>" +
      '<div class="admin-item__ops">' + ops + "</div>" +
    "</article>";
  }

  function render(d) {
    $("#st-pending").textContent = d.pending.length;
    $("#st-approved").textContent = d.approved.length;
    $("#st-subs").textContent = d.submissions.length;
    $("#tab-pending").textContent = d.pending.length;
    $("#tab-approved").textContent = d.approved.length;
    $("#tab-subs").textContent = d.submissions.length;

    $("#pane-pending").innerHTML = d.pending.length
      ? d.pending.map(function (p) { return photoCard(p, false); }).join("")
      : '<p class="admin-empty">暂时没有待审核作品。同学刚提交的投稿会出现在这里。</p>';

    $("#pane-approved").innerHTML = d.approved.length
      ? d.approved.map(function (p) { return photoCard(p, true); }).join("")
      : '<p class="admin-empty">还没有已发布作品。审核通过的作品会自动出现在官网作品集。</p>';

    var rows = d.submissions.map(function (s) {
      return "<tr>" +
        "<td>" + esc(s.id) + "</td>" +
        "<td>" + esc(s.name) + "</td>" +
        "<td>" + esc(s["class"] || "—") + "</td>" +
        "<td>" + esc(s.contact) + "</td>" +
        "<td>" + esc(s.interest || "—") + "</td>" +
        "<td class='admin-table__intro'>" + esc(s.intro || "—") + "</td>" +
        "<td>" + fmtTime(s.created_at) + "</td>" +
      "</tr>";
    }).join("");
    $("#subs-table").innerHTML =
      '<table class="admin-table"><thead><tr>' +
      "<th>ID</th><th>姓名</th><th>年级班级</th><th>联系方式</th><th>感兴趣方向</th><th>想说的话</th><th>提交时间</th>" +
      "</tr></thead><tbody>" +
      (rows || '<tr><td colspan="7" class="admin-empty">还没有报名记录。</td></tr>') +
      "</tbody></table>";
  }

  function load() {
    showMsg(panelMsg, "");
    return api("list").then(render).catch(function (e) {
      if (e.unauthorized) {
        logout(true);
        showMsg(loginMsg, "登录已过期，请重新输入管理密码。", "is-err");
      } else {
        showMsg(panelMsg, e.message, "is-err");
      }
    });
  }

  function enterPanel() {
    loginSec.hidden = true;
    panelSec.hidden = false;
    load();
  }

  function logout(silent) {
    password = "";
    try { sessionStorage.removeItem(PW_KEY); } catch (e) {}
    panelSec.hidden = true;
    loginSec.hidden = false;
    if (!silent) showMsg(loginMsg, "");
  }

  /* ---------------- 事件：登录 / 退出 ---------------- */
  $("#admin-login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = $("#f-pw").value;
    if (!pw) { showMsg(loginMsg, "请输入管理密码。", "is-err"); return; }
    password = pw;
    showMsg(loginMsg, "");
    api("list").then(function () {
      try { sessionStorage.setItem(PW_KEY, pw); } catch (e) {}
      enterPanel();
    }).catch(function (err) {
      password = "";
      showMsg(loginMsg, err.unauthorized ? "密码不正确，再试一次。" : err.message, "is-err");
    });
  });

  $("#admin-logout").addEventListener("click", function () { logout(false); });

  /* ---------------- 事件：选项卡 ---------------- */
  var tabs = document.querySelectorAll(".admin-tab");
  Array.prototype.forEach.call(tabs, function (t) {
    t.addEventListener("click", function () {
      Array.prototype.forEach.call(tabs, function (x) { x.classList.remove("is-on"); });
      t.classList.add("is-on");
      var panes = document.querySelectorAll(".admin-pane");
      Array.prototype.forEach.call(panes, function (p) { p.classList.remove("is-on"); });
      $("#pane-" + t.getAttribute("data-tab")).classList.add("is-on");
    });
  });

  /* ---------------- 事件：审核 / 删除（事件委托） ---------------- */
  ["#pane-pending", "#pane-approved"].forEach(function (sel) {
    var pane = $(sel);
    if (!pane) return;
    pane.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!b) return;
      var id = b.getAttribute("data-id");
      var act = b.getAttribute("data-act");
      if (act === "approve") {
        b.disabled = true;
        api("approve", { id: id }).then(load).catch(function (err) {
          b.disabled = false;
          showMsg(panelMsg, err.message, "is-err");
        });
      } else if (act === "remove") {
        if (!window.confirm("删除后，数据库记录与 COS 里的图片都会被清掉，确定删除这张作品？")) return;
        b.disabled = true;
        api("delete", { id: id }).then(load).catch(function (err) {
          b.disabled = false;
          showMsg(panelMsg, err.message, "is-err");
        });
      }
    });
  });

  /* ---------------- 事件：导出 CSV ---------------- */
  $("#export-csv").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    showMsg(panelMsg, "");
    fetch("api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password, action: "export" })
    }).then(function (r) {
      if (r.status === 401) throw new Error("unauthorized");
      if (!r.ok) throw new Error("导出失败（HTTP " + r.status + "）");
      return r.blob();
    }).then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "glimmer-submissions.csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      showMsg(panelMsg, "CSV 已开始下载。", "is-ok");
    }).catch(function (e) {
      showMsg(panelMsg, e.message === "unauthorized" ? "登录已过期，请重新登录。" : "导出失败，请稍后重试。", "is-err");
    }).then(function () {
      btn.disabled = false;
    });
  });

  /* ---------------- 启动：带过期的密码自动进后台 ---------------- */
  if (password) {
    api("list").then(enterPanel).catch(function () { logout(true); });
  }
})();
