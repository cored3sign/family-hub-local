@echo off
rem Double-click to start Yggltree on this PC. Keep the window open while
rem your family uses it; press Ctrl+C or close the window to stop it.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Yggltree needs Node.js 22.12 or newer. Download the LTS installer from https://nodejs.org, install it, then double-click Start Yggltree again.
  pause
  exit /b 1
)
rem "call" so control comes back here after npm.cmd finishes.
call npm start
pause
