@echo off
rem ===== KPI Companion: double-click de chay (backend :8000 + frontend :5173) =====
cd /d "%~dp0"

if /i not "%~1"=="--no-stop" (
    echo [0/4] Don process cu cua KPI Companion ...
    call "%~dp0stop.bat" --from-start
)

if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env" >nul
    echo [!] Da tao backend\.env tu mau - HAY DIEN LLM_API_KEY truoc khi dung chat AI.
)

echo [1/4] Khoi dong backend tai http://127.0.0.1:8000 ...
start "KPI Companion - Backend" cmd /k call "%~dp0scripts\run-backend.bat"

echo [2/4] Cho backend san sang ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-url.ps1" -Label "Backend /api/health" -Url "http://127.0.0.1:8000/api/health" -TimeoutSeconds 60
if errorlevel 1 (
    echo.
    echo [!] Backend chua san sang. Xem cua so "KPI Companion - Backend" de biet loi.
    echo     Frontend se KHONG duoc mo de tranh loi Vite proxy ECONNREFUSED.
    echo.
    pause
    exit /b 1
)

echo [3/4] Khoi dong frontend tai http://localhost:5173 ...
start "KPI Companion - Frontend" cmd /k call "%~dp0scripts\run-frontend.bat"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-url.ps1" -Label "Frontend localhost:5173" -Url "http://localhost:5173" -TimeoutSeconds 45

echo [4/4] Doi 2 giay roi mo trinh duyet ...
timeout /t 2 /nobreak >nul
start "" http://localhost:5173

echo.
echo  KPI Companion dang chay:
echo    - Giao dien:  http://localhost:5173
echo    - API health: http://127.0.0.1:8000/api/health
echo  Muon restart sach: chay restart.bat
echo  Muon dung het: chay stop.bat
echo.
pause
