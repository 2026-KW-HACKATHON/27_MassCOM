#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-evidence-consistency.mjs"
[[ -f "$verifier" ]] || { echo 'missing evidence consistency verifier' >&2; exit 1; }
node "$verifier" "$repo_root"

fixture="$(mktemp -d -t evidence-consistency.XXXXXX)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/docs" "$fixture/tests/catalog"
cp "$repo_root/README.md" "$fixture/README.md"
cp "$repo_root/tests/catalog/required-tests.tsv" "$fixture/tests/catalog/required-tests.tsv"
cp "$repo_root/docs/TEST_STATUS.md" "$fixture/docs/TEST_STATUS.md"
cp "$repo_root/docs/index.html" "$fixture/docs/index.html"
cp "$repo_root/docs/PROJECT_STATE.md" "$fixture/docs/PROJECT_STATE.md"
cp "$repo_root/docs/HANDOFF.md" "$fixture/docs/HANDOFF.md"
cp "$repo_root/docs/SUBMISSION_EVIDENCE.json" "$fixture/docs/SUBMISSION_EVIDENCE.json"
cp -R "$repo_root/docs/evidence" "$fixture/docs/evidence"

assert_mutation_fails() { # <file> <from> <to>
  local file="$1" from="$2" to="$3"
  cp "$fixture/$file" "$fixture/$file.backup"
  sed "s/$from/$to/" "$fixture/$file.backup" > "$fixture/$file"
  if cmp -s "$fixture/$file.backup" "$fixture/$file"; then
    echo "evidence mutation did not change $file: $from" >&2
    exit 1
  fi
  if node "$verifier" "$fixture" >/dev/null 2>&1; then
    echo "evidence verifier accepted drift in $file: $from" >&2
    exit 1
  fi
  mv "$fixture/$file.backup" "$fixture/$file"
}

assert_mutation_fails docs/index.html '31 PASS · 2 BLOCKED · 3 NOT_RUN' '30 PASS · 2 BLOCKED · 4 NOT_RUN'
assert_mutation_fails README.md '31 `PASS` \/ 2 `BLOCKED` \/ 3 `NOT_RUN`' '30 `PASS` \/ 2 `BLOCKED` \/ 4 `NOT_RUN`'
assert_mutation_fails docs/PROJECT_STATE.md '31 PASS \/ 2 BLOCKED \/ 3 NOT_RUN' '30 PASS \/ 2 BLOCKED \/ 4 NOT_RUN'
assert_mutation_fails docs/HANDOFF.md '31 PASS \/ 2 BLOCKED \/ 3 NOT_RUN' '30 PASS \/ 2 BLOCKED \/ 4 NOT_RUN'
assert_mutation_fails docs/SUBMISSION_EVIDENCE.json '"partnerStoresClaimed": 0' '"partnerStoresClaimed": 1'
assert_mutation_fails docs/SUBMISSION_EVIDENCE.json '"fieldParticipantsClaimed": 0' '"fieldParticipantsClaimed": 1'
assert_mutation_fails docs/SUBMISSION_EVIDENCE.json '"total": 36' '"total": 35'
baseline_commit="$(node -e "const m=require(process.argv[1]); process.stdout.write(m.baselineCommit)" \
  "$fixture/docs/SUBMISSION_EVIDENCE.json")"
assert_mutation_fails docs/SUBMISSION_EVIDENCE.json \
  "\"baselineCommit\": \"$baseline_commit\"" \
  '"baselineCommit": "not-a-commit"'

echo 'evidence consistency regression tests passed'
