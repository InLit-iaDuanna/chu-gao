package art.chugao.app.util

import java.io.File
import java.util.Locale

/** 文件名清洗：去掉路径、控制字符与保留字符，保留扩展名。 */
object FileNames {

    private const val MAX_LENGTH = 120
    private val ILLEGAL = Regex("[\\u0000-\\u001f\\\\/:*?\"<>|]")

    fun sanitize(raw: String?, fallbackExtension: String, fallbackBase: String = "chugao"): String {
        val source = raw?.trim().orEmpty()
        var name = source.substringAfterLast('/').substringAfterLast('\\')
        name = ILLEGAL.replace(name, "_").trim().trim('.')

        if (name.isEmpty()) name = fallbackBase

        val dot = name.lastIndexOf('.')
        if (dot <= 0 || dot == name.length - 1) {
            name += fallbackExtension
        }

        if (name.length > MAX_LENGTH) {
            val extensionDot = name.lastIndexOf('.')
            val extension = if (extensionDot > 0) name.substring(extensionDot) else ""
            val base = if (extensionDot > 0) name.substring(0, extensionDot) else name
            val keep = (MAX_LENGTH - extension.length).coerceAtLeast(1)
            name = base.take(keep).trimEnd(' ', '.') + extension
        }
        return if (name.isBlank()) fallbackBase + fallbackExtension else name
    }

    /** 目录内重名时追加 -1、-2 … */
    fun uniqueIn(dir: File, name: String): File {
        val direct = File(dir, name)
        if (!direct.exists()) return direct
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val extension = if (dot > 0) name.substring(dot) else ""
        for (index in 1..999) {
            val candidate = File(dir, "$base-$index$extension")
            if (!candidate.exists()) return candidate
        }
        return File(dir, "$base-${System.currentTimeMillis()}$extension")
    }

    fun extensionOf(mime: String): String {
        val normalized = mime.substringBefore(';').trim().lowercase(Locale.ROOT)
        return when (normalized) {
            "image/png" -> ".png"
            "image/webp" -> ".webp"
            "image/gif" -> ".gif"
            "image/avif" -> ".avif"
            "image/heic", "image/heif" -> ".heic"
            "image/svg+xml" -> ".svg"
            else -> ".jpg"
        }
    }
}
