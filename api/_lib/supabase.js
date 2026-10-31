"use strict";
/* ==========================================================================
   微光摄影社 · Supabase REST 读写（service_role 级密钥，仅服务端调用）
   前端 JS 永不直连数据库；所有读写经 Vercel 函数中转。
   表结构（已建好，禁止重跑 create table）：
     photos     — 作品（status: pending 待审核 / approved 已发布）
     submissions— 新生报名
   ========================================================================== */

function cfg() {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("服务端未配置数据库环境变量：SUPABASE_URL / SUPABASE_SERVICE_KEY");
  }
  return { url: url.replace(/\/+$/, ""), key: key };
}

/* 通用 REST 调用。path 形如 "photos?select=*&status=eq.approved&order=created_at.desc" */
function rest(method, path, body) {
  var c = cfg();
  var headers = {
    apikey: c.key,
    Authorization: "Bearer " + c.key,
    "Content-Type": "application/json"
  };
  if (body !== undefined && (method === "POST" || method === "PATCH")) {
    headers.Prefer = "return=representation";
  }
  /* v2.2.1 诊断：网络层失败（fetch reject）若裸抛，前端只会看到一句
     「fetch failed」，分不清是数据库还是存储出的问题——这里统一打上
     「数据库」标签并带上底层错误码（ECONNREFUSED / ENOTFOUND 等）。
     注意 .catch 只包住 fetch 本身，!ok 的业务错误在后面的 .then 里抛，不受影响 */
  return fetch(c.url + "/rest/v1/" + path, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).catch(function (e) {
    var code = e && e.cause && (e.cause.code || e.cause.message);
    throw new Error("数据库网络连接失败" + (code ? "（" + code + "）" : "：" + (e.message || "fetch failed")));
  }).then(function (res) {
    return res.text().then(function (text) {
      var data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = null;
      }
      if (!res.ok) {
        var msg =
          (data && (data.message || data.error_description || data.error)) ||
          text ||
          "HTTP " + res.status;
        var err = new Error("Supabase " + method + " 失败：" + msg);
        err.status = res.status;
        throw err;
      }
      return data;
    });
  });
}

var photos = {
  /* 只返回已审核作品；精选（featured）排最前，其余按时间倒序。
     旧库还没有 featured 列时自动回退为纯时间排序（平滑升级） */
  approved: function () {
    return rest("GET", "photos?select=*&status=eq.approved&order=featured.desc,created_at.desc")
      .catch(function (e) {
        if (!/featured|PGRST204|42703|schema cache/i.test(String(e.message || ""))) throw e;
        return rest("GET", "photos?select=*&status=eq.approved&order=created_at.desc");
      });
  },
  pending: function () {
    return rest("GET", "photos?select=*&status=eq.pending&order=created_at.desc");
  },
  /* 已下架（曾发布、后被干部隐藏的作品） */
  offline: function () {
    return rest("GET", "photos?select=*&status=eq.offline&order=created_at.desc");
  },
  byId: function (id) {
    return rest("GET", "photos?select=id,file_url&id=eq." + encodeURIComponent(id));
  },
  byIds: function (ids) {
    return rest("GET", "photos?select=id,file_url&id=in.(" + ids.map(encodeURIComponent).join(",") + ")");
  },
  create: function (row) {
    return rest("POST", "photos", row);
  },
  setStatus: function (id, status) {
    return rest("PATCH", "photos?id=eq." + encodeURIComponent(id), { status: status });
  },
  setStatusMany: function (ids, status) {
    return rest("PATCH", "photos?id=in.(" + ids.map(encodeURIComponent).join(",") + ")", { status: status });
  },
  update: function (id, row) {
    return rest("PATCH", "photos?id=eq." + encodeURIComponent(id), row);
  },
  remove: function (id) {
    return rest("DELETE", "photos?id=eq." + encodeURIComponent(id));
  },
  removeMany: function (ids) {
    return rest("DELETE", "photos?id=in.(" + ids.map(encodeURIComponent).join(",") + ")");
  },
  /* 全量（后台导出用） */
  all: function () {
    return rest("GET", "photos?select=*&order=created_at.desc");
  },
  /* 拒绝理由（v2.2.0）：成功返回 true；旧库无列时静默降级返回 false，
     让前端提示「理由未保存」 */
  setRejectReason: function (id, reason) {
    return rest("PATCH", "photos?id=eq." + encodeURIComponent(id), { reject_reason: reason || null })
      .then(function () { return true; })
      .catch(function (e) {
        if (!/reject_reason|PGRST204|42703|schema cache/i.test(String(e.message || ""))) throw e;
        return false;
      });
  },
  /* 精选标记（v2.2.0）：列缺失时抛错，由调用方转成「请先执行建列 SQL」的明确提示 */
  setFeatured: function (id, val) {
    return rest("PATCH", "photos?id=eq." + encodeURIComponent(id), { featured: !!val });
  }
};

var submissions = {
  all: function () {
    return rest("GET", "submissions?select=*&order=created_at.desc");
  },
  create: function (row) {
    return rest("POST", "submissions", row);
  },
  setHandled: function (id, handled) {
    return rest("PATCH", "submissions?id=eq." + encodeURIComponent(id), { handled: !!handled });
  }
};

module.exports = { photos: photos, submissions: submissions, rest: rest };
