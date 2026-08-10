@echo off
setlocal
cd /d "%~dp0"

echo Restarting Pandora POS local server...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4173" ^| findstr "LISTENING"') do (
  echo Stopping process %%p on port 4173...
  taskkill /PID %%p /F >nul 2>nul
)

timeout /t 1 /nobreak >nul

start "Pandora POS Server" /min node server.js
timeout /t 2 /nobreak >nul

start "" "http://localhost:4173"
echo Done. Pandora POS should open in the browser.
endlocal
