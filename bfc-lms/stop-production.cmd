@echo off
setlocal enabledelayedexpansion
title BFC LMS - Stop Production API

rem === BFC LMS production stopper ======================================
rem Stops the Node API listening on PORT (default 4000). PostgreSQL is left
rem running on purpose; force-killing postgres can corrupt data. To stop
rem PostgreSQL gracefully, run the pg_ctl command printed at the end.
rem =====================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "RUNTIME=%ROOT%\..\.runtime"
set "PG_DIR=%RUNTIME%\postgresql-16.4"
if not exist "%PG_DIR%\bin\pg_ctl.exe" set "PG_DIR=%RUNTIME%\pg-extract\pgsql"
set "PG_DATA=%RUNTIME%\pg-data"
if not defined PORT set "PORT=4000"

set "found="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr /C:":%PORT% "') do (
  set "found=1"
  echo [api] stopping PID %%p on :%PORT% ...
  taskkill /PID %%p /T /F >nul 2>&1
)
if not defined found (
  echo [api] nothing listening on :%PORT%.
) else (
  echo [api] stopped.
)

echo.
echo [db] PostgreSQL was left running. To shut it down gracefully:
echo      "%PG_DIR%\bin\pg_ctl.exe" -D "%PG_DATA%" stop
endlocal