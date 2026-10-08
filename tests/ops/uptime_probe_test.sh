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
echo "$*" >> "$FAKE_CURL_LOG.args"
status=200 ctype='application/json; charset=utf-8' time=0.120
body='{}'
showcase="$FAKE_REAL_SHOWCASE_MERCHANTS"
case "$method $url" in
  "GET https://api.masscom.kr/health"|"GET https://demo-api.masscom.kr/health") body='{"status":"ok"}' ;;
  "GET https://api.masscom.kr/merchants") body='{"merchants":[]}' ;;
  "GET https://demo-api.masscom.kr/merchants") body="${FAKE_SHOWCASE_MERCHANTS:-$showcase}" ;;
  "GET https://demo-api.masscom.kr/v1/discovery/merchants/showcase-wolgye-MA010120220813334279") body='{"merchant":{"id":"showcase-wolgye-MA010120220813334279","demo":true}}' ;;
  "GET https://demo-api.masscom.kr/merchants/showcase-wolgye-MA010120220813334279/collectible-preview") body='{"merchantId":"showcase-wolgye-MA010120220813334279","goals":[]}' ;;
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
# FAKE_CURL_FAIL_ONCE=<URL 조각>: 그 주소의 첫 요청만 503이다(일시적인 끊김).
if [[ -n "${FAKE_CURL_FAIL_ONCE:-}" && "$url" == *"$FAKE_CURL_FAIL_ONCE"* && ! -e "$FAKE_GH_DIR/once-done" ]]; then : > "$FAKE_GH_DIR/once-done"; status=503; fi
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
  s_client) echo "$*" >> "$FAKE_GH_DIR/openssl.log"; echo CERT ;;
  x509) cat > /dev/null; [[ "${FAKE_TLS_EXPIRING:-}" != 1 ]] ;;
esac
SSL
chmod +x "$scratch/bin/curl" "$scratch/bin/gh" "$scratch/bin/openssl"
export FAKE_REAL_SHOWCASE_MERCHANTS
FAKE_REAL_SHOWCASE_MERCHANTS="$(node -e 'const data = require(process.argv[1]); process.stdout.write(JSON.stringify({merchants:data.stores.map(({id})=>({id,demo:true}))}))' "$repo_root/apps/api/src/showcase/wolgye-stores.json")"

# run [환경 NAME=값...] -- [probe 인자...]: 결과는 $scratch/out(표준 출력+오류), 종료 코드는 code.
run() {
  local envs=()
  while [[ "$1" != -- ]]; do envs+=("$1"); shift; done
  shift
  : > "$scratch/curl.log"; : > "$scratch/curl.log.args"; : > "$scratch/gh/calls.log"; : > "$scratch/gh/openssl.log"
  rm -f "$scratch/gh/title" "$scratch/gh/body" "$scratch/gh/comment" "$scratch/gh/label" "$scratch/gh/once-done"
  set +e
  env PATH="$scratch/bin:$PATH" UPTIME_PROBE_RETRY_WAIT=0 FAKE_CURL_LOG="$scratch/curl.log" FAKE_GH_DIR="$scratch/gh" ${envs[@]+"${envs[@]}"} \
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
    https://demo-api.masscom.kr/v1/discovery/merchants/showcase-wolgye-MA010120220813334279 https://demo-api.masscom.kr/merchants/showcase-wolgye-MA010120220813334279/collectible-preview \
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

# 6. 판정 기준: 원본 점포가 빠지거나 가상/운영 점포가 섞이면 실패, 내려오지 않는 JS content-type도 실패.
no_issue
run 'FAKE_SHOWCASE_MERCHANTS={"merchants":[{"id":"a","demo":true},{"id":"b","demo":true}]}' --
[[ "$code" == 1 ]] && grep -q 'showcase_merchants' "$scratch/gh/title" || fail 'two showcase merchants were accepted'
grep -q 'showcase_discovery_detail' "$scratch/gh/body" && fail 'dependent checks ran without a merchant id'
no_issue
wrong_demo="$(printf '%s' "$FAKE_REAL_SHOWCASE_MERCHANTS" | jq '.merchants[0].demo = false')"
run "FAKE_SHOWCASE_MERCHANTS=$wrong_demo" --
[[ "$code" == 1 ]] || fail 'a non-demo showcase merchant was accepted'
no_issue
legacy_mixed="$(printf '%s' "$FAKE_REAL_SHOWCASE_MERCHANTS" | jq '.merchants[0].id = "showcase-local-merchant"')"
run "FAKE_SHOWCASE_MERCHANTS=$legacy_mixed" --
[[ "$code" == 1 ]] || fail 'a retired virtual merchant mixed into catalog stores was accepted'
no_issue
too_many="$(printf '%s' "$FAKE_REAL_SHOWCASE_MERCHANTS" | jq '.merchants += [.merchants[0]]')"
run "FAKE_SHOWCASE_MERCHANTS=$too_many" --
[[ "$code" == 1 ]] || fail 'an extra public showcase store was accepted'
no_issue
duplicate="$(printf '%s' "$FAKE_REAL_SHOWCASE_MERCHANTS" | jq '.merchants[1] = .merchants[0]')"
run "FAKE_SHOWCASE_MERCHANTS=$duplicate" --
[[ "$code" == 1 ]] || fail 'duplicate real store IDs were accepted'
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
# 쓰기 점검이 실패한 실행은 "모두 통과"로 열린 이슈를 닫지 않는다. 쓰기 점검까지 통과하면 닫는다.
open_issue
run FAKE_CURL_FAIL=/me/consent -- --write-probe
[[ "$code" == 1 && "$(calls 'issue close')" == 0 && "$(calls 'issue create')" == 0 ]] || fail 'a failing write probe closed or reopened the issue'
open_issue
run FAKE_X=1 -- --write-probe
[[ "$code" == 0 && "$(calls 'issue close 42')" == 1 ]] || fail 'a fully passing write-probe run did not close the recovered issue'
# 게스트 체험 시작은 자동 재시도(--retry)를 끈다(재시도가 체험 자리를 두 번 잡으면 안 된다). 읽기 요청은 한 번 재시도한다.
run FAKE_X=1 -- --write-probe
grep 'auth/guest-trial' "$scratch/curl.log.args" | grep -q -- '--retry 0' || fail 'guest-trial POST can be retried by curl'
grep 'https://api.masscom.kr/health' "$scratch/curl.log.args" | grep -q -- '--retry 1' || fail 'read checks lost their single curl retry'
[[ "$(grep -c 'POST https://demo-api.masscom.kr/auth/guest-trial' "$scratch/curl.log")" == 1 ]] || fail 'the write probe ran more than once'
# 알 수 없는 인자는 거절한다.
no_issue
run FAKE_X=1 -- --nope
[[ "$code" == 2 ]] || fail 'an unknown argument was accepted'

# 7b. 실패한 1단계 항목은 잠시 뒤 한 번 더 확인한다: 일시적인 끊김은 이슈가 되지 않고 실행 주석도 남지 않으며, 계속되는 실패만 센다.
no_issue
run FAKE_CURL_FAIL_ONCE=https://api.masscom.kr/health --
[[ "$code" == 0 ]] || { cat "$scratch/out" >&2; fail "a one-off failure exited $code"; }
grep -q '한 번 더 확인' "$scratch/out" || fail 'the failed check was not re-run'
[[ "$(calls 'issue create')" == 0 ]] || fail 'a failure that recovered on the re-check opened an issue'
grep -q '::error::' "$scratch/out" && fail 'a recovered failure left an error annotation'
[[ "$(grep -cxF 'GET https://api.masscom.kr/health' "$scratch/curl.log")" == 2 ]] || fail 'the failing check was not requested exactly twice'
no_issue
run FAKE_CURL_FAIL=https://api.masscom.kr/health --
[[ "$code" == 1 && "$(calls 'issue create')" == 1 ]] || fail 'a persisting failure was not counted after the re-check'
grep -q '::error::prod_health' "$scratch/out" || fail 'a persisting failure has no error annotation'

# 7c. 시간 예산이 끝나면 TLS 점검은 건너뛰고(openssl을 부르지 않는다) 남은 요청은 실패로 센다. 재시도도 하지 않는다.
no_issue
run UPTIME_PROBE_BUDGET=-1 --
[[ "$code" == 1 && "$(calls 'issue create')" == 1 ]] || fail 'an exhausted time budget was not reported as a failure'
[[ ! -s "$scratch/gh/openssl.log" ]] || fail 'TLS checks ran after the time budget was exhausted'
[[ ! -s "$scratch/curl.log" ]] || fail 'requests were sent after the time budget was exhausted'
no_issue
run FAKE_X=1 --
[[ -s "$scratch/gh/openssl.log" ]] || fail 'TLS checks did not run within the budget'

# 7d. gh는 timeout으로 감싼 ghc 함수로만 부른다(멈춘 gh가 job을 5분 제한까지 붙잡지 않게).
if grep -nE '(^|[^[:alnum:]_.-])gh (issue|label)' "$probe" | grep -v '^[0-9]*:[[:space:]]*#' | grep -q .; then fail 'the probe calls gh without the 30 second timeout wrapper'; fi
grep -q "gh_timeout='timeout 30'" "$probe" || fail 'the gh timeout wrapper is missing'

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
