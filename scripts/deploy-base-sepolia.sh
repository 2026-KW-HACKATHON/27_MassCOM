#!/usr/bin/env bash
# Deploys WolgyeMascot to Base Sepolia (chain 84532) from an encrypted Foundry keystore.
# Usage: scripts/deploy-base-sepolia.sh <keystore-account-name> [--broadcast [--redeploy]]
# Without --broadcast it only simulates against the live chain and sends nothing.
#
# Keystore account (the owner runs this once, in their own terminal):
#   new testnet-only key : cast wallet new <name>                   hidden password prompt, key is never shown
#   existing key         : cast wallet import <name> --interactive
# Run `cast wallet new <name>` where no directory called <name> exists, or cast treats it as a path.
# A keyed BASE_SEPOLIA_RPC_URL is visible in `ps` while this runs; the default public RPC has no key.
# Never run a bare `cast wallet new`: without a name it prints the private key.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
account="${1:?keystore account name is required (see the header of this script)}"
mode="${2:-}"
redeploy="${3:-}"
# ETH_KEYSTORE is the variable forge itself reads for --account, so the check and the tool agree.
keystore_dir="${ETH_KEYSTORE:-$HOME/.foundry/keystores}"
expected_chain_id=84532

: "${BASE_SEPOLIA_ADMIN:?BASE_SEPOLIA_ADMIN address is required}"
: "${BASE_SEPOLIA_MINTER:?BASE_SEPOLIA_MINTER address is required}"
: "${BASE_SEPOLIA_PAUSER:?BASE_SEPOLIA_PAUSER address is required}"
rpc_url="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"

if [[ -n "${PRIVATE_KEY:-}" || -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "refusing to run with a private key in the environment; use the encrypted keystore account" >&2
  exit 1
fi
if [[ $# -gt 3 ]] || [[ $# -ge 2 && "$mode" != "--broadcast" ]] || [[ $# -eq 3 && "$redeploy" != "--redeploy" ]]; then
  echo "unknown option: ${*:2}" >&2
  exit 1
fi

for role in BASE_SEPOLIA_ADMIN BASE_SEPOLIA_MINTER BASE_SEPOLIA_PAUSER; do
  [[ "${!role}" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "$role is not a 20-byte hex address" >&2; exit 1; }
  [[ "${!role}" =~ ^0x0{40}$ ]] && { echo "$role must not be the zero address" >&2; exit 1; }
done
roles="$(printf '%s\n' "$BASE_SEPOLIA_ADMIN" "$BASE_SEPOLIA_MINTER" "$BASE_SEPOLIA_PAUSER" | tr 'A-F' 'a-f' | sort -u | wc -l | tr -d ' ')"
[[ "$roles" == "3" ]] || { echo "admin, minter and pauser must be three different addresses" >&2; exit 1; }

if [[ ! -f "$keystore_dir/$account" ]]; then
  echo "keystore account '$account' does not exist in $keystore_dir; this script never creates keys" >&2
  exit 1
fi

# A lost response is not a failed deployment: look at the record before sending again.
# forge's own record is gitignored and disappears with a fresh clone, so the committed evidence
# file written after a real deployment is checked as well.
record="$repo_root/contracts/broadcast/DeployBaseSepolia.s.sol/$expected_chain_id/run-latest.json"
evidence="$repo_root/docs/evidence/base-sepolia-deployment.json"
if [[ "$mode" == "--broadcast" && "$redeploy" != "--redeploy" ]] && [[ -f "$record" || -f "$evidence" ]]; then
  echo "a Base Sepolia deployment record already exists: $([[ -f "$record" ]] && echo "$record" || echo "$evidence")" >&2
  echo "check its transaction and contract address on the chain first; pass --redeploy only to deploy a second contract on purpose" >&2
  exit 1
fi

PATH="$PATH:$HOME/.foundry/bin"
if ! command -v forge >/dev/null 2>&1 || ! command -v cast >/dev/null 2>&1; then
  echo "a local forge/cast install is required: the keystore password prompt cannot run inside the Docker fallback" >&2
  exit 1
fi

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
[[ "$chain_id" == "$expected_chain_id" ]] || { echo "RPC reports chain $chain_id, expected $expected_chain_id" >&2; exit 1; }

args=(script script/DeployBaseSepolia.s.sol:DeployBaseSepolia --rpc-url "$rpc_url" --account "$account")
if [[ "$mode" == "--broadcast" ]]; then
  args+=(--broadcast --slow)
fi

cd "$repo_root/contracts"
exec forge "${args[@]}"
