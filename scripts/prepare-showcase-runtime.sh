#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { echo "showcase runtime refused: $1" >&2; exit 1; }

target="${MASSCOM_SHOWCASE_RUNTIME_OUTPUT:-}"
[[ "$target" == /* && "$(basename "$target")" == runtime.env ]] ||
  fail 'absolute runtime.env target required'
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
parent="$(dirname "$target")"
[[ -d "$parent" && ! -L "$parent" && ! -e "$target" && ! -L "$target" ]] ||
  fail 'target directory missing or runtime already exists'
parent="$(cd -P "$parent" && pwd -P)"
[[ "$parent" != "$repo_root" && "$parent" != "$repo_root"/* ]] ||
  fail 'runtime must stay outside the source repository'
if git -C "$parent" rev-parse --is-inside-work-tree --is-inside-git-dir 2>/dev/null | grep -qx true; then
  fail 'runtime must stay outside any Git checkout'
fi

tag="${MASSCOM_SHOWCASE_IMAGE_TAG:-}"
client="${SHOWCASE_GOOGLE_WEB_CLIENT_ID:-}"
operating_client="${MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID:-}"
invites="${SHOWCASE_INVITED_SUBJECT_SHA256:-}"
staff="${SHOWCASE_STAFF_SUBJECT_SHA256:-}"
[[ "$tag" =~ ^[0-9a-f]{7,40}$ ]] || fail 'source commit tag required'
[[ "$client" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ &&
   "$operating_client" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ &&
   "$client" != "$operating_client" ]] || fail 'dedicated Google audience required'
[[ "$invites" =~ ^[0-9a-f]{64}(,[0-9a-f]{64})*$ ]] || fail 'verified invite hashes required'
if [[ -n "$staff" ]]; then
  [[ "$staff" =~ ^[0-9a-f]{64}$ ]] || fail 'staff hash must be one verified subject'
  [[ ",$invites," == *",$staff,"* ]] || fail 'staff must be invited'
fi

temporary="$(mktemp "$parent/.runtime.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT
postgres_secret="$(openssl rand -hex 32)"
deletion_secret="$(openssl rand -hex 32)"
reference_secret="$(openssl rand -hex 32)"
{
  printf '%s=%s\n' MASSCOM_SHOWCASE_IMAGE_TAG "$tag"
  printf '%s=%s\n' SHOWCASE_HOST_POSTGRES_PASSWORD "$postgres_secret"
  printf '%s=%s\n' SHOWCASE_GOOGLE_WEB_CLIENT_ID "$client"
  printf '%s=%s\n' SHOWCASE_INVITED_SUBJECT_SHA256 "$invites"
  printf '%s=%s\n' SHOWCASE_STAFF_SUBJECT_SHA256 "$staff"
  printf '%s=%s\n' SHOWCASE_ACCOUNT_DELETION_HMAC_SECRET "$deletion_secret"
  printf '%s=%s\n' SHOWCASE_MERCHANT_REFERENCE_HMAC_SECRET "$reference_secret"
} >"$temporary"
chmod 600 "$temporary"
ln "$temporary" "$target" || fail 'runtime target appeared during creation'
echo 'showcase runtime created (secrets not printed)'
