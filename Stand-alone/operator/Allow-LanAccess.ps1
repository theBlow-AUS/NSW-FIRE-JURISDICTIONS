# Run from an elevated PowerShell window. Does not open Public-network or Internet access.
# Windows policy may require this script to be signed by your organisation.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $env:ProgramData 'NSW Fire Coverage\server.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.host -eq '127.0.0.1' -or $config.host -eq '::1') {
    throw 'The service is configured for loopback only. Change host to 0.0.0.0 and restart NSWFireCoverage first.'
}
Get-NetFirewallRule -Name 'NSWFireCoverage-LAN' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name 'NSWFireCoverage-LAN' -DisplayName 'NSW Fire Coverage (LAN only)' `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $config.port `
    -Profile Domain,Private -RemoteAddress LocalSubnet | Out-Null
Write-Host "LAN access enabled on TCP $($config.port) for Domain/Private networks and the local subnet only."
Write-Host 'Open http://<server-name-or-LAN-IP>:<port> from another device. No Replit connection is used.'
