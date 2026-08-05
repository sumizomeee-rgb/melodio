# Melodio · 专辑现场展示器

完全离线、横屏、沉浸式的专辑试听与视觉展示 App(Android WebView + H5/Web Audio)。
内置专辑《錦夢痕》《梦寻未来》,支持文件夹导入新专辑。

## 目录结构

```text
melodio/
├─ app/                           Android 应用工程(Kotlin WebView 壳 + 内置 H5)
│  └─ src/main/assets/www/        H5 核心(index.html / app.js / styles.css / config.js)
│     └─ assets/audio/            内置音频(本地管理,不入库 —— 见下方说明)
│     └─ assets/images/           内置封面(入库)
├─ web/                           H5 开发预览副本(浏览器直接打开 index.html 可调试)
├─ tools/cdp/                     CDP 调试辅助脚本(连接模拟器 WebView 调试端口)
├─ output/apk/                    APK 交付产物(不入库)
├─ local/                         全部本地不入库内容
│  ├─ materials/                  现场导入物料(专辑素材 + album.json + README)
│  └─ archive/                    交接期文档归档
└─ reference/                     设计参考(原始视觉原型)
```

## Git 管理边界

| 入库 | 不入库(gitignore) |
|---|---|
| 全部源码、H5、封面图片、web/、tools/、reference/、构建脚本 | `app/build/`、`local.properties`、`output/`、`local/`(含 materials/)、**音频素材**(`assets/audio/`) |

> 音频不入库是刻意的:素材会持续增大,统一走本地 `local/materials/` 管理。
> 克隆仓库后如需完整构建 APK,需从本地 `local/materials/` 或旧包中取回音频放回 `assets/audio/`。

## 构建

```bash
# 环境(详见 G:\Android\README.md)
export JAVA_HOME="/g/Program Files/Java/jdk-17.0.4"
export GRADLE_USER_HOME="/g/Android/gradle-home"
cd /g/SuchProject/Other/melodio
/g/Android/gradle-8.9/bin/gradle assembleDebug --no-daemon
# 产物: app/build/outputs/apk/debug/app-debug.apk → 复制到 output/apk/
```

## 功能

- 双内置专辑 + 启动专辑选择总览;控制面板「专辑」按钮随时切换
- 「＋ 导入新专辑」:系统文件夹选择器 → 复制素材到私有目录 → 自动载入(重启持久)
- 底部控制面板默认隐藏,点左下/右下隐形热区显隐
- 三套皮肤、旋转黑胶、Web Audio 频谱、蓝牙键盘/媒体键控制
- 完全离线,不加载任何网络资源

## 现场设备导入

`local/materials/README.md` 有完整的素材格式与导入说明(曲目命名规则、album.json 映射、设备导入方法)。
