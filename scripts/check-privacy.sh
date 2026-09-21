#!/usr/bin/env bash

set -euo pipefail

scan_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
finding_count=0

if [[ -d "$scan_root/apps" ]]; then
  if ! node "$script_root/check-privacy-logs.mjs" "$scan_root"; then
    finding_count=$((finding_count + 1))
  fi

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
  echo "privacy scan failed: $finding_count check(s) require review" >&2
  exit 1
fi

echo "privacy scan passed"
