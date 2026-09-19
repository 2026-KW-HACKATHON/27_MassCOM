# HANDOFF

마지막 갱신 시각: 2026-09-19 KST

기준 브랜치: `main`

통합 기준 커밋 SHA: `main@e34f3d52016be8ba7ab68af5925d6829e4da48e7`, main CI run `35323830141` PASS

현재 작업: `test/33-wallet-missing-return@1dba58f`, PR #34 OPEN

## 이번 세션에서 완료한 것

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

## 통합한 작업 브랜치

- `test/25-wallet-device`
- `fix/27-wallet-connection-rejection`
- `fix/31-wallet-rejection-event`

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

## 실행한 테스트

- 모바일 테스트 22/22, typecheck, lint `PASS`
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
- W06 미설치·거절·복귀 실패 묶음 `PASS`; W04 주소 변경과 W05 미지원 스마트지갑은 `NOT_RUN`

## BLOCKER

- 외부 HTTPS·유료 AWS·공개 배포는 별도 승인 필요
- GitHub Pages는 현재 꺼져 있고 private 저장소의 조직 요금제·공개 정책 확인 및 공개 승인 필요
- MetaMask 거절 뒤 자동 딥링크 복귀는 관측되지 않았으며 수동 Android 뒤로가기는 PASS

## 사용자 승인이 필요한 사항

- 현재 Phase 1 코드·증거 PR 범위에는 없음
- 저장소/포털 공개·유료 자원·테스트넷 전송·Play 배포·대회 제출은 계속 승인 필요

## 다음 세션이 가장 먼저 해야 할 작업

1. Phase 1 잔여 W04 주소 변경·W05 미지원 스마트지갑을 준비된 안전한 환경에서 별도 증거로 남김
2. 실제 지갑 실기는 비밀번호·복구 문구·개인키를 공유하거나 기록하지 않고 사용자가 직접 잠금만 해제
3. 실제로 실행하지 않은 예외 시험은 계속 `NOT_RUN`으로 유지
4. Phase 2 이상, 공개 배포, Play 제출은 새 사용자 승인 없이 진행하지 않음

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
- Phase 1 핵심 외부 지갑 흐름·W06 실기 PASS와 잔여 W04·W05 예외를 구분함
- 실제 Android 기기 일련번호·개인 앱 목록·지갑 비밀은 저장소에 기록하지 않음
- 개인 private mirror는 사용자가 나중에 요청할 때만 생성
