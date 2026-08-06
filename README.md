# Melodio

完全离线的横屏专辑试听 / 视觉展示 App（Android WebView 壳 + 内置 H5 / Web Audio）。
为「把一张专辑放给人听」这件事做的：满屏曲绘、旋转黑胶、音频驱动的频谱与动效，控制面板可一键隐藏，适合现场投屏或直接录屏。

**不内置任何专辑。** APK 只有 2.6MB，专辑在安装后通过文件夹导入设备。

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
│  └─ src/main/assets/www/        打进 APK 的 H5（index.html / app.js / styles.css）
├─ web/                           H5 开发副本，浏览器直接打开 index.html 即可调试
├─ tools/                         调试与回归脚本（见下）
├─ output/apk/                    APK 交付产物（不入库）
├─ local/                         全部本地内容（不入库）：现场素材、归档文档
└─ reference/                     设计参考（原始视觉原型）
```

`web/` 与 `app/src/main/assets/www/` 是同一份 H5，改完 `web/` 下的文件后跑 `python tools/sync_web.py` 同步进 APK（只同步 `index.html` / `app.js` / `styles.css` 三个运行时文件）。

**素材一律不入库、不打进 APK。** 音频与封面放在 `local/`（已 gitignore），只在设备侧导入。

## 构建

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

| 脚本 | 用途 |
|---|---|
| `tools/range_check.py` | **Range/seek 回归**：逐字节校验各偏移返回的数据是否正确；`edge` 模式跑边界用例 |
| `tools/cdp_test.py seek` | 连续拖动进度条压测，验证松手后 UI 与音频同步 |
| `tools/cdp_test.py switch` | 曲目跳切压测，量 rAF 最大帧间隔 |
| `tools/cdp/` | 通用小工具：求值、注入文件、校验曲目、点击坐标 |

**改动 `MainActivity.handleRangeRequest` 后务必跑 `python tools/range_check.py`。** 这条路径踩过一个隐蔽的坑：WebView 会依据你返回的 `Content-Range` 自行丢弃前 `start` 字节，所以拦截器返回的流必须**从 0 字节开始**，不能自己 `skip(start)` —— 两边都 skip 会让数据实际来自 `2×start`，前半段只是声音错位，过半后越过文件尾就报 `PIPELINE_ERROR_READ` 并永久卡死在 `seeking`（症状是「歌播到一半停死」，极易误判成 H5 的 seek 逻辑问题）。详见该函数上方注释。

## 性能取舍

Android 上自动进入移动档（`?performance=` 可强制）：频谱 32 段、目标 30fps、CSS 更新降频、dpr 上限收到 1、渲染尺度可自适应下探。

导入阶段会把曲绘统一压成 1800px 封面 + 640px 背景 WebP —— 现场素材常是 5044×5044 这种大图，原图每次换图要重解码 200~450ms，切歌动画中途必掉帧；压过之后解码约 98ms。注意 WebView 91 上 `createImageBitmap` 的 `imageOrientation: "from-image"` 会抛 `TypeError`，代码里是先探测能力再决定是否传该选项。
