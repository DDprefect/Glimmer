# -*- coding: utf-8 -*-
"""微光摄影社官网 —— 图片资源构建脚本
读取原始素材 -> EXIF 纠正 -> 输出 WebP 多尺寸到 assets/img
"""
import os, json, shutil
from PIL import Image, ImageOps

SRC = r"D:\ai工作\微光网站\摄影社素材（网站）"
ROOT = r"D:\ai工作\微光网站"
OUT = os.path.join(ROOT, "assets", "img")

def s(*p):
    return os.path.join(SRC, *p)

def u(*p):
    """上传网站/ —— 后续新增批次的统一入口"""
    return os.path.join(SRC, "上传网站", *p)

# ---------------------------------------------------------------- 作品清单
# (slug, 源文件, 分类, 标题, 地点/说明, 是否竖构图优先)
WORKS = [
    # ——— 校园纪实 · 凤麒喊楼
    ("hanlou-01", s("校园照片", "2026凤麒高三喊楼", "T1Z_3775 (复制).JPG"),   "campus", "凤麒喊楼", "高三喊楼 · 人海与微光", None),
    ("hanlou-02", s("校园照片", "2026凤麒高三喊楼", "T1Z_3781 (复制).JPG"),   "campus", "凤麒喊楼", "高三喊楼 · 声浪现场", None),
    ("hanlou-03", s("校园照片", "2026凤麒高三喊楼", "T1Z_3885 (复制).JPG"),   "campus", "凤麒喊楼", "高三喊楼 · 举起双手", None),
    ("hanlou-04", s("校园照片", "2026凤麒高三喊楼", "T1Z_3891 (复制).JPG"),   "campus", "凤麒喊楼", "高三喊楼 · 台上台下", None),
    ("hanlou-05", s("校园照片", "2026凤麒高三喊楼", "T1Z_3881 (复制).JPG"),   "campus", "凤麒喊楼", "高三喊楼 · 夜色舞台", None),
    ("hanlou-06", s("校园照片", "2026凤麒高三喊楼", "T1Z_3908 (复制).JPG"),   "campus", "凤麒喊楼", "高三喊楼 · 荧光成海", None),
    ("hanlou-07", s("校园照片", "2026凤麒高三喊楼", "T1Z_3911 (复制).JPG"),   "campus", "凤麒喊楼", "高三喊楼 · 旗帜飞扬", None),
    ("hanlou-08", s("校园照片", "2026凤麒高三喊楼", "T1Z_4071 (复制).JPG"),   "campus", "凤麒喊楼", "高三喊楼 · 最后的合影", None),
    # ——— 校园纪实 · 运动青春
    ("sports-01", s("校园照片", "运动会", "运动会2026.4.30", "T1Z_2124 (复制).JPG"), "campus", "运动青春", "百米赛跑 · 全力冲刺", None),
    ("sports-02", s("校园照片", "运动会", "运动会2026.4.30", "T1Z_2259 (复制).JPG"), "campus", "运动青春", "百米冲刺 · 年轻的脸", None),
    ("sports-03", s("校园照片", "运动会", "运动会2026.4.30", "B711C8D600FB01A9023FEE3FD5A1C373 (复制).jpg"), "campus", "运动青春", "跳高 · 越过横杆", None),
    ("sports-04", s("校园照片", "运动会", "运动会2026.4.30", "T1Z_2430 (复制).JPG"), "campus", "运动青春", "径赛 · 全力奔跑", None),
    ("sports-05", s("校园照片", "运动会", "运动会2026.4.30", "T1Z_2595 (复制).JPG"), "campus", "运动青春", "田径场上", None),
    ("sports-06", s("校园照片", "运动会", "运动会2026.4.30", "T1Z_2681 (复制).JPG"), "campus", "运动青春", "起跑 · 蓄势待发", None),
    ("sports-07", s("校园照片", "运动会", "运动会2026.4.30", "T1Z_3640 (复制).JPG"), "campus", "运动青春", "颁奖时刻", None),
    ("sports-08", s("校园照片", "运动会", "运动会2026.4.30", "T1Z_3647 (复制).JPG"), "campus", "运动青春", "领奖台上", None),
    ("sports-09", s("下载", "IMG_2378.JPG"),                                  "campus", "运动青春", "班级篮球赛 · 争球", None),
    # ——— 校园纪实 · 校园四季
    ("view-01", s("校园照片", "校园风光", "1097B19EB5D50F19C432962FE4B9542C.jpg"), "campus", "校园四季", "圆形广场俯瞰", None),
    ("view-02", s("校园照片", "校园风光", "1F13FA452AC679C7EFCE64AD895630BD.jpg"), "campus", "校园四季", "雕塑与老榕", None),
    ("view-03", s("校园照片", "校园风光", "56BBEA2EB9F70F45BCA5F8210799F1A5.JPG"), "campus", "校园四季", "教学楼前的晴天", None),
    ("view-04", s("校园照片", "校园风光", "73BD6FFAA4A9DB5FA79391F3A110FDA6.jpg"), "campus", "校园四季", "晨光里的广场", None),
    ("view-05", s("校园照片", "校园风光", "8EA25F4D13B90C1121E6791C77C886E1.jpg"), "campus", "校园四季", "林荫长道", None),
    ("view-06", s("校园照片", "校园风光", "902D0C89F1E629964C16D58FE6E42CAC.jpg"), "campus", "校园四季", "走廊与树影", None),
    ("view-07", s("校园照片", "校园风光", "A8B56A0523E56FEB0EC5384AD7A6DBF5.jpg"), "campus", "校园四季", "紫荆花道 · 满地落花", None),
    ("view-08", s("校园照片", "校园风光", "B10E56E467BD3C23D78AA1552FC18563.jpg"), "campus", "校园四季", "花影雕塑", None),
    ("view-09", s("校园照片", "校园风光", "CA2300FFEE1484A206325E66C88A8FC6.jpg"), "campus", "校园四季", "校门雕塑", None),
    ("view-10", s("校园照片", "校园风光", "DB5917D15530FD632A302F7FF6C717E6.jpg"), "campus", "校园四季", "红砖老楼", None),
    ("view-11", s("下载", "4.png"),                                               "campus", "校园四季", "柳铁一中 · 校门", None),
    ("view-12", s("校园照片", "校园风光", "7CCA3D9C0290A2F57640D98E6AADCDF6.JPG"), "campus", "校园四季", "校园一景 · 光影", None),
    # ——— 校外采风 · 玉武三江
    ("sanjiang-01", s("校外活动", "玉武三江研学", "IMG_20260328_120436_0_2026-08-19_12-03-07_939 (复制).jpg"),   "field", "玉武三江", "侗寨风雨桥", "竖"),
    ("sanjiang-02", s("校外活动", "玉武三江研学", "IMG_20260328_121233_1_2026-08-19_12-03-07_972 (复制).jpg"),   "field", "玉武三江", "寨中巷道", "竖"),
    ("sanjiang-03", s("校外活动", "玉武三江研学", "IMG_20260328_121420_2_2026-08-19_12-03-07_997 (复制).jpg"),   "field", "玉武三江", "市集红蛋", None),
    ("sanjiang-04", s("校外活动", "玉武三江研学", "IMG_20260329_100244_3_2026-08-19_12-03-08_021 (复制).jpg"),   "field", "玉武三江", "远山云雾", None),
    ("sanjiang-05", s("校外活动", "玉武三江研学", "IMG_20260329_101507_4_2026-08-19_12-03-08_047 (复制).jpg"),   "field", "玉武三江", "红竹笼", None),
    ("sanjiang-06", s("校外活动", "玉武三江研学", "IMG_20260329_111831_5_2026-08-19_12-03-08_066 (复制).jpg"),   "field", "玉武三江", "春白花", "竖"),
    ("sanjiang-07", s("校外活动", "玉武三江研学", "IMG_9633 (复制).JPG"),  "field", "玉武三江", "寨中石板路", None),
    ("sanjiang-08", s("校外活动", "玉武三江研学", "IMG_9655 (复制).JPG"),  "field", "玉武三江", "采茶的少年", None),
    ("sanjiang-09", s("校外活动", "玉武三江研学", "IMG_9659 (复制).JPG"),  "field", "玉武三江", "茶园孤树", None),
    ("sanjiang-10", s("校外活动", "玉武三江研学", "IMG_9665 (复制).JPG"),  "field", "玉武三江", "梯田茶园", "竖"),
    ("sanjiang-11", s("校外活动", "玉武三江研学", "IMG_9793 (复制).JPG"),  "field", "玉武三江", "雨后村寨", None),
    ("sanjiang-12", s("校外活动", "玉武三江研学", "IMG_9818 (复制).JPG"),  "field", "玉武三江", "远山积翠", "竖"),
    ("sanjiang-13", s("校外活动", "玉武三江研学", "IMG_9822 (复制).JPG"),  "field", "玉武三江", "云雾木楼", "竖"),
    ("sanjiang-14", s("校外活动", "玉武三江研学", "IMG_9850 (复制).JPG"),  "field", "玉武三江", "吊脚楼人家", None),
    ("sanjiang-15", s("校外活动", "玉武三江研学", "IMG_9853 (复制).JPG"),  "field", "玉武三江", "寨角", "竖"),
    ("sanjiang-16", s("校外活动", "玉武三江研学", "IMG_9856 (复制).JPG"),  "field", "玉武三江", "风雨桥下", "竖"),
    ("sanjiang-17", s("校外活动", "玉武三江研学", "IMG_9882 (复制).JPG"),  "field", "玉武三江", "苗家阿婆", None),
    ("sanjiang-18", s("下载", "20.JPG"),                            "field", "玉武三江", "寨落全景", "竖"),
    # ——— 城市与远方
    ("city-01", s("下载", "13.jpg"),                 "city", "城市与远方", "柳江落日 · 群峰剪影", None),
    ("city-02", s("下载", "IMG_0117.JPG"),           "city", "城市与远方", "城市黄昏", None),
    ("city-03", s("下载", "IMG_2690.jpg"),           "city", "城市与远方", "天际线", None),
    ("city-04", s("下载", "IMG_3333.jpg"),           "city", "城市与远方", "黄昏大树", "竖"),
    ("city-05", s("下载", "11.jpg"),                 "city", "城市与远方", "文惠桥", None),
    ("city-06", s("下载", "9.jpg"),                  "city", "城市与远方", "蓝天白云", None),
    ("city-07", s("下载", "15.JPG"),                 "city", "城市与远方", "山间人家", None),
    ("city-08", s("下载", "5.png"),                  "city", "城市与远方", "街巷暖阳", None),
    ("city-09", s("下载", "16.jpg"),                 "city", "城市与远方", "雕塑光影", None),
    ("city-10", s("下载", "mmexport1786551223813.jpg"), "city", "城市与远方", "光绘 · 跳动的光", "竖"),
    # ——— 人像与视觉
    ("portrait-01", s("招新", "6BE81A7D132BECCEA073F250DCEB20CE.png"), "portrait", "人像与视觉", "点点微光 · 汇入星河", "竖"),
    ("portrait-02", s("招新", "DA7E28C4DFF7B5C29B6C298887A3B711.png"), "portrait", "人像与视觉", "秋日暖调人像", "竖"),
    ("portrait-03", s("招新", "6D82C61DBF6FCF0A2032E433BB1AA69D.png"), "portrait", "人像与视觉", "竹林剑影", None),

    # ——— 人像与视觉 · 第二期（上传网站/人像，18 张，均为社员原创实拍）
    ("portrait-04", u("人像", "Image_1748788051554 (复制).jpg"),        "portrait", "人像与视觉", "荷间 · 低眉",     "横"),
    ("portrait-05", u("人像", "Image_1771696108427_501 (复制).jpg"),    "portrait", "人像与视觉", "古窗 · 侧影",     "竖"),
    ("portrait-06", u("人像", "Image_1777125770482_754 (复制).jpg"),    "portrait", "人像与视觉", "竹林 · 回眸",     "竖"),
    ("portrait-07", u("人像", "Image_1752466758689 (复制).jpg"),        "portrait", "人像与视觉", "窗边 · 光影",     "竖"),
    ("portrait-08", u("人像", "20250315202611_IMG_0069 (复制).JPG"),    "portrait", "人像与视觉", "水畔 · 凝望",     "横"),
    ("portrait-09", u("人像", "retouch_2025050121004469 (复制).jpg"),   "portrait", "人像与视觉", "檐下 · 执扇",     "竖"),
    ("portrait-10", u("人像", "retouch_2025012121231607 (复制).jpg"),   "portrait", "人像与视觉", "玉兰 · 假寐",     "横"),
    ("portrait-11", u("人像", "retouch_2025050122280161 (复制).jpg"),   "portrait", "人像与视觉", "古宅 · 端坐",     "横"),
    ("portrait-12", u("人像", "Image_1771696111014_782 (复制).jpg"),    "portrait", "人像与视觉", "执剑 · 少年",     "横"),
    ("portrait-13", u("人像", "Image_1770092588231_690 (复制).jpg"),    "portrait", "人像与视觉", "白裙 · 浅笑",     "横"),
    ("portrait-14", u("人像", "Image_1751604038316 (复制).jpg"),        "portrait", "人像与视觉", "草帽 · 玫瑰",     "竖"),
    ("portrait-15", u("人像", "Image_1771339128323_707 (复制).jpg"),    "portrait", "人像与视觉", "花丛 · 抱花",     "横"),
    ("portrait-16", u("人像", "Image_1752466804199 (复制).jpg"),        "portrait", "人像与视觉", "红玫 · 手捧花束", "竖"),
    ("portrait-17", u("人像", "Image_1770054394461_464 (复制).png"),    "portrait", "人像与视觉", "舞台 · 少年",     "横"),
    ("portrait-18", u("人像", "retouch_2025072823431191 (复制).jpg"),   "portrait", "人像与视觉", "少女 · 黑衫",     "竖"),
    ("portrait-19", u("人像", "Image_1771696118054_487 (复制).jpg"),    "portrait", "人像与视觉", "树荫 · 仰首",     "横"),
    ("portrait-20", u("人像", "Image_75229115051868 (复制).jpg"),       "portrait", "人像与视觉", "绿意 · 白裙",     "竖"),
    ("portrait-21", u("人像", "Image_1751474192473 (复制).jpg"),        "portrait", "人像与视觉", "逆光 · 凝视",     "横"),
]

# ---------------------------------------------------------------- 首页大图
HEROES = [
    ("hero-campus",  s("下载", "18.JPG"),                                        2000),
    ("hero-night",   s("校园照片", "2026凤麒高三喊楼", "T1Z_3906 (复制).JPG"),            2000),
    ("hero-city",    s("下载", "13.jpg"),                                        2000),
    ("hero-blossom", s("校园照片", "校园风光", "A8B56A0523E56FEB0EC5384AD7A6DBF5.jpg"), 1600),
    ("hero-sports",  s("校园照片", "运动会", "运动会2026.4.30", "T1Z_2259 (复制).JPG"),    1800),
    ("hero-field",   s("校外活动", "玉武三江研学", "IMG_20260328_120436_0_2026-08-19_12-03-07_939 (复制).jpg"), 2000),
    ("hero-street",  s("下载", "5.png"),                                          1800),
]

# ---------------------------------------------------------------- 品牌资产
# (slug, 源文件, 输出格式, 最长边)
BRANDS = [
    ("logo-onlight",   s("摄影社核心材料", "Image_1759431165183.png"), "png", 720),
    ("logo-ondark",    s("摄影社核心材料", "Image_1751471389287.png"), "png", 926),
    ("mark",           s("摄影社核心材料", "Image_1759431180639.png"), "png", 180),
    ("mark-light",     s("摄影社核心材料", "Image_1765023421686.png"), "png", 180),
    ("badge-school",   s("摄影社核心材料", "Image_1759431174430.png"), "png", 800),
    ("school-strip",   s("摄影社核心材料", "Image_1759431176530.png"), "png", 1800),
    ("mascot",         s("摄影社核心材料", "Image_1759431171149.png"), "png", 800),
    ("mascot-dark",    s("摄影社核心材料", "Image_1765023416277.png"), "png", 800),
    ("illustration",   s("摄影社核心材料", "Image_1780164972953_916.png"), "png", 900),
    ("poster-join",    s("招新", "B613225EF5325283FA430C419693CDE0.jpg"), "png", 1100),
    ("poster-recruit", s("招新", "1BC150C634B01CE50252C8BA1DC4F2F8.jpg"), "webp", 1100),
    ("poster-city",    s("招新", "1DA6796674DCF277DDA9EE8F8717952B.jpg"), "webp", 1100),
]

def load(path):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    return im

# ---------------------------------------------------------------- 拍摄信息（EXIF）
# 只抽「确实存在」的字段；抽不到就整体返回 None，前端按「无拍摄信息」渲染。
# 两个必须记住的坑：
#   1) getexif() / get_ifd() 的键是**数字标签**（0x0110），不是 "Model" 这种字符串名
#      —— 用字符串名会静默取不到，不报错，只是永远 None。
#   2) 光圈/快门/ISO/镜头在 **Exif 子 IFD**（指针 0x8769 / 34665）里，
#      不在第 0 IFD，必须 get_ifd(0x8769) 再取。
# JS 侧已用 String() 兼容索引是字符串键的浏览器实现，改回字符串名会立刻失效。
_TAG0 = {          # 第 0 IFD
    0x0110: "camera",   # Model
    0x9003: "date",     # DateTimeOriginal
}
_TAG_EXIF = {      # Exif 子 IFD
    0xA434: "lens",     # LensModel
    0x829D: "aperture", # FNumber
    0x829A: "shutter",  # ExposureTime
    0x8827: "iso",      # ISOSpeedRatings / PhotographicSensitivity
    0x920A: "focal",    # FocalLength
}

def _pretty(field, v):
    try:
        if field == "date":            # "2026:08:14 15:32:10" -> "2026-08-14"
            return str(v).split(" ")[0].replace(":", "-")
        if field == "aperture":        # IFDRational(56,10) -> "f/5.6"
            return "f/%g" % float(v)
        if field == "shutter":         # 0.0025 -> "1/400s"
            num, den = float(v.numerator), float(v.denominator)
            if num <= 0 or den <= 0:
                return None
            sec = num / den
            if sec >= 1:
                return "%gs" % sec
            return "1/%gs" % round(1 / sec)
        if field == "iso":             # 200 -> "ISO 200"
            val = v[0] if isinstance(v, (list, tuple)) else v
            if not val:
                return None
            return "ISO %s" % val
        if field == "focal":           # 50.0 -> "50mm"
            f = float(v)
            if not f:
                return None
            return "%gmm" % f
    except Exception:
        return None
    return str(v)

def _pick(d, table, shot):
    for tag, field in table.items():
        if field in shot:
            continue
        v = d.get(tag)
        if v is None:
            continue
        p = _pretty(field, v)
        if p:
            shot[field] = p

def exif_shot(im):
    """从原图 EXIF 抽拍摄信息；拿不到就返回 None，绝不影响构建"""
    try:
        ex = im.getexif()
        if not ex:
            return None
        shot = {}
        _pick(ex, _TAG0, shot)
        try:
            ifd = ex.get_ifd(0x8769)
        except Exception:
            ifd = {}
        if ifd:
            _pick(ifd, _TAG_EXIF, shot)
        return shot or None
    except Exception:
        return None

def fit(im, longest):
    w, h = im.size
    m = max(w, h)
    if m <= longest:
        return im
    r = longest / m
    return im.resize((max(1, round(w * r)), max(1, round(h * r))), Image.LANCZOS)

def save_webp(im, path, q=82):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.mode else "RGB")
    im.save(path, "WEBP", quality=q, method=6)

manifest = []
missing = []

for slug, src, cat, group, title, orient in WORKS:
    if not os.path.exists(src):
        missing.append(src); continue
    im = load(src)
    w, h = im.size
    big = fit(im.convert("RGB"), 1800)
    save_webp(big, os.path.join(OUT, "works", slug + ".webp"), 84)
    save_webp(fit(im.convert("RGB"), 880), os.path.join(OUT, "works", slug + "-t.webp"), 78)
    manifest.append({
        "id": slug, "cat": cat, "group": group, "title": title,
        "src": f"assets/img/works/{slug}.webp",
        "thumb": f"assets/img/works/{slug}-t.webp",
        "w": big.size[0], "h": big.size[1],
        "ratio": round(w / h, 3),
        "portrait": (h > w),
        "shot": exif_shot(im),
    })

for slug, src, longest in HEROES:
    if not os.path.exists(src):
        missing.append(src); continue
    im = load(src).convert("RGB")
    save_webp(fit(im, longest), os.path.join(OUT, "hero", slug + ".webp"), 86)
    save_webp(fit(im, 900), os.path.join(OUT, "hero", slug + "-t.webp"), 76)

for slug, src, fmt, longest in BRANDS:
    if not os.path.exists(src):
        missing.append(src); continue
    im = fit(load(src), longest)
    if fmt == "png":
        dst = os.path.join(OUT, "brand", slug + ".png")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if im.mode != "RGBA":
            im = im.convert("RGBA")
        im.save(dst, "PNG", optimize=True)
    else:
        dst = os.path.join(OUT, "brand", slug + ".webp")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        save_webp(im.convert("RGB"), dst, 84)

os.makedirs(os.path.join(ROOT, "assets", "data"), exist_ok=True)
with open(os.path.join(ROOT, "assets", "data", "works.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
# 同时输出 JS 包装版：file:// 直接打开时 fetch 会被 CORS 拦截，脚本加载不受限
with open(os.path.join(ROOT, "assets", "data", "works.js"), "w", encoding="utf-8") as f:
    f.write("/* 微光摄影社 · 作品数据（由 _tools/build_assets.py 生成，请勿手改） */\n")
    f.write("window.WORKS = ")
    f.write(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    f.write(";\n")

print(f"作品 {len(manifest)} 张 | hero {len(HEROES)} | brand {len(BRANDS)}")
if missing:
    print("!! 缺失:")
    for m in missing:
        print("   ", m)
