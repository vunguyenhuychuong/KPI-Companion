param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSeconds = 60
)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$lastError = ""

while ((Get-Date) -lt $deadline) {
    try {
        $status = (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3).StatusCode
        if ($status -ge 200 -and $status -lt 500) {
            Write-Host ("    {0}: {1}" -f $Label, $status)
            exit 0
        }
        $lastError = "HTTP $status"
    } catch {
        $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
}

Write-Host ("    {0}: timeout ({1})" -f $Label, $lastError)
exit 1
