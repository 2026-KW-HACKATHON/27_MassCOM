#!/usr/bin/env bash
# Exercises the release assessor with local gate executables, so no Android build or upload key is needed.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
assess="$repo_root/scripts/assess-release-aab.sh"
writer="$repo_root/scripts/write-aab-provenance.mjs"
work="$(mktemp -d -t aab-assessment.XXXXXX)"
trap 'rm -rf "$work"' EXIT

artifact="$work/tiny-release.aab"
printf 'tiny deterministic AAB fixture\n' >"$artifact"
expected_sha="$(shasum -a 256 "$artifact" | cut -d' ' -f1)"
expected_bytes="$(wc -c <"$artifact" | tr -d ' ')"
expected_commit="$(git -C "$repo_root" rev-parse HEAD)"
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal -- apps/mobile)" ]]; then
  expected_dirty=true
else
  expected_dirty=false
fi
fingerprint='0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF'

cat >"$work/signature-pass" <<STUB
#!/usr/bin/env bash
echo 'Owner: CN=MassCOM Fixture'
echo 'certificate sha256: $fingerprint'
echo 'signature verified against the approved upload certificate'
STUB
cat >"$work/w08-pass" <<'STUB'
#!/usr/bin/env bash
echo "release wallet surface verified: $(basename "$1"), package kr.masscom.wolgye"
STUB
chmod +x "$work/signature-pass" "$work/w08-pass"

provenance="$work/tiny-release.provenance.json"
secret='must-not-appear-in-provenance'
out="$(env \
  MASSCOM_TEST_MODE=true \
  MASSCOM_PROVENANCE_SECRET="$secret" \
  AAB_SIGNATURE_CHECK_COMMAND="$work/signature-pass" \
  AAB_WALLET_SURFACE_CHECK_COMMAND="$work/w08-pass" \
  bash "$assess" "$artifact" "$repo_root/apps/mobile/src" "$provenance" 2>&1)"
[[ "$out" == *"$provenance"* ]] || { echo "assessor did not print provenance path: $out" >&2; exit 1; }

node - "$provenance" "$expected_sha" "$expected_bytes" "$expected_commit" "$expected_dirty" "$fingerprint" "$secret" <<'NODE'
const fs = require('node:fs');

const [path, expectedSha, expectedBytes, expectedCommit, expectedDirty, fingerprint, secret] = process.argv.slice(2);
const raw = fs.readFileSync(path, 'utf8');
const record = JSON.parse(raw);
const fail = (message) => { throw new Error(message); };
const equal = (actual, expected, label) => {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

equal(record.schema, 'masscom.aab-provenance.v1', 'schema');
equal(record.artifact.basename, 'tiny-release.aab', 'artifact basename');
equal(record.artifact.sha256, expectedSha, 'artifact sha256');
equal(record.artifact.bytes, Number(expectedBytes), 'artifact bytes');
equal(record.source.commit, expectedCommit, 'source commit');
equal(record.source.mobileDirty, expectedDirty === 'true', 'source mobileDirty');
equal(record.android.package, 'kr.masscom.wolgye', 'Android package');
equal(record.android.versionName, '0.1.0', 'Android version name');
equal(record.android.versionCode, 1, 'Android version code');
equal(record.signature.status, 'PASS', 'signature status');
equal(record.signature.exitCode, 0, 'signature exit code');
equal(record.signature.certificateSha256, fingerprint, 'certificate fingerprint');
equal(record.walletSurface.status, 'PASS', 'wallet-surface status');
equal(record.walletSurface.exitCode, 0, 'wallet-surface exit code');
equal(record.releaseReadiness.status, 'NOT_RUN', 'release readiness status');
equal(
  JSON.stringify(record.releaseReadiness.pending),
  JSON.stringify(['A02_DEVICE_INSTALL', 'APP_LINKS', 'PLAY_UPLOAD_AND_REVIEW']),
  'pending manual gates',
);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.generatedAt)) {
  fail(`generatedAt is not an ISO timestamp: ${record.generatedAt}`);
}
if (raw.includes(secret)) fail('provenance captured an unrelated environment secret');
NODE

# Each automated gate is an independent subprocess. Both results are recorded, then the first
# failing gate's code is returned only after provenance has been written.
cat >"$work/signature-fail" <<'STUB'
#!/usr/bin/env bash
echo 'signature fixture rejected' >&2
exit 6
STUB
cat >"$work/w08-fail" <<STUB
#!/usr/bin/env bash
touch '$work/w08-ran'
echo 'wallet fixture rejected' >&2
exit 9
STUB
chmod +x "$work/signature-fail" "$work/w08-fail"
failed_provenance="$work/failed.provenance.json"
status=0
env MASSCOM_TEST_MODE=true \
  AAB_SIGNATURE_CHECK_COMMAND="$work/signature-fail" \
  AAB_WALLET_SURFACE_CHECK_COMMAND="$work/w08-fail" \
  bash "$assess" "$artifact" "$repo_root/apps/mobile/src" "$failed_provenance" >/dev/null 2>&1 \
  || status=$?
[[ "$status" == 6 ]] || { echo "expected first automated gate exit 6, got $status" >&2; exit 1; }
[[ -f "$failed_provenance" ]] || { echo 'failed assessment did not write provenance' >&2; exit 1; }
[[ -f "$work/w08-ran" ]] || { echo 'W08 subprocess did not run after signature failure' >&2; exit 1; }
node - "$failed_provenance" <<'NODE'
const record = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
if (record.signature.status !== 'FAIL' || record.signature.exitCode !== 6) {
  throw new Error(`wrong failed signature verdict: ${JSON.stringify(record.signature)}`);
}
if (record.walletSurface.status !== 'FAIL' || record.walletSurface.exitCode !== 9) {
  throw new Error(`wrong failed W08 verdict: ${JSON.stringify(record.walletSurface)}`);
}
if (record.releaseReadiness.status !== 'NOT_RUN') {
  throw new Error('automated failure changed manual release readiness');
}
NODE

# Production callers cannot replace either gate executable.
rejected_override="$work/rejected-override.json"
status=0
env -u MASSCOM_TEST_MODE AAB_SIGNATURE_CHECK_COMMAND="$work/signature-pass" \
  bash "$assess" "$artifact" "$repo_root/apps/mobile/src" "$rejected_override" >/dev/null 2>&1 \
  || status=$?
[[ "$status" != 0 ]] || { echo 'production override was accepted' >&2; exit 1; }
[[ ! -e "$rejected_override" ]] || { echo 'rejected override still wrote provenance' >&2; exit 1; }

# The writer has a stable field order/format for identical explicit inputs and validates its trust boundary.
writer_args=(
  --artifact "$artifact"
  --artifact-sha256 "$expected_sha"
  --artifact-bytes "$expected_bytes"
  --source-commit "$expected_commit"
  --mobile-dirty false
  --android-package kr.masscom.wolgye
  --android-version-name 0.1.0
  --android-version-code 1
  --signature-status pass
  --signature-exit-code 0
  --signature-certificate-sha256 "$fingerprint"
  --wallet-surface-status pass
  --wallet-surface-exit-code 0
  --release-readiness-status not_run
  --release-readiness-pending A02_DEVICE_INSTALL,APP_LINKS,PLAY_UPLOAD_AND_REVIEW
  --generated-at 2026-09-21T00:00:00.000Z
)
node "$writer" --output "$work/writer-a.json" "${writer_args[@]}"
node "$writer" --output "$work/writer-b.json" "${writer_args[@]}"
cmp "$work/writer-a.json" "$work/writer-b.json"
node "$writer" --output "$work/release-ready.json" "${writer_args[@]}" \
  --release-readiness-status PASS --release-readiness-pending ''
node -e \
  "const r=require(process.argv[1]); if(r.releaseReadiness.status!=='PASS'||r.releaseReadiness.pending.length!==0) process.exit(1)" \
  "$work/release-ready.json"

expect_writer_reject() {
  local label="$1" expected="$2"; shift 2
  local error status=0
  error="$(node "$writer" --output "$work/rejected.json" "${writer_args[@]}" "$@" 2>&1)" || status=$?
  [[ "$status" != 0 ]] || { echo "$label: expected rejection" >&2; exit 1; }
  grep -qF "$expected" <<<"$error" || { echo "$label: unrelated error: $error" >&2; exit 1; }
}
expect_writer_reject 'missing artifact' 'artifact does not exist' --artifact "$work/missing.aab"
expect_writer_reject 'malformed digest' 'artifact sha256 must be 64 hexadecimal characters' --artifact-sha256 bad
expect_writer_reject 'unknown status' 'unknown signature status' --signature-status MAYBE
expect_writer_reject 'manual gates still pending' 'release readiness cannot pass with pending gates' \
  --release-readiness-status PASS

echo 'AAB assessment provenance tests passed'
