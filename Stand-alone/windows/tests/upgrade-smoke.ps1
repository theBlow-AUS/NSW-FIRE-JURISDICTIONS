param(
  [Parameter(Mandatory=$true)][ValidateSet('fresh-current','prepare','upgrade','verify-boot-uninstall')][string]$Phase,
  [Parameter(Mandatory=$true)][string]$Evidence,
  [string]$Previous,
  [string]$Current,
  [int]$Port = 15400,
  [switch]$DisposableMachine
)
$ErrorActionPreference = 'Stop'
if (-not $DisposableMachine) { throw 'Use only an authorised disposable machine. Pass -DisposableMachine to acknowledge system install/uninstall.' }
$Harness = Join-Path $PSScriptRoot '../../tests/native-upgrade.mjs'
$Arguments = @($Harness, '--disposable-machine', '--phase', $Phase, '--evidence', $Evidence, '--port', "$Port")
if ($Phase -in @('prepare','fresh-current')) { $Arguments += @('--previous', $Previous, '--current', $Current) }
& node @Arguments
exit $LASTEXITCODE
