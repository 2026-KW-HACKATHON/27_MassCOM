# 보안 경계와 현재 위험

## 지갑·서명

- 사용자 개인키·복구 문구를 입력받거나 저장하지 않습니다.
- Phase 1 허용 메서드는 계정 조회, 체인 확인/전환, `personal_sign`뿐입니다.
- Reown `universalProviderConfigOverride`도 같은 allowlist와 `eip155:84532`만 wallet session에 제안합니다.
- 거래·typed data·batch call은 앱 경계에서 기본 거절합니다.
- Reown socials, swaps, onramp, analytics를 비활성화합니다.
- 연결된 주소는 서버 SIWE 검증 전까지 `UNVERIFIED`입니다.

## 서버

- challenge는 account·address·domain·URI·chain·nonce·발급/만료 시각에 묶입니다.
- 성공 nonce는 재사용할 수 없고, 동시 검증은 claim 상태로 한 요청만 진행합니다.
- HTTP 본문은 64KiB로 제한하고 응답은 `no-store`, `nosniff`를 사용합니다.
- 기본 서버는 account resolver가 없으면 wallet POST를 `503`으로 거절합니다. `x-account-id`는 loopback 서버에서 `ALLOW_INSECURE_DEMO_ACCOUNT=true`를 명시한 개발 모드에만 사용합니다.
- 기기 저장 정책(D-021): 기기에는 WalletConnect 세션만 `@masscom:appkit:` AsyncStorage에 저장하며 개인키·복구 문구·인증 token은 저장하지 않습니다. 세션 크기가 SecureStore 한도를 넘어 옮기지 않습니다. 운영 로그인 token이 도입되면 그 token은 SecureStore(Android Keystore)에만 저장합니다. 지갑 세션 key는 account ID 원문이 아닌 계정별 tag로 구분해(`@masscom:appkit:<tag>:`) 다른 계정의 세션을 읽지 않으며, 앱 시작 때 현재 계정의 것이 아닌 세션 key를 지웁니다. 계정 삭제가 접수되면 앱이 지갑 연결을 끊고 기기의 세션 key를 모두 지웁니다. 연결 해제가 실패한 상태에서 실행 중인 provider가 세션을 다시 기록할 가능성은 Android 실기에서 확인하지 못했으며(`NOT_RUN`), 앱 재시작 뒤 세션이 복원되지 않는지 실기 회귀에서 확인합니다.
- `DATABASE_URL`이 있으면 challenge를 PostgreSQL `wallet_challenges`에 저장하고 단일 조건부 UPDATE로 nonce를 한 번만 claim합니다. 서명은 저장하지 않으며 만료 행은 발급 때 정리합니다.
- `DATABASE_URL`이 없는 DEMO의 메모리 challenge store는 재시작 복구·다중 인스턴스 원자성을 제공하지 않습니다.

## 점포 권한·QR

- 점주·직원 권한은 점포별 활성 멤버십을 매 요청 PostgreSQL에서 확인합니다.
- QR token 원문은 저장하지 않고 SHA-256 hash만 저장합니다.
- 추측 가능한 점포 주문 참조는 점포 ID를 포함한 HMAC-SHA-256만 저장하며, 32바이트 이상 서버 비밀값을 환경 변수로 주입합니다.
- token preview는 URL이 아닌 JSON 본문으로 받고 슬롯 상태를 변경하지 않습니다.
- 재발급은 클라이언트가 본 `tokenVersion`이 현재 버전과 같을 때만 같은 슬롯의 token hash를 교체하므로 동시 요청 한 건만 성공하며 이전 token을 즉시 무효화합니다.
- 소비와 만료 판정은 조건부 `UPDATE ... RETURNING` 한 문장에서 처리해 동시 성공을 한 건으로 제한합니다.
- 유효 수령은 슬롯 소비·방문 이벤트·고정 보상권 평가를 한 PostgreSQL 트랜잭션으로 처리합니다.
- 진행 일자는 DB에서 `Asia/Seoul`로 계산하고 계정·점포·한국 날짜별 진행 증가를 고유 제약으로 한 번만 허용합니다.
- 계정·캠페인별 트랜잭션 잠금과 `(계정, 캠페인, 목표)` 고유 제약을 함께 사용해 첫/3/5회 보상권 중복을 막습니다.

## 의존성 검사

- API production 의존성: `npm audit --omit=dev` 취약점 0건
- 모바일: high/critical 0건, moderate 14건. 현재 Expo SDK 57/Router/config-plugin 전이 의존성으로, npm의 제안은 Expo 46 또는 Router 5로 잘못된 major downgrade를 요구해 적용하지 않았습니다.
- `tsx`의 Windows 개발 서버 관련 esbuild low advisory는 production 제외 검사에서 사라지며 현재 macOS/CI 실행 경로와 무관합니다.
- Reown AppKit은 패키지 메타데이터상 별도 LICENSE.md를 참조하므로 공개 전 upstream Community License 조건을 다시 확인합니다.
- AppKit 2.0.6의 연결 초기 체인 이벤트 경쟁을 피하기 위해 `@walletconnect/universal-provider` 2.23.5를 override로 고정했습니다. 버전 변경 전 실제 MetaMask 연결 회귀를 다시 수행합니다.

## NFT 계약

- `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE`, `PAUSER_ROLE`을 분리하고 민터는 역할을 스스로 올릴 수 없습니다.
- 활성 시리즈만 발행하며 `maxEverMinted`와 누적 `everMinted`를 계약이 직접 비교합니다.
- 32바이트 `rewardKey`는 한 번만 소비되고 이미 사용한 키는 다른 수령인·시리즈에도 다시 쓸 수 없습니다.
- ERC-5192 `locked=true`와 함께 approve·setApprovalForAll·transfer·safeTransfer의 모든 경로를 거절합니다.
- 시리즈 설정 변경, 업그레이드 프록시, 소각, 교환, 관리자 회수를 제공하지 않습니다.
- 이벤트와 token URI에는 사용자 ID·주문번호·정확한 식사 시각을 넣지 않습니다.
- 로컬 Anvil unlocked test account는 개발 전용이며 private key·mnemonic을 명령·증거에 기록하지 않습니다.

## 발행 요청·Outbox

- SIWE 성공 주소는 계정별 증가하는 binding version으로 PostgreSQL에 저장하고 같은 주소의 다른 활성 계정 연결을 차단합니다.
- mint request는 entitlement 소유자·상태·만료, 활성 binding ID/version, chain, 동의 버전을 서버에서 검사합니다.
- 수령 주소·chain·contract·series·32바이트 reward key는 서버가 작업에 복사·생성하며 클라이언트 입력을 받지 않습니다.
- 보상권 `MINT_REQUESTED`, mint job, Outbox를 한 트랜잭션에 저장합니다.
- 동일 Idempotency-Key·동일 본문은 기존 결과를 반환하고 다른 본문은 충돌로 거절합니다.
- Outbox payload에는 job ID만 넣고 reward key·주소·개인정보를 복제하지 않습니다.

## 미검증

실제 Android 기기에서 Reown gateway, WalletConnect 세션, Base Sepolia 전환, 읽을 수 있는 `personal_sign`, 서버 서명 복구와 콜드 재시작 세션 복원을 확인했습니다. Base Sepolia 등록은 앱 RPC가 아니라 MetaMask 설정 UI에서 사용자가 직접 승인했으며, 앱의 체인 전환 경로는 `wallet_switchEthereumChain`만 요청합니다. `wallet_addEthereumChain`은 세션 제안과 앱 허용 목록에서 제외되고 SDK 특성화 테스트에서도 요청되지 않는지 확인합니다. 미설치 SafePal의 스토어 이동·수동 앱 복귀·pending proposal 즉시 취소 후 6분 지연 오류 부재를 확인했습니다. 패치는 proposal ID 만료·pending rejection 소비·pairing 정리에 한정하며 송금·서명 경계를 변경하지 않습니다. Account 1 VERIFIED가 Account 2 재연결에 승계되지 않는 것은 확인했지만 MetaMask 동일 세션 계정 변경과 실제 미지원 스마트 지갑은 외부 환경 제약으로 BLOCKED입니다. Android App Link, release 서명, AAB 16KB 호환, 외부 HTTPS는 아직 검증되지 않았습니다. PostgreSQL 방문·보상권 원자 트랜잭션은 검증했지만 방문 취소·도감 조회·Android QR 카메라는 아직 `NOT_RUN`입니다.

계정 삭제는 원 account ID를 별도 HMAC 참조와 `deleted:<hash>` 별칭으로 바꾸고, 미전송 작업만 취소합니다. 제출·확정 체인 자료와 수령 주소는 공개 장부 대조·중복 방지를 위해 남기며 완료 화면에서 이를 숨기지 않습니다. `scripts/check-privacy.sh`는 민감한 console 인자와 미검토 analytics SDK를 CI에서 거절하며 서버는 raw 예외 객체를 로그로 내보내지 않습니다.

2026-09-20 감사 이후 삭제·wallet verify·claim issue/redeem·mint request는 같은 HMAC account lifecycle advisory lock을 사용합니다. 삭제 tombstone 이후 신규 write는 `ACCOUNT_DELETED`로 거절합니다. 활성 Worker lease는 삭제가 취소하지 않으며 Worker는 submit 직전에 현재 lease를 DB에서 다시 확인합니다. 상세 근거와 남은 운영 보완은 [SECURITY_AUDIT_2026-09-20.md](SECURITY_AUDIT_2026-09-20.md)를 따릅니다.
