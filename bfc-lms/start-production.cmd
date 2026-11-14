@echo off
setlocal enabledelayedexpansion
title BFC LMS - Production (Node single-port + PostgreSQL)

rem === BFC LMS production launcher =====================================
rem Single-port Node.js deployment: Express serves the built SPA + /api
rem on http://localhost:4000. Uses the portable PostgreSQL under ..\.runtime.
rem No XAMPP / IIS required.
rem =====================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "RUNTIME=%ROOT%\..\.runtime"
set "NODE_DIR=%RUNTIME%\node-v24.18.0-win-x64"
set "PG_DIR=%RUNTIME%\postgresql-16.4"
if not exist "%PG_DIR%\bin\pg_ctl.exe" set "PG_DIR=%RUNTIME%\pg-extract\pgsql"
set "PG_DATA=%RUNTIME%\pg-data"

rem Prefer the portable Node; fall back to a system Node on PATH.
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo [error] node.exe not found. Install Node.js or restore the portable runtime.
  pause
  exit /b 1
)

rem --- Production environment (overrides server\.env; dotenv keeps existing vars) ---
set "NODE_ENV=production"
if not defined PORT set "PORT=4000"
rem Plain-HTTP deployment: Secure cookies need HTTPS. Keep off until TLS is enabled.
rem Behind a TLS terminator (or on Render), set COOKIE_SECURE=true.
if not defined COOKIE_SECURE set "COOKIE_SECURE=false"

if not exist "%ROOT%\server\dist\index.js" (
  echo [error] server\dist\index.js missing. Run "npm run build" in server first.
  pause
  exit /b 1
)
if not exist "%ROOT%\client\dist\index.html" (
  echo [error] client\dist\index.html missing. Run "npm run build" in client first.
  pause
  exit /b 1
)

rem --- Start portable PostgreSQL if it is not already listening on 5432 ---
netstat -ano | findstr "LISTENING" | findstr /C:":5432 " >nul 2>&1
if errorlevel 1 (
  if not exist "%PG_DIR%\bin\pg_ctl.exe" (
    echo [error] PostgreSQL not running and pg_ctl.exe not found at "%PG_DIR%".
    echo         Start your PostgreSQL service manually, then re-run this script.
    pause
    exit /b 1
  )
  if not exist "%PG_DATA%\PG_VERSION" (
    echo [error] PostgreSQL data directory missing at "%PG_DATA%".
    echo         Initialise it once with initdb, then run db:schema and db:seed.
    pause
    exit /b 1
  )
  echo [db] starting portable PostgreSQL...
  start "BFC PostgreSQL" /min "%PG_DIR%\bin\pg_ctl.exe" -D "%PG_DATA%" -l "%RUNTIME%\pg.log" -o "-p 5432 -c listen_addresses=127.0.0.1" start
  set /a tries=0
  :waitdb
  netstat -ano | findstr "LISTENING" | findstr /C:":5432 " >nul 2>&1
  if not errorlevel 1 goto dbready
  set /a tries+=1
  if !tries! geq 30 (
    echo [error] PostgreSQL did not become ready. See "%RUNTIME%\pg.log".
    pause
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  goto waitdb
  :dbready
  echo [db] PostgreSQL is ready.
) else (
  echo [db] PostgreSQL already running on :5432.
)

echo [api] BFC LMS production starting on http://localhost:%PORT%
echo [api] NODE_ENV=%NODE_ENV%  COOKIE_SECURE=%COOKIE_SECURE%
echo [api] Press Ctrl+C or close this window to stop the API.
cd /d "%ROOT%\server"
node dist\index.js

echo.
echo [api] process exited.
pause
endlocal