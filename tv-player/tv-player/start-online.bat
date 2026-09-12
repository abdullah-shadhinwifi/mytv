@echo off
title MyTV - Online (Free Tunnel)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js paoa jacchena.
    echo  https://nodejs.org theke LTS install kore abar chalan.
    echo.
    pause
    exit /b
)

echo  Starting local MyTV server on http://localhost:8080
echo  (sarver-er ekta alada window khulbe - sekhane admin password-o dekhabe)
echo.
start "MyTV Server" cmd /k node server.js
timeout /t 3 /nobreak >nul

echo.
echo  ============================================================
echo   EKHON FREE PUBLIC LINK TORI HOCHE...
echo   Screen-e "your url is: https://xxx.loca.lt" ba
echo   "https://xxx.trycloudflare.com" lekha url-ta kopi kore
echo   je kew jekono jaiga theke khulte parbe!
echo   (Band korte: ei window ta Close korun)
echo  ============================================================
echo.

where cloudflared >nul 2>nul
if %errorlevel%==0 (
    echo  [cloudflared paoa geche - using it]
    cloudflared tunnel --url http://localhost:8080
) else (
    echo  [localtunnel use hocche - node/NPM dorkar, internet thakte hobe]
    npx -y localtunnel --port 8080
)
echo.
echo  Tunnel bondho. Server window-ta-o close kore din.
pause
