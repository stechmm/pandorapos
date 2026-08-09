@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Please install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'http://localhost:4173/api/index.php?action=status' -TimeoutSec 1 | Out-Null; $ready=$true } catch { $ready=$false }; if (-not $ready) { Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0'; Start-Sleep -Seconds 2 }; Start-Process 'http://localhost:4173'"

echo Pandora POS is starting...
echo.
echo Cashier PC URL:
echo   http://localhost:4173
echo.
echo Phone/Tablet URL:
for /f "tokens=14" %%a in ('ipconfig ^| findstr /i "IPv4"') do echo   http://%%a:4173
echo.
echo Keep this window only if you want to see the URL. You may close it after the browser opens.
pause
