package art.chugao.app.privacy

import android.content.Context

/** 隐私政策同意状态，按版本号记录；版本升级后会重新征询。 */
object PrivacyConsent {

    const val VERSION = 1

    private const val PREFS_NAME = "chugao_privacy"
    private const val KEY_VERSION = "consent_version"

    fun hasAccepted(context: Context): Boolean =
        prefs(context).getInt(KEY_VERSION, 0) >= VERSION

    fun accept(context: Context) {
        prefs(context).edit().putInt(KEY_VERSION, VERSION).apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
