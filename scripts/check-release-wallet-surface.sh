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
unzip -q "$aab" 'base/dex/*' -d "$work" || fail "not a readable AAB: $aab"

manifest_reader="$repo_root/scripts/dump-aab-manifest.sh"
[[ -x "$manifest_reader" ]] || fail 'AAB manifest reader is unavailable'
manifest="$("$manifest_reader" "$aab" 2>&1)" || fail "manifest could not be parsed: $aab"
package_values="$("$manifest_reader" "$aab" '/manifest/@package' 2>&1)" \
  || fail "manifest package could not be parsed: $aab"
read -r package_count artifact_package <<<"$(awk '
  NF { count += 1; package_name = $0 }
  END { printf "%d %s\n", count, package_name }
' <<<"$package_values")"
[[ "$package_count" == 1 && "$artifact_package" == "$expected_package" ]] \
  || fail "manifest package is not $expected_package"
if [[ "$artifact_package" == "$expected_package.dev" ]]; then fail "manifest belongs to the development variant"; fi
if grep -qiE 'com\.android\.vending\.BILLING|SYSTEM_ALERT_WINDOW' <<<"$manifest"; then
  fail "manifest declares a billing or overlay permission"
fi
# Collectible voice is playback only (D-061): app.config blocks RECORD_AUDIO, so the merged release manifest must not ask
# for the microphone even if expo-audio or another dependency declares it.
if grep -qE 'android\.permission\.RECORD_AUDIO' <<<"$manifest"; then
  fail "manifest declares the microphone permission (RECORD_AUDIO)"
fi

# Native payment, on-ramp and embedded-wallet SDKs.
dex_strings="$work/dex-strings.txt"
: >"$dex_strings"
for dex in "$work"/base/dex/*.dex; do
  strings "$dex" >>"$dex_strings" || fail "could not inspect DEX strings: $(basename "$dex")"
done

if hit="$(grep -iE -m1 \
  'com/android/billingclient|com/coinbase|com/stripe|com/moonpay|com/transak|io/meld|com/web3auth|io/privy|link/magic' \
  "$dex_strings")"; then
  fail "dex contains a payment or embedded-wallet SDK class: $hit"
fi

source_symlink="$(find "$src" -type l -print -quit)" || fail "could not inspect mobile source symlinks"
[[ -z "$source_symlink" ]] || fail "source tree contains symlink: $source_symlink"

app_files=()
while IFS= read -r -d '' app_file; do
  app_files[${#app_files[@]}]="$app_file"
done < <(find "$src" -type f \( \
  -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
\) ! -name '*.test.*' -print0)
[[ "${#app_files[@]}" -gt 0 ]] || fail "no supported mobile source files found"

# Reown is intentionally exposed through five narrow imports. Reject every other occurrence of the
# module specifier, including namespace re-exports that can hide computed createAppKit/open calls.
reown_module='@reown/appkit-react-native'
allowed_reown_files=(
  wallet/appkit.ts
  wallet/base-sepolia.ts
  wallet/appkit-storage.ts
  screens/wallet-link/index.tsx
  app/_layout.tsx
)
expected_reown_import() {
  case "$1" in
    wallet/appkit.ts) echo "import { createAppKit } from '$reown_module';" ;;
    wallet/base-sepolia.ts) echo "import type { AppKitNetwork } from '$reown_module';" ;;
    wallet/appkit-storage.ts) echo "import type { Storage } from '$reown_module';" ;;
    screens/wallet-link/index.tsx)
      echo "import { useAccount, useAppKit, useAppKitEventSubscription, useProvider, } from '$reown_module';"
      ;;
    app/_layout.tsx) echo "import { AppKit, AppKitProvider, useAppKitTheme } from '$reown_module';" ;;
    *) return 1 ;;
  esac
}
for app_file in "${app_files[@]}"; do
  module_occurrences="$(awk -v needle="$reown_module" '
    { line = $0; while ((position = index(line, needle)) > 0) { count += 1; line = substr(line, position + length(needle)) } }
    END { print count + 0 }
  ' "$app_file")"
  [[ "$module_occurrences" == 0 ]] && continue
  relative_file="${app_file#"$src"/}"
  expected_import="$(expected_reown_import "$relative_file" 2>/dev/null || true)"
  [[ -n "$expected_import" ]] || fail "Reown module is not allowed in $relative_file"
  [[ "$module_occurrences" == 1 ]] || fail "Reown module must occur once in $relative_file"
  normalized_file="$(tr '\n' ' ' <"$app_file" | sed -E 's/[[:space:]]+/ /g')"
  [[ "$normalized_file" == *"$expected_import"* ]] \
    || fail "Reown module must use the canonical import in $relative_file"
done
for relative_file in "${allowed_reown_files[@]}"; do
  [[ -f "$src/$relative_file" ]] || fail "missing canonical Reown integration file: $relative_file"
  grep -qF "$reown_module" "$src/$relative_file" \
    || fail "missing canonical Reown import in $relative_file"
done

if hit="$(grep -hE -m1 \
  "import[[:space:]]+\*[[:space:]]+as[[:space:]]+.*from[[:space:]]+['\"]@reown/appkit-react-native['\"]|import[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]+from[[:space:]]+['\"]@reown/appkit-react-native['\"]|(require|import)[[:space:]]*\([[:space:]]*['\"]@reown/appkit-react-native['\"]" \
  "${app_files[@]}")"; then
  fail "Reown module must use static named imports: $hit"
fi
create_appkit_imports="$(grep -hEc \
  "^[[:space:]]*import[[:space:]]*\{[[:space:]]*createAppKit[[:space:]]*\}[[:space:]]*from[[:space:]]*['\"]@reown/appkit-react-native['\"];?[[:space:]]*$" \
  "${app_files[@]}" | awk '{ total += $1 } END { print total + 0 }')"
create_appkit_calls="$(grep -hEc '^[[:space:]]*\?[[:space:]]+createAppKit\(\{[[:space:]]*$' \
  "${app_files[@]}" | awk '{ total += $1 } END { print total + 0 }')"
create_appkit_references="$(grep -hoE '\bcreateAppKit\b' "${app_files[@]}" | wc -l | tr -d ' ')"
[[ "$create_appkit_imports" == 1 && "$create_appkit_calls" == 1 && "$create_appkit_references" == 2 ]] \
  || fail "createAppKit must use the canonical import and call"
if hit="$(grep -hE -m1 '\b(AppKitButton|AccountButton|ConnectButton|NetworkButton)\b' "${app_files[@]}")"; then
  fail "SDK button aliases and usages are forbidden: $hit"
fi
config="$src/wallet/wallet-runtime-config.ts"
for feature in socials swaps onramp; do
  # The SDK turns on-ramp ON when the flag is undefined, so each one must be an explicit false.
  grep -qE "^\s*$feature: false,\$" "$config" || fail "features.$feature is not an explicit false"
  if grep -hE "\b$feature:\s*(true|\[)" "${app_files[@]}" >/dev/null; then fail "features.$feature is enabled somewhere"; fi
done
grep -qE '^\s*enableAnalytics: false,$' "$config" || fail "enableAnalytics is not an explicit false"

# The SDK account screen has an unflagged Send button, and open() also accepts Swap and OnRamp
# views. App code may therefore reach the modal only as open({ view: 'Connect' }).
while IFS= read -r call; do
  [[ "$call" =~ open\(\{\ view:\ \'Connect\'\ \}\) ]] || fail "AppKit open() must target the Connect view only: $call"
done < <(grep -hE '\bopen\(' "${app_files[@]}" || true)
wallet_link="$src/screens/wallet-link/index.tsx"
normalized_wallet_link="$(tr '\n' ' ' <"$wallet_link" | sed -E 's/[[:space:]]+/ /g')"
[[ "$normalized_wallet_link" == *"const { open, close, disconnect, switchNetwork, cancelPendingConnection } = useAppKit();"* ]] \
  || fail "useAppKit must use the canonical wallet-link destructuring"
open_references="$(grep -oE '\bopen\b' "$wallet_link" | wc -l | tr -d ' ')"
wallet_hook_references="$(grep -oE '\buseAppKit\b' "$wallet_link" | wc -l | tr -d ' ')"
[[ "$open_references" == 2 && "$wallet_hook_references" == 2 ]] \
  || fail "wallet-link may not alias or reacquire AppKit open"
appkit_files=()
for app_file in "${app_files[@]}"; do
  if grep -qE "@reown/|useAppKit" "$app_file"; then
    appkit_files[${#appkit_files[@]}]="$app_file"
  fi
done
if [[ "${#appkit_files[@]}" -gt 0 ]]; then
  # A renamed binding or a view spread over several lines would slip past the line match above.
  if hit="$(grep -hE -m1 '\bopen\s*:' "${appkit_files[@]}")"; then fail "open must not be renamed or wrapped: $hit"; fi
  hit="$(awk -v allowed="view: 'Connect'" '
    $0 ~ /(^|[^[:alnum:]_])view[[:space:]]*:/ && index($0, allowed) == 0 { print; exit }
  ' "${appkit_files[@]}")" || fail "could not inspect AppKit views"
  if [[ -n "$hit" ]]; then
    fail "AppKit view other than Connect: $hit"
  fi
fi
# The SDK's internal controllers can push any view (WalletSend included) without calling open().
if hit="$(grep -hE -m1 "@reown/appkit-core-react-native|@reown/appkit-common-react-native|\b(RouterController|ModalController|OptionsController|OnRampController|SwapController|SendController)\b" "${app_files[@]}")"; then
  fail "app code must not use AppKit internal controllers: $hit"
fi
if hit="$(grep -hE -m1 '<(AppKitButton|AccountButton|ConnectButton|NetworkButton)\b' "${app_files[@]}")"; then
  fail "SDK button would expose the account screen: $hit"
fi

methods="$(sed -n '/methods: {/,/},/p' "$config")"
grep -q "'personal_sign'" <<<"$methods" || fail "could not locate the session methods block"
hit="$(grep -oE -m1 "'(eth_sendTransaction|eth_sendRawTransaction|eth_sign|eth_signTransaction|eth_signTypedData[_a-zA-Z0-9]*|wallet_sendCalls|wallet_grantPermissions)'" <<<"$methods" || true)"
if [[ -n "$hit" ]]; then
  fail "session requests a transaction or blind-signing method: $hit"
fi

echo "release wallet surface verified: $(basename "$aab"), package $artifact_package"
