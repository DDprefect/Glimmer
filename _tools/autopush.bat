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
REM  Preferred backend is Git Bash (autopush.sh), NOT PowerShell:
REM    On this machine the user home path contains non-ASCII characters
REM    (C:\Users\<CJK>\). Under a PowerShell session git cannot reliably load
REM    its HTTPS remote helper or Git Credential Manager through such a path --
REM    "git push" dies silently with exit 128 and no output. The Git Bash
REM    environment handles the same path correctly. So we use bash when
REM    available and only fall back to the .ps1 otherwise.
REM    See the notes dated 2026-10-01 in autopush.ps1.
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

set "SH=%SCRIPT_DIR%autopush.sh"

REM ---- Look for a Git Bash to run autopush.sh with (preferred backend) ----
set "BASH="
set "PGROOT="
for /d %%V in ("%USERPROFILE%\.workbuddy\binaries\PortableGit\versions\*") do (
  if exist "%%~V\bin\bash.exe" (
    set "PGROOT=%%~V"
    set "BASH=%%~V\bin\bash.exe"
  )
)
if not defined BASH if exist "C:\Program Files\Git\bin\bash.exe" (
  set "PGROOT=C:\Program Files\Git"
  set "BASH=C:\Program Files\Git\bin\bash.exe"
)

REM A bare bash.exe does not inherit a full MSYS PATH, so coreutils
REM (tr/grep/sed) and git would be missing. Put the standard Git-for-Windows
REM directories in front of PATH before launching bash.
if defined PGROOT (
  set "PATH=%PGROOT%\mingw64\bin;%PGROOT%\usr\bin;%PGROOT%\bin;%PATH%"
)

if defined BASH if exist "%SH%" (
  REM Run from the repo root with a relative script path -- avoids any
  REM drive-letter/path conversion issues when handing the path to bash.
  cd /d "%SCRIPT_DIR%.."
  "%BASH%" _tools/autopush.sh %*
  endlocal & exit /b %ERRORLEVEL%
)

if not exist "%PS1%" (
  echo [ERROR] Cannot find autopush.ps1 next to this .bat
  echo         Looked for: %PS1%
  exit /b 4
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*

endlocal & exit /b %ERRORLEVEL%
