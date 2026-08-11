# Melodio

完全离线的横屏专辑试听 / 视觉展示 App（Android WebView 壳 + 内置 H5 / Web Audio）。
为「把一张专辑放给人听」这件事做的：满屏曲绘、旋转黑胶、音频驱动的频谱与动效，控制面板可一键隐藏，适合现场投屏或直接录屏。

**不内置任何专辑。** APK 只有 2.6MB，专辑在安装后通过文件夹导入设备。

## 新 Chat / Agent 开工前必读

下面不是通用 Android 规则，而是这个项目在**雷电模拟器 + Android WebView 91** 上实测得到的兼容契约。新会话修改代码前应先读完本节；不能只在桌面 Chrome 中看起来正常，就认为 APK 已可交付。

### H5 源码与构建产物

- `web/` 是 H5 的唯一源码；`app/src/main/assets/www/` 是打包镜像，不要只改后者。
- 修改 H5 后运行 `python tools/sync_web.py`。当前同步白名单是 `index.html`、`app.js`、`styles.css`、`album-library.js`、`mobile-polish.css`；新增运行时文件时必须同时更新该脚本。
- Windows 上从项目根目录运行 `build.bat`。唯一约定的交付 APK 是 `output/apk/melodio-debug.apk`，不要让用户在 Gradle 中间目录里猜哪个包才是最新的。

### WebView 91 与本地数据通道

- APK 内不是普通网站环境。旧 WebView 对 Kotlin `shouldInterceptRequest` 返回的合成 `WebResourceResponse` 存在兼容问题：请求日志可能已完成，但 JS 侧 `fetch(...).json()` 仍会一直等待。
- 因此 Android 中读取 `/import/album.json`、`/import/__list__` 必须优先走 `window.MelodioNative.readLocalJson(path)`；读取专辑库必须优先走 `readLibraryJson()`，切换和删除专辑分别走 `switchAlbum(id)`、`deleteAlbumFromLibrary(id)`。
- `fetch('/library/__list__')` 等 HTTP 形式仅是**普通浏览器调试的 fallback**，不是 APK 主通道。以后新增控制类 JSON 接口，必须同时提供 Native Bridge，或在目标模拟器上证明合成响应不会挂起。
- 新增 `@JavascriptInterface` 时只暴露窄接口，并在 Kotlin 端校验参数；不能为了方便开放任意文件读取。
- `/import/*` 不存在时要返回本地 404，不能返回 `null`，否则 WebView 会尝试访问真实网络域名。

### 已踩过的死循环与卡死陷阱

- `MutationObserver` 如果监听 `class`，又在回调里修改同一元素的 `class`，会形成无限微任务循环并把 WebView CPU 打满。必须用 `attributeOldValue: true` 判断状态边沿，确保只在 `is-active` 真正发生变化时触发动画。
- Android 切换专辑时不要等待隐藏大图的 `Image.decode()`/预加载完成后才释放 `state.transitioning`。先完成状态切换并恢复交互，让可见图片异步加载。
- `image.decode()`、`createImageBitmap()` 及其参数在旧 WebView 上都要做能力检测和超时兜底，不能按现代 Chrome 的行为假设。
- 首屏不应在用户手势前打开或预加载 WAV；第一次点击播放时再准备音频，避免启动阶段争抢解码和 I/O。

### 性能约束

- Android 默认是真正的低开销档：频谱 24 段、目标 20fps、DPR 上限 0.75、初始渲染尺度 0.72，并用定时节流的 `requestAnimationFrame`。这些值是目标模拟器上的实测结果，不要因为桌面预览不够华丽而直接调回高档。
- 不要在产品代码或测量前遗留持续运行的诊断 rAF 循环。`python tools/cdp_test.py switch` 会临时安装帧探针；运行该压测时看到的高占用不能代表正常播放占用。性能验收须在重启 App 后、不运行该探针的正常播放状态下单独测量。
- 导入图片由原生侧生成最长边 1800px 的 JPEG 缓存，切换时不要重新解码 5K 原图或另做一套浏览器端大图预处理。

### 交付前强制回归

1. 运行 `node --check web/app.js`、`node --check web/album-library.js` 和 `git diff --check`。
2. 从根目录运行 `build.bat`，安装它刚生成的 `output/apk/melodio-debug.apk`，不要安装旧路径里的同名历史文件。
3. 在目标设备 `emulator-5554` 上先 `force-stop` 再启动，避免重复启动产生两个 Activity/CDP 页面；确认只有一个可见页面后再调试。
4. 至少验证：首屏能在数秒内进入、首次播放、上一首/下一首、进度拖动、单专辑时左右大按钮可见且能打开总览。改过专辑库时还要用两个真实专辑验证左右切换。
5. 运行 `python tools/cdp_test.py switch`；改过媒体或 seek 逻辑时再运行 `python tools/cdp_test.py seek`。改过 Range 拦截必须运行 `python tools/range_check.py`。
6. 截图只能证明画面存在，不能证明交付完成。最终报告必须说明安装的是哪个 APK，并给出上述真实交互与性能回归结果。

## 安装与使用

1. 从 [Releases](../../releases) 下载 APK 安装（需允许「安装未知应用」）。
2. 把一个装着音频和图片的文件夹拷到设备存储。
3. 打开 App → 「＋ 导入新专辑」→ 选中该文件夹 → 自动复制到私有目录并载入。

导入结果持久化，重启自动回到该专辑。「专辑」按钮返回总览，可重新导入（整体替换）或删除（二次确认）。

### 素材约定

最简单的专辑就是**一个文件夹，里面只放音频和图片，编号前缀对上即可** —— `album.json` 和 `cover` 都不强求。

```text
锦梦痕/
├─ 01 花漪.mp3        ← 界面显示「花漪」，配 01 开头的图
├─ 02 花延奏.mp3
├─ 03 遠地点.mp3
├─ 01 花漪曲绘.jpg
└─ cover.jpg          ← 多余的图自然成为补位封面
```

- 音频：`mp3` `wav` `flac` `ogg` `m4a` `aac` `opus`　图片：`jpg` `png` `webp` `gif` `avif` `bmp`
- **歌名取自音频文件名**：`01 花漪.mp3` → 显示「花漪」，编号前缀只用于排序
- 图片按前缀序号配对（`01 歌名.mp3` ↔ `01 图.jpg`），配不上就顺位取图
- 图片少于歌曲时按**连续章节**分配，而不是 ABAB 循环（5 首 + 2 图 → 前 3 首用图一，后 2 首用图二）
- 专辑名默认取导入时选择的文件夹名

导入后按 `G` 打开「曲目设置」，可逐首改图、逐首设置试听起点（切到该曲时从此处开始，界面计时仍从 `00:00` 显示）。

### album.json（可选）

放在素材文件夹根下，存在时以它为准：

```json
{
  "albumTitle": "专辑名",
  "artist": "艺术家",
  "imagePolicy": "manual",
  "tracks": [
    { "audio": "01 歌名.mp3", "image": "01 曲绘.jpg", "subtitle": "歌词首行", "startAt": 32.5 }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `albumTitle` / `artist` | 专辑名与艺术家 |
| `tracks[].audio` / `.image` | 音频与封面文件名 |
| `tracks[].subtitle` / `.kicker` | 副标题（可放歌词首行）／角标文字 |
| `tracks[].startAt` | 试听起点（秒） |
| `imagePolicy: "manual"` | 严格按 `tracks` 的映射；去掉该字段则自动分配图片 |

`title` 不必填，歌名一律以音频文件名为准。

## 操作

底部控制面板**默认完全隐藏**（为了录屏干净），点**左下角或右下角**的隐形热区显隐。

外接蓝牙键盘时（现场推荐）：

| 键 | 功能 |
|---|---|
| `Space` | 播放 / 暂停 |
| `←` `→` / `A` `D` | 上一首 / 下一首 |
| `↑` `↓` / `[` `]` | 切换视觉皮肤 |
| `R` | 回到当前曲的试听起点 |
| `G` | 曲目设置（改图 / 设起点） |
| `M` | 动效强度：柔和 / 丰富 / 强烈 |
| `H` | 显示 / 隐藏控制面板 |

蓝牙耳机与遥控器的媒体键（播放暂停 / 上一首 / 下一首）也已接上。

三套视觉皮肤：**邮票档案**（纸张网格、邮戳、暖黑胶）、**夜航胶片**（暗场排版、光泄漏、胶片噪点）、**玻璃潮汐**（深色玻璃、流体波形、冷色唱片）。

## 项目结构

```text
melodio/
├─ app/                           Android 工程（Kotlin WebView 壳）
│  ├─ src/main/java/.../MainActivity.kt   资源拦截 / Range / 文件夹导入 / 媒体键
│  └─ src/main/assets/www/        打进 APK 的 H5（由 tools/sync_web.py 白名单同步）
├─ web/                           H5 开发副本，浏览器直接打开 index.html 即可调试
├─ tools/                         调试与回归脚本（见下）
├─ output/apk/                    APK 交付产物（不入库）
├─ local/                         全部本地内容（不入库）：现场素材、归档文档
└─ reference/                     设计参考（原始视觉原型）
```

`web/` 与 `app/src/main/assets/www/` 是同一份 H5，改完 `web/` 下的文件后跑 `python tools/sync_web.py` 同步进 APK（当前只同步 `index.html` / `app.js` / `styles.css` / `album-library.js` / `mobile-polish.css` 五个运行时文件）。

**素材一律不入库、不打进 APK。** 音频与封面放在 `local/`（已 gitignore），只在设备侧导入。

## 构建

Windows 直接在项目根目录双击或运行：

```bat
build.bat
rem 交付产物：output\apk\melodio-debug.apk
```

脚本会先同步 H5，再执行干净构建，并把最终 APK 复制到固定的 `output/apk/` 路径。

其他环境可手动构建：

```bash
export JAVA_HOME="/g/Program Files/Java/jdk-17.0.4"
export GRADLE_USER_HOME="/g/Android/gradle-home"
python tools/sync_web.py
gradle --no-daemon assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

或直接 `./build_debug.sh`（自动同步 H5 + 构建 + 输出 `dist/melodio-debug.apk`）。
`./verify_android.sh <apk>` 做安装冒烟：装包、启动、查进程存活、抓 logcat 崩溃、截图。

- minSdk 26 / targetSdk 35 / Kotlin JVM 17
- 依赖只有 `activity-ktx`、`core-ktx`、`androidx.webkit`；不联网，`usesCleartextTraffic=false`

## 调试与回归

设备侧调试走 CDP：

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.sumizomeee.melodio)
```

启动调试前先结束旧进程再启动一次。不要连续用两种启动命令，否则可能同时留下隐藏 Activity 和多个 CDP target，自动化脚本会连到错误页面。

| 脚本 | 用途 |
|---|---|
| `tools/range_check.py` | **Range/seek 回归**：逐字节校验各偏移返回的数据是否正确；`edge` 模式跑边界用例 |
| `tools/cdp_test.py seek` | 连续拖动进度条压测，验证松手后 UI 与音频同步 |
| `tools/cdp_test.py switch` | 曲目跳切压测，量 rAF 最大帧间隔 |
| `tools/cdp/` | 通用小工具：求值、注入文件、校验曲目、点击坐标 |

**改动 `MainActivity.handleRangeRequest` 后务必跑 `python tools/range_check.py`。** 这条路径踩过一个隐蔽的坑：WebView 会依据你返回的 `Content-Range` 自行丢弃前 `start` 字节，所以拦截器返回的流必须**从 0 字节开始**，不能自己 `skip(start)` —— 两边都 skip 会让数据实际来自 `2×start`，前半段只是声音错位，过半后越过文件尾就报 `PIPELINE_ERROR_READ` 并永久卡死在 `seeking`（症状是「歌播到一半停死」，极易误判成 H5 的 seek 逻辑问题）。详见该函数上方注释。

## 性能取舍

Android 上自动进入移动档（`?performance=` 可强制）：频谱 24 段、目标 20fps、CSS 更新降频、DPR 上限 0.75、初始渲染尺度 0.72，并使用定时节流的 rAF 调度。

导入阶段由原生侧把曲绘统一生成最长边 1800px 的 JPEG 缓存 —— 现场素材常是 5044×5044 这种大图，直接在切歌时反复解码会造成明显卡顿。注意 WebView 91 上 `createImageBitmap` 的 `imageOrientation: "from-image"` 会抛 `TypeError`，凡使用此类新 API 都必须先探测能力并提供兜底。
