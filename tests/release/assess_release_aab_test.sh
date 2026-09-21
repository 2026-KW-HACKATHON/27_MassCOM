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
equal(record.android.sourceExpected.package, 'kr.masscom.wolgye', 'source-expected Android package');
equal(record.android.sourceExpected.versionName, '0.1.0', 'source-expected Android version name');
equal(record.android.sourceExpected.versionCode, 1, 'source-expected Android version code');
equal(record.android.w08VerifiedArtifactPackage, 'kr.masscom.wolgye', 'W08-verified artifact package');
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

# A disposable Git repository proves clean and already-dirty invocations without touching user files.
dirty_repo="$work/dirty-repo"
mkdir -p "$dirty_repo/scripts" "$dirty_repo/apps/mobile/src"
cp "$assess" "$writer" "$dirty_repo/scripts/"
printf '{"expo":{"version":"0.1.0","android":{"versionCode":1}}}\n' >"$dirty_repo/apps/mobile/app.json"
printf 'tracked\n' >"$dirty_repo/apps/mobile/src/tracked.ts"
git -C "$dirty_repo" init -q
git -C "$dirty_repo" add .
git -C "$dirty_repo" -c user.email=test@example.invalid -c user.name=Test \
  commit -q -m 'fixture baseline'

clean_provenance="$work/isolated-clean.provenance.json"
env MASSCOM_TEST_MODE=true \
  AAB_SIGNATURE_CHECK_COMMAND="$work/signature-pass" \
  AAB_WALLET_SURFACE_CHECK_COMMAND="$work/w08-pass" \
  bash "$dirty_repo/scripts/assess-release-aab.sh" \
  "$artifact" "$dirty_repo/apps/mobile/src" "$clean_provenance" >/dev/null 2>&1
printf 'invocation-owned dirty state\n' >"$dirty_repo/apps/mobile/src/dirty.ts"
dirty_provenance="$work/isolated-dirty.provenance.json"
env MASSCOM_TEST_MODE=true \
  AAB_SIGNATURE_CHECK_COMMAND="$work/signature-pass" \
  AAB_WALLET_SURFACE_CHECK_COMMAND="$work/w08-pass" \
  bash "$dirty_repo/scripts/assess-release-aab.sh" \
  "$artifact" "$dirty_repo/apps/mobile/src" "$dirty_provenance" >/dev/null 2>&1
node - "$clean_provenance" "$dirty_provenance" <<'NODE'
const fs = require('node:fs');
const clean = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dirty = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
if (clean.source.mobileDirty !== false) throw new Error('isolated clean checkout was not clean');
if (dirty.source.mobileDirty !== true) throw new Error('isolated initial dirty state was not recorded');
NODE

# rev-parse can succeed while status fails; failure to establish dirty state must abort before gates.
actual_git="$(command -v git)"
mkdir -p "$work/git-fail-bin"
cat >"$work/git-fail-bin/git" <<STUB
#!/usr/bin/env bash
if [[ " \$* " == *' status '* ]]; then
  echo 'simulated git status failure' >&2
  exit 42
fi
exec '$actual_git' "\$@"
STUB
chmod +x "$work/git-fail-bin/git"
status_failure_provenance="$work/status-failure.provenance.json"
rm -f "$work/status-failure-gate-ran"
cat >"$work/status-failure-signature" <<STUB
#!/usr/bin/env bash
touch '$work/status-failure-gate-ran'
exit 0
STUB
chmod +x "$work/status-failure-signature"
status=0
env PATH="$work/git-fail-bin:$PATH" MASSCOM_TEST_MODE=true \
  AAB_SIGNATURE_CHECK_COMMAND="$work/status-failure-signature" \
  AAB_WALLET_SURFACE_CHECK_COMMAND="$work/w08-pass" \
  bash "$assess" "$artifact" "$repo_root/apps/mobile/src" "$status_failure_provenance" >/dev/null 2>&1 \
  || status=$?
[[ "$status" == 42 ]] || { echo "git status failure: expected exit 42, got $status" >&2; exit 1; }
[[ ! -e "$status_failure_provenance" ]] || { echo 'git status failure wrote provenance' >&2; exit 1; }
[[ ! -e "$work/status-failure-gate-ran" ]] || { echo 'git status failure still ran a gate' >&2; exit 1; }

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
if (record.android.w08VerifiedArtifactPackage !== null) {
  throw new Error('failed W08 claimed an artifact package');
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

# EXPECTED_PACKAGE is another W08 override and is forbidden outside exact test mode.
rejected_expected_package="$work/rejected-expected-package.json"
status=0
error="$(env -u MASSCOM_TEST_MODE -u AAB_SIGNATURE_CHECK_COMMAND -u AAB_WALLET_SURFACE_CHECK_COMMAND \
  EXPECTED_PACKAGE=com.attacker.release \
  bash "$assess" "$artifact" "$repo_root/apps/mobile/src" "$rejected_expected_package" 2>&1)" \
  || status=$?
[[ "$status" != 0 ]] || { echo 'production EXPECTED_PACKAGE override was accepted' >&2; exit 1; }
grep -qF 'EXPECTED_PACKAGE requires MASSCOM_TEST_MODE=true' <<<"$error" \
  || { echo "production EXPECTED_PACKAGE failed for an unrelated reason: $error" >&2; exit 1; }
[[ ! -e "$rejected_expected_package" ]] || { echo 'rejected EXPECTED_PACKAGE wrote provenance' >&2; exit 1; }

# Even in test mode, a W08 PASS package must exactly match the source-expected production package.
cat >"$work/w08-mismatched-package" <<'STUB'
#!/usr/bin/env bash
echo "release wallet surface verified: $(basename "$1"), package com.attacker.release"
STUB
chmod +x "$work/w08-mismatched-package"
mismatched_package_provenance="$work/mismatched-package.provenance.json"
status=0
error="$(env MASSCOM_TEST_MODE=true EXPECTED_PACKAGE=com.attacker.release \
  AAB_SIGNATURE_CHECK_COMMAND="$work/signature-pass" \
  AAB_WALLET_SURFACE_CHECK_COMMAND="$work/w08-mismatched-package" \
  bash "$assess" "$artifact" "$repo_root/apps/mobile/src" "$mismatched_package_provenance" 2>&1)" \
  || status=$?
[[ "$status" != 0 ]] || { echo 'mismatched W08 PASS package was accepted' >&2; exit 1; }
grep -qF 'W08-verified artifact package must match source-expected Android package' <<<"$error" \
  || { echo "mismatched package failed for an unrelated reason: $error" >&2; exit 1; }
[[ ! -e "$mismatched_package_provenance" ]] || { echo 'mismatched package wrote provenance' >&2; exit 1; }

# Neither a canonical-path alias nor another inode link may let provenance overwrite the AAB.
cat >"$work/collision-gate" <<STUB
#!/usr/bin/env bash
touch '$work/collision-gate-ran'
echo 'certificate sha256: $fingerprint'
echo 'release wallet surface verified: collision.aab, package kr.masscom.wolgye'
STUB
chmod +x "$work/collision-gate"
assert_collision_rejected() { # <artifact> <output>
  local candidate_artifact="$1" candidate_output="$2" before status=0
  before="$(shasum -a 256 "$candidate_artifact" | cut -d' ' -f1)"
  rm -f "$work/collision-gate-ran"
  env MASSCOM_TEST_MODE=true \
    AAB_SIGNATURE_CHECK_COMMAND="$work/collision-gate" \
    AAB_WALLET_SURFACE_CHECK_COMMAND="$work/collision-gate" \
    bash "$assess" "$candidate_artifact" "$repo_root/apps/mobile/src" "$candidate_output" >/dev/null 2>&1 \
    || status=$?
  [[ "$status" != 0 ]] || { echo 'artifact/provenance collision was accepted' >&2; exit 1; }
  [[ ! -e "$work/collision-gate-ran" ]] || { echo 'collision ran automated gates' >&2; exit 1; }
  [[ "$(shasum -a 256 "$candidate_artifact" | cut -d' ' -f1)" == "$before" ]] \
    || { echo 'collision modified the artifact' >&2; exit 1; }
}
cp "$artifact" "$work/canonical-collision.aab"
assert_collision_rejected "$work/canonical-collision.aab" "$work/./canonical-collision.aab"
cp "$artifact" "$work/inode-collision.aab"
ln "$work/inode-collision.aab" "$work/inode-collision.provenance.json"
assert_collision_rejected "$work/inode-collision.aab" "$work/inode-collision.provenance.json"

# The writer has a stable field order/format for identical explicit inputs and validates its trust boundary.
writer_args=(
  --artifact "$artifact"
  --artifact-sha256 "$expected_sha"
  --artifact-bytes "$expected_bytes"
  --source-commit "$expected_commit"
  --mobile-dirty false
  --source-expected-android-package kr.masscom.wolgye
  --source-expected-android-version-name 0.1.0
  --source-expected-android-version-code 1
  --w08-verified-artifact-package kr.masscom.wolgye
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
finalized_basename='tiny-release.NOT-RELEASE-READY-exit7.aab'
node "$writer" \
  --input "$work/writer-a.json" \
  --output "$work/writer-finalized.json" \
  --finalize-artifact-basename "$finalized_basename"
node - "$work/writer-a.json" "$work/writer-finalized.json" "$finalized_basename" <<'NODE'
const fs = require('node:fs');
const [inputPath, outputPath, expectedBasename] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
if (output.artifact.basename !== expectedBasename) throw new Error('finalized basename was not applied');
output.artifact.basename = input.artifact.basename;
if (JSON.stringify(output) !== JSON.stringify(input)) throw new Error('finalization changed fields other than basename');
NODE

printf 'finalization-sentinel\n' >"$work/existing-finalized.json"
status=0
error="$(node "$writer" \
  --input "$work/writer-a.json" \
  --output "$work/existing-finalized.json" \
  --finalize-artifact-basename "$finalized_basename" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo 'finalization overwrote an existing output' >&2; exit 1; }
grep -qF 'provenance output already exists' <<<"$error" \
  || { echo "finalization collision failed for an unrelated reason: $error" >&2; exit 1; }
[[ "$(cat "$work/existing-finalized.json")" == finalization-sentinel ]] \
  || { echo 'finalization changed an existing output' >&2; exit 1; }

printf 'writer-sentinel\n' >"$work/existing-writer.json"
status=0
error="$(node "$writer" --output "$work/existing-writer.json" "${writer_args[@]}" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo 'writer overwrote an existing output' >&2; exit 1; }
grep -qF 'provenance output already exists' <<<"$error" \
  || { echo "writer collision failed for an unrelated reason: $error" >&2; exit 1; }
[[ "$(cat "$work/existing-writer.json")" == writer-sentinel ]] \
  || { echo 'writer changed an existing output' >&2; exit 1; }

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
expect_writer_reject 'signature PASS with nonzero exit' 'signature PASS requires exit code 0' \
  --signature-exit-code 6
expect_writer_reject 'signature FAIL with zero exit' 'signature FAIL requires a nonzero exit code' \
  --signature-status FAIL
expect_writer_reject 'wallet PASS with nonzero exit' 'wallet surface PASS requires exit code 0' \
  --wallet-surface-exit-code 9
expect_writer_reject 'wallet FAIL with zero exit' 'wallet surface FAIL requires a nonzero exit code' \
  --wallet-surface-status FAIL
expect_writer_reject 'signature BLOCKED with zero exit' 'signature status must be PASS or FAIL' \
  --signature-status BLOCKED
expect_writer_reject 'wallet NOT_RUN with zero exit' 'wallet surface status must be PASS or FAIL' \
  --wallet-surface-status NOT_RUN
expect_writer_reject 'signature PASS without certificate' 'signature PASS requires a certificate fingerprint' \
  --signature-certificate-sha256 ''
expect_writer_reject 'wallet PASS without verified package' 'wallet surface PASS requires a verified artifact package' \
  --w08-verified-artifact-package ''
expect_writer_reject 'writer artifact/output collision' 'provenance output must not refer to the artifact' \
  --output "$artifact"

echo 'AAB assessment provenance tests passed'
