#!/usr/bin/env bash

set -euo pipefail

scan_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
finding_count=0
logger_pattern='console\.(log|error|warn|info|debug)'
sensitive_identifier='accountId|customerAccountId|createdByAccountId|merchantReference|claim(Token)?|token|signature|privateKey|mnemonic|recoveryPhrase|address'
error_detail='message|stack|cause'

normalize_logger_calls() {
  awk '
    BEGIN {
      single_quote = sprintf("%c", 39)
    }
    {
      line = ""
      escaped = 0
      for (index_in_line = 1; index_in_line <= length($0); index_in_line += 1) {
        character = substr($0, index_in_line, 1)
        next_character = substr($0, index_in_line + 1, 1)

        if (in_block_comment) {
          if (character == "*" && next_character == "/") {
            in_block_comment = 0
            index_in_line += 1
          }
          continue
        }

        if (quote != "") {
          line = line character
          if (escaped) {
            escaped = 0
          } else if (character == "\\") {
            escaped = 1
          } else if (character == quote) {
            quote = ""
          }
          continue
        }

        if (character == single_quote || character == "\"" || character == "`") {
          quote = character
          line = line character
        } else if (character == "/" && next_character == "*") {
          in_block_comment = 1
          index_in_line += 1
          line = line " "
        } else if (character == "/" && next_character == "/") {
          break
        } else {
          line = line character
        }
      }

      source = source (source == "" ? "" : " ") line
    }
    END {
      remaining = source
      while (match(remaining, /console\.(log|error|warn|info|debug)[[:space:]]*\(/)) {
        call = ""
        call_depth = 0
        call_quote = ""
        call_escaped = 0
        call_end = 0

        for (call_index = RSTART; call_index <= length(remaining); call_index += 1) {
          character = substr(remaining, call_index, 1)

          if (call_quote != "") {
            if (call_quote == "`" || (!call_escaped && character == call_quote)) {
              call = call character
            } else {
              call = call " "
            }
            if (call_escaped) {
              call_escaped = 0
            } else if (character == "\\") {
              call_escaped = 1
            } else if (character == call_quote) {
              call_quote = ""
            }
          } else {
            call = call character
            if (character == single_quote || character == "\"" || character == "`") {
              call_quote = character
            } else if (character == "(") {
              call_depth += 1
            } else if (character == ")") {
              call_depth -= 1
              if (call_depth == 0) {
                call_end = call_index
                break
              }
            }
          }
        }

        gsub(/[[:space:]]+/, " ", call)
        print call
        if (call_end == 0) break
        remaining = substr(remaining, call_end + 1)
      }
    }
  ' "$1"
}

if [[ -d "$scan_root/apps" ]]; then
  while IFS= read -r -d '' source_file; do
    logger_calls="$(normalize_logger_calls "$source_file")"
    structural_logger_calls="$(sed -E 's/`[^$`]*`/``/g' <<< "$logger_calls")"
    if grep -Eqi "${logger_pattern}\\([[:space:]]*(error|caught)([^A-Za-z0-9_$]|$)|${logger_pattern}\\([[:space:]]*('[^']*'|\"[^\"]*\"|[A-Za-z_$][A-Za-z0-9_$.]*)[[:space:]]*,[[:space:]]*(error|caught)([^A-Za-z0-9_$]|$)" <<< "$structural_logger_calls" ||
      grep -Eqi "${logger_pattern}\\([[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*\\.[[:space:]]*)*(${sensitive_identifier})([^A-Za-z0-9_$]|$)|${logger_pattern}\\([^;]*,[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*\\.[[:space:]]*)*(${sensitive_identifier})([^A-Za-z0-9_$]|$)" <<< "$structural_logger_calls" ||
      grep -Eqi "${logger_pattern}\\([^;]*\\{[^;}]*(${sensitive_identifier}|${error_detail})[[:space:]]*:|${logger_pattern}\\([^;]*\\{[[:space:]]*(${sensitive_identifier}|${error_detail})[[:space:]]*[,}]|${logger_pattern}\\([^;]*\\{[^;}]*,[[:space:]]*(${sensitive_identifier}|${error_detail})[[:space:]]*[,}]" <<< "$structural_logger_calls" ||
      grep -Eqi "${logger_pattern}\\([^;]*\\{[^;}]*((error|caught)[[:space:]]*\\.[[:space:]]*(${error_detail})|[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*\\.[[:space:]]*(${sensitive_identifier}))" <<< "$structural_logger_calls" ||
      grep -Eqi "${logger_pattern}\\([^;]*\\$\\{[^}]*([A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*\\.[[:space:]]*)?(${sensitive_identifier}|${error_detail})[^}]*\\}" <<< "$logger_calls" ||
      grep -Eqi "${logger_pattern}\\([^;]*(\\+[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*\\.[[:space:]]*)?(${sensitive_identifier}|${error_detail})|(${sensitive_identifier}|${error_detail})[[:space:]]*\\+)" <<< "$structural_logger_calls"; then
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
