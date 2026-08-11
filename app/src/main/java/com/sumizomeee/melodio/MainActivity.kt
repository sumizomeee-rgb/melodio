package com.sumizomeee.melodio

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.JavascriptInterface
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
import java.io.FileInputStream
import java.io.FileOutputStream
import kotlin.concurrent.thread

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    /** v0.5.x 单专辑目录；首次启动新版时迁移进 albums/，之后不再直接使用。 */
    private val legacyImportDir by lazy { File(filesDir, "import") }

    /** 多专辑库。每张专辑一个独立子目录，页面仍通过动态 /import/ 兼容路径访问当前专辑。 */
    private val albumsRoot by lazy { File(filesDir, "albums") }
    private val activeAlbumIdFile by lazy { File(filesDir, ".active-album") }
    private val emptyAlbumDir by lazy { File(filesDir, ".empty-album") }
    private val artworkCacheDir by lazy { File(cacheDir, "artwork") }
    private val artworkCacheLock = Any()

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterImmersiveMode()
        migrateLegacyImportIfNeeded()
        ensureActiveAlbum()

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
                    val isImagePick = fileChooserParams.mode == FileChooserParams.MODE_OPEN
                        && fileChooserParams.acceptTypes.any { it.startsWith("image/", ignoreCase = true) }
                    return try {
                        if (isImagePick) {
                            startActivityForResult(
                                Intent(Intent.ACTION_OPEN_DOCUMENT)
                                    .addCategory(Intent.CATEGORY_OPENABLE)
                                    .setType("image/*")
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                                REQUEST_PICK_INFO_IMAGE
                            )
                        } else {
                            startActivityForResult(
                                Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    .addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),
                                REQUEST_PICK_TREE
                            )
                        }
                        true
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to open file picker", e)
                        filePathCallback.onReceiveValue(null)
                        pendingFileCallback = null
                        Toast.makeText(this@MainActivity, "无法打开选择器", Toast.LENGTH_SHORT).show()
                        false
                    }
                }
            }
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: android.webkit.WebResourceRequest
                ): android.webkit.WebResourceResponse? {
                    val url = request.url
                    val urlText = url.toString()
                    if (urlText.startsWith(LIBRARY_LIST_URL)) {
                        return jsonResponse(buildLibraryJson())
                    }
                    if (urlText.startsWith(LIBRARY_SWITCH_URL)) {
                        val id = url.getQueryParameter("id")
                        if (id != null && setActiveAlbumId(id)) {
                            return jsonResponse(buildLibraryJson())
                        }
                        return textResponse("album not found", 404, "Not Found")
                    }
                    if (urlText.startsWith(LIBRARY_DELETE_URL)) {
                        val id = url.getQueryParameter("id")
                        if (id.isNullOrBlank()) return textResponse("missing id", 400, "Bad Request")
                        if (!deleteAlbum(id)) return textResponse("album not found", 404, "Not Found")
                        return jsonResponse(buildLibraryJson())
                    }
                    if (urlText.startsWith(LIBRARY_COVER_URL)) {
                        val id = url.getQueryParameter("id") ?: return textResponse("missing id", 400, "Bad Request")
                        val dir = albumDirById(id) ?: return textResponse("album not found", 404, "Not Found")
                        val cover = findAlbumCover(dir) ?: return textResponse("cover not found", 404, "Not Found")
                        return fileResponse(cover)
                    }

                    if (urlText.startsWith(IMPORT_DELETE_URL)) {
                        activeAlbumId()?.let { deleteAlbum(it) }
                        return textResponse("ok")
                    }
                    if (urlText.startsWith(IMPORT_LIST_URL)) {
                        return jsonResponse(buildActiveAlbumListingJson())
                    }
                    if (urlText.startsWith(IMPORT_INFO_DELETE_URL)) {
                        val dir = activeAlbumDir()
                        if (dir.exists()) {
                            dir.listFiles { it.name.startsWith("__info__.", ignoreCase = true) }
                                ?.forEach { it.delete() }
                        }
                        return textResponse("ok")
                    }

                    handleRangeRequest(request)?.let { return it }
                    serveActiveAlbumFile(request)?.let { return it }
                    return assetLoader.shouldInterceptRequest(request.url)
                }
            }
            addJavascriptInterface(NativeAlbumBridge(), "MelodioNative")
        }
        setContentView(webView)

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        val hasImportedAudio = activeAlbumDir().walkTopDown()
            .any { it.isFile && it.extension.lowercase() in AUDIO_EXTS }
        val url = if (hasImportedAudio) {
            "https://appassets.androidplatform.net/assets/www/index.html?imported=1&performance=auto"
        } else {
            "https://appassets.androidplatform.net/assets/www/index.html"
        }
        webView.loadUrl(url)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val callback = pendingFileCallback
        pendingFileCallback = null
        when (requestCode) {
            REQUEST_PICK_TREE -> {
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
                    val displayName = queryTreeDisplayName(treeUri)?.trim().orEmpty().ifBlank { "导入专辑" }
                    thread {
                        var targetDir: File? = null
                        try {
                            val importedDir = createAlbumDir()
                            targetDir = importedDir
                            copyImportedFiles(treeUri, importedDir)
                            File(importedDir, ".meta").writeText("""{"title":"${escapeJson(displayName)}"}""")
                            importedDir.setLastModified(System.currentTimeMillis())
                            setActiveAlbumId(importedDir.name)
                            runOnUiThread {
                                Toast.makeText(this, "已加入专辑库", Toast.LENGTH_SHORT).show()
                                webView.loadUrl(
                                    "https://appassets.androidplatform.net/assets/www/index.html?imported=1&performance=auto"
                                )
                            }
                        } catch (e: Exception) {
                            targetDir?.deleteRecursively()
                            Log.e(TAG, "Import failed", e)
                            runOnUiThread {
                                Toast.makeText(this, "导入失败：${e.message}", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                }
            }
            REQUEST_PICK_INFO_IMAGE -> {
                val uri = data?.data
                if (resultCode == RESULT_OK && uri != null) {
                    thread {
                        try {
                            val dir = activeAlbumDir()
                            dir.mkdirs()
                            dir.listFiles { it.name.startsWith("__info__.", ignoreCase = true) }
                                ?.forEach { it.delete() }
                            val mime = contentResolver.getType(uri) ?: "image/jpeg"
                            val ext = when (mime) {
                                "image/jpeg" -> "jpg"
                                "image/png" -> "png"
                                "image/webp" -> "webp"
                                "image/gif" -> "gif"
                                "image/avif" -> "avif"
                                "image/bmp" -> "bmp"
                                else -> "jpg"
                            }
                            val target = File(dir, "__info__.$ext")
                            contentResolver.openInputStream(uri)?.use { input ->
                                FileOutputStream(target).use { output -> input.copyTo(output) }
                            }
                            runOnUiThread {
                                webView.evaluateJavascript(
                                    "window.Melodio&&window.Melodio.refreshInfoImage&&window.Melodio.refreshInfoImage()",
                                    null
                                )
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Info image copy failed", e)
                            runOnUiThread {
                                Toast.makeText(this, "信息图保存失败", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        }
        callback?.onReceiveValue(null)
    }

    /**
     * 处理媒体 Range 请求（bytes=start-end），返回 206 + Content-Range，使 H5 进度条 seek 生效。
     * 流本身必须从 0 开始，不能自己 skip 到 start；WebView 会依据 Content-Range 自行丢弃前 start 字节。
     */
    private fun handleRangeRequest(request: android.webkit.WebResourceRequest): android.webkit.WebResourceResponse? {
        val rangeHeader = request.requestHeaders?.get("Range") ?: return null
        val path = request.url.path ?: return null
        val assetPath = if (path.startsWith("/assets/")) path.removePrefix("/assets/") else null
        val filePath = if (path.startsWith("/import/")) path.removePrefix("/import/") else null
        if (assetPath == null && filePath == null) return null

        val m = RANGE_PATTERN.matchEntire(rangeHeader.trim()) ?: return null
        val start = m.groupValues[1].toLongOrNull() ?: return null

        val length: Long
        val open: () -> java.io.InputStream
        try {
            if (assetPath != null) {
                length = assets.openFd(assetPath).use { it.length }
                open = { assets.open(assetPath) }
            } else {
                val file = safeAlbumFile(activeAlbumDir(), filePath!!) ?: return null
                if (!file.exists() || !file.isFile) return null
                length = file.length()
                open = { FileInputStream(file) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Range: cannot size $path", e)
            return null
        }

        if (length <= 0L || start >= length) return null
        var end = m.groupValues[2].toLongOrNull() ?: (length - 1)
        end = end.coerceIn(start, length - 1)

        val input = try {
            open()
        } catch (e: Exception) {
            Log.w(TAG, "Range: cannot open $path", e)
            return null
        }

        return android.webkit.WebResourceResponse(
            MIME_MAP[path.substringAfterLast('.').lowercase()] ?: "application/octet-stream",
            null,
            206,
            "Partial Content",
            mapOf(
                "Content-Range" to "bytes $start-$end/$length",
                "Accept-Ranges" to "bytes",
                "Content-Length" to (end - start + 1).toString()
            ),
            BoundedInputStream(input, end + 1)
        )
    }

    private fun serveActiveAlbumFile(request: android.webkit.WebResourceRequest): android.webkit.WebResourceResponse? {
        val path = request.url.path ?: return null
        if (!path.startsWith("/import/")) return null
        val relativePath = path.removePrefix("/import/")
        // /import/ 是完全本地的命名空间。缺失的可选 album.json 如果返回 null，
        // WebView 会尝试访问真实域名，离线时可能让专辑启动永久等待。
        if (relativePath.isBlank()) return textResponse("not found", 404, "Not Found")
        val file = safeAlbumFile(activeAlbumDir(), relativePath)
            ?: return textResponse("not found", 404, "Not Found")
        if (!file.isFile) return textResponse("not found", 404, "Not Found")
        return fileResponse(file)
    }

    private inner class NativeAlbumBridge {
        @JavascriptInterface
        fun readLocalJson(path: String): String {
            return when (path.substringBefore('?')) {
                "/import/__list__" -> buildActiveAlbumListingJson()
                "/import/album.json" -> {
                    val file = safeAlbumFile(activeAlbumDir(), "album.json")
                    if (file?.isFile == true && file.length() <= 2L * 1024L * 1024L) {
                        runCatching { file.readText(Charsets.UTF_8) }.getOrDefault("")
                    } else ""
                }
                else -> ""
            }
        }

        @JavascriptInterface
        fun readLibraryJson(): String = buildLibraryJson()

        @JavascriptInterface
        fun switchAlbum(id: String): Boolean = setActiveAlbumId(id)

        @JavascriptInterface
        fun deleteAlbumFromLibrary(id: String): String {
            if (!deleteAlbum(id)) return ""
            return buildLibraryJson()
        }
    }

    private fun buildActiveAlbumListingJson(): String {
        val dir = activeAlbumDir()
        val files = if (dir.exists()) {
            dir.walkTopDown()
                .filter { it.isFile }
                .map { it.relativeTo(dir).path.replace('\\', '/') }
                .toList()
        } else emptyList()
        return buildString {
            append("{\"title\":\"").append(escapeJson(readMetaTitle(dir) ?: "")).append("\",\"files\":[")
            append(files.joinToString(",") { "\"" + escapeJson(it) + "\"" })
            append("]}")
        }
    }

    private fun fileResponse(file: File): android.webkit.WebResourceResponse {
        val servedFile = optimizedArtworkFile(file) ?: file
        val ext = servedFile.extension.lowercase()
        val mime = MIME_MAP[ext] ?: if (ext == "json") "application/json" else "application/octet-stream"
        val encoding = if (mime.startsWith("text/") || mime == "application/json") "utf-8" else null
        return android.webkit.WebResourceResponse(
            mime,
            encoding,
            200,
            "OK",
            mapOf(
                "Content-Length" to servedFile.length().toString(),
                "Accept-Ranges" to "bytes",
                "Cache-Control" to "no-cache"
            ),
            FileInputStream(servedFile)
        )
    }

    /** 旧 WebView 解码 30–40 MB PNG 可能耗时数分钟；原生生成并复用 1800px JPEG。 */
    private fun optimizedArtworkFile(source: File): File? {
        val ext = source.extension.lowercase()
        if (ext !in IMAGE_EXTS || ext in setOf("gif", "svg", "avif") ||
            source.name.startsWith("__info__.", ignoreCase = true)
        ) return null

        return synchronized(artworkCacheLock) {
            try {
                val key = buildString {
                    append(source.canonicalPath.hashCode().toUInt().toString(16))
                    append('-').append(source.length())
                    append('-').append(source.lastModified())
                }
                artworkCacheDir.mkdirs()
                // 部分模拟器的 WebView 91 无法稳定读取 Android 生成的 WebP，改用兼容性更好的 JPEG。
                val cached = File(artworkCacheDir, "$key.jpg")
                if (cached.isFile && cached.length() > 0L) return@synchronized cached

                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(source.absolutePath, bounds)
                val longest = maxOf(bounds.outWidth, bounds.outHeight)
                if (longest <= 0 || longest <= ARTWORK_MAX_SIDE) return@synchronized null

                var sample = 1
                while (longest / sample > ARTWORK_DECODE_SIDE) sample *= 2
                val options = BitmapFactory.Options().apply {
                    inSampleSize = sample
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                val decoded = BitmapFactory.decodeFile(source.absolutePath, options)
                    ?: return@synchronized null
                val scale = ARTWORK_MAX_SIDE.toFloat() / maxOf(decoded.width, decoded.height)
                val width = maxOf(1, (decoded.width * scale).toInt())
                val height = maxOf(1, (decoded.height * scale).toInt())
                val resized = if (scale < 1f) Bitmap.createScaledBitmap(decoded, width, height, true) else decoded
                if (resized !== decoded) decoded.recycle()

                val temporary = File(artworkCacheDir, "$key.tmp")
                FileOutputStream(temporary).use { output ->
                    if (!resized.compress(Bitmap.CompressFormat.JPEG, 92, output)) {
                        throw IllegalStateException("JPEG compression failed")
                    }
                }
                resized.recycle()
                if (!temporary.renameTo(cached)) {
                    temporary.copyTo(cached, overwrite = true)
                    temporary.delete()
                }
                cached.takeIf { it.length() > 0L }
            } catch (e: Exception) {
                Log.w(TAG, "Artwork optimization failed: ${source.name}", e)
                null
            }
        }
    }

    private fun textResponse(
        text: String,
        status: Int = 200,
        reason: String = "OK"
    ): android.webkit.WebResourceResponse {
        val bytes = text.toByteArray(Charsets.UTF_8)
        return android.webkit.WebResourceResponse(
            "text/plain",
            "utf-8",
            status,
            reason,
            mapOf(
                "Content-Length" to bytes.size.toString(),
                "Cache-Control" to "no-store"
            ),
            java.io.ByteArrayInputStream(bytes)
        )
    }

    private fun jsonResponse(json: String): android.webkit.WebResourceResponse {
        val bytes = json.toByteArray(Charsets.UTF_8)
        // WebView 91 对六参数合成 JSON 响应可能只返回响应头、正文永久等待；
        // 基础构造器可以可靠地为内存流发送 EOF。
        return android.webkit.WebResourceResponse(
            "application/json",
            "utf-8",
            java.io.ByteArrayInputStream(bytes)
        )
    }

    private class BoundedInputStream(
        private val delegate: java.io.InputStream,
        private val limit: Long
    ) : java.io.InputStream() {
        private var position = 0L

        override fun read(): Int {
            if (position >= limit) return -1
            val b = delegate.read()
            if (b >= 0) position++
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (position >= limit) return -1
            val allowed = minOf(len.toLong(), limit - position).toInt()
            if (allowed <= 0) return -1
            val n = delegate.read(b, off, allowed)
            if (n > 0) position += n
            return n
        }

        override fun skip(n: Long): Long {
            val allowed = minOf(n, limit - position)
            if (allowed <= 0) return 0
            val skipped = delegate.skip(allowed)
            if (skipped > 0) position += skipped
            return skipped
        }

        override fun available(): Int = minOf(delegate.available().toLong(), limit - position).toInt()
        override fun close() = delegate.close()
    }

    private fun listAlbumDirs(): List<File> {
        albumsRoot.mkdirs()
        return albumsRoot.listFiles()
            ?.filter { it.isDirectory && it.name.startsWith("album-") }
            ?.sortedWith(compareBy<File> { it.lastModified() }.thenBy { it.name })
            ?: emptyList()
    }

    private fun albumDirById(id: String): File? {
        if (!ALBUM_ID_PATTERN.matches(id)) return null
        val dir = File(albumsRoot, id)
        return dir.takeIf { it.isDirectory }
    }

    private fun activeAlbumId(): String? {
        val stored = runCatching { activeAlbumIdFile.readText().trim() }.getOrNull().orEmpty()
        return stored.takeIf { it.isNotBlank() && albumDirById(it) != null }
    }

    private fun activeAlbumDir(): File {
        val id = activeAlbumId() ?: ensureActiveAlbum()
        return if (id != null) File(albumsRoot, id) else emptyAlbumDir.apply { mkdirs() }
    }

    private fun ensureActiveAlbum(): String? {
        activeAlbumId()?.let { return it }
        val first = listAlbumDirs().firstOrNull()?.name ?: run {
            activeAlbumIdFile.delete()
            return null
        }
        activeAlbumIdFile.writeText(first)
        return first
    }

    private fun setActiveAlbumId(id: String): Boolean {
        if (albumDirById(id) == null) return false
        activeAlbumIdFile.writeText(id)
        return true
    }

    private fun createAlbumDir(): File {
        albumsRoot.mkdirs()
        var suffix = 0
        while (true) {
            val id = buildString {
                append("album-").append(System.currentTimeMillis())
                if (suffix > 0) append('-').append(suffix)
            }
            val dir = File(albumsRoot, id)
            if (dir.mkdir()) return dir
            suffix++
        }
    }

    private fun deleteAlbum(id: String): Boolean {
        val dir = albumDirById(id) ?: return false
        val wasActive = activeAlbumId() == id
        if (!dir.deleteRecursively()) return false
        if (wasActive) {
            activeAlbumIdFile.delete()
            ensureActiveAlbum()
        }
        return true
    }

    private fun buildLibraryJson(): String {
        val current = ensureActiveAlbum().orEmpty()
        val albums = listAlbumDirs()
        return buildString {
            append("{\"currentId\":\"").append(escapeJson(current)).append("\",\"albums\":[")
            albums.forEachIndexed { index, dir ->
                if (index > 0) append(',')
                val title = readMetaTitle(dir).orEmpty().ifBlank { dir.name }
                val count = dir.walkTopDown().count { it.isFile && it.extension.lowercase() in AUDIO_EXTS }
                val cover = findAlbumCover(dir)
                append("{\"id\":\"").append(escapeJson(dir.name))
                    .append("\",\"title\":\"").append(escapeJson(title))
                    .append("\",\"trackCount\":").append(count)
                    .append(",\"cover\":")
                if (cover != null) {
                    append("\"/library/__cover__?id=").append(escapeJson(dir.name))
                        .append("&v=").append(cover.lastModified()).append("\"")
                } else {
                    append("\"\"")
                }
                append('}')
            }
            append("]}")
        }
    }

    private fun findAlbumCover(dir: File): File? {
        val images = dir.walkTopDown()
            .filter { it.isFile && it.extension.lowercase() in IMAGE_EXTS && !it.name.startsWith("__info__.", ignoreCase = true) }
            .toList()
        return images.firstOrNull { it.nameWithoutExtension.equals("cover", ignoreCase = true) }
            ?: images.sortedBy { it.relativeTo(dir).path.lowercase() }.firstOrNull()
    }

    private fun migrateLegacyImportIfNeeded() {
        if (!legacyImportDir.isDirectory) return
        val hasAudio = legacyImportDir.walkTopDown().any { it.isFile && it.extension.lowercase() in AUDIO_EXTS }
        if (!hasAudio) return
        albumsRoot.mkdirs()
        val target = createAlbumDir()
        try {
            if (!legacyImportDir.renameTo(target)) {
                legacyImportDir.copyRecursively(target, overwrite = true)
                legacyImportDir.deleteRecursively()
            }
            target.setLastModified(System.currentTimeMillis())
            setActiveAlbumId(target.name)
            Log.i(TAG, "Migrated legacy import -> ${target.name}")
        } catch (e: Exception) {
            target.deleteRecursively()
            Log.e(TAG, "Legacy import migration failed", e)
        }
    }

    private fun safeAlbumFile(root: File, relativePath: String): File? {
        return try {
            val rootPath = root.canonicalFile
            val file = File(root, relativePath).canonicalFile
            if (file.path == rootPath.path || file.path.startsWith(rootPath.path + File.separator)) file else null
        } catch (_: Exception) {
            null
        }
    }

    private fun copyImportedFiles(treeUri: Uri, targetDir: File) {
        targetDir.mkdirs()
        var audioCount = 0
        var imageCount = 0
        copyTree(treeUri, null, "", targetDir, AUDIO_EXTS, IMAGE_EXTS) { isAudio, isImage ->
            if (isAudio) audioCount++ else if (isImage) imageCount++
        }
        Log.i(TAG, "Import complete: $audioCount audio, $imageCount images -> ${targetDir.name}")
        if (audioCount == 0) throw IllegalStateException("文件夹中没有音频文件（mp3/wav/flac/ogg/m4a）")
    }

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

    private fun readMetaTitle(dir: File): String? {
        return try {
            File(dir, ".meta").readText()
                .let { text -> Regex("\"title\"\\s*:\\s*\"([^\"]*)\"").find(text)?.groupValues?.get(1) }
        } catch (_: Exception) {
            null
        }
    }

    private fun escapeJson(s: String) = s
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")

    private fun copyTree(
        treeUri: Uri,
        childDocId: String?,
        relativePath: String,
        targetRoot: File,
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
                    copyTree(treeUri, childId, relativePath + name + "/", targetRoot, audioExts, imageExts, onCopied)
                } else {
                    val ext = name.substringAfterLast('.', "").lowercase()
                    val isAlbumJson = name.equals("album.json", ignoreCase = true)
                    val isAudio = audioExts.contains(ext)
                    val isImage = imageExts.contains(ext)
                    if (!isAlbumJson && !isAudio && !isImage) continue
                    val target = safeAlbumFile(targetRoot, relativePath + name) ?: continue
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
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
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
            "window.Melodio?.closeInfoViewer?.() || (document.fullscreenElement ? document.exitFullscreen() : null)",
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
        private const val REQUEST_PICK_INFO_IMAGE = 1002
        private const val IMPORT_DELETE_URL = "https://appassets.androidplatform.net/import/__delete__"
        private const val IMPORT_LIST_URL = "https://appassets.androidplatform.net/import/__list__"
        private const val IMPORT_INFO_DELETE_URL = "https://appassets.androidplatform.net/import/__info-delete__"
        private const val ARTWORK_MAX_SIDE = 1800
        private const val ARTWORK_DECODE_SIDE = 2600
        private const val LIBRARY_LIST_URL = "https://appassets.androidplatform.net/library/__list__"
        private const val LIBRARY_SWITCH_URL = "https://appassets.androidplatform.net/library/__switch__"
        private const val LIBRARY_DELETE_URL = "https://appassets.androidplatform.net/library/__delete__"
        private const val LIBRARY_COVER_URL = "https://appassets.androidplatform.net/library/__cover__"
        private val AUDIO_EXTS = setOf("mp3", "wav", "flac", "ogg", "m4a", "aac", "opus")
        private val IMAGE_EXTS = setOf("jpg", "jpeg", "png", "webp", "gif", "avif", "bmp")
        private val ALBUM_ID_PATTERN = Regex("""album-[A-Za-z0-9._-]+""")
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
            "gif" to "image/gif",
            "avif" to "image/avif",
            "bmp" to "image/bmp",
            "svg" to "image/svg+xml",
            "json" to "application/json"
        )
    }
}
