# Android 고객 앱

## 세 빌드의 경계

| `APP_VARIANT` | Android package | 복귀 scheme | API | 현재 검증 |
| --- | --- | --- | --- | --- |
| 비움/`development` | `kr.masscom.wolgye.dev` | `masscom-dev` | 로컬 loopback 가능 | 기존 개발 앱·로컬 DEMO |
| `showcase` | `kr.masscom.wolgye.demo` | `masscom-demo` | 정확히 `https://demo-api.masscom.kr` | [두 계정 직접 코드 수령](../../docs/evidence/showcase-two-account-phone-2026-09-27.json)과 [같은 계정 Preview 3 카메라 QR 촬영→수령](../../docs/evidence/showcase-preview3-camera-claim-2026-09-28.json) PASS. 두 계정·두 기기 QR 수령은 `NOT_RUN` |
| `production` | `kr.masscom.wolgye` | `masscom` | 정확히 `https://api.masscom.kr` | [test.5 Samsung의 test.4 위 설치·새 버전 동의 화면 표시](../../docs/evidence/operating-android-test5-2026-10-01.json) PASS, [test.4 Samsung 설치·세션 복원·동의 화면 표시](../../docs/evidence/operating-android-test4-2026-10-01.json) PASS(이전), [test.3 Samsung Google 로그인·16KB 설치](../../docs/evidence/operating-android-test3-2026-09-28.json) PASS(이전); Play 별도 |

시연 빌드는 표시 이름 `월계 마스코트 체험용`과 별도 package/scheme·App Link host `demo.masscom.kr/open`을 갖습니다. 다만 이 호스트의 DNS·Caddy·assetlinks가 아직 없어 시연 앱은 https 링크를 공유하거나 QR에 넣지 않고 `masscom-demo://` 링크와 앱 받기 안내만 씁니다([친구 설계 §8 D](../../docs/superpowers/specs/2026-09-29-friends-design.md)). 정적 시연 웹은 [www 공개 HTTPS](https://www.masscom.kr/preview/)에서 열립니다. **[전용 시연 API/DB](https://demo-api.masscom.kr/health)는 [새 고객 로그인 코드로 교체](../../docs/evidence/showcase-open-login-api-deployment-2026-09-27.json)했고 [Preview 3 설치용 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3)는 [같은 계정의 카메라 QR 촬영→수령](../../docs/evidence/showcase-preview3-camera-claim-2026-09-28.json)까지 확인했습니다. 초대 밖 실계정 새 로그인·서로 다른 두 계정/두 휴대전화 QR·`demo.masscom.kr` App Link·지갑 연결은 미검증**입니다. 이전 두 계정 직접 코드 수령은 [별도 폰 실기](../../docs/evidence/showcase-two-account-phone-2026-09-27.json)입니다. 개발 앱의 DEMO 인증은 정확한 `kr.masscom.wolgye.dev` package에서만 허용하고 시연·운영·미확인 package는 거절합니다. 운영 DB에 가상 점포를 넣거나 운영 앱에 개발 DEMO 계정을 포함하지 않습니다.

`APP_VARIANT=showcase`는 기존 `.env.local`의 운영 Google/Reown ID 또는 개발 DEMO 변수가 있으면 빌드 설정을 거절합니다. 시연 전용 Google Web client ID를 `MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID`로 요구하고, 설치 package가 `.demo`일 때만 앱 설정의 이 값을 읽습니다. 별도 Reown 프로젝트는 미설정이라 시연 지갑 연결은 비활성입니다. 현재 환경 경계만 확인하려면 로컬 dotenv 로드를 끄고 실제 발급받은 시연 전용 공개 ID를 명시합니다(실제 API 요청·APK 빌드 아님).

```bash
EXPO_NO_DOTENV=1 APP_VARIANT=showcase \
  MASSCOM_BUILD_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID='<시연 전용 Google Web client ID>' \
  EXPO_PUBLIC_API_URL=https://demo-api.masscom.kr \
  npx expo config --type public --json
```

Expo의 [앱 variant 안내](https://docs.expo.dev/build-reference/variants/)대로 package를 바꿔 설치할 때는 격리된 checkout에서 해당 `APP_VARIANT`로 native `prebuild --clean`을 먼저 해야 합니다. 기존 `apps/mobile/android`를 다른 variant로 덮어쓰지 않습니다. 실제 시연 앱의 운영 앱 동시 설치·공개 HTTPS·두 계정 직접 코드 수령→도감은 [이전 폰 실기](../../docs/evidence/showcase-two-account-phone-2026-09-27.json)에서 PASS, 같은 계정 카메라 QR 촬영→수령은 [Preview 3 폰 실기](../../docs/evidence/showcase-preview3-camera-claim-2026-09-28.json)에서 PASS입니다. 두 계정 카메라 QR·지갑 복귀는 `NOT_RUN`입니다.

도감의 가상 점포 그림은 `.demo` package에서만 표시합니다. `metro.config.js`는 시연 빌드에만 그림 모듈을 선택하고, CI는 운영·시연 Android export 뒤 `node scripts/verify-mobile-variant-assets.mjs`로 원본 PNG 바이트가 운영 bundle에는 없고 시연 bundle에는 있는지 확인합니다. 이 JS export와 자산 검사는 서명 APK 설치·실기 검증을 대신하지 않습니다.

Expo SDK 57의 같은 계열 권장 패치와 개발 도구 `tsx`를 lockfile과 함께 갱신했습니다. `CI=1 npx expo install --check`와 두 Android export는 PASS지만 `npm audit` 중간 등급 15건은 상위 CommonJS·Expo 호환 수정이 필요해 [B-008](../../docs/BLOCKERS.md)에 남깁니다. `npm audit fix --force`로 SDK를 임의 변경하지 않습니다.

시연 APK 빌드 게이트는 저장소 루트의 `scripts/build-showcase-apk.sh`입니다. `--check`는 **로컬 설정만** 확인하며 APK를 만들지 않습니다. 전용 Google Web client ID와 운영 Web client ID, 저장소 밖 mode 600 전용 keystore·별칭·공개 SHA-256 지문을 요구하고 운영/개발 값 재사용을 거절합니다. 두 ID와 지문은 공개 식별자지만 비밀번호는 채팅·Git에 넣지 않습니다. `--build`는 기본적으로 키 비밀번호를 로컬 터미널에서 받으며, 이 Mac의 명시적 `MASSCOM_SHOWCASE_USE_KEYCHAIN=1` 모드에서만 고정된 시연 Keychain 항목을 읽습니다. 셸 추적을 켠 빌드는 비밀번호 조회 전에 거절합니다. [실제 빌드·폰 설치·Release 재다운로드](../../docs/evidence/showcase-android-apk-2026-09-27.json)에서 `.demo` package·소스 커밋·인증서·SHA-256·지갑 금지 표면을 검증했습니다. 시연 키의 로컬 Keychain 보관은 백업 완료를 뜻하지 않습니다.

## 개발용 UI 시안과 로컬 실행 (Issue #136)

운영 앱의 기본 화면은 `탐색 · 지도 · 방문 인증 · 도감 · 친구` 다섯 탭(내 정보는 머리글 아바타)입니다. 개발 빌드에서 로그인한 뒤 `내 정보 → 역할 선택 시안 보기`를 열면 `누구세요?` 역할 카드, 선택적 외부지갑 안내, 내용 없는 다섯 공간의 스와이프를 확인할 수 있습니다. 이 시안은 실제 점포·방문·혜택이 아니며 점주 선택으로 권한이 생기지 않습니다. release 빌드에서는 개발용 미리보기 진입점이 없고 미리보기 URL도 기본 화면으로 돌아갑니다.

시연 앱 `.demo` 전용 코드에는 로그인 전 역할 선택, 고객의 기존 탭 진입, 점주의 서버 `CONFIRM_VISIT` 확인, 고객 설정에서 열 수 있는 빈 다섯 공간 투어를 추가했습니다. 점주 선택만으로 발급 권한을 주지 않고, 가상 점포에 권한이 없으면 거절 안내를 표시합니다. 별도 시연 OAuth·공개 API/DB·서명 APK의 **Google 로그인·가상 점포 탐색·STAFF 발급·같은 계정 카메라 QR 수령은 폰에서 PASS**이며 두 계정 카메라 QR 수령과 지갑은 `NOT_RUN`입니다. 시연 지갑은 전용 Reown 프로젝트 전까지 비활성으로 남습니다.

새 소스의 고객 방문 탭에는 2분 식별 QR을 발급·갱신·폐기하는 화면이 있고, `.demo`의 STAFF 화면은 그 QR 촬영→같은 확인 코드 대조→실제 이용 확인→기존 1회 수령 QR 발급으로 이어집니다. 원시 고객 계정 ID는 시연 STAFF 화면에 표시하지 않습니다. 기존 공개 Preview 3 APK와 외부 시연 API는 이 변경 전 상태이므로 새 흐름의 두 기기 촬영·수령은 아직 `NOT_RUN`입니다.

해당 브랜치에서 개발용 Android 앱을 빌드하려면 Node.js, Android SDK 및 호환 JDK와 USB 디버깅 기기 또는 에뮬레이터가 필요합니다. Windows PowerShell에서:

```powershell
cd apps/mobile
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npx expo run:android --device
```

첫 실행은 네이티브 개발 앱을 생성·빌드·설치하고 개발 서버를 실행합니다. UI 코드만 바뀐 다음 실행은 `npx expo start --dev-client`로 충분합니다. 네이티브 의존성이 바뀌면 다시 빌드합니다. Expo Go는 이 앱의 네이티브 로그인·지갑 모듈 실행 환경이 아닙니다.

개발 앱 `kr.masscom.wolgye.dev`는 운영 앱 `kr.masscom.wolgye`와 함께 설치할 수 있으며, 기존 개발 앱이 있으면 그 앱을 업데이트합니다. 미리보기 진입에는 기존 개발 로그인 설정이 필요하고, 실제 지갑 연결은 원래 API·Google·Reown 개발 설정을 사용합니다. `.env.example`의 loopback API를 USB 연결 기기에서 사용할 때는 API 실행 후 `adb reverse tcp:3000 tcp:3000`을 설정합니다. `npm run export:android`는 JS 번들 검증이며 설치용 APK 생성은 아닙니다.

Expo SDK 57 development build에서 음식점을 탐색하고, 점주 1회 코드로 방문·보상권·도감을 기록하며, 선택적으로 Reown 외부 지갑 주소를 확인하는 Android 앱입니다.

## 현재 상태

- Expo Router 화면·Reown AppKit·Ethers adapter: `IMPLEMENTED`
- 탐색·방문 인증·도감·내 정보 네 기본 탭과 간결한 화면 구조: `VERIFIED`; 자동 146개·typecheck·lint·Android export, Samsung Android 16의 360dp·200% 글씨·실시간 다크 모드·뒤로 가기·개발 scheme PASS. TalkBack 서비스·포커스는 부분 확인, 앱 콘텐츠 낭독은 `NOT_RUN`([증거](../../docs/evidence/android-ui-navigation-2026-09-23.json))
- 친구 탭·친구 여권·가게 추천·친구 링크 열기(Issue #230, D-047): `IMPLEMENTED`(소스와 로컬 확인까지). 친구 탭(`src/screens/friends/`)은 내 카드(별명 바꾸기·큰 친구 코드·QR·시스템 공유·확인 창이 있는 코드 바꾸기), 8자리 코드 입력 또는 QR 촬영 추가(QR·링크로 온 코드는 확인 창을 거치고 내 코드는 알림만), 친구 순위(어제까지 기준)를 보인다. 순위 행을 누르면 친구 여권(`/friends/[friendshipId]`)이 열려 읽기 전용 메달 3종·배지 n/9·가본 가게 이름 도장판과 확인 창이 있는 친구 끊기(끊은 직후 내 코드 바꾸기를 권함)를 보인다. 가게 카드·상세의 `친구에게 추천`은 가게 이름과 링크만 시스템 공유창으로 보낸다. `/open#friend=CODE`·`#merchant=ID` 링크는 각 빌드가 자기 링크만 받고(운영 `masscom://`·`masscom.kr`, 시연 `masscom-demo://`, 개발 `masscom-dev://`·`masscom.kr`) 운영과 개발은 같은 `masscom.kr` https 링크를 쓰므로 둘 사이는 격리되지 않고(서로의 https QR이 상대 API까지 간다) 시연 앱만 https 링크 없이 `masscom-demo://` QR과 앱 받기 안내만 낸다. Android 앱 링크는 운영·시연에만 등록돼 있고 개발과 `www.masscom.kr`은 스캐너·붙여넣기로만 열린다. 자동 시험 598개, 로컬 API와 개발 앱 실폰(SM-S928N) 확인은 [시험 상태](../../docs/TEST_STATUS.md)에 있다. 시스템 공유창·실제 App Link·시연 링크 열기는 `NOT_RUN`
- 사장님 AI 가게 그림(Issue #236, D-048·D-050): `IMPLEMENTED`(소스와 로컬 확인까지). 점주 화면(`src/screens/merchant-art/`, 데이터는 `src/merchant-art/`)은 시연 앱의 점주 모드 카드에서 열리고(스택 경로 `/merchant-art`는 시연 앱과 로컬 개발 빌드에서만, 운영 앱에는 없음) AI 시안 4장 → 하나 고르기 → 고급 그림 → "가게 그림으로 쓰기"·기본 그림으로 되돌리기를 확인 창(하나만 열림)을 거쳐 진행하고 3초마다 서버를 조회한다. 최종이 실패하면 실패 문구와 함께 시안 격자가 남아 같은 라운드에서 다시 고를 수 있다(새 최종으로 하루 한도에 센다). 한 번에 한 단계만 돌리는 문과 오래된 다시 읽기를 버리는 규칙은 `owner-steps.ts`에 React 밖 순수 함수로 있고 행동으로 시험한다. 고객 화면(목록 문장·지도 핀·도장판·도감 수집품 카드·상세 상단)은 `merchantArt` 다리 하나로 서버 그림 → 시연 번들 그림 → 글자 도장 순으로 정하며, 서버 그림이 불러오기에 실패하면(초기화돼 404가 된 주소를 가리키는 오래된 카탈로그) 글자 도장(상세는 하늘)으로 돌아간다. 도감 카드의 서버 그림 안내는 "사장님이 고른 AI 그림"이고 시연 번들 그림만 "실제 NFT 발행 증거 아님"을 붙인다. 새 의존성·번들 그림은 없다. 서버 키·예산·권한(운영 STAFF 불가)은 [API README](../api/README.md). 실제 OpenAI 호출·기기의 준비 중·하루 한도 화면·TalkBack·시연 APK는 `NOT_RUN`.
- 첫 로그인 동의 화면·약관 링크(Issue #253, D-059): `IMPLEMENTED`(소스와 자동 시험까지, 운영 `kr.masscom.wolgye`·시연 `.demo` **같은 코드**). 로그인 직후 `GET /me/consent`가 `required`이면 점주 화면·메인 탭보다 앞에 전체 화면 `ConsentScreen`(`src/screens/consent/`, 문구·버전 `src/privacy/consent-copy.ts`)이 뜬다: 필수 세 개(만 14세 이상, 이용약관, 개인정보 수집·이용)를 모두 눌러야 "동의하고 시작"이 켜지고, 개인정보 수집·이용 안내 네 가지(목적·항목·보유 기간·거부할 권리와 불이익)와 이용약관·처리방침 링크를 보여 준다. 체크박스는 `accessibilityRole="checkbox"`·`checked` 상태, 링크는 `link` 역할, 상태 문구는 `polite` 안내이고 세로 스크롤·글자 크기 제한 없음(200% 대비)이다. 서버가 이 앱이 보여 주는 문구와 다른 버전을 요구하면 옛 문구에 동의를 받지 않고 업데이트를 안내하며, 확인 실패는 다시 시도·로그아웃을 준다. 동의를 물을지의 판단은 순수 함수 `shouldAskConsent`(첫 로그인·같은 계정·계정 전환·로그아웃 뒤 다른 계정·API 없음·DEMO를 시험)이고, 확인 실패·업데이트 필요 화면의 로그아웃은 동의 거부가 아니므로 중립적인 "로그아웃"이며 체크 상자는 글자 크기에 비례해 커진다. 수집 항목 안내는 "등(자세한 항목은 개인정보 처리방침)"으로 끝난다. 동의 여부는 기기에 저장하지 않고 실행마다 서버에 묻는다. 내 정보에는 이용약관·개인정보 처리방침·계정 삭제 안내 링크 카드가 있다(삭제 요청 화면은 그대로). 시연 [Preview 12 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.12)를 Samsung SM-S928N에서 확인했다([증거](../../docs/evidence/showcase-preview12-release-2026-09-30.json)): `사용자예요` 뒤 전체 화면 동의 화면이 뜨고, 세 개 중 두 개만 체크하면 `동의하고 시작`이 꺼져 있고 세 개를 모두 체크하면 켜지며 제출하면 탐색 목록으로 넘어간다. `이용약관 보기`는 Chrome을 열고 내 정보에 세 링크가 보인다. **당시 알려진 결함(Preview 12):** 세 개를 모두 체크하면 켜진 버튼 글자가 `동의하고`까지만 보이고 `시작`이 잘렸다(동작은 정상). 원인 수정은 Issue #271(`alignSelf: 'stretch'`)이고, 운영 [test.4 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.4)를 Samsung SM-S928N에서 확인했다([증거](../../docs/evidence/operating-android-test4-2026-10-01.json)): 전체 화면 동의 화면이 뜨고 세 개를 체크하면 버튼이 `동의하고 시작`으로 전부 보인다(uiautomator TextView [124,1805][958,1873]; 수정 전 후보는 [410,1805][670,1873]). 동의는 실제 계정이라 제출하지 않았다. 시연 [Preview 13 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.13)는 같은 소스(`1e6bb37`)이지만 동의 화면의 버튼 글자는 그 APK에서 다시 확인하지 않았다([증거](../../docs/evidence/showcase-preview13-release-2026-10-01.json)). 동의 거절→로그아웃 경로·앱 안 링크 대상 페이지의 내용·동의 제출 뒤의 운영 앱 흐름·TalkBack·다크·글자 200%는 `NOT_RUN` **2026-10-01 이후:** 처리방침 버전이 `privacy-2026-10-01`로 올라 서버가 새 버전을 요구하므로 새 버전에 동의하지 않은 계정은 운영 test.4와 시연 Preview 12·13에서 '앱을 업데이트해 주세요' 안내에 막힌다. 운영 [test.5 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.5)는 Samsung SM-S928N에서 test.4 위에 설치하자 새 버전의 동의 화면이 업데이트 안내가 아니라 `필수`로 나타났고 세 개를 체크하면 `동의하고 시작`이 전부 보였다([증거](../../docs/evidence/operating-android-test5-2026-10-01.json)). 동의는 실제 계정이라 제출하지 않았다(소유자가 제출). 시연 [Preview 14 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.14)는 설치와 로그아웃 상태 탐색 화면만 확인했고 동의 화면은 열지 않았다([증거](../../docs/evidence/showcase-preview14-release-2026-10-01.json)).
- 늦은 응답 정리와 동의 버튼 글자 잘림(Issue #265): `IMPLEMENTED`(소스와 자동 시험까지). 도감(`src/commerce/collection-recovery.ts`)은 확정 알림과 조회 종료를 나눠 대기 중인 NFT가 남아 있으면 계속 다시 묻고 요청 세대로 오래된 응답만 버린다. 수령 코드(`src/commerce/claim-inspect.ts`)는 입력이 바뀌면 이전 코드의 확인 응답을 버리고 확정은 현재 입력만 대상으로 한다. 삭제 접수번호는 다시 받기가 응답 없이 실패하면 이전 번호를 지운다. 동의 시작 버튼 글자는 상태별 `key`로 새로 그려 Samsung 실기의 잘림을 막는다. 동의 버튼 전체 문구의 실기 확인은 다음 시연 빌드까지 `NOT_RUN`.
- 이메일·소셜·내장 지갑·구매·스왑 UI: 명시적으로 비활성화
- 거래·approve·permit 요청: 앱 메서드 경계에서 거절
- Android 16 / arm64 / 16KB AVD debug APK 빌드·설치·실행: `VERIFIED`
- Samsung SM-S928N / Android 16 debug APK 설치·Metro 실행·홈 복귀·콜드 스타트: `VERIFIED`
- 지갑 없는 음식점 목록·상세와 점주 발급→고객 수령→도감: `VERIFIED` (loopback DEMO)
- 미방문·다음 보상 이유가 보이는 다음 가게 추천과 상세 복귀: `VERIFIED` (loopback DEMO)
- 외부 지갑 확인 뒤 NFT 공개 안내→접수→Worker 이벤트 대조→도감 등록 완료: `VERIFIED` (Local Anvil)
- 앱 수집품과 실제 NFT, 접수·확인 중·등록 완료·확인 필요 상태 분리: `VERIFIED`
- 계정 삭제 전 공개 장부·외부 지갑·제출 거래 보존 안내와 loopback DEMO 요청: `VERIFIED`; bearer 계정에는 외부 웹 삭제 요청 링크를 제공하고(웹 Google 로그인 접수 → 접수번호 → 24시간 취소 → 운영자 7일 처리, [D-052](../../docs/DECISIONS.md)) 시연 앱은 앱 안에서 접수·취소·접수번호 다시 받기·접수번호로 처리 상태 조회를 한다: `IMPLEMENTED`(자동 시험). 새 설치본 실기와 폐기용 실계정 종단 실행은 `NOT_RUN`, 직접 fresh reauthentication 삭제는 `BLOCKED`([B-020](../../docs/BLOCKERS.md))
- Google ID token→서버 Bearer session→SecureStore 복원·로그아웃 코드와 실제 Samsung 첫 로그인·복원·logout revoke: `VERIFIED`; 두 Google 계정의 전체 전환·이전 데이터 부재 D02는 `NOT_RUN`
- MetaMask 8.11.0 설치·첫 화면 실행: `VERIFIED` — 지갑 생성·가져오기는 수행하지 않음
- 실제 Reown project ID·`kr.masscom.wolgye.dev` MetaMask 연결·서명·자동 복귀·콜드 스타트 서버 binding 복원: `VERIFIED`; 운영 release package와 W04·W05 외부 환경은 `NOT_RUN/BLOCKED`
- Reown 지갑 승인 화면의 앱 이름·공식 URL은 `월계 마스코트`·`https://masscom.kr`로 설정하고 기존 포털 표식을 `https://masscom.kr/assets/wallet-mark.svg`에서 실제 HTTPS 200·`image/svg+xml`로 제공. 변경 후 MetaMask 재연결은 기기 지갑 잠금으로 `BLOCKED`, 운영 release 재연결은 `NOT_RUN`([증거](../../docs/evidence/domain-wallet-origin-2026-09-23.json))
- Android 시연 Preview 3의 같은 계정 카메라 QR 촬영→수령: `VERIFIED`; 두 계정·두 기기 QR, 운영 앱, 오프라인·권한 거부는 `NOT_RUN`. 수동 1회 코드 입력은 별도 `VERIFIED`
- 운영 package ID `kr.masscom.wolgye`(개발 `kr.masscom.wolgye.dev`), scheme `masscom`/`masscom-dev`: `IMPLEMENTED`
- 계정 삭제 접수 시 지갑 연결 해제 및 기기 WalletConnect 세션 제거: `IMPLEMENTED`
- upload key 파일·공개 SHA-256 핀(test.4 APK도 같은 업로드 키 인증서로 서명: [증거](../../docs/evidence/operating-android-test4-2026-10-01.json), test.5 APK의 인증서 접두도 같음: [증거](../../docs/evidence/operating-android-test5-2026-10-01.json)), [test.3 AAB/APK](../../docs/evidence/operating-android-test3-2026-09-28.json)의 Samsung 4KB 고객 Google 로그인·콜드 세션 복원과 Android 36 16KB AVD 설치·콜드 실행: `VERIFIED`. App Link 도메인은 verified지만 이 폰의 자동 열기 설정은 disabled; Play Console 제출: `NOT_RUN`

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

`https://masscom.kr`은 지갑에 보이는 서비스 정체성, `https://api.masscom.kr`은 실제 API·SIWE 주소 확인 서버입니다. 지갑 메타데이터를 고쳐도 체인·nonce·도메인 검증 주소나 `masscom-dev://wallet`/`masscom://wallet` 복귀 스킴을 바꾸지 않습니다.

- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`: Google ID token의 서버 audience로 쓰는 공개 Web OAuth client ID. client secret이 아님
- `EXPO_PUBLIC_DEMO_ACCOUNT_ID`: 고객 loopback 데모 계정
- `EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID`: 점주·직원 loopback 데모 계정
- `EXPO_PUBLIC_DEMO_MERCHANT_ID`: 위 계정이 실제 PostgreSQL 멤버십을 가진 데모 점포

## 운영 Google 로그인 설정

- 고정 native 의존성: `react-native-nitro-google-signin@2.3.0`, `react-native-nitro-modules@0.37.1`, Expo SDK 57 호환 `expo-secure-store@57.0.4`
- Web OAuth client ID는 `POST /auth/google`에서 검증할 ID token audience이며 API의 `GOOGLE_OAUTH_CLIENT_IDS`와 앱의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`가 같은 승인 값을 가리켜야 합니다.
- 시연 앱만 `MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID`를 공개 Web audience로 사용합니다. 실제 시연 API의 `GOOGLE_OAUTH_CLIENT_IDS`에도 **같은 시연 전용 ID만** 설정하며 운영 API의 audience 목록에는 넣지 않습니다. Android OAuth client는 `kr.masscom.wolgye.demo`와 시연 전용 서명 인증서 SHA-1로 별도 등록했습니다([설정 근거](../../docs/evidence/showcase-oauth-2026-09-26.json)). 서버의 전용 audience·운영 audience 거절은 내부 API에서, 실제 `.demo` APK의 초대 Google 로그인은 [Samsung 실기](../../docs/evidence/showcase-android-apk-2026-09-27.json)에서 PASS입니다.
- Android OAuth client는 package/SHA 조합별로 별도 생성합니다. 개발 package `kr.masscom.wolgye.dev`와 운영 package `kr.masscom.wolgye`, 각 서명 인증서 SHA-1을 Google Cloud에 정확히 등록해야 합니다. 목표 인프라를 만들었다는 사실만으로 실제 로그인 PASS가 되지 않습니다.
- Android는 explicit Web client ID와 React Native native autolinking을 사용합니다. Nitro Expo config plugin v2.3.0은 iOS reversed client ID 또는 Firebase 파일을 요구하므로, 현재 Android-only 범위에서 가짜 iOS 값을 만들지 않고 등록하지 않았습니다. iOS 지원 시 실제 iOS OAuth client와 함께 추가해야 합니다.
- 서버가 돌려준 `{ sessionToken, accountId, expiresAt }`는 SecureStore key `masscom.auth.session.v1`의 version 1 레코드에만 저장합니다. AsyncStorage·URL·화면·로그·증거 JSON에는 session token을 넣지 않습니다.
- 운영·시연 Google 계정 API는 `Authorization: Bearer <sessionToken>`만 보냅니다. development DEMO는 `x-account-id`만 보내며 한 요청에서 두 방식을 섞지 않습니다.
- 로그아웃·계정 전환은 서버 logout 시도 → SecureStore 삭제 → Reown disconnect와 저장 key 삭제 → Google sign-out 순서입니다. 계정 전환은 이 정리가 끝난 뒤 새 Google 로그인을 시작하고 account ID key로 route와 AppKit을 다시 만듭니다.
- Google mobile sign-in의 `signIn`/`createAccount`는 삭제 요청에 필요한 fresh `auth_time`을 보장하지 않습니다. `getTokens`나 `presentExplicitSignIn`을 재인증 증거로 사용하지 않으며 운영 계정 삭제는 승인된 별도 사용자 확인 설계 전까지 `BLOCKED`입니다. 앱 안 직접 삭제는 그대로 막히고, 삭제 요청은 D-052의 웹 접수(운영 앱)·앱 안 접수(시연 앱) 뒤 운영자가 처리하는 별도 경로로 받습니다.

## development build

```bash
npx expo prebuild --clean --platform android --no-install
ANDROID_HOME="$HOME/Library/Android/sdk" ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
  ./android/gradlew -p android assembleDebug
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
npx expo start --dev-client --host localhost
```

`apps/mobile/app.config.ts`는 빈 값/`development`, `showcase`, `production`을 명시 분기합니다. 미지 variant는 거절하며 기본값은 기존 개발 package `kr.masscom.wolgye.dev`/`masscom-dev`입니다. 시연 package/scheme은 `kr.masscom.wolgye.demo`/`masscom-demo`, 운영은 `kr.masscom.wolgye`/`masscom`입니다. 다른 variant로 native prebuild를 바꿀 때는 별도 checkout을 사용합니다.

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
- A02 Android 릴리스: GitHub APK 재다운로드·4KB/16KB 실행·HTTPS `/open` 복귀 PASS
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

도감의 대표 진열·마스코트 반응 기록은 계정별로 이 기기에 저장하고, 다른 계정이 로그인하면 이전 계정 기록을 지웁니다(같은 `@masscom:collection:<tag>:` 방식, `src/screens/collection/collection-prefs.ts`). 같은 계정이 로그아웃했다가 다시 로그인하면 자신의 기록은 그대로 남아 있습니다: 로그아웃 자체는 지우지 않고, 다른 계정이 현재 계정이 될 때만 정리합니다(지갑 세션은 로그아웃 때도 지우는 것과 다릅니다).

## 사진 수집품 도감 상세

고객 공통 도감은 서버에 `artwork`가 있는 실제 보상에만 정적 썸네일·상세 버튼을 추가합니다. 상세를 열 때 보유자 API에서 가공된 미디어를 읽으며, 수령 성공 화면의 "받은 수집품 보기"는 수령이 끝난 뒤 도감을 읽어 받은 보상에 `artwork`가 실제로 붙어 있을 때만 보이고(여러 보상이면 가장 높은 방문 목표, 조회 실패·외형 없는 기존 보상이면 버튼 생략), 그 권리 ID만 전달합니다. 운영자가 게시 사진을 내려 `artwork`가 없어진 수집품은 이름만 있는 기존 카드로 보이고 상세(404)는 재시도 없이 "다시 볼 수 있는 사진이 없어요·받은 기록과 보상은 그대로"로 안내합니다. 회전·두께·대사·음성·이야기 다시 보기/건너뛰기를 제공하고 닫기·계정 변경·탭 이탈·백그라운드에서는 재생과 늦은 응답을 정리합니다.

새 `expo-audio` native 모듈은 선택 음성 재생용입니다. 마이크·녹음·백그라운드 권한을 켜지 않고(`expo-audio` 플러그인 설정과 별개로 `android.blockedPermissions`가 모든 variant에서 `RECORD_AUDIO`를 막고 `src/config/build-environment.test.ts`가 고정합니다) 기존 APK에 JS만 바꿔 적용할 수 없으므로 새 native 빌드가 필요합니다. 운영·시연 공통 코드이나 API·package·가상 자산 격리는 유지합니다. Android의 재질은 게시된 완성 정면 이미지이며 웹처럼 각도별로 빛을 다시 합성하지 않습니다. 실기기·native 빌드 검증 상태는 [TEST_STATUS](../../docs/TEST_STATUS.md)를 참고하세요.

보유자 응답의 v2 필드(`backImageDataUrl`/`angleFrames`/`living`/`motions`, [Issue #284](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/284) WP4, 2026-10-01)는 모두 선택이며, 한 필드가 유효하지 않으면 그 필드만 버리고 상세는 그대로 보여줍니다(`src/commerce/collectible-artwork.ts`). 있으면 뒷면 이미지, 각도 프레임 스프라이트의 가장 가까운 두 칸을 섞은 정면(`angleFrameBlend`), `box` 안에서 칸이 돌아가는 living picture 오버레이(`livingCell`), confetti 계열 모션의 입자 종류(`particleAt`, `src/screens/collection/collectible-motion.ts`, 공유 벡터는 `tests/fixtures/collectible-vectors.json`)를 씁니다. 회전·장면·living 갱신은 60ms 티커 하나로 돕니다. 모션 자동재생은 방문 수령 직후 열렸을 때(`intro` prop)만 once 모션을 순서대로 보여준 뒤 첫 loop 모션으로 넘어가고, 나중에 도감에서 열면 loop 모션만 자동재생하며 "획득 장면 다시 보기"로 once 모션을 다시 볼 수 있습니다. "기울여 보기" 토글은 새 `src/screens/collection/collectible-tilt.tsx`의 `<TiltSensor>`가 이미 설치된 Reanimated `useAnimatedSensor(GRAVITY)`로 구현하며(새 의존성·권한 없음) 토글 켜짐·동작 허용·앱 foreground일 때만 마운트합니다. 동작 줄이기에서는 자동재생·기울임이 꺼지고 living은 0번 칸, 파티클 없음, 수동 각도 슬라이더만 여전히 동작합니다. 웹 편집기가 아직 뒷면·프레임·living을 만들지 않는 수집품(WP2·WP3 전)은 이 단락 전의 v1 모습이 그대로 폴백입니다. 실기기·에뮬레이터 검증은 `NOT_RUN`(WP3 자료와 새 빌드가 필요).

## 도감 수집 경험 (Issue #283)

방문 수령으로 `artwork`가 붙은 보상을 받으면(`src/screens/collection/collectible-reveal.tsx`) 봉투 열기 연출(아래 Issue #297)로 보여줍니다. 언제든 건너뛸 수 있고, 보관은 연출 이전에 이미 끝난 상태라 건너뛰어도 보상에는 영향이 없습니다.

## 봉투 열기 연출 (Issue #297)

방문 수령으로 한 번에 받은 수집품 전부(1·3·5회 목표가 겹치면 여럿)를 봉투 하나에 담아 엽니다: 봉투(마스코트 나뭇잎 문장 직접 그림, 참고 영상의 로고·카드 틀·팩 디자인은 쓰지 않음)를 탭하거나 아래로 스와이프 → 흔들림·빛과 함께 찢어져 열림 → 수집품이 한 장씩 뒤집혀 나오며(그 등급에 `shine`/`sparkle` 모션이 있으면 더 진한 두 번 스윕, 없으면 한 번의 가벼운 빛 스윕) 계정에 처음 받은 것이면 NEW 표시, 좌우 스와이프나 탭으로 다음 카드 → 끝 카드에서 "도감에 보관했어요"와 그 가게 시리즈 진행(`store-series.ts` 재사용, 새 보상 규칙 없음), 전체 보유 종류 수가 5/10/20…을 막 넘겼으면 "N종류 달성!"을 보여주고 "자세히 보기"(첫 카드 상세로 `intro` 진입)·"닫기" 버튼을 제공합니다. 언제든 건너뛸 수 있고 무작위 요소는 없습니다(이미 정해진 보상을 보여줄 뿐).

새 디렉터리 `src/screens/collection/envelope/`: `envelope-state.ts`(순수 함수 — 카드 넘기기/되돌리기, 그룹화(`collectible-groups.ts`) 재사용한 NEW 판정, 분포 종류 수 문턱 교차 판정, 배치의 가게 시리즈 찾기, 전부 단위 테스트), `envelope-reveal.tsx`(idle→tearing→cards→end 연출), `envelope-card.tsx`(카드 뒤집기), `envelope-glyphs.tsx`(손으로 그린 봉투·나뭇잎 문장 SVG). 봉투 찢기 전환은 획득 연출이 이미 쓰던 `reveal-lifecycle.ts`의 `RevealLifecycle`을 그대로 재사용합니다(동작 줄이기면 애니메이션 없이 바로 넘어가고, 백그라운드로 가면 즉시 완료, 언마운트 시 타이머 정리) — 단 이 인스턴스는 사람이 실제로 탭한 뒤에만 만들어, 열지 않은 봉투를 백그라운드만으로 자동으로 찢지 않습니다. `claim-redeem/index.tsx`는 방문 수령으로 외형이 붙은 보상 전부를 목표 순서대로 모아 `entitlement` 파라미터에 쉼표로 묶어 넘기고, `collection/index.tsx`는 그 목록을 전부 해석해(`resolveCollectibleLink`를 id마다 호출) 봉투에 넘깁니다.

도감의 "내 수집 앨범" 절(`src/screens/collection/collectible-browser.tsx`)은 가게·시즌(테마 이름)·등급으로 걸러보고 최신순·가게순·등급순으로 정렬합니다. `artwork`가 있는 보상은 정적 썸네일 카드로, 같은 게시 수집품(발행 ID+등급)을 여러 캠페인 주기에 걸쳐 여러 번 받았으면 한 장에 개수와 받은 날짜(`earnedAt`)를 함께 보여 줍니다(`src/screens/collection/collectible-groups.ts`). 좋아하는 수집품은 "대표 진열"에 최대 6개까지 놓을 수 있고 이 기기·계정에만 저장하며, 공유는 썸네일·가게 이름·짧은 문구를 담은 이미지를 OS 공유 시트로만 내보냅니다(`src/screens/collection/collectible-share.tsx`, 자동 게시·전송 없음).

같은 절의 "가게별 시리즈"는 그 가게의 기존 방문 목표(1·3·5회)를 칸으로 보여 받은 칸·다음 목표를 표시합니다(`src/screens/collection/store-series.ts`). 새 보상 규칙이나 확률은 만들지 않고 서버가 이미 내려주는 방문 목표·수집 상태만 읽습니다. 첫 수집품, 새 가게의 첫 수집품, 가게 시리즈 완성 때 마스코트가 짧게 반응하며(`src/screens/collection/mascot-reactions.ts`), 같은 반응은 계정별 로컬 기록으로 한 번만 보입니다.

### 접이식 앨범 홈 (Issue #296, Option A)

탐색(홈) 머리글 아래에는 보상 상자 요약 카드가 한 장 있습니다(`src/gamification/home-reward-card.tsx`): 지금 열 수 있는 상자가 있으면 그 상자를, 없으면 다음 목표 상자와 남은 배지 수를 보여주고 "상자 열기"는 도감과 같은 흐름(`RewardBoxCard`)·같은 `RewardReveal` 연출을 그대로 씁니다. 상자 안 쿠폰을 그 자리에서 "사용하기"하면 도감의 보상 절로 이동합니다(실제 사용은 도감에서).

도감 첫 화면은 전체 여권 카드 대신 압축 띠("골목 탐험가 · 배지 4/9")만 머리글에 두고, 그 아래 "내 수집 앨범"을 가장 먼저 보여줍니다. 예전에는 `artwork`가 없는(그림 없는) 수집품을 "앱에서 받은 수집품"이라는 별도 평면 목록으로 다시 그렸는데, 같은 보상이 그림 있는 절과 없는 절 어디에도 속하지 않아 "두 번 보이거나 아예 안 보이는" 혼선이 있었습니다. 지금은 `ungroupedCollectibles`(`src/screens/collection/collectible-groups.ts`)가 그림 없는 수집품만 골라 같은 앨범 그리드에 한 번씩만(`LegacyCard`) 합치고, 그림 있는 쪽 그룹 카드는 묶인 수집품마다 자기만의 실제 NFT 상태·민트 버튼을 갖습니다(`entitlements` 필드, `nftGroupSummary`로 "실제 NFT 1개 · APP 2개"처럼 요약). 메달·배지 더보기(전체 여권+메달), 쿠폰·NFT 발행 현황(보상 상자+내 쿠폰), 도장판·방문 기록은 기본 접힘 폴드(`src/ui/fold.tsx`)로 밀려났고, 각 폴드는 역할이 button이며 펼침/접힘을 라벨로도 말합니다(색만으로 구분하지 않음). 발행 오류·지갑 배너는 폴드 밖, 앨범 바로 아래에서 항상 보입니다. 기존 민트 신청·쿠폰·추천·방문 기록·대표 진열·공유·가게별 시리즈 기능과 보상·양도 규칙은 그대로입니다.
