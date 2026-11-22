# 初稿安卓 APP v1 规格

## 0. 总体
- 形态：原生 Kotlin 外壳（`android/`，包名 `art.chugao.app`，应用名"初稿"），WebView 加载 `https://chugao.art`。不使用 Capacitor。
- 业务页面全部沿用线上；APP 专属差异通过 User-Agent 标识 + 原生桥实现。
- 分发：官网 `/download` 页面 + 二维码，APP 内自更新（不走应用商店）。
- 开放注册；画布（/app/canvas）、节点（/app/nodes）、PPT（/app/ppt）在 APP 内隐藏。
- 手机端新对话默认"保存在本机"，可切换/同步到云端。

## 1. APP 识别
- WebView UA = 系统默认 UA + ` ChugaoApp/<versionName> (Android; <versionCode>)`，例：`... ChugaoApp/1.0.0 (Android; 1)`。
- 服务端/前端识别正则：`/\bChugaoApp\/(\d+\.\d+\.\d+)\b/`。
- **UA 只用于 UI 分支，绝不用于鉴权或放宽任何安全检查。**
- 前端"是否在原生壳中"以 `window.ChugaoNative` 存在为准（只有 chugao.art 顶层页面会被注入）。

## 2. 原生桥协议（androidx.webkit addWebMessageListener）
- JS 对象名：`window.ChugaoNative`，仅对 origin `https://chugao.art` 的**主框架**注入；原生侧每条消息再次校验 `sourceOrigin == https://chugao.art && isMainFrame`，否则丢弃。
- 不使用 `addJavascriptInterface`。
- 请求（JS → 原生）：`ChugaoNative.postMessage(JSON.stringify({ id, method, params }))`
  - `id`：字符串，`^[A-Za-z0-9_-]{1,64}$`
  - 单条消息上限 8 MB，超限直接回错误。
- 响应（原生 → JS）：通过 `replyProxy.postMessage(JSON.stringify({ id, ok: true, result }))` 或 `{ id, ok: false, error: { code, message } }`；JS 侧 `ChugaoNative.onmessage = (e) => ...`（e.data 为字符串）。
- 原生主动事件（无 id）：`{ event: "app.resume" }`（Activity onResume 时发送）、`{ event: "app.pause" }`。
- 错误码：`BAD_REQUEST` `NOT_FOUND` `FORBIDDEN` `TOO_LARGE` `UNSUPPORTED` `INTERNAL`。

### 方法
| method | params | result | 说明 |
|---|---|---|---|
| `app.info` | – | `{ platform:"android", versionName, versionCode, osVersion }` | |
| `app.checkUpdate` | `{ manual?: boolean }` | `{ status: "latest" \| "available" \| "error", versionName? }` | 有新版时原生弹窗处理下载安装 |
| `browser.openExternal` | `{ url }` | `{ opened: true }` | 仅 https；用 Custom Tabs 打开 |
| `image.saveToGallery` | `{ url, filename? }` | `{ saved: true }` | url 必须是 `https://chugao.art/` 同源或 `/__local/files/<key>`；原生带 Cookie 下载后写入 `Pictures/初稿` |
| `localStore.put` | `{ key, value }` | `{ bytes }` | value 为字符串（通常 JSON），单项 ≤ 5 MB |
| `localStore.get` | `{ key }` | `{ value: string \| null }` | |
| `localStore.list` | `{ prefix? }` | `{ items: [{ key, bytes, updatedAt }] }` | updatedAt 为毫秒时间戳 |
| `localStore.delete` | `{ key }` | `{ deleted: boolean }` | |
| `localStore.saveFile` | `{ url, key }` | `{ key, bytes, mime, localUrl }` | 原生下载同源 url（带 Cookie，≤ 30 MB，mime 必须 image/*）到本地；`localUrl = "/__local/files/<key>"` |
| `localStore.deleteFile` | `{ key }` | `{ deleted: boolean }` | |
| `localStore.usage` | – | `{ bytes, limitBytes }` | 总上限 1 GB |

- key 规则：`^[A-Za-z0-9._-]{1,120}$`，且不能以 `.` 开头。数据存于 `filesDir/local-store/`（文本）与 `filesDir/local-files/`（文件），app 私有目录，`allowBackup=false`。
- 本地文件访问：WebView 请求 `https://chugao.art/__local/files/<key>`（GET）时由原生 `shouldInterceptRequest` 直接从本地返回，不发往服务器；key 不合法或不存在返回 404。

## 3. 安全要求（原生壳）
- 只有 host = `chugao.art` 的 https 页面在 WebView 内加载；其他 https 链接用 Custom Tabs 打开；`http:`/`file:`/`content:`/`javascript:`/`data:` 一律拦截。
- 外部 scheme 仅白名单：`weixin` `alipays` `alipay` `mqqapi` `upwrp`（支付相关），以及 `intent:` 解析后清除 component/selector、加 BROWSABLE 再启动；失败静默提示。
- `onReceivedSslError` 一律 cancel；network_security_config 禁止明文、只信任系统 CA（不信任用户安装证书）。
- WebView：`allowFileAccess=false`、`allowContentAccess=false`、`mixedContentMode=NEVER_ALLOW`、SafeBrowsing 开、release 关闭 WebView 调试、`saveFormData` 关。
- `window.open`：支持多窗口，`onCreateWindow` 仅接受用户手势；用临时 WebView 捕获第一个目标 URL 后按上面规则打开（同源 → 主 WebView 加载，其它 https → Custom Tabs），随即销毁临时 WebView。（充值页的弹窗支付依赖这一点。）
- 仅 MainActivity exported（launcher）；FileProvider 不导出。`allowBackup=false`。
- 自更新：`GET https://chugao.art/api/app/version` → `{ ok, data: { latestVersionCode, latestVersionName, minSupportedVersionCode, apkUrl, sha256, notes, publishedAt } }`；apkUrl 必须 https 且 host 为 chugao.art；下载后校验 SHA-256 与签名证书（与当前已安装 APP 一致）后才调起安装；低于 minSupported 时强制更新（不可关闭）。
- 首次启动隐私弹窗：同意前不加载任何网页、不发网络请求；"不同意"退出；协议链接 `https://chugao.art/legal/terms`、`/legal/privacy` 用 Custom Tabs 打开。

## 4. 服务端/网页（APP 模式）
- 中间件：APP UA 访问 `/` → 307 到 `/app`（未登录由 /app layout 跳 /login）。
- `/login` `/register`：APP 模式使用移动端全屏样式（无营销侧栏）；注册需勾选《用户协议》《隐私政策》以及"同意境外模型处理"。
- `/legal/terms`、`/legal/privacy`：公开页面。
- 账号注销：`POST /api/me/delete-account`，设置页入口。
- `GET /api/app/version`：读取环境变量 `APP_ANDROID_*`。
- `/download`：下载页（APK + 二维码 + 安装说明 + 微信内打开提示）。
- APP 内隐藏画布、节点、PPT 入口，直接访问显示"请在电脑端使用"。

## 5. 本机对话（storage = LOCAL）
- `Conversation.storage`：`CLOUD`（默认，网页端）/ `LOCAL`（APP 新对话默认）；LOCAL 绑定 `localDeviceId`（会话里的设备 ID）。
- LOCAL 对话：只在绑定设备上可见、可访问（列表、详情、消息、发起对话轮次），其他设备/网页端 404；服务器只保留"工作副本"，闲置 7 天后清除消息内容；完整记录（消息 + 图片）保存在手机本地。
- 同步到云端：`PATCH /api/conversations/:id { storage: "cloud" }`，转为普通云端对话（多端可见，按 30 天规则保留）；也可改回本机。
- APP 新建对话时在输入区显示"保存在：本机 / 云端"切换，默认本机；首次显示一次提示。
- 本地快照：每轮完成后写入 `localStore`（`conv.<id>.json` + 索引 `conv-index.json`），图片经 `localStore.saveFile` 存本地并在快照里改写为 `/__local/files/<key>`；云端副本已过期时从本地快照只读展示。
