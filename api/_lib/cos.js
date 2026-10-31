"use strict";
/* ==========================================================================
   微光摄影社 · 腾讯云 COS 预签名 URL（零依赖）
   算法复刻官方 cos-nodejs-sdk-v5 的 getAuth（sdk/util.js）：
     SignKey       = HMAC-SHA1(SecretKey, KeyTime)                    hex 小写
     FormatString  = method \n /key \n params \n headers \n
     StringToSign  = sha1 \n KeyTime \n SHA1(FormatString) \n
     Signature     = HMAC-SHA1(SignKey, StringToSign)                 hex 小写
   参考：https://cloud.tencent.com/document/product/436/7778
   与 SDK 的关键一致点：传入 Bucket+Region 时把 Host 签入 header
   （防止签名被挪到别的桶使用）；URL 查询参数值全部 UrlEncode（; → %3B）。
   ========================================================================== */

var crypto = require("crypto");

/* 与 SDK camSafeUrlEncode 一致：encodeURIComponent 之外再编码 ! ' ( ) * */
function camSafeUrlEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/* 与 SDK obj2str(obj, true) 一致：key 排序 → 编码 → 小写；value 编码 */
function obj2str(obj) {
  var keys = Object.keys(obj).sort(function (a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    return a === b ? 0 : a > b ? 1 : -1;
  });
  return keys
    .map(function (k) {
      return camSafeUrlEncode(k).toLowerCase() + "=" + camSafeUrlEncode(String(obj[k]));
    })
    .join("&");
}

function cfg() {
  var miss = ["COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION"].filter(function (n) {
    return !process.env[n];
  });
  if (miss.length) {
    var err = new Error("服务端未配置存储环境变量：" + miss.join(", "));
    err.missing = miss;
    throw err;
  }
  return {
    SecretId: process.env.COS_SECRET_ID,
    SecretKey: process.env.COS_SECRET_KEY,
    Bucket: process.env.COS_BUCKET,
    Region: process.env.COS_REGION
  };
}

/* 桶的默认域名主机名，如 glimmer-photos.cos.ap-guangzhou.myqcloud.com */
function hostOf() {
  var c = cfg();
  return c.Bucket + ".cos." + c.Region + ".myqcloud.com";
}

/* 宽松版：未配置环境变量时返回 null（供不需要强依赖 COS 的场景判断） */
function hostOfSafe() {
  try {
    return hostOf();
  } catch (e) {
    return null;
  }
}

/* 生成一次签名。
   method: "put" / "delete" / "post" / "head" / "get"；key: 对象键（可含 / 目录）。
   extraHeaders: 需要一并签入的请求头（如 x-cos-copy-source / Pic-Operations /
   Content-Type）——COS 要求请求里出现的 x-cos-* 与参与处理运算的头必须进签名。
   返回 { url, host, key }，url 已带签名参数，可直接 fetch。 */
function sign(method, key, expiresSeconds, extraHeaders) {
  var c = cfg();
  var m = String(method || "put").toLowerCase();
  var now = Math.round(Date.now() / 1000) - 1;
  var exp = now + (expiresSeconds || 600);
  var keyTime = now + ";" + exp;

  // 与 SDK 一致：签入 Host，防跨桶挪用；附加头按调用方需求合并
  var headers = { Host: c.Bucket + ".cos." + c.Region + ".myqcloud.com" };
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function (k) {
      if (extraHeaders[k] != null) headers[k] = String(extraHeaders[k]);
    });
  }
  var headerList = Object.keys(headers)
    .map(function (k) { return k.toLowerCase(); })
    .sort()
    .join(";");

  var signKey = crypto.createHmac("sha1", c.SecretKey).update(keyTime).digest("hex");
  var formatString = Buffer.from([m, "/" + key, "", obj2str(headers), ""].join("\n"), "utf8");
  var stringToSign = ["sha1", keyTime, crypto.createHash("sha1").update(formatString).digest("hex"), ""].join("\n");
  var signature = crypto.createHmac("sha1", signKey).update(stringToSign).digest("hex");

  var auth = [
    "q-sign-algorithm=sha1",
    "q-ak=" + camSafeUrlEncode(c.SecretId),
    "q-sign-time=" + camSafeUrlEncode(keyTime),
    "q-key-time=" + camSafeUrlEncode(keyTime),
    "q-header-list=" + headerList,
    "q-url-param-list=",
    "q-signature=" + signature
  ].join("&");

  // 路径：/ 保留为目录分隔符，其余按 UTF-8 百分号编码
  var urlPath = encodeURIComponent(key).replace(/%2F/g, "/");
  return {
    url: "https://" + headers.Host + "/" + urlPath + "?" + auth,
    host: headers.Host,
    key: key
  };
}

/* 对象的公开访问地址（桶为公有读私有写） */
function publicUrl(key) {
  var c = cfg();
  return "https://" + c.Bucket + ".cos." + c.Region + ".myqcloud.com/" + encodeURIComponent(key).replace(/%2F/g, "/");
}

/* 限时预签名 GET 地址（v2.0.12）：私有语义对象的下载入口，比如月度备份 CSV。
   与 publicUrl 的区别：带签名 + 有效期，到期即失效；画廊图片仍走 publicUrl。
   前提：COS 桶策略对 _backup/* 拒绝匿名读（控制台操作），否则对象本身仍公有读。 */
function signedGetUrl(key, seconds) {
  return sign("get", key, seconds || 7 * 24 * 3600).url;
}

/* 从公开地址反推对象键；非本桶地址返回 null（用于删除前校验） */
function keyFromUrl(u) {
  var host = hostOfSafe();
  if (!host || typeof u !== "string") return null;
  var prefix = "https://" + host + "/";
  if (u.indexOf(prefix) !== 0) return null;
  var rest = u.slice(prefix.length);
  if (!rest || rest.indexOf("?") !== -1) return null;
  try {
    return decodeURIComponent(rest);
  } catch (e) {
    return null;
  }
}

/* COS/CI 错误响应（XML）→ 抛带 Code/Message 的 Error，便于上抛与通知 */
function errorFromRes(res) {
  return res.text().then(function (t) {
    var code = (/<Code>([^<]+)<\/Code>/.exec(t) || [])[1] || "";
    var msg = (/<Message>([^<]+)<\/Message>/.exec(t) || [])[1] || "";
    var err = new Error("COS/CI " + res.status + (code ? " " + code : "") + "：" +
      (msg || (t || "").slice(0, 120) || "请求失败"));
    err.status = res.status;
    throw err;
  }, function () {
    var err = new Error("COS/CI " + res.status + "：请求失败");
    err.status = res.status;
    throw err;
  });
}

/* 对象是否存在（签名 HEAD）。桶策略只拒匿名，不影响服务端自访 */
function objectExists(key) {
  var s = sign("head", key, 600);
  return fetch(s.url, { method: "HEAD" }).catch(function (e) {
    var code = e && e.cause && (e.cause.code || e.cause.message);
    throw new Error("存储对象查询失败" + (code ? "（" + code + "）" : "：" + (e.message || "fetch failed")));
  }).then(function (res) {
    if (res.ok) return true;
    if (res.status === 404) return false;
    return errorFromRes(res).then(function () { return false; });
  });
}

/* 复制对象。x-cos-copy-source 需 URL 编码、必须签入签名且真实随请求携带 */
function copyObject(fromKey, toKey) {
  var c = cfg();
  var source = camSafeUrlEncode(c.Bucket + ".cos." + c.Region + ".myqcloud.com/" + fromKey);
  var s = sign("put", toKey, 600, { "x-cos-copy-source": source });
  return fetch(s.url, { method: "PUT", headers: { "x-cos-copy-source": source } }).catch(function (e) {
    var code = e && e.cause && (e.cause.code || e.cause.message);
    throw new Error("存储复制失败" + (code ? "（" + code + "）" : "：" + (e.message || "fetch failed")));
  }).then(function (res) {
    if (!res.ok) return errorFromRes(res);
    return true;
  });
}

/* 写入缓冲对象（如水印 logo 自举上传） */
function putBuffer(key, buf, contentType) {
  var headers = contentType ? { "Content-Type": contentType } : null;
  var s = sign("put", key, 600, headers);
  return fetch(s.url, { method: "PUT", body: buf, headers: headers || undefined }).catch(function (e) {
    var code = e && e.cause && (e.cause.code || e.cause.message);
    throw new Error("存储写入失败" + (code ? "（" + code + "）" : "：" + (e.message || "fetch failed")));
  }).then(function (res) {
    if (!res.ok) return errorFromRes(res);
    return true;
  });
}

/* 数据万象·云上图片持久化处理（POST image_process + Pic-Operations 头，需签入）。
   官方语义：fileid 不以 / 开头时相对源对象所在目录解析——源在 _original/ 深处时
   输出会写进错误路径，因此 fileid 一律用「绝对路径」（/ 开头）保证覆盖 destKey。
   rule 为处理参数串，多个操作用管道符 | 串联（如 水印|盲水印）。 */
function imageProcess(srcKey, destKey, rule) {
  var pic = JSON.stringify({
    is_pic_info: 1,
    rules: [{
      fileid: "/" + encodeURIComponent(destKey).replace(/%2F/g, "/"),
      rule: rule
    }]
  });
  var s = sign("post", srcKey, 600, { "Pic-Operations": pic });
  return fetch(s.url + "&image_process", {
    method: "POST",
    headers: { "Pic-Operations": pic }
  }).catch(function (e) {
    var code = e && e.cause && (e.cause.code || e.cause.message);
    throw new Error("水印处理请求失败" + (code ? "（" + code + "）" : "：" + (e.message || "fetch failed")));
  }).then(function (res) {
    if (!res.ok) return errorFromRes(res);
    return res.json().catch(function () { return {}; });
  });
}

module.exports = {
  camSafeUrlEncode: camSafeUrlEncode,
  obj2str: obj2str,
  hostOf: hostOf,
  hostOfSafe: hostOfSafe,
  sign: sign,
  publicUrl: publicUrl,
  signedGetUrl: signedGetUrl,
  keyFromUrl: keyFromUrl,
  objectExists: objectExists,
  copyObject: copyObject,
  putBuffer: putBuffer,
  imageProcess: imageProcess
};
