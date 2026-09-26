#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
script="$repo_root/scripts/prepare-showcase-runtime.sh"
scratch="$(mktemp -d)"
repo_scratch="$(mktemp -d "$repo_root/.showcase-runtime-test.XXXXXX")"
common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)"
main_root="$(dirname "$common_dir")"
main_scratch="$(mktemp -d "$main_root/.showcase-runtime-test.XXXXXX")"
trap 'rm -rf -- "$scratch" "$repo_scratch" "$main_scratch"' EXIT
target="$scratch/runtime.env"
demo_client='123-demo.apps.googleusercontent.com'
operating_client='456-operating.apps.googleusercontent.com'
invite_hash="$(printf 'a%.0s' {1..64})"

run_preparer() {
  MASSCOM_SHOWCASE_RUNTIME_OUTPUT="$target" \
    MASSCOM_SHOWCASE_IMAGE_TAG=8d69c5b \
    SHOWCASE_GOOGLE_WEB_CLIENT_ID="$demo_client" \
    MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID="$operating_client" \
    SHOWCASE_INVITED_SUBJECT_SHA256="$invite_hash" \
    bash "$script"
}

output="$(run_preparer 2>&1)"
[[ "$output" == 'showcase runtime created (secrets not printed)' ]]

node - "$target" "$demo_client" "$invite_hash" <<'NODE'
const assert = require('node:assert/strict');
const { readFileSync, statSync } = require('node:fs');
const [path, client, invite] = process.argv.slice(2);
const body = readFileSync(path, 'utf8');
const fields = new Map(body.trimEnd().split('\n').map((line) => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
assert.equal(statSync(path).mode & 0o777, 0o600);
assert.equal(fields.get('MASSCOM_SHOWCASE_IMAGE_TAG'), '8d69c5b');
assert.equal(fields.get('SHOWCASE_GOOGLE_WEB_CLIENT_ID'), client);
assert.equal(fields.get('SHOWCASE_INVITED_SUBJECT_SHA256'), invite);
assert.equal(fields.get('SHOWCASE_STAFF_SUBJECT_SHA256'), '');
for (const key of [
  'SHOWCASE_HOST_POSTGRES_PASSWORD',
  'SHOWCASE_ACCOUNT_DELETION_HMAC_SECRET',
  'SHOWCASE_MERCHANT_REFERENCE_HMAC_SECRET',
]) assert.match(fields.get(key), /^[0-9a-f]{64}$/);
assert.equal(new Set([
  fields.get('SHOWCASE_HOST_POSTGRES_PASSWORD'),
  fields.get('SHOWCASE_ACCOUNT_DELETION_HMAC_SECRET'),
  fields.get('SHOWCASE_MERCHANT_REFERENCE_HMAC_SECRET'),
]).size, 3);
NODE

before="$(shasum -a 256 "$target")"
if run_preparer >"$scratch/retry.log" 2>&1; then
  echo 'existing runtime unexpectedly overwritten' >&2
  exit 1
fi
[[ "$(shasum -a 256 "$target")" == "$before" ]]
! grep -Eq '[0-9a-f]{64}' "$scratch/retry.log"

mkdir "$scratch/badaudience"
if MASSCOM_SHOWCASE_RUNTIME_OUTPUT="$scratch/badaudience/runtime.env" \
  MASSCOM_SHOWCASE_IMAGE_TAG=8d69c5b \
  SHOWCASE_GOOGLE_WEB_CLIENT_ID="$operating_client" \
  MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID="$operating_client" \
  SHOWCASE_INVITED_SUBJECT_SHA256="$invite_hash" \
  bash "$script" >"$scratch/invalid.log" 2>&1; then
  echo 'operating Google audience unexpectedly accepted' >&2
  exit 1
fi
[[ ! -e "$scratch/badaudience/runtime.env" ]]
grep -q 'dedicated Google audience required' "$scratch/invalid.log"

second_hash="$(printf 'b%.0s' {1..64})"
mkdir "$scratch/badstaff"
if MASSCOM_SHOWCASE_RUNTIME_OUTPUT="$scratch/badstaff/runtime.env" \
  MASSCOM_SHOWCASE_IMAGE_TAG=8d69c5b \
  SHOWCASE_GOOGLE_WEB_CLIENT_ID="$demo_client" \
  MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID="$operating_client" \
  SHOWCASE_INVITED_SUBJECT_SHA256="$invite_hash,$second_hash" \
  SHOWCASE_STAFF_SUBJECT_SHA256="$invite_hash,$second_hash" \
  bash "$script" >"$scratch/staff.log" 2>&1; then
  echo 'multiple staff hashes unexpectedly accepted' >&2
  exit 1
fi
[[ ! -e "$scratch/badstaff/runtime.env" ]]

if MASSCOM_SHOWCASE_RUNTIME_OUTPUT="$repo_scratch/runtime.env" \
  MASSCOM_SHOWCASE_IMAGE_TAG=8d69c5b \
  SHOWCASE_GOOGLE_WEB_CLIENT_ID="$demo_client" \
  MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID="$operating_client" \
  SHOWCASE_INVITED_SUBJECT_SHA256="$invite_hash" \
  bash "$script" >"$scratch/repository.log" 2>&1; then
  echo 'repository-local secret file unexpectedly accepted' >&2
  exit 1
fi
[[ ! -e "$repo_scratch/runtime.env" ]]
grep -q 'runtime must stay outside the source repository' "$scratch/repository.log"

if MASSCOM_SHOWCASE_RUNTIME_OUTPUT="$main_scratch/runtime.env" \
  MASSCOM_SHOWCASE_IMAGE_TAG=8d69c5b \
  SHOWCASE_GOOGLE_WEB_CLIENT_ID="$demo_client" \
  MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID="$operating_client" \
  SHOWCASE_INVITED_SUBJECT_SHA256="$invite_hash" \
  bash "$script" >"$scratch/main-checkout.log" 2>&1; then
  echo 'main-checkout secret file unexpectedly accepted' >&2
  exit 1
fi
[[ ! -e "$main_scratch/runtime.env" ]]
if [[ "$main_root" != "$repo_root" ]]; then
  grep -q 'runtime must stay outside any Git checkout' "$scratch/main-checkout.log"
else
  grep -q 'runtime must stay outside the source repository' "$scratch/main-checkout.log"
fi

echo 'showcase runtime generation boundaries verified'
