#!/usr/bin/env bash

set -euo pipefail

scan_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
finding_count=0

if [[ -d "$scan_root/apps" ]]; then
  while IFS= read -r -d '' source_file; do
    if sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g" "$source_file" |
      grep -Eqi 'console\.(log|error|warn|info|debug)\([^;]*\{[^;}]*((accountId|customerAccountId|createdByAccountId|merchantReference|claim(Token)?|token|signature|privateKey|mnemonic|recoveryPhrase|address|message|stack|cause)[[:space:]]*:|(accountId|customerAccountId|createdByAccountId|merchantReference|claim(Token)?|token|signature|privateKey|mnemonic|recoveryPhrase|address)[[:space:]]*[,}])|console\.(log|error|warn|info|debug)\([[:space:]]*(accountId|customerAccountId|createdByAccountId|merchantReference|claim(Token)?|token|signature|privateKey|mnemonic|recoveryPhrase|address|error|caught)([^A-Za-z]|$)|console\.(log|error|warn|info|debug)\([^(,;]*,[[:space:]]*(accountId|customerAccountId|createdByAccountId|merchantReference|claim(Token)?|token|signature|privateKey|mnemonic|recoveryPhrase|address|error|caught)([^A-Za-z]|$)'; then
      echo "possible sensitive log arguments in ${source_file#"$scan_root"/}" >&2
      finding_count=$((finding_count + 1))
    fi
  done < <(
    find "$scan_root/apps" \
      -type d \( -name node_modules -o -name dist -o -name build \) -prune \
      -o -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) -print0
  )

  while IFS= read -r -d '' package_file; do
    if grep -Eqi '(@react-native-firebase/analytics|@sentry/|mixpanel|analytics-node|@segment/|amplitude|posthog)' "$package_file"; then
      echo "unreviewed analytics or telemetry dependency in ${package_file#"$scan_root"/}" >&2
      finding_count=$((finding_count + 1))
    fi
  done < <(
    find "$scan_root/apps" \
      -type d \( -name node_modules -o -name dist -o -name build \) -prune \
      -o -type f -name package.json -print0
  )
fi

if [[ "$finding_count" -ne 0 ]]; then
  echo "privacy scan failed: $finding_count file(s) require review" >&2
  exit 1
fi

echo "privacy scan passed"
