#!/usr/bin/env bash
# MassCOM 가동 점검(Issue #412). .github/workflows/uptime.yml이 15분마다 실행한다. 서버가 "켜져 있는지"만이 아니라 핵심 기능이 읽히는지를 본다.
#   1단계(매번, 읽기 전용): 운영·시연 API의 /health와 /merchants, 시연 점포 상세·수집품 미리보기, 시연 웹 /play/의 진입 JS, 운영 /app/·/merchant/ 제목.
#   2단계(--write-probe, 수동 실행만): 시연 게스트 체험 한 바퀴(시작 → /me/consent → /collection → 로그아웃). 한 번 실행이 체험 자리를 전역 300 중 1, 같은 클라이언트(IP)당 30 중 1
#     잡고 24시간 만료까지 놓지 않으며(로그아웃은 세션만 폐기하고 자리를 돌려주지 않는다), 체험 계정·체험 가게·캠페인 사본을 남긴다. 그래서 예약하지 않는다.
# 판정: 실패는 이슈로 알리고 종료 코드 1, 경고(TLS 인증서 만료 14일 미만·응답 3초 초과)는 주석과 요약에만 남기고 이슈를 만들지 않는다.
# 상태는 `uptime` 라벨이 붙은 열린 이슈 하나다: 실패했고 열린 이슈가 없으면 만들고, 열린 이슈가 있으면 중복해서 만들지 않으며, 모두 통과하면 댓글과 함께 닫는다.
# 2단계 실패는 이슈를 열지 않는다(체험 자리 소진 같은 일시 상태로 장애 이슈를 만들지 않는다. 이슈 상태는 1단계 결과만 따른다). 실행이 빨갛게 되고 요약에 남는다.
# 2단계 실패가 있으면 "모두 통과"로 열린 이슈를 닫지 않는다(복구 확인은 쓰기 점검까지 통과한 실행이거나 1단계만 돈 실행에서만 한다).
# 1단계에서 실패한 항목은 약 30초 뒤 한 번 더 돌려 그래도 실패일 때만 센다(일시적인 끊김으로 이슈를 열지 않으려는 것).
# 필요한 것: bash, curl, jq, openssl, gh(GH_TOKEN, GH_REPO). 비밀값은 쓰지 않는다. 사용법: scripts/uptime-probe.sh [--write-probe]
# ponytail: GitHub cron은 최선 노력이라 몇 분씩 밀리거나 건너뛴다(저장소가 60일 조용하면 꺼진다). 정확한 간격이 필요하면 외부 점검기를 쓴다.
set -uo pipefail

prod_api=https://api.masscom.kr
show_api=https://demo-api.masscom.kr
web=https://masscom.kr
slow_seconds=3
tls_warn_days=14
# 시험용 재정의(워크플로는 설정하지 않는다): 재시도 대기 초, 요청 시간 예산 초.
retry_wait_seconds="${UPTIME_PROBE_RETRY_WAIT:-30}"
budget_seconds="${UPTIME_PROBE_BUDGET:-200}"   # 전체가 멈춰 있어도 job 제한(5분) 전에 이슈까지 처리하도록, 이 시간이 지나면 남은 요청은 하지 않고 실패로 센다.

write_probe=false
case "${1:-}" in
  '') ;;
  --write-probe) write_probe=true ;;
  *) echo 'usage: uptime-probe.sh [--write-probe]' >&2; exit 2 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=''        # 1단계 실패(이슈 대상)
write_failures=''  # 2단계 실패(이슈 제외)
warnings=''
tier=1
code=000 ctype='' secs=0

fail() {
  if [[ "$tier" == 1 ]]; then failures+="- \`$1\`: $2"$'\n'; else write_failures+="- \`$1\`: $2"$'\n'; fi
  echo "실패: $1: $2"
}
warn() { warnings+="- \`$1\`: $2"$'\n'; echo "경고: $1: $2"; }
slow() {
  if LC_ALL=C awk -v s="$secs" -v max="$slow_seconds" 'BEGIN { exit !(s + 0 > max + 0) }'; then warn "$1" "응답 ${secs}초(기준 ${slow_seconds}초)"; fi
  return 0
}

# fetch URL [curl 인자...]: 본문은 $tmp/body, 결과는 code·ctype·secs. 연결 실패·시간 초과는 code=000이다(한 번 재시도).
fetch() {
  local url="$1" out=''
  shift
  : >"$tmp/body"
  code=000 ctype='' secs=0
  if (( SECONDS > budget_seconds )); then return 0; fi
  out="$(curl -sS --connect-timeout 5 --max-time 10 --retry 1 --retry-delay 2 -o "$tmp/body" \
    -w '%{http_code}|%{content_type}|%{time_total}' "$@" "$url" 2>/dev/null)" || true
  IFS='|' read -r code ctype secs <<<"$out"
  code="${code:-000}" secs="${secs:-0}"
  return 0
}

# check 이름 URL [JQ필터] [본문정규식] [curl 인자...]: 200이고, 필터·정규식이 있으면 본문이 통과해야 한다.
check() {
  local name="$1" url="$2" filter="${3:-}" regex="${4:-}"
  shift $(( $# < 4 ? $# : 4 ))
  fetch "$url" "$@"
  if [[ "$code" != 200 ]]; then fail "$name" "HTTP $code ($url)"; return 1; fi
  if [[ -n "$filter" ]] && ! jq -e "$filter" "$tmp/body" >/dev/null 2>&1; then
    fail "$name" "응답 JSON이 기대와 다릅니다 ($url)"; return 1
  fi
  if [[ -n "$regex" ]] && ! grep -Eiq "$regex" "$tmp/body"; then
    fail "$name" "응답 본문에 기대한 내용이 없습니다 ($url)"; return 1
  fi
  slow "$name"
}

# TLS: 만료까지 14일 미만이면 경고(Caddy는 30일 전에 갱신하므로 이 경고는 자동 갱신이 막혔다는 뜻이다). timeout이 없으면(macOS) 그대로 실행한다.
tls_timeout=''
if command -v timeout >/dev/null 2>&1; then tls_timeout='timeout 15'; fi
tls() {
  if (( SECONDS > budget_seconds )); then return 0; fi   # 예산이 끝났으면 TLS는 건너뛴다(앞 요청 실패가 이미 이슈 대상이다)
  # shellcheck disable=SC2086 # tls_timeout은 "timeout 15" 두 낱말이다
  # s_client의 종료 코드는 버전마다 달라 보지 않는다: 연결하지 못하면 인증서가 비어 x509가 실패한다.
  if ! { $tls_timeout openssl s_client -connect "$1:443" -servername "$1" </dev/null 2>/dev/null || true; } \
      | openssl x509 -noout -checkend $((tls_warn_days * 86400)) >/dev/null 2>&1; then
    warn "tls_$1" "인증서가 ${tls_warn_days}일 안에 만료되거나 확인하지 못했습니다"
  fi
}

# gh가 멈춰도 job이 5분 제한에 걸려 이슈 처리를 못 하고 죽지 않게 30초로 끊는다(timeout이 없으면 그대로 실행).
gh_timeout=''
if command -v timeout >/dev/null 2>&1; then gh_timeout='timeout 30'; fi
ghc() { $gh_timeout gh "$@"; }

# --- 1단계 ---------------------------------------------------------------------------------------------------------
tier1() {
  check prod_health "$prod_api/health" '.status == "ok"'
  check prod_merchants "$prod_api/merchants" '.merchants | type == "array"'
  check showcase_health "$show_api/health" '.status == "ok"'
  # 고객 시연은 월계 공공자료 점포 30곳만 허용한다. 연습 가게와 은퇴 fixture는 장애로 잡는다.
  merchant_id=''
  if check showcase_merchants "$show_api/merchants" '.merchants | type == "array" and length == 30 and all(.[]; .demo == true and (.id | startswith("showcase-wolgye-"))) and (map(.id) | unique | length == 30)'; then
    merchant_id="$(jq -r '.merchants[0].id | @uri' "$tmp/body")"
  fi
  if [[ -n "$merchant_id" ]]; then
    check showcase_discovery_detail "$show_api/v1/discovery/merchants/$merchant_id" '.merchant.demo == true'
    check showcase_collectible_preview "$show_api/merchants/$merchant_id/collectible-preview" '.goals | type == "array"'
  else
    echo '점포 목록이 없어 점포 상세·수집품 미리보기 점검은 건너뜁니다.'
  fi

  # 시연 웹: HTML이 200이고, 그 HTML이 이름을 부른 진입 JS가 200과 JavaScript content-type으로 내려와야 한다.
  if check showcase_play_html "$show_api/play/" '' '<script[^>]+src="/play/[^"]+\.js"'; then
    scripts="$(grep -Eo 'src="/play/[^"]+\.js"' "$tmp/body" | sed 's/^src="//; s/"$//')"
    entry="$(printf '%s\n' "$scripts" | grep 'entry-' | head -1)"
    [[ -n "$entry" ]] || entry="$(printf '%s\n' "$scripts" | tail -1)"
    fetch "$show_api$entry"
    if [[ "$code" != 200 ]]; then
      fail showcase_play_js "HTTP $code ($show_api$entry)"
    elif [[ "$ctype" != *javascript* ]]; then
      fail showcase_play_js "content-type이 JavaScript가 아닙니다: ${ctype:-없음}"
    else
      slow showcase_play_js
    fi
  fi

  check prod_app_title "$web/app/" '' '<title>[^<]+</title>'
  check prod_merchant_title "$web/merchant/" '' '<title>[^<]+</title>'

  for host in api.masscom.kr demo-api.masscom.kr masscom.kr; do tls "$host"; done
}

tier1
# 실패가 있으면 잠시 뒤 1단계를 한 번 더 돌려 그 결과로 판정한다(읽기 전용이라 다시 돌려도 부작용이 없다). 쓰기 점검은 다시 돌리지 않는다.
if [[ -n "$failures" ]] && (( SECONDS + retry_wait_seconds < budget_seconds )); then
  echo "1단계 실패 ${retry_wait_seconds}초 뒤 한 번 더 확인합니다:"
  printf '%s' "$failures"
  failures='' warnings=''
  sleep "$retry_wait_seconds"
  tier1
fi

# --- 2단계(수동) ---------------------------------------------------------------------------------------------------
if [[ "$write_probe" == true ]]; then
  tier=2
  if check guest_trial_start "$show_api/auth/guest-trial" '.sessionToken | type == "string"' '' \
      -X POST -H 'content-type: application/json' --data '{}' --retry 0; then
    token="$(jq -r '.sessionToken' "$tmp/body")"
    echo "::add-mask::$token"
    auth="authorization: Bearer $token"
    check guest_consent "$show_api/me/consent" '' '' -H "$auth"
    check guest_collection "$show_api/collection" '' '' -H "$auth"
    # 로그아웃은 세션만 폐기하고 체험 자리는 돌려주지 않는다(24시간 뒤 만료까지 잡힘). 그래도 앞 단계가 실패했든 열린 세션을 남기지 않으려 항상 한다.
    check guest_logout "$show_api/auth/logout" '' '' -X POST -H "$auth"
  fi
  tier=1
fi

# --- 결과와 이슈 상태 -----------------------------------------------------------------------------------------------
# 실행 화면의 주석은 재시도까지 끝난 최종 결과로만 만든다(첫 시도에서 흔들렸다가 회복한 항목이 빨간 주석으로 남지 않게).
printf '%s' "$failures$write_failures" | sed -n 's/^- `\([^`]*\)`: /::error::\1: /p'
printf '%s' "$warnings" | sed -n 's/^- `\([^`]*\)`: /::warning::\1: /p'
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo '## 가동 점검'
    if [[ -z "$failures$write_failures" ]]; then echo '모든 점검 통과'; else printf '### 실패\n%s%s\n' "$failures" "$write_failures"; fi
    if [[ -n "$warnings" ]]; then printf '### 경고\n%s\n' "$warnings"; fi
  } >>"$GITHUB_STEP_SUMMARY"
fi

open_issue="$(ghc issue list --label uptime --state open --limit 1 --json number | jq -r '.[0].number // empty')" || {
  echo '::error::열린 uptime 이슈를 조회하지 못했습니다(GH_TOKEN·GH_REPO·issues 권한 확인)' >&2
  exit 1
}

if [[ -n "$failures" ]]; then
  if [[ -n "$open_issue" ]]; then
    echo "이미 열린 장애 이슈 #$open_issue 가 있어 새로 만들지 않습니다."
  else
    names="$(printf '%s' "$failures" | sed -n 's/^- `\([^`]*\)`.*/\1/p' | paste -sd, - | sed 's/,/, /g')"
    run_url=''
    if [[ -n "${GITHUB_RUN_ID:-}" ]]; then run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/$GITHUB_RUN_ID"; fi
    {
      echo '자동 가동 점검(`.github/workflows/uptime.yml`)에서 아래 항목이 실패했습니다.'
      echo
      printf '%s' "$failures"
      if [[ -n "$warnings" ]]; then printf '\n경고(이슈 대상은 아님)\n%s' "$warnings"; fi
      echo
      echo "- 점검 시각(UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      if [[ -n "$run_url" ]]; then echo "- 실행 기록: $run_url"; fi
      echo
      echo '다음 점검이 모두 통과하면 이 이슈에 복구 댓글을 남기고 자동으로 닫습니다. 열려 있는 동안에는 같은 장애로 이슈를 더 만들지 않습니다.'
    } >"$tmp/issue.md"
    ghc label create uptime --color B60205 --description '자동 가동 점검이 연 장애 이슈' >/dev/null 2>&1 || true  # 이미 있으면 실패하므로 무시
    ghc issue create --label uptime --title "[장애 감지] 핵심 기능 점검 실패: $names" --body-file "$tmp/issue.md" || exit 1
  fi
elif [[ -n "$open_issue" && -z "$write_failures" ]]; then
  ghc issue close "$open_issue" --reason completed \
    --comment "복구 확인: $(date -u +%Y-%m-%dT%H:%M:%SZ)(UTC) 점검에서 모든 항목이 통과했습니다. 자동으로 닫습니다." || exit 1
fi

[[ -z "$failures$write_failures" ]]
