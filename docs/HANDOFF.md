# HANDOFF

## 2026-10-09 CI 병렬 작업 분리 (미커밋)

작업 위치 `.worktrees/ci`, 브랜치 `ci/parallel-jobs`, 기준 HEAD `3645c4c7dedc3fc750e9ebadc218432a74a23e0a`. 기존 검사를 API·PG 2샤드·모바일·웹/운영/문서·계약/worker로 분리하고 필수 `bootstrap-contract` 집계를 유지했다. 변경 파일은 `.github/workflows/ci.yml`, 새 `tests/ci/parallel_jobs.test.mjs`, TEST_STATUS·AI_USAGE·이 인수인계 항목이다. 로컬 CI 연결·기존 YAML 참조 회귀·샤드/집계 2/2·YAML/문법/명령 보존 PASS; 실제 GitHub 약 5~6분 예상은 미측정, actionlint 미설치. 다음 로컬 확인은 `bash tests/ci/ci_wiring_test.sh`와 `node --test tests/ci/parallel_jobs.test.mjs`; 상세는 [TEST_STATUS](TEST_STATUS.md) 최상단. 사용자 지시로 Git add·commit·stash·merge·rebase·push와 원격 CI 실행은 하지 않았다.


기준 시각: 2026-10-09 KST. 배경음 수정 브랜치 `fix/bgm-start`에 PR #433 반영 main `c7632b35`를 병합 중인 작업 트리의 현재 상태를 기록한다. 날짜별 이전 기록은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

## 1. 기준 커밋과 작업 위치

- 병합 대상 main SHA: `c7632b35`(사용자 지정 PR #433 반영). 현재 worktree `/Users/choi/Desktop/MassCOM/27_MassCOM/.worktrees/bgm`, 브랜치 `fix/bgm-start`, HEAD `6af6ab47`, MERGE_HEAD `c7632b35`다. 앱 전역 BGM은 D-103, T9 가상 점포 은퇴는 D-101, PR #429 제작기 후속은 D-102를 따른다.
- 사용자 요청으로 파일만 수정했다. Git add·commit·stash·merge·rebase·push를 실행하지 않았다. 커밋·통합은 오케스트레이터가 맡는다. 이전 T9 작업의 `gh pr list --head feat/showcase-real-only --state all` 조회 결과는 0건이었다. 이번 문서 충돌 해결에서는 원격 PR·CI를 조회하지 않았다. 파일에서 충돌을 제거해도 index는 미병합 상태로 남는다.

## 2. 현재 통합 상태

- BGM은 네이티브 첫 렌더 뒤 지연 준비, 웹의 신뢰된 입력과 자산 준비 뒤 앱 전역 loop를 재생한다. 뽑기 intro→loop·꺼짐·전경·로그아웃·정리와 웹 재생 성공까지 입력 리스너 유지/재시도를 보존한다(D-103).

**이전 BGM·T9 이력 — 아래 위치·SHA·검증 결과는 당시 기록이며 현재 병합 상태와 구분한다.**

**앞선 2026-10-09 웹 BGM 첫 입력 리뷰 차단 수정 (당시 미커밋·미배포)**

- 위치: `.worktrees/bgm`, 브랜치 `fix/bgm-start`, 실제 HEAD `570b5e58`. 아래 앱 시작 배경음 복구는 이 HEAD에 커밋됐다. 이번 수정은 로드 전 입력을 소비하지 않고, 실제 재생 성공까지 신뢰된 입력 리스너를 유지/재등록한다. expo-audio 거절 상태 전달·동기 입력 재생·BGM 꺼짐/로그아웃/unmount 정리와 별도 효과음 로더를 유지한다.
- 모바일2162/2162·대상43/43·typecheck·lint·CI 연결103개 파일·운영 문서 PASS. npm test는 sandbox tsx IPC EPERM으로 BLOCKED이며 같은 glob의 Node loader로 검증했다. 기존 lint 경고1개. 최신 근거는 [TEST_STATUS](TEST_STATUS.md) 최상단과 `/tmp/bgm-review-*.log`다. API·실제 Safari/Chrome autoplay·각 Android variant 청음·빌드·배포는 NOT_RUN이다.
- 사용자 지시대로 Git add·commit·stash·merge·rebase·push를 실행하지 않았고 index는 비어 있다. 다음 로컬 검토 명령은 `git diff --check`, `git diff`. 아래 수치는 이전 작업의 이력이다.

**앞선 2026-10-09 앱 시작 배경음 복구 (당시 미커밋·미배포)**

- 위치: `.worktrees/bgm`, 브랜치 `fix/bgm-start`, 기준 main/HEAD `8aa8b724`. 소유자 보고 "음악이 처음엔 안 나오고 뽑기 한 후부터 재생됨"을 공통 sound controller에서 수정했다. 네이티브 첫 렌더 뒤 지연 loop·웹 첫 입력 loop·뽑기 intro→loop를 유지하며 D-084의 초점 의존은 D-103으로 대체했다.
- 모바일 전체 대체 실행 2156/2156·대상 37/37·타입·린트·접근성·릴리스 지갑 표면·CI 연결 103개 파일·운영 문서 PASS. `npm test`는 sandbox tsx IPC `EPERM`으로 BLOCKED다. API 672/672는 기존 측정값이며 이번 재실행은 없다. [TEST_STATUS](TEST_STATUS.md) 최상단과 `/tmp/bgm-*.log`를 따른다.
- Git add·commit·stash·merge·rebase·push는 수행하지 않았고 staging은 비어 있다. PR을 생성/조회하지 않았다. 웹 첫 화면 실측·실제 autoplay/청음·운영/시연 Android 각각의 설치/실기·배포는 NOT_RUN이다. 다음 로컬 명령은 `git diff --check`, `git diff`이며 실제 청음 수용은 별도다. 아래 PR #429 작업은 직전 이력이다.

**이전 T9 기준 커밋과 작업 위치**

- 병합 대상 main SHA: `8aa8b724`(PR #429 반영). 현재 worktree `/Users/choi/Desktop/MassCOM/27_MassCOM/.worktrees/t9-real`, 브랜치 `feat/showcase-real-only`, HEAD `65699443`, MERGE_HEAD `8aa8b724`다. 이전 T9 통합 기준은 main `a8ed0dd1`(PR #418·#424·#426 반영), 초기 구현 기준은 `c0449f1b`, 후속 리뷰 기준은 `04f9ea2a`였다.

- T3 목적형 혜택·T4 코스·T8 월계 공공자료 점포와 PR #418 점주 제작기를 보존한 T9(D-101)에 PR #429의 회전·움직임 분리·Flame 오라·옆면(D-102)을 함께 보존한다.
- T9의 고객 공개 점포는 월계 공공자료 30곳뿐이다. 새 DB에는 비공개 체험 점주 가게를 포함해 점포/캠페인 31행·목표 93행이 생긴다. 기존 A/B/C는 삭제하지 않고 숨긴다.
- 더까까주까월계역점 한 곳만 5회 프리즘이고 나머지 29곳은 골드다. 새 코스는 더까까주까월계역점 → 갱스터떡볶이인덕대점 → 하다식당이다. D-101과 TEST_STATUS T9가 정본이다.

**이전 PR #429·통합 이력 — 아래 위치·SHA·검증 결과는 당시 기록이며 현재 BGM·T9 병합 상태와 구분한다.**

**앞선 2026-10-09 PR #429에 main `a1a3eef3` 병합 충돌 해결 기록 (당시 미커밋)**

- 위치: `.worktrees/pr429`, 브랜치 `feat/collectible-reeded-edge`, HEAD `9a433fee`. PR #430 반영 main `a1a3eef3` 병합의 충돌 파일을 수정 중이며 Git index는 의도대로 미병합 상태다. PR #429의 회전·Flame 오라·옆면과 main의 T3 혜택·T4 코스·T8 공공자료 점포 고지 및 접근성 이름을 함께 보존한다.
- README·PROJECT_STATE의 현재 전체 합계는 사용자 요청대로 `__API__`·`__MOB__`를 유지한다. 이번 병합의 모바일 대체 단위 2148/2148와 typecheck·lint·운영 제출 준비·접근성·CI 연결 103개 파일은 PASS, `npm test`는 tsx IPC `EPERM`으로 BLOCKED다. 아래 PR #429와 Issue #412 수치는 각각 이전 작업의 기록이다. 이번 작업에서는 파일만 수정하며 Git add·commit·stash·merge·rebase·push와 배포·실기는 실행하지 않는다.

**앞선 PR #429 CI 수정 전달 (미커밋)**

- 당시 위치: `.worktrees/pr429`, 브랜치 `feat/collectible-reeded-edge`, HEAD `6231def8`, 열린 [PR #429](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/429), 당시 기준 main `a8ed0dd1`. 당시 사용자 직접 지시에 따라 staging·commit·stash·merge·rebase·push를 하지 않았다.
- Flame `useAnimatedProps` 안의 imported helper 호출을 같은 SVG 수식으로 인라인했다. 기존 crash guard assertion은 그대로이고, 실제 callback 경로/불투명도와 helper의 일치를 시험1건 추가했다. 결정은 D-102로 정정했다. 회전/움직임 분리·Flame·옆면·실버 림·기본 스티커 제거는 유지한다.
- 추가 수정: 기록한 polygon 좌표의 0이 아닌 동일·대칭 깊이와 cap/옆면 연결을 복원했고 PR의 새 assertion도 보존했다. 모바일·웹은 저장 순서의 활성 Flame 오라 앞4개만 렌더링하며 뒤의 효과는 저장본을 바꾸지 않고 무시한다. 64개 상한 회귀와 기존 worklet 안전성 PASS.
- 최신 모바일2113/2113·typecheck·lint·접근성 PASS, 사이트330건 중324 PASS·6 소켓 BLOCKED, 최종 깊이11/11 PASS. 로그는 `/tmp/pr429-extra-*.log`, 상세는 [TEST_STATUS](TEST_STATUS.md)의 같은 PR 추가 수정 표를 따른다. 아래 API·release·CI·운영 문서 결과는 이전 수정 기록이다.
- 이전 검증: 모바일2112/2112·typecheck·lint, API typecheck, 접근성·release 지갑 표면·CI 연결·운영 문서 검사 PASS. API625건 중457 PASS·168 소켓 BLOCKED, 사이트331건 중325 PASS·6 소켓 BLOCKED. 상세 명령·사이트 결과·로그는 [TEST_STATUS](TEST_STATUS.md)의 PR #429 CI 수정 절을 따른다. `npm test`의 tsx IPC 차단은 `node --import tsx --test 'src/**/*.test.ts'`로 우회했다.
- 다음 명령: 소켓을 허용하는 CI에서 `npm test --prefix apps/api`와 `node --test tests/site/collectible-*.test.mjs tests/site/merchant-copy-no-newcomer.test.mjs`를 재실행한다. 운영 배포·Android 실제 설치본은 NOT_RUN이며 이번 수정만으로 실기 안전성을 확정하지 않는다.

**앞선 2026-10-09 새 점주 제작기 후속 전달**

브랜치 `feat/collectible-reeded-edge`는 #418 병합 뒤 최신 main `a8ed0dd1` 기준의 별도 PR이다. main squash 트리와 앞서 통합한 `f2a29439`는 동일하다. 실버 테두리·기본 스티커 제거, 큰 편집 화면·붓 경도/확대, 흑백·회전/움직임 분리·단일 재생, 강도별 재질·Flame 오라, 고정 후면 실시간 조명과 얇은 옆면 홈을 담는다. [캡처·저장·성능](evidence/coin-edge-2026-10-09/README.md), [시험](TEST_STATUS.md)을 확인한다. 로컬 합성 게시·재읽기와 독립 리뷰를 수행했다. 최악 조건 새 각도50ms 초과는 남아 있어 추가 성능 검수가 필요하다. 운영 배포·Android 실기는 실행하지 않았다. 기존API/웹 동시 배포·1/3/5 보상 조건을 유지한다.

**이전 BGM 리뷰 작업 위치**

- 기준 main 커밋 SHA: `8aa8b724`(PR #429 병합 반영). 작업 위치는 `.worktrees/bgm`, 브랜치 `fix/bgm-start`, HEAD `570b5e58`다. 앱 시작 BGM 복구는 HEAD에 커밋됐고 이번 웹 입력 리뷰 수정은 미커밋이며 Git index는 비어 있고 미병합 파일은 없다. 앞선 `feat/collectible-reeded-edge`·`integ/t3b-t4-t8` 검증은 [TEST_STATUS](TEST_STATUS.md)의 이력이다.
- 이 세션은 파일 수정만 수행한다. add·commit·stash·rebase·push·merge는 실행하지 않는다. 제출 기준선은 마감 시점의 실제 최신 main과 [SUBMISSION_CHECKLIST](SUBMISSION_CHECKLIST.md)·`SUBMISSION_EVIDENCE.json`에서 별도 확정한다.

**이전 통합 상태와 병합 이력**

- T9 이전 T8 시연 seed는 공공자료 점포 30곳과 A/B/C를 합쳐 33곳이었다. 현재 고객 공개 점포는 위 T9의 30곳이며 A/B/C는 은퇴 상태다. 공공자료 점포 이름이 보이는 곳의 개별 고지와 접근성 이름을 유지한다. 운영 DB·서버·설치본·공개 `/play/`에는 배포하지 않았다. 이 병합 작업에서 Git add/commit/push/merge는 실행하지 않는다.
- T8 리뷰 고지 후속 이력: 원래 브랜치 `feat/showcase-wolgye-stores`, HEAD `29afaf46` 위 미커밋 변경의 기록. 고객 가게명 카드·행·지도·추천·홈과 수집/보상/공유의 공공자료 시연 고지를 공통 ID helper로 표시하고 접근성 이름에도 넣었다. 모바일 동일 glob Node loader 2105/2105·typecheck·lint·접근성·지갑 표면 PASS. `npm test` 자체는 sandbox IPC `EPERM`으로 BLOCKED(동일 시험의 Node loader 결과와 구분). 정확한 범위·제한은 [TEST_STATUS](TEST_STATUS.md)의 T8 리뷰 절에 있다. 사용자 지시로 add/commit/stash/rebase/push 없음. 다음 검토 명령은 `git diff --check`, `git diff`; 배포·새 설치본 검증은 하지 않았다.
- T8 원래 기준 main: `055d05237a6f65cfe4b00e29ce95c26d6eb67ece`(PR #425 병합). 작업 브랜치 `feat/showcase-wolgye-stores`는 이 기준에서 시작해 월계동 공공 상가정보 점포 30곳을 showcase seed에 더했다([D-100](DECISIONS.md)). 현재 통합 상태는 1절의 브랜치와 worktree에서 확인한다.
- T3 혜택([D-094](DECISIONS.md), migration 0069)과 T4 코스([D-093](DECISIONS.md), migration 0072)를 함께 보존한다. 적용 순서는 0068 → 0069 → 0072 → 0075다. 0072의 감사 CHECK는 먼저 적용된 목적·혜택 action과 코스 action을 모두 허용해야 한다.
- PR #424의 NFT 시리즈 발행 상한 해제([D-095](DECISIONS.md), migration 0075)는 병합 대상 main `a1a3eef3`에 포함된다. 기존 Base Sepolia 상한 1 실증 시리즈는 운영 발행에 쓰지 않는다. 운영·시연 배포와 설치본은 이 통합으로 바뀌지 않았다.
- 현재 PR·CI 상태는 이번 문서 작업에서 조회하지 않았다. 재개할 때 `git status -sb`, `git log -1 --oneline`, `gh pr list --state all`로 확인한다.
- 최신 main SHA는 `git log -1 origin/main`으로 확인한다. 앞서 기록한 `687427c2` 운영 배포와 test.13·Preview 22·`/play/` 증거는 2026-10-08 당시 공개 상태를 가리킨다([3절](#3-공개-서버와-설치본)). 제출 기준선은 마감 시점의 최신 `main`이며, 확정 SHA는 [SUBMISSION_CHECKLIST](SUBMISSION_CHECKLIST.md)와 `SUBMISSION_EVIDENCE.json`의 `baselineCommit`에 기록한다.
- PR #413(운영 웹 Caddy `/api/web/v1/*` 라우트 수정, `ff5b5b6a`)과 PR #414([Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 놀이 변경, 결정 D-082, `108f6b38`), PR #415(같은 이슈의 첫 사용 경험, 결정 D-083~D-087, `e06c97cd`), PR #421(같은 이슈의 T5 운영 품질, `b707ed09`), PR #422(같은 이슈의 T1 API 서버 구조 정리, 결정 D-088, `cd01c0d6`), PR #420(NFT 발행 Worker 상시 실행, 결정 D-089, `48a14811`), PR #425(T3 점주 목적형 캠페인, main `055d0523`)는 병합됐다. 최신 main 확인은 위와 같이 `git log -1 origin/main`으로 한다.
- 병합 순서: PR #403(점검 결함 수정, `2d483ed8`) → #404(시연 배포·Preview 20·test.11 기록, `09dfceb0`) → #405(공개 체험 결함 4건 수정·운영 배포 기록·test.12/Preview 21, `08f125b4`) → #402(뽑기 `CONSENT_REQUIRED`의 "동의 확인하기" 연결, `a742e32d`) → #406(재측정·대체 시연 영상·제출 후보 기록, `6ce8ad03`) → #408(Issue #407의 낮은 화면 결함 4건 수정과 #402를 다음 설치본·웹 체험에 반영, `687427c2`). Issue #401은 #403 병합으로 닫혔다.
- 운영·시연 서버 배포와 수정본 `/play/` 재측정은 끝났다. Issue #407의 코드(`5ca98955`)로 운영 test.13·시연 Preview 22를 게시했고 시연 `/play/`를 같은 소스로 전환했다. #402의 변경도 이 설치본과 `/play/`에 들어 있다. 라이브 `/open`은 test.13·Preview 22를 가리킨다(2026-10-08 확인).
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T3 PR 1(점주 목적형 캠페인·혜택 시간대·"첫 방문" 표기 정정)은 브랜치 `feat/purpose-campaigns`를 main `cd01c0d6` 위에서 시작해 main `8841efea`(PR #420·#423)를 병합한 작업이다. migration `0068_campaign_purposes.sql`, `apps/api`·`apps/mobile`·`apps/production-web` 코드와 시험, 문서를 바꿨고 결정은 [D-092](DECISIONS.md)다. 배포하지 않았다(소유자 결정 A).
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T1(API 서버 구조 정리)은 PR #422로 병합돼 main `cd01c0d6`에 있고 배포하지 않았다. `apps/api`만 바꾼 작업이며 요청·응답 동작은 바꾸지 않았다. 구조 규칙은 [D-088](DECISIONS.md)이다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T1(API 서버 구조 정리)의 병합 전 이력은 `apps/api`만 바꾼 작업이다. 브랜치 `refactor/api-deps-routes`를 main `b707ed09`(PR #413·#414·#415·#421 병합) 위로 옮겼고 요청·응답 동작은 바꾸지 않았다. 구조 규칙은 [D-088](DECISIONS.md)이다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)(첫 사용 경험)의 T2 작업(브랜치 `feat/first-use-v2`)은 PR #415로 병합돼 main `e06c97cd`에 있고 배포하지 않았다. 결정은 [D-083~D-087](DECISIONS.md)이다. 같은 이슈의 T5(운영 품질) 작업(브랜치 `chore/ops-quality-t5`)은 PR #421로 병합돼 main `b707ed09`에 있고 배포하지 않았다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T2c(점진적 공개·점주 1인 2역·최소 크기)는 브랜치 `feat/first-use-v2c`에서 PR #423으로 main `8841efea`에 병합됐다. 병합 전에는 PR #420이 병합된 main `48a14811` 위로 리베이스했다. 결정은 [D-090~D-091](DECISIONS.md)이다(D-089는 main의 PR #420 몫이다).
- PR #398·#400·#402·#403·#404·#405·#406·#408·#413·#414·#415·#420·#421·#422·#423은 병합됐다. #398을 열린 PR로 적은 과거 전달은 [당시 기록](HANDOFF_HISTORY.md#2026-10-07-pr이슈-점검-전달-결과)이다.
- NFT 발행 Worker 상시 실행([D-089](DECISIONS.md))의 [PR #420](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/420)은 병합돼 main `48a14811`에 있고 서버 배포·운영 활성화는 하지 않았다.
- PR #396은 닫혔으나 main에 병합되지 않았다. 미병합 초안을 공개본 기능으로 계산하지 않는다.
- 재개 시 `git status -sb`, `git log -1 --oneline`, `gh pr list --state all`로 다시 대조한다.

## 3. 공개 서버와 설치본

- 이번 세션은 서버·운영 DB·공개 웹·APK에 적용하지 않았다. 기존 기록의 운영 API/웹 `687427c2`, 시연 API `2d483ed`, `/play/` 소스 `5ca98955`, test.13·Preview 22는 이전 공개본이고 이번에 새로 조회하지 않았다.
- 자동 시험·로컬 disposable DB는 배포·설치·기기 수용 근거가 아니다. 공개 버전은 `docs/CURRENT_RELEASE.json`과 배포 증거에서 별도로 확인한다.

## 4. 이번 작업의 범위

- 이번 실행은 README·HANDOFF·PROJECT_STATE·TEST_STATUS 문서 충돌만 해결한다. DECISIONS의 D-001~D-103은 중복 없이 번호순임을 확인하며 내용은 유지한다. 아래는 함께 보존한 T9와 앞선 구현 범위다.
- A/B/C 의존성: API seed·campaign/goal·badge offer·수집품·QA seed·직원/승인자·guest clone·course, 모바일 map/art/owner/tour/copy, 정적 `/preview/`, 모바일 `/play/`, APK/uptime/local QA probe, 현재 문서와 시험을 매핑했다.
- 기존 A/B/C merchant `PAUSED`·`published_at=NULL`, 캠페인 `ENDED`·비공개, 기존 멤버십 회수. 방문·보상·획득 코인·쿠폰·게시본은 그대로다. 새 seed는 실점포 30곳과 숨은 연습 가게만 생성한다.
- 공개된 옛 코스 단계는 불변이라 옛 코스를 종료하고 새 UUID `f81f04e0-bca8-4e36-a4e6-a812de5a7b80`로 코스를 만든다. ENDED/PAUSED 코스는 취소되지 않은 unlock이 있는 계정의 지난 코스 목록·상세·획득 장면에서 계속 읽으며 추천·신규 unlock에서는 제외한다(D-093/D-101).
- 점주 모드는 본인 `trialMerchantId`를 우선하고 승인된 `practiceMerchantId`만 fallback으로 사용한다. 공개 점포 목록을 점주 후보로 쓰지 않는다. 연습 가게 `trial-showcase-practice`는 고객 목록·추천·상세·지도·코스·추첨 풀·코인 카탈로그에 나오지 않는다. 배지 혜택·쿠폰 API 표시 이름은 `시연 혜택`이며 내부 점포 연결은 유지한다. 공공자료 점포는 오래된 멤버십이 있어도 관리 권한을 거절한다.

- 함께 보존하는 앞선 통합 범위는 PR #429의 회전·움직임 분리, Flame 오라·옆면(D-102)와 main의 T3 PR 2 캠페인 혜택/쿠폰(D-094, 0069), T4 A 가게 사이 코스(D-093, 0072), T8 시연 점포(D-100), PR #418 점주 제작기(D-096~D-099)를 함께 보존하는 충돌 해결이다. 관리자 API·웹, 고객 가게 상세, 감사 시험과 문서에서 두 기능을 함께 유지한다. 0072 감사 CHECK가 앞선 0069 혜택 action을 누락하지 않도록 검사한다.
- **T8 월계동 시연 점포(2026-10-09):** 원본 487곳에서 월계역 기준 가장 가까운 30곳을 선택했다. 중분류별 6/6/6/5/3/2/2곳, 거리 약 28–823m다. `is_demo = true`와 안정 ID `showcase-wolgye-<SEMAS id>`로 표시하며, `merchant.story`에 D-100의 고정 비참여 고지를 넣는다. 영업시간·메뉴·가격·점포 소개 등 확인되지 않은 정보는 만들지 않았고 코인 그림은 기존 A/B/C 템플릿을 분류별로 재사용한다. 출처는 소상공인시장진흥공단 상가(상권)정보 2026-06-30이며, 영업 여부와 LOCALDATA는 교차 확인하지 않았다.
- PR #418은 AI 초안·준비 이미지 스튜디오, 4단계 사진 편집, 1/3/5 고정 방문 보상, 프리즘을 포함한 네 기본 등급, v2 고정 뒷면 12종과 회전 속도·두께 48을 더했다. 점주 캠페인 연장 경로는 제거됐고 관리자 연장은 유지한다. 기존 발행본은 보존한다([D-096~D-099](DECISIONS.md), [화면·검증](evidence/merchant-dual-studio-2026-10-08/WEB_QA.md)).

- [Issue #401](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/401)은 제출 전 운영·문서·심사 대응 정리이며 #403 병합으로 닫혔다. PR #408은 [Issue #407](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/407)의 앱 수정 코드와 test.13·Preview 22 게시, `/play/` 전환, 현재 요약 문서 갱신을 함께 담아 병합됐다.
- [수정본 재측정](evidence/submission-2026-10-08-recheck/README.md)(Playwright, 시연 서버 임시 계정만)에서 이전 [17단계 실측](evidence/submission-2026-10-08/README.md)의 결함 4건이 모두 FIXED였다. 5분 시연 15단계가 전부 PASS이고 `console.error`·`pageerror`·4xx/5xx·요청 실패는 0건이다. 대체 시연 영상 `demo-flow-390.webm`(10,053,739바이트·4분 8초·390×844)과 캡처 68장을 같은 폴더에 보존했다.
- 재측정이 새로 본 낮은 결함 4건(이웃 방 하단 탭 두 벌 렌더링·탐색 선택 표시, 이웃 방→탐색 뒤 브라우저 뒤로 가기가 앱 밖으로 나감, 다크 꾸미기 "대표 수집 코인" 칩 흰색, 떠 있는 탭 바 아래 8px 틈으로 콘텐츠 비침)에 대응하는 수정이 `5ca98955`에 들어 있다. 숨은 `(tabs)` 탭 바를 그리지 않아 탭 바를 한 벌로 줄이고, 웹에서 하위 화면→처음 가는 탭 이동 시 history를 덮어쓰지 않고 추가하며(`apps/mobile/patches/expo-router+57.0.23.patch`, 웹 전용), 꾸미기 선택 칩에 테마 색을 쓰고, 탭 바 아래 띠를 배경으로 덮었다. 모바일 1,883/1,883·typecheck·lint·접근성·운영/시연 Android export·variant 자산·gate PASS, 독립 리뷰(Claude sonnet) APPROVE(🔴/🟠 없음)다. 새 `/play/` 번들의 공개 측정은 [next-build 측정 기록](evidence/next-build-2026-10-08/README.md)을 따르며 이 문서는 그 결과를 대신 적지 않는다. 구현·검증은 [PROJECT_STATE](PROJECT_STATE.md)와 [TEST_STATUS](TEST_STATUS.md)를 따른다.
- Issue #409·#410은 전면 평가 후속이다. 앱 코드: 웹 history 패치가 popstate 때 인덱스를 다시 맞추고(`a3033a80`의 해시 진입·헛누름 수정 위), 꾸미기 칩 접근성 이름에서 ✓ 글리프를 빼고, 6개 화면의 라디오·체크박스 역할 16개에 `aria-checked`와 웹 Space 키 토글을 붙였다(`apps/mobile/src/ui/space-toggles.ts`, `tests/mobile/check_accessibility_semantics_test.sh`에 가드). CI: 미연결 시험 6개(`account-deletion-flow`, `admin-funnel`, `merchant-actions-overview`, `check_pr_korean_test.sh`, `dump_aab_manifest_test.sh`, `db_restore_drill_test.sh`)를 연결하고 `production-recovery` 이중 실행을 없앴다. 새 가드 `tests/ci/ci_wiring_test.sh`는 연결 안 된 시험이 있으면 실패한다. `.gitignore`는 `dist-*-qa/`를 무시한다. 문서: README 재구성, 모순 정리, 폰 2대 실제 QR 시연 절([DEMO_RUNBOOK](DEMO_RUNBOOK.md)).
- Issue #412의 놀이 변경(`feat/play-store-memory`, PR #414로 병합)은 클라이언트만 바꿨다. 짝 찾기 여섯 장은 방문한 가게들의 코인이고(7곳 이상이면 KST 하루 단위로 시작 가게를 돌린다, 6곳 미만은 연습 그림), 결과판에 가게 이름·다음 수집품 안내·도감 이동을 보인다. 주문·배달은 준비·진행·결과에 고정 문구 "가게 메뉴 정보로 만든 가상 놀이예요. 실제 주문·결제·매출은 없어요."를 붙이고 가격을 보이지 않으며 결과에 가게 상세 링크를 한 줄 둔다. 방문 버튼은 붙이지 않았고 놀이는 발견 이벤트를 기록하지 않는다. API·migration·`play-rules.ts`는 그대로다. 결정은 D-082다. 배포하지 않았다(소유자 결정 A).
- 저장소 정리: worktree 82→12개, 로컬 브랜치 207→30개(main에 병합된 것만 삭제), 원격(origin) 브랜치 162→22개(main에 완전히 포함된 140개 삭제, 미병합과 `sync/*` 유지)다.
- Issue #412 T1(API 서버 구조 정리, `refactor/api-deps-routes`, PR #422로 병합): `server.ts`를 `routes/*`(경로 처리기 17개, 고정 순서)·`http/*`(요청·응답 도우미)·`api-deps.ts`(이름 붙은 `ApiDeps`)·`api-runtime.ts`(서버 인스턴스별 제한기·확인)로 나눴다. 마무리에서 교차 리뷰의 🟡를 반영했다: deps를 복사해 한 번만 얼림, 기본값 세 가지(`trustProxyClientIp`·`webWwwEnabled`·`experienceServices`)를 한곳에서 정함, 웹 로그인 콜백 쿠키와 삭제 접수 서비스 두 개의 배선을 시험으로 고정, `experienceServices`를 `Required<ExperienceServices>`로 검사. 요청·응답 동작은 `89d7a5e4`와 같다(인라인 비교 1797/1797줄, 차이는 로그아웃 블록 위치뿐).
- 운영 웹 Caddy 라우트 수정(PR #413으로 병합): `@webSession`·`@privateSurface`에 `/api/web/v1/*`를 더하고 실제 Caddy 컨테이너 시험(`verify_web_session_proxy_test.mjs`)·배포 검증기·웹 smoke·웹 배포 probe에 이 경로를 고정했다. 시연 호스트는 같은 Caddyfile을 써서 별도 수정이 없다. 후속으로 `apps/api/src/real-world-http.ts` 쓰기의 계정별 제한을 트랙 T6, [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)로 넘겼다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)는 신규 사용자의 첫 코인 흐름과 첫 화면 즉시 반응이다(소유자 2026-10-08 방향, PR #415로 병합). 앱 코드만 바뀌었고 API·DB는 그대로다. (1) 웹 대기 안내 `apps/mobile/public/index.html`과 웹 번들의 지갑 SDK 제외(진입 번들 6,375,429B → 4,119,372B), 지연 소리 생성. (2) 동의 화면의 늘 보이는 정확한 요약·접힌 전체 안내·"전체 동의". (3) 홈의 요청별 표시와 "처음이라면 이 가게부터", 가게 카드·상세의 사실 표시 원칙, 첫 코인 "내 공간에 놓기" 제안. (4) 웹 마스코트·랜드마크 접근성. 배포·게시는 하지 않았다(소유자 결정 A).
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)는 기능 수준 감시와 운영 품질 작업이다. PR #421(브랜치 `chore/ops-quality-t5`, 병합 커밋 `b707ed09`)로 main에 15분 가동 점검(`.github/workflows/uptime.yml`, 실패는 `uptime` 라벨 이슈, 쓰기 점검은 수동 전용), 운영·시연 매일 백업 유닛(`masscom-backup`, 호스트에 설치하지 않음), `scripts/db-restore-drill.sh --restore-only`, 큰 파일 가드(`scripts/check-large-files.sh`와 예외 목록), 현재 배포 상태를 손으로 고치는 기준 파일 `docs/CURRENT_RELEASE.json`과 생성·검사 스크립트(검사 범위는 `open.html` 블록 밖·README "바로 체험"·DEMO_RUNBOOK·SUBMISSION_CHECKLIST이고, 날짜별 이력 표인 `docs/ANDROID_DOWNLOADS.md`는 밖이다), CI의 API 단위 커버리지 요약(줄 약 58.5%, 보고용)을 더했다. 설치본 용량은 [분석 문서](APK_SIZE_ANALYSIS.md)에 측정값과 가설만 적었다. 배포하지 않았고(소유자 결정 A) 공개 상태는 3절 그대로다. 절차는 [운영 절차](OPERATIONS_RUNBOOK.md)의 Issue #412 절에 있다.
- Issue #412 T3 PR 1(`feat/purpose-campaigns`): 관리자가 캠페인 초안에 목적(처음 확인되는 방문·다시 방문·한산한 시간대)을 선택 입력으로 붙이고(`POST /api/web/admin/campaign-drafts`의 `purpose`, 캠페인·목표·목적·감사 한 거래), 공개 뒤에는 DB 트리거가 조건 변경을 거절한다(`intro_*` 예외). 방문 확정 경로는 방문·코인·보상권을 시간대와 무관하게 세고(D1), 발급·재발급 응답에 `windowStatus`, 확정 응답에 `benefit.state`를 더했다(기준은 점원이 코드를 만든 `claim_slots.created_at`). 점주 화면·CSV의 "첫 방문/재방문"은 "처음 확인된 방문/다시 확인된 방문"으로 바뀌었다. 혜택·쿠폰·비용 상한, 결과 카드, 파일럿 설정 패널은 뒤 PR이고 `intro_*` 쓰기 경로도 거기서 만든다. 개인정보 처리방침의 "첫 방문/재방문" 설명은 소유자 승인 전까지 그대로다. 트랙 T6의 방침 버전 갱신 때 바로잡을 목록: 실제 방문 CSV는 `방문시각(KST)`을 초 단위로, 캠페인과 쿠폰 발급·사용 건수를 내보내고 가명 고객 열은 없는데 방침(`docs/privacy.html`)은 "가명 고객 표시·한국 날짜·첫 방문/재방문·보상 현황"이라고 적고, 라벨 문구(`방문구분(MassCOM 확인 기준)`, `처음 확인된 방문`)도 방침과 다르다([BLOCKERS](BLOCKERS.md) B-033).

- NFT 발행 Worker 상시 실행([D-089](DECISIONS.md))은 브랜치 `feat/worker-continuous-loop`(기준 main `e06c97cd`, 이후 main `cd01c0d6`을 병합해 갱신)의 [PR #420](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/420)으로 병합돼 main `48a14811`에 있다(처음 D-080으로 적었으나 main의 D-080과 겹쳐 D-089로 바꿨다). Worker는 설정·키·DB·게이트웨이를 한 번만 만들고 반복하며(`npm start`/`start:prod`), 반복마다 이벤트 조회 시작 블록을 커서에서 다시 계산한다. 운영 compose의 `mint-worker`는 프로파일 `nft-live`로만 켜지고 평소 배포·배포 스크립트에는 나타나지 않으며, 운영 API의 `NFT_MINTING_MODE: PREPARING`은 그대로다. 일회용 DB·임의 키로 한 컨테이너 리허설과 Linux 시험은 PASS(결과는 [TEST_STATUS](TEST_STATUS.md)), 로컬(WSL) 상시 Worker의 Base Sepolia 테스트넷 실발행 1건(디버깅용 임시 계약, 2026-10-08)은 PASS, 독립 리뷰(Claude Sonnet + Opus, 🔴 없음·변경 요청)의 지적은 고쳤다(RPC 주소 로그 노출·프로세스 종료를 막은 영수증 대기 교체, 잡히지 않은 오류 종료 처리, DB 풀 오류 리스너, 번호 변경 등). `tools/gate.sh`는 PASS다. 서버 배포·운영 활성화·메인넷은 `NOT_RUN`이다. 켜기 전에 배포 절차(migrate 전 `mint-worker` 중지, 이미지 재빌드)를 보강해야 한다([Lightsail 문서](../infra/lightsail/README.md)). Windows에서는 키 파일 권한 시험 5개와 Lightsail README 시험이 CRLF·NTFS 때문에 실패하므로 Linux(WSL/CI)에서 확인한다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412) T2c: 앱 코드만 바뀌었고 API·DB는 그대로다. (1) 점진적 공개: 첫 코인 전·첫 코인 뒤·단골 단계에 따라 홈·도감·머리글의 입구가 열린다. 친구·쪽지와 놀이는 설정 "더 즐기기"에서 사람이 켜고, 이미 친구가 있는 계정은 켜진 것으로 본다(D-090). (2) 점주 시연 "1인 2역": 계정에 묶여 한 번만 읽히는 메모리 속 넘김과 단계 카드(D-091). (3) 방문 완료 뒤 마일리지 줄, 글자 12dp·터치 44dp 최소 크기, 죽은 코드와 개발용 경로 정리(`/shop-again`은 `/shop`으로 리다이렉트). 배포·게시는 하지 않았다(소유자 결정 A).

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

- 이번 BGM과 main `c7632b35` 병합 문서 검사: `bash tests/bootstrap/operations_submission_readiness_test.sh`(A01·A02·A03)·`bash tests/ci/ci_wiring_test.sh`(103개 파일)·`git diff --check` PASS. 합계 줄 일치·D-001~D-103 번호순/중복 없음·14절·BGM→T9 이력 순서·충돌 표식 없음과 Git index·HEAD·MERGE_HEAD 불변을 확인했다. 상세는 [TEST_STATUS](TEST_STATUS.md) 최상단에 기록한다. 전체 API·모바일·PostgreSQL·빌드·실기·배포·원격 PR/CI 확인은 이번 실행에서 NOT_RUN이며 현재 합계 자리표시자는 오케스트레이터가 채운다.
- 앞선 T9와 main `8aa8b724` 병합 문서 충돌 해결: `bash tests/bootstrap/operations_submission_readiness_test.sh`(A01·A02·A03)·`bash tests/ci/ci_wiring_test.sh`(103개 파일)·`git diff --check` PASS. 합계 줄 일치·D-101/D-102 번호순/중복 없음·14절·충돌 표식 없음과 Git index·HEAD·MERGE_HEAD 불변을 확인했다. 전체 API·모바일·PostgreSQL·빌드·실기·배포는 이번 실행에서 NOT_RUN이며 현재 합계 자리표시자는 오케스트레이터가 채운다. 아래는 각각 앞선 작업의 검증 이력이다.
- HEAD `04f9ea2a` 후속 리뷰 실측: API 단위 672/672·모바일 2138/2138·API/모바일 typecheck·모바일 lint·API build PASS. 전체 PostgreSQL 593건 중 590 PASS·0 FAIL·기존 hosted 3 SKIP, 별도 hosted 3/3 PASS다. CI 연결·운영 문서·gate·diff PASS. 명령·환경·단언 추가와 첫 실행 실패 수정은 TEST_STATUS T9 후속 절에 있다.
- 초기 T9 사이트 측정은 645건 중 644 PASS·Chrome 1 환경 BLOCKED이며 접근성/지갑 검사도 당시 PASS다. 사이트·브라우저·실기는 이번 후속 작업에서 재측정하지 않았다.
- `bash tests/release/verify_showcase_apk_test.sh`·`bash tests/ops/uptime_probe_test.sh` PASS. 릴리스 준비 검사에는 30개 정확 ID·중복·은퇴/운영 점포 혼입 거절 회귀를 더했다. APK를 빌드하지 않았다.
- 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN`. T9 자동 시험의 PASS를 기존 실기/출시 관문으로 옮기지 않았다.
- site Chrome 테마 시험은 DevTools 이전 SIGABRT이며 환경 원인으로 따로 기록한다. 시험은 삭제/skip하지 않는다. LSP/AST 도구가 없어 독립 소스 검토·타입·실행 시험으로 확인했다.

- 앞선 PR #429와 main `a1a3eef3` 병합 당시 지정 검사: 모바일 typecheck·lint·동일 glob Node loader 단위 시험 2148/2148·운영 제출 준비·모바일 접근성·CI 연결 103개 파일 `PASS`, `npm test`는 tsx IPC `EPERM`으로 `BLOCKED`다([TEST_STATUS](TEST_STATUS.md) 최신 항목). 아래 2132/2132·26/26 등의 수치는 앞선 별도 통합 브랜치 결과이며 이번 병합의 전체 통과 수치가 아니다.

- 앞선 별도 통합 브랜치의 main `a8ed0dd1` 병합 충돌 파일 검증: API typecheck `PASS`; 모바일 typecheck·lint와 대체 단위 2132/2132 `PASS`. `npm test`는 tsx IPC `listen EPERM`으로 `BLOCKED`다. 공공자료 고지·고정 뒷면 대상 26/26, CI 연결 101개 파일, 운영 제출 준비(migration 72건), 모바일 접근성은 `PASS`. 소켓 없는 API 직접 확인에서 점주 혜택 상태·AI art 권한과 점주 연장 POST 35회의 제한기 이전 404가 `PASS`다. 지정 사이트 선택 350건 중 344 PASS / 6 소켓 환경 BLOCKED(18건 묶음 12/18, 나머지 332/332 PASS)이고 혜택 웹 6/6, 제작기·현황·문구 67/67은 별도 PASS다. 추적 파일 충돌 표시 검사·점주 JavaScript 문법·`git diff --check` PASS. README·PROJECT_STATE의 당시 전체 API·모바일 합계는 그 병합의 전체 통과 수치가 없어 `__API__`·`__MOB__`로 두었다. 자세한 명령은 [TEST_STATUS](TEST_STATUS.md)의 해당 이력에 있다. API 전체 단위·build, PostgreSQL 통합·실기·배포는 그 검증에서 `NOT_RUN`이었다.

- 앞선 T3·T4·T8 통합(`HEAD 8c0bad5e`) 검증 이력: API typecheck `PASS`; `npm test`는 tsx IPC `EPERM`으로 `BLOCKED`, 대체 전체 단위 실행은 662건 중 488 `PASS` / 174 `FAIL`(모두 socket `listen EPERM`)이다. 모바일 typecheck·lint와 대체 단위 시험 2115/2115 `PASS`. 관리자 웹 혜택·목적·코스 격리 시험 22/22와 CI 연결 95개 파일 `PASS`; `verify_production_web_test.mjs`는 서버 listen 훅에서 멈춰 5초 제한 재실행이 시간 초과돼 환경 `BLOCKED`다. 운영 제출 준비 검사 `PASS`(실제 43 + 29 = 72건), 0072 감사 action 23개 합집합·`NOT VALID` 정적 확인 `PASS`. 이 수치는 PR #418 포함 main 병합 뒤의 전체 결과가 아니다.

- T4 A 리뷰 수정 실행(2026-10-09): API 634/634, PG 553건 중 550 PASS/0 FAIL/3 SKIP, 모바일 2094/2094, 요청된 사이트 139/139; typecheck·모바일 lint·CI 연결·접근성·문서·gate PASS. PG SKIP은 별도 disposable hosted-showcase 55435 컨테이너가 필요한 기존 3건이다. 검토 시작 HEAD `29644366`(기준 위 4개 커밋); 후속 커밋은 오케스트레이터가 담당한다. 이번 세션은 Git 쓰기를 실행하지 않는다. [검증과 전달](evidence/t4-courses-2026-10-08.md)을 따른다. 전체 사이트·실제 브라우저/기기·설치·배포는 이번 실행에서 NOT_RUN이다.
- T8 검증: API 615/615·typecheck·build, PostgreSQL 549건 중 546 PASS / 0 FAIL / 3 SKIP, 모바일 2094/2094·typecheck·lint, 선택기 2/2, 전용 hosted seed 3/3, CI wiring 94개 시험 연결, 모바일 접근성·`/play/` web export·운영 문서 검사·`LC_ALL=C bash tools/gate.sh` PASS. 세 PostgreSQL hosted-only skip은 별도 fresh Docker runner에서 각각 통과했다([TEST_STATUS](TEST_STATUS.md)). 웹 export에는 test-only OAuth client fixture를 썼으며 브라우저·로그인 수용은 `NOT_RUN`이다. 공개 서버·APK·웹 배포도 `NOT_RUN`이다.

- Issue #412 T3 PR 1 브랜치 `feat/purpose-campaigns`(main `8841efea` 병합 후): API 단위 615/615(main 597에서 18건 증가)·typecheck, PostgreSQL 전체 543건 중 540 pass / 0 fail / 3 skip(이 작업 전 527건 중 524 pass, 3건은 전용 hosted seed 컨테이너 조건), 모바일 `npm test` 2093/2093(main 2077에서 16건 증가)·typecheck·lint, 사이트·운영 웹 578/578, CI 연결·모바일 접근성 의미·지갑 표면·`bash tools/gate.sh` PASS, 변이 점검 8건 모두 시험 실패. 바뀐 기존 단언과 결과는 [TEST_STATUS](TEST_STATUS.md)에 있다.

- Issue #412 T3 PR 1의 main `8841efea`(PR #420·#423) 병합 후 브랜치 `feat/purpose-campaigns`: API 단위 615/615 · 모바일 2093/2093, PostgreSQL 통합 543건 중 540 pass / 0 fail / 3 skip. main 대비 API 18건·모바일 16건 증가이며 아래 T1·T2c 수치는 병합 전 이력이다([TEST_STATUS](TEST_STATUS.md)).

- 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN` ([시험 원장](TEST_STATUS.md), [제출 증거](SUBMISSION_EVIDENCE.json)).
- Issue #401 구현 브랜치 `fix/submission-readiness`의 당시 검사: API 단위 567/567·PostgreSQL 524 PASS/3 SKIP(전용 55435 hosted seed 컨테이너 조건), API typecheck·build, 모바일 1,872/1,872·typecheck·lint·운영/시연 Android export·variant 자산·접근성 의미 PASS. `9f5ebfa6` 수정은 독립 Codex 리뷰 APPROVE, 모바일 1,876/1,876·typecheck·lint·접근성·gate PASS다.
- 해당 브랜치의 사이트·운영 시험(로컬 restore drill 실DB 포함)·`bash tools/gate.sh` PASS. 이번 운영 서버 실데이터 복원·migration 리허설은 별도 [P03 증거](evidence/production-restore-rehearsal-2026-10-08.json)로 기록한다.
- Issue #407의 코드 `5ca98955`: 모바일 1,883/1,883, typecheck·lint·접근성·운영/시연 Android export·variant 자산·gate PASS, 독립 리뷰(Claude sonnet) APPROVE(🔴/🟠 없음). 이 문서 갱신의 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 기록한다.
- Issue #409·#410 브랜치(전달받은 기록이며 이번 문서 작업에서 다시 실행하지 않음): 모바일 `npm test` 1901/1901, typecheck·lint PASS, 접근성 의미 검사·지갑 표면 검사 PASS, 시연 웹 export PASS(번들에 새 코드 포함), gate PASS. API 시험은 567/567 그대로이고 API 코드는 바뀌지 않았다. 코드·CI 교차 리뷰(Claude Sonnet·Claude Opus) 반드시 고칠 것 0건, 후속 반영. 문서 리뷰(Claude Sonnet) 지적 반영. 자세한 기록은 PR 본문에 둔다. 리뷰 후속으로 꾸미기 칩 묶음(코인·테마·배치·강조색)에 `aria-pressed`를 붙였고, `spaceToggles`가 수정자 키와 자식에서 올라온 키 이벤트를 무시하게 했으며, 꾸미기 저장 중복 방지 가드를 누르기와 Space가 함께 쓰게 했다(시험 2건 추가). 이 문서 갱신의 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 기록한다.
- Issue #412 놀이 변경(PR #414): 모바일 `npm test` 1919/1919, typecheck·lint·접근성 의미 검사·지갑 표면 검사·CI 연결 검사·gate PASS. 독립 리뷰(Claude Sonnet 5.5) 승인 후 후속 6건 반영. 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 기록한다.
- PR #402는 모바일 1,878/1,878·gate 통과, 독립 리뷰 승인 뒤 병합했다. 앞 문장의 Issue #401 결과와 PR #404 문서 worktree 검사는 당시 기록이며, 현재 문서 브랜치의 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 별도로 기록한다.
- Issue #412 T1(PR #422로 병합, 브랜치 `refactor/api-deps-routes`): API 단위 597/597(이 작업 전 591, 새 시험 6건)·typecheck·build, PostgreSQL 전체 524 pass / 0 fail / 3 skip(3건은 전용 55435 hosted seed 컨테이너 조건), 변이 점검 6건 모두 시험 실패, `dist/server.js` 부팅 뒤 `/health` 200, 사이트 시험·개인정보 검사·gate PASS. 교차 리뷰(Claude Sonnet·Claude Opus) 승인, 🔴 0·🟠 0. 자세한 결과는 [TEST_STATUS](TEST_STATUS.md)에 있다.
- Caddy `/api/web/v1/*` 수정(`fix/caddy-web-v1-routes`, PR #413): `verify_web_session_proxy_test.mjs` 2/2(옛 Caddyfile은 2건 FAIL), `verify_lightsail_deployment_test.sh`·`run_aws_web_smoke.sh`·`deploy_lightsail_web_test.sh`·`ci_wiring_test.sh`·gate PASS, 관련 `node --test` 31/31. 라이브 재측정은 NOT_RUN이다. 자세한 결과는 [TEST_STATUS](TEST_STATUS.md)에 둔다.
- Issue #412 첫 사용 경험(PR #415, 브랜치 `feat/first-use-v2`): 모바일 `npm test` 1992/1992(PR #414 위로 리베이스한 뒤의 합계, 리베이스 전 이 브랜치 단독 1974), typecheck·lint PASS, 접근성 의미 검사·지갑 표면 검사·CI 연결 PASS, 시연 웹 export PASS(번들에 지갑 SDK 문자열 0건, `class="boot"` 대기 안내 포함). 사이트 시험 `verify_production_web_test.mjs`·`legal-pages.test.mjs` 147/147. API 시험은 567/567 그대로이고 API 코드는 바뀌지 않았다. 코드 교차 리뷰(Claude Sonnet·Claude Opus) 두 차례 뒤 지적 반영. 명령별 결과는 [TEST_STATUS](TEST_STATUS.md)에 있다.
- Issue #412 T2c 브랜치 `feat/first-use-v2c`: 모바일 `npm test` 2077/2077, typecheck·lint PASS, 접근성 의미 검사·지갑 표면 검사·CI 연결 검사·운영 문서 검사·증거 정합 검사·gate PASS. API 시험은 main의 597/597(PR #422)이고 T2c는 API 코드를 바꾸지 않았다. 코드 교차 리뷰(Claude Sonnet·Claude Opus)의 🟠 둘과 🟡들을 반영했고, Opus 재리뷰가 더 찾은 🟠 하나(점주 쪽 보관 기록 때문에 넘겨받기가 버려짐)와 🟡 넷도 반영했다(그 반영분을 본 Claude Opus 재리뷰는 승인(APPROVE)했다: 🔴·🟠 없음, 🟡 반영). 명령별 결과는 [TEST_STATUS](TEST_STATUS.md)에 있다.
- 기본 재현: `bash tools/gate.sh`, `bash tests/bootstrap/verify_operations_docs_test.sh`, `bash tests/site/verify_evidence_consistency_test.sh`, `bash tests/ops/showcase_host_readiness_test.sh`.
- Issue #412 T5(PR #421로 병합, 병합 전 브랜치에서 직접 실행, main `e06c97cd` 위로 리베이스한 뒤 사이트·운영·CI 연결·큰 파일 시험과 `bash tools/gate.sh`를 다시 실행해 통과, API 커버리지와 실제 컨테이너 행은 리베이스 전 측정): 가동 점검·매일 백업·정리 작업·복원 드릴(가짜 도구와 일회용 로컬 Postgres 16.10)·큰 파일 가드 시험, `current_release_test.mjs` 포함 사이트 시험 26/26, `render-current-release.mjs --check`, `ci_wiring_test.sh`(시험 파일 90개 모두 연결), API 단위 567/567(커버리지 포함), `bash tools/gate.sh` PASS. 독립 리뷰 2건의 변경 요청(🔴 없음)은 후속 커밋에서 반영했고 반영분의 재검토와 GitHub Actions 전체 CI는 `NOT_RUN`이다. 결과표는 [TEST_STATUS](TEST_STATUS.md) 맨 위 절.

## 10. 수동 수용과 미실행 항목

- 운영/시연 배포, 라이브 기존 DB 재시드, 새 APK·서명·설치·두 variant 실기, 실제 Google 직원/승인자 재부여, D-091 실제 기기 넘김, TalkBack, 현장 도보·영업 확인, Play 제출은 NOT_RUN이다.
- 실제 AI 과금·새 그림 생성·온체인 발행은 하지 않았다. 테스트 fixture와 public-data seed를 실제 점주 참여로 해석하지 않는다.

## 11. 남은 이슈와 PR 확인

- 현재 Git diff만 있으며 staging/commit/PR은 오케스트레이터가 맡는다. 신규 PR은 만들지 않았다. D-103 BGM과 기존 Issue #412/T3/T4/T8/T9, PR #418·#429·#433 변경은 보존했다.
- 최종 검토는 `git diff --check`, `git diff --stat`, `git diff`, `gh pr list --state all`로 실제 상태를 확인한다. 전용 namespace 이외 운영 권한/가게가 변하지 않았는지 확인한다.
- 모든 기존 단언 변경의 이유·새 대상은 TEST_STATUS T9 표에 기록한다. 기존 staff 전환의 공식 재부여와 시연 캠페인 공개/가게 비공개 구분은 인수인계의 운영 주의점이다.

## 12. 다음 실행 명령


1. `git status -sb`와 `git log -1 --oneline`으로 BGM `fix/bgm-start` 브랜치·HEAD `6af6ab47`·병합 대상 main `c7632b35`·미병합 index를 확인한다. add·commit·stash·rebase·push·merge는 이번 작업에서 금지된다.
2. `cd apps/api && npm run typecheck && npm test`; `cd apps/mobile && npm run typecheck && npm run lint` 뒤 모바일 단위 시험을 실행한다. `npm test`가 막히면 `node --import tsx --test 'src/**/*.test.ts'`를 쓴다.
3. 저장소 루트에서 `bash tests/bootstrap/operations_submission_readiness_test.sh`, `bash tests/ci/ci_wiring_test.sh`, `bash tests/mobile/check_accessibility_semantics_test.sh`를 실행한다. README·PROJECT_STATE의 합계 자리표시자는 이번 작업에서 유지한다. 숫자만 바꾸는 운영 문서 변이 검사는 이 상태에서 실패할 수 있음을 별도로 기록한다.
4. migration 파일 순서와 0072 감사 CHECK의 전체 action을 확인하고 `git diff --check` 및 텍스트 충돌 표시 검사를 한다. PostgreSQL 통합과 실제 기기·브라우저·배포의 실행 여부는 [TEST_STATUS](TEST_STATUS.md)에 구분해서 기록한다.

PR 제목·본문 검사:

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

`bash tests/bootstrap/check_pr_korean_test.sh`는 checker 자체 회귀 시험이며 실제 제목·본문 검사를 대신하지 않는다. 이번 세션에서는 Git write 명령을 실행하지 않는다. 재검증 명령·환경·제한은 TEST_STATUS 최상단의 현재 병합 항목과 아래 BGM·T9 이력에 있다.

## 13. 승인·보안 경계

- 이번 사용자 직접 요청 범위의 파일 수정·검증만 실행했다. Git add·commit·stash·merge·rebase·push 금지는 유지했다.
- 키·권한·과금·운영 데이터·메인넷·Play·최종 제출의 기존 경계를 유지한다. 개인키·복구 문구·서명 키를 생성/조회하지 않았다.
- 직원 부여는 세션·Google subject와 정확한 연습 가게·시연 DB 검사에 따른다. UI 역할 선택이나 `demo:true`만으로 권한을 만들지 않는다.

## 14. 이력과 변경 규칙

- 이전 날짜별 인수인계는 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존한다. 오래된 33곳·A/B/C·설치본 증거는 당시 상태이며 새 배포 증거가 아니다.
- 다음 중단 전 14절의 SHA·브랜치·PR·공개 버전·검증 결과·다음 명령을 실제 근거에 맞춰 갱신한다. TEST_STATUS 현재 측정 합계와 README·PROJECT_STATE 동일 합계 줄을 함께 고친다.
