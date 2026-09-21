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
mkdir -p "$sandbox/scripts" "$sandbox/apps/mobile" "$work/bin"
cp "$repo_root/scripts/build-release-aab.sh" "$repo_root/scripts/verify-aab-signature.sh" "$sandbox/scripts/"
(cd "$sandbox" && git init -q && git -c user.email=t@example.invalid -c user.name=t commit -q --allow-empty -m sample)
cat >"$work/bin/npx" <<STUB
#!/usr/bin/env bash
echo "prebuild APP_VARIANT=\${APP_VARIANT:-unset}" >>"$work/prebuild.log"
rm -rf android; mkdir -p android/app/build/outputs/bundle/release
printf "applicationId 'kr.masscom.wolgye'\nversionCode 1\n" >android/app/build.gradle
printf '#!/usr/bin/env bash\ncp "$work/good.aab" app/build/outputs/bundle/release/app-release.aab\n' >android/gradlew
chmod +x android/gradlew
STUB
chmod +x "$work/bin/npx"
status=0
out="$(cd "$sandbox" && env APP_VARIANT=production UPLOAD_CERT_SHA256="$approved" PATH="$work/bin:$PATH" \
  bash scripts/build-release-aab.sh --restore-dev 2>&1)" || status=$?
[[ "$status" == "0" ]] || { echo "build flow: expected exit 0, got $status: $out" >&2; exit 1; }
reported="$(sed -n 's/^AAB: //p' <<<"$out")"
[[ -f "$reported" ]] || { echo "build flow: reported artifact is gone after --restore-dev: $reported" >&2; exit 1; }
[[ "$reported" != */android/* ]] || { echo "build flow: artifact still lives under android/: $reported" >&2; exit 1; }
[[ "$(tail -1 "$work/prebuild.log")" == "prebuild APP_VARIANT=development" ]] \
  || { echo "build flow: restore inherited the caller's variant: $(cat "$work/prebuild.log")" >&2; exit 1; }

# A rejected build keeps its artifact, but under a name nobody can mistake for an uploadable one.
status=0
out="$(cd "$sandbox" && env -u UPLOAD_CERT_SHA256 PATH="$work/bin:$PATH" bash scripts/build-release-aab.sh 2>&1)" || status=$?
[[ "$status" == "7" ]] || { echo "rejected build: expected exit 7, got $status: $out" >&2; exit 1; }
[[ ! -f "$(sed -n 's/^AAB: //p' <<<"$out")" ]] || { echo "rejected build left an artifact under the normal name" >&2; exit 1; }
ls "$sandbox"/apps/mobile/release-artifacts/*.NOT-UPLOADABLE-exit7.aab >/dev/null

echo "AAB signature and build flow tests passed"
