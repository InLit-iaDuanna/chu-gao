package art.chugao.app.web

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * 所有导航都先过 [UrlPolicy]：同源留在 WebView，其他 https 走 Custom Tabs，
 * 自定义 scheme 交给外部 App，其余一律拦截。
 */
class AppWebViewClient(private val host: WebShellHost) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url?.toString() ?: return true
        if (!request.isForMainFrame) {
            // 子框架不做外部跳转，只拦截非 http(s) 的自定义 scheme
            val scheme = UrlPolicy.schemeOf(url)
            return !(scheme == "https" || scheme == "about")
        }
        return handle(view, url)
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun shouldOverrideUrlLoading(view: WebView, url: String?): Boolean {
        return handle(view, url ?: return true)
    }

    private fun handle(view: WebView, url: String): Boolean {
        return when (val decision = UrlPolicy.decide(url)) {
            UrlDecision.InApp, UrlDecision.AllowAboutBlank -> false
            UrlDecision.Blocked -> true
            is UrlDecision.ExternalBrowser -> {
                ExternalNavigator.openCustomTab(view.context, decision.url)
                true
            }

            is UrlDecision.ExternalApp -> {
                ExternalNavigator.startExternalApp(view.context, decision.scheme, decision.url)
                true
            }

            is UrlDecision.AppIntent -> when (val outcome = ExternalNavigator.handleIntentUri(view.context, decision.url)) {
                ExternalNavigator.Outcome.Consumed -> true
                is ExternalNavigator.Outcome.Navigate -> handle(view, outcome.url)
            }
        }
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        host.onPageStartedMain(url)
    }

    override fun onPageFinished(view: WebView, url: String?) {
        super.onPageFinished(view, url)
        host.onPageFinishedMain(url)
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        if (!request.isForMainFrame) return
        val url = request.url?.toString().orEmpty()
        if (url.startsWith("data:") || url.startsWith("blob:")) return
        // 被后续导航取消的加载不弹错误页
        if (error.errorCode == WebViewClient.ERROR_UNKNOWN) return
        host.onMainFrameError()
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // 证书错误一律拒绝，绝不 proceed
        handler.cancel()
        host.onMainFrameError()
    }

    // 说明：主框架 HTTP 5xx 不单独处理，交给站点自己的错误页。

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? = host.interceptLocalRequest(request)
}
