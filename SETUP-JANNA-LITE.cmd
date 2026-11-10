@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
echo.
echo ================================================================
echo  JANNA - REI 1.0 LIGHTWEIGHT MODEL SETUP
 echo  Optimized starting profile for 8 GB NVIDIA GPUs
 echo  No subscription required. Official model download ~3.2 GB.
echo ================================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\Ensure-Janna-Pro-1.0.ps1" -PreferSmallModel
set "result=%errorlevel%"
echo.
if "%result%"=="0" (
 echo Janna Lite 1.1 setup completed. Open Janna and select Janna Lite 1.1.
) else (
 echo Setup failed with code %result%. Review the Janna Logs folder.
)
echo.
pause
exit /b %result%
