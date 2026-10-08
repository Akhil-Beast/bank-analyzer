# launch_persistent.ps1
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Launching BankAnalyzer as Persistent Windows Services" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# Stop old listeners if any
$ports = @(8000, 3000)
foreach ($p in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            $pidToKill = $c.OwningProcess
            if ($pidToKill -and $pidToKill -gt 0) {
                Write-Host "Freeing port $p (PID $pidToKill)..." -ForegroundColor Yellow
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Start-Sleep -Seconds 1

# Launch Backend & Frontend as top-level independent Windows processes (Minimized)
$bPath = "D:\bank software\backend\run_backend.bat"
$fPath = "D:\bank software\frontend\run_frontend.bat"

Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$bPath`"" -WindowStyle Minimized
Write-Host "[1/2] Backend launched!" -ForegroundColor Green

Start-Sleep -Seconds 2

Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$fPath`"" -WindowStyle Minimized
Write-Host "[2/2] Frontend launched!" -ForegroundColor Green

Start-Sleep -Seconds 5

Write-Host ""
Write-Host "Port Status:" -ForegroundColor Cyan
Get-NetTCPConnection -LocalPort 8000, 3000 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess, State | Format-Table
