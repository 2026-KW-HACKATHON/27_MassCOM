#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-lightsail-deployment.mjs"

node "$verifier"

# 운영 compose는 STAFF의 가게 그림 관리 권한(AI_ART_STAFF_MAY_MANAGE)을 넘기지 않는다. 운영에는 OWNER를 부여하는 경로가 아직 없어
# 이 값을 켜면 직원 계정이 유료 이미지 호출을 시작할 수 있다(D-048·D-050). 값이 꺼져 있어도 키가 있으면 실수로 켜기 쉬우므로 키 자체를 막는다.
compose_passes_staff_art_flag() {
  grep -q 'AI_ART_STAFF_MAY_MANAGE' "$1"
}
if compose_passes_staff_art_flag "$repo_root/infra/lightsail/compose.yml"; then
  echo "production compose must not pass AI_ART_STAFF_MAY_MANAGE" >&2
  exit 1
fi

scratch="$(mktemp -d -t masscom-lightsail-verifier.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT

# 위 검사가 실제로 걸리는지: 복사본에 키를 넣어 보면 걸려야 한다(진짜 파일은 건드리지 않는다).
cp "$repo_root/infra/lightsail/compose.yml" "$scratch/compose-with-staff-flag.yml"
sed -i.bak 's/^\( *\)AI_ART_RATE_IMAGE_OUTPUT: \(.*\)$/&\
\1AI_ART_STAFF_MAY_MANAGE: ${AI_ART_STAFF_MAY_MANAGE:-}/' "$scratch/compose-with-staff-flag.yml"
if ! compose_passes_staff_art_flag "$scratch/compose-with-staff-flag.yml"; then
  echo "staff art flag check did not trip on an injected AI_ART_STAFF_MAY_MANAGE" >&2
  exit 1
fi

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

sed -i.bak '/header_up X-Forwarded-For {remote_host}/d' "$scratch/Caddyfile"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a proxy without sanitized client IP" >&2
  exit 1
fi
mv "$scratch/Caddyfile.bak" "$scratch/Caddyfile"

sed -i.bak 's/AUTH_TRUST_CADDY_FORWARDED_FOR: "true"/AUTH_TRUST_CADDY_FORWARDED_FOR: "false"/' "$scratch/compose.yml"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a shared proxy login limit" >&2
  exit 1
fi
mv "$scratch/compose.yml.bak" "$scratch/compose.yml"

sed -i.bak '/^USER node$/d' "$scratch/api.Dockerfile"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a root runtime image" >&2
  exit 1
fi

echo "Lightsail deployment verifier tests passed"
