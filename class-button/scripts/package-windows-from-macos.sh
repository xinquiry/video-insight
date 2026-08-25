#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target_triple="x86_64-pc-windows-msvc"
sidecar="$project_root/target/$target_triple/release/class-button-sidecar.exe"
staged="$project_root/desktop/build-resources/bin/class-button-sidecar.exe"

if ! command -v cargo-xwin >/dev/null 2>&1; then
    printf '%s\n' "cargo-xwin is required: cargo install cargo-xwin --locked" >&2
    exit 1
fi

rustup target add "$target_triple"
cargo xwin build \
    --release \
    --target "$target_triple" \
    --manifest-path "$project_root/Cargo.toml" \
    --bin class-button-sidecar

rm -rf "$project_root/desktop/build-resources/bin"
mkdir -p "$(dirname "$staged")"
cp "$sidecar" "$staged"
pnpm --dir "$project_root/desktop" build
pnpm --dir "$project_root/desktop" exec electron-builder --win portable zip --x64

printf '%s\n' "$project_root/dist/electron"
