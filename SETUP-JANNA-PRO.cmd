@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Janna - Janna Pro 1.1 Model Setup
if not exist "%~dp0scripts\Ensure-Janna-Pro-1.0.ps1" (
  echo ERROR: This file must be run from a completely extracted Janna release.
  pause
  exit /b 2
)
echo.
echo    Janna  /  Janna Pro 1.1

echo    Installs official local dependencies and downloads the model.
echo    No online AI account or paid API is needed.
echo    Download is approximately 8.3 GB on first setup.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Ensure-Janna-Pro-1.0.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
echo Janna Pro setup exited with code %RESULT%.
echo Setup logs: %LOCALAPPDATA%\Janna\Logs
echo.
pause
exit /b %RESULT%
