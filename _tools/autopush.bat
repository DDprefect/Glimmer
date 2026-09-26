@echo off
REM ==========================================================================
REM  autopush.bat -- wrapper for autopush.ps1
REM
REM  Why this file exists:
REM    Windows ships with PowerShell execution policy set to "Restricted",
REM    which silently refuses to run .ps1 files. Launching through this .bat
REM    with -ExecutionPolicy Bypass works on any machine without changing
REM    any system setting.
REM
REM  NOTE: this file is intentionally pure ASCII to avoid the cmd.exe
REM        console codepage issue with non-ASCII characters.
REM
REM  Usage:
REM    autopush.bat -Message "your commit message"
REM    autopush.bat -DryRun
REM    autopush.bat -Help
REM ==========================================================================

setlocal

REM Switch console to UTF-8 so Chinese output from PowerShell renders correctly.
chcp 65001 >nul 2>&1

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%autopush.ps1"

if not exist "%PS1%" (
    echo [ERROR] Cannot find autopush.ps1 next to this .bat
    echo         Looked for: %PS1%
    exit /b 4
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*

endlocal & exit /b %ERRORLEVEL%
