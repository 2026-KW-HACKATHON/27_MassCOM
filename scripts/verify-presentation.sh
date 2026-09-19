#!/usr/bin/env bash

set -euo pipefail

repo_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
page="$repo_root/docs/presentation.html"
style="$repo_root/docs/assets/presentation.css"
portal="$repo_root/docs/index.html"
manifest="$repo_root/docs/SUBMISSION_EVIDENCE.json"
test_status="$repo_root/docs/TEST_STATUS.md"

for required in "$page" "$style" "$portal" "$manifest" "$test_status"; do
  if [[ ! -f "$required" ]]; then
    echo "missing presentation artifact: ${required#"$repo_root"/}" >&2
    exit 1
  fi
done

grep -q '<html lang="ko">' "$page"
grep -q 'id="scene-opening"' "$page"
grep -q 'id="scene-demo"' "$page"
grep -q 'id="scene-proof"' "$page"
grep -q 'data-evidence-state="NOT_RUN"' "$page"
grep -q 'PASS 26' "$page"
grep -q 'BLOCKED 2' "$page"
grep -q 'NOT_RUN 8' "$page"
grep -q 'presentation.html' "$portal"

if grep -Eqi '(매출 증가 (확인|달성)|Play 승인 완료|협약 점포 [1-9]|현장 참여자 [1-9])' "$page"; then
  echo "presentation contains an unsupported outcome claim" >&2
  exit 1
fi

node - "$manifest" "$test_status" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const testStatusFile = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const tests = manifest.requiredTests;
if (tests.total !== 36 || tests.PASS !== 26 || tests.BLOCKED !== 2 || tests.NOT_RUN !== 8 || tests.FAIL !== 0) {
  throw new Error('submission evidence test totals do not match TEST_STATUS');
}
if (manifest.truthBoundary.partnerStoresClaimed !== 0 || manifest.truthBoundary.fieldParticipantsClaimed !== 0) {
  throw new Error('submission evidence invents field achievements');
}
const rows = fs.readFileSync(testStatusFile, 'utf8')
  .split('\n')
  .filter((line) => /^\| (Q|R|W|M|C|D|A|O)\d{2} \|/.test(line));
const counts = rows.reduce((result, row) => {
  const status = row.split('|')[3].trim();
  result[status] = (result[status] ?? 0) + 1;
  return result;
}, {});
if (rows.length !== tests.total || counts.PASS !== tests.PASS || counts.BLOCKED !== tests.BLOCKED || counts.NOT_RUN !== tests.NOT_RUN) {
  throw new Error('submission evidence totals differ from TEST_STATUS');
}
NODE

echo "presentation and submission evidence verified"
