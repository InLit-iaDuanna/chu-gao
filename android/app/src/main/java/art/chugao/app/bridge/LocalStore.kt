package art.chugao.app.bridge

import android.content.Context
import android.webkit.MimeTypeMap
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.Locale

/**
 * 网页侧的小型本地存储：
 * - 文本存 filesDir/local-store/<key>
 * - 文件存 filesDir/local-files/<key>，mime 记在 local-files/.meta/<key>
 * 所有路径都经过 canonicalPath 校验，拒绝越界。
 */
class LocalStore(context: Context) {

    private val appContext = context.applicationContext
    private val textDir = File(appContext.filesDir, "local-store")
    private val fileDir = File(appContext.filesDir, "local-files")
    private val metaDir = File(fileDir, ".meta")

    data class SavedFile(val key: String, val bytes: Long, val mime: String)

    data class StoredFile(val file: File, val mime: String)

    fun putText(key: String, value: String): Long {
        val target = LocalStoreKeys.resolve(textDir, key)
            ?: throw BridgeException(BridgeException.FORBIDDEN, "invalid key")
        val bytes = value.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_ITEM_BYTES) {
            throw BridgeException(BridgeException.TOO_LARGE, "value exceeds 5MB")
        }
        val existing = if (target.isFile) target.length() else 0L
        ensureCapacity(bytes.size.toLong() - existing)
        writeAtomically(target, bytes)
        return bytes.size.toLong()
    }

    fun getText(key: String): String? {
        val target = LocalStoreKeys.resolve(textDir, key) ?: return null
        if (!target.isFile) return null
        return try {
            target.readBytes().toString(Charsets.UTF_8)
        } catch (e: IOException) {
            null
        }
    }

    fun list(prefix: String?): JSONArray {
        val entries = LinkedHashMap<String, JSONObject>()
        collect(textDir, prefix, entries)
        collect(fileDir, prefix, entries)
        val array = JSONArray()
        for (key in entries.keys.sorted()) {
            entries[key]?.let { array.put(it) }
        }
        return array
    }

    private fun collect(dir: File, prefix: String?, out: MutableMap<String, JSONObject>) {
        val files = dir.listFiles() ?: return
        for (file in files) {
            if (!file.isFile) continue
            val name = file.name
            if (name.startsWith(".")) continue
            if (prefix != null && !name.startsWith(prefix)) continue
            out[name] = JSONObject()
                .put("key", name)
                .put("bytes", file.length())
                .put("updatedAt", file.lastModified())
        }
    }

    fun deleteText(key: String): Boolean {
        val target = LocalStoreKeys.resolve(textDir, key) ?: return false
        return target.isFile && target.delete()
    }

    fun saveFile(key: String, mime: String, lengthHint: Long, source: InputStream): SavedFile {
        val target = LocalStoreKeys.resolve(fileDir, key)
            ?: throw BridgeException(BridgeException.FORBIDDEN, "invalid key")
        val safeMime = mime.substringBefore(';').trim().lowercase(Locale.ROOT)
        // 只接受位图格式：SVG 等可执行脚本的类型不能以同源身份落地
        if (safeMime !in RASTER_MIMES) {
            throw BridgeException(BridgeException.FORBIDDEN, "unsupported content type")
        }
        if (!fileDir.exists() && !fileDir.mkdirs()) throw IOException("cannot create local-files")

        val existing = if (target.isFile) target.length() else 0L
        val base = (usageBytes() - existing).coerceAtLeast(0L)
        if (lengthHint > 0 && base + lengthHint > LIMIT_BYTES) {
            throw BridgeException(BridgeException.TOO_LARGE, "local storage is full")
        }

        val temp = File(fileDir, ".part-${System.nanoTime()}")
        var total = 0L
        try {
            temp.outputStream().use { out ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = source.read(buffer)
                    if (read < 0) break
                    total += read
                    if (base + total > LIMIT_BYTES) {
                        throw BridgeException(BridgeException.TOO_LARGE, "local storage is full")
                    }
                    out.write(buffer, 0, read)
                }
                out.flush()
            }
            if (target.isFile && !target.delete()) throw IOException("cannot replace file")
            if (!temp.renameTo(target)) throw IOException("cannot save file")
        } catch (e: Exception) {
            temp.delete()
            throw e
        }
        writeMime(key, safeMime)
        return SavedFile(key, total, safeMime)
    }

    fun openFile(key: String): StoredFile? {
        val file = LocalStoreKeys.resolve(fileDir, key) ?: return null
        if (!file.isFile) return null
        return StoredFile(file, mimeOf(key, file))
    }

    fun deleteFile(key: String): Boolean {
        val file = LocalStoreKeys.resolve(fileDir, key) ?: return false
        val meta = LocalStoreKeys.resolve(metaDir, key)
        var deleted = false
        if (file.isFile) deleted = file.delete()
        meta?.delete()
        return deleted
    }

    fun usageBytes(): Long = sizeOf(textDir) + sizeOf(fileDir)

    private fun sizeOf(dir: File): Long {
        val files = dir.listFiles() ?: return 0L
        var total = 0L
        for (file in files) {
            total += if (file.isFile) file.length() else sizeOf(file)
        }
        return total
    }

    /** /__local/files/<key> 的响应；不存在时返回 404。 */
    fun buildResponse(rawKey: String?): WebResourceResponse {
        val stored = rawKey?.let { openFile(it.trim()) }
        if (stored == null) {
            return WebResourceResponse(
                "text/plain",
                "utf-8",
                404,
                "Not Found",
                mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream(ByteArray(0)),
            )
        }
        val mime = stored.mime.takeIf { it in RASTER_MIMES } ?: "application/octet-stream"
        return WebResourceResponse(
            mime,
            null,
            200,
            "OK",
            mapOf(
                "Cache-Control" to "private, max-age=31536000",
                "X-Content-Type-Options" to "nosniff",
                "Content-Security-Policy" to "default-src 'none'; sandbox",
            ),
            stored.file.inputStream(),
        )
    }

    private val RASTER_MIMES = setOf(
        "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/heic",
    )

    private fun mimeOf(key: String, file: File): String {
        val meta = LocalStoreKeys.resolve(metaDir, key)
        val stored = meta?.takeIf { it.isFile }?.let {
            runCatching { it.readText(Charsets.UTF_8).trim() }.getOrNull()
        }
        if (!stored.isNullOrBlank()) return stored
        val extension = file.name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
            ?: "application/octet-stream"
    }

    private fun writeMime(key: String, mime: String) {
        val meta = LocalStoreKeys.resolve(metaDir, key) ?: return
        if (!metaDir.exists() && !metaDir.mkdirs()) return
        writeAtomically(meta, mime.toByteArray(Charsets.UTF_8))
    }

    private fun writeAtomically(target: File, bytes: ByteArray) {
        val parent = target.parentFile ?: throw IOException("no parent directory")
        if (!parent.exists() && !parent.mkdirs()) throw IOException("cannot create directory")
        val temp = File(parent, ".tmp-${System.nanoTime()}")
        try {
            temp.outputStream().use { out ->
                out.write(bytes)
                out.flush()
            }
            if (target.exists() && !target.delete()) throw IOException("cannot replace file")
            if (!temp.renameTo(target)) throw IOException("cannot commit file")
        } catch (e: Exception) {
            temp.delete()
            throw e
        }
    }

    private fun ensureCapacity(growth: Long) {
        if (growth <= 0L) return
        if (usageBytes() + growth > LIMIT_BYTES) {
            throw BridgeException(BridgeException.TOO_LARGE, "local storage is full")
        }
    }

    companion object {
        /** 1 GiB */
        const val LIMIT_BYTES = 1_073_741_824L
        const val MAX_ITEM_BYTES = 5L * 1024 * 1024
        const val URL_PREFIX = "/__local/files/"
    }
}
