#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

# The desktop app is part of the pnpm monorepo; install without --frozen-lockfile
# so the optional mac-only dependency (dmg-license) resolves on Linux/Windows too.
pnpm --dir "$repo_root" install
pnpm --dir "$repo_root/apps/desktop" package:mac

printf '%s\n' "$repo_root/apps/dist/electron"
