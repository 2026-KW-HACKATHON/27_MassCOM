#!/usr/bin/env bash
# Runs the W08 check against a synthetic AAB and mutated copies of the real mobile sources,
# so it needs no Android build.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
check="$repo_root/scripts/check-release-wallet-surface.sh"
work="$(mktemp -d -t wallet-surface-test.XXXXXX)"
trap 'rm -rf "$work"' EXIT

make_aab() { # <name> <manifest text> <dex text>
  local dir="$work/$1.d"
  mkdir -p "$dir/base/manifest" "$dir/base/dex"
  printf '%s\n' "$2" >"$dir/base/manifest/AndroidManifest.xml"
  printf '%s\n' "$3" >"$dir/base/dex/classes.dex"
  (cd "$dir" && zip -q -r "$work/$1.aab" base)
}
make_src() { # <name> -> prints the copy's path
  cp -R "$repo_root/apps/mobile/src" "$work/$1.src"
  echo "$work/$1.src"
}
expect_fail() { # <label> <expected message> <aab> <src>
  local out
  if out="$(bash "$check" "$3" "$4" 2>&1)"; then
    echo "expected failure but passed: $1" >&2; exit 1
  fi
  grep -qF "$2" <<<"$out" || { echo "$1 failed for an unrelated reason: $out" >&2; exit 1; }
}

good_manifest=$'kr.masscom.wolgye"K\nandroid.permission.INTERNET('
make_aab good "$good_manifest" 'Lcom/facebook/react/ReactActivity;'
good_src="$(make_src good)"
bash "$check" "$work/good.aab" "$good_src" >/dev/null

make_aab billing "$good_manifest"$'\ncom.android.vending.BILLING(' 'Lcom/facebook/react/ReactActivity;'
expect_fail 'billing permission' 'billing or overlay permission' "$work/billing.aab" "$good_src"

make_aab devpkg $'kr.masscom.wolgye.dev"K' 'x'
expect_fail 'development package' 'manifest' "$work/devpkg.aab" "$good_src"

make_aab sdk "$good_manifest" 'Lcom/android/billingclient/api/BillingClient;'
expect_fail 'billing SDK class' 'payment or embedded-wallet SDK class' "$work/sdk.aab" "$good_src"

src="$(make_src onramp-on)"
sed -i.bak 's/^\( *\)onramp: false,$/\1onramp: true,/' "$src/wallet/wallet-runtime-config.ts"
expect_fail 'on-ramp enabled' 'features.onramp' "$work/good.aab" "$src"

src="$(make_src onramp-default)"
sed -i.bak '/^ *onramp: false,$/d' "$src/wallet/wallet-runtime-config.ts"
expect_fail 'on-ramp left to the SDK default' 'features.onramp is not an explicit false' "$work/good.aab" "$src"

src="$(make_src open-account)"
sed -i.bak "s/await open({ view: 'Connect' });/await open();/" "$src/screens/wallet-link/index.tsx"
expect_fail 'open() without a view' 'Connect view only' "$work/good.aab" "$src"

src="$(make_src sdk-button)"
printf '%s\n' "export const Leak = () => <AppKitButton />;" >"$src/screens/leak.tsx"
expect_fail 'SDK account button' 'SDK button' "$work/good.aab" "$src"

src="$(make_src send-method)"
sed -i.bak "s/'personal_sign',/'personal_sign', 'eth_sendTransaction',/" "$src/wallet/wallet-runtime-config.ts"
expect_fail 'transaction method in session' 'transaction or blind-signing method' "$work/good.aab" "$src"

echo "release wallet surface tests passed"
