#Requires -RunAsAdministrator
# Stop the service while refreshing to prevent two processes from writing the same cache.
$ErrorActionPreference = 'Stop'
$installPath = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $env:ProgramData 'NSW Fire Coverage\server.json'
$wasRunning = (Get-Service -Name NSWFireCoverage).Status -eq 'Running'
try {
    Stop-Service -Name NSWFireCoverage
    & (Join-Path $installPath 'runtime\node.exe') (Join-Path $installPath 'app\server.mjs') --config $configPath --refresh-rfs
    if ($LASTEXITCODE -ne 0) { throw 'The refresh failed. Existing data was retained; check the source warning and service log.' }
} finally {
    if ($wasRunning) { Start-Service -Name NSWFireCoverage }
}
