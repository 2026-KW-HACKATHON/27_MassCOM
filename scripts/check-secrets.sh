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

  if grep -Eqi '(gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*[[:space:]]*=[[:space:]]*[^[:space:]#]|[A-Za-z][A-Za-z0-9+.-]*://[^/@[:space:]]+:[^/@[:space:]]+@|[?&](api[_-]?key|token|secret|password)=[^&[:space:]#]+|(MINTER|DEPLOYER|WALLET)[A-Z0-9_]*KEY[A-Z0-9_]*[[:space:]]*=[[:space:]]*0x[0-9a-f]{64})' "$candidate"; then
    echo "possible secret in ${candidate#"$scan_root"/}" >&2
    finding_count=$((finding_count + 1))
  fi
done < <(
  find "$scan_root" \
    -type d \( -name .git -o -name node_modules -o -name dist -o -name build -o -name coverage \) -prune \
    -o -type f -print0
)

if [[ "$finding_count" -ne 0 ]]; then
  echo "secret scan failed: $finding_count file(s) require review" >&2
  exit 1
fi

echo "secret scan passed"
