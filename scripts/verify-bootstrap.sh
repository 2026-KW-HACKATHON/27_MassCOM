#!/usr/bin/env bash

set -euo pipefail

repo_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

fail() {
  echo "bootstrap verification failed: $1" >&2
  exit 1
}

required_files=(
  README.md
  .gitignore
  .env.example
  AGENTS.md
  THIRD_PARTY_NOTICES.md
  docs/SOURCE_INDEX.md
  docs/COMPETITION.md
  docs/EVALUATION_MAP.md
  docs/PRD.md
  docs/DECISIONS.md
  docs/PROJECT_STATE.md
  docs/TEST_STATUS.md
  docs/STATUS.md
  docs/TEST_REPORT.md
  docs/AI_USAGE.md
  docs/HANDOFF.md
  scripts/check-secrets.sh
  tests/bootstrap/check_secrets_test.sh
  tests/catalog/required-tests.tsv
)

for relative_path in "${required_files[@]}"; do
  [[ -s "$repo_root/$relative_path" ]] || fail "missing or empty $relative_path"
done

grep -Fq 'git clone --recurse-submodules https://github.com/2026-KW-HACKATHON/27_MassCOM.git' "$repo_root/README.md" \
  || fail 'README fresh clone must initialize submodules'
grep -Fq 'git submodule update --init --recursive' "$repo_root/README.md" \
  || fail 'README existing clone must initialize submodules'
grep -Fq 'bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"' "$repo_root/AGENTS.md" \
  || fail 'AGENTS must run the actual Korean PR checker'
if grep -Fq 'PR을 열기 전에 `bash tests/bootstrap/check_pr_korean_test.sh`' "$repo_root/AGENTS.md"; then
  fail 'AGENTS presents the checker regression fixture as actual PR validation'
fi
grep -Fq "PR_TITLE='" "$repo_root/docs/HANDOFF.md" || fail 'HANDOFF is missing PR_TITLE input'
grep -Fq "PR_BODY='" "$repo_root/docs/HANDOFF.md" || fail 'HANDOFF is missing PR_BODY input'
grep -Fq 'bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"' "$repo_root/docs/HANDOFF.md" \
  || fail 'HANDOFF is missing actual Korean PR validation'
grep -Fq 'checker 자체 회귀 시험' "$repo_root/docs/HANDOFF.md" \
  || fail 'HANDOFF does not label the checker regression test'

for status in PLANNED IN_PROGRESS IMPLEMENTED VERIFIED BLOCKED; do
  grep -q "$status" "$repo_root/README.md" || fail "README is missing status $status"
done

catalog="$repo_root/tests/catalog/required-tests.tsv"
expected_ids="Q01 Q02 Q03 Q04 Q05 R01 R02 R03 W01 W02 W03 W04 W05 W06 W07 W08 W09 M01 M02 M03 M04 M05 M06 M07 M08 C01 C02 C03 C04 D01 D02 D03 A01 A02 O01 O02"

entry_count="$(awk -F '\t' 'NR > 1 && $1 != "" { count++ } END { print count + 0 }' "$catalog")"
[[ "$entry_count" -eq 36 ]] || fail "expected 36 test entries, found $entry_count"

for test_id in $expected_ids; do
  id_count="$(awk -F '\t' -v id="$test_id" 'NR > 1 && $1 == id { count++ } END { print count + 0 }' "$catalog")"
  [[ "$id_count" -eq 1 ]] || fail "expected test ID $test_id exactly once, found $id_count"
  grep -q "| $test_id |" "$repo_root/docs/TEST_STATUS.md" || fail "TEST_STATUS is missing $test_id"
  catalog_status="$(awk -F '\t' -v id="$test_id" 'NR > 1 && $1 == id { print $3 }' "$catalog")"
  ledger_status="$(awk -F '|' -v id="$test_id" '
    {
      key = $2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == id) {
        status = $4
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", status)
        print status
      }
    }
  ' "$repo_root/docs/TEST_STATUS.md")"
  [[ "$catalog_status" == "$ledger_status" ]] ||
    fail "status mismatch for $test_id: catalog=$catalog_status TEST_STATUS=$ledger_status"
done

invalid_statuses="$(awk -F '\t' 'NR > 1 && $3 !~ /^(PASS|FAIL|BLOCKED|NOT_RUN)$/ { print $1 ":" $3 }' "$catalog")"
[[ -z "$invalid_statuses" ]] || fail "invalid test statuses: $invalid_statuses"

if grep -E '^[[:space:]]*[^#]*(SECRET|PRIVATE_KEY|PASSWORD|TOKEN)[A-Z0-9_]*=[^[:space:]#]+' "$repo_root/.env.example" >/dev/null; then
  fail ".env.example contains a non-empty secret-like value"
fi

echo "bootstrap contract verified: required docs present, 36 test IDs and statuses synchronized"
