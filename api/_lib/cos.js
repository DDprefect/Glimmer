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
   method: "put" / "delete"；key: 对象键（可含 / 目录）。
   返回 { url, host, key }，url 已带签名参数，可直接 fetch。 */
function sign(method, key, expiresSeconds) {
  var c = cfg();
  var m = String(method || "put").toLowerCase();
  var now = Math.round(Date.now() / 1000) - 1;
  var exp = now + (expiresSeconds || 600);
  var keyTime = now + ";" + exp;

  // 与 SDK 一致：签入 Host，防跨桶挪用
  var headers = { Host: c.Bucket + ".cos." + c.Region + ".myqcloud.com" };

  var signKey = crypto.createHmac("sha1", c.SecretKey).update(keyTime).digest("hex");
  var formatString = Buffer.from([m, "/" + key, "", obj2str(headers), ""].join("\n"), "utf8");
  var stringToSign = ["sha1", keyTime, crypto.createHash("sha1").update(formatString).digest("hex"), ""].join("\n");
  var signature = crypto.createHmac("sha1", signKey).update(stringToSign).digest("hex");

  var auth = [
    "q-sign-algorithm=sha1",
    "q-ak=" + camSafeUrlEncode(c.SecretId),
    "q-sign-time=" + camSafeUrlEncode(keyTime),
    "q-key-time=" + camSafeUrlEncode(keyTime),
    "q-header-list=host",
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

module.exports = {
  camSafeUrlEncode: camSafeUrlEncode,
  obj2str: obj2str,
  hostOf: hostOf,
  hostOfSafe: hostOfSafe,
  sign: sign,
  publicUrl: publicUrl,
  keyFromUrl: keyFromUrl
};
