/* ==========================================================================
   微光摄影社 · 管理后台
   单密码登录（密码只存 sessionStorage，每次请求都带给服务端比对）；
   待审核（可批量）/ 已发布（可下架、编辑）/ 已下架（可恢复）/ 报名（筛选、已联系、导出）。
   ========================================================================== */
(function () {
  "use strict";

  var G = window.Glimmer || {};
  var $ = G.$ || function (s, r) { return (r || document).querySelector(s); };
  var $$ = G.$$ || function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = G.esc || function (s) { return String(s == null ? "" : s); };

  var PW_KEY = "glimmer_admin_pw";
  var password = "";
  try { password = sessionStorage.getItem(PW_KEY) || ""; } catch (e) {}

  var CATEGORIES = ["校园纪实", "校外采风", "城市与远方", "人像与视觉"];
  var STATUS_TEXT = { pending: "待审核", approved: "已发布", offline: "已下架" };

  var loginSec = $("#login");
  var panelSec = $("#panel");
  var loginMsg = $("#login-msg");
  var panelMsg = $("#panel-msg");

  var data = { pending: [], approved: [], offline: [], submissions: [] };
  var subsFilter = "all";

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

  /* ---------------- 工具 ---------------- */
  function fmtTime(s) {
    if (!s) return "—";
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    function p(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function downloadCsv(action, filename) {
    return fetch("api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password, action: action })
    }).then(function (r) {
      if (r.status === 401) throw new Error("unauthorized");
      if (!r.ok) throw new Error("导出失败（HTTP " + r.status + "）");
      return r.blob();
    }).then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
  }

  /* ---------------- 作品卡片 ---------------- */
  function catOptions(sel) {
    return CATEGORIES.map(function (c) {
      return '<option value="' + c + '"' + (c === sel ? " selected" : "") + ">" + c + "</option>";
    }).join("");
  }

  function metaLine(p) {
    var exif = p.exif && typeof p.exif === "object" ? p.exif : null;
    var exifPart = exif
      ? " · " + [exif.camera, exif.aperture, exif.shutter, exif.iso].filter(Boolean).map(esc).join(" ")
      : "";
    /* v2.2.0：精选角标 + 拒绝理由回显 */
    return esc(p.category) +
      (p.author ? " · " + esc(p.author) : "") +
      (p.shot_date ? " · 摄于 " + esc(p.shot_date) : "") +
      exifPart +
      " · " + fmtTime(p.created_at) +
      (p.featured ? ' · <span class="admin-item__feat">⭐精选</span>' : "") +
      (p.reject_reason ? " · 理由：" + esc(p.reject_reason) : "");
  }

  function editForm(p) {
    return '<form class="admin-edit">' +
      '<input class="admin-edit__t" name="title" type="text" maxlength="50" value="' + esc(p.title) + '" placeholder="标题" required>' +
      '<input class="admin-edit__a" name="author" type="text" maxlength="30" value="' + esc(p.author || "") + '" placeholder="署名（可留空）">' +
      '<select class="admin-edit__c" name="category">' + catOptions(p.category) + "</select>" +
      '<input class="admin-edit__d" name="shot_date" type="date" value="' + esc(p.shot_date || "") + '">' +
      '<div class="admin-edit__ops">' +
        '<button class="admin-op admin-op--ok" type="submit">保存</button>' +
        '<button class="admin-op" type="button" data-act="edit-cancel">取消</button>' +
      "</div>" +
    "</form>";
  }

  /* v2.2.2：分类快切下拉框——改类别最高频，不该进编辑模式绕三步 */
  function catQuickSel(p) {
    return '<select class="admin-cat" data-id="' + p.id + '" title="快速修改分类，选择后立即保存">' +
      CATEGORIES.map(function (c) {
        return '<option value="' + c + '"' + (c === p.category ? " selected" : "") + ">" + c + "</option>";
      }).join("") +
      "</select>";
  }

  function photoCard(p, mode) {
    var ops = "";
    var sel = "";
    if (mode === "pending") {
      sel = '<label class="check admin-item__sel" title="选中批量处理"><input type="checkbox" class="batch-cb" data-id="' + p.id + '"></label>';
      ops = catQuickSel(p) +
            '<button class="admin-op admin-op--ok" type="button" data-act="approve" data-id="' + p.id + '">通过</button>' +
            '<button class="admin-op" type="button" data-act="reject" data-id="' + p.id + '">拒绝</button>' +
            '<button class="admin-op" type="button" data-act="replace" data-id="' + p.id + '">换图</button>' +
            '<button class="admin-op admin-op--del" type="button" data-act="remove" data-id="' + p.id + '">删除</button>';
    } else if (mode === "approved") {
      ops = catQuickSel(p) +
            '<button class="admin-op" type="button" data-act="edit" data-id="' + p.id + '">编辑</button>' +
            '<button class="admin-op" type="button" data-act="watermark" data-id="' + p.id + '" title="重打水印：公开图覆盖为带水印版，原图留在私有目录">打水印</button>' +
            '<button class="admin-op" type="button" data-act="featured" data-id="' + p.id + '" data-feat="' + (p.featured ? "1" : "0") + '">' + (p.featured ? "取消精选" : "精选") + '</button>' +
            '<button class="admin-op" type="button" data-act="replace" data-id="' + p.id + '">换图</button>' +
            '<button class="admin-op" type="button" data-act="unpublish" data-id="' + p.id + '">下架</button>' +
            '<button class="admin-op admin-op--del" type="button" data-act="remove" data-id="' + p.id + '">删除</button>';
    } else {
      ops = catQuickSel(p) +
            '<button class="admin-op admin-op--ok" type="button" data-act="restore" data-id="' + p.id + '">恢复上架</button>' +
            '<button class="admin-op" type="button" data-act="replace" data-id="' + p.id + '">换图</button>' +
            '<button class="admin-op admin-op--del" type="button" data-act="remove" data-id="' + p.id + '">删除</button>';
    }
    return '<article class="admin-item" data-id="' + p.id + '">' +
      sel +
      /* 列表加载缩图（数据万象），data-full 存原图供点击放大 */
      '<img class="admin-item__img" src="' + esc(G.thumbUrl ? G.thumbUrl(p.file_url, 400) : p.file_url) + '" data-full="' + esc(p.file_url) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async">' +
      '<div class="admin-item__meta">' +
        "<h3>" + esc(p.title) + "</h3>" +
        "<p>" + metaLine(p) + "</p>" +
      "</div>" +
      editForm(p) +
      '<div class="admin-item__ops">' + ops + "</div>" +
    "</article>";
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var d = data;
    $("#st-pending").textContent = d.pending.length;
    $("#st-approved").textContent = d.approved.length;
    $("#st-offline").textContent = d.offline.length;
    $("#st-subs").textContent = d.submissions.length;
    $("#tab-pending").textContent = d.pending.length;
    $("#tab-approved").textContent = d.approved.length;
    $("#tab-offline").textContent = d.offline.length;
    $("#tab-subs").textContent = d.submissions.length;

    /* 本月概览（v2.2.0）：按北京月份统计，与备份记账口径一致 */
    var monthEl = $("#admin-month");
    if (monthEl) {
      var month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
      var mPhotos = d.approved.concat(d.pending, d.offline).filter(function (p) { return (p.created_at || "").indexOf(month) === 0; }).length;
      var mSubs = d.submissions.filter(function (s) { return (s.created_at || "").indexOf(month) === 0; }).length;
      var mFeat = d.approved.filter(function (p) { return p.featured; }).length;
      monthEl.textContent = "本月投稿 " + mPhotos + " 件 · 本月报名 " + mSubs + " 人 · 精选作品 " + mFeat + " 件";
      monthEl.hidden = false;
    }

    /* 待审核 */
    var bar = $("#batch-bar");
    if (bar) bar.hidden = d.pending.length === 0;
    $("#pending-list").innerHTML = d.pending.length
      ? d.pending.map(function (p) { return photoCard(p, "pending"); }).join("")
      : '<p class="admin-empty">暂时没有待审核作品。同学刚提交的投稿会出现在这里。</p>';

    /* 已发布 */
    $("#approved-list").innerHTML = d.approved.length
      ? d.approved.map(function (p) { return photoCard(p, "approved"); }).join("")
      : '<p class="admin-empty">还没有已发布作品。审核通过的作品会自动出现在官网作品集。</p>';

    /* 已下架 */
    $("#offline-list").innerHTML = d.offline.length
      ? d.offline.map(function (p) { return photoCard(p, "offline"); }).join("")
      : '<p class="admin-empty">没有已下架的作品。</p>';

    renderSubs();
    updateBatchCount();
  }

  function renderSubs() {
    var rows = data.submissions;
    var no = rows.filter(function (s) { return !s.handled; }).length;
    var yes = rows.length - no;
    $("#f-all").textContent = rows.length;
    $("#f-no").textContent = no;
    $("#f-yes").textContent = yes;

    var list = rows.filter(function (s) {
      if (subsFilter === "no") return !s.handled;
      if (subsFilter === "yes") return !!s.handled;
      return true;
    });
    var html = list.map(function (s) {
      var hCls = s.handled ? "admin-handled is-yes" : "admin-handled is-no";
      var hTxt = s.handled ? "已联系 ✓" : "未联系";
      return "<tr>" +
        "<td>" + esc(s.id) + "</td>" +
        "<td>" + esc(s.name) + "</td>" +
        "<td>" + esc(s["class"] || "—") + "</td>" +
        "<td>" + esc(s.contact) + "</td>" +
        "<td>" + esc(s.interest || "—") + "</td>" +
        '<td class="admin-table__intro">' + esc(s.intro || "—") + "</td>" +
        '<td><button class="' + hCls + '" type="button" data-act="toggle" data-id="' + s.id + '" data-h="' + (s.handled ? "1" : "0") + '">' + hTxt + "</button></td>" +
        "<td>" + fmtTime(s.created_at) + "</td>" +
      "</tr>";
    }).join("");
    $("#subs-table").innerHTML =
      '<table class="admin-table"><thead><tr>' +
      "<th>ID</th><th>姓名</th><th>年级班级</th><th>联系方式</th><th>感兴趣方向</th><th>想说的话</th><th>状态</th><th>提交时间</th>" +
      "</tr></thead><tbody>" +
      (html || '<tr><td colspan="8" class="admin-empty">没有符合条件的报名记录。</td></tr>') +
      "</tbody></table>";
  }

  function load() {
    showMsg(panelMsg, "");
    return api("list").then(function (j) {
      data.pending = j.pending || [];
      data.approved = j.approved || [];
      data.offline = j.offline || [];
      data.submissions = j.submissions || [];
      render();
    }).catch(function (e) {
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

  /* ---------------- 批量选择 ---------------- */
  function updateBatchCount() {
    var boxes = $$(".batch-cb", $("#pane-pending"));
    var n = boxes.filter(function (b) { return b.checked; }).length;
    $("#batch-n").textContent = "已选 " + n + " 项";
    var all = $("#batch-all");
    if (all) all.checked = boxes.length > 0 && n === boxes.length;
  }

  $("#batch-all").addEventListener("change", function () {
    $$(".batch-cb", $("#pane-pending")).forEach(function (b) { b.checked = $("#batch-all").checked; });
    updateBatchCount();
  });

  $("#pane-pending").addEventListener("change", function (e) {
    if (e.target.classList && e.target.classList.contains("batch-cb")) updateBatchCount();
  });

  $("#batch-approve").addEventListener("click", function () {
    var ids = checkedIds();
    if (!ids.length) return;
    this.disabled = true;
    api("batch", { ids: ids, op: "approve" }).then(load).catch(errHandler).then(reenable(this));
  });

  $("#batch-del").addEventListener("click", function () {
    var ids = checkedIds();
    if (!ids.length) return;
    if (!window.confirm("将删除选中的 " + ids.length + " 件作品（数据库记录与 COS 图片一并清掉），确定？")) return;
    this.disabled = true;
    api("batch", { ids: ids, op: "delete" }).then(load).catch(errHandler).then(reenable(this));
  });

  function checkedIds() {
    return $$(".batch-cb", $("#pane-pending")).filter(function (b) { return b.checked; })
      .map(function (b) { return b.getAttribute("data-id"); });
  }

  function errHandler(e) {
    if (e && e.unauthorized) {
      logout(true);
      showMsg(loginMsg, "登录已过期，请重新输入管理密码。", "is-err");
    } else {
      showMsg(panelMsg, e.message, "is-err");
    }
  }
  function reenable(btn) {
    return function () { btn.disabled = false; };
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
  var tabs = $$(".admin-tab");
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (x) { x.classList.remove("is-on"); });
      t.classList.add("is-on");
      $$(".admin-pane").forEach(function (p) { p.classList.remove("is-on"); });
      $("#pane-" + t.getAttribute("data-tab")).classList.add("is-on");
    });
  });

  /* ---------------- 事件：报名筛选 ---------------- */
  $$(".admin-filter").forEach(function (b) {
    b.addEventListener("click", function () {
      $$(".admin-filter").forEach(function (x) { x.classList.remove("is-on"); });
      b.classList.add("is-on");
      subsFilter = b.getAttribute("data-f");
      renderSubs();
    });
  });

  /* ---------------- 事件：导出 ---------------- */
  $("#export-csv").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    showMsg(panelMsg, "");
    downloadCsv("export", "glimmer-submissions.csv")
      .then(function () { showMsg(panelMsg, "报名 CSV 已开始下载。", "is-ok"); })
      .catch(function (e) { errHandler(e); })
      .then(function () { btn.disabled = false; });
  });

  $("#export-photos").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    showMsg(panelMsg, "");
    downloadCsv("export_photos", "glimmer-photos.csv")
      .then(function () { showMsg(panelMsg, "投稿 CSV 已开始下载。", "is-ok"); })
      .catch(function (e) { errHandler(e); })
      .then(function () { btn.disabled = false; });
  });

  /* 立即备份：服务端导出 CSV 写入 COS _backup/，成功后给出文件地址 */
  $("#backup-now").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    showMsg(panelMsg, "");
    api("backup").then(function (j) {
      var b = j.backup || {};
      showMsg(panelMsg,
        "备份完成（" + b.stamp + "）：作品 " + b.photos + " 条、报名 " + b.subs + " 条，已写入云端 _backup/ 目录。",
        "is-ok");
    }).catch(function (e) { errHandler(e); })
      .then(function () { btn.disabled = false; });
  });

  /* ---------------- 事件：作品卡片操作（事件委托） ---------------- */
  ["#pane-pending", "#pane-approved", "#pane-offline"].forEach(function (sel) {
    var pane = $(sel);
    if (!pane) return;
    pane.addEventListener("click", function (e) {
      /* 点缩略图 → 宽版放大（审核看片用，加载原图而非缩图） */
      if (e.target.classList && e.target.classList.contains("admin-item__img")) {
        if (G.ZOOM) G.ZOOM.open(e.target.getAttribute("data-full") || e.target.getAttribute("src"), true);
        return;
      }
      var btn = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      var id = btn.getAttribute("data-id");
      var card = btn.closest ? btn.closest(".admin-item") : null;

      if (act === "approve" || act === "unpublish" || act === "restore") {
        btn.disabled = true;
        api(act, { id: id }).then(function (j) {
          /* 审核通过会自动打水印；失败不阻塞审核，只提示可手动重试 */
          if (act === "approve" && j && j.watermarked === false) {
            showMsg(panelMsg, "已通过审核，但打水印失败（" + (j.wmError || "原因未知") +
              "）。稍后可在该作品上点「打水印」重试。", "is-err");
          }
          return load();
        }).catch(errHandler);
        return;
      }
      if (act === "reject") {
        /* v2.2.0：拒绝 = 下架 + 理由（理由会展示给投稿同学） */
        var reason = window.prompt("拒绝理由（会展示给投稿同学；留空则取消）：");
        if (!reason || !reason.trim()) return;
        btn.disabled = true;
        api("unpublish", { id: id, reason: reason.trim() }).then(function (j) {
          showMsg(panelMsg, "已拒绝（作品移入已下架）。" +
            (j && j.reasonSaved === false ? "注意：数据库缺 reject_reason 列，理由未保存。" : ""), "is-ok");
          return load();
        }).catch(errHandler);
        return;
      }
      if (act === "featured") {
        var toFeat = btn.getAttribute("data-feat") !== "1";
        btn.disabled = true;
        api("featured", { id: id, featured: toFeat }).then(function () {
          showMsg(panelMsg, toFeat ? "已设为精选，作品集与首页将优先展示。" : "已取消精选。", "is-ok");
          return load();
        }).catch(errHandler);
        return;
      }
      if (act === "replace") {
        replaceId = id;
        var rinp = document.getElementById("replace-file");
        if (rinp) { rinp.value = ""; rinp.click(); }
        return;
      }
      if (act === "watermark") {
        btn.disabled = true;
        showMsg(panelMsg, "");
        api("watermark", { id: id }).then(function () {
          showMsg(panelMsg, "水印已打好：公开图片已覆盖为带水印版，原图保存在私有 _original/ 目录。",
            "is-ok");
        }).catch(errHandler).then(function () { btn.disabled = false; });
        return;
      }
      if (act === "remove") {
        if (!window.confirm("删除后，数据库记录与 COS 里的图片都会被清掉，确定删除这件作品？")) return;
        btn.disabled = true;
        api("delete", { id: id }).then(load).catch(errHandler);
        return;
      }
      if (act === "edit") {
        if (card) card.classList.add("is-editing");
        return;
      }
      if (act === "edit-cancel") {
        if (card) card.classList.remove("is-editing");
        return;
      }
    });

    /* 编辑表单提交 */
    pane.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form.classList || !form.classList.contains("admin-edit")) return;
      e.preventDefault();
      var card = form.closest(".admin-item");
      var id = card ? card.getAttribute("data-id") : null;
      api("update", {
        id: id,
        title: form.querySelector('[name="title"]').value.trim(),
        author: form.querySelector('[name="author"]').value.trim(),
        category: form.querySelector('[name="category"]').value,
        shot_date: form.querySelector('[name="shot_date"]').value
      }).then(function () {
        showMsg(panelMsg, "已保存修改。", "is-ok");
        return load();
      }).catch(errHandler);
    });

    /* v2.2.2：分类快切——选了立即保存，不用进编辑模式 */
    pane.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.classList || !t.classList.contains("admin-cat")) return;
      var cat = t.value;
      if (!cat) return;
      t.disabled = true;
      api("update", { id: t.getAttribute("data-id"), category: cat }).then(function () {
        showMsg(panelMsg, "分类已改为「" + cat + "」。", "is-ok");
        return load();
      }).catch(errHandler).then(function () { t.disabled = false; });
    });
  });

  /* ---------------- 换图（v2.2.0）：选图 → 压缩 → api/replace ----------------
     密码走 x-admin-pw 头（不进 URL 不落日志）；响应文本优先解析（v2.0.11 同款） */
  var replaceId = null;
  var replaceInput = document.getElementById("replace-file");
  if (replaceInput) {
    replaceInput.addEventListener("change", function () {
      if (!replaceId) return;
      var f = replaceInput.files && replaceInput.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { showMsg(panelMsg, "请选择图片文件。", "is-err"); return; }
      showMsg(panelMsg, "正在压缩并上传新图…", "");
      compressForReplace(f).then(function (blob) {
        if (!blob) throw new Error("图片压缩失败，换一张试试");
        return fetch("api/replace?id=" + encodeURIComponent(replaceId), {
          method: "POST",
          headers: { "x-admin-pw": password, "Content-Type": "application/octet-stream" },
          body: blob
        }).then(function (r) {
          return r.text().then(function (t) {
            var j = null;
            try { j = JSON.parse(t); } catch (e) { /* 非 JSON：HTML 错误页 */ }
            if (r.status === 401) {
              var err = new Error("密码不正确");
              err.unauthorized = true;
              throw err;
            }
            if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || "替换失败（HTTP " + r.status + "）");
            return j;
          });
        });
      }).then(function (j) {
        showMsg(panelMsg, "图片已替换。" + (j.watermarked ? "已自动重打水印。" : "") +
          (j.wmError ? "（" + j.wmError + "）" : ""), "is-ok");
        replaceId = null;
        return load();
      }).catch(function (e) {
        replaceId = null;
        if (e && e.unauthorized) {
          logout(true);
          showMsg(loginMsg, "登录已过期，请重新输入管理密码。", "is-err");
        } else {
          showMsg(panelMsg, e.message || "替换失败", "is-err");
        }
      });
    });
  }

  /* 压缩：与投稿页同思路（最长边 1600、JPEG 0.82），后台换图够用 */
  function compressForReplace(file) {
    function decode() {
      if (window.createImageBitmap) {
        return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () {
          return createImageBitmap(file);
        });
      }
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("图片解码失败")); };
        img.src = url;
      });
    }
    return decode().then(function (bmp) {
      var w = bmp.width || bmp.naturalWidth;
      var h = bmp.height || bmp.naturalHeight;
      if (!w || !h) throw new Error("无法读取图片尺寸");
      var scale = Math.min(1, 1600 / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(bmp, 0, 0, cw, ch);
      if (bmp.close) bmp.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (b) { resolve(b); }, "image/jpeg", 0.82);
      });
    });
  }

  /* ---------------- 事件：报名已联系切换 ---------------- */
  $("#subs-table").addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-act="toggle"]') : null;
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var handled = btn.getAttribute("data-h") !== "1";
    btn.disabled = true;
    api("mark_handled", { id: id, handled: handled })
      .then(function () { return load(); })
      .catch(errHandler)
      .then(function () { btn.disabled = false; });
  });

  /* ---------------- 启动：带过期的密码自动进后台 ---------------- */
  if (password) {
    api("list").then(enterPanel).catch(function () { logout(true); });
  }
})();
