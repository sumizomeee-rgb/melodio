@echo off
setlocal

rem Always build from the project root, even when launched from Explorer.
cd /d "%~dp0"

echo [1/3] Syncing web assets...
where python >nul 2>nul
if not errorlevel 1 (
    python tools\sync_web.py
) else (
    where py >nul 2>nul
    if errorlevel 1 (
        echo ERROR: Python was not found. Install Python or add it to PATH.
        exit /b 2
    )
    py -3 tools\sync_web.py
)
if errorlevel 1 (
    echo ERROR: Failed to sync web assets.
    exit /b 1
)

rem Prefer the Gradle Wrapper when it is complete, then an installed Gradle,
rem then the local Gradle 8.9 layout used by this development machine.
set "GRADLE_CMD="
if exist "gradlew.bat" if exist "gradle\wrapper\gradle-wrapper.jar" set "GRADLE_CMD=%CD%\gradlew.bat"

if not defined GRADLE_CMD (
    where gradle.bat >nul 2>nul
    if not errorlevel 1 set "GRADLE_CMD=gradle.bat"
)

if not defined GRADLE_CMD if defined GRADLE_HOME if exist "%GRADLE_HOME%\bin\gradle.bat" set "GRADLE_CMD=%GRADLE_HOME%\bin\gradle.bat"
if not defined GRADLE_CMD if defined GRADLE_USER_HOME if exist "%GRADLE_USER_HOME%\..\gradle-8.9\bin\gradle.bat" set "GRADLE_CMD=%GRADLE_USER_HOME%\..\gradle-8.9\bin\gradle.bat"
if not defined GRADLE_CMD if exist "G:\Android\gradle-8.9\bin\gradle.bat" set "GRADLE_CMD=G:\Android\gradle-8.9\bin\gradle.bat"

if not defined GRADLE_CMD (
    echo ERROR: Gradle was not found.
    echo Install Gradle 8.9, set GRADLE_HOME, or generate the Gradle Wrapper.
    exit /b 2
)

echo [2/3] Building debug APK...
call "%GRADLE_CMD%" --no-daemon clean assembleDebug
if errorlevel 1 (
    echo ERROR: Gradle build failed.
    exit /b 1
)

set "SOURCE_APK=%CD%\app\build\outputs\apk\debug\app-debug.apk"
set "OUTPUT_DIR=%CD%\output\apk"
set "OUTPUT_APK=%OUTPUT_DIR%\melodio-debug.apk"

if not exist "%SOURCE_APK%" (
    echo ERROR: Gradle completed but the APK was not found:
    echo        %SOURCE_APK%
    exit /b 1
)

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
copy /y "%SOURCE_APK%" "%OUTPUT_APK%" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy the APK to the output directory.
    exit /b 1
)

echo [3/3] Build complete.
echo APK: %OUTPUT_APK%
echo SHA256:
certutil -hashfile "%OUTPUT_APK%" SHA256

exit /b 0
