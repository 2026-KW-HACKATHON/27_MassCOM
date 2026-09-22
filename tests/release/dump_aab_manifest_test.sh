#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dump="$repo_root/scripts/dump-aab-manifest.sh"
work="$(mktemp -d -t aab-manifest.XXXXXX)"
trap 'rm -rf "$work"' EXIT

[[ -x "$dump" ]] || {
  echo "expected executable AAB manifest reader at $dump" >&2
  exit 1
}

mkdir -p "$work/bin" "$work/sdk/bundletool"
artifact="$work/app-release.aab"
jar="$work/sdk/bundletool/bundletool-all-1.18.3.jar"
printf 'fixture bundle\n' >"$artifact"
printf 'fixture jar\n' >"$jar"

cat >"$work/bin/java" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >"$BUNDLETOOL_TEST_ARGS"
if [[ "$*" == *'--xpath='* ]]; then
  printf '%s\n' 'kr.masscom.wolgye'
else
  printf '%s\n' '<manifest package="kr.masscom.wolgye"/>'
fi
STUB
chmod +x "$work/bin/java"

export BUNDLETOOL_TEST_ARGS="$work/args.txt"
out="$(PATH="$work/bin:$PATH" ANDROID_HOME="$work/sdk" bash "$dump" "$artifact")"
[[ "$out" == '<manifest package="kr.masscom.wolgye"/>' ]] || {
  echo "unexpected manifest output: $out" >&2
  exit 1
}
grep -qFx -- '-jar' "$work/args.txt"
grep -qFx -- "$jar" "$work/args.txt"
grep -qFx -- "--bundle=$artifact" "$work/args.txt"
grep -qFx -- '--module=base' "$work/args.txt"

printf 'second fixture jar\n' >"$work/sdk/bundletool/bundletool-all-1.17.2.jar"
status=0
out="$(PATH="$work/bin:$PATH" ANDROID_HOME="$work/sdk" \
  env -u BUNDLETOOL_JAR bash "$dump" "$artifact" 2>&1)" || status=$?
[[ "$status" == 1 ]] || {
  echo "multiple bundletool jars were selected ambiguously: $out" >&2
  exit 1
}
grep -qF 'multiple versioned bundletool-all jars found' <<<"$out" || {
  echo "multiple bundletool jars failed for an unrelated reason: $out" >&2
  exit 1
}
rm "$work/sdk/bundletool/bundletool-all-1.17.2.jar"

xpath='/manifest/@package'
out="$(PATH="$work/bin:$PATH" BUNDLETOOL_JAR="$jar" bash "$dump" "$artifact" "$xpath")"
[[ "$out" == 'kr.masscom.wolgye' ]] || {
  echo "unexpected XPath output: $out" >&2
  exit 1
}
grep -qFx -- "--xpath=$xpath" "$work/args.txt"

status=0
out="$(PATH="$work/bin:$PATH" ANDROID_HOME="$work/missing-sdk" \
  env -u BUNDLETOOL_JAR bash "$dump" "$artifact" 2>&1)" || status=$?
[[ "$status" == 1 ]] || {
  echo "missing bundletool: expected exit 1, got $status: $out" >&2
  exit 1
}
grep -qF 'bundletool-all jar is unavailable' <<<"$out" || {
  echo "missing bundletool failed for an unrelated reason: $out" >&2
  exit 1
}

echo 'AAB manifest reader tests passed'
