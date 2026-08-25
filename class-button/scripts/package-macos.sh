#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

pnpm --dir "$project_root/desktop" package:mac

printf '%s\n' "$project_root/dist/electron"
