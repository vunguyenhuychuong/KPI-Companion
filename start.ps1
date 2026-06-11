# Khoi dong KPI Companion: backend (port 8000) + frontend (port 5173)
$root = $PSScriptRoot

if (-not (Test-Path "$root\backend\.env")) {
    Copy-Item "$root\backend\.env.example" "$root\backend\.env"
    Write-Host "Da tao backend\.env tu mau — DIEN LLM_API_KEY truoc khi dung chat!" -ForegroundColor Yellow
}

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$root\backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$root\frontend'; `$env:Path = 'C:\Program Files\nodejs;' + `$env:Path; npm run dev"

Start-Sleep -Seconds 4
Start-Process "http://localhost:5173"
Write-Host "KPI Companion dang chay: http://localhost:5173 (UI) | http://127.0.0.1:8000/docs (API)" -ForegroundColor Green
