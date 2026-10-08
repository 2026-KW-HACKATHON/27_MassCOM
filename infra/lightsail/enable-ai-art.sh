#!/usr/bin/env bash
set +x
set -euo pipefail

export MASSCOM_AI_ART_TARGET=production
exec bash "$(dirname "$0")/../showcase-host/enable-ai-art.sh" "$@"
