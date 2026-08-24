#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target_triple="x86_64-pc-windows-msvc"
package_name="Class-Button-Windows-x64"
staging_root=$(mktemp -d)
package_dir="$staging_root/$package_name"

cleanup() {
    rm -rf "$staging_root"
}
trap cleanup EXIT HUP INT TERM

if ! command -v cargo-xwin >/dev/null 2>&1; then
    printf '%s\n' "cargo-xwin is required: cargo install cargo-xwin --locked" >&2
    exit 1
fi

rustup target add "$target_triple"
cargo xwin build \
    --release \
    --target "$target_triple" \
    --manifest-path "$project_root/Cargo.toml" \
    --bin class-button-desktop

mkdir -p "$package_dir/player-adapter" "$project_root/dist"
cp "$project_root/target/$target_triple/release/class-button-desktop.exe" \
    "$package_dir/Class Button.exe"
cp "$project_root/config/classroom.example.json" "$package_dir/classroom.json"
cp "$project_root/docs/windows.md" "$package_dir/README-Windows.md"
cp "$project_root/player-adapter/class-button-player.js" "$package_dir/player-adapter/"
cp "$project_root/player-adapter/README.md" "$package_dir/player-adapter/"

(
    cd "$staging_root"
    zip -r -X -q "$project_root/dist/$package_name.zip" "$package_name"
)

printf '%s\n' "$project_root/dist/$package_name.zip"
