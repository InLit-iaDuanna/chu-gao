package art.chugao.app.bridge

import java.io.File
import java.io.IOException

/**
 * localStore 的 key 规则与路径校验。纯 JVM 实现，便于单元测试。
 * 规则：^[A-Za-z0-9._-]{1,120}$ 且不能以 "." 开头。
 */
object LocalStoreKeys {

    const val MAX_LENGTH = 120

    private val KEY_PATTERN = Regex("^[A-Za-z0-9._-]{1,120}$")

    fun isValid(raw: String?): Boolean {
        if (raw == null) return false
        if (raw.length > MAX_LENGTH) return false
        if (raw.startsWith(".")) return false
        return KEY_PATTERN.matches(raw)
    }

    fun normalize(raw: String?): String? = if (isValid(raw)) raw else null

    /** 解析成 baseDir 下的文件；非法 key 或越界（..、符号链接）返回 null。 */
    fun resolve(baseDir: File, key: String?): File? {
        val name = normalize(key) ?: return null
        return try {
            val base = baseDir.canonicalFile
            val target = File(base, name).canonicalFile
            val prefix = base.path + File.separator
            if (target.path.length > prefix.length && target.path.startsWith(prefix)) target else null
        } catch (e: IOException) {
            null
        }
    }
}
