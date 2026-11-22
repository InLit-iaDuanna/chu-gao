package art.chugao.app.bridge

import art.chugao.app.update.UpdateCheckResult

/** 原生桥需要的宿主能力，由 MainActivity 实现。 */
interface BridgeHost {

    fun userAgent(): String

    fun localStore(): LocalStore

    fun openExternal(url: String): Boolean

    suspend fun checkForUpdate(manual: Boolean): UpdateCheckResult

    /** API 28 及以下写公共目录前的存储权限确认。 */
    suspend fun ensureLegacyWritePermission(): Boolean

    suspend fun saveImageToGallery(url: String, filename: String?): Boolean
}
