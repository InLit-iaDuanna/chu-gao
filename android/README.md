# 初稿 Android 外壳

`art.chugao.app` —— 纯原生 Kotlin 的 WebView 外壳，加载 <https://chugao.art>。
没有 Capacitor / Cordova / Flutter，也没有任何第三方网络库（下载一律用 `HttpURLConnection`）。

## 环境

| 项 | 版本 |
| --- | --- |
| JDK | 17（编译 target 也是 17） |
| Android SDK | compileSdk / targetSdk 35，minSdk 26 |
| AGP | 8.7.3 |
| Kotlin | 2.0.21 |
| Gradle | 8.9 |

## 构建

`gradle/wrapper/gradle-wrapper.jar` 未提交到仓库，第一次构建前先生成它（需要本机有 Gradle 8.9 或更高版本）：

```powershell
cd android
gradle wrapper --gradle-version 8.9
```

之后：

```powershell
cd android

# Debug（不会用到签名）
.\gradlew.bat assembleDebug

# Release（需要先准备 keystore，见下一节）
.\gradlew.bat assembleRelease

# JVM 单元测试（UrlPolicy / LocalStore 的 key 规则）
.\gradlew.bat testDebugUnitTest
```

产物：

- `app/build/outputs/apk/debug/app-debug.apk`
- `app/build/outputs/apk/release/app-release.apk`

macOS / Linux 用 `./gradlew` 代替 `.\gradlew.bat`。

## 签名

```powershell
cd android
powershell -ExecutionPolicy Bypass -File .\scripts\create-keystore.ps1
```

脚本用 `keytool` 生成 `android/release.jks`（RSA 4096、有效期 10000 天、alias `chugao`），并写出 `android/keystore.properties`：

```properties
storeFile=release.jks
storePassword=******
keyAlias=chugao
keyPassword=******
```

- `storeFile` 相对 `android/` 目录解析。
- `android/app/build.gradle.kts` 只在 `keystore.properties` 存在且四个字段都非空时配置 release 签名；缺文件时 `assembleRelease` 会产出未签名包，不影响 debug 构建。
- `release.jks`、`keystore.properties`、`*.jks`、`*.keystore` 都在 `android/.gitignore` 里，不要提交。
- **务必备份 keystore**：证书一旦更换，已安装的用户无法覆盖升级。

发布包开启了 `minifyEnabled` + `shrinkResources`，`app/proguard-rules.pro` 保留了 `WebViewCompat$WebMessageListener` 的实现和 `NativeBridge`，改混淆规则前先确认原生桥仍然可用。

## 发布流程

1. 改 `android/app/build.gradle.kts` 里的 `versionCode`（必须递增）和 `versionName`。
2. 构建：`.\gradlew.bat clean assembleRelease`。
3. 计算 APK 的 SHA-256：

   ```powershell
   Get-FileHash -Algorithm SHA256 .\app\build\outputs\apk\release\app-release.apk
   ```

   或：

   ```bash
   sha256sum app/build/outputs/apk/release/app-release.apk
   ```

4. 把 APK 上传到站点同域的可下载地址，例如 `https://chugao.art/downloads/chugao-<versionCode>.apk`。
   `apkUrl` 必须是 **https 且 host 为 `chugao.art`**，否则客户端会把它当成错误并拒绝更新。
5. 在服务端配置环境变量（`/api/app/version` 读取它们）：

   | 变量 | 含义 |
   | --- | --- |
   | `APP_ANDROID_LATEST_VERSION_CODE` | 最新 versionCode，客户端用它和本地比较 |
   | `APP_ANDROID_LATEST_VERSION_NAME` | 最新 versionName，用于弹窗文案 |
   | `APP_ANDROID_MIN_VERSION_CODE` | 低于该版本强制更新（不可取消、拒绝即退出） |
   | `APP_ANDROID_APK_URL` | APK 的 https 同域直链 |
   | `APP_ANDROID_APK_SHA256` | APK 的 SHA-256（大小写不敏感） |
   | `APP_ANDROID_NOTES` | 更新说明，显示在更新弹窗里 |

6. 重启 / 重新部署服务，确认接口返回：

   ```json
   {
     "ok": true,
     "data": {
       "latestVersionCode": 2,
       "latestVersionName": "1.0.1",
       "minSupportedVersionCode": 1,
       "apkUrl": "https://chugao.art/downloads/chugao-2.apk",
       "sha256": "…64 位小写十六进制…",
       "notes": "修复若干问题",
       "publishedAt": "2026-11-21T00:00:00.000Z"
     }
   }
   ```

客户端行为：

- 首页加载完成后延迟 3 秒自动检查一次；网页也可以通过 `ChugaoNative` 主动调用 `app.checkUpdate`。
- `latestVersionCode > versionCode` 时弹窗，「稍后」会把该版本静默 24 小时。
- 下载到 `cacheDir/updates/chugao-<code>.apk`，校验 SHA-256、包名、versionCode、签名证书指纹（与已安装 App 一致）后才交给系统安装器；任何一步失败都会删除文件并提示「安装包校验失败」。
- 未授予「安装未知应用」权限时先跳系统设置，返回后自动继续。

## 目录

```
android/
├── app/src/main/java/art/chugao/app/
│   ├── MainActivity.kt            单 Activity：启动、WebView、隐私弹窗、文件选择、下载、弹窗导航
│   ├── web/
│   │   ├── UrlPolicy.kt           导航规则（纯逻辑）+ ExternalNavigator（Custom Tabs / 外部 App / intent:）
│   │   ├── AppWebViewClient.kt    导航、错误页、证书错误、本地文件拦截
│   │   ├── AppChromeClient.kt     进度、文件选择、window.open
│   │   └── WebShellHost.kt        WebView → Activity 的回调接口
│   ├── bridge/
│   │   ├── NativeBridge.kt        WebMessageListener 与 JSON 协议
│   │   ├── LocalStore.kt          local-store / local-files 存储
│   │   ├── LocalStoreKeys.kt      key 规则与路径校验（纯 JVM）
│   │   ├── GallerySaver.kt        image.saveToGallery
│   │   └── BridgeException.kt     错误码
│   ├── update/UpdateManager.kt    版本检查、下载、校验、安装
│   ├── privacy/PrivacyConsent.kt  隐私同意状态（带版本号）
│   └── util/
│       ├── SafeDownloader.kt      同源校验 + Cookie + 限额下载
│       └── FileNames.kt           文件名清洗
└── app/src/test/java/…            UrlPolicyTest / LocalStoreKeyTest
```

## 原生桥

注册名 `ChugaoNative`，只对 `https://chugao.art` 且主框架生效（`WebViewCompat.addWebMessageListener`）。
请求：`{"id":"…","method":"…","params":{…}}`，`id` 需匹配 `^[A-Za-z0-9_-]{1,64}$`。
响应：`{"id":"…","ok":true,"result":{…}}` 或 `{"id":"…","ok":false,"error":{"code":"…","message":"…"}}`。
错误码：`BAD_REQUEST` `NOT_FOUND` `FORBIDDEN` `TOO_LARGE` `UNSUPPORTED` `INTERNAL`。

| method | params | result |
| --- | --- | --- |
| `app.info` | — | `{ platform, versionName, versionCode, osVersion }` |
| `app.checkUpdate` | `{ manual?: boolean }` | `{ status: "latest" \| "available" \| "error", versionName? }` |
| `browser.openExternal` | `{ url }` | `{ opened: true }`（仅 https，Custom Tabs） |
| `image.saveToGallery` | `{ url, filename? }` | `{ saved: true }` |
| `localStore.put` | `{ key, value }` | `{ bytes }` |
| `localStore.get` | `{ key }` | `{ value: string \| null }` |
| `localStore.list` | `{ prefix? }` | `{ items: [{ key, bytes, updatedAt }] }` |
| `localStore.delete` | `{ key }` | `{ deleted }` |
| `localStore.saveFile` | `{ url, key }` | `{ key, bytes, mime, localUrl }` |
| `localStore.deleteFile` | `{ key }` | `{ deleted }` |
| `localStore.usage` | — | `{ bytes, limitBytes: 1073741824 }` |

事件（原生主动下发）：`{"event":"app.resume"}` / `{"event":"app.pause"}`。

约束：

- 消息体上限 8MB；`localStore.put` 单项 ≤ 5MB；`localStore` 总量 ≤ 1GiB；远程图片 ≤ 30MB 且 Content-Type 必须 `image/*`。
- key 规则 `^[A-Za-z0-9._-]{1,120}$` 且不能以 `.` 开头，落盘前还会做 canonicalPath 越界校验。
- 保存的图片通过 `https://chugao.art/__local/files/<key>` 由 `shouldInterceptRequest` 直接从 `filesDir/local-files` 返回，不经过网络。

## 安全要点

- `allowFileAccess=false`、`allowContentAccess=false`、混合内容 `NEVER_ALLOW`、`usesCleartextTraffic=false`，network security config 只信任系统证书。
- 只用 `WebMessageListener`，没有任何 `addJavascriptInterface`。
- 首次启动的隐私弹窗不同意就不创建 WebView（也就不发任何请求）；同意结果带版本号，改 `PrivacyConsent.VERSION` 可重新征询。
- 外部链接走 Custom Tabs；`weixin://`、`alipays://` 等白名单 scheme 才唤起外部 App；`intent:` 会清空 component / selector / package 并二次校验目标 scheme。
- 证书错误一律 `handler.cancel()`。
- 自更新只接受同域 https 的 APK，并且 SHA-256、包名、versionCode、签名四重校验。
