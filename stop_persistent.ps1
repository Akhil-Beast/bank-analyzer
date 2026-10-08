# stop_persistent.ps1
# Stops any processes running on port 8000 (Backend) and port 3000 (Frontend)

Write-Host "Stopping BankAnalyzer servers..." -ForegroundColor Yellow

$ports = @(8000, 3000)
foreach ($p in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            $pidToKill = $c.OwningProcess
            if ($pidToKill -and $pidToKill -gt 0) {
                Write-Host "Stopping process $pidToKill on port $p..." -ForegroundColor Green
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            }
        }
    } else {
        Write-Host "Port $p is already free." -ForegroundColor Gray
    }
}

Write-Host "Done! All servers stopped." -ForegroundColor Green
