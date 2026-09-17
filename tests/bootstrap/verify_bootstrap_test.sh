#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-bootstrap.sh"

if [[ ! -x "$verifier" ]]; then
  echo "expected executable verifier at $verifier" >&2
  exit 1
fi

"$verifier" "$repo_root"

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

mkdir -p "$fixture_root/docs" "$fixture_root/scripts" "$fixture_root/tests/bootstrap" "$fixture_root/tests/catalog"
cp "$repo_root/README.md" "$fixture_root/README.md"
cp "$repo_root/.gitignore" "$fixture_root/.gitignore"
cp "$repo_root/.env.example" "$fixture_root/.env.example"
cp "$repo_root/AGENTS.md" "$fixture_root/AGENTS.md"
cp "$repo_root/THIRD_PARTY_NOTICES.md" "$fixture_root/THIRD_PARTY_NOTICES.md"
cp "$repo_root/scripts/check-secrets.sh" "$fixture_root/scripts/check-secrets.sh"
cp "$repo_root/tests/bootstrap/check_secrets_test.sh" "$fixture_root/tests/bootstrap/check_secrets_test.sh"
cp "$repo_root/tests/catalog/required-tests.tsv" "$fixture_root/tests/catalog/required-tests.tsv"

for document in SOURCE_INDEX COMPETITION EVALUATION_MAP PRD DECISIONS STATUS TEST_REPORT AI_USAGE; do
  cp "$repo_root/docs/$document.md" "$fixture_root/docs/$document.md"
done

rm "$fixture_root/docs/AI_USAGE.md"

if "$verifier" "$fixture_root" >/dev/null 2>&1; then
  echo "verifier accepted a bootstrap missing docs/AI_USAGE.md" >&2
  exit 1
fi

cp "$repo_root/docs/AI_USAGE.md" "$fixture_root/docs/AI_USAGE.md"
rm "$fixture_root/docs/STATUS.md"

if "$verifier" "$fixture_root" >/dev/null 2>&1; then
  echo "verifier accepted a bootstrap missing docs/STATUS.md" >&2
  exit 1
fi

echo "bootstrap verification regression tests passed"
