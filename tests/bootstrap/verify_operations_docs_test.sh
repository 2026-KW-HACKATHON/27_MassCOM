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
cp "$repo_root/docs/HANDOFF_HISTORY.md" "$fixture/docs/HANDOFF_HISTORY.md"
cp "$repo_root/docs/PROJECT_STATE.md" "$fixture/docs/PROJECT_STATE.md"
cp "$repo_root/README.md" "$fixture/README.md"

assert_current_handoff() {
  local handoff="$1" history="$2"
  [[ "$(grep -Ec '^## [0-9]+\. ' "$handoff")" -eq 14 ]] || return 1
  grep -Eq '^## 1\. 기준 커밋과 작업 위치$' "$handoff" || return 1
  grep -Eq '^## 14\. 이력과 변경 규칙$' "$handoff" || return 1
  grep -Eq '기준 main 커밋 SHA: `[0-9a-f]{7,40}`' "$handoff" || return 1
  grep -Eq '^기준 시각: [0-9]{4}-[0-9]{2}-[0-9]{2} KST' "$handoff" || return 1
  grep -Eq '필수 [0-9]+개 상태: `[0-9]+ PASS / [0-9]+ BLOCKED / [0-9]+ NOT_RUN`' "$handoff" || return 1
  grep -Eq "^PR_TITLE='한국어 PR 제목'$" "$handoff" || return 1
  grep -Eq "^PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'$" "$handoff" || return 1
  grep -Eq 'bash scripts/check-pr-korean.sh "\$PR_TITLE" "\$PR_BODY"' "$handoff" || return 1
  grep -Eq 'bash tests/bootstrap/check_pr_korean_test.sh.*checker 자체 회귀 시험' "$handoff" || return 1
  grep -Eq '\[HANDOFF_HISTORY\]\(HANDOFF_HISTORY.md\)' "$handoff" || return 1
  grep -Eq '^## [0-9]{4}-[0-9]{2}-[0-9]{2} .+' "$history"
}

assert_current_handoff "$fixture/docs/HANDOFF.md" "$fixture/docs/HANDOFF_HISTORY.md" || {
  echo 'current handoff format or preserved history missing' >&2
  exit 1
}
# 정상적인 상태 갱신은 허용하고 문서 구조 훼손은 거부한다.
sed -E \
  -e 's/[0-9a-f]{7,40}/abcdef1234567890/g' \
  -e 's/[0-9]{4}-[0-9]{2}-[0-9]{2}/2030-01-02/g' \
  -e 's/Issue #[0-9]+ 진행 중/Issue #999 완료/g' \
  -e 's/필수 [0-9]+개 상태: `[0-9]+ PASS \/ [0-9]+ BLOCKED \/ [0-9]+ NOT_RUN`/필수 40개 상태: `40 PASS \/ 0 BLOCKED \/ 0 NOT_RUN`/' \
  "$fixture/docs/HANDOFF.md" > "$fixture/docs/HANDOFF.md.updated"
sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}/2030-01-02/g' \
  "$fixture/docs/HANDOFF_HISTORY.md" > "$fixture/docs/HANDOFF_HISTORY.md.updated"
assert_current_handoff "$fixture/docs/HANDOFF.md.updated" "$fixture/docs/HANDOFF_HISTORY.md.updated" || {
  echo 'handoff regression rejected valid metadata updates' >&2
  exit 1
}
for pattern in '기준 main 커밋 SHA:' '^## 7\.' 'HANDOFF_HISTORY' '필수 [0-9]+개 상태:'; do
  sed -E "/$pattern/d" "$fixture/docs/HANDOFF.md" > "$fixture/docs/HANDOFF.md.mutated"
  if assert_current_handoff "$fixture/docs/HANDOFF.md.mutated" "$fixture/docs/HANDOFF_HISTORY.md"; then
    echo "handoff regression accepted missing structure: $pattern" >&2
    exit 1
  fi
done
rm "$fixture/docs/HANDOFF.md.mutated" "$fixture/docs/HANDOFF.md.updated" "$fixture/docs/HANDOFF_HISTORY.md.updated"

assert_mutation_fails() { # <file> <from> <to>
  local file="$1" from="$2" to="$3"
  cp "$fixture/$file" "$fixture/$file.backup"
  sed "s/$from/$to/" "$fixture/$file.backup" > "$fixture/$file"
  if cmp -s "$fixture/$file.backup" "$fixture/$file"; then
    echo "mutation did not change $file" >&2
    exit 1
  fi
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
assert_mutation_fails README.md '\(현재 자동 시험 합계([^)]*):[^.]*모바일 \)\([0-9][0-9]*\/[0-9][0-9]*\)' '\10\2'
assert_mutation_fails docs/PROJECT_STATE.md '\(현재 자동 시험 합계([^)]*):[^.]*API 단위 \)\([0-9][0-9]*\/[0-9][0-9]*\)' '\10\2'

echo 'operations docs regression tests passed'
