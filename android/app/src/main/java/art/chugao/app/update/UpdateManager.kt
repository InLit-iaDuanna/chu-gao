package art.chugao.app.update

import android.content.Context
import android.content.DialogInterface
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import art.chugao.app.BuildConfig
import art.chugao.app.R
import art.chugao.app.util.SafeDownloader
import art.chugao.app.web.UrlPolicy
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 自更新：读取 /api/app/version，下载 APK，校验 SHA-256 与签名，再交给系统安装器。
 * 所有网络与文件操作都在 IO 线程，UI 只在主线程。
 */
class UpdateManager(private val activity: AppCompatActivity) {

    data class VersionInfo(
        val latestVersionCode: Int,
        val latestVersionName: String,
        val minSupportedVersionCode: Int,
        val apkUrl: String,
        val sha256: String,
        val notes: String,
        val publishedAt: String,
    )

    private val prefs = activity.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private var downloadJob: Job? = null
    private var pendingInstall: File? = null
    private var checking = false
    private var dialogVisible = false
    private var promptedCode = 0

    /** 供原生桥调用；manual=true 时即使已是最新也会给出提示。 */
    suspend fun check(manual: Boolean): UpdateCheckResult {
        if (checking) return UpdateCheckResult.Failed("check already running")
        checking = true
        return try {
            val info = withContext(Dispatchers.IO) { fetchVersion() }
            withContext(Dispatchers.Main) { present(info, manual) }
            if (info.latestVersionCode > BuildConfig.VERSION_CODE) {
                UpdateCheckResult.Available(info.latestVersionName)
            } else {
                UpdateCheckResult.UpToDate(BuildConfig.VERSION_NAME)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (manual) withContext(Dispatchers.Main) { toast(R.string.update_check_failed) }
            UpdateCheckResult.Failed(e.message ?: "check failed")
        } finally {
            checking = false
        }
    }

    /** 从设置页返回后继续未完成的安装。 */
    fun onResume() {
        val file = pendingInstall ?: return
        if (activity.isFinishing || activity.isDestroyed) return
        if (activity.packageManager.canRequestPackageInstalls()) install(file)
    }

    // ------------------------------------------------------------- 网络

    @Throws(IOException::class)
    private fun fetchVersion(): VersionInfo {
        val connection = URL(BuildConfig.BASE_URL + VERSION_PATH).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "ChugaoApp/" + BuildConfig.VERSION_NAME)

            val code = connection.responseCode
            if (code != HttpURLConnection.HTTP_OK) throw IOException("http $code")

            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val root = JSONObject(body)
            if (!root.optBoolean("ok", false)) throw IOException("version api returned ok=false")
            val data = root.optJSONObject("data") ?: throw IOException("missing data")

            val apkUrl = data.optString("apkUrl", "").trim()
            if (!UrlPolicy.isSameOrigin(apkUrl)) throw IOException("apk url not allowed")

            val latestCode = data.optInt("latestVersionCode", 0)
            if (latestCode <= 0) throw IOException("invalid latestVersionCode")

            return VersionInfo(
                latestVersionCode = latestCode,
                latestVersionName = data.optString("latestVersionName", "")
                    .trim()
                    .ifEmpty { latestCode.toString() },
                minSupportedVersionCode = data.optInt("minSupportedVersionCode", 0),
                apkUrl = apkUrl,
                sha256 = data.optString("sha256", "").trim(),
                notes = data.optString("notes", "").trim(),
                publishedAt = data.optString("publishedAt", "").trim(),
            )
        } finally {
            connection.disconnect()
        }
    }

    // ------------------------------------------------------------- 提示

    private fun present(info: VersionInfo, manual: Boolean) {
        if (activity.isFinishing || activity.isDestroyed) return
        if (info.latestVersionCode <= BuildConfig.VERSION_CODE) {
            if (manual) toast(R.string.update_latest)
            return
        }
        val forced = BuildConfig.VERSION_CODE < info.minSupportedVersionCode
        if (dialogVisible) return
        if (!manual && !forced) {
            if (isSnoozed(info.latestVersionCode)) return
            if (promptedCode == info.latestVersionCode) return
        }
        promptedCode = info.latestVersionCode
        showUpdateDialog(info, forced)
    }

    private fun showUpdateDialog(info: VersionInfo, forced: Boolean) {
        val titleRes = if (forced) R.string.update_force_message else R.string.update_message
        val message = buildString {
            append(activity.getString(titleRes, info.latestVersionName))
            if (info.notes.isNotBlank()) {
                append("\n\n")
                append(activity.getString(R.string.update_notes))
                append("\n")
                append(info.notes.take(MAX_NOTES_LENGTH))
            }
        }

        val builder = MaterialAlertDialogBuilder(activity)
            .setTitle(R.string.update_title)
            .setMessage(message)
            .setCancelable(!forced)
            .setPositiveButton(R.string.action_update_now) { _, _ -> startDownload(info) }

        if (forced) {
            builder.setNegativeButton(R.string.action_exit) { _, _ -> activity.finish() }
            builder.setOnCancelListener { activity.finish() }
        } else {
            builder.setNegativeButton(R.string.action_update_later) { _, _ ->
                snooze(info.latestVersionCode)
            }
        }

        dialogVisible = true
        val dialog = builder.create()
        dialog.setOnDismissListener { dialogVisible = false }
        dialog.show()
    }

    private fun isSnoozed(code: Int): Boolean {
        val savedCode = prefs.getInt(KEY_SNOOZE_CODE, -1)
        val savedAt = prefs.getLong(KEY_SNOOZE_AT, 0L)
        return savedCode == code && System.currentTimeMillis() - savedAt < SNOOZE_MS
    }

    private fun snooze(code: Int) {
        prefs.edit()
            .putInt(KEY_SNOOZE_CODE, code)
            .putLong(KEY_SNOOZE_AT, System.currentTimeMillis())
            .apply()
    }

    // ------------------------------------------------------------- 下载

    private fun startDownload(info: VersionInfo) {
        if (downloadJob?.isActive == true) return
        val context = activity

        val view = context.layoutInflater.inflate(R.layout.dialog_update_progress, null)
        val bar = view.findViewById<LinearProgressIndicator>(R.id.update_progress)
        val label = view.findViewById<TextView>(R.id.update_progress_label)
        label.text = context.getString(R.string.update_downloading, 0)

        val dialog = MaterialAlertDialogBuilder(context)
            .setTitle(R.string.update_downloading_title)
            .setView(view)
            .setCancelable(false)
            .setNegativeButton(R.string.action_cancel, null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(DialogInterface.BUTTON_NEGATIVE)?.setOnClickListener {
                downloadJob?.cancel()
                dialog.dismiss()
            }
        }
        dialog.show()

        downloadJob = context.lifecycleScope.launch {
            var partial: File? = null
            try {
                val file = downloadApk(info) { percent ->
                    context.runOnUiThread {
                        if (dialog.isShowing) {
                            bar.setProgressCompat(percent, true)
                            label.text = context.getString(R.string.update_downloading, percent)
                        }
                    }
                }
                partial = file

                val verified = withContext(Dispatchers.IO) { verify(file, info) }
                if (!verified) {
                    file.delete()
                    toast(R.string.update_verify_failed)
                    return@launch
                }
                install(file)
            } catch (e: CancellationException) {
                partial?.delete()
                throw e
            } catch (e: Exception) {
                partial?.delete()
                toast(R.string.update_download_failed)
            } finally {
                if (dialog.isShowing) dialog.dismiss()
            }
        }
    }

    private suspend fun downloadApk(info: VersionInfo, onProgress: (Int) -> Unit): File =
        withContext(Dispatchers.IO) {
            val dir = File(activity.cacheDir, "updates")
            if (!dir.exists() && !dir.mkdirs()) throw IOException("cannot create update dir")
            val target = File(dir, "chugao-${info.latestVersionCode}.apk")
            val temp = File(dir, "chugao-${info.latestVersionCode}.apk.part")

            SafeDownloader.open(
                info.apkUrl,
                MAX_APK_BYTES,
                requireImage = false,
                userAgent = "ChugaoApp/${BuildConfig.VERSION_NAME}",
            ).use { fetched ->
                val total = fetched.length
                var written = 0L
                var lastPercent = -1
                try {
                    temp.outputStream().use { output ->
                        fetched.stream.use { input ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                currentCoroutineContext().ensureActive()
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                written += read
                                if (total > 0) {
                                    val percent = ((written * 100) / total).toInt().coerceIn(0, 100)
                                    if (percent != lastPercent) {
                                        lastPercent = percent
                                        onProgress(percent)
                                    }
                                }
                            }
                        }
                        output.flush()
                    }
                    if (total > 0 && written != total) throw IOException("incomplete apk")
                    if (target.exists() && !target.delete()) throw IOException("cannot replace apk")
                    if (!temp.renameTo(target)) throw IOException("cannot commit apk")
                } catch (e: Exception) {
                    temp.delete()
                    throw e
                }
            }
            target
        }

    // ------------------------------------------------------------- 校验

    private fun verify(file: File, info: VersionInfo): Boolean {
        if (!file.isFile || file.length() <= 0L) return false
        if (info.sha256.isBlank()) return false
        val digest = try {
            sha256Hex(file)
        } catch (e: Exception) {
            return false
        }
        if (!digest.equals(info.sha256, ignoreCase = true)) return false
        return verifyPackage(file, info.latestVersionCode)
    }

    @Suppress("DEPRECATION")
    private fun verifyPackage(file: File, expectedCode: Int): Boolean {
        val manager = activity.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }

        val archive = manager.getPackageArchiveInfo(file.absolutePath, flags) ?: return false
        if (archive.packageName != activity.packageName) return false
        if (archive.versionCode != expectedCode) return false

        val archiveSignatures = signatureHashes(archive)
        if (archiveSignatures.isEmpty()) return false

        val installed = try {
            manager.getPackageInfo(activity.packageName, flags)
        } catch (e: Exception) {
            return false
        }
        val installedSignatures = signatureHashes(installed)
        if (installedSignatures.isEmpty()) return false

        return archiveSignatures.all { it in installedSignatures }
    }

    @Suppress("DEPRECATION")
    private fun signatureHashes(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = info.signingInfo ?: return emptySet()
            if (signingInfo.hasMultipleSigners()) {
                signingInfo.apkContentsSigners
            } else {
                signingInfo.signingCertificateHistory
            }
        } else {
            info.signatures ?: return emptySet()
        }
        val hashes = HashSet<String>(signatures.size)
        for (signature in signatures) {
            hashes.add(sha256Hex(signature.toByteArray()))
        }
        return hashes
    }

    private fun sha256Hex(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return toHex(digest.digest())
    }

    private fun sha256Hex(bytes: ByteArray): String =
        toHex(MessageDigest.getInstance("SHA-256").digest(bytes))

    private fun toHex(bytes: ByteArray): String {
        val builder = StringBuilder(bytes.size * 2)
        for (byte in bytes) {
            val value = byte.toInt() and 0xFF
            builder.append(HEX[value ushr 4]).append(HEX[value and 0x0F])
        }
        return builder.toString()
    }

    // ------------------------------------------------------------- 安装

    private fun install(file: File) {
        if (activity.isFinishing || activity.isDestroyed) return
        if (!activity.packageManager.canRequestPackageInstalls()) {
            pendingInstall = file
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${activity.packageName}"),
            )
            try {
                activity.startActivity(intent)
            } catch (e: Exception) {
                toast(R.string.update_permission_needed)
            }
            return
        }
        pendingInstall = null

        val uri = try {
            FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file,
            )
        } catch (e: Exception) {
            toast(R.string.update_install_failed)
            return
        }

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            activity.startActivity(intent)
        } catch (e: Exception) {
            toast(R.string.update_install_failed)
        }
    }

    private fun toast(resId: Int) {
        if (activity.isFinishing || activity.isDestroyed) return
        Toast.makeText(activity, resId, Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val PREFS_NAME = "chugao_update"
        const val KEY_SNOOZE_CODE = "snooze_code"
        const val KEY_SNOOZE_AT = "snooze_at"
        const val SNOOZE_MS = 24 * 60 * 60 * 1000L
        const val TIMEOUT_MS = 10_000
        const val MAX_APK_BYTES = 300L * 1024 * 1024
        const val MAX_NOTES_LENGTH = 1_500
        const val VERSION_PATH = "/api/app/version"
        const val HEX = "0123456789abcdef"
    }
}
