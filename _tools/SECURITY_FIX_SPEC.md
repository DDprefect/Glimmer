# 微光摄影社官网 · 安全整改实施规格（AI 执行文档）

> **实施状态（2026-10-31）**：F1（代码侧）/ F2 / F3 / F4 / F5 已全部按本文档落地并随 v2.0.12（commit b6aa1c5）推送上线；F6 按门控保持下线未动。**F1 的 COS 桶策略（Deny 匿名读 `_backup/*`）仍需控制台人工操作**；F5 的集中存储 env（UPSTASH_REDIS_REST_URL+TOKEN 或 RATE_LIMIT_KV_REST_API+TOKEN）未配则自动回退内存。F4 实际实现与本文档略有差异：`safeUrl` 采用「危险 scheme 黑名单 + 放行站内相对路径」而非 `^https?://` 白名单——因为静态作品的 thumb 是 `assets/img/...` 相对路径，按白名单会全部被误杀。CSP 当前为 Report-Only，观察无违规后把 http.js 与 vercel.json 里的后缀去掉转强制。测试最终 137（api）+ 95（page）全绿。

> 本文档供实施 AI 直接照做。**范围：P0 / P1 / P2 全部整改。已明确排除 P3（低风险/卫生项：missingEnv 回显变量名、X-Glimmer-Rev 暴露 commit、蜜罐纯前端、后台无审计/2FA）。**
> 严禁改动业务行为之外的东西；每项改动都要过既有测试（`_tools/api_test.js` 122 断言 / `_tools/page_test.js` 90 断言）并新增对应断言。
> 当前线上：`https://lityzglimmer.top`，Vercel Serverless（`api/*.js` CommonJS 零依赖）+ 腾讯云 COS（广州，**公有读私有写**）+ Supabase Postgres。源码零密钥，密钥全在 Vercel 环境变量。

---

## 0. 前置依赖与决策点（动手前先确认）

| 项 | 类型 | 说明 |
|---|---|---|
| F1 备份桶策略 | **需人工控制台操作** | 仅靠代码改签名 URL 不够，必须配合 COS 控制台把 `_backup/*` 设为**拒绝匿名读**。代码侧只负责「改用预签名 GET URL」+「推送不再带 PII 链接」。 |
| F5 集中式限流 | **需基础设施** | 单实例内存限流要真正跨实例生效，必须引入集中存储（Vercel KV REST 或 Upstash Redis）。需用户先开通并在 Vercel 配 `RATE_LIMIT_KV_REST_API`/`UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN`。代码侧做成「有 env 走集中、无 env 回退内存」，不影响现有行为。 |
| F6 来源检查恢复 | **需运营验证** | 不能盲目取消注释。先确认全实例 `X-Glimmer-Rev` 一致且 24h 无复现，再恢复。见 F6 门控。 |

---

## F1 · P0 · 备份 CSV（含报名 PII）存于公有读桶 + 推送第三方

### 风险定位
- `api/_lib/backup.js`：`putText()` 用 `cos.sign("put", key, 600)` 写入后，返回 `cos.publicUrl(key)` —— 公有读地址。
- `runBackup()` 把 `submissions`（姓名/年级班级/联系方式/想说的话）+ `photos` 导出 CSV，写到 `_backup/<YYYY-MM>/`，文件名带月份、可枚举。
- `api/backup.js`、`api/admin.js` 的 `backup` action 把这两个公有 URL 返回；`api/_lib/notify.js` 的 `backupDone()` 把它们推到第三方 `NOTIFY_URL`。
- 后果：任何人拼出 `https://ltyzglimmer-photos-1495891073.cos.ap-guangzhou.myqcloud.com/_backup/2026-11/submissions-2026-11.csv` 即下载全部报名隐私。

### 目标行为
1. `_backup/` 对象对匿名**不可读**（COS 控制台桶策略，人工）。
2. 代码侧：备份结果只返回**限时预签名 GET URL**（默认 7 天），管理员凭此下载；普通公众拿不到。
3. `backupDone` 推送**只含条数+月份**，绝不带 PII 链接。

### 具体改动

**(a) COS 控制台（人工，必做）**
在桶 `ltyzglimmer-photos-1495891073` 的「权限管理 → 桶策略」追加一条**拒绝匿名读 `_backup/*`**（保留原有对图片前缀的公有读 Allow）：
```json
{
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "cos:GetObject",
      "Resource": "qcs::cos:ap-guangzhou:uid/1495891073:ltyzglimmer-photos-1495891073/_backup/*"
    }
  ]
}
```
> 注意 Resource 里的 APPID（1495891073）与桶名后缀一致。若原桶策略是把整个桶 Allow 公有读，需把 Allow 缩到图片前缀（`/campus/*`、`/field/*`、`/city/*`、`/portrait/*` 等），再叠加上面这条 Deny。

**(b) `api/_lib/cos.js`：新增预签名 GET URL 助手**
在 `publicUrl` 之后加：
```js
/* 限时预签名 GET（私有读场景用，如备份下载）；不改动既有的 publicUrl（画廊图片仍走公有读） */
function signedGetUrl(key, seconds) {
  return sign("get", key, seconds || 7 * 24 * 3600).url;
}
```
并加入 `module.exports`。

**(c) `api/_lib/backup.js`：`putText` 返回预签名 URL**
```js
async function putText(key, text) {
  var signed = cos.sign("put", key, 600);
  var put = await fetch(signed.url, {
    method: "PUT",
    body: Buffer.from(text, "utf8"),
    headers: { "Content-Type": "text/csv; charset=utf-8" }
  });
  if (!put.ok) throw new Error("备份写入存储失败（HTTP " + put.status + "）");
  return cos.signedGetUrl(key, 7 * 24 * 3600); // 改：预签名 GET，而非 publicUrl
}
```

**(d) `api/_lib/notify.js`：`backupDone` 去掉 PII URL**
```js
function backupDone(result) {
  try {
    var r = result || {};
    var lines3 = [
      "备份时间：" + new Date().toISOString(),
      "作品记录：" + (r.photos != null ? r.photos : "—") + " 条",
      "报名记录：" + (r.subs != null ? r.subs : "—") + " 条",
      "",
      "备份文件已存 COS 私有前缀 _backup/，需管理员凭预签名链接下载"
    ].filter(Boolean).join("\n");
    return notify("月度备份完成 · " + (r.stamp || ""), lines3);
  } catch (e) { return Promise.resolve(false); }
}
```
（删掉原来 `r.photosUrl ? "作品备份：" + r.photosUrl : ""` 两行。）

**(e) `api/backup.js` / `api/admin.js` 的 `backup` action**
`result` 里仍含 `photosUrl`/`subsUrl`，现在是**预签名 URL**（7 天有效），仅返回给已鉴权的 admin，可接受。无需改这两处返回值结构。

### 验证
- 单元：备份落盘后 `photosUrl` 形如 `https://...myqcloud.com/_backup/...csv?q-sign-algorithm=sha1&...`（带 `q-signature`），不再是裸 `publicUrl`。
- 用 curl 直接 GET 裸地址（不带签名）应 **403**（验证桶策略生效）；带签名 URL 应 **200**。
- `backupDone` 推送内容不含任何 `http` 链接。

---

## F2 · P1 · `photo-status` 泄漏未发布作品的公有读 URL

### 风险定位
`api/photo-status.js`：查询 `photos?select=title,category,status,file_url,created_at&title=eq.<title>...` **无 `status` 过滤**，且 `items` 映射里 `file_url: r.file_url` 对**所有状态**都返回。
后果：任何人按标题命中 **pending（待审核）/ offline（已下架）** 作品，即可拿到其在公有读桶里的 `file_url` 直接查看未发布/已下架图。

### 目标行为
- 保留自查「进度」能力（返回 `status` / `statusText`：待审核 / 已发布 / 已下架）。
- **仅在 `status === "approved"` 时才返回 `file_url`**；其余状态 `file_url` 置空。

### 具体改动（`api/photo-status.js` 的 `items` 映射）
```js
var items = (rows || []).map(function (r) {
  var approved = r.status === "approved";
  return {
    title: r.title,
    category: r.category,
    status: r.status,
    statusText: STATUS_TEXT[r.status] || r.status,
    file_url: approved ? r.file_url : "",   // 改：仅已发布才给可访问地址
    created_at: r.created_at
  };
});
```

### 验证
- 断言：构造一条 pending 作品的 title 查询 → 返回 `file_url === ""`，`status === "pending"`。
- 断言：approved 作品查询 → `file_url` 非空且为 COS 地址。
- 注：更深一层（未发布图仍在公有读桶、靠不可猜路径兜底）属架构级，本次不强行改桶；若后续要做，参见 F1(a) 思路把未发布图挪到私有前缀、审核通过时再搬公有前缀。本项只堵「按标题反查」这条泄漏路径。

---

## F3 · P1 · 缺安全响应头（CSP / nosniff / 防 iframe / Referrer）

### 风险定位
- `vercel.json` 无 `headers` 段。
- `api/_lib/http.js` 的 `applyCors` 只设 CORS 头，无 `Content-Security-Policy` / `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy`。

### 目标行为
静态资源（HTML/CSS/JS/图）与 API 响应**都**带上这批头；CSP 先以 **Report-Only** 跑几天观察无违规再转强制，避免误伤站点。

### 具体改动

**(a) `api/_lib/http.js`：新增并统一施加安全头**
在 `applyCors` 之前加：
```js
var CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
  "font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "img-src 'self' https://*.myqcloud.com data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "manifest-src 'self'"
].join("; ");

function securityHeaders(res) {
  res.setHeader("Content-Security-Policy-Report-Only", CSP); // 先 Report-Only，观察后改强制
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
}
```
在 `applyCors(req, res)` 开头调用 `securityHeaders(res);`（这样 `json` / `preflight` / `sendCsv`(经 applyCors) 全部覆盖）。

**(b) `vercel.json`：补 `headers` 段（静态响应）**
```json
{
  "crons": [ ... 保持不变 ... ],
  "regions": ["hkg1"],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' https://*.myqcloud.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; manifest-src 'self'" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=()" }
      ]
    }
  ]
}
```

### ⚠️ 实施前必查（CSP 可能误伤）
- 全站 grep 是否还有**内联 `<script>` 块**或 HTML/JS 里拼接的 `onclick=`/`onload=`/`onerror=` 等内联事件。**当前已知 site.js / gallery.js / upload.js 均用 `addEventListener`、靠 `createElement`+`innerHTML` 拼结构且无内联 handler**，应满足 `script-src 'self'`。若发现内联脚本：要么抽到外部 `.js`（推荐），要么改用 nonce（复杂度高，不推荐本次）。
- Google Fonts 走 `fonts.googleapis.com`（CSS）+ `fonts.gstatic.com`（字体文件），已在 `style-src`/`font-src` 放行。
- 上线先用 `Report-Only`：在浏览器 console / Vercel 日志观察几天有无违规上报；确认无碍再把 `Content-Security-Policy-Report-Only` 改为 `Content-Security-Policy`（强制）。

### 验证
- 断言（`api_test.js` 新增）：对任意 API 端点发请求，响应头含 `x-content-type-options: nosniff`、`x-frame-options: DENY`、`referrer-policy`、`content-security-policy-report-only`。
- 断言（`page_test.js` 新增 / 或读 `vercel.json`）：`vercel.json` 存在 `headers[0].headers` 含上述四项。
- 手动：浏览器开 DevTools，确认页面无 CSP 违规（console 无红色阻挡）。

---

## F4 · P2 · `workCard` 中 `thumb`/`src` 直接拼进 `src=""` 未转义

### 风险定位
`assets/js/site.js` 的 `workCard(item, i, delay)`：
```js
'<img src="' + item.thumb + '" alt="' + esc(item.title + " · " + item.group) + '" ' +
```
`item.thumb` 来自 `gallery.js` 的 `dbToWork`：`thumb: G.thumbUrl(p.file_url, 880)`（DB 的 `file_url` 是服务端拼的 COS 地址，当前可信）或静态 `works.js`。当前来源可信故实际安全，但这是全站唯一不转义用户/外部内容的点，与别处统一用 `esc()` 不一致，属潜在 XSS。

### 目标行为
- 对 `thumb`/`src` 先做 `^https?://` 校验，再 `esc()`；非法值回落空串，绝不直接进属性。

### 具体改动（`assets/js/site.js`）

在 `esc` 附近加：
```js
function safeUrl(u) {
  var s = String(u == null ? "" : u);
  if (!/^https?:\/\//.test(s)) return "";
  return esc(s);
}
```
`workCard` 内改两处：
```js
'<img src="' + safeUrl(item.thumb) + '" alt="' + esc(item.title + " · " + item.group) + '" ' +
```
并在 `dbToWork`（`assets/js/gallery.js`）对 `src`/`thumb` 也过一道：
```js
src: p.file_url,                                   // 原
thumb: G.thumbUrl ? G.thumbUrl(p.file_url, 880) : p.file_url,
// 改：渲染时由 workCard 统一 safeUrl 处理即可，此处无需改；但若 workCard 未覆盖到此，可在此兜底
```
> 说明：`photo-status` 结果渲染里 `href="' + G.esc(it.file_url) + '"'` 已转义，保持不变；`doneImg.src = j.fileUrl` 是属性赋值（非 innerHTML），安全，不变。

### 验证
- 断言（`page_test.js` 新增，jsdom）：构造 `item = { thumb: '" onerror=alert(1) x="', title: "t", group: "g", ... }`，调 `workCard` 后断言生成的 HTML 中不含裸 `onerror=`，`"` 已被转义为 `&quot;`。
- 断言：`safeUrl("javascript:alert(1)") === ""`、`safeUrl("https://x") ` 经 esc 仍含 `https://x`。

---

## F5 · P2 · 限流为单实例内存，换实例即可绕过

### 风险定位
`api/_lib/ratelimit.js` 用进程内 `Map` 计数。Vercel 多实例各一份，脚本换 IP/换实例可绕过单 IP 与全局熔断（已知局限）。

### 目标行为
优先用集中存储（Vercel KV REST 或 Upstash Redis）做跨实例计数；**未配置时回退到现有内存实现**，保证零配置也能跑、且现有测试不破。

### 具体改动（`api/_lib/ratelimit.js`）
保持对外接口 `guard / allow / reset / clientIp` 不变，内部 `allow()` 改为：
1. 若 `process.env.RATE_LIMIT_KV_REST_API`（Vercel KV REST，形如 `https://<region>.kv.vercel-storage.com` 且需 `Authorization: Bearer <token>`）或 `UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN` 存在 → 走集中计数（固定窗口：key=`ratelimit:<key>`，存 `{first:ts, count:n}`，GET→判定→PUT 回写；注意加锁/原子用 KV 的 conditional write 或 Upstash 的 `INCR`+`EXPIRE`）。
2. 否则走现有内存 `Map`。

示例骨架（Upstash 分支，仅示意，需 AI 按所选方案落地）：
```js
var UP_URL = process.env.UPSTASH_REDIS_REST_URL;
var UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
var KV_URL = process.env.RATE_LIMIT_KV_REST_API;
var KV_TOKEN = process.env.RATE_LIMIT_KV_REST_TOKEN;

async function allowCentral(key, max, windowMs) {
  if (UP_URL && UP_TOKEN) {
    var now = Date.now();
    var r = await fetch(UP_URL + "/", {
      method: "POST",
      headers: { Authorization: "Bearer " + UP_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", key], ["PEXPIRE", key, String(windowMs)]])
    }).then(function (x) { return x.json(); }).catch(function () { return null; });
    var n = Array.isArray(r) ? Number(r[0]) : NaN;
    return !isNaN(n) && n <= max;
  }
  if (KV_URL && KV_TOKEN) { /* 同构 KV conditional-write 实现 */ }
  return allowLocal(key, max, windowMs); // 回退
}
```
> 注意：`guard` 当前是同步返回；改异步后，所有调用方（`upload.js` / `register.js` / `admin.js` / `backup.js` / `register-status.js` / `notify.js` 的 `rl.guard(...)`）都已处于 `async` 函数内且用了 `if (!rl.guard(...)) return ...` —— 需要改成 `if (!(await rl.guard(...))) return ...`。AI 务必全局替换这 5~6 处调用点为 `await`。`rl.allow` 在 admin 锁里用 `rl.allow(failKey, 5, ...)` 也是同步，同样要 `await`（若走集中分支）。

### 验证
- 单测：设 `UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN` 指向测试实例，连续 `await rl.guard(req,"t",3,60000)` 第 4 次应 false；`reset` 后恢复。
- 回退：不清 env，行为与原内存实现一致（现有 122 断言全绿）。
- 全局替换后跑全量 `api_test.js` + `page_test.js` 确认无回归。

---

## F6 · P2 · 来源检查（v2.0.10 临时下线）恢复 —— **门控恢复**

### 风险定位
`api/upload.js`、`api/register.js` 在 v2.0.10 把 `if (http.originSuspicious(req)) return http.rejectOrigin(req, res);` 注释掉。`originSuspicious`/`rejectOrigin`/`originAllowedValue` 仍保留在 `http.js`，`allowOrigin`（CORS 反射白名单）仍用 `originAllowedValue`。

### 目标行为
**不盲目恢复**。先满足门控，再取消注释两行。恢复后等于重新加回「同源软检查」（也顺带补一层 CSRF/跨站 POST 兜底；虽本就是软检查——curl 不带 Origin 拦不住，但补上无妨）。

### 门控条件（全部满足才动）
1. 用户用 `X-Glimmer-Rev` 响应头确认**全 Vercel 实例跑同一 commit** 持续 ≥ 24h（之前线上/本地不一致是误拦根因）。
2. 这 24h 内无新发「来源不受支持」误报。
3. 先在**预发/本地**用 `api_test.js` 的恢复用例跑绿（干净的 `https://www.lityzglimmer.top`、`https://lityzglimmer.top` 必须放行；外部 `https://evil.com` 必须 403）。

### 具体改动（门控通过后）
- `api/upload.js` 第 ~62-64 行、取消注释：
  ```js
  if (http.originSuspicious(req)) {
    return http.rejectOrigin(req, res);
  }
  ```
- `api/register.js` 第 ~29-31 行同法取消注释。
- `http.js` 的 `originSuspicious` 注释里「v2.0.10 起已临时不再调用」更新为「v2.0.x 恢复调用」。

### 验证
- `api_test.js` 恢复 v2.0.10 删掉的「恶意 Origin 端到端 403」用例（注意它曾打乱 id 分配断言，恢复时要让该用例单独隔离或用独立 id 空间，避免影响其它断言）。
- 干净 www 域 + apex 域放行断言恢复。

---

## 1. 测试补充清单（落到 `_tools/api_test.js` / `_tools/page_test.js`）

**api_test.js 新增断言：**
1. F1：`runBackup` 产出的 URL 含 `q-signature`（预签名），且不含裸 `publicUrl` 形态；`backupDone` 推送体（用 `notifyBroken`/mock NOTIFY_URL 捕获）不含 `http`。
2. F2：`photo-status` 对 pending 作品返回 `file_url === ""`；approved 返回非空。
3. F3：任意 API 响应头含 `x-content-type-options`、`x-frame-options`、`referrer-policy`、`content-security-policy-report-only`。
4. F5（若配 env）：跨调用计数生效；未配 env 回退内存。
5. F6（门控通过后）：干净 www/apex 放行、外部 403。

**page_test.js 新增断言：**
6. F3：`vercel.json` 的 `headers` 含四项安全头。
7. F4：`workCard` 注入 `thumb='" onerror=alert(1)'` → 输出无 `onerror=` 裸属性，`"` 转义。
8. F4：jsdom 渲染后图片 `src` 为 `https://` 或空，无 `javascript:`。

---

## 2. 上线与回滚

- 分批合入：建议顺序 F4（纯前端转义，最安全）→ F2（单接口逻辑）→ F3（先 Report-Only）→ F1（需先做完控制台桶策略再上代码）→ F5（需先配 env）→ F6（最后、门控）。
- 每步单独 commit + tag，便于回滚。
- F3 的 CSP 在 Report-Only 观察 ≥3 天无违规再切强制；若误伤，回退为 Report-Only 即可，不影响功能。
- F1 控制台桶策略与代码需同批次；若只上代码未配桶策略，备份仍是公有读（风险未消），故**桶策略是 F1 的前置硬依赖**。
- F5 若 env 未配，自动回退内存，零风险；配了 env 后务必先小流量验证计数正确。

---

## 3. 实施前 AI 自查清单
- [ ] 已读 `api/_lib/{http,supabase,cos,notify,csv,exif,ratelimit,backup}.js`、`api/{photos,upload,register,admin,photo-status,register-status,backup,keepalive}.js`、`assets/js/{site,gallery,upload}.js`、`vercel.json`、`_tools/api_test.js`、`_tools/page_test.js`。
- [ ] 全站 grep 确认无内联 `<script>` / `on*=` 事件（F3 CSP 前提）。
- [ ] 确认 F1 桶策略由人工完成后再改代码；F5 env 由用户配好再验证。
- [ ] 所有 `rl.guard` / `rl.allow` 调用点已加 `await`（F5 异步化）。
- [ ] 改动后 `node _tools/api_test.js` 与 `NODE_PATH=... node _tools/page_test.js` 全绿，且新增断言通过。
- [ ] 不动 P3 任何项。
