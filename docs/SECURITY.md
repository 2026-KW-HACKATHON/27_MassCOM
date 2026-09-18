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

## 의존성 검사

- API production 의존성: `npm audit --omit=dev` 취약점 0건
- 모바일: high/critical 0건, moderate 14건. 현재 Expo SDK 57/Router/config-plugin 전이 의존성으로, npm의 제안은 Expo 46 또는 Router 5로 잘못된 major downgrade를 요구해 적용하지 않았습니다.
- `tsx`의 Windows 개발 서버 관련 esbuild low advisory는 production 제외 검사에서 사라지며 현재 macOS/CI 실행 경로와 무관합니다.
- Reown AppKit은 패키지 메타데이터상 별도 LICENSE.md를 참조하므로 공개 전 upstream Community License 조건을 다시 확인합니다.

## 미검증

실제 Reown gateway, 외부 지갑 앱, Android App Link, release 서명, AAB 16KB 호환, 외부 HTTPS, PostgreSQL 동시성은 아직 검증되지 않았습니다.
