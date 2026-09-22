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
- Google ID token→서버 Bearer session→SecureStore 복원·로그아웃·계정 전환 코드와 자동 시험: `IMPLEMENTED`; 실제 Google 계정·Credential Manager 실기: `NOT_RUN`
- MetaMask 8.11.0 설치·첫 화면 실행: `VERIFIED` — 지갑 생성·가져오기는 수행하지 않음
- 실제 Reown project ID·`kr.masscom.wolgye.dev` MetaMask 연결·서명·자동 복귀·콜드 스타트 서버 binding 복원: `VERIFIED`; 운영 release package와 W04·W05 외부 환경은 `NOT_RUN/BLOCKED`
- Android 카메라 QR: `NOT_RUN`; 수동 1회 코드 입력은 `VERIFIED`
- 운영 package ID `kr.masscom.wolgye`(개발 `kr.masscom.wolgye.dev`), scheme `masscom`/`masscom-dev`: `IMPLEMENTED`
- 계정 삭제 접수 시 지갑 연결 해제 및 기기 WalletConnect 세션 제거: `IMPLEMENTED`
- upload key 파일·공개 SHA-256 핀과 upload key 서명 release AAB 자동 gate: `VERIFIED`; Base Sepolia 실제 배포·A02 설치·App Links·Play Console 제출: `NOT_RUN`

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

- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`: Google ID token의 서버 audience로 쓰는 공개 Web OAuth client ID. client secret이 아님
- `EXPO_PUBLIC_DEMO_ACCOUNT_ID`: 고객 loopback 데모 계정
- `EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID`: 점주·직원 loopback 데모 계정
- `EXPO_PUBLIC_DEMO_MERCHANT_ID`: 위 계정이 실제 PostgreSQL 멤버십을 가진 데모 점포

## 운영 Google 로그인 설정

- 고정 native 의존성: `react-native-nitro-google-signin@2.3.0`, `react-native-nitro-modules@0.37.1`, Expo SDK 57 호환 `expo-secure-store@57.0.4`
- Web OAuth client ID는 `POST /auth/google`에서 검증할 ID token audience이며 API의 `GOOGLE_OAUTH_CLIENT_IDS`와 앱의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`가 같은 승인 값을 가리켜야 합니다.
- Android OAuth client는 package/SHA 조합별로 별도 생성합니다. 개발 package `kr.masscom.wolgye.dev`와 운영 package `kr.masscom.wolgye`, 각 서명 인증서 SHA-1을 Google Cloud에 정확히 등록해야 합니다. 목표 인프라를 만들었다는 사실만으로 실제 로그인 PASS가 되지 않습니다.
- Android는 explicit Web client ID와 React Native native autolinking을 사용합니다. Nitro Expo config plugin v2.3.0은 iOS reversed client ID 또는 Firebase 파일을 요구하므로, 현재 Android-only 범위에서 가짜 iOS 값을 만들지 않고 등록하지 않았습니다. iOS 지원 시 실제 iOS OAuth client와 함께 추가해야 합니다.
- 서버가 돌려준 `{ sessionToken, accountId, expiresAt }`는 SecureStore key `masscom.auth.session.v1`의 version 1 레코드에만 저장합니다. AsyncStorage·URL·화면·로그·증거 JSON에는 session token을 넣지 않습니다.
- 운영 계정 API는 `Authorization: Bearer <sessionToken>`만 보냅니다. development DEMO는 `x-account-id`만 보내며 한 요청에서 두 방식을 섞지 않습니다.
- 로그아웃·계정 전환은 서버 logout 시도 → SecureStore 삭제 → Reown disconnect와 저장 key 삭제 → Google sign-out 순서입니다. 계정 전환은 이 정리가 끝난 뒤 새 Google 로그인을 시작하고 account ID key로 route와 AppKit을 다시 만듭니다.
- Google mobile sign-in의 `signIn`/`createAccount`는 삭제 요청에 필요한 fresh `auth_time`을 보장하지 않습니다. `getTokens`나 `presentExplicitSignIn`을 재인증 증거로 사용하지 않으며 운영 계정 삭제는 승인된 별도 사용자 확인 설계 전까지 `BLOCKED`입니다.

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

`APP_VARIANT=production`으로 운영 package를 prebuild한 뒤 `gradlew bundleRelease`를 실행합니다. upload key는 저장소 밖에서 `android.injected.signing.*`로 주입하며, 없으면 로컬 debug 키로 서명되어 자동 gate가 거절합니다. `--restore-dev`를 주면 빌드 뒤 개발용 prebuild로 되돌립니다. 2026-09-22 upload key 서명 AAB의 서명·package·source marker·W08·16KB 정적 검사는 PASS했고, Play Console 제출은 `NOT_RUN`입니다.

AAB manifest 검사는 Google 공식 `bundletool-all` jar를 사용합니다. `BUNDLETOOL_JAR`를 지정하거나 `ANDROID_HOME/bundletool/bundletool-all.jar` 또는 단 하나의 `bundletool-all-<version>.jar`를 둡니다. 여러 버전 jar가 있으면 임의 선택하지 않고 중단합니다.

빌드가 끝나면 기본 gitignored 경로 `apps/mobile/release-artifacts/`에 다음 두 파일을 함께 남깁니다. `RELEASE_ARTIFACT_DIR`로 다른 경로를 지정할 수 있지만 그 경로는 자동으로 gitignore되지 않으므로 접근 권한·ignore·보존 정책은 운영자가 관리해야 합니다.

- `app-release-<short-sha>.aab`
- `app-release-<short-sha>.provenance.json`

provenance는 공개 가능한 빌드 증거인 AAB basename·SHA-256·크기, source commit과 mobile dirty 여부, 기대 package/version, W08이 확인한 artifact package, 서명·W08 상태와 exit code, upload 인증서 공개 SHA-256, 미실행 release gate, 생성 시각을 기록합니다. keystore 경로·비밀번호·개인키는 기록하지 않으며 현재 스키마는 artifact의 절대 경로 대신 basename만 저장합니다. provenance에서 개인 로컬 filesystem 경로가 발견되면 커밋하지 말고 원인을 조사해야 합니다.

release build는 시작부터 publish 직전까지 전체 Git worktree가 clean이고 HEAD가 같은지 확인합니다. production prebuild에는 캡처한 공개 Git SHA를 로컬 Expo config plugin으로 Android manifest의 `kr.masscom.BUILD_SOURCE_COMMIT`에 넣으며, assessor는 서명된 AAB의 marker·현재 HEAD·provenance source commit이 모두 같을 때만 자동 gate PASS를 허용합니다. 개발 build는 이 marker 없이 계속 사용할 수 있습니다.

자동 검증이 거절되면 AAB와 provenance를 삭제하지 않고 각각 `app-release-<short-sha>.NOT-RELEASE-READY-exitN.aab`와 `app-release-<short-sha>.NOT-RELEASE-READY-exitN.provenance.json`으로 함께 바꿔 진단 증거를 보존합니다. exit 0과 `Automated gates: PASS`는 승인 upload 인증서 서명과 W08 wallet surface gate만 통과했다는 뜻입니다. 다음 단계는 서로 대체되지 않습니다.

같은 commit의 accepted 또는 rejected 최종 경로가 하나라도 이미 있으면 기존 증거를 덮지 않고 prebuild 전에 중단합니다. 기존 쌍을 검토·보관하거나 다른 `RELEASE_ARTIFACT_DIR`를 선택한 뒤 다시 실행합니다.

- Gradle build 성공: AAB 생성만 증명
- `signature.status: PASS`: 승인 upload 인증서와 서명 무결성만 증명
- `Automated gates: PASS`: signature와 W08 자동 검사 통과만 증명
- A02 기기 설치·App Links: 별도 실기·도메인 검증 필요
- Play upload·review: 별도 Console 작업과 Google 심사 필요

따라서 자동 검사가 통과해도 provenance의 `releaseReadiness.status`는 `NOT_RUN`이며, 출력이나 파일명을 “uploadable” 또는 “ready”의 증거로 사용하면 안 됩니다.

## 안전 경계

- 허용: `eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `wallet_switchEthereumChain`, `personal_sign`
- 거절: 거래 전송, transaction 서명, batch call, typed data, approve, permit, swap, purchase
- 앱 복귀 또는 `accountsChanged` 후 주소가 달라지면 기존 확인 상태를 지웁니다.
- 연결만 된 주소는 `UNVERIFIED`이며 서버 확인 전에는 NFT 발행 대상으로 사용할 수 없습니다.
- 앱 재시작 때 서버의 활성 binding 주소·체인이 현재 WalletConnect 세션과 모두 일치하는 경우에만 `VERIFIED`를 복원합니다.

## 계정 전환 시 데이터 분리

지갑 세션은 계정별 tag가 붙은 key(`@masscom:appkit:<tag>:`)에만 저장하고 읽습니다. 앱 시작 때 현재 계정의 것이 아닌 지갑 세션 key를 지우며, 계정 ID를 받는 모든 화면은 계정이 바뀌면 remount됩니다. 계정 전환 시 이전 AppKit을 disconnect하고 저장 key를 지운 뒤 새 account ID용 AppKit instance를 만듭니다. 이 변경 뒤 첫 실행에서는 이전 형식의 세션이 지워져 지갑을 한 번 다시 연결해야 할 수 있습니다. 자동 controller 시험은 통과했지만 실제 Google 계정 전환 뒤 이전 사용자 API·지갑 데이터가 보이지 않는지 확인하는 D02 실기는 `NOT_RUN`입니다.
