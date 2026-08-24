param(
    [ValidateSet("x64", "arm64")]
    [string]$Architecture = "x64"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TargetTriple = if ($Architecture -eq "arm64") {
    "aarch64-pc-windows-msvc"
} else {
    "x86_64-pc-windows-msvc"
}
$PackageName = "Class-Button-Windows-$Architecture"
$PackageDir = Join-Path $ProjectRoot "dist\$PackageName"
$ArchivePath = Join-Path $ProjectRoot "dist\$PackageName.zip"
$BinaryPath = Join-Path $ProjectRoot "target\$TargetTriple\release\class-button-desktop.exe"

rustup target add $TargetTriple
cargo build `
    --release `
    --target $TargetTriple `
    --manifest-path (Join-Path $ProjectRoot "Cargo.toml") `
    --bin class-button-desktop

if (Test-Path $PackageDir) {
    Remove-Item -Recurse -Force $PackageDir
}
New-Item -ItemType Directory -Force $PackageDir | Out-Null
New-Item -ItemType Directory -Force (Join-Path $PackageDir "player-adapter") | Out-Null

Copy-Item $BinaryPath (Join-Path $PackageDir "Class Button.exe")
Copy-Item `
    (Join-Path $ProjectRoot "config\classroom.example.json") `
    (Join-Path $PackageDir "classroom.json")
Copy-Item `
    (Join-Path $ProjectRoot "docs\windows.md") `
    (Join-Path $PackageDir "README-Windows.md")
Copy-Item `
    (Join-Path $ProjectRoot "player-adapter\class-button-player.js") `
    (Join-Path $PackageDir "player-adapter\class-button-player.js")
Copy-Item `
    (Join-Path $ProjectRoot "player-adapter\README.md") `
    (Join-Path $PackageDir "player-adapter\README.md")

if (Test-Path $ArchivePath) {
    Remove-Item -Force $ArchivePath
}
Compress-Archive -Path "$PackageDir\*" -DestinationPath $ArchivePath

Write-Output $ArchivePath
