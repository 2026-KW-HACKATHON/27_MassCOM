#!/usr/bin/env bash

set -euo pipefail

scan_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
finding_count=0
sensitive_identifier='accountId|customerAccountId|createdByAccountId|merchantReference|claim(Token)?|token|signature|password|secret|privateKey|mnemonic|recoveryPhrase|address'
error_detail='message|stack|cause'
approved_safe_metadata_pattern="safeErrorMetadata[[:space:]]*\\([[:space:]]*('[[:space:]]*'|\"[[:space:]]*\")[[:space:]]*,[[:space:]]*[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*(,[[:space:]]*new[[:space:]]+Set[[:space:]]*\\([[:space:]]*\\[[[:space:]'\",]*\\][[:space:]]*\\)[[:space:]]*)?\\)"

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
      alias_source = source
      while (match(alias_source, /(const|let|var)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=[[:space:]]*[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*[[:space:]]*;/)) {
        assignment = substr(alias_source, RSTART, RLENGTH)
        sub(/^(const|let|var)[[:space:]]+/, "", assignment)
        alias_name = assignment
        sub(/[[:space:]]*=.*/, "", alias_name)
        alias_value = assignment
        sub(/^[^=]*=[[:space:]]*/, "", alias_value)
        sub(/[[:space:]]*;.*/, "", alias_value)
        aliases[alias_name] = alias_value
        alias_source = substr(alias_source, RSTART + RLENGTH)
      }

      remaining = source
      while (match(remaining, /(console\.(log|error|warn|info|debug)|console[[:space:]]*\[[^]]+\]|process[[:space:]]*\.[[:space:]]*stderr[[:space:]]*\.[[:space:]]*write)[[:space:]]*\(/)) {
        call = ""
        call_depth = 0
        call_quote = ""
        call_escaped = 0
        template_expression_depth = 0
        template_expression_quote = ""
        template_expression_escaped = 0
        call_end = 0

        for (call_index = RSTART; call_index <= length(remaining); call_index += 1) {
          character = substr(remaining, call_index, 1)
          next_character = substr(remaining, call_index + 1, 1)

          if (call_quote == "`") {
            if (template_expression_depth > 0) {
              if (template_expression_quote != "") {
                if (!template_expression_escaped && character == template_expression_quote) {
                  call = call character
                } else {
                  call = call " "
                }
                if (template_expression_escaped) {
                  template_expression_escaped = 0
                } else if (character == "\\") {
                  template_expression_escaped = 1
                } else if (character == template_expression_quote) {
                  template_expression_quote = ""
                }
              } else {
                call = call character
                if (character == single_quote || character == "\"" || character == "`") {
                  template_expression_quote = character
                } else if (character == "{") {
                  template_expression_depth += 1
                } else if (character == "}") {
                  template_expression_depth -= 1
                }
              }
            } else if (call_escaped) {
              call = call " "
              call_escaped = 0
            } else if (character == "\\") {
              call = call " "
              call_escaped = 1
            } else if (character == "`") {
              call = call character
              call_quote = ""
            } else if (character == "$" && next_character == "{") {
              call = call "${"
              template_expression_depth = 1
              call_index += 1
            } else {
              call = call " "
            }
          } else if (call_quote != "") {
            if (!call_escaped && character == call_quote) {
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
        opening_parenthesis = index(call, "(")
        arguments = substr(call, opening_parenthesis + 1, length(call) - opening_parenthesis - 1)
        for (alias_name in aliases) {
          if (arguments ~ ("(^|[^A-Za-z0-9_])" alias_name "([^A-Za-z0-9_]|$)")) {
            arguments = arguments " " aliases[alias_name]
          }
        }
        print arguments
        if (call_end == 0) break
        remaining = substr(remaining, call_end + 1)
      }
    }
  ' "$1"
}

if [[ -d "$scan_root/apps" ]]; then
  while IFS= read -r -d '' source_file; do
    logger_arguments="$(normalize_logger_calls "$source_file")"
    logger_arguments="$(sed -E "s/${approved_safe_metadata_pattern}/SAFE_ERROR_METADATA/g" <<< "$logger_arguments")"
    forbidden_identifier="$sensitive_identifier"
    if [[ "$source_file" == "$scan_root/apps/api/"* ]]; then
      forbidden_identifier="error|caught|${error_detail}|${forbidden_identifier}"
    fi
    if grep -Eq "(^|[^A-Za-z0-9_$])(${forbidden_identifier})([^A-Za-z0-9_$]|$)" <<< "$logger_arguments"; then
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
