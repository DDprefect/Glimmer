/* ==========================================================================
   微光摄影社 · EXIF 拍摄参数解析（零依赖）
   投稿时从原图读取 机型 / 镜头 / 光圈 / 快门 / ISO / 焦段 / 拍摄日期，
   随作品一起提交；审核通过后显示在作品集灯箱的拍摄信息行里。
   读不到（无 EXIF / 非 JPEG / 解析异常）一律返回 null，不影响投稿本身。
   ========================================================================== */
(function () {
  "use strict";

  /* EXIF 的 APP1 段总在文件头部，取前 256KB 足够，避免把整张原图读进内存 */
  var MAX_HEAD = 256 * 1024;

  /* ---- 底层读取 ---- */
  function readAscii(view, base, off, len) {
    var s = "";
    for (var i = 0; i < len; i++) {
      var c = view.getUint8(base + off + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.replace(/\s+$/, "").trim();
  }

  /* 找 JPEG 的 APP1（Exif）段，返回 TIFF 数据起始偏移；找不到返回 -1 */
  function findTiff(view) {
    if (view.byteLength < 4) return -1;
    if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return -1; // 不是 JPEG
    var p = 2;
    while (p + 4 <= view.byteLength) {
      if (view.getUint8(p) !== 0xff) return -1;
      var marker = view.getUint8(p + 1);
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { p += 2; continue; }
      var len = view.getUint16(p + 2, false);
      if (len < 2 || p + 2 + len > view.byteLength) return -1;
      if (marker === 0xe1) {
        if (readAscii(view, 0, p + 4, 4) === "Exif") return p + 10;
        return -1;
      }
      p += 2 + len;
    }
    return -1;
  }

  /* 遍历一个 IFD，逐项回调 (tag, type, count, valueOffset) */
  function eachEntry(view, tiff, ifdOff, little, cb) {
    if (iffOffBad(view, tiff, ifdOff)) return;
    var n = view.getUint16(tiff + ifdOff, little);
    for (var i = 0; i < n; i++) {
      var e = tiff + ifdOff + 2 + i * 12;
      if (e + 12 > view.byteLength) return;
      cb(view.getUint16(e, little), view.getUint16(e + 2, little), view.getUint32(e + 4, little), e + 8);
    }
  }
  function ifdOffBad(view, tiff, off) {
    return off < 0 || tiff + off + 2 > view.byteLength;
  }

  /* ---- 原始值抽取 ---- */
  function parseRaw(view) {
    var tiff = findTiff(view);
    if (tiff < 0 || tiff + 8 > view.byteLength) return null;
    var little = view.getUint8(tiff) === 0x49; // "II" 小端 / "MM" 大端
    if (view.getUint16(tiff + 2, little) !== 42) return null;

    var raw = {};
    var exifIfd = 0;
    eachEntry(view, tiff, view.getUint32(tiff + 4, little), little, function (tag, type, count, valOff) {
      if (tag === 0x010f && type === 2) raw.make = readAscii(view, tiff, tiff + valOff, count);
      else if (tag === 0x0110 && type === 2) raw.model = readAscii(view, tiff, tiff + valOff, count);
      else if (tag === 0x8769 && type === 4) exifIfd = view.getUint32(valOff, little);
    });

    if (exifIfd) {
      eachEntry(view, tiff, exifIfd, little, function (tag, type, count, valOff) {
        if (tag === 0x9003 && type === 2) raw.dateTime = readAscii(view, tiff, tiff + valOff, count);
        else if (tag === 0xa434 && type === 2) raw.lens = readAscii(view, tiff, tiff + valOff, count);
        else if (tag === 0x829d && type === 5) raw.fNumber = rational(view, tiff, valOff, little);
        else if (tag === 0x829a && type === 5) raw.exposure = rational(view, tiff, valOff, little);
        else if (tag === 0x920a && type === 5) raw.focal = rational(view, tiff, valOff, little);
        else if (tag === 0x8827 && type === 3) raw.iso = view.getUint16(valOff, little);
      });
    }
    return raw;
  }

  function rational(view, tiff, valOff, little) {
    var p = view.getUint32(valOff, little); // RATIONAL 值域存的是偏移
    if (tiff + p + 8 > view.byteLength) return null;
    var num = view.getUint32(tiff + p, little);
    var den = view.getUint32(tiff + p + 4, little);
    return den === 0 ? null : num / den;
  }

  /* ---- 格式化为站点展示口径（与静态作品 works.js 里的 shot 一致） ---- */
  function num(v) {
    return String(Math.round(v * 100) / 100);
  }

  function normalize(raw) {
    if (!raw) return null;
    var out = {};

    var make = (raw.make || "").replace(/\s+/g, " ");
    var model = (raw.model || "").replace(/\s+/g, " ");
    var camera = (make && model) ? (model.toUpperCase().indexOf(make.toUpperCase()) === 0 ? model : make + " " + model) : (model || make);
    if (camera) out.camera = camera.slice(0, 60);

    if (raw.lens) out.lens = String(raw.lens).slice(0, 60);
    if (raw.fNumber && raw.fNumber > 0) out.aperture = "f/" + num(raw.fNumber);
    if (raw.exposure && raw.exposure > 0) {
      out.shutter = raw.exposure < 1 && raw.exposure > 0
        ? "1/" + Math.round(1 / raw.exposure) + "s"
        : num(raw.exposure) + "s";
    }
    if (raw.iso && raw.iso > 0) out.iso = "ISO " + Math.round(raw.iso);
    if (raw.focal && raw.focal > 0) out.focal = Math.round(raw.focal) + "mm";

    /* "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DD" */
    var dm = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw.dateTime || "");
    if (dm) out.shotAt = dm[1] + "-" + dm[2] + "-" + dm[3];

    return Object.keys(out).length ? out : null;
  }

  /* ---- 入口：File/Blob → Promise<规范化拍摄参数 | null> ---- */
  function read(file) {
    if (!file || typeof file.slice !== "function") return Promise.resolve(null);
    return file.slice(0, MAX_HEAD).arrayBuffer().then(function (buf) {
      try {
        return normalize(parseRaw(new DataView(buf)));
      } catch (e) {
        return null; // 解析失败不阻塞投稿
      }
    }).catch(function () { return null; });
  }

  window.GlimmerEXIF = { read: read };
})();
