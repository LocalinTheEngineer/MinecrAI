param(
    [ValidateSet('bot', 'bridge')][string]$Mode = 'bot',
    [switch]$CheckServer
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'FAIL Node.js 22+ bulunamadi. Node kurup terminali yeniden acin.'
    exit 1
}
$launchArgs = @((Join-Path $PSScriptRoot 'start.js'), $Mode)
if ($CheckServer) { $launchArgs += '--check-server' }
& node @launchArgs
exit $LASTEXITCODE
