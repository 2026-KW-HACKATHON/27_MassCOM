#!/usr/bin/env bash
# Deploys WolgyeMascot to Base Sepolia (chain 84532) from an encrypted Foundry keystore.
# Usage: scripts/deploy-base-sepolia.sh <keystore-account-name> [--broadcast]
# Without --broadcast it only simulates against the live chain and sends nothing.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
account="${1:?keystore account name is required (create one with: cast wallet import <name> --interactive)}"
mode="${2:-}"

: "${BASE_SEPOLIA_ADMIN:?BASE_SEPOLIA_ADMIN address is required}"
: "${BASE_SEPOLIA_MINTER:?BASE_SEPOLIA_MINTER address is required}"
: "${BASE_SEPOLIA_PAUSER:?BASE_SEPOLIA_PAUSER address is required}"
rpc_url="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"

if ! command -v forge >/dev/null 2>&1; then
  echo "a local forge install is required: the keystore password prompt cannot run inside the Docker fallback" >&2
  exit 1
fi
if [[ -n "${PRIVATE_KEY:-}" || -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "refusing to run with a private key in the environment; use the encrypted keystore account" >&2
  exit 1
fi

args=(script script/DeployBaseSepolia.s.sol:DeployBaseSepolia --rpc-url "$rpc_url" --account "$account")
if [[ "$mode" == "--broadcast" ]]; then
  args+=(--broadcast --slow)
elif [[ -n "$mode" ]]; then
  echo "unknown option: $mode" >&2
  exit 1
fi

cd "$repo_root/contracts"
exec forge "${args[@]}"
