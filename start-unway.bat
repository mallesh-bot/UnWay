@echo off
setlocal
title UnWay launcher
cd /d "%~dp0"

echo ==================================================
echo   UnWay - school dashboard, UnWay console, parents
echo ==================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Download the LTS version from https://nodejs.org
  echo then double-click this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo Node %%v found.

rem Run from a local (non-OneDrive) copy so node_modules is not synced to the cloud
set "LOCAL=%USERPROFILE%\unway-local"
echo Copying app source to %LOCAL% ...
robocopy "apps\web" "%LOCAL%\web" /MIR /XD node_modules dist /NFL /NDL /NJH /NJS /NP >nul

echo Checking packages (the first run takes a few minutes)...
pushd "%LOCAL%\web" && call npm install --no-audit --no-fund && popd

echo Starting UnWay in a new window (close it to stop UnWay)...
start "UnWay - http://localhost:5173" cmd /k "cd /d "%LOCAL%\web" && npm run dev -- --port 5173 --strictPort"

echo Waiting for the site to start...
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
echo.
echo School dashboard: http://localhost:5173
echo UnWay console:    http://localhost:5173/platform
echo Parent pages:     the links in parent messages (http://localhost:5173/p/...)
echo.
echo You can close this window. Keep the server window open while using UnWay.
timeout /t 15
