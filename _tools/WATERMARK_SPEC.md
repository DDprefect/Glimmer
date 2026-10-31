# 微光摄影社 · 投稿水印功能规格（v2.1.0 实施文档）

> **状态**：v2.1.0 已随代码上线（审核通过自动打水印）。盲水印与 logo 水印均启用。
> 本文档同时是运维手册：如何提取盲水印、如何换水印样式、开关与故障兜底。

## 设计（双版本架构）

```
投稿原图(公开 key, pending) ──审核通过──▶ ① 复制原图 → _original/<原key>（私有）
                                        ② 以 _original/ 为源做 CI 持久化处理
                                          （logo水印 | 盲水印）→ 覆盖公开 key
```

- **URL 永远不变**：前台（gallery/灯箱/缩图）零改动；任何人下载公开地址拿到的都是带水印版。
- **原图绝不覆盖**：`_original/` 里是字节级原图（含 EXIF），是版权证据；桶策略拒匿名读（需控制台配置，见下）。
- **重试安全**：`_original/` 已存在则跳过复制——反复点「打水印」绝不会拿水印图覆盖真原图。
- **待审核不打水印**（先审后发）；下架/恢复不处理；删除作品时 `_original/` 一并清理。

## 水印内容

1. **可见水印**：站点 logo（相机+微光+柳铁一中，白色 + 2px 暗描边，350×177 PNG，内嵌于
   `api/_lib/watermark.js` 的 `WM_IMAGE_B64`，首次使用自动上传到 `wm/glimmer-mark.png`），
   CI 图片水印规则 `watermark/1/image/<url-b64url>/gravity/southeast`——右下角、无边距、原尺寸。
2. **盲水印**：纯盲文字 `watermark/3/type/3/text/<b64url>`，默认文案
   `GLIMMER 柳铁一中微光摄影社`（`WATERMARK_BLIND_TEXT` 可覆盖）。
3. 处理入口：`POST /<ObjectKey>?image_process` + `Pic-Operations` 头（该头必须签入签名）；
   规则串用管道符 `|` 串联两个操作；`fileid` 与源 key 不同 = 覆盖公开位、保留 `_original/` 源。

## 关键实现位置

| 文件 | 内容 |
| --- | --- |
| `api/_lib/cos.js` | `sign()` 支持附加头签入（q-header-list 动态）；`objectExists`/`copyObject`/`putBuffer`/`imageProcess`。⚠️ 附加头必须既签入又随 fetch 携带（漏一头 COS 就 403 或静默错处理） |
| `api/_lib/watermark.js` | `applyWatermark(publicKey)` 编排（ensureLogo → 保原图 → imageProcess）；`buildRule()`；`originalKeyOf()` |
| `api/admin.js` | approve 自动触发（失败不阻塞审核，返回 `watermarked:false`+`wmError`）；action `watermark`（手动重试）；`deleteCosFiles` 清理 `_original/` |
| `assets/js/admin.js` | 已发布卡片「打水印」按钮；审核后失败提示 |
| `assets/img/brand/watermark.png` | 水印 logo 成品图（换 logo：用 PIL 缩到 350px 宽 + 描边 → 重生成 base64 注入 watermark.js） |

## 环境变量开关（全部可选）

| 变量 | 作用 |
| --- | --- |
| `CI_IMAGE_WATERMARK=0` | logo 水印异常时退回纯文字水印（simhei 白字 72% 右下） |
| `CI_BLIND_WATERMARK=0` | 未开通盲水印功能时去掉盲水印段 |
| `WATERMARK_TEXT` / `WATERMARK_BLIND_TEXT` | 覆盖默认文案 |

## ⚠️ 用户控制台待办

1. **桶策略追加 Deny 匿名读 `_original/*`**（与 `_backup/*` 同样的向导流程：添加策略 →
   所有用户（**可匿名访问**）→ 指定资源路径 `_original/*` → 效力**拒绝** → 操作 GetObject）。
   ⚠️ 千万不要用「含腾讯云账号的所有人」/Principal `"*"`——那会把服务端自己签名的请求也拒掉，
   打水印、备份、删除全部瘫痪。
2. **数据万象控制台开通「盲水印」**（付费功能，独立于基础图片处理）。未开通时 approve 会
   推送 CI 报错通知，公开图仍是 logo 水印（盲水印段失败会导致整次处理失败）；开通前可先设
   `CI_BLIND_WATERMARK=0`。

## 盲水印提取（验证权属用）

- CI 控制台 → 图片处理 → 盲水印 → 提取，上传可疑图，输入与打水印时**完全一致**的
  type（3）与文字（`GLIMMER 柳铁一中微光摄影社`）。
- API 等价：对可疑图执行 `POST /<key>?image_process`，rule=`watermark/4/type/3/text/<同参数b64url>`。

## 已知局限（诚实记录）

- logo 以**原始像素**叠加（CI 图片水印不支持按原图比例缩放）：竖图上相对偏大、横图上相对偏小，
  350px 宽是按 1600 长边 ~22% 折中的。
- 白色 logo 依赖 2px 暗描边保证浅色背景可见度；极端高调（纯白天空）背景下仍可能不明显。
- 盲水印抗裁剪/压缩有限（纯盲最弱），必要时可换半盲（type/1，需同时改提取参数）。
- 处理链失败（如盲水印未开通）→ 公开图保持未处理版，错误推送提醒 → 修复后用「打水印」重试。
- 存量已发布作品（v2.1.0 前审核的）没有水印：在后台对其点「打水印」补上即可。
