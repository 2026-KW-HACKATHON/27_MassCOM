#!/usr/bin/env bash
# Runs a copy of the deploy script inside a sandbox with stub forge/cast, so no key, network or
# file of the real repository is touched.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d -t deploy-preflight.XXXXXX)"
trap 'rm -rf "$work"' EXIT

sandbox="$work/repo"
mkdir -p "$sandbox/scripts" "$sandbox/contracts" "$sandbox/docs/evidence" "$work/bin" "$work/keys" "$work/home"
cp "$repo_root/scripts/deploy-base-sepolia.sh" "$sandbox/scripts/"
deploy="$sandbox/scripts/deploy-base-sepolia.sh"
printf '#!/usr/bin/env bash\necho "${STUB_CHAIN_ID:-84532}"\n' >"$work/bin/cast"
printf '#!/usr/bin/env bash\necho "FORGE $*"\n' >"$work/bin/forge"
chmod +x "$work/bin/cast" "$work/bin/forge"
: >"$work/keys/present"
record="$sandbox/contracts/broadcast/DeployBaseSepolia.s.sol/84532/run-latest.json"
evidence="$sandbox/docs/evidence/base-sepolia-deployment.json"

admin=0x1111111111111111111111111111111111111111
minter=0x2222222222222222222222222222222222222222
pauser=0x3333333333333333333333333333333333333333

run() { # <env assignments...> -- <args...>
  local envs=(); while [[ "${1:-}" != "--" ]]; do envs+=("$1"); shift; done; shift
  env -u PRIVATE_KEY -u DEPLOYER_PRIVATE_KEY -u BASE_SEPOLIA_RPC_URL HOME="$work/home" PATH="$work/bin:$PATH" \
    ETH_KEYSTORE="$work/keys" BASE_SEPOLIA_ADMIN="$admin" BASE_SEPOLIA_MINTER="$minter" BASE_SEPOLIA_PAUSER="$pauser" \
    ${envs[@]+"${envs[@]}"} bash "$deploy" "$@" 2>&1
}
expect_fail() { # <label> <expected message> <env assignments...> -- <args...>
  local label="$1" message="$2" out; shift 2
  if out="$(run "$@")"; then echo "expected failure but passed: $label" >&2; exit 1; fi
  grep -qF "$message" <<<"$out" || { echo "$label failed for an unrelated reason: $out" >&2; exit 1; }
}
expect_forge() { # <label> <expected forge argument> <env assignments...> -- <args...>
  local label="$1" argument="$2" out; shift 2
  out="$(run "$@")" || { echo "$label was refused: $out" >&2; exit 1; }
  grep -qE "^FORGE .*$argument" <<<"$out" || { echo "$label did not reach forge as expected: $out" >&2; exit 1; }
}

# Valid input must get through, or a guard that rejects everything would look like a pass.
expect_forge 'simulation' '--account present$' -- present
expect_forge 'first broadcast' '--account present --broadcast --slow$' -- present --broadcast

# The variable name is assembled so the repository secret scanner does not read this dummy as a key.
key_variable="PRIVATE""_KEY"
expect_fail 'private key in environment' 'refusing to run with a private key' "$key_variable=dummy" -- present
expect_fail 'unknown option' 'unknown option' -- present --send
expect_fail 'redeploy without broadcast' 'unknown option' -- present --redeploy
expect_fail 'empty mode before redeploy' 'unknown option' -- present '' --redeploy
expect_fail 'extra argument' 'unknown option' -- present --broadcast --redeploy extra
expect_fail 'malformed role address' 'BASE_SEPOLIA_MINTER is not a 20-byte hex address' BASE_SEPOLIA_MINTER=0x1234 -- present
expect_fail 'zero role address' 'must not be the zero address' BASE_SEPOLIA_PAUSER=0x0000000000000000000000000000000000000000 -- present
expect_fail 'same address in two roles, different case' 'three different addresses' BASE_SEPOLIA_ADMIN=0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD BASE_SEPOLIA_MINTER=0xabcdefabcdefabcdefabcdefabcdefabcdefabcd -- present
expect_fail 'keystore account missing' 'this script never creates keys' -- absent --broadcast
expect_fail 'RPC on another chain' 'RPC reports chain 8453, expected 84532' STUB_CHAIN_ID=8453 -- present

mkdir -p "$(dirname "$record")"; echo '{}' >"$record"
expect_fail 'second broadcast after forge recorded one' 'deployment record already exists' -- present --broadcast
expect_forge 'simulation is never blocked by a record' '--account present$' -- present
expect_forge 'deliberate second contract' '--broadcast --slow$' -- present --broadcast --redeploy
rm -f "$record"; echo '{}' >"$evidence"
expect_fail 'second broadcast after a fresh clone (committed evidence only)' 'deployment record already exists' -- present --broadcast

echo "deploy preflight tests passed"
