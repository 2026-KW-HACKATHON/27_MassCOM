#!/usr/bin/env bash
# Runs the W08 check against a synthetic AAB and mutated copies of the real mobile sources,
# so it needs no Android build.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
check="$repo_root/scripts/check-release-wallet-surface.sh"
work="$(mktemp -d -t wallet-surface-test.XXXXXX)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
cat >"$work/bin/aapt2" <<'STUB'
#!/usr/bin/env bash
artifact="${@: -1}"
exec unzip -p "$artifact" base/manifest/AndroidManifest.xml
STUB
chmod +x "$work/bin/aapt2"

make_aab() { # <name> <manifest text> <dex text>
  local dir="$work/$1.d"
  mkdir -p "$dir/base/manifest" "$dir/base/dex"
  printf '%s\n' "$2" >"$dir/base/manifest/AndroidManifest.xml"
  printf '%s\n' "$3" >"$dir/base/dex/classes.dex"
  (cd "$dir" && zip -q -r "$work/$1.aab" base)
}
make_large_forbidden_aab() {
  local dir="$work/large-forbidden.d"
  mkdir -p "$dir/base/manifest" "$dir/base/dex"
  printf '%s\n' "$good_manifest" >"$dir/base/manifest/AndroidManifest.xml"
  {
    printf '%s\n' 'Lcom/android/billingclient/api/BillingClient;'
    dd if=/dev/zero bs=1048576 count=2 2>/dev/null | tr '\0' 'A'
  } >"$dir/base/dex/classes.dex"
  (cd "$dir" && zip -q -r "$work/large-forbidden.aab" base)
}
make_src() { # <name> -> prints the copy's path
  cp -R "$repo_root/apps/mobile/src" "$work/$1.src"
  echo "$work/$1.src"
}
expect_fail() { # <label> <expected message> <aab> <src>
  local out
  if out="$(PATH="$work/bin:$PATH" bash "$check" "$3" "$4" 2>&1)"; then
    echo "expected failure but passed: $1" >&2; exit 1
  fi
  grep -qF "$2" <<<"$out" || { echo "$1 failed for an unrelated reason: $out" >&2; exit 1; }
}

good_manifest=$'E: manifest\n  A: package="kr.masscom.wolgye"\n  E: uses-permission\n    A: android:name="android.permission.INTERNET"'
make_aab good "$good_manifest" 'Lcom/facebook/react/ReactActivity;'
good_src="$(make_src good)"
PATH="$work/bin:$PATH" bash "$check" "$work/good.aab" "$good_src" >/dev/null

make_aab billing "$good_manifest"$'\n  E: uses-permission\n    A: android:name="com.android.vending.BILLING"' 'Lcom/facebook/react/ReactActivity;'
expect_fail 'billing permission' 'billing or overlay permission' "$work/billing.aab" "$good_src"

make_aab devpkg $'E: manifest\n  A: package="kr.masscom.wolgye.dev"' 'x'
expect_fail 'development package' 'manifest' "$work/devpkg.aab" "$good_src"

make_aab package-decoy $'E: manifest\n  A: package="com.attacker.release"\n  E: application\n    A: android:label="kr.masscom.wolgye"' 'x'
expect_fail 'wrong package with expected-package decoy' 'manifest package is not kr.masscom.wolgye' \
  "$work/package-decoy.aab" "$good_src"

make_aab sdk "$good_manifest" 'Lcom/android/billingclient/api/BillingClient;'
expect_fail 'billing SDK class' 'payment or embedded-wallet SDK class' "$work/sdk.aab" "$good_src"

make_large_forbidden_aab
expect_fail \
  'large DEX payment class after pipefail' \
  'payment or embedded-wallet SDK class' \
  "$work/large-forbidden.aab" \
  "$good_src"

src="$(make_src onramp-on)"
sed -i.bak 's/^\( *\)onramp: false,$/\1onramp: true,/' "$src/wallet/wallet-runtime-config.ts"
expect_fail 'on-ramp enabled' 'features.onramp' "$work/good.aab" "$src"

src="$(make_src onramp-default)"
sed -i.bak '/^ *onramp: false,$/d' "$src/wallet/wallet-runtime-config.ts"
expect_fail 'on-ramp left to the SDK default' 'features.onramp is not an explicit false' "$work/good.aab" "$src"

src="$(make_src create-appkit-import-alias)"
printf '%s\n' \
  "import { createAppKit as makeAppKit } from '@reown/appkit-react-native';" \
  'makeAppKit({});' >"$src/screens/create-appkit-alias.ts"
expect_fail 'createAppKit import alias' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src create-appkit-assignment-alias)"
printf '%s\n' \
  "import { createAppKit } from '@reown/appkit-react-native';" \
  'const makeAppKit = createAppKit;' \
  'makeAppKit({});' >"$src/screens/create-appkit-assignment.ts"
expect_fail 'createAppKit assignment alias' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src create-appkit-wrapper)"
printf '%s\n' \
  "import { createAppKit } from '@reown/appkit-react-native';" \
  'const makeAppKit = (...args) => createAppKit(...args);' \
  'makeAppKit({});' >"$src/screens/create-appkit-wrapper.ts"
expect_fail 'createAppKit wrapper alias' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src reown-namespace)"
printf '%s\n' \
  "import * as Reown from '@reown/appkit-react-native';" \
  "Reown['create' + 'AppKit']({});" >"$src/screens/reown-namespace.ts"
expect_fail 'Reown namespace import' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src reown-default-import)"
printf '%s\n' \
  "import Reown from '@reown/appkit-react-native';" \
  'Reown.createAppKit({});' >"$src/screens/reown-default-import.ts"
expect_fail 'Reown default import' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src reown-dynamic-import)"
printf '%s\n' \
  "const Reown = await import('@reown/appkit-react-native');" \
  "Reown['createAppKit']({});" >"$src/screens/reown-dynamic-import.ts"
expect_fail 'Reown dynamic import' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src reown-require)"
printf '%s\n' \
  "const Reown = require('@reown/appkit-react-native');" \
  'Reown.createAppKit({});' >"$src/screens/reown-require.cjs"
expect_fail 'Reown require path' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src reown-namespace-reexport)"
printf '%s\n' \
  "export * as WalletSdk from '@reown/appkit-react-native';" \
  >"$src/screens/reown-bridge.ts"
printf '%s\n' \
  "import { WalletSdk } from './reown-bridge';" \
  "WalletSdk['create' + 'AppKit']({});" \
  >"$src/screens/reown-namespace-consumer.ts"
expect_fail 'Reown namespace re-export' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src sdk-button-alias)"
printf '%s\n' \
  "import { AppKitButton as WalletButton } from '@reown/appkit-react-native';" \
  'export const Leak = () => <WalletButton />;' >"$src/screens/aliased-button.tsx"
expect_fail 'SDK button alias' 'Reown module is not allowed' "$work/good.aab" "$src"

src="$(make_src open-account)"
sed -i.bak "s/await open({ view: 'Connect' });/await open();/" "$src/screens/wallet-link/index.tsx"
expect_fail 'open() without a view' 'Connect view only' "$work/good.aab" "$src"

src="$(make_src sdk-button)"
printf '%s\n' "export const Leak = () => <AppKitButton />;" >"$src/screens/leak.tsx"
expect_fail 'SDK account button' 'SDK button' "$work/good.aab" "$src"

src="$(make_src spaced-sdk-button)"
printf '%s\n' "export const Leak = () => <AppKitButton />;" >"$src/screens/spaced leak.tsx"
expect_fail 'SDK account button in spaced filename' 'SDK button' "$work/good.aab" "$src"

src="$(make_src javascript-controller)"
printf '%s\n' "import { RouterController } from '@reown/appkit-core-react-native';" \
  "RouterController.push('WalletSend');" >"$src/screens/leak.js"
expect_fail 'internal controller in JavaScript source' 'internal controllers' "$work/good.aab" "$src"

src="$(make_src source-symlink)"
printf '%s\n' "export const Leak = () => <AppKitButton />;" >"$work/outside-wallet-source.tsx"
ln -s "$work/outside-wallet-source.tsx" "$src/screens/linked-wallet-source.tsx"
expect_fail 'source tree symlink' 'source tree contains symlink' "$work/good.aab" "$src"

src="$(make_src send-method)"
sed -i.bak "s/'personal_sign',/'personal_sign', 'eth_sendTransaction',/" "$src/wallet/wallet-runtime-config.ts"
expect_fail 'transaction method in session' 'transaction or blind-signing method' "$work/good.aab" "$src"

src="$(make_src oversized-methods)"
config="$src/wallet/wallet-runtime-config.ts"
awk -v forbidden="          'eth_sendTransaction'," '
  { print }
  /personal_sign/ { for (i = 0; i < 20000; i++) print forbidden }
' "$config" >"$config.tmp"
mv "$config.tmp" "$config"
expect_fail \
  'oversized forbidden session methods after pipefail' \
  'transaction or blind-signing method' \
  "$work/good.aab" \
  "$src"

src="$(make_src open-renamed)"
sed -i.bak "s/await open({ view: 'Connect' });/await launch({ view: 'Swap' });/" "$src/screens/wallet-link/index.tsx"
printf '%s\n' "const { open: launch } = useAppKit();" >>"$src/screens/wallet-link/index.tsx"
expect_fail 'open renamed on destructure' 'wallet-link may not alias or reacquire AppKit open' "$work/good.aab" "$src"

src="$(make_src open-computed-alias)"
printf '%s\n' \
  "const appKitAgain = useAppKit();" \
  "await appKitAgain['op' + 'en']({ view: 'Swap' });" \
  >>"$src/screens/wallet-link/index.tsx"
expect_fail 'computed open alias' 'wallet-link may not alias or reacquire AppKit open' "$work/good.aab" "$src"

src="$(make_src open-multiline)"
python3 - "$src/screens/wallet-link/index.tsx" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "await open({ view: 'Connect' });"
assert s.count(old) == 1
# "open (" slips past the per-line open( match, so only the view scan can catch this one.
open(p, 'w').write(s.replace(old, "await open (\n        { view: 'OnRamp' },\n      );"))
PY
expect_fail 'view spread over several lines' 'AppKit view other than Connect' "$work/good.aab" "$src"

src="$(make_src oversized-view)"
{
  printf '%s\n' "import { useAppKit } from '@reown/appkit-react-native';"
  awk -v line="export const leak = { view: 'Swap' };" 'BEGIN { for (i = 0; i < 20000; i++) print line }'
} >"$src/screens/oversized-view.ts"
expect_fail \
  'oversized non-Connect view after pipefail' \
  'Reown module is not allowed' \
  "$work/good.aab" \
  "$src"

src="$(make_src internal-controller)"
printf '%s\n' "import { RouterController } from '@reown/appkit-core-react-native';" "RouterController.push('WalletSend');" >"$src/screens/leak.ts"
expect_fail 'internal controller import' 'internal controllers' "$work/good.aab" "$src"

src="$(make_src methods-reformatted)"
sed -i.bak 's/^\( *\)methods: {$/\1methods:{/' "$src/wallet/wallet-runtime-config.ts"
expect_fail 'methods block no longer recognisable' 'could not locate the session methods block' "$work/good.aab" "$src"

echo "release wallet surface tests passed"
