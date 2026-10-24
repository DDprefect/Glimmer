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
  return fetch(c.url + "/rest/v1/" + path, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body)
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
  /* 只返回已审核作品，新的在前 */
  approved: function () {
    return rest("GET", "photos?select=*&status=eq.approved&order=created_at.desc");
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
