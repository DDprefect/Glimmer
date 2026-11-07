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
  var STATUS_TEXT = { pending: "待审核", approved: "已发布", offline: "已下架", trash: "回收站" };

  var loginSec = $("#login");
  var panelSec = $("#panel");
  var loginMsg = $("#login-msg");
  var panelMsg = $("#panel-msg");

  var data = { pending: [], approved: [], offline: [], trash: [], submissions: [], events: [], eventsMissing: false };
  var staticWorks = { hidden: [], purged: [], shown: [], excluded: [] };
  var subsFilter = "all";
  var staticFilter = "all";
  /* v2.7.0：活动编辑状态与当前查看的报名 */
  var eventEditId = null;
  var eventRegs = null; /* { id, title, list } */

  /* v2.5.0：后台操作反馈改成右下角浮动 toast——成功绿色、失败红色，
     比原来顶上那一行小字醒目得多；3.5 秒后自动淡出。 */
  function toast(text, kind) {
    var host = document.getElementById("toast-wrap");
    if (!host) return;
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = text;
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add("is-out");
      setTimeout(function () { t.remove(); }, 320);
    }, 3500);
  }

  function showMsg(el, text, kind) {
    if (!el) return;
    /* 面板类反馈统一走 toast；登录框仍用内联提示（在表单里更自然） */
    if (el === panelMsg) {
      if (text) toast(text, kind);
      return;
    }
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

  function downloadCsv(action, filename, extra) {
    return fetch("api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ password: password, action: action }, extra || {}))
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
    /* v2.7.0：活动投稿标注所属活动名（list 里带 events，直接匹配） */
    var evPart = "";
    if (p.event_id) {
      var ev = (data.events || []).filter(function (e) { return String(e.id) === String(p.event_id); })[0];
      evPart = ' · <span class="admin-item__feat">活动：' + esc(ev ? ev.title : "#" + p.event_id) + "</span>";
    }
    /* v2.2.0：精选角标 + 拒绝理由回显 */
    return esc(p.category) +
      (p.author ? " · " + esc(p.author) : "") +
      (p.shot_date ? " · 摄于 " + esc(p.shot_date) : "") +
      exifPart +
      evPart +
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
    var delAct = "trash";       /* 默认软删除：移入回收站 */
    var delText = "移入回收站";
    if (mode === "pending") {
      sel = '<label class="check admin-item__sel" title="选中批量处理"><input type="checkbox" class="batch-cb" data-id="' + p.id + '"></label>';
      ops = catQuickSel(p) +
            '<button class="admin-op admin-op--ok" type="button" data-act="approve" data-id="' + p.id + '">通过</button>' +
            '<button class="admin-op" type="button" data-act="reject" data-id="' + p.id + '">拒绝</button>' +
            '<button class="admin-op" type="button" data-act="replace" data-id="' + p.id + '">换图</button>' +
            '<button class="admin-op admin-op--del" type="button" data-act="trash" data-id="' + p.id + '">移入回收站</button>';
    } else if (mode === "approved") {
      ops = catQuickSel(p) +
            '<button class="admin-op" type="button" data-act="edit" data-id="' + p.id + '">编辑</button>' +
            '<button class="admin-op" type="button" data-act="watermark" data-id="' + p.id + '" title="重打水印：公开图覆盖为带水印版，原图留在私有目录">打水印</button>' +
            '<button class="admin-op" type="button" data-act="featured" data-id="' + p.id + '" data-feat="' + (p.featured ? "1" : "0") + '">' + (p.featured ? "取消精选" : "精选") + '</button>' +
            '<button class="admin-op" type="button" data-act="replace" data-id="' + p.id + '">换图</button>' +
            '<button class="admin-op" type="button" data-act="unpublish" data-id="' + p.id + '">下架</button>' +
            '<button class="admin-op admin-op--del" type="button" data-act="trash" data-id="' + p.id + '">移入回收站</button>';
    } else if (mode === "trash") {
      /* v2.6.0：回收站——恢复到「已下架」（需再手动上架，防误发布）或永久删除 */
      delAct = "remove";
      delText = "永久删除";
      ops = '<button class="admin-op admin-op--ok" type="button" data-act="restore_trash" data-id="' + p.id + '">恢复到已下架</button>' +
            '<button class="admin-op admin-op--del" type="button" data-act="remove" data-id="' + p.id + '">永久删除</button>';
    } else {
      ops = catQuickSel(p) +
            '<button class="admin-op admin-op--ok" type="button" data-act="restore" data-id="' + p.id + '">恢复上架</button>' +
            '<button class="admin-op" type="button" data-act="replace" data-id="' + p.id + '">换图</button>' +
            '<button class="admin-op admin-op--del" type="button" data-act="trash" data-id="' + p.id + '">移入回收站</button>';
    }
    return '<article class="admin-item" data-id="' + p.id + '">' +
      sel +
      /* 缩略图右上角常驻一个 ×：待审核时看到不好的片子可以直接删，
         不必在按钮堆里找；title 说明是可恢复的软删除。 */
      '<div class="admin-item__ph">' +
        '<img class="admin-item__img" src="' + esc(G.thumbUrl ? G.thumbUrl(p.file_url, 400) : p.file_url) + '" data-full="' + esc(p.file_url) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async">' +
        '<button class="admin-item__x" type="button" data-act="' + delAct + '" data-id="' + p.id + '" title="' + delText + '" aria-label="' + delText + '">×</button>' +
      "</div>" +
      '<div class="admin-item__meta">' +
        "<h3>" + esc(p.title) + "</h3>" +
        "<p>" + metaLine(p) + "</p>" +
      "</div>" +
      (mode === "trash" ? "" : editForm(p)) +
      '<div class="admin-item__ops">' + ops + "</div>" +
    "</article>";
  }

  /* ---------------- 静态老作品卡片（v2.6.0） ----------------
     数据源是 works.js（后台页已引入），状态来自 COS 私有清单。
     ⚠️ 静态图片是仓库文件，运行时删不掉，所谓「永久移除」是从展示
     清单里永久剔除；因此仍保留「撤销」入口，误操作有后悔药。 */
  function staticState(w) {
    if (staticWorks.purged.indexOf(w.id) !== -1) return "purged";
    if (staticWorks.hidden.indexOf(w.id) !== -1) return "hidden";
    /* v2.6.1：被「强制展示」的历史隐藏作品，等同于正常展出 */
    if (staticWorks.shown.indexOf(w.id) !== -1) return "shown";
    return w.hidden ? "legacy" : "shown";
  }

  function staticCard(w) {
    var state = staticState(w);
    var label = { purged: "已永久移除", hidden: "回收站", legacy: "原本未展出", shown: "展示中" }[state];
    var ops = "";
    if (state === "shown") {
      ops = '<button class="admin-op admin-op--del" type="button" data-sact="hidden" data-id="' + esc(w.id) + '">移入回收站</button>' +
            '<button class="admin-op" type="button" data-sact="purged" data-id="' + esc(w.id) + '">永久移除</button>';
    } else if (state === "legacy") {
      /* 历史隐藏作品：可恢复展示（写入 shown 覆盖 works.js 的 hidden） */
      ops = '<button class="admin-op admin-op--ok" type="button" data-sact="visible" data-id="' + esc(w.id) + '">恢复展示</button>' +
            '<button class="admin-op admin-op--del" type="button" data-sact="hidden" data-id="' + esc(w.id) + '">移入回收站</button>' +
            '<button class="admin-op" type="button" data-sact="purged" data-id="' + esc(w.id) + '">永久移除</button>';
    } else {
      ops = '<button class="admin-op admin-op--ok" type="button" data-sact="visible" data-id="' + esc(w.id) + '">撤销，恢复展示</button>' +
            (state === "hidden"
              ? '<button class="admin-op admin-op--del" type="button" data-sact="purged" data-id="' + esc(w.id) + '">永久移除</button>'
              : "");
    }
    var src = G.safeUrl ? G.safeUrl(w.thumb || w.src) : (w.thumb || w.src);
    return '<article class="admin-static" data-id="' + esc(w.id) + '" data-state="' + state + '">' +
      '<div class="admin-static__ph">' +
        '<img src="' + esc(src) + '" alt="' + esc(w.title || w.id) + '" loading="lazy" decoding="async">' +
        '<span class="admin-static__st is-' + state + '">' + label + "</span>" +
      "</div>" +
      '<div class="admin-static__meta"><b>' + esc(w.title || w.id) + "</b><i>" + esc(w.group || w.cat || "") + "</i></div>" +
      '<div class="admin-static__ops">' + ops + "</div>" +
    "</article>";
  }

  function renderStatic() {
    var all = window.WORKS || [];
    var list = all.filter(function (w) {
      var s = staticState(w);
      if (staticFilter === "shown") return s === "shown";
      if (staticFilter === "off") return s !== "shown";
      return true;
    });
    var host = $("#static-list");
    if (host) {
      host.innerHTML = list.length ? list.map(staticCard).join("") : '<p class="admin-empty">这里暂时没有作品。</p>';
    }
    var trashHost = $("#trash-static-list");
    if (trashHost) {
      var removed = all.filter(function (w) { var s = staticState(w); return s === "hidden" || s === "purged"; });
      trashHost.innerHTML = removed.length
        ? removed.map(staticCard).join("")
        : '<p class="admin-empty">回收站里没有老作品。</p>';
    }
    var tab = $("#tab-static");
    if (tab) tab.textContent = all.length;
    var t2 = $("#tab-trash");
    if (t2) t2.textContent = data.trash.length + staticWorks.hidden.length + staticWorks.purged.length;

    /* v2.6.1：把「历史隐藏、可恢复」的作品数直接标出来，干部不用自己翻 */
    var legacyTip = $("#static-legacy-tip");
    if (legacyTip) {
      var legacy = all.filter(function (w) { return staticState(w) === "legacy"; });
      legacyTip.hidden = legacy.length === 0;
      legacyTip.textContent = legacy.length
        ? "有 " + legacy.length + " 张早期隐藏的作品（" +
          legacy.slice(0, 4).map(function (w) { return w.title || w.id; }).join("、") +
          (legacy.length > 4 ? " 等" : "") + "），想看就点「恢复展示」，会立刻出现在官网。"
        : "";
    }
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var d = data;
    $("#st-pending").textContent = d.pending.length;
    $("#st-approved").textContent = d.approved.length;
    $("#st-offline").textContent = d.offline.length;
    $("#tab-pending").textContent = d.pending.length;
    $("#tab-approved").textContent = d.approved.length;
    $("#tab-offline").textContent = d.offline.length;
    $("#tab-subs").textContent = d.submissions.length;

    var tTrash = $("#tab-trash");
    if (tTrash) tTrash.textContent = d.trash.length + staticWorks.hidden.length + staticWorks.purged.length;

    /* v2.5.0：本月数据进 KPI 卡（北京月份，与备份记账口径一致） */
    var month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    var mPhotos = d.approved.concat(d.pending, d.offline, d.trash).filter(function (p) { return (p.created_at || "").indexOf(month) === 0; }).length;
    var mSubs = d.submissions.filter(function (s) { return (s.created_at || "").indexOf(month) === 0; }).length;
    var elMP = $("#st-mphotos");
    if (elMP) elMP.textContent = mPhotos;
    var elMS = $("#st-msubs");
    if (elMS) elMS.textContent = mSubs;

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

    /* 回收站（v2.6.0）：投稿作品可恢复或永久删除 */
    var trashList = $("#trash-list");
    if (trashList) {
      trashList.innerHTML = d.trash.length
        ? d.trash.map(function (p) { return photoCard(p, "trash"); }).join("")
        : '<p class="admin-empty">回收站里没有投稿作品。</p>';
    }

    renderStatic();
    renderEvents();
    renderSubs();
    updateBatchCount();
  }

  /* ---------------- 活动管理（v2.7.0） ---------------- */
  var EVENT_ST = { draft: "草稿", published: "进行中", archived: "已归档" };

  function eventCard(e) {
    var ops = "";
    if (e.status === "draft") {
      ops = '<button class="admin-op admin-op--ok" type="button" data-eact="publish" data-id="' + e.id + '">发布</button>' +
            '<button class="admin-op" type="button" data-eact="edit" data-id="' + e.id + '">编辑</button>' +
            '<button class="admin-op admin-op--del" type="button" data-eact="delete" data-id="' + e.id + '">删除</button>';
    } else if (e.status === "published") {
      ops = '<button class="admin-op" type="button" data-eact="regs" data-id="' + e.id + '">查看报名</button>' +
            '<button class="admin-op" type="button" data-eact="edit" data-id="' + e.id + '">编辑</button>' +
            '<button class="admin-op admin-op--del" type="button" data-eact="archive" data-id="' + e.id + '">归档（结束活动）</button>';
    } else {
      ops = '<button class="admin-op" type="button" data-eact="regs" data-id="' + e.id + '">查看报名</button>' +
            '<button class="admin-op admin-op--ok" type="button" data-eact="publish" data-id="' + e.id + '">重新发布</button>' +
            '<button class="admin-op admin-op--del" type="button" data-eact="delete" data-id="' + e.id + '">删除</button>';
    }
    var st = EVENT_ST[e.status] || e.status;
    var excerpt = String(e.content || "").slice(0, 60);
    return '<article class="admin-event" data-id="' + esc(e.id) + '">' +
      '<div class="admin-event__meta">' +
        '<h3>' + esc(e.title) + ' <span class="admin-event__st is-' + e.status + '">' + st + "</span></h3>" +
        "<p>" + (e.activity_date ? "活动日期 " + esc(e.activity_date) + " · " : "") + esc(excerpt) + (String(e.content || "").length > 60 ? "…" : "") + "</p>" +
      "</div>" +
      '<div class="admin-item__ops">' + ops + "</div>" +
    "</article>";
  }

  function renderEvents() {
    var t = $("#tab-events");
    if (t) t.textContent = data.events.filter(function (e) { return e.status === "published"; }).length;
    var miss = $("#events-missing");
    if (miss) miss.style.display = data.eventsMissing ? "" : "none";
    var host = $("#events-list");
    if (host) {
      host.innerHTML = data.events.length
        ? data.events.map(eventCard).join("")
        : '<p class="admin-empty">还没有活动。点右上角「＋ 新建活动」创建第一个：填标题、日期和介绍，保存后点「发布」就会出现在官网首页。</p>';
    }
    if (eventRegs) renderEventRegs();
  }

  function renderEventRegs() {
    var wrap = $("#event-regs-wrap");
    if (!wrap || !eventRegs) return;
    wrap.hidden = false;
    $("#event-regs-title").textContent = "报名 · " + eventRegs.title;
    $("#event-regs-n").textContent = "共 " + eventRegs.list.length + " 人报名";
    var html = eventRegs.list.map(function (s) {
      var hCls = s.handled ? "admin-handled is-yes" : "admin-handled is-no";
      var hTxt = s.handled ? "已联系 ✓" : "未联系";
      return "<tr>" +
        "<td>" + esc(s.name) + "</td>" +
        "<td>" + esc(s["class"] || "—") + "</td>" +
        "<td>" + esc(s.contact) + "</td>" +
        '<td class="admin-table__intro">' + esc(s.intro || "—") + "</td>" +
        '<td><button class="' + hCls + '" type="button" data-eact="toggle" data-id="' + s.id + '" data-h="' + (s.handled ? "1" : "0") + '">' + hTxt + "</button></td>" +
        "<td>" + fmtTime(s.created_at) + "</td>" +
      "</tr>";
    }).join("");
    $("#event-regs-table").innerHTML =
      '<table class="admin-table"><thead><tr>' +
      "<th>姓名</th><th>年级班级</th><th>联系方式</th><th>想说的话</th><th>状态</th><th>报名时间</th>" +
      "</tr></thead><tbody>" +
      (html || '<tr><td colspan="6" class="admin-empty">还没有人报名。</td></tr>') +
      "</tbody></table>";
  }

  function loadEventRegs(id) {
    api("event_regs", { id: id }).then(function (j) {
      var ev = data.events.filter(function (e) { return String(e.id) === String(id); })[0];
      eventRegs = { id: id, title: ev ? ev.title : "活动 #" + id, list: j.submissions || [] };
      renderEventRegs();
      var wrap = $("#event-regs-wrap");
      if (wrap) wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(errHandler);
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
    return Promise.all([
      api("list"),
      /* 静态老作品清单走公开只读接口；失败不阻塞后台其它功能 */
      fetch("api/static-works").then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (rs) {
      var j = rs[0];
      var sw = rs[1];
      data.pending = j.pending || [];
      data.approved = j.approved || [];
      data.offline = j.offline || [];
      data.trash = j.trash || [];
      data.submissions = j.submissions || [];
      data.events = j.events || [];
      data.eventsMissing = !!j.eventsMissing;
      if (sw && sw.ok) {
        staticWorks.hidden = sw.hidden || [];
        staticWorks.purged = sw.purged || [];
        staticWorks.shown = sw.shown || [];
        staticWorks.excluded = sw.excluded || staticWorks.hidden.concat(staticWorks.purged);
      }
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
    if (!window.confirm("将选中的 " + ids.length + " 件作品移入回收站（图片会保留，可在回收站恢复），确定？")) return;
    this.disabled = true;
    api("batch", { ids: ids, op: "trash" }).then(load).catch(errHandler).then(reenable(this));
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

  /* ---------------- 事件：报名筛选 ----------------
     v2.6.0：限定在 #pane-subs 内，避免把「老作品」面板同款 class 的
     筛选按钮一起绑上（否则点静态筛选会连带改报名筛选状态）。 */
  $$("#pane-subs .admin-filter").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("#pane-subs .admin-filter").forEach(function (x) { x.classList.remove("is-on"); });
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

  /* ---------------- 删除动作统一入口（v2.6.0） ----------------
     trash = 移入回收站（软删，图片全保留）；remove = 永久删除（连带 COS）。
     卡片按钮、缩略图 × 角标、放大浮层里的按钮都走这里，确认文案一致。 */
  function doDelete(id, act) {
    if (act === "remove") {
      if (!window.confirm("永久删除后，数据库记录与 COS 里的图片都会被清掉（COS 版本控制仍可能找回，但操作麻烦），确定？")) return;
    } else if (!window.confirm("把这件作品移入回收站？官网立刻不再展示，图片与记录都保留，随时可恢复。")) {
      return;
    }
    return api(act === "remove" ? "delete" : "trash", { id: id })
      .then(function () {
        showMsg(panelMsg, act === "remove" ? "已永久删除。" : "已移入回收站，可在「回收站」标签恢复。", "is-ok");
        return load();
      })
      .catch(errHandler);
  }

  /* ---------------- 事件：作品卡片操作（事件委托） ---------------- */
  ["#pane-pending", "#pane-approved", "#pane-offline", "#pane-trash"].forEach(function (sel) {
    var pane = $(sel);
    if (!pane) return;
    pane.addEventListener("click", function (e) {
      /* 点缩略图 → 宽版放大（审核看片用，加载原图而非缩图）。
         v2.6.0：浮层里直接挂一个删除按钮——看到不好的片子不用退出再找按钮。 */
      if (e.target.classList && e.target.classList.contains("admin-item__img")) {
        var phCard = e.target.closest ? e.target.closest(".admin-item") : null;
        var phId = phCard ? phCard.getAttribute("data-id") : null;
        var inTrash = !!(e.target.closest && e.target.closest("#pane-trash"));
        if (G.ZOOM) {
          G.ZOOM.open(e.target.getAttribute("data-full") || e.target.getAttribute("src"), true, phId ? {
            label: inTrash ? "永久删除这张" : "移入回收站",
            onAct: function () {
              if (G.ZOOM) G.ZOOM.close();
              doDelete(phId, inTrash ? "remove" : "trash");
            }
          } : null);
        }
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
      if (act === "restore_trash") {
        btn.disabled = true;
        api("restore_trash", { id: id }).then(function () {
          showMsg(panelMsg, "已恢复到「已下架」，需要发布请到该标签点「恢复上架」。", "is-ok");
          return load();
        }).catch(errHandler);
        return;
      }
      if (act === "trash" || act === "remove") {
        btn.disabled = true;
        doDelete(id, act).then(function () { btn.disabled = false; });
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

  /* ---------------- 事件：静态老作品（v2.6.0） ---------------- */
  $$("#static-filter .admin-filter").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("#static-filter .admin-filter").forEach(function (x) { x.classList.remove("is-on"); });
      b.classList.add("is-on");
      staticFilter = b.getAttribute("data-sf") || "all";
      renderStatic();
    });
  });

  ["#static-list", "#trash-static-list"].forEach(function (sel) {
    var host = $(sel);
    if (!host) return;
    host.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-sact]") : null;
      if (!btn) return;
      var sid = btn.getAttribute("data-id");
      var state = btn.getAttribute("data-sact");
      if (!sid) return;
      if (state === "purged" && !window.confirm("永久移除后，这张老作品不会再出现在官网与后台列表（图片文件仍在仓库，可撤销）。确定？")) return;
      btn.disabled = true;
      api("static_set", { id: sid, state: state }).then(function () {
        showMsg(panelMsg, state === "visible" ? "已恢复展示。" : state === "purged" ? "已永久移除。" : "已移入回收站。", "is-ok");
        return load();
      }).catch(errHandler).then(function () { btn.disabled = false; });
    });
  });

  /* ---------------- 事件：活动管理（v2.7.0） ---------------- */
  $("#event-new").addEventListener("click", function () {
    eventEditId = null;
    var f = $("#event-form");
    f.hidden = false;
    $("#event-title").value = "";
    $("#event-date").value = "";
    $("#event-content").value = "";
    $("#event-save-btn").textContent = "保存（保存后点「发布」上线）";
    $("#event-title").focus();
  });

  $("#event-cancel").addEventListener("click", function () {
    eventEditId = null;
    $("#event-form").hidden = true;
  });

  $("#event-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = $("#event-title").value.trim();
    if (!title) { toast("请填写活动标题", "is-err"); return; }
    var payload = { title: title, content: $("#event-content").value, activity_date: $("#event-date").value };
    var btn = $("#event-save-btn");
    btn.disabled = true;
    if (eventEditId) payload.id = eventEditId;
    api("event_save", payload).then(function (j) {
      eventEditId = null;
      $("#event-form").hidden = true;
      toast("活动已保存。草稿点「发布」后才会出现在官网。", "is-ok");
      return load();
    }).catch(errHandler).then(function () { btn.disabled = false; });
  });

  $("#events-list").addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("button[data-eact]") : null;
    if (!btn) return;
    var act = btn.getAttribute("data-eact");
    var id = btn.getAttribute("data-id");

    if (act === "publish" || act === "archive") {
      if (act === "archive" && !window.confirm("归档后：官网首页不再显示、投稿页的活动入口消失、报名关闭。活动页保留为「已结束」回顾，报名名单与作品记录全部保留。确定归档？")) return;
      btn.disabled = true;
      api(act === "publish" ? "event_publish" : "event_archive", { id: id }).then(function () {
        toast(act === "publish" ? "活动已发布，官网首页已出现。" : "活动已归档，官网入口已收起，记录全部保留。", "is-ok");
        return load();
      }).catch(errHandler).then(function () { btn.disabled = false; });
      return;
    }
    if (act === "delete") {
      /* v2.7.2：草稿直接删；归档活动删除会连带清理报名记录（作品解除挂靠但保留）。
         强确认文案提醒先导出 CSV 备份。 */
      var delEv = data.events.filter(function (x) { return String(x.id) === String(id); })[0];
      var isDraft = delEv && delEv.status === "draft";
      var delMsg = isDraft
        ? "删除草稿活动？此操作不可恢复。"
        : "永久删除该活动？\n\n· 其报名记录将一并删除（建议先点「查看报名」导出 CSV 备份）\n· 挂靠的作品会解除与活动的关联，作品本身保留\n\n此操作不可恢复，确定？";
      if (!window.confirm(delMsg)) return;
      btn.disabled = true;
      api("event_delete", { id: id }).then(function (j) {
        eventRegs = null;
        var regsWrap = $("#event-regs-wrap");
        if (regsWrap) regsWrap.hidden = true;
        var extra = j && j.regsDeleted ? "，同时清理报名记录 " + j.regsDeleted + " 条" : "";
        if (j && j.detachError) toast("活动已删除，但挂靠数据清理失败：" + j.detachError, "is-err");
        else toast("活动已删除" + extra + "。", "is-ok");
        return load();
      }).catch(errHandler).then(function () { btn.disabled = false; });
      return;
    }
    if (act === "edit") {
      var ev = data.events.filter(function (x) { return String(x.id) === String(id); })[0];
      if (!ev) return;
      eventEditId = id;
      var f = $("#event-form");
      f.hidden = false;
      $("#event-title").value = ev.title || "";
      $("#event-date").value = ev.activity_date || "";
      $("#event-content").value = ev.content || "";
      $("#event-save-btn").textContent = "保存修改";
      $("#event-title").focus();
      return;
    }
    if (act === "regs") {
      loadEventRegs(id);
      return;
    }
  });

  /* 活动报名表格里的「已联系」切换（在 #event-regs-wrap 内，单独委托） */
  $("#event-regs-table").addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-eact="toggle"]') : null;
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var handled = btn.getAttribute("data-h") !== "1";
    btn.disabled = true;
    api("mark_handled", { id: id, handled: handled })
      .then(function () { if (eventRegs) return loadEventRegs(eventRegs.id); })
      .catch(errHandler)
      .then(function () { btn.disabled = false; });
  });

  $("#event-regs-export").addEventListener("click", function () {
    if (!eventRegs) return;
    var btn = this;
    btn.disabled = true;
    downloadCsv("export_event", "glimmer-event-" + eventRegs.id + "-regs.csv", { id: eventRegs.id })
      .catch(errHandler)
      .then(function () { btn.disabled = false; });
  });

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
