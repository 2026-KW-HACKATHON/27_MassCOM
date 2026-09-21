#!/usr/bin/env bash
# Verifies an AAB signature against the approved upload certificate. Kept apart from the build so
# the signature verdict can be tested without Gradle.
#
# Usage: scripts/verify-aab-signature.sh <file.aab>
#   UPLOAD_CERT_SHA256   approved upload certificate fingerprint (colons and case are ignored).
#                        Falls back to apps/mobile/upload-certificate.sha256 when that file exists.
#                        A certificate fingerprint is public; the keystore and its passwords are not.
# Exit codes: 0 signature approved | 3 debug key | 4 unsigned | 5 signature broken | 6 another key
#             7 no approved fingerprint configured | 1 usage or tool failure
# An upload key is self-signed by design, so the certificate chain is deliberately not validated.
# Expiry is not checked either: trust comes from the pinned fingerprint, and Play decides validity.

set -euo pipefail

file="${1:?usage: verify-aab-signature.sh <file.aab>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$file" ]] || { echo "no such file: $file" >&2; exit 1; }

# English output: both tools localize their messages.
integrity="$(jarsigner -J-Duser.language=en -verify "$file" 2>&1 || true)"
if grep -q 'jar is unsigned' <<<"$integrity"; then
  echo "SIGNATURE REJECTED: the bundle is not signed" >&2
  exit 4
fi
if grep -q 'signed with a weak algorithm' <<<"$integrity"; then
  echo "SIGNATURE REJECTED: signed with an algorithm the JDK no longer trusts, so it counts as unsigned" >&2
  exit 4
fi
# jarsigner still says "jar verified" when files were added after signing; it only warns. -strict is
# no use here because it also fails every self-signed certificate, which an upload key always is.
if grep -q 'unsigned entries' <<<"$integrity"; then
  echo "SIGNATURE REJECTED: the bundle contains entries that were added after signing" >&2
  exit 5
fi
if ! grep -q '^jar verified' <<<"$integrity"; then
  echo "SIGNATURE REJECTED: the signature does not match the contents (modified or damaged after signing)" >&2
  exit 5
fi

signer="$(keytool -J-Duser.language=en -printcert -jarfile "$file" 2>&1 || true)"
actual="$(grep -E '^[[:space:]]*SHA256:' <<<"$signer" | head -1 | sed 's/.*SHA256:[[:space:]]*//' | tr -d ': \r' | tr 'a-f' 'A-F')"
signers="$(grep -cE '^[[:space:]]*SHA256:' <<<"$signer" || true)"
if [[ "$signers" -gt 1 ]]; then
  echo "SIGNATURE REJECTED: the bundle carries $signers signatures; exactly one upload signature is expected" >&2
  exit 6
fi
# The JAR format exempts META-INF/*.SF|RSA|DSA|EC from that warning, so a file smuggled in under
# such a name is invisible to jarsigner. One signer leaves exactly one .SF and one block file.
signature_files="$(unzip -Z1 "$file" | grep -ciE '^META-INF/[^/]+\.(SF|RSA|DSA|EC)$' || true)"
if [[ "$signature_files" != "2" ]]; then
  echo "SIGNATURE REJECTED: expected one signature file pair in META-INF, found $signature_files signature files" >&2
  exit 5
fi
if [[ ! "$actual" =~ ^[0-9A-F]{64}$ ]]; then
  echo "SIGNATURE REJECTED: no signing certificate could be read" >&2
  exit 4
fi
grep -E 'Owner:' <<<"$signer" | head -1 | sed 's/^ *//' || true
echo "certificate sha256: $actual"
if grep -q 'CN=Android Debug' <<<"$signer"; then
  echo "SIGNATURE REJECTED: signed with the local debug key" >&2
  exit 3
fi

expected="${UPLOAD_CERT_SHA256:-}"
pinned="$repo_root/apps/mobile/upload-certificate.sha256"
if [[ -z "$expected" && -f "$pinned" ]]; then expected="$(head -1 "$pinned")"; fi
expected="$(tr -d ': \r\n' <<<"$expected" | tr 'a-f' 'A-F')"
if [[ -z "$expected" ]]; then
  echo "SIGNATURE REJECTED: no approved upload certificate fingerprint is configured (UPLOAD_CERT_SHA256)" >&2
  exit 7
fi
if [[ "$actual" != "$expected" ]]; then
  echo "SIGNATURE REJECTED: signed with a key other than the approved upload key" >&2
  exit 6
fi
echo "signature verified against the approved upload certificate"
