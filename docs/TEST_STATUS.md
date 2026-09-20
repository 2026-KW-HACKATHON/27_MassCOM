# 테스트 상태

상태는 `PASS / FAIL / BLOCKED / NOT_RUN`만 사용합니다. v3 19.1절의 36개 ID를 바꾸거나 재번호화하지 않습니다.

| ID | 구분 | 상태 | 시나리오 | 통과 조건 | 증거 |
| --- | --- | --- | --- | --- | --- |
| Q01 | PostgreSQL 동시성 | PASS | 같은 QR 동시 20요청 | 수령·방문 인정 1회 | 동일 token 20요청에서 `CLAIMED`·방문·첫 보상권 각 1건, 나머지 거절 |
| Q02 | PostgreSQL 동시성 | PASS | QR 만료와 수령 경쟁 | 하나의 최종 상태 | 정확한 만료 시각 동시 20요청에서 `EXPIRED` 한 번 확정, 나머지 거절 |
| Q03 | API 통합 | PASS | QR 재발급 후 이전 코드 사용 | 이전 코드는 거절, 권리 추가 없음 | 같은 slot token 교체, 이전 token 거절, slot 수 1 유지, 실제 HTTP+PostgreSQL 동일 버전 동시 재발급 2요청 중 `200` 1건·`409` 1건 |
| Q04 | PostgreSQL 동시성 | PASS | 단체 일부만 수령 | 사람별 결과 독립, 다른 슬롯 유지 | PostgreSQL 18에서 같은 주문 참조로 3명 발급 → 다른 사람 token 수령 거절, 2명 동시 수령(중복 요청 포함)에 사람별 방문 1·첫 방문 보상 1, 미수령 1명은 `ISSUED`·token 유지 후 만료 시 그 슬롯만 `EXPIRED`. 단체 최대 인원·1인 최소 금액·명단 고정은 v3 제안값이라 미구현 |
| Q05 | 권한 통합 | PASS | 다른 점포 직원·다른 사용자 접근 | 조회·변경 모두 거절 | PostgreSQL 18에서 다른 점포·무소속·철회 계정 조회 403, `CONFIRM_VISIT` 권한 거절, 철회 즉시 반영 |
| R01 | PostgreSQL 동시성 | PASS | 한국 날짜 경계·동시 방문 평가 | 한국 날짜당 진행 최대 1회 | `14:59:59.999Z`와 `15:00:00Z` 경계가 서로 다른 KST 날짜, 같은 날짜 추가 방문은 진행도 미증가 |
| R02 | PostgreSQL 동시성 | PASS | 마지막 캠페인 자리 동시 등록 | 약속한 공급 상한 초과 없음 | 남은 1자리에 서로 다른 계정 20개 동시 등록 → 1건 성공·19건 `CAMPAIGN_FULL`, `enrolled_count`=정원. 같은 계정 동시 중복과 마지막 자리 경합도 자리 1개만 사용 |
| R03 | 도메인·DB | PASS | 같은 목표 반복 평가 | 보상권 하나 | 첫/3/5회 목표만 생성, `(계정, 캠페인, 목표)` 고유 제약과 반복 평가에서 총 3건 유지 |
| W01 | 지갑·API | PASS | 연결만 승인하고 서명 생략 | 미검증 주소, 민팅 불가 | MetaMask 연결 뒤 앱이 `CONNECTED / UNVERIFIED`를 표시했고 주소 확인 전에는 발행 상태가 없음; API 미검증 주소 거절 자동화 PASS |
| W02 | 서명 검증 | PASS | 다른 계정·도메인·체인의 서명 | 거절 | Node HTTP·ethers 실제 서명 PASS |
| W03 | 서명 검증 | PASS | 만료·사용한 nonce 재사용 | 거절 | 5분 만료·단일 소비·replay 409 PASS |
| W04 | Android·지갑 | BLOCKED | 서명 도중 지갑 주소 변경 | 기존 원문·확인 상태 무효 | mismatch 자동화와 Account 1 VERIFIED → Account 2 재연결 UNVERIFIED 격리 PASS. MetaMask 8.11.0은 같은 세션 계정 편집을 제공하지 않아 정확한 서명 중 변경 실기 BLOCKED |
| W05 | Android·지갑 | BLOCKED | 지원하지 않는 스마트 지갑 | 무검증 우회 없이 설명·거절 | 준비된 지갑은 EOA뿐이며 새 지갑 생성·복구 문구 접근 없이 사용할 실제 스마트 지갑 환경 없음 |
| W06 | Android 실기 | PASS | 지갑 미설치·서명 거절·복귀 실패 | 안내와 재시도, 보상권 유지 | 서명·연결 거절 PASS. 미설치 SafePal → Google Play → 수동 앱 복귀·한국어 안내·pending proposal 취소 후 6분 지연 오류 없음 |
| W07 | DB·Worker | PASS | 주소 연결 해제와 전송 경쟁 | 고정 수령인·명확한 작업 상태 | job 생성 뒤 binding을 `DISCONNECTED`로 바꿔도 Local Anvil NFT owner가 요청 시 고정 수령인과 일치 |
| W08 | 배포 빌드 검사 | PASS | SDK 구매·스왑·내장 지갑 기본값 | 배포 빌드에 해당 진입점 없음 | 로컬 production AAB(디버그 키 서명) 정적 검사: 결제 권한·결제/온램프/내장 지갑 SDK 클래스 없음, 운영 package, AppKit 기능 명시적 false(SDK는 onramp 미지정 시 켜짐), `open()`은 Connect view만·SDK 버튼 미렌더링이라 송금 버튼이 있는 계정 화면에 도달 불가, 세션에 거래·blind signing 메서드 없음. 실기기 UI 확인과 upload key 서명본 검사는 아님. `docs/evidence/release-wallet-surface.json` |
| W09 | 요청 경계 | PASS | 예기치 않은 송금·approve 요청 | 앱 요청 경계에서 거절 | allowlist 외 요청 provider 호출 전 거절 PASS |
| M01 | Worker·체인 | PASS | 같은 발급 버튼·Worker 중복 실행 | 온체인 NFT 하나 | 두 Worker 동시 lease에서 한 작업만 실행, 세 job의 reward key별 token 하나·DB asset 하나 |
| M02 | Worker·체인 | PASS | 전송 직후 응답 유실 | 기존 발행 조회, 새 보상 키 금지 | 외부 선발행 뒤 Worker가 `tokenByRewardKey`와 이벤트를 찾아 제출 attempt 없이 복구 |
| M03 | Worker·체인 | PASS | Worker 재시작·nonce 경합 | 순번 충돌·중복 효과 없음 | `SKIP LOCKED` lease 경쟁 한 명만 성공, 만료 lease 재획득과 attempt 고유 제약 PASS |
| M04 | 설정 검증 | PASS | 잘못된 체인·계약 설정 | 전송 전에 차단 | 실제 Anvil에서 RPC chain 불일치·contract code 없음·MINTER role 없음 모두 submit 전 거절 |
| M05 | 이벤트 검증 | PASS | receipt 성공이지만 다른 이벤트 | 완료 처리 거절 | 실제 성공 receipt의 recipient를 job과 다르게 대조해 `MINT_EVENT_MISMATCH` 거절 |
| M06 | 인덱서·체인 | PASS | 이벤트 반복 수집·재조직 | 중복 없음, 확정 전 되돌림 가능 | 동일 이벤트 반복 finalize가 event/asset 하나 유지; confirmations=2에서 미확정 이벤트 거절 후 Anvil snapshot revert에서 미발행으로 복귀 |
| M07 | DB·Worker | PASS | 민팅 도중 프로필 지갑 변경 | 이미 고정한 수령인 유지 | binding 해제/새 버전과 무관하게 job recipient·실제 owner 동일 |
| M08 | 복원 | PASS | DB 백업 복원 후 재처리 | 기존 NFT를 다시 발행하지 않음 | 로컬 asset/event 행 제거 뒤 기존 reward key/token #1을 조회해 attempt 0으로 자산·이벤트 복원 |
| C01 | Foundry 계약 | PASS | 비민터 발행·민터 권한 상승 | 계약에서 거절 | 비민터 mint와 MINTER의 admin grant 모두 `AccessControlUnauthorizedAccount` |
| C02 | Foundry 속성 | PASS | 누적 상한 경계·중복 발행 키 | 상한·일회성 유지 | cap+1·중복 rewardKey 거절, 128회 fuzz에서 `everMinted ≤ maxEverMinted` |
| C03 | Foundry 계약 | PASS | 모든 전송·우회 경로 | 잠긴 NFT는 이전 불가 | approve·setApprovalForAll·transferFrom·safeTransferFrom 2종과 내부 `_update` 거절 |
| C04 | Foundry 계약 | PASS | 시리즈 활성화 후 조건 변경 | 동결된 값 변경 불가 | 비활성 mint 거절, 중복 생성·재활성화 거절, 설정 변경 함수 없음 |
| D01 | API·Worker | PASS | 발급 중 탈퇴 | 미전송·제출됨을 구분 | 동시 10요청 하나로 수렴, 미전송 1건 `CANCELLED`, 제출 1건 결과 대기, 확정 NFT 1건 보존, 원 account ID 참조 0 |
| D02 | Android·API | NOT_RUN | 계정 전환·캐시 복구 | 이전 사용자 데이터 미노출 | 구현과 자동 시험은 PASS(Issue #80): API 모든 응답 `Cache-Control: no-store`, 지갑 세션 저장 key 계정별 분리, 시작 시 다른 계정 세션 제거, 모든 계정 화면 remount. 운영 로그인이 없어 Android 실기 계정 전환은 실행하지 못했으므로 상태는 `NOT_RUN` 유지 |
| D03 | 정적·통합 검사 | PASS | 로그·분석·메타데이터 검사 | 개인키·QR·개인 식별자 누출 없음 | 민감 console 인자·미검토 analytics SDK gate와 fixture PASS, raw API error 객체 로그 제거; 외부 운영 로그는 NOT_RUN |
| A01 | Android 실기 | NOT_RUN | 카메라 권한 거절·오프라인 | 수동 코드·정확한 상태 표시 | QR 화면 미구현 |
| A02 | Android 릴리스 | NOT_RUN | 실제 AAB·16KB·앱 링크 | 설치·실행·복귀 정상 | debug APK 부분 PASS, release NOT_RUN |
| O01 | 환경 권한 | NOT_RUN | 시연 권리로 운영 API 접근 | 환경 경계에서 거절 | 운영 환경 미구현 |
| O02 | 장애·복원 | PASS | RPC·민터 잔액·DB 장애 | 보상권 보존·중지·복구 절차 동작 | Local Anvil·Docker PostgreSQL: RPC 연결 불가 `RPC_UNAVAILABLE`, 계약 중지 `MINT_PAUSED`, 민터 잔액 0 `MINTER_BALANCE_LOW` 모두 `RETRYABLE`·전송 시도 0·보상권 불변, 복구 뒤 NFT 1개. code는 있지만 인터페이스가 다른 계약은 `CONTRACT_INTERFACE_MISMATCH`로 `MANUAL_REVIEW`. DB 연결 불가는 체인 호출 0건·작업 불변. 운영 RPC·실제 운영 DB 장애는 `NOT_RUN` |

## 실행 기록

| 시각 | 커밋 | 명령 | 환경 | 결과 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-18 KST | `92d8029` | GitHub Actions `bootstrap-contract` | Ubuntu | PASS | PR #2 run `35282893247` |
| 2026-09-18 KST | `5688a5d` | 포털 구조·접근성·axe | macOS·headless Chrome | PASS | PR #6 evidence |
| 2026-09-18 KST | `6ec754b` | API 15개·모바일 11개·Android debug | Node·Expo·Android 16 AVD | PASS | PR #10 evidence |
| 2026-09-18 KST | `dc87855` | GitHub Actions 전체 CI | Ubuntu·Node 24.10.0 | PASS | PR #10 run `35293207033` |
| 2026-09-18 KST | `a9aacb6` | `npm test --prefix apps/api` | macOS·Node 25.9.0 | PASS 16/16 | 같은 명령 재실행 |
| 2026-09-18 KST | `a9aacb6` | `npm run test:postgres --prefix apps/api` | PostgreSQL 18 Alpine·Docker 27.3.1 | PASS 1/1 | `_test` 전용 `TEST_DATABASE_URL`을 실제 PostgreSQL에 지정 |
| 2026-09-18 KST | `a9aacb6` | API typecheck·build·production audit | TypeScript 6·npm | PASS, production 취약점 0 | package scripts 재실행 |
| 2026-09-18 KST | `4066b95` | GitHub Actions 전체 CI | Ubuntu·Node 24.10.0·PostgreSQL 18 | PASS, 2분 3초 | PR #14 run `35299748690` |
| 2026-09-18 KST | `a27d0d0` | GitHub Actions 전체 CI | Ubuntu·Node 24.10.0·PostgreSQL 18 | PASS, 2분 1초 | main run `35300158651` |
| 2026-09-18 KST | `1549938` | `npm test --prefix apps/api` | macOS·Node 25.9.0 | PASS 19/19 | 같은 명령 재실행 |
| 2026-09-18 KST | `1549938` | `npm run test:postgres --prefix apps/api` | PostgreSQL 18 Alpine·Docker 27.3.1 | PASS 2/2, Q05 포함 | `_test` 전용 `TEST_DATABASE_URL` 지정 |
| 2026-09-18 KST | `1549938` | API typecheck·build | TypeScript 6·npm | PASS | package scripts 재실행 |
| 2026-09-18 KST | `7442cff` | `npm test --prefix apps/api` | macOS·Node 25.9.0 | PASS 25/25 | 같은 명령 재실행 |
| 2026-09-18 KST | `7442cff` | `npm run test:postgres --prefix apps/api` | PostgreSQL 18 Alpine·Docker 27.3.1 | PASS 3/3, Q02·Q03 포함 | `_test` 전용 `TEST_DATABASE_URL` 지정 |
| 2026-09-18 KST | `7442cff` | 동일 token 소비·만료 경합 각 20요청 | PostgreSQL 18 Alpine | PASS | claim slot 통합 시험 재실행 |
| 2026-09-18 KST | `6823119` | API 25개·PostgreSQL 3개·typecheck·build·production audit | Node 25.9.0·PostgreSQL 18 Alpine | PASS, production 취약점 0 | HMAC 저장과 `tokenVersion` 동시 재발급 회귀 포함 |
| 2026-09-18 KST | `3eb9e5a` | API 25개·PostgreSQL 4개·Q01·R01·R03·typecheck·build·production audit | Node 25.9.0·PostgreSQL 18 Alpine | PASS, production 취약점 0 | 슬롯·방문·보상권 원자 처리와 캠페인 부재 전체 롤백 포함 |
| 2026-09-18 KST | `158067c` | debug APK 빌드·설치·Metro 실행·홈 복귀·콜드 스타트 | Samsung SM-S928N·Android 16·MetaMask 8.11.0 | 앱 실기 부분 PASS, W06 BLOCKED | `docs/evidence/android-physical-device.json`과 스크린샷; 지갑 생성·서명 미수행 |
| 2026-09-18 KST | PR #26 HEAD | 모바일 19개·typecheck·lint·Expo doctor·Android export·실제 MetaMask 흐름 | Samsung SM-S928N·Android 16·MetaMask 8.11.0·Base Sepolia | 자동화 PASS, 연결·체인 승인·`personal_sign`·서버 `VERIFIED`·콜드 재시작 PASS, W01 PASS | `docs/evidence/android-wallet-connection.json`; 주소·서명·세션 토픽·기기 일련번호 미기록 |
| 2026-09-18 KST | `bdeade4`, main CI `35319672490` | 모바일 19개·API 25개·PostgreSQL 통합·typecheck·lint·Android export·비밀 검사 | GitHub Actions Ubuntu·PostgreSQL 18 | PASS, Claude·Astra 검토 지적 반영 | PR #26·#28 merge; W04·W05·W06 잔여 실기는 `NOT_RUN` 유지 |
| 2026-09-18 KST | `a4dc155`, PR #32 | 모바일 21개·typecheck·lint·실제 MetaMask 서명·연결 거절 | Samsung SM-S928N·Android 16·MetaMask 8.11.0, macOS | 자동화·서명 거절 PASS; 연결 거절 후 수동 앱 복귀와 보존 안내 PASS, 자동 딥링크 복귀 NOT_RUN | Issue #31·PR #32; `docs/evidence/android-wallet-connection.json` |
| 2026-09-19 KST | `1dba58f`, PR #34 | 모바일 22개·typecheck·lint·미설치 Trust Wallet·Google Play 이동·수동 앱 복귀·제안 만료 대기 | Samsung SM-S928N·Android 16, macOS | 즉시 UI PASS, 지연 `Uncaught Proposal expired`로 W06 FAIL; 같은 원인 2회 이상 재현 후 중단 | Issue #33·#35, `docs/evidence/android-wallet-missing.json` |
| 2026-09-19 KST | `bff7c68`, PR #38 | clean npm ci patch 적용·모바일 24개·typecheck·lint·Android export·미설치 SafePal·6분 만료 회귀 | Samsung SM-S928N·Android 16, macOS | W06 PASS; 추가 `Proposal expired`·`Uncaught`·자산 요청 없음 | Issue #35, `docs/evidence/android-wallet-missing.json` |
| 2026-09-19 KST | `dbab97f`, Issue #40 | Account 1 VERIFIED·disconnect·Account 2 재연결 UNVERIFIED·MetaMask 연결 관리 확인 | Samsung SM-S928N·Android 16·MetaMask 8.11.0 | 계정별 검증 격리 PASS, 정확한 동일 세션 주소 변경은 BLOCKED | `docs/evidence/android-wallet-address-change.json` |
| 2026-09-19 KST | `935e6d5`, PR #45 | 모바일 32개·typecheck·lint·Android export·목록→상세→선택적 지갑·콜드 재시작 | Samsung SM-S928N·Android 16·PostgreSQL 18 DEMO 3곳 | PASS, 외부 HTTPS `NOT_RUN` | `docs/evidence/android-merchant-discovery.json`; 실제 협약 점포·지갑 주소·기기 일련번호 미기록 |
| 2026-09-19 KST | `16c9cf4`, PR #46 | API 27개·PostgreSQL 5개·모바일 40개·Android export·점주 발급→고객 수령→도감·중복 수령 | Samsung SM-S928N·Android 16·PostgreSQL 18 loopback DEMO | PASS, 중복 HTTP 409·효과 1:1 유지; 카메라 QR `NOT_RUN` | `docs/evidence/android-claim-collection.json`; 노출된 DEMO token 버전 즉시 폐기, 원문 저장소 미기록 |
| 2026-09-19 KST | `0af854a`, PR #47 | API 31개·PostgreSQL 6개·모바일 43개·Android export·추천 순서/이유/정원 제외→상세 | Samsung SM-S928N·Android 16·PostgreSQL 18 loopback DEMO | PASS, 현장 사용자 행동·외부 HTTPS `NOT_RUN` | `docs/evidence/android-recommendations.json`; 미방문 2·방문 1·정원 마감 1 DEMO fixture |
| 2026-09-19 KST | `e6aae59`, PR #49 | Foundry fmt·build·lint·8 tests·128 fuzz, Anvil deploy→series→mint→owner/locked/event | Foundry 1.8.3 Docker·Solidity 0.8.24·Anvil chain 31337 | C01~C04 PASS, Base Sepolia `BLOCKED` | `docs/evidence/foundry-contract-local.json`; private key·mnemonic 미기록 |
| 2026-09-19 KST | `14e6eab`, PR #50 | API 34개·PostgreSQL 8개·모바일 44개·동일 mint request 20개·binding 주소 변경 | PostgreSQL 18 Alpine·Node·Expo | 원자 job/Outbox·replay 19·수령인 고정 PASS; W07·M01·M07 전체는 Worker 전까지 `NOT_RUN` | `docs/evidence/mint-request-outbox.json`; reward key API/Outbox 미노출 |
| 2026-09-19 KST | `7ca3c72`·`d4597cd`, PR #51 | Worker 6개·Worker PostgreSQL 1개·Anvil W07/M01~M08·API 34개·API PostgreSQL 8개·모바일 45개·Foundry 8개/fuzz128·Android export·secret/portal | Node 25.9.0·PostgreSQL 18 Alpine·Foundry 1.8.3·Anvil 31337·Samsung SM-S928N Android 16 | PASS; Android 접수→등록 완료와 기존 token #1 attempt 0 복구, 30ms lease heartbeat·소유권 상실 전송 차단 PASS, Base Sepolia `BLOCKED` | `docs/evidence/phase3-worker-anvil-android.json`; 공개 Anvil 시험 주소만 기록, private key·mnemonic 미기록 |
| 2026-09-19 KST | `75aedae`, PR #53 | API 35개·PostgreSQL 10개·모바일 48개·privacy/secret gate·Android export·계정 삭제 실기 | PostgreSQL 18 Alpine·Node 25.9.0·Expo 57·Samsung SM-S928N Android 16 | D01·D03 PASS, D02 NOT_RUN; 운영 재인증·외부 삭제 URL·서명 AAB 미완료 | `docs/evidence/account-deletion-privacy.json`; Local DEMO 계정만 사용 |
| 2026-09-20 KST | `f438cd4`, PR #55 | 발표 HTML 접근성·desktop/mobile·evidence manifest·unsupported-claim gate | Playwright 1440×900·390×844, Node·shell | PASS; 현장·리허설·영상·공개/제출은 NOT_RUN | `docs/evidence/presentation-visual-verdict.json`, `docs/SUBMISSION_EVIDENCE.json` |
| 2026-09-20 KST | `bcc97b4`, PR #57, main CI `35455419805` | API 35·PostgreSQL 14·Worker 8·Worker PG 4·Anvil·Foundry·mobile 48·catalog/secret/presentation gates | Node 25.9.0·PostgreSQL 18·Anvil 31337·Foundry 1.8.3·GitHub Actions | HIGH 3 RED→GREEN, PR·main CI PASS, required test 상태 합계는 26/2/8 유지 | `docs/evidence/security-audit-issue-56.json`, `docs/SECURITY_AUDIT_2026-09-20.md`; 운영 MEDIUM 별도 |
| 2026-09-20 KST | `6bbf58c`, PR #63, main CI `35458855491` | Worker PG 5·Anvil W07/M01~M08·cursor fallback 회귀 | macOS·Docker PostgreSQL 18·Anvil·GitHub Actions | cursor 없음/하한/margin 계산과 오래된 reward 이벤트 fallback PASS, `CHAIN_REORG_MARGIN` 기본 12 | Issue #59; 운영 체인 margin 재판정 필요 |
| 2026-09-20 KST | `695210c`, PR #64, main CI `35459019638` | Worker 재시도 지수 backoff·전송 시도 5회 MANUAL_REVIEW 회귀 | macOS·Docker PostgreSQL 18·Anvil·GitHub Actions | 1초→최대 5분 backoff와 5회 도달 시 `RETRY_LIMIT_EXCEEDED` MANUAL_REVIEW PASS | Issue #61 |
| 2026-09-20 KST | `4c4d744`, PR #65, main CI `35459313304` | Expo 57.0.24·expo-router 57.0.22·@expo/ui 57.0.19 의존성 갱신·모바일 회귀 | macOS·Docker PostgreSQL 18·Anvil·GitHub Actions | 갱신 후 모바일 회귀 PASS, moderate 권고 14건 유지 B-008 | 의존성 업그레이드 PR |
| 2026-09-20 KST | `9c3c04a`, PR #67, main CI `35460087002` | SIWE challenge PostgreSQL 이전·`wallet_challenges` migration 0008·원자적 claim | macOS·Docker PostgreSQL 18·Anvil·GitHub Actions | `DATABASE_URL` 있으면 PostgreSQL 저장, 없으면 DEMO 메모리 저장소로 대체 PASS | Issue #66 |
| 2026-09-20 KST | `f386c84`, PR #68, main CI `35460432649` | 문서 갱신 회귀 | macOS·Docker PostgreSQL 18·Anvil·GitHub Actions | 문서 링크·상태 정합 PASS | 문서 PR |
| 2026-09-20 KST | `a83cef9`, PR #69, main CI `35486460953` | `DeployBaseSepolia.s.sol`·`deploy-base-sepolia.sh` 시뮬레이션·계정 삭제 시 지갑 세션 제거·Play Console 초안 | macOS·Docker PostgreSQL 18·Anvil·GitHub Actions | 암호화 keystore 전용 실체인 시뮬레이션만 PASS, 실제 브로드캐스트 `NOT_RUN` | `docs/PLAY_CONSOLE_DRAFT.md`, `docs/evidence/release-aab-16kb-alignment.json` |
| 2026-09-20 KST | `9e670ab`, PR #70, main CI `35487020999` | 운영 package ID `kr.masscom.wolgye`·`APP_VARIANT`·`build-release-aab.sh`·upload key 서명 배관 | macOS·Docker PostgreSQL 18·Anvil·GitHub Actions | 로컬 debug 서명 운영 AAB의 package·권한·16KB 정렬 48개 PASS, upload key 서명·Play 제출 `NOT_RUN` | Issue #70 |
| 2026-09-20 KST | `ecf8015`, Issue #73 | `npm run test:postgres --prefix apps/api`(27개, R02 7개 포함)·API 단위 40개·Worker PostgreSQL 6개 회귀 | macOS·Docker PostgreSQL 18 | PASS | R02 `NOT_RUN`→`PASS`. 마지막 자리 동일 계정 경합 시험은 수정 전 `CAMPAIGN_FULL` 실패를 확인한 뒤 통과. PR·CI 번호는 PR 본문과 HANDOFF에 기록 |
| 2026-09-20 KST | Issue #75 | `npm test --prefix apps/api`(41개) | macOS | PASS | 잘못된 percent-encoding 경로 값을 8개 라우트 공통 helper로 400 `INVALID_PATH_PARAMETER` 처리. 신규 시험은 수정 전 500으로 실패함을 확인 |
| 2026-09-20 KST | `438484f`, Issue #77 | Worker 단위 14개·PostgreSQL 7개·Anvil 5개(W07 + O02a/b/c/d) | macOS·Docker PostgreSQL 18·Anvil 31337 | PASS | O02 `NOT_RUN`→`PASS`. RPC 중단 시험은 수정 전 `MANUAL_REVIEW`로, 다른 인터페이스 계약 시험(O02d)은 분류 수정 전 `RETRYABLE`로 실패함을 확인. 기존 lease 재확인 시험의 기대값은 변경 없음 |
| 2026-09-20 KST | Issue #80 | API 단위 42개·모바일 단위 54개·typecheck·lint·Android export | macOS | PASS | D02 자동 시험만 PASS, 실기 계정 전환은 `NOT_RUN`이라 D02 상태는 유지. `no-store` 시험은 기존 동작을 고정하는 회귀 시험 |
| 2026-09-20 KST | `e1c58a0`, Issue #78 | Worker 단위 16개·PostgreSQL 11개·Anvil 6개(O02e 포함, skip 없이 8회 반복)·API PostgreSQL 27개(migration 0010 회귀) | macOS·Docker PostgreSQL 18·Anvil 31337 | PASS | 전송 전 장애의 지수 backoff와 전송 직후 중지로 revert된 거래의 재시도 분류. 기존 시험 기대값 변경 없음. 필수 36개 상태 변동 없음 |
| 2026-09-20 KST | Issue #84 | `npm run test:postgres --prefix apps/api`(28개, Q04 1개 추가)·presentation gate | macOS·Docker PostgreSQL 18 | PASS | Q04 `NOT_RUN`→`PASS`. 기존 모델 실증이라 수정 전 실패가 없으므로, redeem의 소유자 조건을 임시로 제거해 시험이 실패하는 것을 확인한 뒤 되돌림. 발표 첫 화면 집계 검사는 오래된 수치에서 실패를 확인한 뒤 통과 |
| 2026-09-20 KST | `367f26b`, Issue #86 | `scripts/build-release-aab.sh` → `scripts/check-release-wallet-surface.sh <aab>`, `tests/release/check_release_wallet_surface_test.sh` | macOS·Gradle bundleRelease·로컬 debug 서명 | PASS | W08 `NOT_RUN`→`PASS`. 위반 12종(리뷰가 지적한 open 이름 변경·여러 줄 view·내부 controller import·methods 블록 미인식 포함)을 심은 입력에서 각각 해당 사유로 실패함을 확인. AAB는 업로드·커밋하지 않음 |

Phase 2 카탈로그 통합 테스트 자체는 QR·방문 시험과 분리되어 있습니다. Q01~Q05·R01·R02·R03은 실제 PostgreSQL 동시성·권한·원자성 증거로만 `PASS` 처리했습니다. Q04는 사람별 슬롯 독립성만 실증했으며 단체 인원·금액 한도 정책은 구현하지 않았습니다. Phase 3의 W07·M01~M08은 로컬 Anvil·PostgreSQL·실기기 증거이며 Base Sepolia나 운영 배포 성공을 뜻하지 않습니다.
