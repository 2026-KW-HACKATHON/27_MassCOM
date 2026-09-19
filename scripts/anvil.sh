#!/usr/bin/env bash

set -euo pipefail

if command -v anvil >/dev/null 2>&1; then
  exec anvil "$@"
fi

exec docker run --rm \
  --publish 127.0.0.1:8545:8545 \
  --entrypoint /usr/local/bin/anvil \
  ghcr.io/foundry-rs/foundry@sha256:2e4287278639262de76db72477301d5d3212fa1b1cce710d7d148750a46ce9e7 \
  --host 0.0.0.0 \
  "$@"
