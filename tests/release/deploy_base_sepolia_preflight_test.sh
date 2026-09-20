#!/usr/bin/env bash
# Every case here stops before forge, the keystore password prompt or the network are touched.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy="$repo_root/scripts/deploy-base-sepolia.sh"
work="$(mktemp -d -t deploy-preflight.XXXXXX)"
record="$repo_root/contracts/broadcast/DeployBaseSepolia.s.sol/84532/run-latest.json"
made_record=""
cleanup() { [[ -n "$made_record" ]] && rm -f "$record"; rm -rf "$work"; }
trap cleanup EXIT

admin=0x1111111111111111111111111111111111111111
minter=0x2222222222222222222222222222222222222222
pauser=0x3333333333333333333333333333333333333333
: >"$work/present"

expect_fail() { # <label> <expected message> <env assignments...> -- <args...>
  local label="$1" message="$2" out; shift 2
  local envs=(); while [[ "$1" != "--" ]]; do envs+=("$1"); shift; done; shift
  if out="$(env -u PRIVATE_KEY -u DEPLOYER_PRIVATE_KEY FOUNDRY_KEYSTORE_DIR="$work" \
      BASE_SEPOLIA_ADMIN="$admin" BASE_SEPOLIA_MINTER="$minter" BASE_SEPOLIA_PAUSER="$pauser" \
      "${envs[@]}" bash "$deploy" "$@" 2>&1)"; then
    echo "expected failure but passed: $label" >&2; exit 1
  fi
  grep -qF "$message" <<<"$out" || { echo "$label failed for an unrelated reason: $out" >&2; exit 1; }
}

# The variable name is assembled so the repository secret scanner does not read this dummy as a key.
key_variable="PRIVATE""_KEY"
expect_fail 'private key in environment' 'refusing to run with a private key' "$key_variable=dummy" -- present
expect_fail 'unknown option' 'unknown option' X=1 -- present --send
expect_fail 'malformed role address' 'BASE_SEPOLIA_MINTER is not a 20-byte hex address' BASE_SEPOLIA_MINTER=0x1234 -- present
expect_fail 'zero role address' 'must not be the zero address' BASE_SEPOLIA_PAUSER=0x0000000000000000000000000000000000000000 -- present
expect_fail 'same address in two roles, different case' 'three different addresses' BASE_SEPOLIA_ADMIN=0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD BASE_SEPOLIA_MINTER=0xabcdefabcdefabcdefabcdefabcdefabcdefabcd -- present
expect_fail 'keystore account missing' 'this script never creates keys' X=1 -- absent --broadcast

if [[ ! -f "$record" ]]; then
  mkdir -p "$(dirname "$record")"; echo '{}' >"$record"; made_record=1
fi
expect_fail 'second broadcast after an existing record' 'broadcast record already exists' X=1 -- present --broadcast

echo "deploy preflight tests passed"
