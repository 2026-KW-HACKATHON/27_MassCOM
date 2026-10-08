# HANDOFF

기준 시각: 2026-10-09 KST. T9 작업 트리의 현재 상태를 기록한다. 날짜별 이전 기록은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

## 1. 기준 커밋과 작업 위치

- 기준 main 커밋 SHA: `a8ed0dd1`(PR #418·#424·#426 반영 통합의 기준). 현재 worktree `/Users/choi/Desktop/MassCOM/27_MassCOM/.worktrees/t9-real`, 브랜치 `feat/showcase-real-only`, 이번 리뷰 수정의 시작/현재 HEAD `04f9ea2a`다. 초기 T9 구현 기준은 `c0449f1b`였다.
- 사용자 요청으로 파일만 수정했다. Git add·commit·stash·merge·rebase·push를 실행하지 않았다. 커밋·통합은 오케스트레이터가 맡는다. `gh pr list --head feat/showcase-real-only --state all` 조회 결과는 0건이다.

## 2. 현재 통합 상태

- T3 목적형 혜택·T4 코스·T8 월계 공공자료 점포와 PR #418 점주 제작기를 보존한 통합 기준 위에 T9를 구현했다.
- T9의 고객 공개 점포는 월계 공공자료 30곳뿐이다. 새 DB에는 비공개 체험 점주 가게를 포함해 점포/캠페인 31행·목표 93행이 생긴다. 기존 A/B/C는 삭제하지 않고 숨긴다.
- 더까까주까월계역점 한 곳만 5회 프리즘이고 나머지 29곳은 골드다. 새 코스는 더까까주까월계역점 → 갱스터떡볶이인덕대점 → 하다식당이다. D-101과 TEST_STATUS T9가 정본이다.

## 3. 공개 서버와 설치본

- 이번 세션은 서버·운영 DB·공개 웹·APK에 적용하지 않았다. 기존 기록의 운영 API/웹 `687427c2`, 시연 API `2d483ed`, `/play/` 소스 `5ca98955`, test.13·Preview 22는 이전 공개본이고 이번에 새로 조회하지 않았다.
- 자동 시험·로컬 disposable DB는 배포·설치·기기 수용 근거가 아니다. 공개 버전은 `docs/CURRENT_RELEASE.json`과 배포 증거에서 별도로 확인한다.

## 4. 이번 작업의 범위

- A/B/C 의존성: API seed·campaign/goal·badge offer·수집품·QA seed·직원/승인자·guest clone·course, 모바일 map/art/owner/tour/copy, 정적 `/preview/`, 모바일 `/play/`, APK/uptime/local QA probe, 현재 문서와 시험을 매핑했다.
- 기존 A/B/C merchant `PAUSED`·`published_at=NULL`, 캠페인 `ENDED`·비공개, 기존 멤버십 회수. 방문·보상·획득 코인·쿠폰·게시본은 그대로다. 새 seed는 실점포 30곳과 숨은 연습 가게만 생성한다.
- 공개된 옛 코스 단계는 불변이라 옛 코스를 종료하고 새 UUID `f81f04e0-bca8-4e36-a4e6-a812de5a7b80`로 코스를 만든다. ENDED/PAUSED 코스는 취소되지 않은 unlock이 있는 계정의 지난 코스 목록·상세·획득 장면에서 계속 읽으며 추천·신규 unlock에서는 제외한다(D-093/D-101).
- 점주 모드는 본인 `trialMerchantId`를 우선하고 승인된 `practiceMerchantId`만 fallback으로 사용한다. 공개 점포 목록을 점주 후보로 쓰지 않는다. 연습 가게 `trial-showcase-practice`는 고객 목록·추천·상세·지도·코스·추첨 풀·코인 카탈로그에 나오지 않는다. 배지 혜택·쿠폰 API 표시 이름은 `시연 혜택`이며 내부 점포 연결은 유지한다. 공공자료 점포는 오래된 멤버십이 있어도 관리 권한을 거절한다.

## 5. 시연 배포 순서

- 배포는 이번 범위가 아니다. 후속 담당자는 백업 → migration → 같은 API/웹 배포 창 → host seed → 고객 목록 정확히 30곳·연습/은퇴 가게 없음·기존 코인/쿠폰 조회 → 직원·승인자·게스트/D-091 검증 순서로 진행한다.
- 기존 A/B/C 직원 권한은 회수된다. Google 신원·활성 세션·계정·시연 DB 검사 뒤 공식 직원/승인 절차로 연습 가게 권한을 다시 부여한다. 문서만 보고 신원을 추정해 권한을 주지 않는다.
- 실제 두 variant 설치·실기·TalkBack·브라우저 화면 확인과 별개로 결과를 기록한다.

## 6. 운영 배포 조건

- T9는 시연 seed와 전용 namespace 권한·시연 표면만 바꾼다. 운영 seed·DB·기능·리워드·지갑·보상 정책 변경은 없다.
- PR #418의 API/웹 제작기 동시 전환·롤백과 두께 25~48 새 고객 앱 조건(D-096~D-099)은 여전히 적용된다. 시연에서는 전체 점포 관리 API를 연결하지 않고 접근 요청 승인 API만 유지한다.

## 7. 마이그레이션과 롤백 경계

- 새 T9 SQL migration은 없다. 통합 기준의 `0068` → `0069` → `0072` → `0075` 순서를 보존한다. 목적·혜택·코스 감사 action 합집합 23개와 기존 NFT 상한 해제 경계(D-095)는 그대로다.
- 제공된 전용 시험 DB에 먼저 migration을 적용했다. URL·비밀번호는 출력하거나 문서에 적지 않았다. hosted 전용 시험은 새 disposable PostgreSQL 컨테이너 세 개에서 순차 실행했다.
- 운영/시연 서버 DB 변경과 복원은 이번에 실행하지 않았다. 은퇴 점포를 자동 재공개하는 구 seed로 되돌리면 고객 목록이 다시 오염될 수 있다.

## 8. 개인정보 재동의와 버전 결합

- 동의 문구·버전·Google audience·package·서명 키는 이번에 바꾸지 않았다. 가게명·주소·좌표는 D-100 출처/비참여 고지를 유지하고 방문·코인은 가상임을 표시한다.
- 새로운 실제 영업·메뉴·가격·영업시간·제휴 사실은 만들지 않는다. 공공자료 영업 여부와 LOCALDATA 교차 확인은 NOT_RUN이다.

## 9. 자동 검증 상태

- HEAD `04f9ea2a` 후속 리뷰 실측: API 단위 672/672·모바일 2138/2138·API/모바일 typecheck·모바일 lint·API build PASS. 전체 PostgreSQL 593건 중 590 PASS·0 FAIL·기존 hosted 3 SKIP, 별도 hosted 3/3 PASS다. CI 연결·운영 문서·gate·diff PASS. 명령·환경·단언 추가와 첫 실행 실패 수정은 TEST_STATUS T9 후속 절에 있다.
- 초기 T9 사이트 측정은 645건 중 644 PASS·Chrome 1 환경 BLOCKED이며 접근성/지갑 검사도 당시 PASS다. 사이트·브라우저·실기는 이번 후속 작업에서 재측정하지 않았다.
- `bash tests/release/verify_showcase_apk_test.sh`·`bash tests/ops/uptime_probe_test.sh` PASS. 릴리스 준비 검사에는 30개 정확 ID·중복·은퇴/운영 점포 혼입 거절 회귀를 더했다. APK를 빌드하지 않았다.
- 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN`. T9 자동 시험의 PASS를 기존 실기/출시 관문으로 옮기지 않았다.
- site Chrome 테마 시험은 DevTools 이전 SIGABRT이며 환경 원인으로 따로 기록한다. 시험은 삭제/skip하지 않는다. LSP/AST 도구가 없어 독립 소스 검토·타입·실행 시험으로 확인했다.

## 10. 수동 수용과 미실행 항목

- 운영/시연 배포, 라이브 기존 DB 재시드, 새 APK·서명·설치·두 variant 실기, 실제 Google 직원/승인자 재부여, D-091 실제 기기 넘김, TalkBack, 현장 도보·영업 확인, Play 제출은 NOT_RUN이다.
- 실제 AI 과금·새 그림 생성·온체인 발행은 하지 않았다. 테스트 fixture와 public-data seed를 실제 점주 참여로 해석하지 않는다.

## 11. 남은 이슈와 PR 확인

- 현재 Git diff만 있으며 staging/commit/PR은 오케스트레이터가 맡는다. 신규 PR은 만들지 않았다. 기존 Issue #412/T3/T4/T8와 PR #418 변경은 보존했다.
- 최종 검토는 `git diff --check`, `git diff --stat`, `git diff`, `gh pr list --state all`로 실제 상태를 확인한다. 전용 namespace 이외 운영 권한/가게가 변하지 않았는지 확인한다.
- 모든 기존 단언 변경의 이유·새 대상은 TEST_STATUS T9 표에 기록한다. 기존 staff 전환의 공식 재부여와 시연 캠페인 공개/가게 비공개 구분은 인수인계의 운영 주의점이다.

## 12. 다음 실행 명령

```bash
git status --short --branch
git diff --check
git diff --stat
gh pr list --state all
bash tests/bootstrap/verify_operations_docs_test.sh
bash tools/gate.sh
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
```

`bash tests/bootstrap/check_pr_korean_test.sh`는 checker 자체 회귀 시험이며 실제 제목·본문 검사를 대신하지 않는다. 이번 세션에서는 Git write 명령을 실행하지 않는다. 재검증 명령·환경·제한은 TEST_STATUS의 T9 항목에 있다.

## 13. 승인·보안 경계

- 이번 사용자 직접 요청 범위의 파일 수정·검증만 실행했다. Git add·commit·stash·merge·rebase·push 금지는 유지했다.
- 키·권한·과금·운영 데이터·메인넷·Play·최종 제출의 기존 경계를 유지한다. 개인키·복구 문구·서명 키를 생성/조회하지 않았다.
- 직원 부여는 세션·Google subject와 정확한 연습 가게·시연 DB 검사에 따른다. UI 역할 선택이나 `demo:true`만으로 권한을 만들지 않는다.

## 14. 이력과 변경 규칙

- 이전 날짜별 인수인계는 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존한다. 오래된 33곳·A/B/C·설치본 증거는 당시 상태이며 새 배포 증거가 아니다.
- 다음 중단 전 14절의 SHA·브랜치·PR·공개 버전·검증 결과·다음 명령을 실제 근거에 맞춰 갱신한다. TEST_STATUS 현재 측정 합계와 README·PROJECT_STATE 동일 합계 줄을 함께 고친다.
