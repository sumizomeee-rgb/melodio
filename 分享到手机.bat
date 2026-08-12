@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if not errorlevel 1 (
  python tools\share_phone.py
  if errorlevel 1 pause
  exit /b %errorlevel%
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 tools\share_phone.py
  if errorlevel 1 pause
  exit /b %errorlevel%
)

echo [错误] 未找到 Python 3。请先安装 Python，再重新双击本脚本。
pause
exit /b 1
