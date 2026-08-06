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
                ): android.webkit.WebResourceResponse? {
                    val url = request.url.toString()
                    // H5 侧的「删除导入专辑」：清空 import 目录并返回 200
                    if (url.startsWith(IMPORT_DELETE_URL)) {
                        importDir.deleteRecursively()
                        return android.webkit.WebResourceResponse(
                            "text/plain",
                            "utf-8",
                            java.io.ByteArrayInputStream("ok".toByteArray())
                        )
                    }
                    // H5 侧「无 album.json 的素材自动配对」：返回 import 目录文件清单 + 专辑名(文件夹名)
                    if (url.startsWith(IMPORT_LIST_URL)) {
                        val files = if (importDir.exists()) {
                            importDir.walkTopDown()
                                .filter { it.isFile }
                                .map { it.relativeTo(importDir).path.replace('\\', '/') }
                                .toList()
                        } else emptyList()
                        val json = buildString {
                            append("{\"title\":\"").append(escapeJson(readMetaTitle() ?: "")).append("\",\"files\":[")
                            append(files.joinToString(",") { "\"" + escapeJson(it) + "\"" })
                            append("]}")
                        }
                        return android.webkit.WebResourceResponse(
                            "application/json",
                            "utf-8",
                            java.io.ByteArrayInputStream(json.toByteArray())
                        )
                    }
                    // 媒体 seek 依赖 HTTP Range 请求，WebViewAssetLoader 不支持 →
                    // 自己处理 /assets/ 与 /import/ 的 Range，返回 206 + Content-Range
                    handleRangeRequest(request)?.let { return it }
                    return assetLoader.shouldInterceptRequest(request.url)
                }
            }
        }
        setContentView(webView)

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        // 已导入过素材(import 目录里有音频)→ 直接进入导入专辑;否则进入欢迎/导入页
        val hasImportedAudio = importDir.exists()
            && importDir.listFiles()?.any { it.isFile && it.extension.lowercase() in AUDIO_EXTS } == true
        val url = if (hasImportedAudio) {
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
                    // 记住所选文件夹名，作为无 album.json 时的专辑名
                    queryTreeDisplayName(treeUri)?.let { name ->
                        File(importDir, ".meta").writeText("""{"title":"${escapeJson(name)}"}""")
                    }
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

    /** 处理媒体 Range 请求（bytes=start-end），返回 206 + Content-Range，使 H5 进度条 seek 生效 */
    private fun handleRangeRequest(request: android.webkit.WebResourceRequest): android.webkit.WebResourceResponse? {
        val rangeHeader = request.requestHeaders?.get("Range") ?: return null
        val path = request.url.path ?: return null
        val assetPath = if (path.startsWith("/assets/")) path.removePrefix("/assets/") else null
        val filePath = if (path.startsWith("/import/")) path.removePrefix("/import/") else null
        if (assetPath == null && filePath == null) return null

        val input: java.io.InputStream
        val length: Long
        try {
            if (assetPath != null) {
                input = assets.open(assetPath)
                length = try { assets.openFd(assetPath).length } catch (e: Exception) { input.available().toLong() }
            } else {
                val file = File(importDir, filePath!!)
                if (!file.exists()) return null
                input = java.io.FileInputStream(file)
                length = file.length()
            }
        } catch (e: Exception) {
            return null
        }

        val m = RANGE_PATTERN.matchEntire(rangeHeader)
        if (m == null) { input.close(); return null }
        val start = m.groupValues[1].toLongOrNull() ?: run { input.close(); return null }
        var end = m.groupValues[2].ifEmpty { "" }.toLongOrNull() ?: (length - 1)
        end = end.coerceAtMost(length - 1)
        if (start > end) { input.close(); return null }

        // 跳转到 start（AssetInputStream.skip 单次可能跳不够，循环跳过）
        var remaining = start
        while (remaining > 0) {
            val skipped = input.skip(remaining)
            if (skipped <= 0) break
            remaining -= skipped
        }
        val contentLength = end - start + 1
        return android.webkit.WebResourceResponse(
            MIME_MAP[path.substringAfterLast('.').lowercase()] ?: "application/octet-stream",
            null,
            206,
            "Partial Content",
            mapOf(
                "Content-Range" to "bytes $start-$end/$length",
                "Accept-Ranges" to "bytes",
                "Content-Length" to contentLength.toString()
            ),
            input
        )
    }

    /** 把用户选择的文件夹复制到应用私有目录 import/，供 WebView 以 /import/ 读取 */
    private fun copyImportedFiles(treeUri: Uri) {
        if (importDir.exists()) importDir.deleteRecursively()
        importDir.mkdirs()
        var audioCount = 0
        var imageCount = 0
        copyTree(treeUri, null, "", AUDIO_EXTS, IMAGE_EXTS) { isAudio, isImage ->
            if (isAudio) audioCount++ else if (isImage) imageCount++
        }
        Log.i(TAG, "Import complete: $audioCount audio, $imageCount images")
        if (audioCount == 0) throw IllegalStateException("文件夹中没有音频文件（mp3/wav/flac/ogg/m4a）")
    }

    /** 查询所选文件夹的显示名（DocumentsUI 树根文档的 _display_name） */
    private fun queryTreeDisplayName(treeUri: Uri): String? {
        return try {
            val docId = DocumentsContract.getTreeDocumentId(treeUri)
            val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
            contentResolver.query(
                docUri,
                arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (e: Exception) {
            Log.w(TAG, "queryTreeDisplayName failed", e)
            null
        }
    }

    /** 读取导入时记住的文件夹名（files/import/.meta），每次现读避免缓存旧值 */
    private fun readMetaTitle(): String? {
        return try {
            File(importDir, ".meta").readText()
                .let { text -> Regex("\"title\"\\s*:\\s*\"([^\"]*)\"").find(text)?.groupValues?.get(1) }
        } catch (e: Exception) {
            null
        }
    }

    private fun escapeJson(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"")

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
                KeyEvent.KEYCODE_DPAD_UP -> "window.Melodio?.cycleSkin(1)"
                KeyEvent.KEYCODE_DPAD_DOWN -> "window.Melodio?.cycleSkin(-1)"
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
        private const val IMPORT_DELETE_URL = "https://appassets.androidplatform.net/import/__delete__"
        private const val IMPORT_LIST_URL = "https://appassets.androidplatform.net/import/__list__"
        private val AUDIO_EXTS = setOf("mp3", "wav", "flac", "ogg", "m4a", "aac", "opus")
        private val IMAGE_EXTS = setOf("jpg", "jpeg", "png", "webp", "gif", "avif", "bmp")
        private val RANGE_PATTERN = Regex("""bytes=(\d+)-(\d*)""")
        private val MIME_MAP = mapOf(
            "mp3" to "audio/mpeg",
            "wav" to "audio/wav",
            "flac" to "audio/flac",
            "ogg" to "audio/ogg",
            "m4a" to "audio/mp4",
            "aac" to "audio/aac",
            "opus" to "audio/ogg",
            "jpg" to "image/jpeg",
            "jpeg" to "image/jpeg",
            "png" to "image/png",
            "webp" to "image/webp",
            "gif" to "image/gif"
        )
    }
}
