#!/usr/bin/env bash

set -euo pipefail

scan_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
finding_count=0

while IFS= read -r -d '' candidate; do
  case "$candidate" in
    */scripts/check-secrets.sh|*/tests/bootstrap/check_secrets_test.sh)
      continue
      ;;
  esac

  if ! grep -Iq . "$candidate"; then
    continue
  fi

  if grep -Eq '(gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*[[:space:]]*=[[:space:]]*[^[:space:]#]|(MINTER|DEPLOYER|WALLET)[A-Z0-9_]*KEY[A-Z0-9_]*[[:space:]]*=[[:space:]]*0x[0-9a-f]{64})' "$candidate" ||
    grep -Eqi '([A-Za-z][A-Za-z0-9+.-]*://[^/@[:space:]]+:[^/@[:space:]]+@|[?&](api[_-]?key|token|secret|password)=[^&[:space:]#]+)' "$candidate" ||
    grep -Eqi '(apiToken|accessToken|authToken|clientSecret|privateKey|walletPassword|recoveryPhrase)[[:space:]]*[:=][[:space:]]*[^[:space:]#;]+' "$candidate"; then
    echo "possible secret in ${candidate#"$scan_root"/}" >&2
    finding_count=$((finding_count + 1))
  fi
done < <(
  find "$scan_root" \
    -type d \( \
      -name .git -o \
      -name .worktrees -o \
      -name .superpowers -o \
      -name .claude -o \
      -name .omx -o \
      -name .omc -o \
      -name .serena -o \
      -name node_modules -o \
      -name dist -o \
      -name build -o \
      -name coverage -o \
      -path "$scan_root/contracts/lib" \
    \) -prune \
    -o -type f -print0
)

if [[ "$finding_count" -ne 0 ]]; then
  echo "secret scan failed: $finding_count file(s) require review" >&2
  exit 1
fi

echo "secret scan passed"
