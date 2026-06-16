param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'SilentlyContinue'
$project = (Resolve-Path $ProjectRoot).Path.TrimEnd('\')
$self = $PID
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$self").ParentProcessId
$skip = @($self, $parent)

$names = @('cmd.exe', 'python.exe', 'pythonw.exe', 'node.exe', 'npm.cmd', 'esbuild.exe')
$targets = Get-CimInstance Win32_Process |
    Where-Object {
        (
            $_.CommandLine -like "*$project*" -or
            $_.CommandLine -like "*uvicorn app.main:app*--port 8000*" -or
            $_.CommandLine -like "*vite*bin*vite.js*"
        ) -and
        $_.ProcessId -notin $skip -and
        $_.Name -in $names
    } |
    Sort-Object ProcessId -Unique

if ($targets.Count -gt 0) {
    Write-Host "[stop] Dang dung process cu trong project:"
    $targets | ForEach-Object {
        Write-Host ("  - {0} {1}" -f $_.ProcessId, $_.Name)
        Stop-Process -Id $_.ProcessId -Force
    }
    Start-Sleep -Seconds 1
} else {
    Write-Host "[stop] Khong thay process cu cua project."
}

$ports = @(8000, 5173)
foreach ($port in $ports) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen
    foreach ($listener in $listeners) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($proc -and (
            $proc.CommandLine -like "*$project*" -or
            $proc.CommandLine -like "*uvicorn app.main:app*--port $port*" -or
            $proc.CommandLine -like "*vite*bin*vite.js*"
        )) {
            Write-Host ("[stop] Port {0} van bi giu boi {1} {2}; dung tiep." -f $port, $proc.ProcessId, $proc.Name)
            Stop-Process -Id $proc.ProcessId -Force
        } elseif ($proc) {
            Write-Host ("[warn] Port {0} dang bi process ngoai project giu: {1} {2}" -f $port, $proc.ProcessId, $proc.Name)
        }
    }
}
