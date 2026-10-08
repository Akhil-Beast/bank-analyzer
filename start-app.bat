@echo off
title BankAnalyzer Launcher
echo ===================================================
echo     Starting BankAnalyzer System
echo ===================================================

cd /d "%~dp0backend"
echo [1/3] Starting Python FastAPI Backend on port 8000...
start "BankAnalyzer Backend (Port 8000)" cmd /k "call .\venv\Scripts\activate.bat && uvicorn main:app --host 0.0.0.0 --port 8000"

timeout /t 3 /nobreak > nul

cd /d "%~dp0frontend"
echo [2/3] Starting Next.js Frontend on port 3000...
start "BankAnalyzer Frontend (Port 3000)" cmd /k "npm run dev"

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
