/* ==========================================================================
   微光摄影社 · 作品投稿页
   流程：前端压缩（canvas）→ 申请预签名 URL → 直传 COS → 提交作品信息入库
   任何一步失败都给出明确提示；接口不可用时保持表单可用，不白屏。
   ========================================================================== */
(function () {
  "use strict";

  var G = window.Glimmer || {};
  var $ = G.$ || function (s, r) { return (r || document).querySelector(s); };

  var MAX_EDGE = 1600;        // 压缩后最长边（网页展示足够）
  var TARGET_BYTES = 300 * 1024; // 目标体积 ≈300KB
  var QUALITIES = [0.82, 0.72, 0.6, 0.5]; // 质量阶梯，逐级降到目标体积
  var MAX_RAW_BYTES = 30 * 1024 * 1024;  // 原图大小上限（防误选巨型文件）

  var form = $("#upload-form");
  if (!form) return;

  var fileInput = $("#f-file");
  var fileName = $("#file-name");
  var flow = $("#up-flow");
  var msg = $("#up-msg");
  var done = $("#up-done");
  var doneImg = $("#up-done-img");
  var btn = $("#upload-btn");
  var origBox = $("#f-orig");

  /* ---------------- 文件名回显 ---------------- */
  fileInput.addEventListener("change", function () {
    var f = fileInput.files && fileInput.files[0];
    fileName.textContent = f ? f.name : "未选择文件";
    fileName.classList.toggle("is-picked", !!f);
  });

  /* ---------------- 流程步骤指示 ---------------- */
  function step(name, state) {
    if (!flow) return;
    var li = flow.querySelector('[data-step="' + name + '"]');
    if (!li) return;
    if (state === "on") {
      li.classList.add("is-on");
      li.classList.remove("is-done");
    } else if (state === "done") {
      li.classList.remove("is-on");
      li.classList.add("is-done");
    }
  }

  function showMsg(text, kind) {
    if (!msg) return;
    msg.hidden = false;
    msg.textContent = text;
    msg.classList.remove("is-err", "is-ok");
    if (kind) msg.classList.add(kind);
  }

  /* ---------------- 图片压缩 ----------------
     createImageBitmap 带 imageOrientation 可自动按 EXIF 转正；
     老浏览器回退到 <img> + objectURL。透明底色铺白再转 JPEG。 */
  function decode(file) {
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

  function compress(file) {
    return decode(file).then(function (bmp) {
      var w = bmp.width || bmp.naturalWidth;
      var h = bmp.height || bmp.naturalHeight;
      if (!w || !h) throw new Error("无法读取图片尺寸");
      var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));

      var canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; // PNG 透明区转 JPEG 时铺白，避免变黑
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(bmp, 0, 0, cw, ch);
      if (bmp.close) bmp.close();

      // 质量阶梯：直到 ≤ 目标体积或梯队用尽
      function attempt(q) {
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) { resolve(blob); }, "image/jpeg", q);
        });
      }
      var i = 0;
      function recurse(blob) {
        if (!blob) return Promise.resolve(null);
        if (blob.size <= TARGET_BYTES || i >= QUALITIES.length - 1) return Promise.resolve(blob);
        i++;
        return attempt(QUALITIES[i]).then(recurse);
      }
      return attempt(QUALITIES[0]).then(recurse);
    });
  }

  /* ---------------- 提交 ---------------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var category = $("#f-cat").value;
    var title = $("#f-title").value.trim();
    var author = $("#f-author").value.trim();
    var shot_date = $("#f-date").value;
    var file = fileInput.files && fileInput.files[0];

    if (!category) { showMsg("请先选择作品分类。", "is-err"); $("#f-cat").focus(); return; }
    if (!title) { showMsg("请填写作品标题。", "is-err"); $("#f-title").focus(); return; }
    if (!origBox || !origBox.checked) { showMsg("请先勾选确认「本人原创实拍」。", "is-err"); if (origBox) origBox.focus(); return; }
    if (!file) { showMsg("请选择要上传的图片。", "is-err"); fileInput.focus(); return; }
    if (!/^image\//.test(file.type)) { showMsg("只能上传图片文件（JPG / PNG / WebP）。", "is-err"); return; }
    if (file.size > MAX_RAW_BYTES) { showMsg("原图超过 30MB，请先裁剪或换一张。", "is-err"); return; }

    btn.disabled = true;
    btn.classList.add("is-busy");
    flow.hidden = false;
    done.hidden = true;
    showMsg("");

    /* 1) 压缩 */
    step("compress", "on");
    compress(file)
      .then(function (blob) {
        if (!blob) throw new Error("图片压缩失败，换一张试试");
        step("compress", "done");
        return blob;
      })

      /* 2) 申请上传凭证 */
      .then(function (blob) {
        step("token", "on");
        return fetch("api/upload-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: category })
        })
          .then(function (r) { return r.json().then(function (j) { return { http: r, j: j }; }); })
          .then(function (o) {
            if (!o.http.ok || !o.j.ok) throw new Error(o.j.error || "获取上传凭证失败");
            step("token", "done");
            return { blob: blob, token: o.j };
          });
      })

      /* 3) 直传 COS（签名在 URL 里，无需任何请求头） */
      .then(function (o) {
        step("put", "on");
        return fetch(o.token.uploadUrl, { method: "PUT", body: o.blob })
          .then(function (r) {
            if (!r.ok) throw new Error("图片上传失败（HTTP " + r.status + "），请稍后重试");
            step("put", "done");
            return o.token;
          });
      })

      /* 4) 提交作品信息入库（pending，等干部审核） */
      .then(function (token) {
        step("record", "on");
        return fetch("api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: category,
            title: title,
            author: author,
            shot_date: shot_date || "",
            file_url: token.fileUrl
          })
        })
          .then(function (r) { return r.json().then(function (j) { return { http: r, j: j }; }); })
          .then(function (o) {
            if (!o.http.ok || !o.j.ok) {
              // 图已上传但信息没写库：提示联系干部，避免用户反复重传
              throw new Error("__ORPHAN__" + (o.j.error || "作品信息提交失败"));
            }
            step("record", "done");
            return token;
          });
      })

      .then(function (token) {
        doneImg.src = token.fileUrl;
        done.hidden = false;
        flow.hidden = true;
        showMsg("提交成功！作品已进入待审核队列。", "is-ok");
        form.reset();
        fileName.textContent = "未选择文件";
        fileName.classList.remove("is-picked");
        done.scrollIntoView({ behavior: "smooth", block: "center" });
      })

      .catch(function (err) {
        var m = (err && err.message) || "提交失败，请稍后重试";
        if (m.indexOf("__ORPHAN__") === 0) {
          m = m.replace("__ORPHAN__", "") +
              "（图片已上传但信息未能入库，请把情况告诉干部手动登记，不要重复提交）";
        }
        showMsg(m, "is-err");
        msg.scrollIntoView({ behavior: "smooth", block: "center" });
      })

      .then(function () {
        btn.disabled = false;
        btn.classList.remove("is-busy");
      });
  });

  /* ---------------- 投稿进度自查 ---------------- */
  var qBtn = $("#q-btn");
  var qMsg = $("#q-msg");
  var qResult = $("#q-result");
  if (qBtn) {
    var qShow = function (text, kind) {
      qMsg.hidden = !text;
      qMsg.textContent = text || "";
      qMsg.classList.remove("is-err", "is-ok");
      if (kind) qMsg.classList.add(kind);
    };
    qBtn.addEventListener("click", function () {
      var title = $("#q-title").value.trim();
      var author = $("#q-author").value.trim();
      if (!title) { qShow("请填写作品标题。", "is-err"); $("#q-title").focus(); return; }
      qBtn.disabled = true;
      qResult.innerHTML = "";
      qShow("");
      fetch("api/photo-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title, author: author })
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok) throw new Error((j && j.error) || "查询失败");
          if (!j.items.length) {
            qShow("没有找到匹配的投稿，请核对标题与署名（需与投稿时填写一致）。", "is-err");
            return;
          }
          qResult.innerHTML = j.items.map(function (it) {
            var badge = it.status === "approved" ? " is-ok" : it.status === "offline" ? " is-off" : "";
            var link = it.status === "approved"
              ? '<a class="up-q__link" href="' + G.esc(it.file_url) + '" target="_blank" rel="noopener">查看作品 →</a>'
              : "";
            return '<div class="up-q' + badge + '">' +
              "<b>" + G.esc(it.title) + "</b>" +
              "<span class='up-q__cat'>" + G.esc(it.category) + "</span>" +
              "<span class='up-q__st'>" + G.esc(it.statusText) + "</span>" +
              link +
            "</div>";
          }).join("");
          qShow("查到 " + j.items.length + " 条记录。", "is-ok");
        })
        .catch(function (e) {
          qShow(e.message || "查询失败，请稍后重试。", "is-err");
        })
        .then(function () { qBtn.disabled = false; });
    });
  }
})();
