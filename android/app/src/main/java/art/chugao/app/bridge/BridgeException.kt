package art.chugao.app.bridge

/** 原生桥的错误码，与网页端约定一致。 */
class BridgeException(val code: String, message: String) : Exception(message) {

    companion object {
        const val BAD_REQUEST = "BAD_REQUEST"
        const val NOT_FOUND = "NOT_FOUND"
        const val FORBIDDEN = "FORBIDDEN"
        const val TOO_LARGE = "TOO_LARGE"
        const val UNSUPPORTED = "UNSUPPORTED"
        const val INTERNAL = "INTERNAL"
    }
}
