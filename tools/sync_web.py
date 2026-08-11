#!/usr/bin/env python3
"""把 web/ 的 H5 源同步进 APK assets。

只同步运行时真正需要的文件。不要用 copytree 整目录复制 ——
web/ 里还有 README.md / start.bat / start.command / example-album.json
这些纯开发期文件，整目录复制会把它们重新打进 APK（v0.5.15 已专门清理过）。
"""
from pathlib import Path
import shutil

RUNTIME_FILES = (
    "index.html",
    "app.js",
    "styles.css",
    "album-library.js",
    "mobile-polish.css",
)
# 历史上被 copytree 误打进 APK 的开发期文件，同步时顺手清掉
STALE_FILES = ("README.md", "start.bat", "start.command", "example-album.json", "config.js")

root = Path(__file__).resolve().parents[1]
src = root / "web"
dst = root / "app" / "src" / "main" / "assets" / "www"
dst.mkdir(parents=True, exist_ok=True)

for name in RUNTIME_FILES:
    shutil.copy2(src / name, dst / name)
    print(f"  {name}")

# 清掉历史上误同步进去的开发期文件（只删白名单，避免误伤本地素材目录）
for name in STALE_FILES:
    stale = dst / name
    if stale.is_file():
        stale.unlink()
        print(f"  removed stale: {name}")

print(f"Synced {src} -> {dst}")
