# Android 고객 앱

Expo SDK 57 development build에서 음식점을 탐색하고, 점주 1회 코드로 방문·보상권·도감을 기록하며, 선택적으로 Reown 외부 지갑 주소를 확인하는 Android 앱입니다.

## 현재 상태

- Expo Router 화면·Reown AppKit·Ethers adapter: `IMPLEMENTED`
- 이메일·소셜·내장 지갑·구매·스왑 UI: 명시적으로 비활성화
- 거래·approve·permit 요청: 앱 메서드 경계에서 거절
- Android 16 / arm64 / 16KB AVD debug APK 빌드·설치·실행: `VERIFIED`
- Samsung SM-S928N / Android 16 debug APK 설치·Metro 실행·홈 복귀·콜드 스타트: `VERIFIED`
- 지갑 없는 음식점 목록·상세와 점주 발급→고객 수령→도감: `VERIFIED` (loopback DEMO)
- 미방문·다음 보상 이유가 보이는 다음 가게 추천과 상세 복귀: `VERIFIED` (loopback DEMO)
- MetaMask 8.11.0 설치·첫 화면 실행: `VERIFIED` — 지갑 생성·가져오기는 수행하지 않음
- 실제 Reown project ID·MetaMask 연결·서명·지갑 복귀 핵심 흐름: `VERIFIED`; W04·W05 외부 환경은 `BLOCKED`
- Android 카메라 QR: `NOT_RUN`; 수동 1회 코드 입력은 `VERIFIED`
- 출시 package ID·AAB·Play 제출: `NOT_RUN`

## 로컬 준비

```bash
cp .env.example .env.local
npm ci
npm test
npm run typecheck
npm run lint
npm run export:android
```

`.env.local`의 API·DEMO 계정 값으로 로컬 탐색·수령을 실행합니다. Reown project ID는 선택적 지갑 화면에만 필요합니다. `EXPO_PUBLIC_*` 값은 앱 번들에서 보이므로 비밀을 넣지 않습니다.

- `EXPO_PUBLIC_DEMO_ACCOUNT_ID`: 고객 loopback 데모 계정
- `EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID`: 점주·직원 loopback 데모 계정
- `EXPO_PUBLIC_DEMO_MERCHANT_ID`: 위 계정이 실제 PostgreSQL 멤버십을 가진 데모 점포

## development build

```bash
npx expo prebuild --clean --platform android --no-install
ANDROID_HOME="$HOME/Library/Android/sdk" ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
  ./android/gradlew -p android assembleDebug
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
npx expo start --dev-client --host localhost
```

출시 package ID는 미확정이므로 `app.json`에 커밋하지 않았습니다. 로컬 prebuild가 만든 `com.anonymous.masscommobile`은 개발 증거용이며 출시 식별자가 아닙니다.

## 안전 경계

- 허용: `eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `wallet_switchEthereumChain`, `personal_sign`
- 거절: 거래 전송, transaction 서명, batch call, typed data, approve, permit, swap, purchase
- 앱 복귀 또는 `accountsChanged` 후 주소가 달라지면 기존 확인 상태를 지웁니다.
- 연결만 된 주소는 `UNVERIFIED`이며 서버 확인 전에는 NFT 발행 대상으로 사용할 수 없습니다.
