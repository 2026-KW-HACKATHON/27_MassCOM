#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-project-site.sh"

if [[ ! -x "$verifier" ]]; then
  echo "expected executable site verifier at $verifier" >&2
  exit 1
fi

"$verifier" "$repo_root"

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

mkdir -p "$fixture_root/docs/assets"
cp "$repo_root/README.md" "$fixture_root/README.md"
cp "$repo_root/docs/index.html" "$fixture_root/docs/index.html"
cp "$repo_root/docs/assets/project.css" "$fixture_root/docs/assets/project.css"

sed '/<main /,/<\/main>/d' "$repo_root/docs/index.html" > "$fixture_root/docs/index.html"

if "$verifier" "$fixture_root" >/dev/null 2>&1; then
  echo "site verifier accepted a page without its main content" >&2
  exit 1
fi

cp "$repo_root/docs/index.html" "$fixture_root/docs/index.html"
sed '/docs\/index.html/d' "$repo_root/README.md" > "$fixture_root/README.md"

if "$verifier" "$fixture_root" >/dev/null 2>&1; then
  echo "site verifier accepted a README without the portal entry point" >&2
  exit 1
fi

echo "project portal regression tests passed"
