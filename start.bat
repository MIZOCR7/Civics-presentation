@echo off
title QuizRush - live quiz server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this computer.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting QuizRush... keep this window open during the game.
echo.
node server.js

echo.
echo   The server has stopped.
pause
