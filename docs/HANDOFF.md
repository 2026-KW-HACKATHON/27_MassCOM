# HANDOFF

## 2026-10-09 사용자 제공 제품 분석서 문서 추가

- 작업 브랜치: `docs/product-experience-analysis-2026-10-09`. 시작 main: `a8ed0dd1399e96ae599317a6c04f88f8d9df1e8e`.
- 사용자 제공 [제품 경험·지역 가치·사업화 분석서](PRODUCT_EXPERIENCE_ANALYSIS_2026-10-09.md)와 [Word 원본](source/PRODUCT_EXPERIENCE_ANALYSIS_2026-10-09.docx)을 추가한다. 본문은 작성 시점의 소스·PR 상태를 보존한 자료이며 현재 구현 상태의 단일 원본이나 보상 정책 승인 기록으로 사용하지 않는다.
- README·AI_USAGE의 문서 참조를 추가했다. API·앱·DB·배포·기존 시험 합계는 바뀌지 않으므로 PROJECT_STATE·TEST_STATUS의 구현/시험 상태는 수정하지 않는다.
- 문서 변환·원본 무결성·링크·크기·비밀값·한국어 PR 검증은 로컬에서 확인하고, 전체 저장소 CI와 main 병합 상태는 해당 PR에서 확인한다.


기준 시각: 2026-10-09 KST. 이 문서는 다음 작업의 현재 상태만 기록한다. 날짜별 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.
**PR #418 리뷰 수정 전달 (2026-10-09, 커밋 `07efaccf`, 오케스트레이터 커밋)**

- 위치: `.worktrees/pr418`, 브랜치 `feat/merchant-dual-studio`, 시작 HEAD `e119f55e`. main `055d0523` 병합을 확인했다. 결정 D-096·D-097과 고정 방문 보상 1→브론즈·3→실버·5→골드, 프리즘 포함 네 기본 등급, v2 뒷면, 점주 연장 제거·관리자 연장 유지는 그대로다. staging·commit·stash·rebase·push는 오케스트레이터가 맡는다.
- **배포 필수 조건(D-096): API와 웹 편집기 자산을 같은 배포 창에 함께 전환하고 롤백도 함께 한다.** 새 API+구 편집기는 프리즘 누락을 거절하고 구 API+새 편집기는 방문 보상 연결 등급만 저장한다. 혼합 버전 게시를 허용하는 호환 코드로 우회하지 않는다. 기본 등급 누락의 `COLLECTIBLE_DEFAULT_GRADE_MISSING`은 "편집기를 새로고침한 뒤 다시 게시해 주세요"로 안내한다. 배포 전 구 편집기 탭 새로고침과 네 등급 게시본을 확인한다. 서버 배포·운영 DB·설치본 갱신은 이번 수정 범위 밖이다.
- 검증: API 단위 623/623·typecheck·build, 모바일 2097/2097·typecheck·lint, 사이트 636건 중 635 PASS·Chrome 기동 1 BLOCKED(원래 assertion 유지), CI 연결·운영 문서·접근성·bootstrap·큰 파일 가드 회귀·증거 일관성 PASS. PostgreSQL 전체는 544건 중 541 PASS / 0 FAIL / 기존 3 SKIP (`npm run test:postgres`, 전용 hosted seed 컨테이너 127.0.0.1:55435가 필요한 세 시험). assertion 변경 이유와 명령별 로그는 `docs/TEST_STATUS.md`에 기록했다.
- 확인: 커밋 뒤 `bash scripts/check-large-files.sh origin/main`(추가·수정 187개 통과)과 `bash tools/gate.sh` PASS. PostgreSQL 541 pass / 3 skip. Chrome 기동 시험 1건은 이 PC에서 BLOCKED(원래 assertion 유지).

## 1. 기준 커밋과 작업 위치

- 현재 작업: `.worktrees/pr418`, 브랜치 `feat/merchant-dual-studio`, HEAD `b953ed03`에서 PR #424·#426 반영 main `0801c1ce`를 병합 중이다. D-095와 migration `0075_nft_series_uncapped.sql`, `/play/` 리다이렉트와 D-096~D-099를 함께 보존했다. 아래 `055d0523`와 PR #424 브랜치 설명은 병합 전 인수인계 기록이다. 충돌 문서만 편집하며 staging·commit·stash·rebase·push와 API·모바일 합계 재측정은 오케스트레이터가 맡는다.
- 기준 main 커밋 SHA: `055d0523`(PR #425 병합, 2026-10-09 KST). PR #424 작업 브랜치 `feat/remove-nft-series-cap`에는 이 main이 병합돼 있다. 작업 위치는 `git worktree list`와 `git status -sb`로 확인한다. 제출 기준선은 마감 시점의 최신 `main`이며, 확정 SHA는 [SUBMISSION_CHECKLIST](SUBMISSION_CHECKLIST.md)와 `SUBMISSION_EVIDENCE.json`의 `baselineCommit`에 기록한다.
- PR #413(운영 웹 Caddy `/api/web/v1/*` 라우트 수정, `ff5b5b6a`)과 PR #414([Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 놀이 변경, 결정 D-082, `108f6b38`), PR #415(같은 이슈의 첫 사용 경험, 결정 D-083~D-087, `e06c97cd`), PR #421(같은 이슈의 T5 운영 품질, `b707ed09`), PR #422(같은 이슈의 T1 API 서버 구조 정리, 결정 D-088, `cd01c0d6`), PR #420(NFT 발행 Worker 상시 실행, 결정 D-089, `48a14811`)는 병합됐다. 최신 main 확인은 위와 같이 `git log -1 origin/main`으로 한다.
- 병합 순서: PR #403(점검 결함 수정, `2d483ed8`) → #404(시연 배포·Preview 20·test.11 기록, `09dfceb0`) → #405(공개 체험 결함 4건 수정·운영 배포 기록·test.12/Preview 21, `08f125b4`) → #402(뽑기 `CONSENT_REQUIRED`의 "동의 확인하기" 연결, `a742e32d`) → #406(재측정·대체 시연 영상·제출 후보 기록, `6ce8ad03`) → #408(Issue #407의 낮은 화면 결함 4건 수정과 #402를 다음 설치본·웹 체험에 반영, `687427c2`). Issue #401은 #403 병합으로 닫혔다.
- 운영·시연 서버 배포와 수정본 `/play/` 재측정은 끝났다. Issue #407의 코드(`5ca98955`)로 운영 test.13·시연 Preview 22를 게시했고 시연 `/play/`를 같은 소스로 전환했다. #402의 변경도 이 설치본과 `/play/`에 들어 있다. 라이브 `/open`은 test.13·Preview 22를 가리킨다(2026-10-08 확인).
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T3 PR 1(점주 목적형 캠페인·혜택 시간대·"첫 방문" 표기 정정)은 브랜치 `feat/purpose-campaigns`를 main `cd01c0d6` 위에서 시작해 main `8841efea`(PR #420·#423)를 병합한 작업이다. migration `0068_campaign_purposes.sql`, `apps/api`·`apps/mobile`·`apps/production-web` 코드와 시험, 문서를 바꿨고 결정은 [D-092](DECISIONS.md)다. 배포하지 않았다(소유자 결정 A).
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T1(API 서버 구조 정리)은 PR #422로 병합돼 main `cd01c0d6`에 있고 배포하지 않았다. `apps/api`만 바꾼 작업이며 요청·응답 동작은 바꾸지 않았다. 구조 규칙은 [D-088](DECISIONS.md)이다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T1(API 서버 구조 정리)의 병합 전 이력은 `apps/api`만 바꾼 작업이다. 브랜치 `refactor/api-deps-routes`를 main `b707ed09`(PR #413·#414·#415·#421 병합) 위로 옮겼고 요청·응답 동작은 바꾸지 않았다. 구조 규칙은 [D-088](DECISIONS.md)이다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)(첫 사용 경험)의 T2 작업(브랜치 `feat/first-use-v2`)은 PR #415로 병합돼 main `e06c97cd`에 있고 배포하지 않았다. 결정은 [D-083~D-087](DECISIONS.md)이다. 같은 이슈의 T5(운영 품질) 작업(브랜치 `chore/ops-quality-t5`)은 PR #421로 병합돼 main `b707ed09`에 있고 배포하지 않았다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T2c(점진적 공개·점주 1인 2역·최소 크기)는 브랜치 `feat/first-use-v2c`에서 PR #423으로 main `8841efea`에 병합됐다. 병합 전에는 PR #420이 병합된 main `48a14811` 위로 리베이스했다. 결정은 [D-090~D-091](DECISIONS.md)이다(D-089는 main의 PR #420 몫이다).

## 2. 현재 통합 상태

- PR #398·#400·#402·#403·#404·#405·#406·#408·#413·#414·#415·#420·#421·#422·#423은 병합됐다. #398을 열린 PR로 적은 과거 전달은 [당시 기록](HANDOFF_HISTORY.md#2026-10-07-pr이슈-점검-전달-결과)이다.
- NFT 발행 Worker 상시 실행([D-089](DECISIONS.md))의 [PR #420](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/420)은 병합돼 main `48a14811`에 있고 서버 배포·운영 활성화는 하지 않았다.
- NFT 시리즈 발행 수량 상한 해제([D-095](DECISIONS.md)): [PR #424](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/424)의 브랜치 `feat/remove-nft-series-cap`에 main `055d0523`(PR #425)이 병합됐다(현재 HEAD `a2ce4ae5`). 컨트랙트 `createSeries`가 2인자로 바뀌고(`series()` getter는 `(string,uint64,bool)`) API 수량 검사·`CAPACITY_UNAVAILABLE`을 없앴으며 migration 0075이 `nft_series.max_ever_minted`의 NOT NULL만 푼다. 배포하지 않았다. Base Sepolia의 기존 상한 1 실증 시리즈에는 운영 발행을 보내지 않는다. 기존 계약에 새 시리즈를 만들 때는 `createSeries(bytes32,string,uint64)`의 세 번째 인자에 `18446744073709551615`를 넣고, 새 계약에서는 2인자 `createSeries(bytes32,string)`을 쓴다. NULL 상한 행은 새 API가 모든 인스턴스에 배포된 뒤에만 넣는다. 다음 명령: `git status -sb`, `git log -1 --oneline`, PR #424 검사 상태를 확인한다.
- PR #396은 닫혔으나 main에 병합되지 않았다. 미병합 초안을 공개본 기능으로 계산하지 않는다.
- 재개 시 `git status -sb`, `git log -1 --oneline`, `gh pr list --state all`로 다시 대조한다.

검토 지적 8개 수정은 이 worktree의 미커밋 변경이며 staging·commit·stash·rebase·push를 실행하지 않았다(오케스트레이터가 커밋). API 615/615·Worker 85/85·Foundry 10/10(fuzz 128회), API·Worker·모바일 typecheck, 운영 제출 준비·운영 문서·bootstrap·CI 연결 PASS. 기본 locale의 gate는 기존 Bash 변수 파싱 오류이고 `LC_ALL=C bash tools/gate.sh` PASS. PostgreSQL·Anvil은 오케스트레이터 실행 범위다. 재개 명령: `git diff --check`, `git diff`, PR #424와 [TEST_STATUS](TEST_STATUS.md)의 이번 검증 기록 확인.

## 3. 공개 서버와 설치본

- 운영 API·웹은 main `687427c2`(PR #408 병합 커밋)로 배포돼 있고 migration은 68건이다. 직전 `08f125b4` 재배포는 `scripts/deploy-lightsail.sh`로 했고 `backward_compatible=yes`, API 코드 변경 없음이었다. 그 앞의 `09dfceb0` 배포에서 원장이 43→68건(마지막 `0067_room_guestbook.sql`)이 됐고 API·웹 이미지 healthy, Caddy 재생성, retention 첫 실행 success였다([`09dfceb0` 배포 증거](evidence/production-deployment-09dfceb-2026-10-08.json)). `08f125b4`와 `687427c2` 재배포는 제공된 실행 기록이며 별도 증거 JSON은 아직 없다.
- 시연 API는 `2d483ed`(migration 68건, 마지막 `0067_room_guestbook.sql`)다([시연 배포 증거](evidence/showcase-deployment-2d483ed-2026-10-08.json)). 시연 웹 `/play/`는 소스 `5ca98955`, entry `entry-858be2c61591f08ea88654ceed5f67ec.js`(`lang="ko"`)다. 이전 번들(`9f5ebfa6`, entry `entry-bf096d15e2c9fd7c9a6b8bc41de15c48.js`)에서 `/opt/masscom-showcase/web/releases/5ca98955…`로 `current`를 전환하고 edge Caddy를 재시작했으며 공개 서빙을 확인했다(제공 기록). 운영 api·www·시연 health 200을 유지했고 서버 API·DB 변경은 없다.
- 설치본: 운영 `android-v0.1.0-test.13`(`MassCOM-operating-android-5ca9895.apk`, SHA-256 `45dc8a37d56b545bf4ef2da133bde48795dfadb2d965d122151d4310aeb5c53b`, 약 324MB, package `kr.masscom.wolgye`, [증거](evidence/operating-android-test13-2026-10-08.json))와 시연 `showcase-android-v0.1.0-preview.22`(`MassCOM-showcase-android-5ca9895.apk`, SHA-256 `a384cfee5b1fdacd0c7128d2232c2673f6bb422a1047e223acc1397cceff932f`, 약 330MB, package `kr.masscom.wolgye.demo`, [증거](evidence/showcase-preview22-release-2026-10-08.json))가 게시됐다. 두 APK 모두 `RECORD_AUDIO`가 없고 내부 versionName/Code는 `0.1.0-test.2`/`2`, target 커밋은 `5ca98955`다. **두 APK의 익명 다운로드 해시는 일치(PASS, 2026-10-08 공개 Release에서 로그인 없이 다시 내려받아 SHA-256 재계산)다.** 확인 전에는 "일치"로 적지 않는다. 이전 설치본 test.12·Preview 21(소스 `9f5ebfa6`)의 증거는 [test.12](evidence/operating-android-test12-2026-10-08.json)·[Preview 21](evidence/showcase-preview21-release-2026-10-08.json)에 남아 있다. 실제 설치·실기 수용은 별도다.
- 라이브 `/open`은 test.13·Preview 22를 가리킨다(2026-10-08 확인). 그 전에는 test.12·Preview 21이었다.
- #402의 상점 동의 오류 단추·문구는 test.13·Preview 22와 `/play/`(`5ca98955`)에 들어 있다. 시연·설치본에는 지도 키가 없어 목록 기반 탐색으로 동작한다.
- 시연·운영 서버 안 실제 DB 복원 리허설이 각각 PASS다. 운영은 첫 실제 복원 증거(P03)이며 복제본 migration 43→68건·`account_consents` 5=5 보존 후 복제본·임시 dump를 삭제했다([운영 리허설](evidence/production-restore-rehearsal-2026-10-08.json)).
- 알려진 라이브 결함(배포 동결로 미수정): `www.masscom.kr/api/web/v1/*`가 404다. `infra/lightsail/Caddyfile`의 `@webSession`에 이 경로가 없어 API로 가지 않았다(가게 실세계 프로필 편집기의 영업시간·사진·위치 저장이 막힘). 설정·시험은 `fix/caddy-web-v1-routes`에서 고쳐 PR #413으로 main에 병합했고 웹/Caddy 배포 전까지 라이브는 그대로 404다.
- 배포 동결(소유자 결정 A): Issue #409·#410의 코드는 게시·배포하지 않았다. 위 공개 상태(운영 `687427c2`, test.13, Preview 22, `/play/` `5ca98955`)가 그대로다. 이 코드는 다음 빌드부터 사용자에게 닿는다.
- Issue #412 T1의 API 코드도 배포하지 않았다(소유자 결정 A). 서버에 올라간 API는 위 운영 `687427c2`·시연 `2d483ed` 그대로다.

## 4. 이번 작업의 범위

**점주 웹 두 경로 전달 — PR #418 (2026-10-08)**

최신 후속: 재생은 등급 동작 없이도 회전하고0.25~3배 속도를 초안·게시·획득 상세에 보존한다. 코인 이름·시즌은1단계, 애니메이션과 효과는3단계 맨 위에서 움직임 탭을 기본으로 펼친다.4단계는 결과·고정 방문 보상·게시만 남긴다. 두께24→48 및32 프리셋, API·앱 파서도48을 지원한다. 두께25~48 게시본은 업데이트한 고객 앱과 함께 배포해야 한다. 브라우저 실제2배 회전·게시·획득 상세의48 두께와 속도2를 합성 fixture에서 확인했다. [최신 화면·시험·호환 경계](evidence/rotation-playback-2026-10-08/README.md). 운영 배포·Android 실기는 별도다.

최신 main `8841efea`(PR #420·#423) 통합 후 API601/601·웹609/609·모바일2077/2077·타입·lint·Android export를 재검증했다. 12종v2 SHA 일치·v1 번들0건, 네 등급 저장본2.45MiB·전체8MiB 제한을 확인했다. 실제 PostgreSQL29/29와 추가 ID 보존은 위 API 변경 후 검증했다. Windows 권한/심볼릭 링크 Worker5건·Docker8건·macOS Chrome 테마 한 파일과 운영/Android 실기는 별도 검증이다.

첫 CI에서 R-333 재시드·실제 점주 게시 경합 시험의 과거 단일등급 입력이 새 네 등급 계약에 거절됐다. 서버 검증과 과거 시드 helper는 유지하고 해당 게시 fixture만 네 등급으로 바꿨다. 실제 발행행4개 assertion 추가 후 관련 PostgreSQL25/25·규칙/시드30/30·API typecheck 통과. CI 재실행은 별도로 확인한다.

최신 후속: 기본 제작·발행 등급은 브론즈·실버·골드·프리즘 네 개다. 방문 지급은 1회 브론즈·3회 실버·5회 골드로 유지하며 프리즘 지급 조건을 임의로 추가하지 않는다. 게시할 때 네 기본 등급과 모든 활성 특수등급의 정면·뒷면·프레임을 저장한다. 추가 등급은 고유 ID와 이름을 보존하며 총16개(기본4+특수12) 상한을 유지한다. 프리즘은 기본 음각·양각에도 청록·분홍·보라의 각도별 색 이동과 같은 계열 테두리를 사용한다. 프리즘 후면3종은 음각 문양을 유지해 built-in 이미지 생성으로 색을 개선했다. 현재 웹·앱 뒷면12종은 동일한512px WebP767,082바이트(749.1KiB)로 원본41,909,062바이트보다98.17% 작다. v1PNG와 기존 게시본은 보존하고 모바일 번들은 v2만 사용한다. [최신 색감·용량·확장·검증](evidence/prism-collectibles-2026-10-08/README.md).

추가 후속: 점주 캠페인 선택·보상 등급·기간 연장을 제거하고 1회 브론즈·3회 실버·5회 골드를 서버에서도 고정했다. 미준비 캠페인은 초안만 저장한다. 회전 깊이는 2.5D 조명·윤곽 변위로 보강하고 게시본에 기존 12/4/15 각도 스프라이트를 저장한다. 최신 main cd01c0d6 통합 후 API 601/601·사이트 416/416·현재 배포 시험 12/12·전용 PostgreSQL 통합 29/29, 합성 양각·음각의 새 게시본 저장/재읽기와 실제 자동 회전을 확인했다. [최신 캡처·회전 비교·저장 형식](evidence/fixed-visit-relief-2026-10-08/README.md). 운영 배포·Android 실기 재생은 아직 별도다.

최신 후속: 방문 보상 제작·방문 확인·운영 결과를 별도 화면으로 정리하고 메뉴 등록을 제작 경로에서 제외했다. 1 사진 배치 → 2 사진 편집 → 3 코인 만들기 → 4 결과·방문 보상이며, 아이콘 도구·화살표 실행 취소/재실행·RGB/HEX·선택 등급의 음각/양각을 지원한다. 사용자 그림을 실제 마우스로 편집해 네 등급 PNG를 저장하고 합성 점주 fixture 캠페인에 1/3/5 목표로 게시 v6을 확인했다. 사이트 401/401·웹 모듈 문법 검사·독립 리뷰 PASS. [화면·PNG·재현](evidence/merchant-photo-editor-2026-10-08/README.md). 운영 배포·실계정 보상 지급은 검증하지 않았다.

추가 범위: 모양(원형·우표형·톱니형) × 등급(브론즈·실버·골드·프리즘)의 고정 음각 뒷면 12종을 웹·앱에 연결했다. 새 게시본은 고정 이미지를 굽고 기존 발행본의 뒷면은 보존한다. 별도 뒷면 편집 UI를 제거했다. 사이트 390/390·모바일 LF 체크아웃 1992/1992·타입·lint, 브라우저 12종 512px WebP 제한 검수 PASS. [이미지·프롬프트·검수](evidence/fixed-collectible-backs-2026-10-08/README.md)를 읽는다. 이전 v1PNG 원본 한 벌 약40MiB는 현재 모바일 require에서 제외했고, 현재 v2WebP749.1KiB만 사용한다. 실제 APK설치·실기는 별도 검증이다. 신규 API·DB migration은 없다.

[PR #418](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/418)은 main `e06c97cd`에서 분기한 AI 초안·준비 이미지 스튜디오 진입, 웹 업로드 정규화, 최신 사진 정렬과 세션 AI API 변경이다. API 569/569·typecheck·build, 사이트 384/384, PostgreSQL 최신 사진 통합 1/1이 통과했다. Docker 없는 Windows의 Caddy 컨테이너 두 시험은 실행하지 못했다. [화면 증거·재현·배포 조건](evidence/merchant-dual-studio-2026-10-08/WEB_QA.md)을 먼저 읽는다.

고객 앱 개발 웹에서 로컬 DB의 `QA 가상 월계 달빛빵집` 이름·주소·최신 이미지·1/3/5 코인 캠페인 노출을 확인했다. 운영 계정은 점포 승인 부재로 저장·게시 종단 QA가 막혔다. 공개 서비스 배포, 실제 AI 생성, 계정 권한 부여는 하지 않았다. 배포 담당자는 PR #413의 `/api/web/v1/*` Caddy 수정과 이 PR의 API·웹을 함께 반영하고 승인된 점포 및 AI 예산으로 종단 검증해야 한다. 가상 가게는 시연 DB에만 넣는다. 신규 migration은 없다.

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

- 시연 전용 DB 복원 리허설 PASS(107개 테이블 행 수·migration 목록 일치), 배포 전 백업, 25개 migration 적용으로 원장 68건을 기록했다. API·`/play/` 공개 전환과 Preview 20 게시도 완료했다.
- 라이브 `/open`은 #405 병합 커밋 `08f125b4`의 운영 웹 재배포로 test.12·Preview 21 링크가 됐고, #408 병합 커밋 `687427c2`의 운영 웹 재배포로 test.13·Preview 22 링크가 됐다. 실제 설치본의 동의·체험 수용은 후속 확인으로 남긴다.
- 이번 `/play/` 번들(`5ca98955`) 전환은 새 릴리스 디렉터리에 번들을 두고 `current`를 바꾼 뒤 edge Caddy를 재시작하는 순서였다. 다음 번들 전환과 설치본 게시 순서·실패 대응은 [운영 절차](OPERATIONS_RUNBOOK.md)를 따른다. 웹 export 전에는 `npm ci --prefix apps/mobile`로 패치를 적용해야 한다.

## 6. 운영 배포 조건

- 운영 DB 실데이터의 서버 안 실제 복원과 복제본 migration 리허설은 PASS다. 원본 107개 테이블 행 수, 복제본 43→68건·1.8초, `account_consents` 5=5·공개 점포 0을 확인했다. 이 증거로 P03 복원 관문을 충족했다.
- 운영 서버는 `backward_compatible=no` 증거와 `scripts/deploy-lightsail.sh --deploy`로 `09dfceb0`(PR #404 병합) 배포를 완료했다. 배포 전 백업 `/opt/masscom/backups/database-before-09dfceb0b39b.dump.*`는 186,604바이트·mode 600이며 `DEPLOYED_COMMIT`이 새 SHA를 가리킨다([증거](evidence/production-deployment-09dfceb-2026-10-08.json)). 원장 변경 릴리스이므로 구 API 자동 복귀는 금지된다.
- 이후 `08f125b4` 재배포는 API 코드 변경과 migration이 없어 `backward_compatible=yes`로 기록했고 원장은 68건 그대로다. PR #408(`5ca98955`)은 앱·웹 번들 변경만 담아 서버 API·DB를 바꾸지 않는다.

## 7. 마이그레이션과 롤백 경계

- 새 원장에 거래가 기록된 뒤에는 이를 모르는 구 API로 자동 복귀하지 않는다. 이번 비호환 릴리스의 배포 증거는 `backward_compatible=no`로 기록하고 실패 시 쓰기를 멈춘 뒤 새 원장을 이해하는 버전으로 전진 복구한다.
- 릴리스 전후 백업·원장 수·쓰기 중지 조건은 [운영 절차](OPERATIONS_RUNBOOK.md)와 실제 복원 시험에서 검증한다.
- migration `0068_campaign_purposes.sql`(Issue #412 T3 PR 1)은 새 표·함수·트리거와 감사 CHECK 확장(`CAMPAIGN_PURPOSE_SET`, 기존 16개 전체 유지)만 더하고 잠금 대기는 5초다. `backward_compatible=yes`라 이전 API 이미지로 되돌려도 기존 쓰기는 그대로 허용된다. 아직 서버에 적용하지 않았다(운영·시연 원장은 68건 그대로, 마지막 `0067_room_guestbook.sql`). **배포 순서: 0068을 새 API 이미지보다 먼저 적용한다.** 방문 발급·재발급·확정·재생 경로가 `campaign_purposes`를 읽으므로 표가 없는 DB에 새 이미지가 먼저 뜨면 방문 확정이 실패한다(`scripts/deploy-lightsail.sh`는 `migrate` 뒤에 `api`를 올리므로 순서가 맞다). 혜택(PR 2)이 생기기 전에는 목적형 캠페인을 공개하지 않는다([D-092](DECISIONS.md)).

## 8. 개인정보 재동의와 버전 결합

- 새 API의 개인정보 안내 버전은 `privacy-2026-10-07`이다. API만 먼저 공개하면 test.10/Preview 19의 동의 화면에서 `outdated`로 막힐 수 있다(`apps/mobile/src/privacy/consent-flow.ts`).
- 시연 API와 운영 API는 배포됐고 Preview 22·test.13이 게시됐다(이전 Preview 21·test.12). 라이브 `/open`은 새 링크를 가리킨다. 구 설치본의 재동의 확인은 별도 수용 항목이다.

## 9. 자동 검증 상태

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

- 실제 Preview 22/test.13 설치·개인정보 재동의·점주 역할·NFT 발행은 이 문서 갱신으로 `PASS`가 되지 않는다. 두 APK의 익명 다운로드 해시는 일치(PASS, 2026-10-08 공개 Release에서 로그인 없이 다시 내려받아 SHA-256 재계산)다. 운영 DB 복원 리허설과 운영 배포는 각각 별도 증거로 PASS이고, 수정된 `/play/` 번들의 공개 재측정도 [재측정 기록](evidence/submission-2026-10-08-recheck/README.md)으로 PASS다.
- 사용자 판정 필요: Issue #409의 웹 history 수정(`history.get(nextIndex)`) 뒤로는, 깊은 흐름을 지난 뒤 홈 탭을 누르면 브라우저 기록이 가장 앞선 홈 항목까지 되감긴다. 그 뒤 브라우저 뒤로 가기를 한 번 더 누르면 `/play/`를 벗어난다. 수정 전에는 뒤로 가기가 직전 화면으로 돌아갔다. 새 동작은 네이티브/React Navigation과 같지만 사용자가 알아챌 수 있다. 배포하지 않았으므로(결정 A) 다음 빌드 전에 소유자가 유지할지 정한다.
- Issue #412 T1은 사용자 판정이 필요한 항목이 없다(화면·동작 변경 없음). 운영·시연 서버에서의 실제 부팅은 하지 않았고(배포 동결) DB·비밀값 없이 빌드한 서버를 띄워 `/health`만 확인했다.
- 사용자 판정 필요(Issue #412): 짝 찾기 결과판의 코인 줄(가게 이름·다음 수집품 안내·도감에서 보기) 배치와 글자 크기는 실제 화면에서 확인하지 않았다(`NOT_RUN`). 배포하지 않았으므로(결정 A) 다음 빌드 전에 확인한다.
- 사용자 판정 필요(Issue #412): 동의 화면의 요약 문구와 "전체 동의"(법률 검토 별개), 첫 코인 제안 화면, 가게 카드·상세의 새 표시는 실제 기기 렌더링을 보지 못했다(소스 시험과 웹 export 열람까지). 첫 화면의 실제 네트워크 바이트·시간 측정과 설치본·이미지·음원 용량 분석은 `NOT_RUN`이다.
- Issue #412에서 소유자 몫으로 남은 항목: ① 매일 백업 타이머 설치 승인(운영 `sudo bash infra/lightsail/host-jobs/install.sh masscom-backup`, 시연 `sudo bash infra/showcase-host/host-jobs/install.sh masscom-showcase-backup`), ② 가동 점검의 쓰기 점검 예약 여부(체험 자리를 쓰며 지금은 수동 전용, 실제 시연 서버에 대해 `NOT_RUN`), ③ 서버 밖 백업 보관 위치·비용, ④ `deploy-lightsail.sh` 배포 후 관문에 백업 첫 실행 성공을 넣는 후속(시험이 무거워 따로 한다), ⑤ 서버 백업으로 잰 복원 시간(RTO)은 없음(`NOT_RUN`).
- 사용자 판정 필요(Issue #412 T2c): 점진적 공개의 단계 기준(두 번째 가게·인정된 방문 3회·배지 3단계·마일리지 200 이상·쓰지 않은 뽑기권)과 입구가 열리는 순서가 처음 온 사람에게 맞는지, 점주 "1인 2역"(한 기기에서 역할 전환)과 단계 카드 문구가 읽기 좋은지는 실제 기기·시연 웹에서 확인하지 못했다(`NOT_RUN`). 배포하지 않았으므로(결정 A) 다음 빌드 전에 확인한다.
- `NOT_RUN` 또는 소유자 몫으로 남은 항목: 실제 점주·이용자 현장 자료, 설치본 실기·TalkBack, 지도 공급자 키·한도, 가구 가격·리롤권 지급량, 발표 리허설(사람), 대회 최종 제출(소유자 승인 필요).
- 로컬 자동 시험, 서명된 빌드, 서버 배포, 다운로드, 실기 수용, 최종 제출은 각각 다른 증거로 기록한다.
- 사용자 판정 필요(Issue #412 T3 PR 1): 점원 화면의 "이 코드를 만든 시각은 캠페인 시간대 밖이에요(방문은 인정돼요)"와 고객 방문 완료 카드의 중립 한 줄, 가게 상세의 "이번 캠페인" 블록, 관리자 양식의 목적별 입력 칸은 실제 기기·브라우저 렌더링을 보지 못했다(`NOT_RUN`, 소스·가짜 DOM 시험까지). 점주가 보는 "처음 확인된 방문/다시 확인된 방문" 어감도 점주 반응 확인이 필요하다. 이 작업은 배포하지 않았다(결정 A).

## 11. 남은 이슈와 PR 확인

- #206의 전체 체험 수용과 #380·#394의 남은 범위는 실제 Issue 상태와 증거를 재확인한다. 과거 기록의 열린 PR 목록을 현재 목록으로 사용하지 않는다.
- PR 상태는 `gh pr list --state all` 및 개별 `gh pr view <번호> --json state,mergedAt,headRefOid`로 확인한다.
- [PR #402](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/402)(팀원 PragmoB, 뽑기 `CONSENT_REQUIRED`를 "동의 확인하기"로 연결)는 `a742e32d`로 병합됐다. 최신 main과 문서 충돌을 풀고 `INTERNAL_ERROR` 문구를 일반 재시도 안내로 바꾸고 동의 문구 연결을 시험으로 고정했으며 모바일 1,878/1,878·gate 통과, 독립 리뷰 승인이다. test.13·Preview 22와 `/play/`(`5ca98955`)에 포함됐다. 남은 🟡: 개발용 DEMO 계정의 동의 화면 "로그아웃"이 DEMO 상태를 벗어나지 못함, 동의·미설정 거절 뒤 뽑기 대기 기록 유지(같은 요청 ID 복구).
- 재측정이 새로 본 낮은 결함 4건은 `5ca98955`에서 고쳤다(위 4절, 결함 [근거](evidence/submission-2026-10-08-recheck/README.md)). 이 수정의 남은 🟡는 여섯 가지다. (1) 패치 조건이 해시(`#`)로 진입한 세션에서 기록이 늘 수 있다(앱은 해시를 만들지 않음). (2) expo-router 원본의 음수 인덱스 비교 결함으로 하위 화면→홈 탭 등에서 뒤로 가기 1회 헛누름이 가능하다(이탈은 아님). (3) 새 시험이 소스 문자열 위주다. (4) 탭 바 없는 하위 화면으로 push할 때 전환 중 탭 바가 먼저 사라진다(Android 외관). (5) 라이트 모드 비선택 칩 테두리 대비가 낮다(1.14:1). (6) 웹 export 전에 `npm ci --prefix apps/mobile`(patch-package)이 필요하다. 이 가운데 (1)(2)(5)는 Issue #409의 `a3033a80`에서 고쳤다.
- Issue #412 T1의 남은 정리: 위치 인자 `createApiServer`를 흉내 내는 시험 전용 덮개(`apps/api/src/server-test-support.ts`, `http-test-support.ts`의 `positionalArgs`)는 쓰는 시험이 없어지면 지운다. `postgres/`·`showcase/`의 `BEGIN`/`COMMIT` 묶음을 `withTransaction` 도우미로 모으는 일은 미뤘다([D-088](DECISIONS.md)).
- Issue #412의 남은 주의점: 첫 코인 제안은 공개 범위를 재조회한 뒤 저장하기까지의 왕복 한 번 사이에 다른 기기에서 공개 범위를 바꾸면 방금 놓은 코인이 바뀐 범위에 보일 수 있다(서버 `saveStudio`가 공개 범위를 조건으로 받지 않음, D-086). 시연 두 가지 모드(서버 변경 필요), 점주 시연 "1인 2역" 안내, 글자·터치 최소 크기 정리는 이번 변경에 없다.
- Issue #412 T2c의 남은 주의점: 앱을 열고 저장소를 읽기 전 첫 한두 프레임은 첫 코인 단계로 그려질 수 있다(읽은 뒤 바로 바로잡힌다). `setDisclosureOverride`는 서버 시연 모드(T3/T4)용 훅이며 아직 어느 화면도 부르지 않는다. `FoundationScreen`의 `initialRole`·`showcaseTour`·`onExit`은 점주 "빈 공간 투어"가 쓰고 있어 남겼고, 지갑 연결 단계(`wallet`)는 호출하는 곳이 없어 후속 정리 대상이다.

## 12. 다음 실행 명령

1. 완료: PR #408 병합과 운영 웹 재배포로 라이브 `/open`이 test.13·Preview 22를 가리킨다.
2. Issue #409·#410 코드와 PR #413(Caddy)·#414(놀이)·#415(첫 사용 경험)·#420(NFT 발행 Worker 상시 실행)·#421(T5 운영 품질)·#422(T1 API 서버 구조 정리)는 main에 있고 모두 배포하지 않았다(소유자 결정 A). PR 상태는 `gh pr list --state all`로 확인한다. 새 Preview·test 번호와 게시 시점은 소유자가 정한다. 다음 빌드 전에 10절의 사용자 판정 항목(홈 탭 뒤로 가기)도 소유자가 정한다.
3. 웹/Caddy 배포 때 `scripts/deploy-lightsail-web.sh` probe가 `/api/web/v1/merchant/merchants/x/real-world-profile`의 JSON 401을 확인한다. 배포 뒤 `curl -si https://www.masscom.kr/api/web/v1/merchant/merchants/x/real-world-profile`이 404가 아니라 JSON 401(`cache-control: no-store`)인지 본다. 배포 시점은 소유자가 정한다(결정 A).
4. Issue #412 T2c 브랜치 `feat/first-use-v2c`는 PR #423으로 main `8841efea`에 병합됐다. 재개 시 실제 Git·PR 상태를 다시 확인한다. 다음 빌드 전에 놀이 화면(짝 찾기 결과판, 주문·배달 안내), 첫 사용 화면(동의 요약·첫 코인 제안·가게 카드), T2c 화면(단계별 입구, 점주 1인 2역 흐름)을 실제 휴대전화나 시연 웹에서 확인한다.
5. Issue #412 T1(API 서버 구조 정리, `refactor/api-deps-routes`)은 PR #422로 main에 병합됐고 API 코드는 배포하지 않았다(소유자 결정 A). 요청·응답 동작은 바뀌지 않았고 서버에는 다음 정식 배포 때 닿는다. 배포 시점은 소유자가 정한다.
6. Issue #412 T5(`chore/ops-quality-t5`)는 PR #421로 main에 병합됐고 배포·호스트 설치는 하지 않았다(소유자 결정 A). 설치본·`/open`을 바꾸는 다음 배포부터는 `docs/CURRENT_RELEASE.json`을 고치고 `node scripts/render-current-release.mjs` → `--check` 순서로 한 뒤, `scripts/verify-project-site.sh`·`tests/site/public-entry.test.mjs`·`tests/site/verify_project_site_test.sh`에 박힌 태그 문자열을 직접 새 태그로 고친다(절차는 [운영 절차](OPERATIONS_RUNBOOK.md)).
7. 새 `/play/` 번들의 공개 측정은 [측정 기록](evidence/next-build-2026-10-08/README.md)을 확인하고, 필요하면 위 남은 🟡 중 (3)(4)(6)의 처리 여부를 정한다.
8. 실제 점주·이용자 현장 자료, 설치본 실기·TalkBack, 지도 공급자 키·한도, 가구 가격·리롤권 지급량, 발표 리허설은 소유자 판단·수동 항목이다.
9. 대회 최종 제출과 Google Play는 소유자 승인이 필요한 별도 경계다. 승인 전에는 제출 버전을 고정하지 않는다.
10. Issue #412 T3(점주 목적형 캠페인)의 다음 PR: (2) 혜택·쿠폰·발급 한도와 비용 네 숫자, (3) 결과 카드와 설문, (4) 파일럿 설정 패널·안내물·모바일 표면 순서다([D-092](DECISIONS.md)). 이번 PR의 migration `0068`은 서버에 적용하지 않았으니(소유자 결정 A) 배포 때 `scripts/deploy-lightsail.sh`가 적용하고, `backward_compatible=yes`로 기록한다.
11. NFT 발행 Worker 상시 실행(D-089)은 [PR #420](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/420)으로 main `48a14811`에 병합됐고 서버 배포·운영 활성화는 하지 않았다(`NOT_RUN`). 독립 리뷰(Sonnet + Opus)의 지적은 반영한 뒤 병합했다. 켜기 전 조건은 [B-027](BLOCKERS.md)과 [Lightsail 문서](../infra/lightsail/README.md)의 "NFT 발행 Worker"다. 운영 민터 키 생성·메인넷·`LIVE` 전환은 소유자 승인 사항이다.

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

- 2026-09-22부터 2026-10-07까지의 날짜별 인수인계 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 그대로 보존한다. 과거 기록의 “현재”, “열린 PR”, “다음 명령”은 작성 당시의 상태다.
- 다음 중단 전 이 14절의 기준 SHA·브랜치·PR·공개 버전·검증 상태·다음 명령만 실제 근거에 맞춰 갱신한다.

