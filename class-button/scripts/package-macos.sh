#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
app_dir="$project_root/dist/Class Button.app"

cargo build --release --manifest-path "$project_root/Cargo.toml" --bin class-button-desktop
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$project_root/target/release/class-button-desktop" "$app_dir/Contents/MacOS/"
cp "$project_root/packaging/macos/Info.plist" "$app_dir/Contents/Info.plist"
cp "$project_root/config/classroom.example.json" "$app_dir/Contents/Resources/classroom.json"
chmod 755 "$app_dir/Contents/MacOS/class-button-desktop"
codesign --force --deep --sign - "$app_dir"

printf '%s\n' "$app_dir"
