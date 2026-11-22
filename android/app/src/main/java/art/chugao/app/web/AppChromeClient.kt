package art.chugao.app.web

import android.net.Uri
import android.os.Message
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView

class AppChromeClient(private val host: WebShellHost) : WebChromeClient() {

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        host.onProgressChanged(newProgress)
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean = host.showFileChooser(filePathCallback, fileChooserParams)

    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean = host.requestPopupWindow(view, isUserGesture, resultMsg)
}
