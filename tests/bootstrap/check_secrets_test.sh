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

printf '%s\n' \
  'API_TOKEN=' \
  'ordinary documentation' \
  'const token = input.token;' \
  'token_hash = $1' \
  "referenceHmacSecret: 'test-reference-hmac-secret-32-bytes'" \
  > "$fixture_root/safe.txt"
"$scanner" "$fixture_root"

mkdir -p "$fixture_root/.superpowers/sdd"
printf '%s\n' 'API_TOKEN=ignored-review-fixture' > "$fixture_root/.superpowers/sdd/review.diff"
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

rm "$fixture_root/minter.env"
printf '%s\n' "const apiToken = 'example-nonempty-value';" > "$fixture_root/camel-case.ts"

if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "secret scanner accepted a camelCase token literal" >&2
  exit 1
fi

# OpenAI 형식 키(sk-, sk-proj-)는 GitHub push protection이 실제 키로 볼 수 있으므로 시험 값은 실행 중에 이어 붙여 만든다.
rm "$fixture_root/camel-case.ts"
openai_prefix="sk"
openai_body="abcdefghijklmnopqrstuvwxyz0123456789_-ABCD"
printf '%s\n' "OPENAI_API_KEY=${openai_prefix}-${openai_body}" > "$fixture_root/openai.env"

if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "secret scanner accepted an OpenAI-style key" >&2
  exit 1
fi

printf '%s\n' "const key = '${openai_prefix}-proj-${openai_body}';" > "$fixture_root/openai.env"

if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "secret scanner accepted an OpenAI project key" >&2
  exit 1
fi

# 빈 값·짧은 값·단어 속 sk-(task-, disk-)는 키가 아니므로 통과해야 한다.
printf '%s\n' \
  'OPENAI_API_KEY=' \
  '# OPENAI_API_KEY=' \
  'OPENAI_API_KEY: ${OPENAI_API_KEY:-}' \
  "const short = '${openai_prefix}-short';" \
  "task-${openai_body} disk-${openai_body} risk-${openai_body}" \
  > "$fixture_root/openai.env"
"$scanner" "$fixture_root"

echo "secret scanning regression tests passed"
