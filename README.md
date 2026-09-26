<p align="center">
  <img src="assets/img/brand/logo-onlight.png" alt="微光摄影社" width="180">
</p>

<h1 align="center">微光摄影社官网 · Glimmer Photography Agency</h1>

<p align="center">
  <img src="https://img.shields.io/badge/静态站点-原生%20HTML%2FCSS%2FJS-B03A22?style=flat-square" alt="静态站点">
  <img src="https://img.shields.io/badge/无构建-双击%20index.html%20即可打开-BF8B34?style=flat-square" alt="无构建">
  <img src="https://img.shields.io/badge/作品-60%20张%20原创实拍-B03A22?style=flat-square" alt="作品数量">
  <img src="https://img.shields.io/badge/部署-Vercel-000000?style=flat-square&logo=vercel" alt="部署">
</p>

<p align="center">
  <b>汇聚细碎光影，留存滚烫青春。</b><br>
  以微小之姿看世界，以虔诚之姿定光影。
</p>

---

## 项目简介

柳铁一中**微光摄影社**官方网站。社团拥有学校官方社团背书，但**由学生团队独立自主运营**——从拍摄、编辑、排版到上线部署，全部由社员完成。

设计语言取「明亮胶片感」：暖米白纸感背景（`#F7F2E9`）、相纸白框、暗房红（`#B03A22`）、暖金（`#BF8B34`），配合 `01 / 02 / 03` 描边大数字与 `ACT Ⅰ` 式 mono 眉标，营造影视片头的叙事感。

- 🌐 **在线预览**：<https://lityzglimmer.top>
- 📦 **仓库**：<https://github.com/DDprefect/Glimmer>

---

## 功能特性

| 模块 | 说明 |
| --- | --- |
| **轮播 Hero** | 首页 7 张 2000px 大图轮播，配合滚动视差与入场动效 |
| **瀑布流作品集** | CSS multi-column 瀑布流，60 张作品横竖混排自适应，比例钳制在 `[0.8, 1.6]` |
| **分类筛选** | 校园纪实 / 校外采风 / 城市与远方 / 人像与视觉，支持 URL hash 直达（`gallery.html#portrait`） |
| **分步加载** | 每批 15 张，避免长列表一次渲染阻塞主线程 |
| **灯箱浏览** | 大图查看、键盘左右切换分类、ESC 关闭 |
| **实时计时器** | 关于页「运行时长」模块：自 2016-09-10 起算，年 / 天 / 时 / 分 / 秒五列里程表式滚动 |
| **胶片颗粒覆膜** | 全局 SVG `feTurbulence` 噪点层，1.1s 步进抖动，模拟胶片颗粒 |
| **零门槛招新** | 报名表单 + 招新海报墙 + FAQ，明确「不设门槛、不唯设备、不限基础」 |

**技术上的几个坚持**：

- ✅ **无任何第三方依赖**——没有框架、没有 npm 包、没有 CDN 外链脚本
- ✅ **`file://` 直接可用**——作品数据以 `window.WORKS` 内联，不走 `fetch`，双击 HTML 就能看
- ✅ **`aspect-ratio` 零抖动布局**——图片全部带 `w/h/ratio`，加载前后不跳版

---

## 快速上手

### 方式一：直接打开（最快）

双击 `index.html`，浏览器以 `file://` 协议打开也能完整运行。

> 唯一限制：`file://` 下无法 `fetch` 本地 JSON——但本项目数据本就以 JS 变量内联，所以不受影响。

### 方式二：本地服务器（推荐开发用）

```bash
python -m http.server 8848
# 浏览器打开 http://127.0.0.1:8848/index.html
```

或用任意静态服务器（`npx serve`、VS Code Live Server 均可）。

### 方式三：部署

站点部署在 **Vercel**，绑定自定义域名 `lityzglimmer.top`。

```bash
vercel --prod          # 或直接在 Vercel 后台 Import GitHub 仓库
```

`.vercelignore` 已排除 `_tools/`（构建脚本与调试页不参与线上部署）。

---

## 目录结构

```
├── index.html                  首页：Hero 轮播 / 社团理念 / 两大板块 / 三组精选 / 加入 CTA
├── gallery.html                作品集：分类筛选 / 分步加载 / 灯箱浏览
├── about.html                  关于我们：品牌故事 / 零门槛承诺 / 运行时长计时器 / 平台说明
├── join.html                   加入微光：入社流程 / 报名表单 / 招新海报墙 / FAQ
│
├── assets/
│   ├── css/main.css            设计系统：色彩令牌 / 胶片颗粒 / 响应式断点
│   ├── js/site.js              内核：导航与页脚注入 / 滚动入场 / 片头遮罩 / 灯箱 / workCard
│   ├── js/home.js              首页轮播与精选渲染
│   ├── js/gallery.js           作品集：筛选 / 分步加载 / 键盘导航
│   ├── js/since.js             运行时长计时器（静态条带式 odometer）
│   ├── data/works.js           作品数据（window.WORKS，由脚本生成）
│   └── img/
│       ├── works/              作品图 1800px + 缩略图 880px（WebP）
│       ├── hero/               首页大图 最长边 2000px
│       └── brand/              品牌资产（Logo / 徽章 / 吉祥物 / 海报，保留透明通道）
│
├── _tools/                     本地工具（不参与线上部署）
│   ├── build_assets.py         素材构建：EXIF 纠正 → 多尺寸 WebP → 刷新 works.js
│   ├── autopush.sh             Git 自动暂存 / 提交 / 推送（bash 版）
│   ├── autopush.ps1            同上（PowerShell 版，UTF-8 BOM）
│   ├── autopush.bat            Windows 双击入口（绕过 Restricted 执行策略）
│   ├── _check_since.js         计时器回归断言（jsdom）
│   └── _frame.html             窄屏验收用 iframe 容器
│
├── 摄影社素材（网站）/          原始素材 3.0G — 已由 .gitignore 排除，不入仓库
├── .vercelignore               部署排除项
└── README.md
```

---

## 素材与构建

**原始照片存放在 `摄影社素材（网站）/`，不入库**（已由 `.gitignore` 排除）。

新增或调整作品时，**不要手改 `assets/data/works.js`**（它是生成物）。正确做法是编辑 `_tools/build_assets.py` 里的清单：

```python
# (slug, 源文件, 分类, 分组, 标题, 是否竖构图优先)
("portrait-04", s("人像", "IMG_1201.JPG"), "portrait", "人像与视觉", "窗边侧影", "竖"),
```

然后重新生成：

```bash
python _tools/build_assets.py
```

**输出规格**：

| 类型 | 规格 |
| --- | --- |
| 作品大图 | 长边 1800px · WebP q84 |
| 作品缩略图 | 长边 880px · WebP q78 |
| Hero | 长边 1600~2000px · WebP q86（另出 900px `-t` 版） |
| 品牌资产 | PNG 保留 alpha / 海报类 WebP |

依赖：`Pillow`

```bash
pip install Pillow
```

---

## 作品数据字段

`assets/data/works.js` 中每条记录的结构：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一标识，同时决定图片文件名 |
| `cat` | string | 分类：`campus` / `field` / `city` / `portrait` |
| `group` | string | 二级分组（如「凤麒喊楼」「玉武三江」） |
| `title` | string | 展示标题 |
| `src` / `thumb` | string | 大图 / 缩略图路径 |
| `w` / `h` / `ratio` | number | 原始宽高与宽高比，用于零抖动布局 |
| `portrait` | boolean | 是否竖构图 |

> 分类与 `cat` 的中文对照维护在 `assets/js/gallery.js` 的 `CATS` 数组中，新增分类需同步两处。

---

## 常用脚本

### 自动推送 Git

```bash
# 默认提交信息
bash _tools/autopush.sh

# 指定提交信息与分支
bash _tools/autopush.sh -m "feat: 新增人像专题" -b main

# 预演（不落地任何变更）
bash _tools/autopush.sh --dry-run
```

Windows 用户：双击 `_tools/autopush.bat`，或在 PowerShell 中执行 `_tools\autopush.ps1`。

参数：`-m/--message` 提交信息、`-r/--remote` 远程名（默认 `origin`）、`-b/--branch` 分支（默认当前分支）、`-n/--dry-run` 预演、`-h/--help` 帮助。

退出码：`0` 成功 / `2` 无变更 / `3` 未配置用户信息 / `4` 非 Git 仓库 / `5` 提交失败 / `6` 推送被拒（需先拉取）/ `7` 远程不存在 / `8` 分支不存在 / `10` 参数错误。

---

## 调试

| 技巧 | 用法 |
| --- | --- |
| **截图模式** | 任意页面加 `?shot=1`：关闭全部动效、直接呈现最终状态，JS 渲染的图片也会强制加载 |
| **段落偏移** | 配合 `&begin=4000` 用负 margin 偏移，截取长页面的任意段落 |
| **窄屏验收** | `_tools/_frame.html?w=390&h=1440&src=gallery.html%3Fshot%3D1`（Edge 最小视口约 492px，必须走 iframe 模拟真机） |
| **计时器回归** | `NODE_PATH=<workspace>/node_modules node _tools/_check_since.js`（jsdom DOM 级断言） |

---

## 更新记录

格式：`### v主版本.次版本.修订号 · 日期` + `- **类型**｜描述`，类型取 **新增 / 优化 / 修复** 之一。

### v1.2.0 · 2026-09-26

- **新增**｜「运行时长」实时计时器模块（关于页）：自 2016-09-10 零点起算，年 / 天 / 时 / 分 / 秒五列分层展示，里程表式滚动，1 秒自校准，支持页面隐藏后回归时的时间校准。（`327e4f1`）
- **修复**｜计时器「秒」位数字顺序错误——原本数字 4 上方错位显示 3。重写为静态条带式 odometer：一次铺设 21 格三环，取「严格高于当前位置的最近同值格」，保证任何进位都只向下滚动一格。（`eaf045f`）
- **修复**｜计时器数字错位半格——`.since__num` 的 `align-items` 从 `center` 改为 `flex-start`。（`eaf045f`）
- **优化**｜计时器滚动卡顿——位移改由 CSS 变量 `--n` 驱动 `translateY`（合成层，零 forced reflow），移除每帧 `createElement` / 双 `rAF` / 强制回流，滚动过程中 DOM 节点数恒定。（`eaf045f`）
- **新增**｜Git 自动推送脚本 `_tools/autopush.{sh,ps1,bat}`：支持命令行参数与环境变量自定义提交信息 / 远程 / 分支，推送前检查工作区状态，常见失败场景分类报错并返回对应非零退出码，支持 `--dry-run` 预演。（`eaf045f` `86e9c1f`）
- **新增**｜`.gitattributes` 统一行尾（`*.sh` LF / `*.ps1` `*.bat` CRLF），图片与字体标记 binary，消除跨平台行尾告警。（`eaf045f`）

### v1.1.0 · 2026-09-25

- **修复**｜作品替换为带水印版本，修正若干内容问题。（`35babd4`）
- **优化**｜新增 `.vercelignore`，构建脚本与调试页不参与线上部署。（`41ee880`）
- **优化**｜完善 `.gitignore`，排除 `_deploy` 副本、`*.genie` 运行时文件与临时调试产物。（`5728a7a`）

### v1.0.0 · 2026-09-25

- **新增**｜微光摄影社官网首版上线：首页 / 作品集 / 关于我们 / 加入微光四页，60 张社员原创实拍作品，明亮胶片感设计系统。（`26c7c8f`）

---

### 📌 后续记录填写模板

```markdown
### v1.3.0 · 2026-10-2X

- **新增**｜<功能名>：<一句话说明做了什么、在哪一页/哪个文件生效>
- **优化**｜<模块名>：<优化点，最好带上前后对比数据（如 21MB → 14MB、357KB/张 → 240KB/张）>
- **修复**｜<问题描述>：<根因说明 + 修复方式>
```

填写建议：

- 一条记录只说一件事，动词开头，不写「修改了」「调整了」这种无信息量的词
- **优化**类尽量带可量化结果（体积、请求数、耗时）
- **修复**类务必写清根因，方便日后不再踩
- 末尾可附 `(commit短哈希)`，便于回溯
- 版本号规则：**新增功能**动次版本号（`v1.2.0 → v1.3.0`），**仅修复 / 优化**动修订号（`v1.2.0 → v1.2.1`），**架构级变更**动主版本号
- 打 tag：`git tag -a v1.3.0 -m "v1.3.0 人像专题第二期" && git push origin v1.3.0`

---

## 声明

- 微光摄影社所有平台（抖音、官网、作品展示渠道）均为**学生自主运营**，拥有学校社团背书，**不属于学校官方平台**。所有内容、作品、活动、文案均由学生团队独立策划、拍摄、制作与负责。
- 站内全部作品为**社员原创实拍**，禁止搬运、二改与商用。

---

<sub>Designed & built by 柳铁一中微光摄影社 · 学生团队自主运营</sub>
