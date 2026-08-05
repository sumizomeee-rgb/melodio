#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 tools/sync_web.py
if [[ -x ./gradlew && -f gradle/wrapper/gradle-wrapper.jar ]]; then
  ./gradlew --no-daemon clean assembleDebug
elif command -v gradle >/dev/null 2>&1; then
  gradle --no-daemon clean assembleDebug
else
  echo "Gradle Wrapper JAR is intentionally not bundled in this handoff."
  echo "Run: gradle wrapper --gradle-version 8.9  (or open once in Android Studio), then rerun."
  exit 2
fi
mkdir -p dist
cp app/build/outputs/apk/debug/app-debug.apk dist/melodio-debug.apk
sha256sum dist/melodio-debug.apk
