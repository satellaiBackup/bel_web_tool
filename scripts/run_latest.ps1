$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "main.exe"
$buildScript = Join-Path $PSScriptRoot "build_frontend.ps1"

$running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -eq [System.IO.Path]::GetFullPath($exe))
}

foreach ($process in $running) {
    Stop-Process -Id $process.Id -Force
    Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
}

& $buildScript

if (-not (Test-Path -LiteralPath $exe)) {
    Push-Location $root
    try {
        go build -o main.exe .
    }
    finally {
        Pop-Location
    }
}

Start-Process -FilePath $exe -WorkingDirectory $root
