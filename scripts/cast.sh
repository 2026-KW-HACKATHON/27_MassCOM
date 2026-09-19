#!/usr/bin/env bash

set -euo pipefail

if command -v cast >/dev/null 2>&1; then
  exec cast "$@"
fi

exec docker run --rm \
  --entrypoint /usr/local/bin/cast \
  ghcr.io/foundry-rs/foundry@sha256:2e4287278639262de76db72477301d5d3212fa1b1cce710d7d148750a46ce9e7 \
  "$@"
