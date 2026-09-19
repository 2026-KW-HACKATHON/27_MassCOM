#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contracts_dir="$repo_root/contracts"

if command -v forge >/dev/null 2>&1; then
  cd "$contracts_dir"
  exec forge "$@"
fi

mkdir -p "$contracts_dir/.cache/foundry"
exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp/foundry-home \
  --volume "$contracts_dir:/workspace" \
  --volume "$contracts_dir/.cache/foundry:/tmp/foundry-home" \
  --workdir /workspace \
  --entrypoint /usr/local/bin/forge \
  ghcr.io/foundry-rs/foundry@sha256:2e4287278639262de76db72477301d5d3212fa1b1cce710d7d148750a46ce9e7 \
  "$@"
