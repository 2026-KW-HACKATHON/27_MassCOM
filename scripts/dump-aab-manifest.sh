#!/usr/bin/env bash
# Reads the base manifest from an Android App Bundle with Google's official bundletool.
# Usage: scripts/dump-aab-manifest.sh <file.aab> [xpath]
set -euo pipefail

[[ $# -ge 1 && $# -le 2 ]] || {
  echo 'usage: dump-aab-manifest.sh <file.aab> [xpath]' >&2
  exit 2
}

artifact="$1"
xpath="${2:-}"
[[ -f "$artifact" ]] || { echo "no such AAB: $artifact" >&2; exit 1; }
command -v java >/dev/null 2>&1 || { echo 'Java is unavailable' >&2; exit 1; }

bundletool_jar="${BUNDLETOOL_JAR:-}"
if [[ -z "$bundletool_jar" ]]; then
  android_sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  bundletool_dir="$android_sdk/bundletool"
  if [[ -f "$bundletool_dir/bundletool-all.jar" ]]; then
    bundletool_jar="$bundletool_dir/bundletool-all.jar"
  elif [[ -d "$bundletool_dir" ]]; then
    shopt -s nullglob
    versioned_jars=("$bundletool_dir"/bundletool-all-*.jar)
    shopt -u nullglob
    if [[ "${#versioned_jars[@]}" == 1 ]]; then
      bundletool_jar="${versioned_jars[0]}"
    elif [[ "${#versioned_jars[@]}" -gt 1 ]]; then
      echo 'multiple versioned bundletool-all jars found; set BUNDLETOOL_JAR or provide bundletool-all.jar' >&2
      exit 1
    fi
  fi
fi
[[ -n "$bundletool_jar" && -f "$bundletool_jar" ]] || {
  echo 'bundletool-all jar is unavailable; set BUNDLETOOL_JAR or install it under ANDROID_HOME/bundletool' >&2
  exit 1
}

arguments=(dump manifest "--bundle=$artifact" --module=base)
if [[ -n "$xpath" ]]; then
  arguments+=("--xpath=$xpath")
fi
exec java -jar "$bundletool_jar" "${arguments[@]}"
