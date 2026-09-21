# HANDOFF

마지막 갱신 시각: 2026-09-21 KST
기준 브랜치: `main`
기준 main 커밋 SHA: `595f70f` (PR #114 merge, main CI `35563583964` PASS). 이 문서를 고친 PR이 병합되면 실제 값은 `git log origin/main -1`로 확인한다.

새 세션이나 다른 계정은 Phase 0을 반복하지 말고 아래 “다음 세션이 가장 먼저 해야 할 작업”부터 이어간다. 문서와 GitHub가 다르면 실제 commit·merge 기록을 따른다.

## 이번 세션에서 완료한 것

- Issue #110: Google `auth_time` 최근성, JWKS 최대 stale 24시간, `/auth/google` 검증 전 요청 제한, 만료·폐기 세션 bounded cleanup(migration 0013), Play 카메라·NFT award 초안 정합
- Issue #112: EIP-1559 priority fee 관계·signed sender 대조, raw-key 이름 변형, keystore 전체 상위 경로, lock timeout·pool 설정 보강
- PR #111 merge `205d273`, main CI `35561417735` PASS. PR #114 merge `595f70f`, 최종 PR CI `35563298914`·main CI `35563583964` PASS. PR #113은 GitHub가 CI run을 만들지 않아 동일 커밋으로 대체 후 종료
- Issue #59: 체인 cursor에서 `CHAIN_REORG_MARGIN`만큼 되돌아가 조회하고, 못 찾으면 배포 기준 블록까지 다시 조회. cursor 조회 실패는 `CHAIN_CURSOR_READ_FAILED` 재시도 오류. ethers 요청 cache 때문에 Anvil에서 간헐적으로 30초 대기하던 원인 제거
- Issue #61: Worker 재시도 지수 backoff(1초→최대 5분)와 전송 시도 5회 도달 시 `MANUAL_REVIEW`(`RETRY_LIMIT_EXCEEDED`) 전환. migration 없음
- Expo 57.0.24·expo-router 57.0.22·@expo/ui 57.0.19 patch 적용. 모바일 moderate 권고 14건은 upstream 수정이 없어 B-008 유지
- Issue #66: SIWE challenge를 PostgreSQL `wallet_challenges`(migration 0008)에 저장, 원자적 claim, 만료 정리. 보안 리뷰 지적 반영: binding 기록 뒤 nonce를 되돌리지 않아 서명 재사용 차단, 계정 삭제 transaction 안에서 challenge 제거
- Base Sepolia keystore 전용 배포 스크립트와 실체인 시뮬레이션 PASS(전송 없음). 계정 삭제가 접수되면 앱이 지갑 연결을 끊고 기기의 WalletConnect 세션 제거(D-021)
- 운영 package ID `kr.masscom.wolgye`(D-022)와 개발 variant 분리, `scripts/build-release-aab.sh`, 로컬 debug 서명 운영 AAB에서 package·scheme·overlay 권한 제거·16KB 정렬 48개 PASS
- Google Play Console 제출 초안 `docs/PLAY_CONSOLE_DRAFT.md`(입력·제출 없음)
- Issue #92: 백업·복원 drill 스크립트와 회귀 시험, `docs/DEVICE_TEST_PLAN.md`(실기 시험 절차), `docs/HOSTING_LOGIN_PROPOSAL.md`(외부 HTTPS·로그인 승인 요청 묶음, 자원 미생성)
- Issue #90: 스마트 지갑(계약 계정) 서명 3가지 형태가 `SIGNER_MISMATCH`로 거절되고 binding이 생기지 않으며 challenge가 재시도 가능함을 fixture로 고정, 앱 안내에 미지원 설명 추가. W05는 실기 환경이 없어 `BLOCKED` 유지(B-011)
- Issue #88: 배포 안내의 `cast wallet import`→`cast wallet new <이름>` 정정, 배포 스크립트 사전 검사(keystore 계정·chainId·역할 주소·기존 broadcast 기록 시 `--redeploy` 요구), 빌드 스크립트 산출물 출처 출력과 debug 서명 종료 코드 3, `android.injected.signing.*` 주입을 일회용 키로 확인. 실제 전송·upload key 서명은 하지 않음
- Issue #86: 로컬 production AAB를 `scripts/check-release-wallet-surface.sh`로 정적 검사해 W08 PASS. SDK는 `features.onramp` 미지정 시 온램프를 켜고 계정 화면의 송금 버튼에는 flag가 없으므로, 명시적 false와 “`open()`은 Connect view만·SDK 버튼 미렌더링”을 CI 회귀 시험으로 고정. upload key 서명본에서 같은 명령을 다시 실행해야 함
- Issue #84: 같은 주문 참조 아래 사람별 슬롯 독립성을 PostgreSQL로 실증해 Q04 PASS(스키마 변경 없음). 단체 최대 인원·1인 최소 금액·명단 고정은 v3 제안값이라 구현하지 않음. 발표 첫 화면의 오래된 집계(26/8)를 고치고 검증기가 그 위치도 검사하게 함
- Issue #78: 연속 재시도를 `mint_jobs.retry_streak`(migration 0010)에 기록해 지연을 최대 5분까지 늘림(수동 검토 전환에는 쓰지 않음). 전송 직후 중지로 revert된 거래는 일시 조건이면 hash를 지우고 재시도. reward key 조회 실패도 인터페이스 불일치와 장애를 구분
- Issue #80: 지갑 세션 저장을 계정별 tag로 분리하고 시작 시 다른 계정 세션을 제거, 점주·지갑 화면에 remount 보호 추가. API `no-store`는 이미 구현돼 있어 회귀 시험만 추가. D02는 실기 계정 전환을 못 해 `NOT_RUN` 유지
- Issue #77: RPC 연결 불가가 작업을 `MANUAL_REVIEW`로 보내던 분류를 `RPC_UNAVAILABLE` 재시도로 수정. 계약 중지 `MINT_PAUSED`, 민터 잔액 부족 `MINTER_BALANCE_LOW`는 전송 준비 직전에 확인해 전송 시도를 소모하지 않음. code는 있지만 인터페이스가 다른 계약은 재시도하지 않고 `CONTRACT_INTERFACE_MISMATCH`로 수동 검토. 필수 테스트 O02를 Local Anvil·PostgreSQL 증거로 `NOT_RUN`→`PASS` 전환
- Issue #75: 경로 값의 잘못된 percent-encoding을 8개 라우트 공통 helper로 400 `INVALID_PATH_PARAMETER` 처리(기존 500)
- Issue #73: `POST /campaigns/:id/enrollments` 캠페인 참여 등록과 정원 원자 예약(migration 0009). 필수 테스트 R02를 실제 PostgreSQL 동시성 증거로 `NOT_RUN`→`PASS` 전환. 같은 계정의 마지막 자리 경합에서 정원 마감으로 잘못 거절하던 빈틈을 결정적 재현 시험으로 확인해 수정
- Issue #71: README·앱별 README·`.env.example`·EVALUATION_MAP·SUBMISSION_EVIDENCE·TEST_STATUS·PROJECT_STATE·HANDOFF를 실제 병합 상태에 맞춤

## 생성한 Issue

- #110 운영 로그인 재인증·요청 제한·세션 정리 (종료)
- #112 서비스 민터 서명·키 파일·lock 설정 보강 (종료)
- #61 Worker 재시도 상한과 지수 backoff (종료)
- #66 SIWE challenge PostgreSQL 공유 저장소 (종료)
- #71 9월 20일 병합분 문서 정합 (종료)
- #73 캠페인 참여 등록과 정원 원자 예약 R02 (종료)
- #75 잘못된 경로 인코딩을 400으로 거절 (종료)
- #77 RPC·발행 중지·민터 잔액 장애 복구 O02 (종료)
- #80 계정 전환 시 이전 사용자 데이터 미노출 D02 (종료)
- #78 전송 전 장애의 재시도 간격과 전송 직후 중지 처리 개선 (이 문서를 담은 PR로 종료)
- #65·#69·#70 작업은 Issue 없이 진행했다. 이후 작업은 Issue를 먼저 만든다.

## 생성한 브랜치

- `feat/59-chain-cursor-restart`, `feat/61-worker-retry-limit`, `chore/expo-patch-advisory-recheck`, `feat/66-siwe-challenge-postgres`, `docs/66-closeout`, `feat/base-sepolia-deploy-script`, `feat/release-package-id`, `docs/71-state-sync`, `feat/73-campaign-enrollment`, `fix/75-path-param-decoding`, `fix/77-worker-outage-recovery`, `fix/80-account-switch-isolation`, `fix/78-presubmit-backoff`
- 남아 있는 원격 브랜치 `feat/59-chain-cursor-read`, `feat/61-worker-retry-cap`은 같은 내용을 새 브랜치로 대체한 뒤 닫은 PR #60·#62의 것이다. main에 병합되지 않았으며 삭제 여부는 소유자가 정한다.

## 생성한 PR

- #63, #64, #65, #67, #68, #69, #70, #72 #74, #76, #79, #81, #82, #83(PragmoB), #85, #87, #89, #91, #93, #96, #98, #99, #102, #104, #105(PragmoB), #107, #108, #109, #111, #114 (모두 병합)
- #60·#62는 #63·#64로 대체했고, #113은 CI run 미생성으로 #114로 대체해 닫았다.

## merge된 PR

| PR | merge 커밋 | main CI run |
| --- | --- | --- |
| #63 체인 cursor 재시작·reorg 여유 | `6bbf58c` | `35458855491` PASS |
| #64 Worker 재시도 상한·backoff | `695210c` | `35459019638` PASS |
| #65 Expo patch·B-008 재평가 | `4c4d744` | `35459313304` PASS |
| #67 SIWE PostgreSQL 저장소 | `9c3c04a` | `35460087002` PASS |
| #68 재개 기록 마감 | `f386c84` | `35460432649` PASS |
| #69 Base Sepolia 배포 스크립트·기기 세션 정리·Play 초안 | `a83cef9` | `35486460953` PASS |
| #70 운영 package ID·release AAB 경로 | `9e670ab` | `35487020999` PASS |
| #72 문서 정합 | `761ac42` | `35487858774` PASS |
| #74 캠페인 참여 등록·R02 | `b04af56` | PASS |
| #76 경로 인코딩 400 | `640bb83` | PASS |
| #79 Worker 장애 복구·O02 | `e4e633c` | `35499451454` PASS |
| #81 계정 전환 분리·D02 | `5aafafc` | PASS |
| #82 재시도 backoff·revert 재분류 | `e4d4edb` | `35504888279` PASS |
| #85 단체 슬롯 독립·Q04 | `367f26b` | `35505367620` PASS |
| #83 하단 safe-area 여백(PragmoB, 후속 수정 포함) | `6417b0c` | PASS |
| #87 운영 AAB 지갑 진입점·W08 | `a2a0452` | PASS |
| #89 배포·빌드 사전 검사 | `fe2be9a` | PASS |
| #91 W05 fixture·미지원 안내 | `f28737b` | 병합 뒤 main CI는 `gh run list --branch main`으로 확인 |
| #111 운영 로그인 후속 보안·Play 초안 | `205d273` | `35561417735` PASS |
| #114 서비스 민터 후속 보안 | `595f70f` | `35563583964` PASS |

코드 PR은 서로 다른 모델의 독립 리뷰에서 CRITICAL·HIGH 0을 확인한 뒤 병합했다. #63·#67·#69는 두 모델, #64·#65·#70은 단일 모델 리뷰(지적 반영 뒤 재리뷰)로 병합했다.

## 실행한 테스트

- API 단위 `72/72`, API PostgreSQL `37/37`(운영 로그인 보강·R02 7개·Q04 1개 포함)
- Worker 단위 `45/45`, Worker PostgreSQL `23/23`, Anvil `12/12`(W07 M01~M08 + O02a~e)
- 모바일 `57/57`, typecheck·lint·Android export PASS
- Foundry `8/8`, fuzz 128, fmt·build·lint PASS
- 실제 Base Sepolia RPC 배포 시뮬레이션 PASS(전송 없음), 잘못된 체인·중복 역할 거절 PASS
- 운영 variant `bundleRelease`와 ELF `PT_LOAD` 정렬 검사 PASS(debug 서명)
- secret·privacy·bootstrap·portal·presentation verifier PASS
- 필수 36개 `30 PASS / 2 BLOCKED / 4 NOT_RUN`(R02·O02·Q04·W08 전환). 남은 NOT_RUN: D02·O01·A01·A02
- `NOT_RUN`: 실제 Base Sepolia 배포, upload key 서명 AAB, 16KB 기기 설치, Android 실기 회귀(Expo patch·새 package와 scheme·계정 삭제 뒤 세션 복원 여부), Play Console

## 현재 열린 PR

- 없음(이 문서를 고치는 PR 제외).

## 현재 작업 중인 기능

- 없음. 로컬에만 있고 원격에 없는 변경도 없다. `apps/mobile/android`는 gitignore된 생성물이며 현재 개발 variant(`kr.masscom.wolgye.dev`)로 생성돼 있다.

## BLOCKER

- B-002 저장소 공개 전환: 명시 승인 필요
- B-003 외부 HTTPS·유료 클라우드: 소유 domain·hosting·계정 필요
- B-004 Google Play 정책·국내 분류 공식 확인
- B-008 모바일 moderate 권고 14건: Expo upstream 수정 대기
- B-010·B-011 W04·W05용 실제 지갑 환경 부재
- B-012 Base Sepolia: Foundry keystore 계정 4개는 존재하지만 배포자·민터 잔액이 각각 0이라 faucet gas 필요
- B-013 모바일 Google 로그인과 외부 HTTPS 삭제 URL 부재. 서버 auth_time 재인증·요청 제한·세션 정리는 완료
- B-014 Reown 허용 목록의 새 package 등록 여부를 dashboard에서 확인해야 함

## 사용자 승인이 필요한 사항

승인된 것(D-019~D-022): SIWE PostgreSQL 저장소, 외부 HTTPS·Base Sepolia·release AAB·Google Play 준비, 기기 세션 저장 정책, 운영 package ID. 소유자는 Codex와 Claude 세션을 번갈아 쓰므로 어느 쪽이든 이 문서와 저장소 기록에서 상태를 복원한다.

소유자가 직접 해야 하는 것(대신 수행하지 않음):

0. **Reown dashboard 허용 목록에 `kr.masscom.wolgye`·`kr.masscom.wolgye.dev`가 있는지 확인하고 없으면 추가(B-014)**. 로컬에는 Reown project ID가 설정되어 있지만 dashboard 설정은 확인할 수 없다. 추가 뒤 연결된 Samsung SM-S928N에서 `docs/DEVICE_TEST_PLAN.md` E02부터 재실행한다.
1. Base Sepolia faucet으로 배포자 `0xFDd1746dcEdE5A796812fBe30fc231059a98c089`와 민터 `0xfDfaB19251Caa5Bd140CdD7F167F6e4De895c355`에 gas를 넣는다. 2026-09-21 재조회에서도 둘 다 정확히 `0 ETH`. `masscom-base-sepolia`, `masscom-sepolia-admin`, `masscom-sepolia-minter`, `masscom-sepolia-pauser` keystore 이름은 이미 존재하므로 다시 만들지 않는다.
2. Android upload keystore를 직접 생성하고 로컬 Gradle signing 설정을 넣는다. 현재 `android.injected.signing.*` 설정과 `apps/mobile/upload-certificate.sha256`이 없다. 비밀번호·keystore는 저장소나 대화에 붙이지 않고 인증서 SHA-256 지문만 파일 또는 `UPLOAD_CERT_SHA256`으로 제공한다.
3. Google Cloud에서 `kr.masscom.wolgye.dev` debug SHA-1용 Android OAuth client와 향후 Play App Signing 인증서용 production client를 만든다. 현재 로컬에는 Reown ID만 있고 Google client ID가 없다.
4. 소유 domain·hosting 업체를 정하고 개인정보처리방침·외부 계정 삭제 URL을 준비한다(과금 자원). 그 전에는 서버가 127.0.0.1 loopback이며 공개하지 않는다.
5. Play Console에서 package 등록·Data safety·금융 기능의 NFT award·계정 삭제 URL을 확인하고 제출한다. 에이전트는 승인 없이 입력·제출하지 않는다.
6. 연결된 기기로 실제 카메라 QR 촬영→수령과 오프라인 안내(A01), Reown 복귀·계정 전환(D02/W04), upload-key AAB 설치(A02)를 사람이 직접 조작하며 검증한다.

여전히 승인 전 금지: mainnet, 사용자 자산 이동, 저장소 공개, Play 프로덕션 공개, 대회 최종 제출.

## 다음 세션이 가장 먼저 해야 할 작업

1. `git fetch && git log origin/main -3`, `gh pr list`, `gh issue list`, `gh run list --branch main --limit 3`으로 이 문서와 실제 상태를 대조한다.
2. 소유자 입력이 도착했는지 확인한다. 도착 순서대로 처리한다.
   - **Reown 허용 목록(B-014)**에 `kr.masscom.wolgye`·`kr.masscom.wolgye.dev`가 추가됐으면 `docs/DEVICE_TEST_PLAN.md` E02 → E03의 지갑 세션 부분 → D02 → W04 순으로 실기 재실행. 팀원은 TrustWallet 연결에 성공했으므로(PR #105) 소유자 project 설정 문제로 추정된다
   - **faucet gas**: 위 두 주소에 잔액이 들어왔으면 역할 주소(admin `0x35ee91BBc75778308B9168Ac6c325df8fF408F04`, minter 위 주소, pauser `0x1a050f7c6Fe0dDcDD78554b488d41cFd4A2CcFB6`)로 시뮬레이션 → 소유자가 비밀번호를 입력하는 `--broadcast` → 계약·역할 검증 → `docs/evidence/base-sepolia-deployment.json` 커밋. 그 뒤 Worker 서비스 민터 경로로 시험망 발행 1건을 검증한다
   - **Google OAuth client ID**: 받으면 모바일의 `x-account-id` DEMO 헤더를 Bearer 세션으로 교체하는 Issue를 연다(서버 측은 Issue #106으로 완료, D-024~D-026)
   - upload keystore와 인증서 지문, 호스팅·도메인 결정(`docs/HOSTING_LOGIN_PROPOSAL.md`)
3. 입력이 없으면 새 기능을 시작하지 않는다. 자동화 가능한 운영 로그인·서비스 민터 후속은 모두 병합됐다. 서비스 민터의 다중 민터 지원은 실제 두 번째 민터 요구가 생기기 전에는 추가하지 않는다.
## 실행 명령

```bash
npm test --prefix apps/api
npm run test:postgres --prefix apps/api
npm test --prefix apps/worker
npm run test:postgres --prefix apps/worker
ANVIL_RPC_URL=http://127.0.0.1:8545 npm run test:anvil --prefix apps/worker
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
./scripts/forge.sh test -vvv
bash scripts/check-secrets.sh
bash scripts/check-privacy.sh
bash tests/bootstrap/verify_bootstrap_test.sh
bash tests/site/verify_presentation_test.sh
bash tests/bootstrap/check_pr_korean_test.sh
./scripts/deploy-base-sepolia.sh <keystore-account>            # 시뮬레이션만
./scripts/build-release-aab.sh --restore-dev                   # 운영 AAB 빌드 뒤 개발 프로젝트 복원
```

PostgreSQL 통합·Anvil 시험은 이름이 `_test`로 끝나는 전용 `TEST_DATABASE_URL`만 사용한다. 로컬 시험 DB는 Docker 컨테이너 `masscom-postgres-test`(포트 55432)다. Anvil 시험 전에 `./scripts/anvil.sh --chain-id 31337 --silent`를 실행한다.

## 주의사항

- Worker 실행 entrypoint는 Local Anvil unlocked account 전용이다. 운영 signer 경로로 확대하지 않는다.
- 사용자 개인키·복구 문구·지갑 비밀번호를 요청하거나 저장하지 않는다. 배포자 private key를 환경 변수·명령·저장소·증거에 남기지 않는다.
- debug key로 서명한 AAB는 업로드하지 않는다.
- 앱 수집품과 실제 NFT를 분리하고, NFT 수를 매출 증가로 표현하지 않는다. 실행하지 않은 검증을 PASS로 쓰지 않는다.
- PR 제목·본문은 한국어로 쓰고 `bash scripts/check-pr-korean.sh`를 통과시킨다. 커밋과 PR에 AI 공동 작성자 trailer나 생성 도구 문구를 넣지 않는다.
- 공유 이력 force push, 날짜·작성자 조작, 빈 커밋을 하지 않는다. 브랜치를 바꿔야 하면 새 브랜치와 새 PR로 대체한다.
- ethers v6는 `eth_call`에 대한 모든 JSON-RPC 오류(rate limit·timeout 포함)를 `CALL_EXCEPTION`으로 표시한다. 실제 revert는 반환 `data`가 있을 때만이다. 오류 코드만으로 영구 결함을 판정하지 않는다.
- 위임한 구현이 경합 시험에 `t.skip` 대체 경로를 넣은 적이 있다. 재현되지 않으면 실패해야 하므로 skip을 실패로 바꾸고 반복 실행으로 결정성을 확인한다. 병합 전 `git grep -n "\.skip("`로 확인한다.
- 이 저장소의 shell은 zsh다. `grep --include=*.ts`처럼 따옴표 없는 glob은 오류로 끝나 검색이 실행되지 않는다. 코드 검색은 `git grep`을 쓴다.
- macOS 기본 `awk`에는 `strtonum`이 없고 `keytool` 출력은 한국어로 번역된다. 검사 스크립트는 오류 없이 끝났는지까지 확인한다.
- 지갑 세션의 계정별 분리는 “한 프로세스 안에서 계정이 바뀌지 않는다”는 전제에 선다. WalletConnect Core는 저장소를 프로세스 전역 core에 cache하므로, 운영 로그인으로 실행 중 계정을 바꾸게 되면 AppKit을 계정별 `customStoragePrefix`로 다시 만들거나 앱을 재시작해야 한다(PR #81 리뷰 지적).
- 운영 로그인을 도입해 account ID를 외부에서 정할 수 있게 되면, 계정 삭제의 `campaign_enrollments` 비식별화가 `(campaign_id, 삭제 별칭)` 중복으로 막히지 않는지 먼저 확인한다(PR #74 리뷰 지적).
- npm audit endpoint가 점검 중이면 CI의 audit 단계가 503으로 실패한다. 단계를 우회하지 말고 복구 뒤 다시 실행한다.
