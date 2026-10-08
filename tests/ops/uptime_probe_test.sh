#!/usr/bin/env bash
# Issue #412: scripts/uptime-probe.sh를 가짜 curl·gh·openssl로 실행해 판정과 이슈 상태(통과 / 하나 실패해 이슈 열기 / 이미 열려 있으면 중복 없음 /
# 복구하면 닫기)를 확인한다. 네트워크와 GitHub에는 닿지 않는다. 필요한 것: bash, jq.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
probe="$repo_root/scripts/uptime-probe.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
fail() { echo "uptime probe test failed: $1" >&2; exit 1; }

bash -n "$probe"
mkdir -p "$scratch/bin" "$scratch/gh"

# 가짜 curl: 메서드와 URL(마지막 인자)로 응답을 고른다. FAKE_CURL_FAIL=<URL 조각>은 503, FAKE_CURL_SLOW=<URL 조각>은 4.5초로 답한다.
cat > "$scratch/bin/curl" <<'CURL'
#!/usr/bin/env bash
out='' method=GET auth=''
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    -o) out="${args[i + 1]}" ;;
    -X) method="${args[i + 1]}" ;;
    authorization:*) auth="${args[i]}" ;;
  esac
done
url="${args[${#args[@]} - 1]}"
echo "$method $url" >> "$FAKE_CURL_LOG"
status=200 ctype='application/json; charset=utf-8' time=0.120
body='{}'
showcase='{"merchants":[{"id":"showcase-local-merchant","demo":true},{"id":"showcase-local-merchant-b","demo":true},{"id":"showcase-local-merchant-c","demo":true}]}'
case "$method $url" in
  "GET https://api.masscom.kr/health"|"GET https://demo-api.masscom.kr/health") body='{"status":"ok"}' ;;
  "GET https://api.masscom.kr/merchants") body='{"merchants":[]}' ;;
  "GET https://demo-api.masscom.kr/merchants") body="${FAKE_SHOWCASE_MERCHANTS:-$showcase}" ;;
  "GET https://demo-api.masscom.kr/v1/discovery/merchants/showcase-local-merchant") body='{"merchant":{"id":"showcase-local-merchant","demo":true}}' ;;
  "GET https://demo-api.masscom.kr/merchants/showcase-local-merchant/collectible-preview") body='{"merchantId":"showcase-local-merchant","goals":[]}' ;;
  "GET https://demo-api.masscom.kr/play/")
    ctype='text/html; charset=utf-8'
    body='<html><head><title>x</title></head><body><script src="/play/_expo/static/js/web/__common-aaa.js" defer></script><script src="/play/_expo/static/js/web/entry-bbb.js" defer></script></body></html>' ;;
  "GET https://demo-api.masscom.kr/play/_expo/static/js/web/entry-bbb.js")
    ctype="${FAKE_JS_CTYPE:-text/javascript; charset=utf-8}"; body='console.log(1)' ;;
  "GET https://masscom.kr/app/"|"GET https://masscom.kr/merchant/") ctype='text/html; charset=utf-8'; body='<html><head><title>월계 마스코트</title></head></html>' ;;
  "POST https://demo-api.masscom.kr/auth/guest-trial") body='{"sessionToken":"fake-trial-token","accountId":"a","expiresAt":"2026-10-09T00:00:00Z","guest":true}' ;;
  "GET https://demo-api.masscom.kr/me/consent"|"GET https://demo-api.masscom.kr/collection")
    [[ "$auth" == 'authorization: Bearer fake-trial-token' ]] || status=401 ;;
  "POST https://demo-api.masscom.kr/auth/logout")
    [[ "$auth" == 'authorization: Bearer fake-trial-token' ]] || status=401
    body='{"status":"LOGGED_OUT"}' ;;
  *) status=404 ;;
esac
if [[ -n "${FAKE_CURL_FAIL:-}" && "$url" == *"$FAKE_CURL_FAIL"* ]]; then status=503; fi
if [[ -n "${FAKE_CURL_SLOW:-}" && "$url" == *"$FAKE_CURL_SLOW"* ]]; then time=4.500; fi
printf '%s' "$body" > "$out"
printf '%s|%s|%s' "$status" "$ctype" "$time"
CURL

# 가짜 gh: 열린 이슈는 $FAKE_GH_DIR/open 파일 하나(번호). 모든 호출을 calls.log에 남긴다.
cat > "$scratch/bin/gh" <<'GH'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_DIR/calls.log"
case "$1 $2" in
  "issue list") if [[ -s "$FAKE_GH_DIR/open" ]]; then printf '[{"number":%s}]\n' "$(cat "$FAKE_GH_DIR/open")"; else echo '[]'; fi ;;
  "label create") ;;
  "issue create")
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --title) echo "$2" > "$FAKE_GH_DIR/title" ;;
        --body-file) cp "$2" "$FAKE_GH_DIR/body" ;;
        --label) echo "$2" > "$FAKE_GH_DIR/label" ;;
      esac
      shift
    done
    echo 42 > "$FAKE_GH_DIR/open"
    echo 'https://github.com/example/repo/issues/42' ;;
  "issue close")
    : > "$FAKE_GH_DIR/open"
    shift 3
    while [[ $# -gt 0 ]]; do [[ "$1" != --comment ]] || echo "$2" > "$FAKE_GH_DIR/comment"; shift; done ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
GH

# 가짜 openssl: s_client는 통과하고, x509 -checkend는 FAKE_TLS_EXPIRING=1이면 만료 임박(종료 1)으로 답한다.
cat > "$scratch/bin/openssl" <<'SSL'
#!/usr/bin/env bash
case "$1" in
  s_client) echo CERT ;;
  x509) cat > /dev/null; [[ "${FAKE_TLS_EXPIRING:-}" != 1 ]] ;;
esac
SSL
chmod +x "$scratch/bin/curl" "$scratch/bin/gh" "$scratch/bin/openssl"

# run [환경 NAME=값...] -- [probe 인자...]: 결과는 $scratch/out(표준 출력+오류), 종료 코드는 code.
run() {
  local envs=()
  while [[ "$1" != -- ]]; do envs+=("$1"); shift; done
  shift
  : > "$scratch/curl.log"; : > "$scratch/gh/calls.log"
  rm -f "$scratch/gh/title" "$scratch/gh/body" "$scratch/gh/comment" "$scratch/gh/label"
  set +e
  env PATH="$scratch/bin:$PATH" FAKE_CURL_LOG="$scratch/curl.log" FAKE_GH_DIR="$scratch/gh" ${envs[@]+"${envs[@]}"} \
    bash "$probe" "$@" >"$scratch/out" 2>&1
  code=$?
  set -e
}
calls() { grep -c "$1" "$scratch/gh/calls.log" || true; }
no_issue() { : > "$scratch/gh/open"; }
open_issue() { echo 42 > "$scratch/gh/open"; }

# 1. 모두 통과: 종료 0, 이슈를 만들거나 닫지 않는다. 점검 대상 12곳 가운데 핵심 URL이 실제로 불렸다.
no_issue
run FAKE_X=1 --
[[ "$code" == 0 ]] || { cat "$scratch/out" >&2; fail "all-pass exited $code"; }
for url in https://api.masscom.kr/health https://api.masscom.kr/merchants https://demo-api.masscom.kr/health https://demo-api.masscom.kr/merchants \
    https://demo-api.masscom.kr/v1/discovery/merchants/showcase-local-merchant https://demo-api.masscom.kr/merchants/showcase-local-merchant/collectible-preview \
    https://demo-api.masscom.kr/play/ https://demo-api.masscom.kr/play/_expo/static/js/web/entry-bbb.js https://masscom.kr/app/ https://masscom.kr/merchant/; do
  grep -qxF "GET $url" "$scratch/curl.log" || fail "all-pass did not request $url"
done
[[ "$(calls 'issue create')" == 0 && "$(calls 'issue close')" == 0 ]] || fail 'all-pass touched issues'
grep -q 'guest-trial' "$scratch/curl.log" && fail 'the write probe ran without --write-probe'
grep -q '::warning::' "$scratch/out" && fail 'all-pass printed a warning'

# 2. 하나 실패하고 열린 이슈가 없다: 라벨을 만들고 한국어 제목의 이슈를 정확히 한 번 연다. 종료 1.
no_issue
run FAKE_CURL_FAIL=https://demo-api.masscom.kr/health --
[[ "$code" == 1 ]] || fail "one-fail exited $code"
[[ "$(calls 'label create uptime')" == 1 ]] || fail 'one-fail did not create the uptime label'
[[ "$(calls 'issue create')" == 1 ]] || fail 'one-fail did not open exactly one issue'
grep -q '^\[장애 감지\] ' "$scratch/gh/title" || fail "issue title is not the Korean detection title: $(cat "$scratch/gh/title")"
[[ "$(cat "$scratch/gh/label")" == uptime ]] || fail 'issue does not carry the uptime label'
grep -q 'showcase_health' "$scratch/gh/title" "$scratch/gh/body" || fail 'issue does not name the failed check'
grep -q 'HTTP 503' "$scratch/gh/body" || fail 'issue body does not show the failure'
grep -q 'prod_health' "$scratch/gh/body" && fail 'issue lists a check that passed'

# 3. 이미 열려 있다: 같은 장애로 이슈를 또 만들지 않는다(라벨도 다시 만들지 않는다).
open_issue
run FAKE_CURL_FAIL=https://demo-api.masscom.kr/health --
[[ "$code" == 1 ]] || fail "already-open exited $code"
[[ "$(calls 'issue create')" == 0 && "$(calls 'label create')" == 0 && "$(calls 'issue close')" == 0 ]] || fail 'already-open changed issues'
# 연속 두 번 실행해도 이슈는 하나다.
no_issue
run FAKE_CURL_FAIL=https://api.masscom.kr/health --
run FAKE_CURL_FAIL=https://api.masscom.kr/health --
[[ "$(calls 'issue create')" == 0 ]] || fail 'second failing run opened another issue'

# 4. 복구: 열린 이슈가 있고 모두 통과하면 복구 댓글과 함께 닫는다. 종료 0.
open_issue
run FAKE_X=1 --
[[ "$code" == 0 ]] || fail "recovery exited $code"
[[ "$(calls 'issue close 42')" == 1 ]] || fail 'recovery did not close the open issue'
grep -q '복구 확인' "$scratch/gh/comment" || fail 'recovery has no recovery comment'
[[ "$(calls 'issue create')" == 0 ]] || fail 'recovery opened an issue'

# 5. 경고(느린 응답·만료 임박 인증서)는 종료 0, 이슈 없음, 경고 주석만 남긴다.
no_issue
run FAKE_CURL_SLOW=https://api.masscom.kr/merchants FAKE_TLS_EXPIRING=1 --
[[ "$code" == 0 ]] || fail "warnings exited $code"
grep -q '::warning::prod_merchants' "$scratch/out" || fail 'slow response did not warn'
grep -q '::warning::tls_api.masscom.kr' "$scratch/out" || fail 'expiring certificate did not warn'
[[ "$(calls 'issue create')" == 0 ]] || fail 'warnings opened an issue'

# 6. 판정 기준: 시연 점포가 2곳이거나 demo:false가 섞이면 실패, 내려오지 않는 JS content-type도 실패.
no_issue
run 'FAKE_SHOWCASE_MERCHANTS={"merchants":[{"id":"a","demo":true},{"id":"b","demo":true}]}' --
[[ "$code" == 1 ]] && grep -q 'showcase_merchants' "$scratch/gh/title" || fail 'two showcase merchants were accepted'
grep -q 'showcase_discovery_detail' "$scratch/gh/body" && fail 'dependent checks ran without a merchant id'
no_issue
run 'FAKE_SHOWCASE_MERCHANTS={"merchants":[{"id":"a","demo":true},{"id":"b","demo":true},{"id":"c","demo":false}]}' --
[[ "$code" == 1 ]] || fail 'a non-demo showcase merchant was accepted'
no_issue
run 'FAKE_JS_CTYPE=text/html; charset=utf-8' --
[[ "$code" == 1 ]] && grep -q 'showcase_play_js' "$scratch/gh/body" || fail 'a non-JavaScript entry content-type was accepted'
no_issue
run FAKE_CURL_FAIL=/merchant/ --
[[ "$code" == 1 ]] && grep -q 'prod_merchant_title' "$scratch/gh/body" || fail 'a failing /merchant/ page was accepted'

# 7. 쓰기 점검(--write-probe): 게스트 체험 한 바퀴가 돌고 로그아웃까지 간다. 이 단계의 실패는 이슈를 열지 않고(이슈 상태는 1단계 결과만 따른다) 종료만 1이다.
no_issue
run FAKE_X=1 -- --write-probe
[[ "$code" == 0 ]] || { cat "$scratch/out" >&2; fail "write probe exited $code"; }
sed -n '/guest-trial/,$p' "$scratch/curl.log" | tr '\n' ' ' | grep -q 'POST https://demo-api.masscom.kr/auth/guest-trial GET https://demo-api.masscom.kr/me/consent GET https://demo-api.masscom.kr/collection POST https://demo-api.masscom.kr/auth/logout' \
  || fail 'write probe did not run start, consent, collection, logout in order'
grep -q '^::add-mask::fake-trial-token$' "$scratch/out" || fail 'session token was not masked'
if grep 'fake-trial-token' "$scratch/out" | grep -v '^::add-mask::' | grep -q .; then fail 'session token was printed outside the mask command'; fi
no_issue
run FAKE_CURL_FAIL=/me/consent -- --write-probe
[[ "$code" == 1 ]] || fail 'a failing write probe step did not fail the run'
grep -q 'POST https://demo-api.masscom.kr/auth/logout' "$scratch/curl.log" || fail 'write probe skipped logout after a failed step'
[[ "$(calls 'issue create')" == 0 ]] || fail 'a write probe failure opened an issue'
# 알 수 없는 인자는 거절한다.
no_issue
run FAKE_X=1 -- --nope
[[ "$code" == 2 ]] || fail 'an unknown argument was accepted'

# 8. 워크플로: 15분 cron + 수동 실행, 최소 권한, 동시 실행 하나, 5분 제한, 서드파티 액션 없음, 쓰기 점검은 수동 입력일 때만.
workflow="$repo_root/.github/workflows/uptime.yml"
grep -q "cron: '\*/15 \* \* \* \*'" "$workflow" || fail 'workflow is not scheduled every 15 minutes'
grep -q '^  workflow_dispatch:' "$workflow" || fail 'workflow has no manual trigger'
grep -qx '  issues: write' "$workflow" && grep -qx '  contents: read' "$workflow" || fail 'workflow permissions are not contents: read + issues: write'
grep -qx '  group: uptime' "$workflow" || fail 'workflow has no uptime concurrency group'
grep -q 'timeout-minutes: 5' "$workflow" || fail 'workflow has no 5 minute timeout'
if grep -E '^\s*-?\s*uses:' "$workflow" | grep -v 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683' | grep -q .; then
  fail 'workflow uses an action other than the pinned checkout'
fi
grep -q 'inputs.write_probe' "$workflow" || fail 'write probe is not tied to the manual input'

echo 'uptime probe tests passed'
