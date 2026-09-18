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
  scripts/check-secrets.sh
  tests/bootstrap/check_secrets_test.sh
  tests/catalog/required-tests.tsv
)

for relative_path in "${required_files[@]}"; do
  [[ -s "$repo_root/$relative_path" ]] || fail "missing or empty $relative_path"
done

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
done

invalid_statuses="$(awk -F '\t' 'NR > 1 && $3 !~ /^(PASS|FAIL|BLOCKED|NOT_RUN)$/ { print $1 ":" $3 }' "$catalog")"
[[ -z "$invalid_statuses" ]] || fail "invalid test statuses: $invalid_statuses"

if grep -E '^[[:space:]]*[^#]*(SECRET|PRIVATE_KEY|PASSWORD|TOKEN)[A-Z0-9_]*=[^[:space:]#]+' "$repo_root/.env.example" >/dev/null; then
  fail ".env.example contains a non-empty secret-like value"
fi

echo "bootstrap contract verified: required docs present, 36 test IDs preserved, statuses valid"
