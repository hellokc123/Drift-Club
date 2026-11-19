@echo off
setlocal
title Drift Club - multiplayer server launcher
cd /d "%~dp0"

rem ---- Find node.exe: portable copy next to this file first, then an installed one
set "NODE="
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not defined NODE for /d %%D in ("%~dp0node-v*") do if exist "%%D\node.exe" set "NODE=%%D\node.exe"
if not defined NODE for /d %%D in ("%~dp0node\node-v*") do if exist "%%D\node.exe" set "NODE=%%D\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE=node"
)

if not defined NODE (
  echo.
  echo  Node.js was not found. You do NOT need to install it or have admin rights:
  echo.
  echo   1. Go to https://nodejs.org/en/download
  echo   2. Download the "Windows Binary (.zip)" for x64  ^(NOT the .msi installer^)
  echo   3. Extract the zip INTO this game folder:
  echo        %~dp0
  echo      ^(you should end up with a folder like node-v22.x.x-win-x64 next to this file^)
  echo   4. Double-click Start-Multiplayer-Server.bat again.
  echo.
  echo  Solo play does not need any of this - just open DriftClub.html.
  echo.
  pause
  exit /b 1
)

echo.
echo  Starting the Drift Club server... a second window will open - keep it open while you play.
echo  Close that window to stop the server.
start "Drift Club server (close to stop)" "%NODE%" "%~dp0server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
echo.
echo  The game is opening at http://localhost:3000
echo  Friends on the same network can try http://YOUR-IP:3000  (find YOUR-IP with: ipconfig)
echo.
pause
