@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%runtime\python\python.exe" (
  echo The runtime is missing. Keep the whole folder together and run this again.
  pause
  exit /b 1
)
"%ROOT%runtime\python\python.exe" -X utf8 "%ROOT%app\studio\native\windows\self-test.py" "%ROOT%"
set "CODE=%ERRORLEVEL%"
cscript //nologo "%ROOT%ensure-shortcut.vbs" "%ROOT%"
echo.
echo Report: %ROOT%检查结果.txt
pause
exit /b %CODE%
