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

# react-native-web는 accessibilityState를 DOM에 내보내지 않는다. radio·checkbox·switch 역할을 쓰는 파일은 역할 수만큼
# aria-checked(선택 상태)와 spaceToggles(Space 키)가 있어야 한다. grep만 쓴다(CI에는 rg가 없다).
check_web_checked_roles() {
  local root="$1" failed=0 file roles checked spaces
  while IFS= read -r file; do
    roles="$({ grep -oE 'accessibilityRole="(radio|checkbox|switch)"' "$file" || true; } | wc -l | tr -d ' ')"
    checked="$({ grep -oE 'aria-checked=' "$file" || true; } | wc -l | tr -d ' ')"
    spaces="$({ grep -oE 'spaceToggles\(' "$file" || true; } | wc -l | tr -d ' ')"
    if [[ "$checked" -lt "$roles" ]]; then
      echo "web checked role without aria-checked: $file ($roles roles, $checked aria-checked)" >&2
      failed=1
    fi
    if [[ "$spaces" -lt "$roles" ]]; then
      echo "web checked role without Space handler: $file ($roles roles, $spaces spaceToggles)" >&2
      failed=1
    fi
  done < <(grep -rlE 'accessibilityRole="(radio|checkbox|switch)"' --include='*.tsx' "$root" | sort)
  return "$failed"
}
check_web_checked_roles "$repo_root/apps/mobile/src"
# 가드가 실제로 걸리는지: 동의 화면에서 aria-checked를 지우면, 따로 Space 처리를 지우면 각각 실패해야 한다.
rm -rf "$fixture/web-checked" && mkdir -p "$fixture/web-checked" && cp "$repo_root/apps/mobile/src/screens/consent/index.tsx" "$fixture/web-checked/index.tsx"
check_web_checked_roles "$fixture/web-checked" >/dev/null
sed -i.bak 's/aria-checked={checked}//' "$fixture/web-checked/index.tsx"
if check_web_checked_roles "$fixture/web-checked" >/dev/null 2>&1; then
  echo 'web checked guard accepted a checkbox without aria-checked' >&2
  exit 1
fi
cp "$repo_root/apps/mobile/src/screens/consent/index.tsx" "$fixture/web-checked/index.tsx"
sed -i.bak 's/spaceToggles(toggle)/undefined/' "$fixture/web-checked/index.tsx"
if check_web_checked_roles "$fixture/web-checked" >/dev/null 2>&1; then
  echo 'web checked guard accepted a checkbox without a Space handler' >&2
  exit 1
fi

echo 'mobile accessibility semantics tests passed'
