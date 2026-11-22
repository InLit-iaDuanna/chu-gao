package art.chugao.app.bridge

import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import art.chugao.app.BuildConfig
import art.chugao.app.update.UpdateCheckResult
import art.chugao.app.util.SafeDownloader
import art.chugao.app.web.UrlPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * WebViewCompat.addWebMessageListener 的原生桥。
 * 协议：请求 { id, method, params }；响应 { id, ok, result } 或 { id, ok:false, error:{code,message} }。
 * 事件：{ event: "app.resume" | "app.pause" }。
 */
class NativeBridge(
    private val host: BridgeHost,
    private val scope: CoroutineScope,
) : WebViewCompat.WebMessageListener {

    @Volatile
    private var replyProxy: JavaScriptReplyProxy? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        if (!isMainFrame) return
        if (sourceOrigin.toString() != ALLOWED_ORIGIN) return
        this.replyProxy = replyProxy

        // ArrayBuffer 消息没有 data，直接忽略
        val payload = message.data ?: return
        if (payloadSize(payload) > MAX_MESSAGE_BYTES) {
            val tooLargeId = ID_FIELD_PATTERN.find(payload)?.groupValues?.getOrNull(1)
            if (tooLargeId != null) {
                replyError(replyProxy, tooLargeId, BridgeException.TOO_LARGE, "message exceeds 8MB")
            }
            return
        }

        val request = try {
            JSONObject(payload)
        } catch (e: Exception) {
            return
        }
        val id = request.optString("id", "")
        if (!ID_PATTERN.matches(id)) return

        val method = request.optString("method", "")
        val params = request.optJSONObject("params") ?: JSONObject()
        dispatch(method, params, id, replyProxy)
    }

    private fun dispatch(
        method: String,
        params: JSONObject,
        id: String,
        proxy: JavaScriptReplyProxy,
    ) {
        when (method) {
            "app.info" -> replyOk(proxy, id, appInfo())

            "app.checkUpdate" -> launchJob(proxy, id) {
                val manual = params.optBoolean("manual", false)
                when (val result = host.checkForUpdate(manual)) {
                    is UpdateCheckResult.Available -> JSONObject()
                        .put("status", "available")
                        .put("versionName", result.versionName)

                    is UpdateCheckResult.UpToDate -> JSONObject()
                        .put("status", "latest")
                        .put("versionName", result.versionName)

                    is UpdateCheckResult.Failed -> JSONObject()
                        .put("status", "error")
                        .put("message", result.message)
                }
            }

            "browser.openExternal" -> launchJob(proxy, id) {
                val url = requireString(params, "url")
                if (!UrlPolicy.isHttpsUrl(url)) {
                    throw BridgeException(BridgeException.FORBIDDEN, "only https urls are allowed")
                }
                val opened = withContext(Dispatchers.Main) { host.openExternal(url) }
                JSONObject().put("opened", opened)
            }

            "image.saveToGallery" -> launchJob(proxy, id) {
                val url = requireString(params, "url")
                val filename = params.optString("filename", "").trim().ifEmpty { null }
                val saved = host.saveImageToGallery(url, filename)
                if (!saved) throw BridgeException(BridgeException.INTERNAL, "save failed")
                JSONObject().put("saved", true)
            }

            "localStore.put" -> launchJob(proxy, id) {
                val key = requireString(params, "key")
                requireKey(key)
                if (!params.has("value") || params.isNull("value")) {
                    throw BridgeException(BridgeException.BAD_REQUEST, "value is required")
                }
                val value = params.optString("value")
                withContext(Dispatchers.IO) {
                    val bytes = host.localStore().putText(key, value)
                    JSONObject().put("bytes", bytes)
                }
            }

            "localStore.get" -> launchJob(proxy, id) {
                val key = requireString(params, "key")
                withContext(Dispatchers.IO) {
                    val value = host.localStore().getText(key)
                    JSONObject().put("value", value ?: JSONObject.NULL)
                }
            }

            "localStore.list" -> launchJob(proxy, id) {
                val prefix = params.optString("prefix", "").trim().ifEmpty { null }
                withContext(Dispatchers.IO) {
                    JSONObject().put("items", host.localStore().list(prefix))
                }
            }

            "localStore.delete" -> launchJob(proxy, id) {
                val key = requireString(params, "key")
                withContext(Dispatchers.IO) {
                    JSONObject().put("deleted", host.localStore().deleteText(key))
                }
            }

            "localStore.saveFile" -> launchJob(proxy, id) {
                val url = requireString(params, "url")
                val key = requireString(params, "key")
                requireKey(key)
                if (!UrlPolicy.isSameOrigin(url)) {
                    throw BridgeException(BridgeException.FORBIDDEN, "url must be https://${UrlPolicy.APP_HOST}/…")
                }
                val agent = host.userAgent()
                withContext(Dispatchers.IO) {
                    SafeDownloader.open(
                        url,
                        SafeDownloader.MAX_IMAGE_BYTES,
                        requireImage = true,
                        userAgent = agent,
                    ).use { fetched ->
                        val saved = host.localStore().saveFile(
                            key,
                            fetched.mime,
                            fetched.length,
                            fetched.stream,
                        )
                        JSONObject()
                            .put("key", saved.key)
                            .put("bytes", saved.bytes)
                            .put("mime", saved.mime)
                            .put("localUrl", LocalStore.URL_PREFIX + saved.key)
                    }
                }
            }

            "localStore.deleteFile" -> launchJob(proxy, id) {
                val key = requireString(params, "key")
                withContext(Dispatchers.IO) {
                    JSONObject().put("deleted", host.localStore().deleteFile(key))
                }
            }

            "localStore.usage" -> launchJob(proxy, id) {
                withContext(Dispatchers.IO) {
                    JSONObject()
                        .put("bytes", host.localStore().usageBytes())
                        .put("limitBytes", LocalStore.LIMIT_BYTES)
                }
            }

            else -> replyError(proxy, id, BridgeException.NOT_FOUND, "unknown method: $method")
        }
    }

    private fun appInfo(): JSONObject = JSONObject()
        .put("platform", "android")
        .put("versionName", BuildConfig.VERSION_NAME)
        .put("versionCode", BuildConfig.VERSION_CODE)
        .put("osVersion", Build.VERSION.RELEASE ?: "")

    private fun launchJob(proxy: JavaScriptReplyProxy, id: String, block: suspend () -> Any) {
        scope.launch {
            try {
                replyOk(proxy, id, block())
            } catch (e: BridgeException) {
                replyError(proxy, id, e.code, e.message)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                replyError(proxy, id, BridgeException.INTERNAL, e.message ?: "internal error")
            }
        }
    }

    private fun replyOk(proxy: JavaScriptReplyProxy, id: String, result: Any) {
        val payload = try {
            JSONObject().put("id", id).put("ok", true).put("result", result).toString()
        } catch (e: Exception) {
            return
        }
        mainHandler.post { runCatching { proxy.postMessage(payload) } }
    }

    private fun replyError(
        proxy: JavaScriptReplyProxy,
        id: String,
        code: String,
        message: String?,
    ) {
        val payload = try {
            JSONObject()
                .put("id", id)
                .put("ok", false)
                .put("error", JSONObject().put("code", code).put("message", message ?: code))
                .toString()
        } catch (e: Exception) {
            return
        }
        mainHandler.post { runCatching { proxy.postMessage(payload) } }
    }

    /** 主动下发给页面的事件，例如前后台切换。 */
    fun sendEvent(event: String) {
        val proxy = replyProxy ?: return
        val payload = JSONObject().put("event", event).toString()
        mainHandler.post { runCatching { proxy.postMessage(payload) } }
    }

    fun detach() {
        replyProxy = null
    }

    private fun requireString(params: JSONObject, name: String): String {
        val value = params.optString(name, "")
        if (value.isEmpty()) throw BridgeException(BridgeException.BAD_REQUEST, "$name is required")
        return value
    }

    private fun requireKey(key: String) {
        if (!LocalStoreKeys.isValid(key)) {
            throw BridgeException(BridgeException.BAD_REQUEST, "invalid key")
        }
    }

    private fun payloadSize(value: String): Long {
        if (value.length <= 1_048_576) return value.length.toLong()
        return value.toByteArray(Charsets.UTF_8).size.toLong()
    }

    companion object {
        const val JS_OBJECT_NAME = "ChugaoNative"
        val ALLOWED_ORIGIN: String = "https://" + BuildConfig.APP_HOST
        const val EVENT_RESUME = "app.resume"
        const val EVENT_PAUSE = "app.pause"

        private const val MAX_MESSAGE_BYTES = 8 * 1024 * 1024
        private val ID_PATTERN = Regex("^[A-Za-z0-9_-]{1,64}$")
        private val ID_FIELD_PATTERN = Regex("\"id\"\\s*:\\s*\"([A-Za-z0-9_-]{1,64})\"")
    }
}
