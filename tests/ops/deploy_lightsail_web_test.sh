#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
deploy="$repo_root/scripts/deploy-lightsail-web.sh"
guard="$repo_root/scripts/lightsail-web-probe-guard.sh"
[[ -f "$deploy" ]] || { echo 'web-only deploy script is missing' >&2; exit 1; }

source "$guard"
for accepted in 401 404 503; do
  web_collection_probe_accepts "$accepted" 'application/json; charset=utf-8' 'no-store'
done
for rejected in \
  '200|application/json; charset=utf-8|no-store' \
  '502|application/json; charset=utf-8|no-store' \
  '404|text/plain|no-store' \
  '404|application/json; charset=utf-8|public, max-age=60'; do
  IFS='|' read -r status content_type cache_control <<< "$rejected"
  if web_collection_probe_accepts "$status" "$content_type" "$cache_control"; then
    echo "unsafe web collection probe response accepted: $status" >&2
    exit 1
  fi
done

(
  curl() {
    printf '503|application/json; charset=utf-8|no-store'
    return 28
  }
  if web_collection_probe_response 'http://api-fixture.invalid/api/web/collection' masscom.kr; then
    echo 'web probe ignored a curl timeout after receiving safe-looking headers' >&2
    exit 1
  fi
)
(
  curl() {
    local previous=''
    for argument in "$@"; do
      if [[ "$previous" == '-H' && "$argument" == 'Host: masscom.kr' ]]; then
        printf '401|application/json; charset=utf-8|no-store'
        return
      fi
      previous="$argument"
    done
    printf '403|application/json; charset=utf-8|no-store'
  }
  web_collection_probe_response 'http://api-fixture.invalid/api/web/collection' masscom.kr
)

# 동의 조회 probe: 로그인 없는 요청은 401(JSON, no-store)만 받아들인다. 404는 API에 경로가 없거나 Caddy가 넘기지 않는 것이다.
web_consent_probe_accepts 401 'application/json; charset=utf-8' 'no-store'
for rejected in \
  '404|application/json; charset=utf-8|no-store' \
  '503|application/json; charset=utf-8|no-store' \
  '200|application/json; charset=utf-8|no-store' \
  '502|application/json; charset=utf-8|no-store' \
  '401|text/plain|no-store' \
  '401|application/json; charset=utf-8|public, max-age=60' \
  '401|application/json; charset=utf-8|'; do
  IFS='|' read -r status content_type cache_control <<< "$rejected"
  if web_consent_probe_accepts "$status" "$content_type" "$cache_control"; then
    echo "unsafe web consent probe response accepted: $rejected" >&2
    exit 1
  fi
done
(
  curl() {
    printf '401|application/json; charset=utf-8|no-store'
    return 28
  }
  if web_consent_probe_response 'http://api-fixture.invalid/api/web/consent' masscom.kr; then
    echo 'consent probe ignored a curl timeout after receiving safe-looking headers' >&2
    exit 1
  fi
)
(
  curl() {
    local previous=''
    for argument in "$@"; do
      if [[ "$previous" == '-H' && "$argument" == 'Host: masscom.kr' ]]; then
        printf '401|application/json; charset=utf-8|no-store'
        return
      fi
      previous="$argument"
    done
    printf '404|application/json; charset=utf-8|no-store'
  }
  web_consent_probe_response 'http://api-fixture.invalid/api/web/consent' masscom.kr
  if web_consent_probe_response 'http://api-fixture.invalid/api/web/consent' www.masscom.kr; then
    echo 'consent probe accepted an answer that was not for the probed host' >&2
    exit 1
  fi
)

# Issue #254: 메타데이터 탐침은 API의 JSON 404(no-store)와 CORS '*' 한 줄만 받는다.
nft_metadata_probe_accepts 404 'application/json; charset=utf-8' 'no-store' 1 '*'
for rejected in \
  '200|application/json; charset=utf-8|public, max-age=31536000, immutable|1|*' \
  '404|text/plain; charset=utf-8|no-store|1|*' \
  '404|application/json; charset=utf-8|no-store|2|*' \
  '404|application/json; charset=utf-8|no-store|0|' \
  '404|application/json; charset=utf-8|no-store|1|https://evil.example' \
  '404|application/json; charset=utf-8|public, max-age=60|1|*'; do
  IFS='|' read -r status content_type cache_control cors_count cors_value <<< "$rejected"
  if nft_metadata_probe_accepts "$status" "$content_type" "$cache_control" "$cors_count" "$cors_value"; then
    echo "unsafe nft metadata probe response accepted: $rejected" >&2
    exit 1
  fi
done
(
  curl() {
    printf 'HTTP/1.1 404 Not Found\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n\r\n'
  }
  nft_metadata_probe_response 'http://api-fixture.invalid/nft-metadata/no-such/1.json'
)
(
  curl() {
    printf 'HTTP/1.1 404 Not Found\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\naccess-control-allow-origin: *\r\n\r\n'
  }
  if nft_metadata_probe_response 'http://api-fixture.invalid/nft-metadata/no-such/1.json'; then
    echo 'nft metadata probe accepted a duplicated CORS header' >&2
    exit 1
  fi
)
(
  curl() { return 7; }
  if nft_metadata_probe_response 'http://api-fixture.invalid/nft-metadata/no-such/1.json'; then
    echo 'nft metadata probe ignored a failed request' >&2
    exit 1
  fi
)

scratch="$(mktemp -d -t masscom-web-deploy-test.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT
key="$scratch/key.pem"
runtime="$scratch/runtime.env"
evidence="$scratch/capacity.json"
printf 'not-a-real-key\n' > "$key"
printf '%s=%s\n' \
  MASSCOM_API_DOMAIN api.masscom.kr \
  POSTGRES_PASSWORD test-only-value \
  GOOGLE_OAUTH_CLIENT_IDS 123-test.apps.googleusercontent.com \
  ACCOUNT_DELETION_HMAC_SECRET test-only-deletion-secret-at-least-32-bytes \
  MERCHANT_REFERENCE_HMAC_SECRET test-only-reference-secret-at-least-32-bytes \
  > "$runtime"
printf '{"instance":"masscom-api-seoul","checkedAt":"%s","billingStatus":"WITHIN_APPROVED_CREDIT","availableMiB":1024,"diskFreeGiB":40}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$evidence"
chmod 600 "$key" "$runtime" "$evidence"

common_env=(
  MASSCOM_LIGHTSAIL_HOST=example.invalid
  MASSCOM_LIGHTSAIL_KEY_FILE="$key"
  MASSCOM_RUNTIME_ENV_FILE="$runtime"
  MASSCOM_WEB_CAPACITY_EVIDENCE_FILE="$evidence"
)

output="$(env "${common_env[@]}" bash "$deploy" --dry-run)"
[[ "$output" == *'mode: dry-run'* && "$output" == *'remote checks: NOT_RUN'* ]] || {
  echo 'dry-run did not separate local validation from remote proof' >&2
  exit 1
}

if env "${common_env[@]:0:3}" bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo 'dry-run accepted missing cost/capacity evidence' >&2
  exit 1
fi
chmod 644 "$evidence"
if env "${common_env[@]}" bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo 'dry-run accepted world-readable capacity evidence' >&2
  exit 1
fi
chmod 600 "$evidence"
bash -n "$deploy"
awk '/^set -Eeuo pipefail$/ {inside=1} /^REMOTE_DEPLOY$/ {inside=0} inside {print}' "$deploy" > "$scratch/remote.sh"
bash -n "$scratch/remote.sh"
grep -q 'compose_new up -d --no-deps production-web' "$scratch/remote.sh"
grep -q 'compose_new up -d --no-deps --force-recreate caddy' "$scratch/remote.sh"
grep -q 'source "$release/scripts/lightsail-web-rollback.sh"' "$scratch/remote.sh"
grep -q 'web_previous_release' "$scratch/remote.sh"
grep -q 'source "$release/scripts/lightsail-web-probe-guard.sh"' "$scratch/remote.sh"
grep -q 'web_change_started=' "$scratch/remote.sh"
grep -q 'service_snapshot api' "$scratch/remote.sh"
grep -q 'service_snapshot postgres' "$scratch/remote.sh"
grep -q 'probe_web_routes' "$scratch/remote.sh"
grep -qF 'http://$address/admin/' "$scratch/remote.sh"
grep -qF 'http://$address/admin/assets/admin.mjs' "$scratch/remote.sh"
grep -qF 'http://$address/merchant/' "$scratch/remote.sh"
grep -qF 'http://$address/merchant/assets/merchant.mjs' "$scratch/remote.sh"
grep -qF 'https://www.masscom.kr/admin/' "$scratch/remote.sh"
grep -qF 'https://www.masscom.kr/merchant/' "$scratch/remote.sh"
grep -q 'docker network inspect -f.*masscom_showcase_edge' "$scratch/remote.sh"
grep -q 'MASSCOM_SHOWCASE_API_DOMAIN=:8082' "$scratch/remote.sh"
grep -q 'docker network connect masscom_showcase_edge' "$scratch/remote.sh"
grep -q 'showcase_address=' "$scratch/remote.sh"
grep -q 'https://demo-api.masscom.kr/merchants' "$scratch/remote.sh"
grep -q 'https://api.masscom.kr/merchants' "$scratch/remote.sh"
grep -q 'verify-showcase-edge-routes.mjs' "$scratch/remote.sh"
grep -qF 'web_collection_probe_response "http://$address/api/web/collection" masscom.kr' "$scratch/remote.sh"
grep -qF 'nft_metadata_probe_response "http://$address/nft-metadata/no-such/1.json"' "$scratch/remote.sh"
grep -qF 'web_consent_probe_response "http://$address/api/web/consent" masscom.kr' "$scratch/remote.sh"
grep -qF 'web_consent_probe_response "http://$address/api/web/v1/merchant/merchants/x/real-world-profile" masscom.kr' "$scratch/remote.sh"
grep -q 'web_rollback' "$scratch/remote.sh"
if grep -Eq 'compose_new (build|up).*\b(api|postgres|migrate)\b' "$scratch/remote.sh"; then
  echo 'web-only deploy script would modify API or database services' >&2
  exit 1
fi
bash "$repo_root/tests/ops/lightsail_web_rollback_test.sh"

mkdir -p "$scratch/checkout/scripts" "$scratch/bin"
cp "$deploy" "$guard" "$scratch/checkout/scripts/"
git init -q -b main "$scratch/checkout"
git -C "$scratch/checkout" add scripts
git -C "$scratch/checkout" -c user.name=Fixture -c user.email=fixture@example.invalid \
  commit -qm 'clean deployment fixture'
printf '\n# uncommitted executable change\n' >> "$scratch/checkout/scripts/lightsail-web-probe-guard.sh"
printf '#!/bin/sh\necho SSH_WAS_REACHED\nexit 79\n' > "$scratch/bin/ssh"
chmod +x "$scratch/bin/ssh"
status=0
output="$(env PATH="$scratch/bin:$PATH" "${common_env[@]}" \
  bash "$scratch/checkout/scripts/deploy-lightsail-web.sh" --deploy 2>&1)" || status=$?
if [[ "$status" == '0' || "$output" != *'web deployment source paths must match the committed revision'* ||
      "$output" == *'SSH_WAS_REACHED'* ]]; then
  echo 'dirty web probe guard reached SSH instead of failing the source check' >&2
  exit 1
fi

archive_checkout="$scratch/archive-checkout"
mkdir -p "$archive_checkout"
git -C "$repo_root" archive HEAD | tar -xf - -C "$archive_checkout"
cp "$deploy" "$archive_checkout/scripts/deploy-lightsail-web.sh"
git -C "$archive_checkout" init -q -b main
git -C "$archive_checkout" add .
git -C "$archive_checkout" -c user.name=Fixture -c user.email=fixture@example.invalid \
  commit -qm 'web archive fixture'
cat > "$scratch/bin/ssh" <<'SSH'
#!/usr/bin/env bash
case "$*" in
  *'/opt/masscom/web/DEPLOYED_COMMIT'*) printf '%040d\n' 1 ;;
  *'sudo install -d'*) ;;
  *'tar -xzf - -C'*) cat > "$CAPTURE_TAR" ;;
  *'bash -s --'*) exit 73 ;;
  *) cat >/dev/null ;;
esac
SSH
chmod +x "$scratch/bin/ssh"
status=0
: > "$scratch/known_hosts"
CAPTURE_TAR="$scratch/release.tar.gz" \
  MASSCOM_KNOWN_HOSTS_FILE="$scratch/known_hosts" \
  env PATH="$scratch/bin:$PATH" "${common_env[@]}" \
  bash "$archive_checkout/scripts/deploy-lightsail-web.sh" --deploy >/dev/null 2>&1 || status=$?
if [[ "$status" != '73' || ! -f "$scratch/release.tar.gz" ]]; then
  echo 'web release archive was not captured' >&2
  exit 1
fi
tar -tzf "$scratch/release.tar.gz" > "$scratch/archive-members.txt"
if ! grep -Fxq 'scripts/verify-showcase-edge-routes.mjs' "$scratch/archive-members.txt"; then
  echo 'web release archive omitted the remote edge verifier' >&2
  exit 1
fi

# Issue #225: under pipefail, curl exits 23 when the reader on its pipe stops early
# (grep -q/--quiet/-m, head, sed q). Join backslash continuations so multi-line pipes count too.
early_exit_pipe='curl[^|]*\|[[:space:]]*(grep[^|]*(-[A-Za-z]*[qm]|--quiet|--max-count)|head|sed[^|]*[[:space:]]q)'
joined_deploy="$(sed -e ':a' -e '/\\$/N' -e 's/\\\n//' -e 'ta' "$deploy")"
if grep -En "$early_exit_pipe" <<< "$joined_deploy"; then
  echo 'web deploy pipes curl into an early-exit reader; capture the body first (web_page_contains)' >&2
  exit 1
fi
(
  set -o pipefail
  curl() {
    [[ "$*" == *fail.invalid* ]] && return 22
    head -c 200000 /dev/zero | tr '\0' 'a'
    printf '\n실제 점포 관리\n'
    head -c 200000 /dev/zero | tr '\0' 'b'
  }
  web_page_contains 'http://page.invalid/admin/' '실제 점포 관리'
  if web_page_contains 'http://page.invalid/admin/' '점포 운영'; then
    echo 'web_page_contains accepted a missing phrase' >&2
    exit 1
  fi
  if web_page_contains 'http://fail.invalid/admin/' '실제 점포 관리'; then
    echo 'web_page_contains ignored a failed request' >&2
    exit 1
  fi
)

echo 'Lightsail web-only deploy preflight verified'
