# web/ · H5 开发副本

这里是 Melodio 的 H5 源。用现代 Chrome / Edge 直接打开 `index.html` 就能调试大部分逻辑（本地文件夹选择、皮肤、频谱、曲目设置都可用）。

改完之后跑一次同步，改动才会进 APK：

```bash
python ../tools/sync_web.py
```

只有 `index.html` / `app.js` / `styles.css` 会被同步；本目录其余文件是纯开发期内容，不打进 APK。

| 文件 | 说明 |
|---|---|
| `index.html` `app.js` `styles.css` | 运行时三件套（会同步进 APK） |
| `example-album.json` | `album.json` 的字段示例 |
| `start.bat` / `start.command` | 起一个 `python -m http.server 8080`，绕开 `file://` 对媒体文件的限制 |

## 与 Android 端的差异

浏览器里走 `File`／`Blob` + `URL.createObjectURL`；Android 端走 `/import/` 资源拦截（`InternalStoragePathHandler` + 自定义 Range）。两侧共用同一套文件名配对与 `album.json` 解析规则，但只有 Android 端会经过 Range 拦截，所以 seek 相关的问题必须在设备上验证（见仓库根 README 的「调试与回归」）。

浏览器里默认走完整画质档；加 `?performance=1` 可强制模拟 Android 的移动档（32 段频谱、30fps、降频 CSS 更新），用来在桌面上复现移动端表现。

素材格式、快捷键、`album.json` 字段说明都在**仓库根目录的 README**，不在这里重复。
