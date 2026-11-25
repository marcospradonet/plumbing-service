@echo off
rem Starts Plumbing Service (works from PowerShell, Command Prompt or double-click)
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || exit /b 1
)
call npm start
