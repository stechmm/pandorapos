@echo off
setlocal
title Pandora POS Local Print Bridge
cd /d "%~dp0"

set "NODE_EXE=node"
if exist "%~dp0node.exe" set "NODE_EXE=%~dp0node.exe"

echo Starting Pandora POS Local Print Bridge...
echo.
"%NODE_EXE%" "%~dp0bridge-server.js"
echo.
echo Pandora Print Bridge stopped.
pause
