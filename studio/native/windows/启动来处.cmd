@echo off
setlocal
set "ROOT=%~dp0"
set "CANVAS_RUNTIME=%ROOT%runtime"
set "CANVAS_USER_DATA=%ROOT%profile"
set "CANVAS_DEV_URL="
set "ELECTRON_RUN_AS_NODE="
set "PYTHONNOUSERSITE=1"
set "PYTHONUTF8=1"
if not exist "%ROOT%profile" mkdir "%ROOT%profile"
start "" "%ROOT%来处.exe" "%ROOT%app\studio\dist-native\main.cjs"
