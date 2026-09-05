@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo FAIL Node.js 22+ bulunamadi. Node kurup terminali yeniden acin.
  pause
  exit /b 1
)
node "%~dp0start.js" %*
set "minecrai_exit=%errorlevel%"
if not "%minecrai_exit%"=="0" pause
exit /b %minecrai_exit%
