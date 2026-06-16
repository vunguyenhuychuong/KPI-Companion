@echo off
set "KPI_COMPANION_ROOT=%~dp0.."
cd /d "%KPI_COMPANION_ROOT%\frontend"
set "Path=C:\Program Files\nodejs;%Path%"
npm run dev
echo.
echo Frontend da dung. Nhan phim bat ky de dong cua so nay.
pause >nul
