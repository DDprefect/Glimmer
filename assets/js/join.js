/* ==========================================================================
   微光摄影社 · 报名页脚本
   原 join.html 内联 <script>（v2.0.12 抽到外部文件）：
   CSP script-src 收紧到 'self' 后不允许内联脚本块，逻辑不变原样搬出。
   内容：报名表单提交（接口成功入库 / 失败回退生成文本）
        + 报名状态自查（姓名+联系方式双因子）
        + 报名文案复制
   ========================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("join-form");
  if (!form) return;
  var out = document.getElementById("f-out");
  var box = document.getElementById("join-result");
  var tip = document.getElementById("copy-tip");
  var okBox = document.getElementById("join-ok");
  var btn = document.getElementById("join-submit");

  function buildPayload() {
    var dirs = Array.prototype.map.call(form.querySelectorAll('input[name="dir"]:checked'), function (i) { return i.value; });
    var equip = document.getElementById("f-equip").value;
    var msg = document.getElementById("f-msg").value.trim();
    var intro = (equip ? "拍摄设备：" + equip + "。" : "") + (msg || "");
    return {
      name: document.getElementById("f-name").value.trim(),
      class: document.getElementById("f-class").value.trim(),
      contact: document.getElementById("f-contact").value.trim(),
      interest: dirs.join("、"),
      intro: intro.trim()
    };
  }

  function buildText(p) {
    var dirs = p.interest || "还在探索";
    return [
      "【微光摄影社 · 入社报名】",
      "姓名/昵称：" + p.name,
      "年级班级：" + (p.class || "—"),
      "联系方式：" + p.contact,
      "感兴趣的方向：" + dirs,
      "想说的话：" + (p.intro || "—"),
      "",
      "—— 发送自微光摄影社官方网站"
    ].join("\n");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    /* 蜜罐：被填说明是机器人，静默丢弃不提示 */
    var honey = document.getElementById("f-web");
    if (honey && honey.value) return;
    var p = buildPayload();
    if (!p.name) { document.getElementById("f-name").focus(); return; }
    if (!p.contact) { document.getElementById("f-contact").focus(); return; }

    btn.disabled = true;
    fetch("api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p)
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          /* 入库成功：显示成功态，隐藏表单其余部分 */
          form.querySelectorAll(".field, .field--row, .checks, button[type=submit], .form__note").forEach(function (el) {
            el.style.display = "none";
          });
          okBox.hidden = false;
          okBox.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        throw new Error((j && j.error) || "提交失败");
      })
      .catch(function () {
        /* 接口不可用（本地打开 / 数据库暂停）：回退为「生成文本手动转发」 */
        out.value = buildText(p);
        box.hidden = false;
        tip.textContent = "网络不稳定，已改为生成文本，请复制后发给招新负责人";
        box.scrollIntoView({ behavior: "smooth", block: "center" });
      })
      .then(function () { btn.disabled = false; });
  });

  /* 报名状态自查：姓名 + 联系方式双因子，服务端只回状态、不回任何个人信息 */
  (function () {
    var btn = document.getElementById("s-btn");
    if (!btn) return;
    var msg = document.getElementById("s-msg");

    function show(t, cls) {
      msg.hidden = false;
      msg.className = "up-msg " + cls;
      msg.textContent = t;
    }

    btn.addEventListener("click", function () {
      var nameEl = document.getElementById("s-name");
      var cEl = document.getElementById("s-contact");
      var name = nameEl.value.trim();
      var contact = cEl.value.trim();
      if (!name) { show("请填写报名时用的姓名。", "is-err"); nameEl.focus(); return; }
      if (!contact) { show("请填写报名时用的联系方式。", "is-err"); cEl.focus(); return; }

      btn.disabled = true;
      show("查询中…", "");
      fetch("api/register-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, contact: contact })
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok) throw new Error((j && j.error) || "查询失败");
          if (!j.found) {
            show("没查到匹配的报名记录。请确认姓名与联系方式和报名时填的一致；" +
                 "也可以直接加官方 QQ 群 1159554310 询问。", "is-err");
            return;
          }
          var when = j.at ? String(j.at).slice(0, 10) : "";
          var tail = j.status === "已联系"
            ? "负责人已经联系过你了，留意一下消息记录。"
            : "负责人会尽快通过你留下的联系方式联系你，请留意 QQ / 微信 / 电话。";
          show("已收到你的报名" + (when ? "（" + when + "）" : "") +
               "，当前状态：" + j.status + "。" + tail, "is-ok");
        })
        .catch(function (e) {
          show("查询失败：" + (e.message || "网络异常") +
               "。你也可以直接加官方 QQ 群 1159554310 询问。", "is-err");
        })
        .then(function () { btn.disabled = false; });
    });
  })();

  document.getElementById("copy-btn").addEventListener("click", function () {
    out.select();
    out.setSelectionRange(0, 9999);
    function ok() { tip.textContent = "已复制，去发给招新负责人吧 ✓"; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(out.value).then(ok, function () { document.execCommand("copy"); ok(); });
    } else {
      document.execCommand("copy"); ok();
    }
  });
})();
