package art.chugao.app.bridge

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import art.chugao.app.R
import art.chugao.app.util.FileNames
import art.chugao.app.util.SafeDownloader
import art.chugao.app.web.UrlPolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** image.saveToGallery：远程同源图片或本地 /__local/files 图片写入系统相册。 */
class GallerySaver(private val context: Context, private val store: LocalStore) {

    suspend fun save(url: String, filename: String?, userAgent: String): Boolean =
        withContext(Dispatchers.IO) {
            val raw = url.trim()
            if (raw.isEmpty()) throw BridgeException(BridgeException.BAD_REQUEST, "url is required")

            val localKey = localFileKey(raw)
            if (localKey != null) {
                val stored = store.openFile(localKey)
                    ?: throw BridgeException(BridgeException.FORBIDDEN, "local file not found")
                stored.file.inputStream().use { input ->
                    write(input, stored.mime, filename, stored.file.length())
                }
            } else {
                if (!UrlPolicy.isSameOrigin(raw)) {
                    throw BridgeException(BridgeException.FORBIDDEN, "url not allowed")
                }
                SafeDownloader.open(
                    raw,
                    SafeDownloader.MAX_IMAGE_BYTES,
                    requireImage = true,
                    userAgent = userAgent,
                ).use { fetched ->
                    write(fetched.stream, fetched.mime, filename, fetched.length)
                }
            }

            withContext(Dispatchers.Main) {
                Toast.makeText(context, R.string.toast_saved_to_gallery, Toast.LENGTH_SHORT).show()
            }
            true
        }

    /** /__local/files/<key> 的相对路径或同源绝对地址，都解析成本地 key。 */
    private fun localFileKey(url: String): String? {
        val path = when {
            url.startsWith(LocalStore.URL_PREFIX) -> url
            UrlPolicy.isSameOrigin(url) -> {
                val marker = url.indexOf(LocalStore.URL_PREFIX)
                if (marker > 0) url.substring(marker) else return null
            }

            else -> return null
        }
        return path.removePrefix(LocalStore.URL_PREFIX)
            .substringBefore('?')
            .substringBefore('#')
            .ifEmpty { null }
    }

    private fun write(input: InputStream, mime: String, filename: String?, lengthHint: Long) {
        val safeMime = mime.substringBefore(';').trim().lowercase()
        if (!safeMime.startsWith("image/")) {
            throw BridgeException(BridgeException.FORBIDDEN, "not an image")
        }
        if (lengthHint > SafeDownloader.MAX_IMAGE_BYTES) {
            throw BridgeException(BridgeException.TOO_LARGE, "image too large")
        }
        val name = FileNames.sanitize(filename, FileNames.extensionOf(safeMime))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            writeViaMediaStore(input, safeMime, name)
        } else {
            writeLegacy(input, safeMime, name)
        }
    }

    private fun writeViaMediaStore(input: InputStream, mime: String, name: String) {
        val resolver: ContentResolver = context.contentResolver
        val folder = context.getString(R.string.gallery_folder_name)
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, mime)
            put(
                MediaStore.Images.Media.RELATIVE_PATH,
                "${Environment.DIRECTORY_PICTURES}/$folder",
            )
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("cannot insert media store item")
        try {
            val output = resolver.openOutputStream(uri)
                ?: throw IOException("cannot open media store stream")
            output.use { sink -> copy(input, sink) }
            val done = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
        } catch (e: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            throw e
        }
    }

    @Suppress("DEPRECATION")
    private fun writeLegacy(input: InputStream, mime: String, name: String) {
        val pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
        val dir = File(pictures, context.getString(R.string.gallery_folder_name))
        if (!dir.exists() && !dir.mkdirs()) throw IOException("cannot create gallery folder")
        val target = FileNames.uniqueIn(dir, name)
        target.outputStream().use { sink -> copy(input, sink) }
        MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf(mime), null)
    }

    private fun copy(input: InputStream, output: OutputStream) {
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
        }
        output.flush()
    }
}
