package art.chugao.app.web

import android.net.Uri
import android.os.Message
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView

/** WebView 回调到 Activity 的接口，避免两个方向互相强引用。 */
interface WebShellHost {

    fun onProgressChanged(progress: Int)

    fun onPageStartedMain(url: String?)

    fun onPageFinishedMain(url: String?)

    /** 主框架加载失败（网络错误或证书错误）。 */
    fun onMainFrameError()

    fun showFileChooser(
        callback: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams,
    ): Boolean

    fun requestPopupWindow(view: WebView, isUserGesture: Boolean, resultMsg: Message): Boolean

    fun onDownloadRequest(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
        contentLength: Long,
    )

    // 处理 /__local/files/<key> 的本地文件读取；不处理时返回 null。
    fun interceptLocalRequest(request: WebResourceRequest): WebResourceResponse?
}
