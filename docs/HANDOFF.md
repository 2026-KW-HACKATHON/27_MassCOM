# HANDOFF

마지막 갱신 시각: 2026-09-19 KST

기준 브랜치: `feat/phase3-mint-outbox`

검증 기준 커밋 SHA: `14e6eab`, PR #50 CI 대기

현재 작업: Phase 3 두 번째 묶음 wallet binding·mint request·Outbox PR #50; Issue #48 유지

## 이번 세션에서 완료한 것

- 사용자 최신 요청으로 Phase 3 이후 로컬 구현·검증 범위를 재개하고 외부 승인 경계 유지
- Solidity 0.8.24·OpenZeppelin 5.7.0·Foundry 1.8.3 toolchain 고정
- ERC-721/ERC-5192 영구 잠금, 역할 분리, series cap, reward key 단일 소비 계약 구현
- C01~C04 Foundry 8/8·fuzz 128 PASS
- private key 없는 Anvil unlocked 계정으로 chain 31337 배포·시리즈·mint·owner·locked·이벤트 PASS
- Issue #48과 PR #49 생성, API 31개·모바일 43개 회귀 PASS
- PR #49 merge `25cf801`, main CI run `35444126068` PASS
- SIWE 성공 주소를 버전된 PostgreSQL wallet binding으로 영속화
- mint request가 보상권·고정 수령인 job·Outbox를 원자 생성하고 동일 요청 20개를 job 하나로 수렴
- 주소 변경 뒤 기존 job의 recipient·binding version 유지 PASS
- PR #50 생성, API 34개·PostgreSQL 8개·모바일 44개·Android export PASS
- 과도한 PR 분할을 피하도록 Phase 2를 3개 기능 PR로 고정하고 상태 전용 PR을 금지
- 공개 API 설정을 Reown 지갑 설정과 분리해 지갑 없이 `/` 음식점 목록 사용
- `GET /merchants` 응답 런타임 검증과 loading/error/empty/content/refresh 상태 구현
- 음식점 상세에 주소·최소 이용금액·캠페인 기간·정원·1/3/5회 고정 보상 표시
- 기존 Phase 1 지갑 화면을 선택 경로 `/wallet`로 이동
- Samsung Android 16에서 DEMO 3곳 목록→상세→지갑 이동과 콜드 재시작 PASS
- PR #45 생성, 모바일 32개·typecheck·lint·Android export·비밀 검사 PASS
- PR #45 merge `ffc1525`, main CI run `35424531021` PASS
- PostgreSQL 도감 조회 API와 방문·앱 수집품·NFT 상태 분리 구현
- 점주 STAFF 권한→1회 코드→고객 preview/redeem→도감 Android 실기 PASS
- 중복 redeem HTTP 409, 방문·보상권 1:1 유지 PASS
- PR #46 생성, API 27개·PostgreSQL 5개·모바일 40개·typecheck·lint·Android export PASS
- PR #46 merge `dadac5c`, main CI run `35425582837` PASS
- 정원 마감 제외·미방문 우선·다음 보상 이유·한국 날짜별 회전 추천 구현
- Android에서 미방문 2곳→방문 1곳 순서와 추천→상세 복귀 PASS
- PR #47 생성, API 31개·PostgreSQL 6개·모바일 43개·전체 정적/번들/포털 검사 PASS
- PR #26 merge `782fef6`, Issue #25 종료, main CI run `35317894775` PASS 확인
- PR #28 merge `bdeade4`, Issue #27 종료, main CI run `35319672490` PASS 확인
- Reown project ID와 사용자가 준비·잠금 해제한 MetaMask로 WalletConnect 연결 승인
- 승인된 Mainnet 세션을 `CONNECTED / CHECK_REQUIRED`로 표시하고 Base Sepolia 전환 경로 복구
- MetaMask에 사용자 승인으로 Base Sepolia 공개 네트워크를 추가하고 체인 승인
- 읽을 수 있는 `personal_sign`만 요청해 서버 주소 확인 `VERIFIED`
- 프로세스 종료 후 세션은 복원되고 주소 확인은 `UNVERIFIED`로 초기화됨을 확인
- UniversalProvider 2.21.10 초기 체인 이벤트 경쟁을 재현하고 2.23.5 override 회귀 테스트 추가
- EIP-1193 `4001`, WalletConnect `5000`~`5003`, Reown 체인 전환 거절 변환을 취소 상태로 정규화
- 실제 서명 거절 뒤 앱이 `UNVERIFIED`와 방문 기록·받을 수집품 보존 안내로 복귀함을 확인
- Reown 연결 거절 `USER_REJECTED` 이벤트를 앱 취소 상태로 반영하는 Issue #31·PR #32 작성
- SDK 체인 전환 성공·4001 변환·4902 전파에서 `wallet_addEthereumChain` 미요청 특성화 테스트 추가
- Claude Code와 Astra high 독립 검증 후 HIGH·MEDIUM 0건 확인
- Trust Wallet 미설치·Google Play 이동·수동 앱 복귀를 실기 검증하고 앱 자체 한국어 재시도·보존 안내 추가

## 종료한 Issue

- #25 `test: 실제 MetaMask 연결과 주소 확인 서명을 검증한다`
- #27 `fix: 지갑 연결 거절을 취소 상태로 정규화한다`
- #31 `fix: 지갑 연결 거절 이벤트를 앱 취소 상태에 반영한다`
- #33 `test: 미설치 지갑 선택과 앱 복귀 안내를 실기 검증한다`

## 통합한 작업 브랜치

- `test/25-wallet-device`
- `fix/27-wallet-connection-rejection`
- `fix/31-wallet-rejection-event`
- `test/33-wallet-missing-return`

## Phase 1에서 merge된 PR

- #14, merge commit `a27d0d0`
- #16, merge commit `240dad2`
- #18, merge commit `e242c99`
- #20, merge commit `c2f3076`
- #22, merge commit `158067c`
- #24, merge commit `f85234f`
- #26, merge commit `782fef6`
- #28, merge commit `bdeade4`
- #30, merge commit `9c5ad0e`
- #32, merge commit `e34f3d5`
- #34, merge commit `1ca9301`
- #36, merge commit `cdd7d53` (W06 FAIL·B-009 상태 기록)
- #38, merge commit `ab64187` (pending proposal 취소·W06 PASS)
- #42, merge commit `e613922` (W04·W05 blocker 경계 기록)

## 실행한 테스트

- 모바일 테스트 24/24, typecheck, lint `PASS`
- Expo doctor 21/21, Android export 2,216 modules `PASS`
- npm audit high 기준 `PASS`; 기존 moderate 14·low 1 유지
- MetaMask 8.11.0 WalletConnect 연결 `PASS`
- Base Sepolia 네트워크 추가·승인·앱 복귀 `PASS`
- 읽을 수 있는 `personal_sign`과 서버 주소 확인 `VERIFIED` `PASS`
- 프로세스 종료 뒤 WalletConnect 세션 복원 `PASS`
- 서명 거절 실제 응답 code 4001 관측, 수정 회귀 자동화와 수정 후 실기 안내 `PASS`
- 연결 승인 거절의 Reown `USER_REJECTED` 관측과 회귀 자동화 `PASS`
- 연결 승인 거절 후 Android 뒤로가기로 앱에 복귀해 `NOT_CONNECTED / CHECK_REQUIRED / UNVERIFIED`와 보존 안내 표시 `PASS`; 자동 딥링크 복귀는 관측되지 않음
- WalletConnect 연결 거절 5000~5003과 Reown 체인 전환 거절 변환 자동화 `PASS`
- PR #28 최신 HEAD 모바일 19/19·typecheck·secret scan, Astra high 재검증 `PASS`
- PR #32 merge `e34f3d5`, main CI run `35323830141` `PASS`
- 미설치 Trust Wallet → Google Play → 수동 앱 복귀 → 한국어 재시도·보존 안내 `PASS`

## 현재 Phase 1 상태

- 핵심 흐름 연결→Base Sepolia→`personal_sign`→서버 `VERIFIED`→콜드 재시작은 `VERIFIED`
- W06 `PASS`; Account 1 VERIFIED가 Account 2 재연결에 승계되지 않는 격리 PASS; MetaMask 동일 세션 변경 W04와 실제 미지원 스마트지갑 W05는 `BLOCKED`

## BLOCKER

- 외부 HTTPS·유료 AWS·공개 배포는 별도 승인 필요
- GitHub Pages는 현재 꺼져 있고 private 저장소의 조직 요금제·공개 정책 확인 및 공개 승인 필요
- MetaMask 거절 뒤 자동 딥링크 복귀는 관측되지 않았으며 수동 Android 뒤로가기는 PASS
- Reown 2.0.6 공개 API 부재는 승인된 patch-package 최소 패치로 해소; upstream stable 제공 시 제거
- PR #47의 GitHub Actions와 필수 리뷰가 끝나기 전에는 merge하지 않음

## 사용자 승인이 필요한 사항

- 승인된 Phase 2 구현·테스트·PR·merge 범위에는 없음
- 저장소/포털 공개·유료 자원·테스트넷 전송·Play 배포·대회 제출은 계속 승인 필요

## 다음 세션이 가장 먼저 해야 할 작업

1. PR #50 CI·리뷰를 확인하고 통과하면 merge한 뒤 main CI 확인
2. 마지막 Phase 3 PR에서 Worker·이벤트 대조·복구·Android 상태 구현
3. W07·M01~M08·M07의 전체 효과를 로컬 Anvil에서 최종 판정
4. Base Sepolia는 전용 시험 배포자·gas가 준비되기 전 B-012 BLOCKED 유지
5. 운영 키·메인넷·유료 자원·공개/Play/제출은 실행하지 않음

## 실행 명령

```bash
npm test --prefix apps/api
npm run typecheck --prefix apps/api
npm run build --prefix apps/api
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
bash scripts/check-secrets.sh
bash tests/bootstrap/check_secrets_test.sh
bash tests/bootstrap/check_pr_korean_test.sh
bash tests/bootstrap/verify_bootstrap_test.sh
```

PostgreSQL 통합은 DB 이름이 `_test`로 끝나는 전용 `TEST_DATABASE_URL`을 지정하고 `npm run test:postgres --prefix apps/api`를 실행합니다.

## 주의사항

- 실제 협약 점포 seed를 만들지 말고 테스트 fixture는 `demo: true`로 유지
- Q01·Q02·Q03·Q05·R01·R03은 실제 PostgreSQL 증거로 PASS이며 Q04·R02는 계속 NOT_RUN
- 정확한 식사 시각은 서비스 DB 감사 자료일 뿐 온체인·IPFS·공개 메타데이터에 넣지 않음
- 방문 취소·도감 조회·Android QR 카메라를 구현 완료로 표시하지 않음
- Phase 1 핵심 외부 지갑 흐름·W06 PASS와 W04·W05 BLOCKED를 구분함
- 실제 Android 기기 일련번호·개인 앱 목록·지갑 비밀은 저장소에 기록하지 않음
- 개인 private mirror는 사용자가 나중에 요청할 때만 생성
