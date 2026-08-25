param(
    [ValidateSet("x64", "arm64")]
    [string]$Architecture = "x64"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DesktopRoot = Join-Path $ProjectRoot "desktop"
$TargetTriple = if ($Architecture -eq "arm64") {
    "aarch64-pc-windows-msvc"
} else {
    "x86_64-pc-windows-msvc"
}
$Sidecar = Join-Path $ProjectRoot "target\$TargetTriple\release\class-button-sidecar.exe"
$StagedSidecar = Join-Path $DesktopRoot "build-resources\bin\class-button-sidecar.exe"
$ElectronArch = if ($Architecture -eq "arm64") { "--arm64" } else { "--x64" }

rustup target add $TargetTriple
cargo build `
    --release `
    --target $TargetTriple `
    --manifest-path (Join-Path $ProjectRoot "Cargo.toml") `
    --bin class-button-sidecar

$StagedDirectory = Split-Path -Parent $StagedSidecar
if (Test-Path $StagedDirectory) {
    Remove-Item -Recurse -Force $StagedDirectory
}
New-Item -ItemType Directory -Force $StagedDirectory | Out-Null
Copy-Item -Force $Sidecar $StagedSidecar
pnpm --dir $DesktopRoot build
pnpm --dir $DesktopRoot exec electron-builder --win portable zip $ElectronArch

Write-Output (Join-Path $ProjectRoot "dist\electron")
