#!/usr/bin/env bash
# Tag a Class Button desktop release: bump apps/desktop/package.json version,
# commit, tag v<version>, and push. The GitHub release is built by the
# tag-triggered release-desktop workflow.
set -euo pipefail

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

usage() {
  echo "Usage: just release <version>   # e.g. just release 0.1.3" >&2
  exit 2
}

version="${1:-}"
if [[ -z "$version" ]]; then
  usage
fi

# Strip an optional leading v, then require strict semver.
version="${version#v}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be semver (e.g. 0.1.3), got '$version'." >&2
  exit 2
fi
tag="v$version"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; commit or stash changes first." >&2
  exit 1
fi

branch=$(git symbolic-ref --short HEAD)
if [[ "$branch" != "main" ]]; then
  echo "Releases are tagged from main; current branch is '$branch'." >&2
  exit 1
fi

git fetch origin main --quiet
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "main is not in sync with origin; pull or push first." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag $tag already exists locally." >&2
  exit 1
fi
if git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1; then
  echo "Tag $tag already exists on origin." >&2
  exit 1
fi

current=$(node -p "require('./apps/desktop/package.json').version")
if [[ "$current" == "$version" ]]; then
  echo "apps/desktop is already at $version."
else
  echo "Bumping apps/desktop version: $current -> $version"
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT
  node -e '
    const fs = require("fs");
    const [file, version, out] = process.argv.slice(1);
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.version = version;
    fs.writeFileSync(out, JSON.stringify(pkg, null, 2) + "\n");
  ' apps/desktop/package.json "$version" "$tmp"
  mv "$tmp" apps/desktop/package.json
  trap - EXIT
fi

git add apps/desktop/package.json
git commit -m "release(desktop): $tag"
git tag -a "$tag" -m "Class Button $tag"
git push origin main
git push origin "$tag"

echo "Tagged $tag; the release-desktop workflow will build and publish it."
