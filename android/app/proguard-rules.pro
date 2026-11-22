# WebView 消息桥：保证混淆/裁剪后回调仍然可达
-keep class art.chugao.app.bridge.NativeBridge { *; }
-keepclassmembers class art.chugao.app.bridge.NativeBridge { *; }

-keep interface androidx.webkit.WebViewCompat$WebMessageListener { *; }
-keepclassmembers class * implements androidx.webkit.WebViewCompat$WebMessageListener {
    public void onPostMessage(android.webkit.WebView, androidx.webkit.WebMessageCompat, android.net.Uri, boolean, androidx.webkit.JavaScriptReplyProxy);
}

# androidx.webkit 通过反射做特性探测
-keep class androidx.webkit.** { *; }
-dontwarn androidx.webkit.**

# WebViewClient / WebChromeClient 回调由框架调用
-keepclassmembers class art.chugao.app.web.** {
    public *;
}

-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

-dontwarn org.json.**
