@echo off
set "KPI_COMPANION_ROOT=%~dp0.."
cd /d "%KPI_COMPANION_ROOT%\backend"
"%KPI_COMPANION_ROOT%\backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
echo.
echo Backend da dung. Nhan phim bat ky de dong cua so nay.
pause >nul
