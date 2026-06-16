@echo off
rem ===== KPI Companion: clean restart =====
cd /d "%~dp0"
call "%~dp0stop.bat" --from-start
call "%~dp0start.bat" --no-stop
