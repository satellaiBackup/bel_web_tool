$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "frontend"

Push-Location $frontend
try {
    if (-not (Test-Path "node_modules")) {
        if (Test-Path "package-lock.json") {
            npm ci
        }
        else {
            npm install
        }
    }
    npm run build
}
finally {
    Pop-Location
}
