$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Janna.lnk'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $root 'START-Janna.cmd'
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'Janna - local AI coding workspace'
$icon = Join-Path $root 'assets\janna.ico'
if (Test-Path $icon) { $shortcut.IconLocation = $icon }
$shortcut.Save()
Write-Host "Created $shortcutPath"
