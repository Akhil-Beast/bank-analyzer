@echo off
title BankAnalyzer Backend
cd /d "%~dp0"
"%~dp0venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
