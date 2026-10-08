# HANDOFF

기준 시각: 2026-10-08 KST. 이 문서는 다음 작업의 현재 상태만 기록한다. 날짜별 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

## 점주 웹 두 경로 전달 — PR #418 (2026-10-08)

최신 후속: 기본 제작·발행 등급은 브론즈·실버·골드·프리즘 네 개다. 방문 지급은 1회 브론즈·3회 실버·5회 골드로 유지하며 프리즘 지급 조건을 임의로 추가하지 않는다. 게시할 때 네 기본 등급과 모든 활성 특수등급의 정면·뒷면·프레임을 저장한다. 추가 등급은 고유 ID와 이름을 보존하며 총16개(기본4+특수12) 상한을 유지한다. 프리즘은 기본 음각·양각에도 청록·분홍·보라의 각도별 색 이동과 같은 계열 테두리를 사용한다. 프리즘 후면3종은 음각 문양을 유지해 built-in 이미지 생성으로 색을 개선했다. 현재 웹·앱 뒷면12종은 동일한512px WebP767,082바이트(749.1KiB)로 원본41,909,062바이트보다98.17% 작다. v1PNG와 기존 게시본은 보존하고 모바일 번들은 v2만 사용한다. [최신 색감·용량·확장·검증](evidence/prism-collectibles-2026-10-08/README.md).

추가 후속: 점주 캠페인 선택·보상 등급·기간 연장을 제거하고 1회 브론즈·3회 실버·5회 골드를 서버에서도 고정했다. 미준비 캠페인은 초안만 저장한다. 회전 깊이는 2.5D 조명·윤곽 변위로 보강하고 게시본에 기존 12/4/15 각도 스프라이트를 저장한다. 최신 main cd01c0d6 통합 후 API 601/601·사이트 416/416·현재 배포 시험 12/12·전용 PostgreSQL 통합 29/29, 합성 양각·음각의 새 게시본 저장/재읽기와 실제 자동 회전을 확인했다. [최신 캡처·회전 비교·저장 형식](evidence/fixed-visit-relief-2026-10-08/README.md). 운영 배포·Android 실기 재생은 아직 별도다.

최신 후속: 방문 보상 제작·방문 확인·운영 결과를 별도 화면으로 정리하고 메뉴 등록을 제작 경로에서 제외했다. 1 사진 배치 → 2 사진 편집 → 3 코인 만들기 → 4 결과·방문 보상이며, 아이콘 도구·화살표 실행 취소/재실행·RGB/HEX·선택 등급의 음각/양각을 지원한다. 사용자 그림을 실제 마우스로 편집해 네 등급 PNG를 저장하고 합성 점주 fixture 캠페인에 1/3/5 목표로 게시 v6을 확인했다. 사이트 401/401·웹 모듈 문법 검사·독립 리뷰 PASS. [화면·PNG·재현](evidence/merchant-photo-editor-2026-10-08/README.md). 운영 배포·실계정 보상 지급은 검증하지 않았다.

추가 범위: 모양(원형·우표형·톱니형) × 등급(브론즈·실버·골드·프리즘)의 고정 음각 뒷면 12종을 웹·앱에 연결했다. 새 게시본은 고정 이미지를 굽고 기존 발행본의 뒷면은 보존한다. 별도 뒷면 편집 UI를 제거했다. 사이트 390/390·모바일 LF 체크아웃 1992/1992·타입·lint, 브라우저 12종 512px WebP 제한 검수 PASS. [이미지·프롬프트·검수](evidence/fixed-collectible-backs-2026-10-08/README.md)를 읽는다. 이전 v1PNG 원본 한 벌 약40MiB는 현재 모바일 require에서 제외했고, 현재 v2WebP749.1KiB만 사용한다. 실제 APK설치·실기는 별도 검증이다. 신규 API·DB migration은 없다.

[PR #418](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/418)은 main `e06c97cd`에서 분기한 AI 초안·준비 이미지 스튜디오 진입, 웹 업로드 정규화, 최신 사진 정렬과 세션 AI API 변경이다. API 569/569·typecheck·build, 사이트 384/384, PostgreSQL 최신 사진 통합 1/1이 통과했다. Docker 없는 Windows의 Caddy 컨테이너 두 시험은 실행하지 못했다. [화면 증거·재현·배포 조건](evidence/merchant-dual-studio-2026-10-08/WEB_QA.md)을 먼저 읽는다.

고객 앱 개발 웹에서 로컬 DB의 `QA 가상 월계 달빛빵집` 이름·주소·최신 이미지·1/3/5 코인 캠페인 노출을 확인했다. 운영 계정은 점포 승인 부재로 저장·게시 종단 QA가 막혔다. 공개 서비스 배포, 실제 AI 생성, 계정 권한 부여는 하지 않았다. 배포 담당자는 PR #413의 `/api/web/v1/*` Caddy 수정과 이 PR의 API·웹을 함께 반영하고 승인된 점포 및 AI 예산으로 종단 검증해야 한다. 가상 가게는 시연 DB에만 넣는다. 신규 migration은 없다.

## 1. 기준 커밋과 작업 위치

- 기준 main 커밋 SHA: `687427c26d7826e4661b97e162e094467ba39a18`(PR #408 병합 시점, 2026-10-08 KST). Issue #407의 앱 코드 커밋 `5ca98955e7ae26aea1a54d8a19b47eeae6bce2ea`가 들어 있다. [Issue #409](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/409)·[Issue #410](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/410)의 코드는 그 위에 얹혀 main에 있고 배포하지 않았다. 최신 main SHA는 `git log -1 origin/main`으로 확인한다. 작업 위치는 `git worktree list`와 `git status -sb`로 확인한다. 제출 기준선은 마감 시점의 최신 `main`이며, 확정 SHA는 [SUBMISSION_CHECKLIST](SUBMISSION_CHECKLIST.md)와 `SUBMISSION_EVIDENCE.json`의 `baselineCommit`에 기록한다.
- PR #413(운영 웹 Caddy `/api/web/v1/*` 라우트 수정, `ff5b5b6a`)과 PR #414([Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 놀이 변경, 결정 D-082, `108f6b38`), PR #415(같은 이슈의 첫 사용 경험, 결정 D-083~D-087, `e06c97cd`), PR #421(같은 이슈의 T5 운영 품질, `b707ed09`)은 병합됐다. 최신 main 확인은 위와 같이 `git log -1 origin/main`으로 한다.
- 병합 순서: PR #403(점검 결함 수정, `2d483ed8`) → #404(시연 배포·Preview 20·test.11 기록, `09dfceb0`) → #405(공개 체험 결함 4건 수정·운영 배포 기록·test.12/Preview 21, `08f125b4`) → #402(뽑기 `CONSENT_REQUIRED`의 "동의 확인하기" 연결, `a742e32d`) → #406(재측정·대체 시연 영상·제출 후보 기록, `6ce8ad03`) → #408(Issue #407의 낮은 화면 결함 4건 수정과 #402를 다음 설치본·웹 체험에 반영, `687427c2`). Issue #401은 #403 병합으로 닫혔다.
- 운영·시연 서버 배포와 수정본 `/play/` 재측정은 끝났다. Issue #407의 코드(`5ca98955`)로 운영 test.13·시연 Preview 22를 게시했고 시연 `/play/`를 같은 소스로 전환했다. #402의 변경도 이 설치본과 `/play/`에 들어 있다. 라이브 `/open`은 test.13·Preview 22를 가리킨다(2026-10-08 확인).
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)의 T1(API 서버 구조 정리)은 `apps/api`만 바꾼 작업이다. 브랜치 `refactor/api-deps-routes`를 main `b707ed09`(PR #413·#414·#415·#421 병합) 위로 옮겼고 요청·응답 동작은 바꾸지 않았다. 구조 규칙은 [D-088](DECISIONS.md)이다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)(첫 사용 경험)의 T2 작업(브랜치 `feat/first-use-v2`)은 PR #415로 병합돼 main `e06c97cd`에 있고 배포하지 않았다. 결정은 [D-083~D-087](DECISIONS.md)이다. 같은 이슈의 T5(운영 품질) 작업(브랜치 `chore/ops-quality-t5`)은 PR #421로 병합돼 main `b707ed09`에 있고 배포하지 않았다.

## 2. 현재 통합 상태

- PR #398·#400·#402·#403·#404·#405·#406·#408·#413·#414·#415·#421은 병합됐다. #398을 열린 PR로 적은 과거 전달은 [당시 기록](HANDOFF_HISTORY.md#2026-10-07-pr이슈-점검-전달-결과)이다.
- PR #396은 닫혔으나 main에 병합되지 않았다. 미병합 초안을 공개본 기능으로 계산하지 않는다.
- 재개 시 `git status -sb`, `git log -1 --oneline`, `gh pr list --state all`로 다시 대조한다.

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

- [Issue #401](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/401)은 제출 전 운영·문서·심사 대응 정리이며 #403 병합으로 닫혔다. PR #408은 [Issue #407](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/407)의 앱 수정 코드와 test.13·Preview 22 게시, `/play/` 전환, 현재 요약 문서 갱신을 함께 담아 병합됐다.
- [수정본 재측정](evidence/submission-2026-10-08-recheck/README.md)(Playwright, 시연 서버 임시 계정만)에서 이전 [17단계 실측](evidence/submission-2026-10-08/README.md)의 결함 4건이 모두 FIXED였다. 5분 시연 15단계가 전부 PASS이고 `console.error`·`pageerror`·4xx/5xx·요청 실패는 0건이다. 대체 시연 영상 `demo-flow-390.webm`(10,053,739바이트·4분 8초·390×844)과 캡처 68장을 같은 폴더에 보존했다.
- 재측정이 새로 본 낮은 결함 4건(이웃 방 하단 탭 두 벌 렌더링·탐색 선택 표시, 이웃 방→탐색 뒤 브라우저 뒤로 가기가 앱 밖으로 나감, 다크 꾸미기 "대표 수집 코인" 칩 흰색, 떠 있는 탭 바 아래 8px 틈으로 콘텐츠 비침)에 대응하는 수정이 `5ca98955`에 들어 있다. 숨은 `(tabs)` 탭 바를 그리지 않아 탭 바를 한 벌로 줄이고, 웹에서 하위 화면→처음 가는 탭 이동 시 history를 덮어쓰지 않고 추가하며(`apps/mobile/patches/expo-router+57.0.23.patch`, 웹 전용), 꾸미기 선택 칩에 테마 색을 쓰고, 탭 바 아래 띠를 배경으로 덮었다. 모바일 1,883/1,883·typecheck·lint·접근성·운영/시연 Android export·variant 자산·gate PASS, 독립 리뷰(Claude sonnet) APPROVE(🔴/🟠 없음)다. 새 `/play/` 번들의 공개 측정은 [next-build 측정 기록](evidence/next-build-2026-10-08/README.md)을 따르며 이 문서는 그 결과를 대신 적지 않는다. 구현·검증은 [PROJECT_STATE](PROJECT_STATE.md)와 [TEST_STATUS](TEST_STATUS.md)를 따른다.
- Issue #409·#410은 전면 평가 후속이다. 앱 코드: 웹 history 패치가 popstate 때 인덱스를 다시 맞추고(`a3033a80`의 해시 진입·헛누름 수정 위), 꾸미기 칩 접근성 이름에서 ✓ 글리프를 빼고, 6개 화면의 라디오·체크박스 역할 16개에 `aria-checked`와 웹 Space 키 토글을 붙였다(`apps/mobile/src/ui/space-toggles.ts`, `tests/mobile/check_accessibility_semantics_test.sh`에 가드). CI: 미연결 시험 6개(`account-deletion-flow`, `admin-funnel`, `merchant-actions-overview`, `check_pr_korean_test.sh`, `dump_aab_manifest_test.sh`, `db_restore_drill_test.sh`)를 연결하고 `production-recovery` 이중 실행을 없앴다. 새 가드 `tests/ci/ci_wiring_test.sh`는 연결 안 된 시험이 있으면 실패한다. `.gitignore`는 `dist-*-qa/`를 무시한다. 문서: README 재구성, 모순 정리, 폰 2대 실제 QR 시연 절([DEMO_RUNBOOK](DEMO_RUNBOOK.md)).
- Issue #412의 놀이 변경(`feat/play-store-memory`, PR #414로 병합)은 클라이언트만 바꿨다. 짝 찾기 여섯 장은 방문한 가게들의 코인이고(7곳 이상이면 KST 하루 단위로 시작 가게를 돌린다, 6곳 미만은 연습 그림), 결과판에 가게 이름·다음 수집품 안내·도감 이동을 보인다. 주문·배달은 준비·진행·결과에 고정 문구 "가게 메뉴 정보로 만든 가상 놀이예요. 실제 주문·결제·매출은 없어요."를 붙이고 가격을 보이지 않으며 결과에 가게 상세 링크를 한 줄 둔다. 방문 버튼은 붙이지 않았고 놀이는 발견 이벤트를 기록하지 않는다. API·migration·`play-rules.ts`는 그대로다. 결정은 D-082다. 배포하지 않았다(소유자 결정 A).
- 저장소 정리: worktree 82→12개, 로컬 브랜치 207→30개(main에 병합된 것만 삭제), 원격(origin) 브랜치 162→22개(main에 완전히 포함된 140개 삭제, 미병합과 `sync/*` 유지)다.
- Issue #412 T1(API 서버 구조 정리, `refactor/api-deps-routes`): `server.ts`를 `routes/*`(경로 처리기 17개, 고정 순서)·`http/*`(요청·응답 도우미)·`api-deps.ts`(이름 붙은 `ApiDeps`)·`api-runtime.ts`(서버 인스턴스별 제한기·확인)로 나눴다. 마무리에서 교차 리뷰의 🟡를 반영했다: deps를 복사해 한 번만 얼림, 기본값 세 가지(`trustProxyClientIp`·`webWwwEnabled`·`experienceServices`)를 한곳에서 정함, 웹 로그인 콜백 쿠키와 삭제 접수 서비스 두 개의 배선을 시험으로 고정, `experienceServices`를 `Required<ExperienceServices>`로 검사. 요청·응답 동작은 `89d7a5e4`와 같다(인라인 비교 1797/1797줄, 차이는 로그아웃 블록 위치뿐).
- 운영 웹 Caddy 라우트 수정(PR #413으로 병합): `@webSession`·`@privateSurface`에 `/api/web/v1/*`를 더하고 실제 Caddy 컨테이너 시험(`verify_web_session_proxy_test.mjs`)·배포 검증기·웹 smoke·웹 배포 probe에 이 경로를 고정했다. 시연 호스트는 같은 Caddyfile을 써서 별도 수정이 없다. 후속으로 `apps/api/src/real-world-http.ts` 쓰기의 계정별 제한을 트랙 T6, [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)로 넘겼다.
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)는 신규 사용자의 첫 코인 흐름과 첫 화면 즉시 반응이다(소유자 2026-10-08 방향, PR #415로 병합). 앱 코드만 바뀌었고 API·DB는 그대로다. (1) 웹 대기 안내 `apps/mobile/public/index.html`과 웹 번들의 지갑 SDK 제외(진입 번들 6,375,429B → 4,119,372B), 지연 소리 생성. (2) 동의 화면의 늘 보이는 정확한 요약·접힌 전체 안내·"전체 동의". (3) 홈의 요청별 표시와 "처음이라면 이 가게부터", 가게 카드·상세의 사실 표시 원칙, 첫 코인 "내 공간에 놓기" 제안. (4) 웹 마스코트·랜드마크 접근성. 배포·게시는 하지 않았다(소유자 결정 A).
- [Issue #412](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/412)는 기능 수준 감시와 운영 품질 작업이다. PR #421(브랜치 `chore/ops-quality-t5`, 병합 커밋 `b707ed09`)로 main에 15분 가동 점검(`.github/workflows/uptime.yml`, 실패는 `uptime` 라벨 이슈, 쓰기 점검은 수동 전용), 운영·시연 매일 백업 유닛(`masscom-backup`, 호스트에 설치하지 않음), `scripts/db-restore-drill.sh --restore-only`, 큰 파일 가드(`scripts/check-large-files.sh`와 예외 목록), 현재 배포 상태를 손으로 고치는 기준 파일 `docs/CURRENT_RELEASE.json`과 생성·검사 스크립트(검사 범위는 `open.html` 블록 밖·README "바로 체험"·DEMO_RUNBOOK·SUBMISSION_CHECKLIST이고, 날짜별 이력 표인 `docs/ANDROID_DOWNLOADS.md`는 밖이다), CI의 API 단위 커버리지 요약(줄 약 58.5%, 보고용)을 더했다. 설치본 용량은 [분석 문서](APK_SIZE_ANALYSIS.md)에 측정값과 가설만 적었다. 배포하지 않았고(소유자 결정 A) 공개 상태는 3절 그대로다. 절차는 [운영 절차](OPERATIONS_RUNBOOK.md)의 Issue #412 절에 있다.

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

## 8. 개인정보 재동의와 버전 결합

- 새 API의 개인정보 안내 버전은 `privacy-2026-10-07`이다. API만 먼저 공개하면 test.10/Preview 19의 동의 화면에서 `outdated`로 막힐 수 있다(`apps/mobile/src/privacy/consent-flow.ts`).
- 시연 API와 운영 API는 배포됐고 Preview 22·test.13이 게시됐다(이전 Preview 21·test.12). 라이브 `/open`은 새 링크를 가리킨다. 구 설치본의 재동의 확인은 별도 수용 항목이다.

## 9. 자동 검증 상태

- 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN` ([시험 원장](TEST_STATUS.md), [제출 증거](SUBMISSION_EVIDENCE.json)).
- Issue #401 구현 브랜치 `fix/submission-readiness`의 당시 검사: API 단위 567/567·PostgreSQL 524 PASS/3 SKIP(전용 55435 hosted seed 컨테이너 조건), API typecheck·build, 모바일 1,872/1,872·typecheck·lint·운영/시연 Android export·variant 자산·접근성 의미 PASS. `9f5ebfa6` 수정은 독립 Codex 리뷰 APPROVE, 모바일 1,876/1,876·typecheck·lint·접근성·gate PASS다.
- 해당 브랜치의 사이트·운영 시험(로컬 restore drill 실DB 포함)·`bash tools/gate.sh` PASS. 이번 운영 서버 실데이터 복원·migration 리허설은 별도 [P03 증거](evidence/production-restore-rehearsal-2026-10-08.json)로 기록한다.
- Issue #407의 코드 `5ca98955`: 모바일 1,883/1,883, typecheck·lint·접근성·운영/시연 Android export·variant 자산·gate PASS, 독립 리뷰(Claude sonnet) APPROVE(🔴/🟠 없음). 이 문서 갱신의 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 기록한다.
- Issue #409·#410 브랜치(전달받은 기록이며 이번 문서 작업에서 다시 실행하지 않음): 모바일 `npm test` 1901/1901, typecheck·lint PASS, 접근성 의미 검사·지갑 표면 검사 PASS, 시연 웹 export PASS(번들에 새 코드 포함), gate PASS. API 시험은 567/567 그대로이고 API 코드는 바뀌지 않았다. 코드·CI 교차 리뷰(Claude Sonnet·Claude Opus) 반드시 고칠 것 0건, 후속 반영. 문서 리뷰(Claude Sonnet) 지적 반영. 자세한 기록은 PR 본문에 둔다. 리뷰 후속으로 꾸미기 칩 묶음(코인·테마·배치·강조색)에 `aria-pressed`를 붙였고, `spaceToggles`가 수정자 키와 자식에서 올라온 키 이벤트를 무시하게 했으며, 꾸미기 저장 중복 방지 가드를 누르기와 Space가 함께 쓰게 했다(시험 2건 추가). 이 문서 갱신의 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 기록한다.
- Issue #412 놀이 변경(PR #414): 모바일 `npm test` 1919/1919, typecheck·lint·접근성 의미 검사·지갑 표면 검사·CI 연결 검사·gate PASS. 독립 리뷰(Claude Sonnet 5.5) 승인 후 후속 6건 반영. 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 기록한다.
- PR #402는 모바일 1,878/1,878·gate 통과, 독립 리뷰 승인 뒤 병합했다. 앞 문장의 Issue #401 결과와 PR #404 문서 worktree 검사는 당시 기록이며, 현재 문서 브랜치의 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 별도로 기록한다.
- Issue #412 T1 브랜치 `refactor/api-deps-routes`: API 단위 597/597(이 작업 전 591, 새 시험 6건)·typecheck·build, PostgreSQL 전체 524 pass / 0 fail / 3 skip(3건은 전용 55435 hosted seed 컨테이너 조건), 변이 점검 6건 모두 시험 실패, `dist/server.js` 부팅 뒤 `/health` 200, 사이트 시험·개인정보 검사·gate PASS. 교차 리뷰(Claude Sonnet·Claude Opus) 승인, 🔴 0·🟠 0. 자세한 결과는 [TEST_STATUS](TEST_STATUS.md)에 있다.
- Caddy `/api/web/v1/*` 수정(`fix/caddy-web-v1-routes`, PR #413): `verify_web_session_proxy_test.mjs` 2/2(옛 Caddyfile은 2건 FAIL), `verify_lightsail_deployment_test.sh`·`run_aws_web_smoke.sh`·`deploy_lightsail_web_test.sh`·`ci_wiring_test.sh`·gate PASS, 관련 `node --test` 31/31. 라이브 재측정은 NOT_RUN이다. 자세한 결과는 [TEST_STATUS](TEST_STATUS.md)에 둔다.
- Issue #412 첫 사용 경험(PR #415, 브랜치 `feat/first-use-v2`): 모바일 `npm test` 1992/1992(PR #414 위로 리베이스한 뒤의 합계, 리베이스 전 이 브랜치 단독 1974), typecheck·lint PASS, 접근성 의미 검사·지갑 표면 검사·CI 연결 PASS, 시연 웹 export PASS(번들에 지갑 SDK 문자열 0건, `class="boot"` 대기 안내 포함). 사이트 시험 `verify_production_web_test.mjs`·`legal-pages.test.mjs` 147/147. API 시험은 567/567 그대로이고 API 코드는 바뀌지 않았다. 코드 교차 리뷰(Claude Sonnet·Claude Opus) 두 차례 뒤 지적 반영. 명령별 결과는 [TEST_STATUS](TEST_STATUS.md)에 있다.
- 기본 재현: `bash tools/gate.sh`, `bash tests/bootstrap/verify_operations_docs_test.sh`, `bash tests/site/verify_evidence_consistency_test.sh`, `bash tests/ops/showcase_host_readiness_test.sh`.
- Issue #412 T5(PR #421로 병합, 병합 전 브랜치에서 직접 실행, main `e06c97cd` 위로 리베이스한 뒤 사이트·운영·CI 연결·큰 파일 시험과 `bash tools/gate.sh`를 다시 실행해 통과, API 커버리지와 실제 컨테이너 행은 리베이스 전 측정): 가동 점검·매일 백업·정리 작업·복원 드릴(가짜 도구와 일회용 로컬 Postgres 16.10)·큰 파일 가드 시험, `current_release_test.mjs` 포함 사이트 시험 26/26, `render-current-release.mjs --check`, `ci_wiring_test.sh`(시험 파일 90개 모두 연결), API 단위 567/567(커버리지 포함), `bash tools/gate.sh` PASS. 독립 리뷰 2건의 변경 요청(🔴 없음)은 후속 커밋에서 반영했고 반영분의 재검토와 GitHub Actions 전체 CI는 `NOT_RUN`이다. 결과표는 [TEST_STATUS](TEST_STATUS.md) 맨 위 절.

## 10. 수동 수용과 미실행 항목

- 실제 Preview 22/test.13 설치·개인정보 재동의·점주 역할·NFT 발행은 이 문서 갱신으로 `PASS`가 되지 않는다. 두 APK의 익명 다운로드 해시는 일치(PASS, 2026-10-08 공개 Release에서 로그인 없이 다시 내려받아 SHA-256 재계산)다. 운영 DB 복원 리허설과 운영 배포는 각각 별도 증거로 PASS이고, 수정된 `/play/` 번들의 공개 재측정도 [재측정 기록](evidence/submission-2026-10-08-recheck/README.md)으로 PASS다.
- 사용자 판정 필요: Issue #409의 웹 history 수정(`history.get(nextIndex)`) 뒤로는, 깊은 흐름을 지난 뒤 홈 탭을 누르면 브라우저 기록이 가장 앞선 홈 항목까지 되감긴다. 그 뒤 브라우저 뒤로 가기를 한 번 더 누르면 `/play/`를 벗어난다. 수정 전에는 뒤로 가기가 직전 화면으로 돌아갔다. 새 동작은 네이티브/React Navigation과 같지만 사용자가 알아챌 수 있다. 배포하지 않았으므로(결정 A) 다음 빌드 전에 소유자가 유지할지 정한다.
- Issue #412 T1은 사용자 판정이 필요한 항목이 없다(화면·동작 변경 없음). 운영·시연 서버에서의 실제 부팅은 하지 않았고(배포 동결) DB·비밀값 없이 빌드한 서버를 띄워 `/health`만 확인했다.
- 사용자 판정 필요(Issue #412): 짝 찾기 결과판의 코인 줄(가게 이름·다음 수집품 안내·도감에서 보기) 배치와 글자 크기는 실제 화면에서 확인하지 않았다(`NOT_RUN`). 배포하지 않았으므로(결정 A) 다음 빌드 전에 확인한다.
- 사용자 판정 필요(Issue #412): 동의 화면의 요약 문구와 "전체 동의"(법률 검토 별개), 첫 코인 제안 화면, 가게 카드·상세의 새 표시는 실제 기기 렌더링을 보지 못했다(소스 시험과 웹 export 열람까지). 첫 화면의 실제 네트워크 바이트·시간 측정과 설치본·이미지·음원 용량 분석은 `NOT_RUN`이다.
- Issue #412에서 소유자 몫으로 남은 항목: ① 매일 백업 타이머 설치 승인(운영 `sudo bash infra/lightsail/host-jobs/install.sh masscom-backup`, 시연 `sudo bash infra/showcase-host/host-jobs/install.sh masscom-showcase-backup`), ② 가동 점검의 쓰기 점검 예약 여부(체험 자리를 쓰며 지금은 수동 전용, 실제 시연 서버에 대해 `NOT_RUN`), ③ 서버 밖 백업 보관 위치·비용, ④ `deploy-lightsail.sh` 배포 후 관문에 백업 첫 실행 성공을 넣는 후속(시험이 무거워 따로 한다), ⑤ 서버 백업으로 잰 복원 시간(RTO)은 없음(`NOT_RUN`).
- `NOT_RUN` 또는 소유자 몫으로 남은 항목: 실제 점주·이용자 현장 자료, 설치본 실기·TalkBack, 지도 공급자 키·한도, 가구 가격·리롤권 지급량, 발표 리허설(사람), 대회 최종 제출(소유자 승인 필요).
- 로컬 자동 시험, 서명된 빌드, 서버 배포, 다운로드, 실기 수용, 최종 제출은 각각 다른 증거로 기록한다.

## 11. 남은 이슈와 PR 확인

- #206의 전체 체험 수용과 #380·#394의 남은 범위는 실제 Issue 상태와 증거를 재확인한다. 과거 기록의 열린 PR 목록을 현재 목록으로 사용하지 않는다.
- PR 상태는 `gh pr list --state all` 및 개별 `gh pr view <번호> --json state,mergedAt,headRefOid`로 확인한다.
- [PR #402](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/402)(팀원 PragmoB, 뽑기 `CONSENT_REQUIRED`를 "동의 확인하기"로 연결)는 `a742e32d`로 병합됐다. 최신 main과 문서 충돌을 풀고 `INTERNAL_ERROR` 문구를 일반 재시도 안내로 바꾸고 동의 문구 연결을 시험으로 고정했으며 모바일 1,878/1,878·gate 통과, 독립 리뷰 승인이다. test.13·Preview 22와 `/play/`(`5ca98955`)에 포함됐다. 남은 🟡: 개발용 DEMO 계정의 동의 화면 "로그아웃"이 DEMO 상태를 벗어나지 못함, 동의·미설정 거절 뒤 뽑기 대기 기록 유지(같은 요청 ID 복구).
- 재측정이 새로 본 낮은 결함 4건은 `5ca98955`에서 고쳤다(위 4절, 결함 [근거](evidence/submission-2026-10-08-recheck/README.md)). 이 수정의 남은 🟡는 여섯 가지다. (1) 패치 조건이 해시(`#`)로 진입한 세션에서 기록이 늘 수 있다(앱은 해시를 만들지 않음). (2) expo-router 원본의 음수 인덱스 비교 결함으로 하위 화면→홈 탭 등에서 뒤로 가기 1회 헛누름이 가능하다(이탈은 아님). (3) 새 시험이 소스 문자열 위주다. (4) 탭 바 없는 하위 화면으로 push할 때 전환 중 탭 바가 먼저 사라진다(Android 외관). (5) 라이트 모드 비선택 칩 테두리 대비가 낮다(1.14:1). (6) 웹 export 전에 `npm ci --prefix apps/mobile`(patch-package)이 필요하다. 이 가운데 (1)(2)(5)는 Issue #409의 `a3033a80`에서 고쳤다.
- Issue #412 T1의 남은 정리: 위치 인자 `createApiServer`를 흉내 내는 시험 전용 덮개(`apps/api/src/server-test-support.ts`, `http-test-support.ts`의 `positionalArgs`)는 쓰는 시험이 없어지면 지운다. `postgres/`·`showcase/`의 `BEGIN`/`COMMIT` 묶음을 `withTransaction` 도우미로 모으는 일은 미뤘다([D-088](DECISIONS.md)).
- Issue #412의 남은 주의점: 첫 코인 제안은 공개 범위를 재조회한 뒤 저장하기까지의 왕복 한 번 사이에 다른 기기에서 공개 범위를 바꾸면 방금 놓은 코인이 바뀐 범위에 보일 수 있다(서버 `saveStudio`가 공개 범위를 조건으로 받지 않음, D-086). 시연 두 가지 모드(서버 변경 필요), 점주 시연 "1인 2역" 안내, 글자·터치 최소 크기 정리는 이번 변경에 없다.

## 12. 다음 실행 명령

1. 완료: PR #408 병합과 운영 웹 재배포로 라이브 `/open`이 test.13·Preview 22를 가리킨다.
2. Issue #409·#410 코드와 PR #413(Caddy)·#414(놀이)·#415(첫 사용 경험)·#421(T5 운영 품질)은 main에 있고 모두 배포하지 않았다(소유자 결정 A). PR 상태는 `gh pr list --state all`로 확인한다. 새 Preview·test 번호와 게시 시점은 소유자가 정한다. 다음 빌드 전에 10절의 사용자 판정 항목(홈 탭 뒤로 가기)도 소유자가 정한다.
3. 웹/Caddy 배포 때 `scripts/deploy-lightsail-web.sh` probe가 `/api/web/v1/merchant/merchants/x/real-world-profile`의 JSON 401을 확인한다. 배포 뒤 `curl -si https://www.masscom.kr/api/web/v1/merchant/merchants/x/real-world-profile`이 404가 아니라 JSON 401(`cache-control: no-store`)인지 본다. 배포 시점은 소유자가 정한다(결정 A).
4. 다음 빌드 전에 놀이 화면(짝 찾기 결과판, 주문·배달 안내)과 첫 사용 화면(동의 요약·첫 코인 제안·가게 카드)을 실제 휴대전화나 시연 웹에서 확인한다.
5. Issue #412 T1(API 서버 구조 정리, `refactor/api-deps-routes`)의 API 코드는 배포하지 않았다(소유자 결정 A). 요청·응답 동작은 바뀌지 않았고 서버에는 다음 정식 배포 때 닿는다. 배포 시점은 소유자가 정한다.
6. Issue #412 T5(`chore/ops-quality-t5`)는 PR #421로 main에 병합됐고 배포·호스트 설치는 하지 않았다(소유자 결정 A). 설치본·`/open`을 바꾸는 다음 배포부터는 `docs/CURRENT_RELEASE.json`을 고치고 `node scripts/render-current-release.mjs` → `--check` 순서로 한 뒤, `scripts/verify-project-site.sh`·`tests/site/public-entry.test.mjs`·`tests/site/verify_project_site_test.sh`에 박힌 태그 문자열을 직접 새 태그로 고친다(절차는 [운영 절차](OPERATIONS_RUNBOOK.md)).
7. 새 `/play/` 번들의 공개 측정은 [측정 기록](evidence/next-build-2026-10-08/README.md)을 확인하고, 필요하면 위 남은 🟡 중 (3)(4)(6)의 처리 여부를 정한다.
8. 실제 점주·이용자 현장 자료, 설치본 실기·TalkBack, 지도 공급자 키·한도, 가구 가격·리롤권 지급량, 발표 리허설은 소유자 판단·수동 항목이다.
9. 대회 최종 제출과 Google Play는 소유자 승인이 필요한 별도 경계다. 승인 전에는 제출 버전을 고정하지 않는다.

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
