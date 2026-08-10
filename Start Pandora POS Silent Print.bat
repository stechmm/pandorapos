@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=node"
if exist "%~dp0node.exe" set "NODE_EXE=%~dp0node.exe"

where "%NODE_EXE%" >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Please install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'http://localhost:4173/api/index.php?action=status' -TimeoutSec 1 | Out-Null; $ready=$true } catch { $ready=$false }; if (-not $ready) { Start-Process -WindowStyle Hidden -FilePath '%NODE_EXE%' -ArgumentList 'server.js' -WorkingDirectory '%~dp0'; Start-Sleep -Seconds 2 }"

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if not defined BROWSER (
  echo Chrome or Edge was not found. Open http://localhost:4173 manually.
  pause
  exit /b 1
)

start "Pandora POS Silent Print" "%BROWSER%" --kiosk-printing --new-window "http://localhost:4173"

echo Pandora POS opened with silent kiosk printing.
echo.
echo Important:
echo   Windows default printer should be Pandora XP-58.
echo   Cut paper should stay OFF in Pandora POS printer settings.
echo.
pause
endlocal
