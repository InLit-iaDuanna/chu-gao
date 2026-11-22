package art.chugao.app.update

/** 一次更新检查的结果，供原生桥原样返回给网页。 */
sealed interface UpdateCheckResult {
    data class UpToDate(val versionName: String) : UpdateCheckResult

    data class Available(val versionName: String) : UpdateCheckResult

    data class Failed(val message: String) : UpdateCheckResult
}
