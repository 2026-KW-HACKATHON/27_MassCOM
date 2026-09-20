# HANDOFF

마지막 갱신 시각: 2026-09-20 KST
기준 브랜치: `main`
기준 커밋 SHA: `761ac42d1b4f1603c0a7cf96523a87b19a59ba0a` (PR #72 merge, main CI run `35487858774` PASS). 이 문서를 담은 Issue #73 PR이 병합되면 그 merge 커밋이 새 기준이며, 실제 값은 `git log origin/main -1`로 확인한다.

새 세션이나 다른 계정은 Phase 0을 반복하지 말고 아래 “다음 세션이 가장 먼저 해야 할 작업”부터 이어간다. 문서와 GitHub가 다르면 실제 commit·merge 기록을 따른다.

## 이번 세션에서 완료한 것

- Issue #59: 체인 cursor에서 `CHAIN_REORG_MARGIN`만큼 되돌아가 조회하고, 못 찾으면 배포 기준 블록까지 다시 조회. cursor 조회 실패는 `CHAIN_CURSOR_READ_FAILED` 재시도 오류. ethers 요청 cache 때문에 Anvil에서 간헐적으로 30초 대기하던 원인 제거
- Issue #61: Worker 재시도 지수 backoff(1초→최대 5분)와 전송 시도 5회 도달 시 `MANUAL_REVIEW`(`RETRY_LIMIT_EXCEEDED`) 전환. migration 없음
- Expo 57.0.24·expo-router 57.0.22·@expo/ui 57.0.19 patch 적용. 모바일 moderate 권고 14건은 upstream 수정이 없어 B-008 유지
- Issue #66: SIWE challenge를 PostgreSQL `wallet_challenges`(migration 0008)에 저장, 원자적 claim, 만료 정리. 보안 리뷰 지적 반영: binding 기록 뒤 nonce를 되돌리지 않아 서명 재사용 차단, 계정 삭제 transaction 안에서 challenge 제거
- Base Sepolia keystore 전용 배포 스크립트와 실체인 시뮬레이션 PASS(전송 없음). 계정 삭제가 접수되면 앱이 지갑 연결을 끊고 기기의 WalletConnect 세션 제거(D-021)
- 운영 package ID `kr.masscom.wolgye`(D-022)와 개발 variant 분리, `scripts/build-release-aab.sh`, 로컬 debug 서명 운영 AAB에서 package·scheme·overlay 권한 제거·16KB 정렬 48개 PASS
- Google Play Console 제출 초안 `docs/PLAY_CONSOLE_DRAFT.md`(입력·제출 없음)
- Issue #73: `POST /campaigns/:id/enrollments` 캠페인 참여 등록과 정원 원자 예약(migration 0009). 필수 테스트 R02를 실제 PostgreSQL 동시성 증거로 `NOT_RUN`→`PASS` 전환. 같은 계정의 마지막 자리 경합에서 정원 마감으로 잘못 거절하던 빈틈을 결정적 재현 시험으로 확인해 수정
- Issue #71: README·앱별 README·`.env.example`·EVALUATION_MAP·SUBMISSION_EVIDENCE·TEST_STATUS·PROJECT_STATE·HANDOFF를 실제 병합 상태에 맞춤

## 생성한 Issue

- #61 Worker 재시도 상한과 지수 backoff (종료)
- #66 SIWE challenge PostgreSQL 공유 저장소 (종료)
- #71 9월 20일 병합분 문서 정합 (종료)
- #73 캠페인 참여 등록과 정원 원자 예약 R02 (이 문서를 담은 PR로 종료)
- #75 잘못된 경로 인코딩을 400으로 거절 (열림, 다음 작업 후보)
- #65·#69·#70 작업은 Issue 없이 진행했다. 이후 작업은 Issue를 먼저 만든다.

## 생성한 브랜치

- `feat/59-chain-cursor-restart`, `feat/61-worker-retry-limit`, `chore/expo-patch-advisory-recheck`, `feat/66-siwe-challenge-postgres`, `docs/66-closeout`, `feat/base-sepolia-deploy-script`, `feat/release-package-id`, `docs/71-state-sync`, `feat/73-campaign-enrollment`
- 남아 있는 원격 브랜치 `feat/59-chain-cursor-read`, `feat/61-worker-retry-cap`은 같은 내용을 새 브랜치로 대체한 뒤 닫은 PR #60·#62의 것이다. main에 병합되지 않았으며 삭제 여부는 소유자가 정한다.

## 생성한 PR

- #63, #64, #65, #67, #68, #69, #70, #72 (모두 병합), Issue #73 PR
- #60·#62는 #63·#64로 대체하고 닫았다.

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

코드 PR은 서로 다른 모델의 독립 리뷰에서 CRITICAL·HIGH 0을 확인한 뒤 병합했다. #63·#67·#69는 두 모델, #64·#65·#70은 단일 모델 리뷰(지적 반영 뒤 재리뷰)로 병합했다.

## 실행한 테스트

- API 단위 `40/40`, API PostgreSQL `27/27`(R02 7개 포함)
- Worker 단위 `8/8`, Worker PostgreSQL `6/6`, Anvil `W07 M01~M08 PASS`(수정 뒤 6회 연속)
- 모바일 `50/50`, typecheck·lint·Android export PASS
- Foundry `8/8`, fuzz 128, fmt·build·lint PASS
- 실제 Base Sepolia RPC 배포 시뮬레이션 PASS(전송 없음), 잘못된 체인·중복 역할 거절 PASS
- 운영 variant `bundleRelease`와 ELF `PT_LOAD` 정렬 검사 PASS(debug 서명)
- secret·privacy·bootstrap·portal·presentation verifier PASS
- 필수 36개 `27 PASS / 2 BLOCKED / 7 NOT_RUN`(R02 전환)
- `NOT_RUN`: 실제 Base Sepolia 배포, upload key 서명 AAB, 16KB 기기 설치, Android 실기 회귀(Expo patch·새 package와 scheme·계정 삭제 뒤 세션 복원 여부), Play Console

## 현재 열린 PR

- Issue #73 캠페인 참여 등록 PR 하나. 병합되면 열린 PR은 없다.

## 현재 작업 중인 기능

- 없음. 로컬에만 있고 원격에 없는 변경도 없다. `apps/mobile/android`는 gitignore된 생성물이며 현재 개발 variant(`kr.masscom.wolgye.dev`)로 생성돼 있다.

## BLOCKER

- B-002 저장소 공개 전환: 명시 승인 필요
- B-003 외부 HTTPS·유료 클라우드: 소유 domain·hosting·계정 필요
- B-004 Google Play 정책·국내 분류 공식 확인
- B-008 모바일 moderate 권고 14건: Expo upstream 수정 대기
- B-010·B-011 W04·W05용 실제 지갑 환경 부재
- B-012 Base Sepolia: 소유자가 만든 keystore 계정과 faucet gas 필요
- B-013 운영 로그인 재인증과 외부 삭제 URL 부재

## 사용자 승인이 필요한 사항

승인된 것(D-019~D-022): SIWE PostgreSQL 저장소, 외부 HTTPS·Base Sepolia·release AAB·Google Play 준비, 기기 세션 저장 정책, 운영 package ID. Codex는 사용하지 않는다.

소유자가 직접 해야 하는 것(대신 수행하지 않음):

1. Foundry 설치, `cast wallet import masscom-base-sepolia --interactive`로 자산 없는 전용 계정 생성, faucet gas 수령, 역할 주소 3개 결정, `--broadcast` 실행
2. upload keystore 생성과 `~/.gradle/gradle.properties`의 `android.injected.signing.*` 설정
3. 소유 domain·hosting 업체·운영 로그인 방식 결정(과금 자원)
4. Play Console 로그인, package 이름 등록, 양식 제출
5. Android 실기 회귀

여전히 승인 전 금지: mainnet, 사용자 자산 이동, 저장소 공개, Play 프로덕션 공개, 대회 최종 제출.

## 다음 세션이 가장 먼저 해야 할 작업

1. `git fetch && git log origin/main -3`, `gh pr list`, `gh issue list`, `gh run list --branch main --limit 3`으로 이 문서와 실제 상태를 대조한다.
2. Issue #73 PR이 열려 있으면 CI와 리뷰를 확인해 병합한다.
3. 소유자 입력이 도착했는지 확인한다. Base Sepolia 배포 결과(계약 주소·거래 hash)가 있으면 증거 json과 B-012·TEST_STATUS를 갱신한다. domain이 정해졌으면 `assetlinks.json`, 외부 계정 삭제 페이지, 개인정보처리방침 페이지를 Issue부터 만들어 진행한다.
4. Issue #75(경로 인코딩 400)를 처리한다.
5. 입력이 없으면 로컬에서 검증 가능한 남은 필수 테스트를 Issue로 만들어 진행한다(가치·위험 순): O02 RPC·민터 잔액·DB 장애 시 보상권 보존과 복구(발행 로직이라 두 모델 교차 리뷰), D02 계정 전환 시 이전 사용자 데이터 미노출(모바일), Q04 단체 QR 부분 수령(보상 규칙과 닿으므로 D-006과 충돌 여부 먼저 확인), O01 시연·운영 환경 경계(인가 모델 확장이라 착수 전 소유자 확인). Android 캠페인 참여 화면과 “수령 시 등록 요구” 여부는 보상 규칙 결정이 필요해 소유자에게 묻는다. A02·W04·W05는 외부 입력 없이는 진행할 수 없다.

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
- macOS 기본 `awk`에는 `strtonum`이 없고 `keytool` 출력은 한국어로 번역된다. 검사 스크립트는 오류 없이 끝났는지까지 확인한다.
- 운영 로그인을 도입해 account ID를 외부에서 정할 수 있게 되면, 계정 삭제의 `campaign_enrollments` 비식별화가 `(campaign_id, 삭제 별칭)` 중복으로 막히지 않는지 먼저 확인한다(PR #74 리뷰 지적).
- npm audit endpoint가 점검 중이면 CI의 audit 단계가 503으로 실패한다. 단계를 우회하지 말고 복구 뒤 다시 실행한다.
