#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$service = Get-CimInstance Win32_Service -Filter "Name='NSWFireCoverage'"
if (-not $service) { throw 'NSWFireCoverage service is not installed.' }
if ($service.State -ne 'Running') { throw "Service is not running: $($service.State)" }
$config = Get-Content (Join-Path $env:ProgramData 'NSW Fire Coverage\server.json') -Raw | ConvertFrom-Json
$base = "http://localhost:$($config.port)"
if ((Invoke-RestMethod "$base/api/healthz").status -ne 'ok') { throw 'Health check failed.' }
$page = Invoke-WebRequest $base -UseBasicParsing
if ($page.Content -notmatch 'NSW Fire District Checker') { throw 'The site did not load.' }
if ($page.Content -match 'replit\.dev|replit\.app|replit\.com|/@vite') { throw 'A development or Replit URL was found in the HTML.' }
$point = Invoke-RestMethod "$base/api/fire-context?latitude=-33.8688&longitude=151.2093" -TimeoutSec 60
if ($point.kind -ne 'frnsw') { throw "Sydney boundary check was not FRNSW: $($point.kind). Check outbound access to NSW data services." }
Write-Host "PASS: Windows service, local site, health endpoint, and Sydney FRNSW boundary check."
Write-Host "Service account: $($service.StartName). Open $base in a browser to check maps and address search."
