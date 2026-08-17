@echo off
REM build-windows.bat — Build bucksminer.exe for Windows (x64).
REM Requires Go 1.22+ in PATH. Run from the miner/ directory root.

SET ROOT=%~dp0..
SET DIST=%ROOT%\dist
SET CMD=%ROOT%\cmd\bucksminer
SET VERSION=0.1.0

IF NOT EXIST "%DIST%" MKDIR "%DIST%"

echo Building bucksminer for Windows (amd64)...

SET GOOS=windows
SET GOARCH=amd64
SET CGO_ENABLED=0

go build ^
  -trimpath ^
  -ldflags "-s -w -X main.Version=%VERSION%" ^
  -o "%DIST%\bucksminer.exe" ^
  "%CMD%"

IF %ERRORLEVEL% NEQ 0 (
  echo BUILD FAILED.
  EXIT /B 1
)

echo.
echo Build complete: %DIST%\bucksminer.exe
dir "%DIST%\bucksminer.exe"
