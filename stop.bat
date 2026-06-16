@echo off
rem ===== KPI Companion: stop local backend/frontend started from this folder =====
cd /d "%~dp0"

if not exist "%~dp0scripts\stop-local.ps1" (
    echo [!] Khong tim thay scripts\stop-local.ps1
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-local.ps1" -ProjectRoot "%~dp0"

if /i not "%~1"=="--from-start" (
    echo.
    echo Da dung cac process local cua KPI Companion.
    pause
)
