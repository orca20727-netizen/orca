@echo off
setlocal
cd /d "%~dp0"
title ORCA INSIGHT - Multi-Agent Marine Intelligence (SIH 2026)
echo ==========================================================
echo   ORCA INSIGHT - Multi-Agent Marine Intelligence Platform
echo   SIH 2026 . PS 26176 . ISRO . Team SavioursX
echo ==========================================================
echo.

rem Detect an available interpreter WITHOUT running it yet -- chaining
rem "python ... || py ... || python3 ..." directly is a trap here: once
rem the first http.server actually starts it blocks for the whole demo,
rem and stopping it with Ctrl+C returns a non-zero exit code, which would
rem trigger the next command in the chain and silently relaunch a second
rem server. Pick one interpreter up front instead.
set PYCMD=
where python >nul 2>nul && set PYCMD=python
if not defined PYCMD (
    where py >nul 2>nul && set PYCMD=py
)
if not defined PYCMD (
    where python3 >nul 2>nul && set PYCMD=python3
)

if not defined PYCMD (
    echo ERROR: No Python interpreter found on PATH.
    echo Install Python 3 from https://www.python.org/downloads/ ^(check
    echo "Add python.exe to PATH" during install^) and re-run this script.
    pause
    exit /b 1
)

echo Starting local web server on port 3000 using "%PYCMD%"...
echo Open in your browser: http://localhost:3000
echo On the same Wi-Fi from a phone, use this PC's LAN IP instead of
echo localhost -- see the README's "Mobile / LAN access" section, and
echo make sure Windows Firewall allows Python through on port 3000/8000.
echo Press Ctrl+C in this window to stop the server.
echo.

start "" http://localhost:3000
%PYCMD% -m http.server 3000

pause
