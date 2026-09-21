#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-lightsail-deployment.mjs"

node "$verifier"

scratch="$(mktemp -d -t masscom-lightsail-verifier.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT

cp "$repo_root/infra/lightsail/compose.yml" "$scratch/compose.yml"
cp "$repo_root/infra/lightsail/Caddyfile" "$scratch/Caddyfile"
cp "$repo_root/infra/lightsail/api.Dockerfile" "$scratch/api.Dockerfile"

sed -i.bak 's/API_BIND_HOST: 0.0.0.0/API_BIND_HOST: 127.0.0.1/' "$scratch/compose.yml"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a loopback-only API container" >&2
  exit 1
fi
mv "$scratch/compose.yml.bak" "$scratch/compose.yml"

sed -i.bak 's/reverse_proxy api:3000/reverse_proxy postgres:5432/' "$scratch/Caddyfile"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a public database proxy" >&2
  exit 1
fi
mv "$scratch/Caddyfile.bak" "$scratch/Caddyfile"

sed -i.bak '/^USER node$/d' "$scratch/api.Dockerfile"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a root runtime image" >&2
  exit 1
fi

echo "Lightsail deployment verifier tests passed"
