#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scanner="$repo_root/scripts/check-secrets.sh"

if [[ ! -x "$scanner" ]]; then
  echo "expected executable secret scanner at $scanner" >&2
  exit 1
fi

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

printf '%s\n' 'API_TOKEN=' 'ordinary documentation' > "$fixture_root/safe.txt"
"$scanner" "$fixture_root"

printf '%s\n' 'API_TOKEN=example-nonempty-value' > "$fixture_root/leaked.env"

if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "secret scanner accepted a non-empty token assignment" >&2
  exit 1
fi

rm "$fixture_root/leaked.env"
printf '%s\n' 'DATABASE_URL=postgres://masscom:unsafe-password@db.example.test/masscom' > "$fixture_root/database.env"

if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "secret scanner accepted a database URL containing credentials" >&2
  exit 1
fi

rm "$fixture_root/database.env"
printf '%s\n' 'CHAIN_RPC_URL=https://rpc.example.test/v1?api_key=unsafe-value' > "$fixture_root/rpc.env"

if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "secret scanner accepted a URL containing an API key" >&2
  exit 1
fi

rm "$fixture_root/rpc.env"
printf '%s\n' 'MINTER_KEY=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' > "$fixture_root/minter.env"

if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "secret scanner accepted an EVM private key-like value" >&2
  exit 1
fi

echo "secret scanning regression tests passed"
