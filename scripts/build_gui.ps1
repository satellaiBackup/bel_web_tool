$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $RepoRoot
try {
go build -trimpath -ldflags="-s -w -H windowsgui" -o "main.exe" .
Copy-Item -Force "main.exe" "ble_web_tool_gui.exe"

Write-Host "Generated: main.exe"
Write-Host "Generated: ble_web_tool_gui.exe"
Write-Host "Double-click it to open the web UI without showing a command terminal."
} finally {
    Pop-Location
}
