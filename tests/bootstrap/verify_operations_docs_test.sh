#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-operations-docs.mjs"
[[ -f "$verifier" ]] || { echo 'missing operations docs verifier' >&2; exit 1; }
node "$verifier" "$repo_root"

fixture="$(mktemp -d -t operations-docs.XXXXXX)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/apps/api" "$fixture/apps/mobile" "$fixture/apps/worker" "$fixture/docs"
for app in api mobile worker; do
  cp "$repo_root/apps/$app/package.json" "$fixture/apps/$app/package.json"
  cp "$repo_root/apps/$app/README.md" "$fixture/apps/$app/README.md"
done
cp "$repo_root/docs/HANDOFF.md" "$fixture/docs/HANDOFF.md"
cp "$repo_root/docs/PROJECT_STATE.md" "$fixture/docs/PROJECT_STATE.md"
cp "$repo_root/README.md" "$fixture/README.md"

assert_mutation_fails() { # <file> <from> <to>
  local file="$1" from="$2" to="$3"
  cp "$fixture/$file" "$fixture/$file.backup"
  sed "s/$from/$to/" "$fixture/$file.backup" > "$fixture/$file"
  if node "$verifier" "$fixture" >/dev/null 2>&1; then
    echo "operations verifier accepted drift in $file" >&2
    exit 1
  fi
  mv "$fixture/$file.backup" "$fixture/$file"
}

assert_mutation_fails apps/api/README.md '운영 계정 API는' '모든 계정 API는'
assert_mutation_fails apps/worker/README.md 'Base Sepolia encrypted keystore' 'Local Anvil 전용'
assert_mutation_fails docs/HANDOFF.md 'gh pr list' '문서 고정 PR 목록'
assert_mutation_fails apps/mobile/README.md '운영 계정 삭제.*BLOCKED' '운영 계정 삭제 재인증 완료'

# P01 회귀: README와 PROJECT_STATE의 "현재" 자동 시험 합계가 어긋나면 실패해야 한다(옛 문구 존재만 보던 검사로는 못 잡았다).
assert_mutation_fails README.md '모바일 853\/853' '모바일 850\/850'
assert_mutation_fails docs/PROJECT_STATE.md 'API 단위 291\/291' 'API 단위 289\/289'

echo 'operations docs regression tests passed'
