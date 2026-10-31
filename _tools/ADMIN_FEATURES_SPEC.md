# 微光摄影社 · 后台管理增强规格（v2.2.0 实施文档）

> 状态：已随 v2.2.0 上线。拒绝理由 / 精选置顶 / 换图 / 通知缩略图 / 本月概览 / 灯箱下载原图。

## ⚠️ 用户侧一次性 SQL（功能生效前置）

Supabase SQL Editor 执行（可重复执行，幂等）：
```sql
alter table public.photos add column if not exists reject_reason text;
alter table public.photos add column if not exists featured boolean default false;
```
未执行前：其余功能不受影响；「拒绝」仍会下架但**理由不保存**（后台会提示）；
「精选」会直接报错并**给出上面这条 SQL**（照抄执行即可）。

## 功能与实现位置

| 功能 | 端点/位置 | 行为与降级 |
| --- | --- | --- |
| 拒绝理由 | admin action `unpublish` 增加可选 `reason`（≤100 字）→ `photos.reject_reason` | 旧库缺列：下架照常、理由不存，响应 `reasonSaved:false` 前端提示；photo-status 改 `select=*` 天然兼容 |
| 精选置顶 | admin action `featured` {id,featured} → `photos.featured`；`supabase.js approved()` 排序 `featured.desc,created_at.desc` | 旧库缺列：列表回退纯时间排序（无感）；PATCH 缺列报 500 并附建列 SQL |
| 换图 | **新端点 `POST /api/replace?id=&shot_date=`**，密码走 `x-admin-pw` 头，body 为压缩后 JPEG | 验密与 /api/admin 同款（timingSafeEqual+锁定）；覆盖公开 key；`_original/` 存在则**同步覆盖**（换图后原图=新图，重打水印才不会拿旧图当源）；已发布作品自动重打水印（同步失败则跳过并提示手动「打水印」）；非 JPEG 400、缺 id 400、错密码 401、限流 10/10min |
| 通知缩略图 | `notify.photoSubmitted` desp 追加 markdown 图 `?imageMogr2/thumbnail/400x` | 依赖数据万象（已开通）；file_url 缺省时自动省略 |
| 本月概览 | admin.html `#admin-month`，admin.js render() 按**北京月份**统计（口径与备份一致） | 纯前端聚合 list，无新接口 |
| 灯箱下载原图 | site.js 灯箱 `.lb__dl` 按钮 | 新标签打开原图（=带水印版）；跨域 download 属性无效故用 open，右键/长按保存 |

## 语义约定

- 「拒绝」= pending → offline + reject_reason（复用下架通道）；下架作品可「恢复上架」或删除。
- 换图不更新数据库里的 EXIF 展示参数（如需可后续在 replace 支持 exif 查询参数，复用 exif.js 白名单清洗）。
- 精选只影响 DB 投稿的排序；静态 works.js 作品始终排在 DB 作品之后（历史收录优先展示逻辑不变）。

## 测试

- api_test 167：拒绝落库/降级、精选排序/降级/SQL 提示、replace 鉴权/魔数/404/水印/原图同步/日期、通知缩略图。
- page_test 104：后台新按钮（拒绝/精选/换图）、拒绝与精选交互、本月概览渲染、自查理由显示、灯箱下载按钮。
