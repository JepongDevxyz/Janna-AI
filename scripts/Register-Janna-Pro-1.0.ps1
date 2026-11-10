# Registers Janna Pro 1.1 from an already installed local base model.
# No paid API, hidden download, or distribution of third-party model weights.
[CmdletBinding()]
param([switch]$PullBaseModel,[switch]$Quiet)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$modelfile = Join-Path $root 'models\Janna-Pro-1.0.Modelfile'
if (-not (Test-Path -LiteralPath $modelfile)) { throw 'Janna Pro profile missing. Extract the entire source ZIP.' }
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) { Write-Warning 'Local inference engine not installed. Janna Pro will be available after you install and run Ollama and rerun this script.'; exit 2 }
$names = @(& $ollama.Source list 2>&1)
if ($LASTEXITCODE -ne 0) { Write-Warning 'Local model server is offline. Start it and retry.'; exit 3 }
if (@($names -match '(?i)^janna-pro-1\.0(?::latest)?\s').Count -gt 0) { if (-not $Quiet) { Write-Host 'Janna Pro 1.1 is already registered.' }; exit 0 }
if (@($names -match '(?i)^bonsai-2:27b\s').Count -eq 0) {
    if (-not $PullBaseModel) {
        Write-Warning 'Base model bonsai-2:27b not installed. Run "ollama pull bonsai-2:27b", then rerun. Or rerun this script with -PullBaseModel to authorize its download.'
        exit 4
    }
    Write-Host 'Downloading user-authorized base model. No model weights are redistributed by Janna.'
    & $ollama.Source pull 'bonsai-2:27b'
    if ($LASTEXITCODE -ne 0) { throw 'Base-model download failed; nothing was changed in Janna.' }
}
Write-Host 'Registering Janna Pro 1.1 engineering profile (not neural-network training)...'
& $ollama.Source create 'janna-pro-1.0' -f $modelfile
if ($LASTEXITCODE -ne 0) { throw 'Janna Pro registration failed. Original base model is unchanged.' }
Write-Host 'Janna Pro 1.1 ready. Select it in Janna.' -ForegroundColor Green
