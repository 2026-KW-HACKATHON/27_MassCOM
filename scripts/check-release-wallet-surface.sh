#!/usr/bin/env bash
# W08: a release build must not offer purchase, swap, embedded-wallet or send entry points.
# The Hermes bundle always contains the wallet SDK's swap/on-ramp screens as dead code, so this
# checks that nothing can reach them rather than that the strings are absent.
#
# Usage: scripts/check-release-wallet-surface.sh <app-release.aab> [mobile-src-dir]

set -euo pipefail

aab="${1:?usage: check-release-wallet-surface.sh <app-release.aab> [mobile-src-dir]}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${2:-$repo_root/apps/mobile/src}"
expected_package="${EXPECTED_PACKAGE:-kr.masscom.wolgye}"

fail() { echo "release wallet surface check FAILED: $*" >&2; exit 1; }

work="$(mktemp -d -t wallet-surface.XXXXXX)"
trap 'rm -rf "$work"' EXIT
unzip -q "$aab" 'base/manifest/AndroidManifest.xml' 'base/dex/*' -d "$work" || fail "not a readable AAB: $aab"

manifest="$(strings "$work/base/manifest/AndroidManifest.xml")"
# The bundle manifest is a protobuf, so the package attribute shows up as `<package>"` plus a tag byte.
grep -qE "^${expected_package//./\\.}\"" <<<"$manifest" || fail "manifest package is not $expected_package"
if grep -qF "$expected_package.dev" <<<"$manifest"; then fail "manifest belongs to the development variant"; fi
if grep -qiE 'com\.android\.vending\.BILLING|SYSTEM_ALERT_WINDOW' <<<"$manifest"; then
  fail "manifest declares a billing or overlay permission"
fi

# Native payment, on-ramp and embedded-wallet SDKs.
if hit="$(cat "$work"/base/dex/*.dex | strings | grep -iE -m1 'com/android/billingclient|com/coinbase|com/stripe|com/moonpay|com/transak|io/meld|com/web3auth|io/privy|link/magic')"; then
  fail "dex contains a payment or embedded-wallet SDK class: $hit"
fi

app_files="$(find "$src" -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*')"

[[ "$(grep -hE 'createAppKit\(' $app_files | wc -l | tr -d ' ')" == "1" ]] || fail "createAppKit must be called exactly once"
config="$src/wallet/wallet-runtime-config.ts"
for feature in socials swaps onramp; do
  # The SDK turns on-ramp ON when the flag is undefined, so each one must be an explicit false.
  grep -qE "^\s*$feature: false,\$" "$config" || fail "features.$feature is not an explicit false"
  if grep -hE "\b$feature:\s*(true|\[)" $app_files >/dev/null; then fail "features.$feature is enabled somewhere"; fi
done
grep -qE '^\s*enableAnalytics: false,$' "$config" || fail "enableAnalytics is not an explicit false"

# The SDK account screen has an unflagged Send button. It opens only through open() without a
# view or through the SDK's own buttons, so neither may exist.
while IFS= read -r call; do
  [[ "$call" =~ open\(\{\ view:\ \'Connect\'\ \}\) ]] || fail "AppKit open() must target the Connect view only: $call"
done < <(grep -hE '\bopen\(' $app_files | grep -v 'openWalletSelector' || true)
if hit="$(grep -hE -m1 '<(AppKitButton|AccountButton|ConnectButton|NetworkButton)\b' $app_files)"; then
  fail "SDK button would expose the account screen: $hit"
fi

if hit="$(sed -n '/methods: {/,/},/p' "$config" | grep -oE "'(eth_sendTransaction|eth_sendRawTransaction|eth_sign|eth_signTransaction|eth_signTypedData[_a-zA-Z0-9]*|wallet_sendCalls|wallet_grantPermissions)'" | head -1)"; then
  fail "session requests a transaction or blind-signing method: $hit"
fi

echo "release wallet surface verified: $(basename "$aab"), package $expected_package"
