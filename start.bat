@echo off
title WebSocket Demo Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Install it first:
  echo   https://nodejs.org   ^(download the LTS installer^)
  echo After installing, close and reopen this window, then run start.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo Installing npm packages ^(one-time^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo ============================================================
echo   MongoDB must be running ^(default: mongodb://127.0.0.1:27017^).
echo   Download: https://www.mongodb.com/try/download/community
echo.
echo   Open this address in your browser ^(Chrome or Edge^):
echo      http://localhost:3000
echo.
echo   Leave this window open while you use the demo.
echo   Press Ctrl+C here to stop the server.
echo ============================================================
echo.
call npm start
pause
