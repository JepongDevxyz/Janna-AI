# Run Janna Pro 1.1's real, opt-in local benchmark with a compact four-case profile.
# Add '-Full' for all 10 cases, or '-CompareBase' for an A/B against Bonsai 2.
[CmdletBinding()]
param([switch]$Full,[switch]$CompareBase)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Install Python 3.11 or newer before benchmarking.' }
Set-Location -LiteralPath $root
$benchmarkArgs = @('-m','janna.benchmark','--model','janna-pro-1.0:latest','--limit',$(if ($Full) {'10'} else {'4'}))
if ($CompareBase) { $benchmarkArgs += @('--model','bonsai-2:27b') }
& $python.Source @benchmarkArgs
if ($LASTEXITCODE -ne 0) { throw 'At least one benchmark could not finish; check ~/.janna/benchmark-janna-pro-1.0.json.' }
