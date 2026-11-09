@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Janna - Start
set "INSTALLED=%LOCALAPPDATA%\Programs\Janna\Janna.exe"
set "BUILT=%~dp0dist\Janna-win-x64\Janna.exe"
if exist "%INSTALLED%" goto RUN_INSTALLED
if exist "%BUILT%" goto RUN_BUILT

echo Janna has not been compiled on this computer yet.
echo Starting the native Windows setup with diagnostics...
echo.
call "%~dp0REPAIR-Janna.cmd"
exit /b %errorlevel%

:RUN_INSTALLED
set "EXE=%INSTALLED%"
goto RUN_APP

:RUN_BUILT
set "EXE=%BUILT%"
goto RUN_APP

:RUN_APP
echo Starting native Janna application:
echo %EXE%
start "" "%EXE%"
if errorlevel 1 goto APP_FAILED
rem Give the window time to open and catch an immediate process failure.
timeout /t 3 /nobreak >nul
tasklist /FI "IMAGENAME eq Janna.exe" 2>nul | find /I "Janna.exe" >nul
if errorlevel 1 goto APP_FAILED
exit /b 0

:APP_FAILED
echo.
echo Janna exited immediately or Windows could not launch the EXE.
echo Inspect %%LOCALAPPDATA%%\Janna\Logs for the desktop startup log.
echo To repair the installation, double-click REPAIR-Janna.cmd in this folder.
echo.
pause
exit /b 1
