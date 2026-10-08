@echo off
title BankAnalyzer Launcher
echo ===================================================
echo     Starting BankAnalyzer System (Persistent)
echo ===================================================

echo [1/3] Starting Python FastAPI Backend on port 8000...
start "BankAnalyzer Backend (Port 8000)" "%~dp0backend\run_backend.bat"

timeout /t 3 /nobreak > nul

echo [2/3] Starting Next.js Frontend on port 3000...
start "BankAnalyzer Frontend (Port 3000)" "%~dp0frontend\run_frontend.bat"

timeout /t 4 /nobreak > nul

echo [3/3] Opening BankAnalyzer in browser...
start http://localhost:3000

echo ===================================================
echo   BankAnalyzer is now running persistently!
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
echo   (Keep the command windows open to keep running)
echo ===================================================
pause
