package com.sumizomeee.melodio

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    /** 素材导入目录：选择文件夹后复制到这里的文件，经 /import/ 路径提供给页面 */
    private val importDir by lazy { File(filesDir, "import") }

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/import/", WebViewAssetLoader.InternalStoragePathHandler(this, importDir))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterImmersiveMode()

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(0xFF000000.toInt())
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                setSupportMultipleWindows(false)
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    filePathCallback: ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams
                ): Boolean {
                    pendingFileCallback = filePathCallback
                    return try {
                        startActivityForResult(
                            Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                .addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),
                            REQUEST_PICK_TREE
                        )
                        true
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to open folder picker", e)
                        filePathCallback.onReceiveValue(null)
                        pendingFileCallback = null
                        Toast.makeText(this@MainActivity, "无法打开文件夹选择器", Toast.LENGTH_SHORT).show()
                        false
                    }
                }
            }
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: android.webkit.WebResourceRequest
                ) = assetLoader.shouldInterceptRequest(request.url)
            }
        }
        setContentView(webView)

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        // 已导入过素材（files/import/album.json 存在）→ 直接进入导入专辑；否则进入内置专辑库
        val url = if (File(importDir, "album.json").exists()) {
            "https://appassets.androidplatform.net/assets/www/index.html?imported=1&performance=auto"
        } else {
            "https://appassets.androidplatform.net/assets/www/index.html"
        }
        webView.loadUrl(url)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_PICK_TREE) return
        val callback = pendingFileCallback
        pendingFileCallback = null
        val treeUri = data?.data
        if (resultCode == RESULT_OK && treeUri != null) {
            try {
                contentResolver.takePersistableUriPermission(
                    treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (e: Exception) {
                Log.w(TAG, "takePersistableUriPermission failed", e)
            }
            thread {
                try {
                    copyImportedFiles(treeUri)
                    runOnUiThread {
                        Toast.makeText(this, "素材导入完成", Toast.LENGTH_SHORT).show()
                        webView.loadUrl(
                            "https://appassets.androidplatform.net/assets/www/index.html?imported=1&performance=auto"
                        )
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Import failed", e)
                    runOnUiThread {
                        Toast.makeText(this, "导入失败：${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
        callback?.onReceiveValue(null)
    }

    /** 把用户选择的文件夹复制到应用私有目录 import/，供 WebView 以 /import/ 读取 */
    private fun copyImportedFiles(treeUri: Uri) {
        if (importDir.exists()) importDir.deleteRecursively()
        importDir.mkdirs()
        val audioExts = setOf("mp3", "wav", "flac", "ogg", "m4a", "aac", "opus")
        val imageExts = setOf("jpg", "jpeg", "png", "webp", "gif", "avif", "bmp")
        var audioCount = 0
        var imageCount = 0
        copyTree(treeUri, null, "", audioExts, imageExts) { isAudio, isImage ->
            if (isAudio) audioCount++ else if (isImage) imageCount++
        }
        Log.i(TAG, "Import complete: $audioCount audio, $imageCount images")
        if (audioCount == 0) throw IllegalStateException("文件夹中没有音频文件（mp3/wav/flac/ogg/m4a）")
    }

    /** 递归枚举目录树并复制音频/图片/album.json（保留中文文件名与子目录结构） */
    private fun copyTree(
        treeUri: Uri,
        childDocId: String?,
        relativePath: String,
        audioExts: Set<String>,
        imageExts: Set<String>,
        onCopied: (isAudio: Boolean, isImage: Boolean) -> Unit
    ) {
        val queryDocId = childDocId ?: DocumentsContract.getTreeDocumentId(treeUri)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, queryDocId)
        contentResolver.query(
            childrenUri,
            arrayOf("document_id", "_display_name", "mime_type"),
            null, null, null
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow("document_id")
            val nameCol = cursor.getColumnIndexOrThrow("_display_name")
            val mimeCol = cursor.getColumnIndexOrThrow("mime_type")
            while (cursor.moveToNext()) {
                val childId = cursor.getString(idCol)
                val name = cursor.getString(nameCol) ?: continue
                val mime = cursor.getString(mimeCol) ?: ""
                val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childId)
                if (mime == "vnd.android.document/directory") {
                    copyTree(treeUri, childId, relativePath + name + "/", audioExts, imageExts, onCopied)
                } else {
                    val ext = name.substringAfterLast('.', "").lowercase()
                    val isAlbumJson = name.equals("album.json", ignoreCase = true)
                    val isAudio = audioExts.contains(ext)
                    val isImage = imageExts.contains(ext)
                    if (!isAlbumJson && !isAudio && !isImage) continue
                    val target = File(importDir, relativePath + name)
                    target.parentFile?.mkdirs()
                    contentResolver.openInputStream(docUri)?.use { input ->
                        FileOutputStream(target).use { output -> input.copyTo(output) }
                        if (!isAlbumJson) onCopied(isAudio, isImage)
                    }
                }
            }
        }
    }

    private fun enterImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            val script = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_RIGHT,
                KeyEvent.KEYCODE_MEDIA_NEXT -> "window.Melodio?.next()"
                KeyEvent.KEYCODE_DPAD_LEFT,
                KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "window.Melodio?.previous()"
                KeyEvent.KEYCODE_SPACE,
                KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "window.Melodio?.togglePlay()"
                KeyEvent.KEYCODE_DPAD_UP -> "window.Melodio?.setSkin('stamp')"
                KeyEvent.KEYCODE_DPAD_DOWN -> "window.Melodio?.setSkin('glass')"
                else -> null
            }
            if (script != null) {
                webView.evaluateJavascript(script, null)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        webView.evaluateJavascript(
            "document.fullscreenElement ? document.exitFullscreen() : null",
            null
        )
    }

    override fun onDestroy() {
        webView.loadUrl("about:blank")
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "Melodio"
        private const val REQUEST_PICK_TREE = 1001
    }
}
