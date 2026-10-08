- 2026-10-09 미완성 보완: 브랜치 `fix/ai-image-gap-fixes`, worktree `.worktrees/ai-image-gap-fixes`, 기준 main `055d0523`. real-world 쓰기 계정별 제한, 방문 CSV 고지·동의 버전, 활성 Worker 배포/복구 검증, 운영 AI 관리 wrapper를 보완했다. 이 소스는 아직 운영·시연에 배포하지 않았다.
- 실제 서버 변경: 소유자가 키를 직접 입력했고 두 API 모두 기존 이미지로 `ENABLED`·`healthy` 확인. 월 예산은 각 USD 5, 하루 시안·최종 각 3회다. 기존 Caddy에 web v1 matcher만 추가해 무인증 점주 프로필 401을 확인했다. 실제 유료 생성·새 migration·APK·NFT 활성화는 미실행이다([근거](evidence/openai-ai-art-enable-2026-10-09.json)).
- 새 `privacy-2026-10-09` 소스는 API·웹·양쪽 APK·시연 웹을 같은 릴리스로 제공해야 한다. 구 설치본이 업데이트 안내에 막힐 수 있으므로 API만 먼저 배포하지 않는다. 키 설정만 갱신한 이번 서버는 기존 동의 버전을 유지한다.

- 현재 작업: `.worktrees/t3-benefits`, `feat/campaign-benefits`, 기준 `055d0523`(T3 PR 1 병합). T3 PR 2 구현/검증과 문서가 변경 상태다. 이번 세션은 push/stash/rebase·배포·PR 생성/병합을 하지 않는다. 커밋은 shared Git index.lock 쓰기 차단으로 미실행이며 전체 파일은 11절에 기록한다.

- 이번 병합: `feat/cross-store-courses`에 PR #425가 포함된 `origin/main` `055d0523`를 병합 중이다. 충돌 해결은 파일 수정만 수행하고 add·commit·stash·rebase·push는 실행하지 않는다. 병합 후 단위 시험 합계의 통합 재측정 대기는 오케스트레이터가 채운다.

- 이번 작업: Issue #412 T4 A, `.worktrees/t4-courses`, 브랜치 `feat/cross-store-courses`, 기준 main `8841efea`. 검토 시작 HEAD는 `29644366`(기준 위 4개 커밋)이며 후속 커밋은 오케스트레이터가 담당한다. 이번 세션은 add·commit·stash·rebase·push·배포를 실행하지 않는다. 결정 D-093, 추가 전용 migration 0072. 검증은 TEST_STATUS 최상단과 실제 git 이력을 따른다.
- 기준 main 커밋 SHA: `a1a3eef3`(PR #430 반영, 현재 병합 대상). 작업 위치는 `.worktrees/pr429`, 브랜치 `feat/collectible-reeded-edge`, HEAD `9a433fee`이다. T3 혜택·T4 코스·T8 시연 점포와 PR #429 코인 제작기 변경을 보존하며 병합 충돌을 작업 트리 파일에서 해결한다. Git index는 아직 미병합 상태다. 앞선 별도 `integ/t3b-t4-t8`의 HEAD `ac285339`과 main `a8ed0dd1` 병합 검증은 [TEST_STATUS](TEST_STATUS.md)의 이력이다.
- 이 세션은 파일 수정만 수행한다. add·commit·stash·rebase·push·merge는 실행하지 않고 Git index의 미병합 상태를 유지한다. 제출 기준선은 마감 시점의 실제 최신 main과 [SUBMISSION_CHECKLIST](SUBMISSION_CHECKLIST.md)·`SUBMISSION_EVIDENCE.json`에서 별도 확정한다.

## 2. 현재 통합 상태
- T3 PR 2 최종 로컬 측정: API 625/625·typecheck/build PASS, PostgreSQL 557건 중 554 pass/0 fail/3 skip, 모바일 2098/2098·typecheck/lint PASS, 사이트 584/584와 기존 Chrome 1건 BLOCKED. CI 연결 94파일·접근성·지갑 표면·운영 문서 PASS. `LC_ALL=C bash tools/gate.sh` PASS(plain gate의 기존 Bash locale 오류는 TEST_STATUS에 별도 기록). 전체 근거는 TEST_STATUS 맨 위다.

- T4·T3 병합 충돌 해결(2026-10-09, main `055d0523`): 운영 문서 회귀·CI 연결(94개 시험 파일)·API typecheck PASS. 양쪽 기록·감사 단언 보존, migration 27/70, 합계 줄 동일, 14절·텍스트 충돌 표시 없음도 확인했다. API·모바일 단위 시험 합계의 통합 재측정 대기는 오케스트레이터가 채운다. PostgreSQL 통합·실기·배포는 NOT_RUN이며 Git index는 미병합 상태로 유지했다.

- T4 A 리뷰 수정 실행(2026-10-09): API 634/634, PG 553건 중 550 PASS/0 FAIL/3 SKIP, 모바일 2094/2094, 요청된 사이트 139/139; typecheck·모바일 lint·CI 연결·접근성·문서·gate PASS. PG SKIP은 별도 disposable hosted-showcase 55435 컨테이너가 필요한 기존 3건이다. 검토 시작 HEAD `29644366`(기준 위 4개 커밋); 후속 커밋은 오케스트레이터가 담당한다. 이번 세션은 Git 쓰기를 실행하지 않는다. [검증과 전달](evidence/t4-courses-2026-10-08.md)을 따른다. 전체 사이트·실제 브라우저/기기·설치·배포는 이번 실행에서 NOT_RUN이다.
- 현재 PR #429와 main `a1a3eef3` 병합의 지정 검사: 모바일 typecheck·lint·동일 glob Node loader 단위 시험 2148/2148·운영 제출 준비·모바일 접근성·CI 연결 103개 파일 `PASS`, `npm test`는 tsx IPC `EPERM`으로 `BLOCKED`다([TEST_STATUS](TEST_STATUS.md) 최신 항목). 아래 2132/2132·26/26 등의 수치는 앞선 별도 통합 브랜치 결과이며 이번 병합의 전체 통과 수치가 아니다.

- 앞선 별도 통합 브랜치의 main `a8ed0dd1` 병합 충돌 파일 검증: API typecheck `PASS`; 모바일 typecheck·lint와 대체 단위 2132/2132 `PASS`. `npm test`는 tsx IPC `listen EPERM`으로 `BLOCKED`다. 공공자료 고지·고정 뒷면 대상 26/26, CI 연결 101개 파일, 운영 제출 준비(migration 72건), 모바일 접근성은 `PASS`. 소켓 없는 API 직접 확인에서 점주 혜택 상태·AI art 권한과 점주 연장 POST 35회의 제한기 이전 404가 `PASS`다. 지정 사이트 선택 350건 중 344 PASS / 6 소켓 환경 BLOCKED(18건 묶음 12/18, 나머지 332/332 PASS)이고 혜택 웹 6/6, 제작기·현황·문구 67/67은 별도 PASS다. 추적 파일 충돌 표시 검사·점주 JavaScript 문법·`git diff --check` PASS. README·PROJECT_STATE의 당시 전체 API·모바일 합계는 그 병합의 전체 통과 수치가 없어 `__API__`·`__MOB__`로 두었다. 자세한 명령은 [TEST_STATUS](TEST_STATUS.md)의 해당 이력에 있다. API 전체 단위·build, PostgreSQL 통합·실기·배포는 그 검증에서 `NOT_RUN`이었다.

- 앞선 T3·T4·T8 통합(`HEAD 8c0bad5e`) 검증 이력: API typecheck `PASS`; `npm test`는 tsx IPC `EPERM`으로 `BLOCKED`, 대체 전체 단위 실행은 662건 중 488 `PASS` / 174 `FAIL`(모두 socket `listen EPERM`)이다. 모바일 typecheck·lint와 대체 단위 시험 2115/2115 `PASS`. 관리자 웹 혜택·목적·코스 격리 시험 22/22와 CI 연결 95개 파일 `PASS`; `verify_production_web_test.mjs`는 서버 listen 훅에서 멈춰 5초 제한 재실행이 시간 초과돼 환경 `BLOCKED`다. 운영 제출 준비 검사 `PASS`(실제 43 + 29 = 72건), 0072 감사 action 23개 합집합·`NOT VALID` 정적 확인 `PASS`. 이 수치는 PR #418 포함 main 병합 뒤의 전체 결과가 아니다.

- T4 A 리뷰 수정 실행(2026-10-09): API 634/634, PG 553건 중 550 PASS/0 FAIL/3 SKIP, 모바일 2094/2094, 요청된 사이트 139/139; typecheck·모바일 lint·CI 연결·접근성·문서·gate PASS. PG SKIP은 별도 disposable hosted-showcase 55435 컨테이너가 필요한 기존 3건이다. 검토 시작 HEAD `29644366`(기준 위 4개 커밋); 후속 커밋은 오케스트레이터가 담당한다. 이번 세션은 Git 쓰기를 실행하지 않는다. [검증과 전달](evidence/t4-courses-2026-10-08.md)을 따른다. 전체 사이트·실제 브라우저/기기·설치·배포는 이번 실행에서 NOT_RUN이다.
- T8 검증: API 615/615·typecheck·build, PostgreSQL 549건 중 546 PASS / 0 FAIL / 3 SKIP, 모바일 2094/2094·typecheck·lint, 선택기 2/2, 전용 hosted seed 3/3, CI wiring 94개 시험 연결, 모바일 접근성·`/play/` web export·운영 문서 검사·`LC_ALL=C bash tools/gate.sh` PASS. 세 PostgreSQL hosted-only skip은 별도 fresh Docker runner에서 각각 통과했다([TEST_STATUS](TEST_STATUS.md)). 웹 export에는 test-only OAuth client fixture를 썼으며 브라우저·로그인 수용은 `NOT_RUN`이다. 공개 서버·APK·웹 배포도 `NOT_RUN`이다.
1. `git status -sb`와 `git log -1 --oneline`으로 PR #429 브랜치·HEAD·미병합 파일을 확인한다. add·commit·stash·rebase·push·merge는 이번 작업에서 금지된다.
2. `cd apps/api && npm run typecheck && npm test`; `cd apps/mobile && npm run typecheck && npm run lint` 뒤 모바일 단위 시험을 실행한다. `npm test`가 막히면 `node --import tsx --test 'src/**/*.test.ts'`를 쓴다.
3. 저장소 루트에서 `bash tests/bootstrap/operations_submission_readiness_test.sh`, `bash tests/ci/ci_wiring_test.sh`, `bash tests/mobile/check_accessibility_semantics_test.sh`를 실행한다. README·PROJECT_STATE의 합계 자리표시자는 이번 작업에서 유지한다. 숫자만 바꾸는 운영 문서 변이 검사는 이 상태에서 실패할 수 있음을 별도로 기록한다.
4. migration 파일 순서와 0072 감사 CHECK의 전체 action을 확인하고 `git diff --check` 및 텍스트 충돌 표시 검사를 한다. PostgreSQL 통합과 실제 기기·브라우저·배포의 실행 여부는 [TEST_STATUS](TEST_STATUS.md)에 구분해서 기록한다.

PR 제목·본문 검사:

```bash
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
bash tests/bootstrap/check_pr_korean_test.sh  # checker 자체 회귀 시험
```

## 13. 승인·보안 경계

- 운영 키 생성·메인넷·사용자 자산 이동·Google Play 공개·대회 최종 제출은 별도 승인 경계다. 개인키·복구 문구·비밀번호는 기록하지 않는다.
- 운영 DB 첫 실제 복원과 복제본 데이터 보존, 배포 전 백업과 `09dfceb0` 실제 배포 결과는 각각 증거로 PASS다.
- braces·node-forge 의존성 보안 예외는 2026-10-31에 만료된다. 만료 전에 재검토한다.

## 14. 이력과 변경 규칙

- 이 세션은 파일만 수정하고 Git add·commit·stash·merge·rebase·push는 실행하지 않는다. 뒤에 커밋할 때는 한국어 의도 제목과 필요한 Lore trailer를 사용하며 AI 공동 작성자 서명은 넣지 않는다.
- T8 데이터 갱신: selector는 현재 `data_date=2026-06-30`만 허용한다. 새 스냅샷 사용 전에는 날짜 guard·attribution·상세 날짜 고지를 함께 검토해 바꾸고, 검토한 전체 JSON에 `node scripts/build-showcase-wolgye-stores.mjs <full JSON>`을 실행한다. 선택 결과·빠지거나 추가되는 상호와 기존 ID의 변경 메타데이터를 확인해 seed를 갱신한다. 이 스크립트는 기존 seed를 자동으로 교체하지 않는다. ID 데이터가 충돌하면 덮어쓰지 않고 롤백한다. 공개·운영 DB를 직접 갱신하지 않는다.

- 2026-09-22부터 2026-10-07까지의 날짜별 인수인계 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 그대로 보존한다. 과거 기록의 “현재”, “열린 PR”, “다음 명령”은 작성 당시의 상태다.
- 다음 중단 전 이 14절의 기준 SHA·브랜치·PR·공개 버전·검증 상태·다음 명령만 실제 근거에 맞춰 갱신한다.
