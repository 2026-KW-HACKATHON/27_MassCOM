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
- 외부 지갑 확인 뒤 NFT 공개 안내→접수→Worker 이벤트 대조→도감 등록 완료: `VERIFIED` (Local Anvil)
- 앱 수집품과 실제 NFT, 접수·확인 중·등록 완료·확인 필요 상태 분리: `VERIFIED`
- 계정 삭제 전 공개 장부·외부 지갑·제출 거래 보존 안내와 loopback DEMO 요청: `VERIFIED`; 운영 재인증·외부 삭제 URL은 `BLOCKED`
- MetaMask 8.11.0 설치·첫 화면 실행: `VERIFIED` — 지갑 생성·가져오기는 수행하지 않음
- 실제 Reown project ID·`kr.masscom.wolgye.dev` MetaMask 연결·서명·자동 복귀·콜드 스타트 서버 binding 복원: `VERIFIED`; 운영 release package와 W04·W05 외부 환경은 `NOT_RUN/BLOCKED`
- Android 카메라 QR: `NOT_RUN`; 수동 1회 코드 입력은 `VERIFIED`
- 운영 package ID `kr.masscom.wolgye`(개발 `kr.masscom.wolgye.dev`), scheme `masscom`/`masscom-dev`: `IMPLEMENTED`
- 계정 삭제 접수 시 지갑 연결 해제 및 기기 WalletConnect 세션 제거: `IMPLEMENTED`
- upload key 파일·공개 SHA-256 핀: `IMPLEMENTED`; upload key로 서명한 release AAB, Base Sepolia 실제 배포, Play Console 제출: `NOT_RUN`(로컬 debug 서명 운영 AAB의 package·권한·16KB 정렬 검증만 완료)

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

운영 package ID는 `kr.masscom.wolgye`(개발 `kr.masscom.wolgye.dev`)로 확정되어 `apps/mobile/app.config.ts`가 `APP_VARIANT=production` 여부로 package와 scheme(`masscom`/`masscom-dev`)을 분기합니다. 기본(비운영) prebuild는 개발 package와 scheme을 그대로 사용합니다.

## release AAB 빌드

```bash
scripts/build-release-aab.sh [--restore-dev]
```

`APP_VARIANT=production`으로 운영 package를 prebuild한 뒤 `gradlew bundleRelease`를 실행합니다. upload key는 저장소 밖에 두고 `~/.gradle/gradle.properties`의 `android.injected.signing.store.file`/`store.password`/`key.alias`/`key.password`로 주입해야 하며, 없으면 로컬 debug 키로 서명되고 스크립트가 경고를 출력합니다. `--restore-dev`를 주면 빌드 뒤 개발용 prebuild로 되돌립니다. 실제 upload key 서명과 Play Console 제출은 아직 수행하지 않았습니다(`NOT_RUN`).

## 안전 경계

- 허용: `eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `wallet_switchEthereumChain`, `personal_sign`
- 거절: 거래 전송, transaction 서명, batch call, typed data, approve, permit, swap, purchase
- 앱 복귀 또는 `accountsChanged` 후 주소가 달라지면 기존 확인 상태를 지웁니다.
- 연결만 된 주소는 `UNVERIFIED`이며 서버 확인 전에는 NFT 발행 대상으로 사용할 수 없습니다.
- 앱 재시작 때 서버의 활성 binding 주소·체인이 현재 WalletConnect 세션과 모두 일치하는 경우에만 `VERIFIED`를 복원합니다.

## 계정 전환 시 데이터 분리

지갑 세션은 계정별 tag가 붙은 key(`@masscom:appkit:<tag>:`)에만 저장하고 읽습니다. 앱 시작 때 현재 계정의 것이 아닌 지갑 세션 key를 지우며, 계정 ID를 받는 모든 화면은 계정이 바뀌면 remount됩니다. 이 변경 뒤 첫 실행에서는 이전 형식의 세션이 지워져 지갑을 한 번 다시 연결해야 합니다. 계정은 현재 빌드 시점 값이라 한 프로세스 안에서 바뀌지 않습니다. 운영 로그인으로 실행 중 계정을 바꾸게 되면 AppKit을 다시 만들거나 앱을 재시작해야 이 분리가 유지됩니다. 실기 계정 전환 검증(D02)은 운영 로그인이 없어 `NOT_RUN`입니다.
