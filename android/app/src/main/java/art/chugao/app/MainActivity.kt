package art.chugao.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.SystemClock
import android.text.SpannableString
import android.text.Spanned
import android.text.TextPaint
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.view.View
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import art.chugao.app.bridge.BridgeException
import art.chugao.app.bridge.BridgeHost
import art.chugao.app.bridge.GallerySaver
import art.chugao.app.bridge.LocalStore
import art.chugao.app.bridge.NativeBridge
import art.chugao.app.privacy.PrivacyConsent
import art.chugao.app.update.UpdateCheckResult
import art.chugao.app.update.UpdateManager
import art.chugao.app.util.FileNames
import art.chugao.app.web.AppChromeClient
import art.chugao.app.web.AppWebViewClient
import art.chugao.app.web.ExternalNavigator
import art.chugao.app.web.UrlDecision
import art.chugao.app.web.UrlPolicy
import art.chugao.app.web.WebShellHost
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * 单 Activity 外壳：WebView + 原生桥 + 自更新。
 * 同意隐私政策之前不创建 WebView、不发任何网络请求。
 */
class MainActivity : AppCompatActivity(), WebShellHost, BridgeHost {

    private lateinit var rootView: View
    private lateinit var contentView: View
    private lateinit var webContainer: FrameLayout
    private lateinit var progressBar: LinearProgressIndicator
    private lateinit var errorView: View
    private lateinit var errorIcon: ImageView
    private lateinit var errorTitle: TextView
    private lateinit var errorMessage: TextView

    private lateinit var store: LocalStore
    private lateinit var gallerySaver: GallerySaver
    private lateinit var updateManager: UpdateManager
    private lateinit var bridge: NativeBridge

    private var webView: WebView? = null
    private var pendingState: Bundle? = null
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var permissionContinuation: CancellableContinuation<Boolean>? = null

    private var lastBackPressedAt = 0L
    private var homeLoaded = false
    private var mainFrameFailed = false
    private var startupUpdateChecked = false

    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val handler = Handler(Looper.getMainLooper())
    private val splashStartedAt = SystemClock.elapsedRealtime()

    private val pickImages = registerForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(MAX_PICK_IMAGES),
    ) { uris -> deliverFileChoice(uris) }

    private val pickImage = registerForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> deliverFileChoice(uri?.let { listOf(it) }) }

    private val openMultipleDocuments = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> deliverFileChoice(uris) }

    private val openSingleDocument = registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri -> deliverFileChoice(uri?.let { listOf(it) }) }

    private val writePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val continuation = permissionContinuation
        permissionContinuation = null
        if (continuation != null && continuation.isActive) continuation.resume(granted)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        super.onCreate(savedInstanceState)
        splashScreen.setKeepOnScreenCondition {
            !homeLoaded && SystemClock.elapsedRealtime() - splashStartedAt < SPLASH_MAX_MS
        }

        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        bindViews()
        applyThemeColors()
        applyWindowInsets()

        store = LocalStore(this)
        gallerySaver = GallerySaver(this, store)
        updateManager = UpdateManager(this)
        bridge = NativeBridge(this, lifecycleScope)

        setupBackHandling()
        setupErrorView()

        pendingState = savedInstanceState?.getBundle(KEY_WEBVIEW_STATE)

        if (PrivacyConsent.hasAccepted(this)) {
            startWebLayer()
        } else {
            showPrivacyDialog(firstStep = true)
        }
    }

    override fun onStart() {
        super.onStart()
        registerNetworkMonitor()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        bridge.sendEvent(NativeBridge.EVENT_RESUME)
        updateManager.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        CookieManager.getInstance().flush()
        bridge.sendEvent(NativeBridge.EVENT_PAUSE)
        super.onPause()
    }

    override fun onStop() {
        unregisterNetworkMonitor()
        super.onStop()
    }

    override fun onDestroy() {
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = null
        bridge.detach()
        webView?.let { view ->
            webContainer.removeView(view)
            view.stopLoading()
            view.destroy()
        }
        webView = null
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val view = webView ?: return
        val state = Bundle()
        view.saveState(state)
        outState.putBundle(KEY_WEBVIEW_STATE, state)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyThemeColors()
    }

    // ---------------------------------------------------------------- 视图

    private fun bindViews() {
        rootView = findViewById(R.id.root)
        contentView = findViewById(R.id.content)
        webContainer = findViewById(R.id.web_container)
        progressBar = findViewById(R.id.progress)
        errorView = findViewById(R.id.error_view)
        errorIcon = findViewById(R.id.error_icon)
        errorTitle = findViewById(R.id.error_title)
        errorMessage = findViewById(R.id.error_message)
    }

    private fun applyThemeColors() {
        val background = ContextCompat.getColor(this, R.color.window_background)
        rootView.setBackgroundColor(background)
        contentView.setBackgroundColor(background)
        errorView.setBackgroundColor(background)
        webView?.setBackgroundColor(background)

        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val controller = WindowInsetsControllerCompat(window, rootView)
        controller.isAppearanceLightStatusBars = !night
        controller.isAppearanceLightNavigationBars = !night
    }

    private fun applyWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            contentView.updatePadding(
                left = bars.left,
                top = bars.top,
                right = bars.right,
                bottom = maxOf(bars.bottom, ime.bottom),
            )
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(rootView)
    }

    private fun setupBackHandling() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view != null && view.canGoBack()) {
                    view.goBack()
                    return
                }
                val now = SystemClock.elapsedRealtime()
                if (now - lastBackPressedAt < DOUBLE_BACK_MS) {
                    finish()
                    return
                }
                lastBackPressedAt = now
                toast(R.string.toast_exit_again)
            }
        })
    }

    private fun setupErrorView() {
        findViewById<View>(R.id.error_retry).setOnClickListener { retryLoad() }
    }

    // -------------------------------------------------------------- 隐私同意

    private fun showPrivacyDialog(firstStep: Boolean) {
        if (isFinishing || isDestroyed) return
        val builder = MaterialAlertDialogBuilder(this).setCancelable(false)
        if (firstStep) {
            val messageView = layoutInflater.inflate(R.layout.dialog_privacy_message, null)
            val message = messageView.findViewById<TextView>(R.id.privacy_message)
            message.text = privacyMessage()
            message.movementMethod = LinkMovementMethod.getInstance()
            message.highlightColor = ContextCompat.getColor(this, android.R.color.transparent)
            builder
                .setTitle(R.string.privacy_title)
                .setView(messageView)
                .setPositiveButton(R.string.action_agree) { _, _ -> onPrivacyAccepted() }
                .setNegativeButton(R.string.action_disagree) { _, _ -> showPrivacyDialog(firstStep = false) }
        } else {
            builder
                .setTitle(R.string.privacy_required_title)
                .setMessage(R.string.privacy_required_message)
                .setPositiveButton(R.string.action_agree) { _, _ -> onPrivacyAccepted() }
                .setNegativeButton(R.string.action_exit) { _, _ -> finish() }
        }
        builder.show()
    }

    private fun privacyMessage(): CharSequence {
        val raw = getString(R.string.privacy_message)
        val spannable = SpannableString(raw)
        val linkColor = ContextCompat.getColor(this, R.color.brand_link)
        val links = listOf(
            getString(R.string.privacy_terms_label) to TERMS_URL,
            getString(R.string.privacy_privacy_label) to PRIVACY_URL,
        )
        for ((label, url) in links) {
            val start = raw.indexOf(label)
            if (start < 0) continue
            spannable.setSpan(
                object : ClickableSpan() {
                    override fun onClick(widget: View) {
                        ExternalNavigator.openCustomTab(this@MainActivity, url)
                    }

                    override fun updateDrawState(ds: TextPaint) {
                        ds.color = linkColor
                        ds.setUnderlineText(false)
                    }
                },
                start,
                start + label.length,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
        }
        return spannable
    }

    private fun onPrivacyAccepted() {
        PrivacyConsent.accept(this)
        startWebLayer()
    }

    // ---------------------------------------------------------------- WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(view: WebView) {
        val settings = view.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.safeBrowsingEnabled = true
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = true
        settings.setGeolocationEnabled(false)
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.userAgentString = settings.userAgentString +
            " ChugaoApp/${BuildConfig.VERSION_NAME} (Android; ${BuildConfig.VERSION_CODE})"

        // 网站自带深色模式，关闭 WebView 的强制反色
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
        }

        view.setBackgroundColor(ContextCompat.getColor(this, R.color.window_background))
        view.webViewClient = AppWebViewClient(this)
        view.webChromeClient = AppChromeClient(this)
        view.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
            onDownloadRequest(url, userAgent, contentDisposition, mimeType, contentLength)
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, false)
        }
    }

    private fun startWebLayer() {
        if (webView != null || isFinishing || isDestroyed) return
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val created = WebView(this)
        configureWebView(created)
        webContainer.addView(
            created,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        webView = created

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                created,
                NativeBridge.JS_OBJECT_NAME,
                setOf(NativeBridge.ALLOWED_ORIGIN),
                bridge,
            )
        }

        val saved = pendingState
        pendingState = null
        val restored = saved != null && created.restoreState(saved) != null
        if (!restored) created.loadUrl(BuildConfig.BASE_URL)
    }

    private fun retryLoad() {
        hideError()
        val view = webView ?: run {
            startWebLayer()
            return
        }
        val current = view.url
        if (current.isNullOrBlank()) view.loadUrl(BuildConfig.BASE_URL) else view.reload()
    }

    private fun showError(offline: Boolean) {
        errorIcon.setImageResource(if (offline) R.drawable.ic_cloud_off else R.drawable.ic_error_outline)
        errorTitle.setText(if (offline) R.string.error_offline_title else R.string.error_generic_title)
        errorMessage.setText(if (offline) R.string.error_offline_message else R.string.error_generic_message)
        errorView.isVisible = true
    }

    private fun hideError() {
        errorView.isVisible = false
    }

    private fun scheduleStartupUpdateCheck() {
        if (startupUpdateChecked || !PrivacyConsent.hasAccepted(this)) return
        startupUpdateChecked = true
        lifecycleScope.launch {
            delay(STARTUP_UPDATE_DELAY_MS)
            updateManager.check(manual = false)
        }
    }

    // ------------------------------------------------------- WebShellHost

    override fun onProgressChanged(progress: Int) {
        if (progress >= 100) {
            progressBar.setProgressCompat(100, false)
            progressBar.isVisible = false
            return
        }
        progressBar.isVisible = true
        progressBar.setProgressCompat(progress.coerceIn(0, 100), false)
    }

    override fun onPageStartedMain(url: String?) {
        mainFrameFailed = false
        hideError()
        progressBar.isVisible = true
        progressBar.setProgressCompat(0, false)
    }

    override fun onPageFinishedMain(url: String?) {
        progressBar.isVisible = false
        if (!mainFrameFailed) hideError()
        if (!homeLoaded) {
            homeLoaded = true
            scheduleStartupUpdateCheck()
        }
    }

    override fun onMainFrameError() {
        mainFrameFailed = true
        progressBar.isVisible = false
        showError(detectOffline())
    }

    override fun showFileChooser(
        callback: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams,
    ): Boolean {
        // 同一个 WebView 同时只允许一个未完成的文件选择
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = callback

        val mimeTypes = resolveMimeTypes(params.acceptTypes?.toList().orEmpty())
        val imagesOnly = mimeTypes.isNotEmpty() && mimeTypes.all { it.startsWith("image/") }
        val multiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        return try {
            when {
                imagesOnly && multiple -> pickImages.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )

                imagesOnly -> pickImage.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )

                multiple -> openMultipleDocuments.launch(mimeTypes.toTypedArray())
                else -> openSingleDocument.launch(mimeTypes.toTypedArray())
            }
            true
        } catch (e: Exception) {
            pendingFileCallback = null
            callback.onReceiveValue(null)
            false
        }
    }

    private fun deliverFileChoice(uris: List<Uri>?) {
        val callback = pendingFileCallback ?: return
        pendingFileCallback = null
        callback.onReceiveValue(if (uris.isNullOrEmpty()) null else uris.toTypedArray())
    }

    private fun resolveMimeTypes(acceptTypes: List<String>): List<String> {
        val resolved = LinkedHashSet<String>()
        for (raw in acceptTypes) {
            val value = raw.trim()
            if (value.isEmpty()) continue
            when {
                value.startsWith(".") -> MimeTypeMap.getSingleton()
                    .getMimeTypeFromExtension(value.removePrefix(".").lowercase())
                    ?.let { resolved.add(it) }

                value.contains('/') -> resolved.add(value)
                else -> MimeTypeMap.getSingleton()
                    .getMimeTypeFromExtension(value.lowercase())
                    ?.let { resolved.add(it) }
            }
        }
        if (resolved.isEmpty()) resolved.add("*/*")
        return resolved.toList()
    }

    override fun requestPopupWindow(
        view: WebView,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        // window.open 只在真实用户手势下放行
        if (!isUserGesture) return false

        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false

        val popup = WebView(this)
        popup.settings.apply {
            // 临时窗口只用来捕获目标地址，不需要执行任何脚本
            javaScriptEnabled = false
            domStorageEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
        }

        var handled = false
        fun consume(url: String?) {
            if (handled) return
            val target = url?.trim().orEmpty()
            if (target.isEmpty() || target.startsWith("about:", ignoreCase = true)) return
            handled = true
            navigateFromPopup(target)
            runCatching { popup.destroy() }
        }

        popup.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                val target = request.url?.toString()
                if (target.isNullOrBlank() || target.startsWith("about:", ignoreCase = true)) return false
                consume(target)
                return true
            }

            @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
            override fun shouldOverrideUrlLoading(v: WebView, url: String?): Boolean {
                if (url.isNullOrBlank() || url.startsWith("about:", ignoreCase = true)) return false
                consume(url)
                return true
            }

            override fun onPageStarted(v: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                consume(url)
            }
        }

        popup.webChromeClient = object : WebChromeClient() {
            override fun onCloseWindow(window: WebView) {
                handled = true
                runCatching { window.destroy() }
            }
        }

        transport.webView = popup
        resultMsg.sendToTarget()

        // 充值流程是先打开 about:blank 再 location.replace(payUrl)，轮询兜底捕获最终地址
        val startedAt = SystemClock.elapsedRealtime()
        handler.post(object : Runnable {
            override fun run() {
                if (handled) return
                val current = runCatching { popup.url }.getOrNull()
                if (!current.isNullOrBlank() && !current.startsWith("about:", ignoreCase = true)) {
                    consume(current)
                    return
                }
                if (SystemClock.elapsedRealtime() - startedAt > POPUP_TIMEOUT_MS) {
                    handled = true
                    runCatching { popup.destroy() }
                    return
                }
                handler.postDelayed(this, POPUP_POLL_MS)
            }
        })
        return true
    }

    private fun navigateFromPopup(url: String) {
        when (val decision = UrlPolicy.decide(url)) {
            UrlDecision.InApp -> webView?.loadUrl(url)
            is UrlDecision.ExternalBrowser -> ExternalNavigator.openCustomTab(this, decision.url)
            is UrlDecision.ExternalApp -> ExternalNavigator.startExternalApp(
                this,
                decision.scheme,
                decision.url,
            )

            is UrlDecision.AppIntent -> {
                when (val outcome = ExternalNavigator.handleIntentUri(this, decision.url)) {
                    ExternalNavigator.Outcome.Consumed -> Unit
                    is ExternalNavigator.Outcome.Navigate -> webView?.loadUrl(outcome.url)
                }
            }

            UrlDecision.AllowAboutBlank, UrlDecision.Blocked -> Unit
        }
    }

    override fun onDownloadRequest(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
        contentLength: Long,
    ) {
        if (!UrlPolicy.isSameOrigin(url)) {
            ExternalNavigator.openCustomTab(this, url)
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            enqueueDownload(url, userAgent, contentDisposition, mimeType)
            return
        }
        lifecycleScope.launch {
            if (requestWritePermissionIfNeeded()) {
                enqueueDownload(url, userAgent, contentDisposition, mimeType)
            } else {
                toast(R.string.toast_permission_denied)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun enqueueDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        val manager = getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager ?: run {
            toast(R.string.toast_download_failed)
            return
        }
        val guessed = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType)
        val fileName = FileNames.sanitize(guessed, ".bin")
        val folder = getString(R.string.download_folder_name)
        try {
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(fileName)
                setDescription(getString(R.string.app_name))
                setMimeType(mimeType)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "$folder/$fileName")
                setAllowedOverMetered(true)
                setAllowedOverRoaming(false)
                CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                userAgent?.takeIf { it.isNotBlank() }?.let { addRequestHeader("User-Agent", it) }
            }
            manager.enqueue(request)
            toast(R.string.toast_download_started)
        } catch (e: Exception) {
            toast(R.string.toast_download_failed)
        }
    }

    override fun interceptLocalRequest(request: WebResourceRequest): WebResourceResponse? {
        if (request.method != "GET") return null
        val url = request.url ?: return null
        if (!UrlPolicy.isSameOrigin(url.toString())) return null
        val path = url.path ?: return null
        if (!path.startsWith(LocalStore.URL_PREFIX)) return null
        return store.buildResponse(path.removePrefix(LocalStore.URL_PREFIX))
    }

    // ---------------------------------------------------------- BridgeHost

    override fun userAgent(): String = webView?.settings?.userAgentString.orEmpty()

    override fun localStore(): LocalStore = store

    override fun openExternal(url: String): Boolean =
        ExternalNavigator.openCustomTab(this, url)

    override suspend fun checkForUpdate(manual: Boolean): UpdateCheckResult =
        updateManager.check(manual)

    override suspend fun ensureLegacyWritePermission(): Boolean = requestWritePermissionIfNeeded()

    override suspend fun saveImageToGallery(url: String, filename: String?): Boolean {
        if (!requestWritePermissionIfNeeded()) {
            throw BridgeException(BridgeException.FORBIDDEN, "storage permission denied")
        }
        return gallerySaver.save(url, filename, userAgent())
    }

    private suspend fun requestWritePermissionIfNeeded(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return true
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return true
        }
        return suspendCancellableCoroutine { continuation ->
            permissionContinuation = continuation
            continuation.invokeOnCancellation {
                if (permissionContinuation === continuation) permissionContinuation = null
            }
            try {
                writePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            } catch (e: Exception) {
                permissionContinuation = null
                continuation.resume(false)
            }
        }
    }

    // ------------------------------------------------------------- 网络状态

    private fun detectOffline(): Boolean {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network = manager.activeNetwork ?: return true
        val capabilities = manager.getNetworkCapabilities(network) ?: return true
        return !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun registerNetworkMonitor() {
        if (networkCallback != null) return
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    if (errorView.isVisible) retryLoad()
                }
            }
        }
        connectivityManager = manager
        networkCallback = callback
        runCatching { manager.registerDefaultNetworkCallback(callback) }
    }

    private fun unregisterNetworkMonitor() {
        val manager = connectivityManager
        val callback = networkCallback
        connectivityManager = null
        networkCallback = null
        if (manager != null && callback != null) {
            runCatching { manager.unregisterNetworkCallback(callback) }
        }
    }

    private fun toast(resId: Int) {
        Toast.makeText(this, resId, Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val SPLASH_MAX_MS = 3_000L
        const val DOUBLE_BACK_MS = 2_000L
        const val POPUP_TIMEOUT_MS = 20_000L
        const val POPUP_POLL_MS = 200L
        const val STARTUP_UPDATE_DELAY_MS = 3_000L
        const val MAX_PICK_IMAGES = 50
        const val KEY_WEBVIEW_STATE = "webview_state"
        const val TERMS_URL = "https://chugao.art/legal/terms"
        const val PRIVACY_URL = "https://chugao.art/legal/privacy"
    }
}
