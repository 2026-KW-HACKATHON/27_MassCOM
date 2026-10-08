#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-lightsail-deployment.mjs"

node "$verifier"

# 운영 compose는 STAFF의 가게 그림 관리 권한(AI_ART_STAFF_MAY_MANAGE)을 넘기지 않는다. 운영 OWNER는 확인 절차(D-054)로만 생기므로
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

sed -i.bak '/path_regexp .*merchant-art/d' "$scratch/Caddyfile"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted an unrestricted merchant art path" >&2
  exit 1
fi
mv "$scratch/Caddyfile.bak" "$scratch/Caddyfile"

sed -i.bak '/@merchantArtApi {/,/^[[:space:]]*}/s/method GET HEAD/method GET POST/' "$scratch/Caddyfile"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a merchant art write method" >&2
  exit 1
fi
mv "$scratch/Caddyfile.bak" "$scratch/Caddyfile"

sed -i.bak '/handle @merchantArtApi {/,/^[[:space:]]*}/s/reverse_proxy api:3000/reverse_proxy production-web:4173/' "$scratch/Caddyfile"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted merchant art routed away from the API" >&2
  exit 1
fi
mv "$scratch/Caddyfile.bak" "$scratch/Caddyfile"

# 가게 실세계 프로필 편집 API(/api/web/v1/*)가 세션 프록시와 비공개 헤더 목록에서 빠지거나 다른 경로의 끝(/x/api/web/v1/*)에만 남으면
# 정적 파일 서버로 떨어져 404가 난다. 거절 사유도 해당 매처의 /api/web/v1/ 누락이어야 한다(다른 이유로 실패한 것을 통과로 세지 않는다).
for matcher in webSession privateSurface; do
  for replacement in '' ' /x/api/web/v1/*'; do
    sed -i.bak "/@$matcher path/s# /api/web/v1/\\*#$replacement#" "$scratch/Caddyfile"
    if cmp -s "$scratch/Caddyfile" "$scratch/Caddyfile.bak"; then
      echo "mutation did not apply to @$matcher" >&2
      exit 1
    fi
    if err="$(node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" 2>&1 >/dev/null)"; then
      echo "verifier accepted a Caddyfile whose @$matcher lacks /api/web/v1/* (replacement: '$replacement')" >&2
      exit 1
    fi
    if ! grep -q "@$matcher must cover /api/web/v1/" <<< "$err"; then
      echo "verifier rejected @$matcher without /api/web/v1/* for another reason: $err" >&2
      exit 1
    fi
    mv "$scratch/Caddyfile.bak" "$scratch/Caddyfile"
  done
done

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

# 운영 NFT는 고정값 PREPARING이다(D-054). LIVE나 런타임 덮어쓰기(${NFT_MINTING_MODE:-…})로 바꾼 복사본은 거절해야 한다.
for replacement in 'NFT_MINTING_MODE: LIVE' 'NFT_MINTING_MODE: ${NFT_MINTING_MODE:-PREPARING}'; do
  sed -i.bak "s/NFT_MINTING_MODE: PREPARING/$replacement/" "$scratch/compose.yml"
  if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
    echo "verifier accepted production NFT minting that is not fixed to PREPARING: $replacement" >&2
    exit 1
  fi
  mv "$scratch/compose.yml.bak" "$scratch/compose.yml"
done
# 고정값 줄은 그대로 두고 다른 곳(주석·다른 서비스)에 런타임 덮어쓰기 참조가 끼어도 거절해야 한다.
sed -i.bak 's/^\( *\)NFT_MINTING_MODE: PREPARING$/&\
\1# NFT_MINTING_MODE_OVERRIDE: ${NFT_MINTING_MODE:-LIVE}/' "$scratch/compose.yml"
grep -q '${NFT_MINTING_MODE:-LIVE}' "$scratch/compose.yml" || { echo "override injection did not apply" >&2; exit 1; }
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a compose that still references \${NFT_MINTING_MODE" >&2
  exit 1
fi
mv "$scratch/compose.yml.bak" "$scratch/compose.yml"
if grep -q 'NFT_MINTING_MODE' "$repo_root/infra/showcase-host/compose.yml" "$repo_root/infra/showcase-local/compose.yml"; then
  echo "showcase compose must keep its current minting (no NFT_MINTING_MODE)" >&2
  exit 1
fi

sed -i.bak '/^USER node$/d' "$scratch/api.Dockerfile"
if node "$verifier" "$scratch/compose.yml" "$scratch/Caddyfile" "$scratch/api.Dockerfile" >/dev/null 2>&1; then
  echo "verifier accepted a root runtime image" >&2
  exit 1
fi

echo "Lightsail deployment verifier tests passed"
