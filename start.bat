@echo off
rem ===== KPI Companion: double-click de chay (backend :8000 + frontend :5173) =====
cd /d "%~dp0"

if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env" >nul
    echo [!] Da tao backend\.env tu mau - HAY DIEN LLM_API_KEY truoc khi dung chat AI.
)

echo [1/3] Khoi dong backend tai http://127.0.0.1:8000 ...
start "KPI Companion - Backend" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

echo [2/3] Khoi dong frontend tai http://localhost:5173 ...
start "KPI Companion - Frontend" cmd /k "cd /d "%~dp0frontend" && set "Path=C:\Program Files\nodejs;%Path%" && npm run dev"

echo [3/3] Doi 5 giay roi mo trinh duyet ...
timeout /t 5 /nobreak >nul
start "" http://localhost:5173

echo.
echo  KPI Companion dang chay:
echo    - Giao dien:  http://localhost:5173
echo    - API docs:   http://127.0.0.1:8000/docs
echo  Dung tat 2 cua so "KPI Companion - Backend/Frontend" khi dang su dung!
echo.
pause
