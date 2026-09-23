# Issue #142 파란 UI 일관화 검증

기준: `feat/142-design-consistency`의 코드 `c8197b0` 이후 문서 커밋. 이 파일의 캡처는 로컬 테스트 결과이며 공개 배포나 실제 휴대전화 결과가 아닙니다.

| 범위 | 명령·환경 | 결과 |
| --- | --- | --- |
| 모바일 단위·정적 검사 | `npm test --prefix apps/mobile`, `npm run typecheck --prefix apps/mobile`, `npm run lint --prefix apps/mobile`; macOS, Expo SDK 57 | PASS 180/180, typecheck·lint PASS |
| Android 개발 JS | `EXPO_NO_DOTENV=1 APP_VARIANT=development EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 EXPO_PUBLIC_DEMO_ACCOUNT_ID=showcase-local-customer ... npx expo export --platform android --output-dir /tmp/masscom-design-142-export` | PASS; `.hbc` 1개 생성, 운영/시연 release 빌드 증거 아님 |
| Android 테스트 AVD | Android 36 `MassCOM_Design_QA`, `kr.masscom.wolgye.dev`, `npx expo run:android --device MassCOM_Design_QA --no-bundler`, Metro localhost 8081 | PASS debug APK 빌드·설치·기동. 개발 로그인 게이트의 라이트/다크·200% 캡처. 로그인하지 않은 AVD에서 네 탭은 NOT_RUN |
| 시연 웹 | `node --test tests/site/verify_showcase_site_test.mjs tests/site/verify_showcase_theme_test.mjs` | PASS 19/19; 로컬 Chrome의 `getComputedStyle`, 360/1440px·200%·키보드 초점·정적 요청 경로 확인 |
| 시연 웹 보조 검사 | `python3 scripts/verify-showcase-site.py`, `bash tests/site/check_site_accessibility_test.sh` | PASS; 읽기 전용·가상 고지·의미 구조와 대비 |
| 공통 회귀 | bootstrap·운영 문서·privacy·모바일 접근성 의미·W08 표면 검사용 `tests/*` 스크립트, `git diff --check` | PASS |
| 운영 11개 화면·실제 폰 | 실제 로그인/권한이 있는 빌드와 물리 기기 | NOT_RUN; 색상 factory 자동 시험은 PASS지만 실기 판정으로 대체하지 않음 |
| 시연 Android/공개 HTTPS | 별도 OAuth/Reown·API/DB·DNS가 구성된 환경 | NOT_RUN; Issue #137 후속 |

## 화면 증거

- `web-light-360.png`, `web-dark-360.png`: 로컬 읽기 전용 시연 웹의 모바일 폭 라이트/다크.
- `web-light-1440.png`, `web-dark-1440.png`: 같은 웹의 데스크톱 라이트/다크.
- `android-auth-light.png`, `android-auth-dark.png`, `android-auth-dark-200.png`, `android-auth-dark-200-scrolled.png`: 전용 AVD 개발 앱의 로그인 게이트. 200% 확대에서 스크롤 뒤 로그인 버튼에 접근할 수 있습니다. 개발 메뉴 단추는 Expo dev-client 오버레이이며 운영 앱 요소가 아닙니다.

웹 캡처는 로컬 Chrome `Page.captureScreenshot`, Android 캡처는 `adb -s emulator-5554 exec-out screencap -p`로 생성했습니다. 사용한 `_test` PostgreSQL과 loopback API는 운영 점포·운영 DB와 분리됐고, 이 AVD에서는 로그인 게이트 때문에 방문 수령·보상·NFT 흐름을 실행하지 않았습니다.
