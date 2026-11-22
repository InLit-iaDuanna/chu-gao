package art.chugao.app.web

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import art.chugao.app.BuildConfig
import art.chugao.app.R
import java.util.Locale

/** 一次导航的处理结果。纯数据，无 Android 依赖，便于单测。 */
sealed interface UrlDecision {
    /** 站内页面，交给 WebView 加载。 */
    data object InApp : UrlDecision

    /** about:blank，允许（弹窗流程会先打开空白页）。 */
    data object AllowAboutBlank : UrlDecision

    /** 外部 https，用 Custom Tabs 打开。 */
    data class ExternalBrowser(val url: String) : UrlDecision

    /** 已安装的第三方 App（微信/支付宝等）。 */
    data class ExternalApp(val scheme: String, val url: String) : UrlDecision

    /** intent: 协议，需要解析后二次校验。 */
    data class AppIntent(val url: String) : UrlDecision

    /** 一律拦截。 */
    data object Blocked : UrlDecision
}

/**
 * 导航规则：只做纯字符串解析，不接触 android.net.Uri，方便 JVM 单测。
 *
 * 同源 = scheme 为 https + host 等于 [APP_HOST]（大小写不敏感）+ 端口为默认（缺省或 443）。
 */
object UrlPolicy {

    val APP_HOST: String = BuildConfig.APP_HOST

    /** 允许唤起外部 App 的 scheme 白名单。 */
    val EXTERNAL_SCHEMES: Set<String> = setOf("weixin", "alipays", "alipay", "mqqapi", "upwrp")

    private const val ABOUT_BLANK = "about:blank"

    data class HostPort(val host: String?, val port: Int)

    fun isAppHost(host: String?): Boolean = host != null && host.equals(APP_HOST, ignoreCase = true)

    /** 取出 url 的 scheme（小写）；不像 URL 时返回 null。 */
    fun schemeOf(url: String?): String? {
        val value = url ?: return null
        val colon = value.indexOf(':')
        if (colon <= 0) return null
        val scheme = value.substring(0, colon)
        if (!scheme.first().isLetter()) return null
        if (!scheme.all { it.isLetterOrDigit() || it == '+' || it == '.' || it == '-' }) return null
        return scheme.lowercase(Locale.ROOT)
    }

    /** 手写 authority 解析：正确处理 userinfo、端口、IPv6 方括号。 */
    fun hostPortOf(url: String?): HostPort? {
        val value = url?.trim().orEmpty()
        if (value.isEmpty()) return null
        val schemeEnd = value.indexOf("://")
        if (schemeEnd <= 0) return null
        var authority = value.substring(schemeEnd + 3)
        val cut = authority.indexOfAny(charArrayOf('/', '?', '#', '\\'))
        if (cut >= 0) authority = authority.substring(0, cut)
        if (authority.isEmpty()) return null
        // userinfo 只认最后一个 @，避免 https://chugao.art@evil.com 被误判
        val at = authority.lastIndexOf('@')
        val hostPort = if (at >= 0) authority.substring(at + 1) else authority
        if (hostPort.isEmpty()) return null

        if (hostPort.startsWith("[")) {
            val close = hostPort.indexOf(']')
            if (close <= 1) return null
            val host = hostPort.substring(0, close + 1).lowercase(Locale.ROOT)
            val rest = hostPort.substring(close + 1)
            val port = when {
                rest.isEmpty() -> -1
                rest.startsWith(":") -> rest.substring(1).toIntOrNull() ?: return null
                else -> return null
            }
            if (port > 65535) return null
            return HostPort(host, port)
        }

        val colon = hostPort.lastIndexOf(':')
        if (colon < 0) return HostPort(normalizeHost(hostPort), -1)
        val host = normalizeHost(hostPort.substring(0, colon))
        val portPart = hostPort.substring(colon + 1)
        val port = if (portPart.isEmpty()) -1 else (portPart.toIntOrNull() ?: return null)
        if (port > 65535) return null
        return HostPort(host, port)
    }

    private fun normalizeHost(raw: String): String? {
        val host = raw.trim().lowercase(Locale.ROOT)
        if (host.isEmpty()) return null
        if (host.contains('@') || host.contains('/') || host.contains('\\') || host.contains('#')) return null
        return host
    }

    fun isSameOrigin(url: String?): Boolean {
        val value = url?.trim().orEmpty()
        if (value.isEmpty()) return false
        if (schemeOf(value) != "https") return false
        val hostPort = hostPortOf(value) ?: return false
        if (!isAppHost(hostPort.host)) return false
        return hostPort.port == -1 || hostPort.port == 443
    }

    fun isHttpsUrl(url: String?): Boolean {
        val value = url?.trim().orEmpty()
        if (value.isEmpty()) return false
        if (schemeOf(value) != "https") return false
        return !hostPortOf(value)?.host.isNullOrEmpty()
    }

    fun decide(rawUrl: String?): UrlDecision {
        val url = rawUrl?.trim().orEmpty()
        if (url.isEmpty()) return UrlDecision.Blocked
        if (url.equals(ABOUT_BLANK, ignoreCase = true)) return UrlDecision.AllowAboutBlank

        val scheme = schemeOf(url) ?: return UrlDecision.Blocked
        return when {
            scheme == "https" -> {
                val hostPort = hostPortOf(url)
                when {
                    hostPort?.host.isNullOrEmpty() -> UrlDecision.Blocked
                    isSameOrigin(url) -> UrlDecision.InApp
                    else -> UrlDecision.ExternalBrowser(url)
                }
            }

            scheme == "intent" -> UrlDecision.AppIntent(url)
            scheme in EXTERNAL_SCHEMES -> UrlDecision.ExternalApp(scheme, url)
            // http / file / content / javascript / data / blob / about:xxx 等一律拦截
            else -> UrlDecision.Blocked
        }
    }
}

/**
 * 导航规则的执行端（Custom Tabs、第三方 App、intent: 协议）。
 * 与 [UrlPolicy] 放在一起，保证规则只有一处。
 */
object ExternalNavigator {

    sealed interface Outcome {
        /** 已经交给外部应用或弹了提示，WebView 不再处理。 */
        data object Consumed : Outcome

        /** 需要 WebView 继续按常规规则跳转。 */
        data class Navigate(val url: String) : Outcome
    }

    fun openCustomTab(context: Context, url: String): Boolean {
        return try {
            val params = androidx.browser.customtabs.CustomTabColorSchemeParams.Builder()
                .setToolbarColor(ContextCompat.getColor(context, R.color.chrome_toolbar))
                .setNavigationBarColor(ContextCompat.getColor(context, R.color.chrome_navigation_bar))
                .build()
            val customTabs = CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setDefaultColorSchemeParams(params)
                .build()
            if (context !is Activity) {
                customTabs.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            customTabs.launchUrl(context, Uri.parse(url))
            true
        } catch (e: ActivityNotFoundException) {
            toast(context, R.string.toast_no_browser)
            false
        } catch (e: Exception) {
            toast(context, R.string.toast_no_browser)
            false
        }
    }

    fun startExternalApp(context: Context, scheme: String, url: String): Boolean {
        if (scheme !in UrlPolicy.EXTERNAL_SCHEMES) return false
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
                if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            toast(context, R.string.toast_no_app)
            false
        } catch (e: Exception) {
            toast(context, R.string.toast_no_app)
            false
        }
    }

    /**
     * 解析 intent: 协议。清空 component / selector / package，只保留数据与 extras，
     * 目标 scheme 必须命中白名单或为 https，否则拒绝并尝试 browser_fallback_url。
     */
    fun handleIntentUri(context: Context, rawUrl: String): Outcome {
        var fallbackUrl: String? = null
        try {
            val parsed = Intent.parseUri(rawUrl, Intent.URI_INTENT_SCHEME)
            fallbackUrl = parsed.getStringExtra("browser_fallback_url")
            val target = parsed.data
            parsed.component = null
            parsed.selector = null
            parsed.setPackage(null)
            parsed.addCategory(Intent.CATEGORY_BROWSABLE)

            val targetScheme = (target?.scheme ?: parsed.scheme)?.lowercase(Locale.ROOT)
                ?: return fallback(context, fallbackUrl)

            if (targetScheme == "https") {
                val targetUrl = target?.toString() ?: return fallback(context, fallbackUrl)
                return when (val decision = UrlPolicy.decide(targetUrl)) {
                    UrlDecision.InApp -> Outcome.Navigate(targetUrl)
                    is UrlDecision.ExternalBrowser -> {
                        openCustomTab(context, decision.url)
                        Outcome.Consumed
                    }

                    else -> fallback(context, fallbackUrl)
                }
            }

            if (targetScheme !in UrlPolicy.EXTERNAL_SCHEMES) {
                return fallback(context, fallbackUrl)
            }

            return try {
                context.startActivity(parsed)
                Outcome.Consumed
            } catch (e: ActivityNotFoundException) {
                toast(context, R.string.toast_no_app)
                fallback(context, fallbackUrl)
            } catch (e: Exception) {
                fallback(context, fallbackUrl)
            }
        } catch (e: Exception) {
            return fallback(context, fallbackUrl)
        }
    }

    private fun fallback(context: Context, fallbackUrl: String?): Outcome {
        val url = fallbackUrl?.trim()
        if (url != null && UrlPolicy.isHttpsUrl(url)) {
            if (UrlPolicy.isSameOrigin(url)) return Outcome.Navigate(url)
            openCustomTab(context, url)
        }
        return Outcome.Consumed
    }

    private fun toast(context: Context, resId: Int) {
        try {
            Toast.makeText(context, resId, Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            // 后台线程或 Context 不可用时忽略
        }
    }
}
