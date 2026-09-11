@echo off
title MyTV Channel Player
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js paoa jacchena!
    echo  Doya kore https://nodejs.org theke Node.js LTS version install korun,
    echo  tarpor abar ei file ta double-click korun.
    echo.
    pause
    exit /b
)

echo  Starting MyTV on http://localhost:8080
echo  (close this window to stop the server)
echo.
node server.js
pause
