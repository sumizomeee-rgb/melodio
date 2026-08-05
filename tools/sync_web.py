#!/usr/bin/env python3
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
src = root / "web"
dst = root / "app" / "src" / "main" / "assets" / "www"
if dst.exists():
    shutil.rmtree(dst)
shutil.copytree(src, dst)
print(f"Synced {src} -> {dst}")
