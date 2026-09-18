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
- 메모리 challenge store는 재시작 복구·다중 인스턴스 원자성을 제공하지 않습니다.

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

## 미검증

실제 Android 기기에서 Reown gateway, WalletConnect 세션, Base Sepolia 전환, 읽을 수 있는 `personal_sign`, 서버 서명 복구와 콜드 재시작 세션 복원을 확인했습니다. 주소 변경·미지원 지갑·지갑 미설치, Android App Link, release 서명, AAB 16KB 호환, 외부 HTTPS는 아직 검증되지 않았습니다. PostgreSQL 방문·보상권 원자 트랜잭션은 검증했지만 방문 취소·도감 조회·Android QR 카메라는 아직 `NOT_RUN`입니다.
