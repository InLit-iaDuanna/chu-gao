package art.chugao.app.util

import android.webkit.CookieManager
import art.chugao.app.BuildConfig
import art.chugao.app.web.UrlPolicy
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * 统一的下载入口：只允许 https 同源地址，带 Cookie 与 UA，限制大小，
 * 重定向的每一跳都要重新校验同源。
 */
object SafeDownloader {

    /** 图片类下载上限 30MB */
    const val MAX_IMAGE_BYTES = 30L * 1024 * 1024

    private const val MAX_REDIRECTS = 3
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 30_000

    class Fetched(
        val url: String,
        val mime: String,
        val length: Long,
        val stream: InputStream,
        private val connection: HttpURLConnection,
    ) : Closeable {
        override fun close() {
            runCatching { stream.close() }
            connection.disconnect()
        }
    }

    fun defaultUserAgent(): String {
        val base = System.getProperty("http.agent") ?: "Android"
        return "$base ChugaoApp/${BuildConfig.VERSION_NAME}"
    }

    @Throws(IOException::class)
    fun open(
        url: String,
        maxBytes: Long,
        requireImage: Boolean,
        userAgent: String? = null,
    ): Fetched {
        var current = url.trim()
        if (!UrlPolicy.isSameOrigin(current)) throw IOException("url not allowed")

        val agent = userAgent?.takeIf { it.isNotBlank() } ?: defaultUserAgent()
        var redirects = 0
        while (true) {
            val connection = URL(current).openConnection() as? HttpURLConnection
                ?: throw IOException("unsupported protocol")
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.requestMethod = "GET"
                connection.setRequestProperty("User-Agent", agent)
                connection.setRequestProperty("Accept", if (requireImage) "image/*,*/*;q=0.8" else "*/*")
                CookieManager.getInstance().getCookie(current)?.let {
                    connection.setRequestProperty("Cookie", it)
                }

                val code = connection.responseCode
                if (code in 300..399) {
                    val location = connection.getHeaderField("Location")
                        ?: throw IOException("redirect without location")
                    connection.disconnect()
                    if (++redirects > MAX_REDIRECTS) throw IOException("too many redirects")
                    current = URL(URL(current), location).toString()
                    if (!UrlPolicy.isSameOrigin(current)) throw IOException("redirect not allowed")
                    continue
                }
                if (code != HttpURLConnection.HTTP_OK) throw IOException("http $code")

                val mime = (connection.contentType ?: "").substringBefore(';')
                    .trim()
                    .lowercase(Locale.ROOT)
                if (requireImage && !mime.startsWith("image/")) {
                    throw IOException("not an image")
                }
                val length = connection.contentLengthLong
                if (length > maxBytes) throw IOException("too large")

                return Fetched(
                    current,
                    mime.ifEmpty { "application/octet-stream" },
                    length,
                    connection.inputStream,
                    connection,
                )
            } catch (e: Exception) {
                connection.disconnect()
                throw e
            }
        }
    }

    /** 流式拷贝，超过 limit 立即失败。 */
    @Throws(IOException::class)
    fun copyTo(source: InputStream, sink: java.io.OutputStream, limit: Long): Long {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val read = source.read(buffer)
            if (read < 0) break
            total += read
            if (total > limit) throw IOException("too large")
            sink.write(buffer, 0, read)
        }
        sink.flush()
        return total
    }
}
