#!/usr/bin/env bash
set -euo pipefail
APK="${1:-app/build/outputs/apk/debug/app-debug.apk}"
PKG="com.sumizomeee.melodio"
ACT="$PKG/.MainActivity"
OUT="${2:-verification}"
mkdir -p "$OUT"
adb install -r "$APK" | tee "$OUT/install.txt"
adb logcat -c
adb shell am force-stop "$PKG"
adb shell am start -W -n "$ACT" | tee "$OUT/launch.txt"
sleep 10
adb shell pidof "$PKG" | tee "$OUT/pid.txt"
test -s "$OUT/pid.txt"
adb logcat -d -t 1200 > "$OUT/logcat.txt"
if grep -E "FATAL EXCEPTION|Process: $PKG" "$OUT/logcat.txt" > "$OUT/fatal.txt"; then
  cat "$OUT/fatal.txt"
  exit 1
fi
adb exec-out screencap -p > "$OUT/melodio-player.png"
sha256sum "$APK" | tee "$OUT/sha256.txt"
echo "Verification passed. Review $OUT/melodio-player.png manually."
