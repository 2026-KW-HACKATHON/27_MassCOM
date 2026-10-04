#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="$repo_root/scripts/check-accessibility-semantics.mjs"
[[ -f "$checker" ]] || { echo "missing accessibility semantics checker" >&2; exit 1; }

node "$checker" "$repo_root/apps/mobile/src"

fixture="$(mktemp -d -t accessibility-semantics.XXXXXX)"
trap 'rm -rf "$fixture"' EXIT
cp -R "$repo_root/apps/mobile/src/screens" "$fixture/screens"
sed -i.bak 's/accessibilityLiveRegion="polite"//' "$fixture/screens/auth-required/sign-in-actions.tsx"
if node "$checker" "$fixture" >/dev/null 2>&1; then
  echo 'accessibility checker accepted a missing live region' >&2
  exit 1
fi

# 위 변형이 남기지 않도록 원본을 다시 복사한 뒤 동의 화면만 하나씩 망가뜨려 각각 걸리는지 본다.
rm -rf "$fixture/screens"
cp -R "$repo_root/apps/mobile/src/screens" "$fixture/screens"
node "$checker" "$fixture" >/dev/null
cp "$repo_root/apps/mobile/src/screens/consent/index.tsx" "$fixture/screens/consent/index.tsx.orig"
sed -i.bak 's/accessibilityRole="checkbox"//' "$fixture/screens/consent/index.tsx"
if node "$checker" "$fixture" >/dev/null 2>&1; then
  echo 'accessibility checker accepted a consent screen without checkbox semantics' >&2
  exit 1
fi
cp "$fixture/screens/consent/index.tsx.orig" "$fixture/screens/consent/index.tsx"
sed -i.bak 's/<Text accessibilityRole="header" selectable style={styles.title}>/<Text maxFontSizeMultiplier={1.1} accessibilityRole="header" selectable style={styles.title}>/' "$fixture/screens/consent/index.tsx"
if node "$checker" "$fixture" >/dev/null 2>&1; then
  echo 'accessibility checker accepted a consent screen that stops text scaling' >&2
  exit 1
fi

echo 'mobile accessibility semantics tests passed'
