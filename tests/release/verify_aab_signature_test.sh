#!/usr/bin/env bash
# Exercises the upload verdict with small sample JARs (not Android builds) and the build script's
# control flow with stub build tools. Needs a JDK (keytool, jarsigner, jar) and zip.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verify="$repo_root/scripts/verify-aab-signature.sh"
work="$(mktemp -d -t aab-signature.XXXXXX)"
trap 'rm -rf "$work"' EXIT
pw="sample-$RANDOM-$RANDOM"

make_key() { # <file> <alias> <dname>
  keytool -genkeypair -keystore "$work/$1" -storepass "$pw" -keypass "$pw" -alias "$2" \
    -keyalg RSA -keysize 2048 -validity 2 -dname "$3" >/dev/null 2>&1
}
make_jar() { # <name> -> unsigned sample
  mkdir -p "$work/src-$1"; echo "sample $1" >"$work/src-$1/payload.txt"
  (cd "$work/src-$1" && zip -q -r "$work/$1.aab" .)
}
sign() { # <name> <keystore> <alias>
  jarsigner -keystore "$work/$2" -storepass "$pw" -keypass "$pw" "$work/$1.aab" "$3" >/dev/null 2>&1
}
fingerprint() { keytool -J-Duser.language=en -list -v -keystore "$work/$1" -storepass "$pw" 2>/dev/null | grep -E 'SHA256:' | head -1 | sed 's/.*SHA256: *//'; }
expect_with() { # <verifier> <label> <expected exit> <expected text> <fingerprint or ''> <file>
  local out status=0
  out="$(env -u UPLOAD_CERT_SHA256 ${5:+UPLOAD_CERT_SHA256="$5"} bash "$1" "$6" 2>&1)" || status=$?
  [[ "$status" == "$3" ]] || { echo "$2: expected exit $3, got $status: $out" >&2; exit 1; }
  grep -qF "$4" <<<"$out" || { echo "$2: missing '$4' in: $out" >&2; exit 1; }
}
expect() { expect_with "$verify" "$@"; }

make_key upload.jks upload 'CN=MassCOM Sample Upload Key'
make_key other.jks other 'CN=Somebody Else'
make_key debug.jks androiddebugkey 'CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US'
approved="$(fingerprint upload.jks)"

make_jar unsigned
expect 'unsigned bundle' 4 'SIGNATURE REJECTED: the bundle is not signed' "$approved" "$work/unsigned.aab"

make_jar good; sign good upload.jks upload
expect 'approved self-signed upload key' 0 'signature verified against the approved upload certificate' "$approved" "$work/good.aab"
expect 'lower-case fingerprint without colons' 0 'signature verified' "$(tr -d ':' <<<"$approved" | tr 'A-F' 'a-f')" "$work/good.aab"
no_pin_repo="$work/no-pin-repo"
mkdir -p "$no_pin_repo/scripts" "$no_pin_repo/apps/mobile"
cp "$verify" "$no_pin_repo/scripts/"
expect_with "$no_pin_repo/scripts/verify-aab-signature.sh" \
  'no approved fingerprint configured' 7 'SIGNATURE REJECTED: no approved upload certificate fingerprint' '' "$work/good.aab"

make_jar wrongkey; sign wrongkey other.jks other
expect 'signed with another key' 6 'SIGNATURE REJECTED: signed with a key other than the approved upload key' "$approved" "$work/wrongkey.aab"

make_jar debug; sign debug debug.jks androiddebugkey
expect 'debug key' 3 'SIGNATURE REJECTED: signed with the local debug key' "$approved" "$work/debug.aab"
expect 'debug key even if its fingerprint were approved' 3 'SIGNATURE REJECTED: signed with the local debug key' "$(fingerprint debug.jks)" "$work/debug.aab"

cp "$work/good.aab" "$work/tampered.aab"
echo "changed after signing" >"$work/src-good/payload.txt"
(cd "$work/src-good" && zip -q "$work/tampered.aab" payload.txt)
expect 'contents changed after signing' 5 'SIGNATURE REJECTED: the signature does not match the contents' "$approved" "$work/tampered.aab"

make_jar extra; sign extra upload.jks upload
echo "added after signing" >"$work/src-extra/injected.txt"
(cd "$work/src-extra" && zip -q "$work/extra.aab" injected.txt)
expect 'entry added after signing' 5 'SIGNATURE REJECTED: the bundle contains entries that were added after signing' "$approved" "$work/extra.aab"

make_jar smuggled; sign smuggled upload.jks upload
mkdir -p "$work/src-smuggled/META-INF"; echo "payload" >"$work/src-smuggled/META-INF/EVIL.SF"
(cd "$work/src-smuggled" && zip -q "$work/smuggled.aab" META-INF/EVIL.SF)
expect 'file smuggled in under a signature-file name' 5 'SIGNATURE REJECTED: expected one signature file pair' "$approved" "$work/smuggled.aab"

# Whichever order the two signatures are applied in, a second signer is never accepted.
make_jar two-a; sign two-a other.jks other; sign two-a upload.jks upload
expect 'two signers, approved key last' 6 'SIGNATURE REJECTED: the bundle carries' "$approved" "$work/two-a.aab"
make_jar two-b; sign two-b upload.jks upload; sign two-b other.jks other
expect 'two signers, approved key first' 6 'SIGNATURE REJECTED: the bundle carries' "$approved" "$work/two-b.aab"

make_jar weak
jarsigner -keystore "$work/upload.jks" -storepass "$pw" -keypass "$pw" -sigalg SHA1withRSA -digestalg SHA1 \
  "$work/weak.aab" upload >/dev/null 2>&1
expect 'weak signature algorithm' 4 'SIGNATURE REJECTED: signed with an algorithm the JDK no longer trusts' "$approved" "$work/weak.aab"

# Build script control flow: the reported artifact must survive --restore-dev, and the restore must
# not inherit APP_VARIANT=production from the caller.
sandbox="$work/repo"
mkdir -p "$sandbox/scripts" "$sandbox/apps/mobile/src" "$work/bin"
cp "$repo_root/scripts/build-release-aab.sh" \
  "$repo_root/scripts/verify-aab-signature.sh" \
  "$repo_root/scripts/assess-release-aab.sh" \
  "$repo_root/scripts/write-aab-provenance.mjs" \
  "$sandbox/scripts/"
cat >"$sandbox/scripts/check-release-wallet-surface.sh" <<'STUB'
#!/usr/bin/env bash
echo "release wallet surface verified: $(basename "$1"), package kr.masscom.wolgye"
STUB
chmod +x "$sandbox/scripts/check-release-wallet-surface.sh"
printf '{"expo":{"version":"0.1.0","android":{"versionCode":1}}}\n' >"$sandbox/apps/mobile/app.json"
printf 'fixture\n' >"$sandbox/apps/mobile/src/fixture.ts"
(cd "$sandbox" && git init -q && git add . && \
  git -c user.email=t@example.invalid -c user.name=t commit -q -m sample)
cat >"$work/bin/npx" <<STUB
#!/usr/bin/env bash
echo "prebuild APP_VARIANT=\${APP_VARIANT:-unset}" >>"$work/prebuild.log"
rm -rf android; mkdir -p android/app/build/outputs/bundle/release
printf "applicationId 'kr.masscom.wolgye'\nversionCode 1\n" >android/app/build.gradle
printf '#!/usr/bin/env bash\ncp "$work/good.aab" app/build/outputs/bundle/release/app-release.aab\n' >android/gradlew
chmod +x android/gradlew
STUB
chmod +x "$work/bin/npx"

# The production builder must reject every test-only gate control before prebuild. In particular,
# fake gates must never turn a release build green.
cat >"$work/fake-signature-pass" <<STUB
#!/usr/bin/env bash
touch '$work/fake-signature-ran'
echo 'certificate sha256: $(tr -d ':' <<<"$approved")'
STUB
cat >"$work/fake-w08-pass" <<STUB
#!/usr/bin/env bash
touch '$work/fake-w08-ran'
echo "release wallet surface verified: \$(basename "\$1"), package kr.masscom.wolgye"
STUB
chmod +x "$work/fake-signature-pass" "$work/fake-w08-pass"
rm -f "$work/prebuild.log" "$work/fake-signature-ran" "$work/fake-w08-ran"
status=0
out="$(cd "$sandbox" && env MASSCOM_TEST_MODE=true \
  AAB_SIGNATURE_CHECK_COMMAND="$work/fake-signature-pass" \
  AAB_WALLET_SURFACE_CHECK_COMMAND="$work/fake-w08-pass" \
  AAB_W08_CHECK_COMMAND="$work/fake-w08-pass" \
  RELEASE_ARTIFACT_DIR="$work/override-artifacts" \
  UPLOAD_CERT_SHA256="$approved" PATH="$work/bin:$PATH" \
  bash scripts/build-release-aab.sh 2>&1)" || status=$?
[[ "$status" != "0" ]] || { echo "test gate override produced a passing release build: $out" >&2; exit 1; }
[[ ! -e "$work/prebuild.log" ]] || { echo "test gate override reached prebuild: $(cat "$work/prebuild.log")" >&2; exit 1; }
[[ ! -e "$work/fake-signature-ran" && ! -e "$work/fake-w08-ran" ]] \
  || { echo 'test gate override executed a fake gate' >&2; exit 1; }

for variable in MASSCOM_TEST_MODE AAB_SIGNATURE_CHECK_COMMAND \
  AAB_WALLET_SURFACE_CHECK_COMMAND AAB_W08_CHECK_COMMAND EXPECTED_PACKAGE; do
  rm -f "$work/prebuild.log"
  status=0
  out="$(cd "$sandbox" && env -u MASSCOM_TEST_MODE -u AAB_SIGNATURE_CHECK_COMMAND \
    -u AAB_WALLET_SURFACE_CHECK_COMMAND -u AAB_W08_CHECK_COMMAND -u EXPECTED_PACKAGE \
    "$variable=$work/fake-signature-pass" RELEASE_ARTIFACT_DIR="$work/override-$variable" \
    UPLOAD_CERT_SHA256="$approved" PATH="$work/bin:$PATH" \
    bash scripts/build-release-aab.sh 2>&1)" || status=$?
  [[ "$status" != "0" ]] || { echo "$variable was accepted by the release builder: $out" >&2; exit 1; }
  [[ ! -e "$work/prebuild.log" ]] || { echo "$variable reached prebuild" >&2; exit 1; }
done

short_commit="$(git -C "$sandbox" rev-parse --short=7 HEAD)"
assert_preexisting_target_preserved() { # <label> <target suffix> <approved|missing pin>
  local label="$1" suffix="$2" pin="$3" artifact_dir="$work/preexisting-$1"
  local target="$artifact_dir/app-release-$short_commit$suffix" out status=0
  mkdir -p "$artifact_dir"
  printf 'sentinel-%s\n' "$label" >"$target"
  rm -f "$work/prebuild.log"
  if [[ "$pin" == approved ]]; then
    out="$(cd "$sandbox" && env RELEASE_ARTIFACT_DIR="$artifact_dir" \
      UPLOAD_CERT_SHA256="$approved" PATH="$work/bin:$PATH" \
      bash scripts/build-release-aab.sh 2>&1)" || status=$?
  else
    out="$(cd "$sandbox" && env -u UPLOAD_CERT_SHA256 RELEASE_ARTIFACT_DIR="$artifact_dir" \
      PATH="$work/bin:$PATH" bash scripts/build-release-aab.sh 2>&1)" || status=$?
  fi
  [[ "$status" != "0" ]] || { echo "$label: pre-existing target was accepted: $out" >&2; exit 1; }
  [[ "$(cat "$target")" == "sentinel-$label" ]] \
    || { echo "$label: pre-existing target was overwritten" >&2; exit 1; }
  [[ ! -e "$work/prebuild.log" ]] \
    || { echo "$label: pre-existing target was detected only after prebuild" >&2; exit 1; }
}
assert_preexisting_target_preserved accepted-aab '.aab' approved
assert_preexisting_target_preserved accepted-provenance '.provenance.json' approved
assert_preexisting_target_preserved rejected-aab '.NOT-RELEASE-READY-exit7.aab' missing
assert_preexisting_target_preserved rejected-provenance '.NOT-RELEASE-READY-exit7.provenance.json' missing

# An assessor infrastructure failure may return before writing provenance. The builder must preserve
# that exact exit without publishing an accepted or rejected final name from incomplete evidence.
cp "$sandbox/scripts/assess-release-aab.sh" "$work/real-assess-release-aab.sh"
cat >"$sandbox/scripts/assess-release-aab.sh" <<'STUB'
#!/usr/bin/env bash
echo 'assessor fixture failed before provenance' >&2
exit 23
STUB
chmod +x "$sandbox/scripts/assess-release-aab.sh"
incomplete_artifacts="$work/incomplete-artifacts"
status=0
out="$(cd "$sandbox" && env RELEASE_ARTIFACT_DIR="$incomplete_artifacts" \
  UPLOAD_CERT_SHA256="$approved" PATH="$work/bin:$PATH" \
  bash scripts/build-release-aab.sh 2>&1)" || status=$?
cp "$work/real-assess-release-aab.sh" "$sandbox/scripts/assess-release-aab.sh"
[[ "$status" == "23" ]] || { echo "incomplete assessment: expected exit 23, got $status: $out" >&2; exit 1; }
incomplete_base="$incomplete_artifacts/app-release-$short_commit"
[[ ! -e "$incomplete_base.aab" && ! -e "$incomplete_base.provenance.json" ]] \
  || { echo 'incomplete assessment published an accepted final name' >&2; exit 1; }
find "$incomplete_artifacts" -maxdepth 1 -name 'app-release-*.NOT-RELEASE-READY-*' -print -quit \
  | grep -q . && { echo 'incomplete assessment published a rejected final name' >&2; exit 1; }
incomplete_aab="$(sed -n 's/^AAB retained after incomplete assessment: //p' <<<"$out")"
[[ -f "$incomplete_aab" ]] || { echo "incomplete assessment lost its AAB: $out" >&2; exit 1; }

# If a target appears after the preflight but before the second publish, the first published link is
# rolled back, the raced-in sentinel is untouched, and the assessor's original rejection wins.
actual_ln="$(command -v ln)"
mkdir -p "$work/race-bin"
cat >"$work/race-bin/ln" <<STUB
#!/usr/bin/env bash
if [[ "\$2" == *.provenance.json ]]; then
  printf 'race-sentinel\n' >"\$2"
fi
exec '$actual_ln' "\$@"
STUB
chmod +x "$work/race-bin/ln"
race_artifacts="$work/race-artifacts"
race_base="$race_artifacts/app-release-$short_commit.NOT-RELEASE-READY-exit7"
status=0
out="$(cd "$sandbox" && env -u UPLOAD_CERT_SHA256 RELEASE_ARTIFACT_DIR="$race_artifacts" \
  PATH="$work/race-bin:$work/bin:$PATH" bash scripts/build-release-aab.sh 2>&1)" || status=$?
[[ "$status" == "7" ]] || { echo "publish race: expected assessor exit 7, got $status: $out" >&2; exit 1; }
[[ ! -e "$race_base.aab" ]] || { echo 'publish race left a partial rejected AAB' >&2; exit 1; }
[[ "$(cat "$race_base.provenance.json")" == race-sentinel ]] \
  || { echo 'publish race overwrote the provenance sentinel' >&2; exit 1; }
race_staged_aab="$(find "$race_artifacts" -type f -name 'app-release-*.aab' -print -quit)"
[[ -f "$race_staged_aab" ]] || { echo 'publish race did not retain the staged AAB' >&2; exit 1; }

accepted_artifacts="$work/accepted-artifacts"
status=0
out="$(cd "$sandbox" && env APP_VARIANT=production RELEASE_ARTIFACT_DIR="$accepted_artifacts" \
  UPLOAD_CERT_SHA256="$approved" PATH="$work/bin:$PATH" \
  bash scripts/build-release-aab.sh --restore-dev 2>&1)" || status=$?
[[ "$status" == "0" ]] || { echo "build flow: expected exit 0, got $status: $out" >&2; exit 1; }
reported="$(sed -n 's/^AAB: //p' <<<"$out")"
[[ -f "$reported" ]] || { echo "build flow: reported artifact is gone after --restore-dev: $reported" >&2; exit 1; }
[[ "$reported" != */android/* ]] || { echo "build flow: artifact still lives under android/: $reported" >&2; exit 1; }
provenance="${reported%.aab}.provenance.json"
[[ -f "$provenance" ]] || { echo "build flow: paired provenance is missing: $provenance" >&2; exit 1; }
[[ "$provenance" != */android/* ]] || { echo "build flow: provenance still lives under android/: $provenance" >&2; exit 1; }
node - "$reported" "$provenance" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const [artifactPath, provenancePath] = process.argv.slice(2);
const artifact = readFileSync(artifactPath);
const record = JSON.parse(readFileSync(provenancePath, 'utf8'));
const digest = createHash('sha256').update(artifact).digest('hex');
if (record.artifact.sha256 !== digest) throw new Error('provenance digest does not match copied AAB');
if (record.signature.status !== 'PASS') throw new Error('successful build did not record signature PASS');
if (record.walletSurface.status !== 'PASS') throw new Error('successful build did not record W08 PASS');
if (record.releaseReadiness.status !== 'NOT_RUN') throw new Error('successful build overstated release readiness');
NODE
grep -qF "Provenance: $provenance" <<<"$out" \
  || { echo "build flow: provenance path was not reported: $out" >&2; exit 1; }
grep -qF 'Automated gates: PASS' <<<"$out" \
  || { echo "build flow: automated gate status was not reported: $out" >&2; exit 1; }
grep -qF 'Release readiness: NOT_RUN' <<<"$out" \
  || { echo "build flow: release readiness was not reported: $out" >&2; exit 1; }
[[ "$out" != *UPLOADABLE* && "$out" != *READY* ]] \
  || { echo "build flow overstated release readiness: $out" >&2; exit 1; }
[[ "$(tail -1 "$work/prebuild.log")" == "prebuild APP_VARIANT=development" ]] \
  || { echo "build flow: restore inherited the caller's variant: $(cat "$work/prebuild.log")" >&2; exit 1; }

# A rejected build keeps the paired evidence under a name that states only the automated verdict.
: >"$work/prebuild.log"
rejected_artifacts="$work/rejected-artifacts"
status=0
out="$(cd "$sandbox" && env -u UPLOAD_CERT_SHA256 RELEASE_ARTIFACT_DIR="$rejected_artifacts" \
  PATH="$work/bin:$PATH" \
  bash scripts/build-release-aab.sh --restore-dev 2>&1)" || status=$?
[[ "$status" == "7" ]] || { echo "rejected build: expected exit 7, got $status: $out" >&2; exit 1; }
rejected_reported="$(sed -n 's/^AAB: //p' <<<"$out")"
[[ ! -f "$rejected_reported" ]] || { echo "rejected build left an artifact under the normal name" >&2; exit 1; }
[[ ! -f "${rejected_reported%.aab}.provenance.json" ]] \
  || { echo "rejected build left provenance under the normal name" >&2; exit 1; }
rejected_base="${rejected_reported%.aab}.NOT-RELEASE-READY-exit7"
[[ -f "$rejected_base.aab" ]] || { echo "rejected build lost its AAB: $rejected_base.aab" >&2; exit 1; }
[[ -f "$rejected_base.provenance.json" ]] \
  || { echo "rejected build lost its provenance: $rejected_base.provenance.json" >&2; exit 1; }
node - "$rejected_base.aab" "$rejected_base.provenance.json" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const [artifactPath, provenancePath] = process.argv.slice(2);
const artifact = readFileSync(artifactPath);
const record = JSON.parse(readFileSync(provenancePath, 'utf8'));
const digest = createHash('sha256').update(artifact).digest('hex');
if (record.artifact.sha256 !== digest) throw new Error('rejected provenance digest does not match retained AAB');
if (record.artifact.basename !== require('node:path').basename(artifactPath)) {
  throw new Error('rejected provenance basename does not match retained AAB');
}
if (record.signature.status !== 'FAIL' || record.signature.exitCode !== 7) {
  throw new Error('rejected provenance did not preserve the signature failure');
}
if (record.walletSurface.status !== 'PASS') throw new Error('rejected provenance did not preserve W08 PASS');
if (record.releaseReadiness.status !== 'NOT_RUN') throw new Error('rejected provenance overstated release readiness');
NODE
[[ "$(tail -1 "$work/prebuild.log")" == "prebuild APP_VARIANT=development" ]] \
  || { echo "rejected build did not restore the development variant: $(cat "$work/prebuild.log")" >&2; exit 1; }

echo "AAB signature and build flow tests passed"
