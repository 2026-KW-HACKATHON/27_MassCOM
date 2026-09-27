# Android 설치본과 GitHub 배포 상태

상태 확인일: 2026-09-27. 저장소는 `PRIVATE`이며, GitHub Release 파일은 저장소 읽기 권한이 있는 계정에서만 내려받을 수 있습니다. GitHub 소스 ZIP은 설치용 APK가 아닙니다.

| 구분 | package | GitHub 다운로드 | 실제 상태 |
| --- | --- | --- | --- |
| 운영 테스트 앱 | `kr.masscom.wolgye` | [test.2 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.2) | `VERIFIED` — 당시 APK 재다운로드 해시·Samsung/AVD 설치·App Link 확인. **최신 `main` UI와 동일한 빌드가 아님** |
| 시연 앱 최신 | `kr.masscom.wolgye.demo` | [Preview 2 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.2) | `VERIFIED` — 점포별 그림 카드의 [Samsung 라이트·다크·200% 글자](evidence/showcase-collectible-art-2026-09-27/device-check.json)와 재다운로드 해시·바이트 일치. 이 APK에서 방문 수령은 재실행하지 않음 |
| 시연 앱 이전 | `kr.masscom.wolgye.demo` | [Preview 1 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.1) | `VERIFIED` — [두 계정 실기](evidence/showcase-two-account-phone-2026-09-27.json)의 점주 발급→고객 직접 코드 수령→중복 거절·도감. 새 점포별 그림은 없음 |

시연 **웹**은 앱 설치와 별개입니다. [공개 주소](https://www.masscom.kr/preview/)에서 다운로드 없이 볼 수 있고, [웹 전용 GitHub 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)에는 정적 HTML/CSS ZIP만 있습니다. 이 태그에 Android APK는 없으며 가상 점포·예시 수집품을 실제 방문·NFT 발행 실적으로 보지 않습니다. [www 전환 증거](evidence/www-web-cutover-2026-09-25.json)를 참고하세요. 기존 Vercel 주소는 복구용으로 보존합니다.

시연 앱을 운영 API에 연결하거나, 운영 APK를 시연용으로 이름만 바꾸어 게시하지 않습니다. 로컬 개발 앱 `kr.masscom.wolgye.dev`에서 가상 점포의 수동 코드 흐름을 확인한 결과도 시연 APK 완성과 다릅니다.

## 설치 방법

1. 접근 권한이 있는 GitHub 계정으로 로그인하고 원하는 앱의 Release에서 `.apk`를 내려받습니다. 운영 테스트 앱과 시연 앱은 이름·package·데이터가 다릅니다. `.aab` 또는 소스 ZIP은 직접 설치 파일이 아닙니다.
2. APK의 SHA-256을 Release의 `SHA256SUMS.txt`와 비교합니다. 파일과 체크섬을 모두 신뢰할 수 있는 같은 Release에서 받습니다.
3. Android에서 브라우저의 ‘알 수 없는 앱 설치’ 권한을 이 설치에만 허용하고 설치합니다. 필요하지 않으면 권한을 다시 끕니다.

시연 APK `MassCOM-showcase-android-c53c199.apk`의 SHA-256은 `9e645198fd955602bdb25beedf8411f81e9be11280488af11d32f4da169bd063`이며, 앱 소스는 `c53c199`, 서명 인증서는 시연 전용입니다. APK 내부 버전 이름은 `0.1.0-test.2`이고 Release의 `Preview 1`은 배포 단계 표시입니다. 이 설치본은 Google Play 승인본이 아니고, 최신 운영 코드의 QA 결과를 대신하지 않습니다. 기기에서 지갑 비밀번호·복구 문구를 GitHub 페이지나 이 프로젝트 웹에 입력하지 마세요.

Issue #189의 새 점포별 그림은 [Preview 2 사전 릴리스](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.2)의 `MassCOM-showcase-android-7322470.apk`(SHA-256 `cdc30ef9222c0b2557dc934958e99dce0d4dcd69df6cb7d12916cc57503184e1`)에 포함됩니다. Samsung의 [라이트·다크·200% 글자](evidence/showcase-collectible-art-2026-09-27/device-check.json)를 확인했고 GitHub에서 APK·체크섬을 다시 내려받아 SHA-256 및 로컬 원본과 바이트 일치를 검증했습니다. Preview 1은 이전 그림 없는 설치본으로 보존합니다. 두 버전 모두 카메라 QR 촬영 수령·App Link·외부 지갑/NFT는 미검증입니다.

**로그인 제한 주의:** 현재 Preview 2와 연결된 시연 서버는 두 초대 계정만 허용합니다. Issue #191의 모든 유효 Google 고객 로그인 변경은 로컬 코드·시험 상태이며, PR·서버 배포·새 서명 APK 실기 전에는 이 다운로드로 임의 계정 로그인이 된다고 안내하지 않습니다([정책·게이트](SHOWCASE_AUTH_GUARD.md)). 운영 앱은 고객 화면만 제공하고, 시연 가상 데이터는 운영 API/DB에 넣지 않습니다.

## 두 앱을 각각 게시하기 전 조건

- 운영: 현재 `main` 기준 운영 AAB/APK를 upload key로 빌드하고 source commit·package·서명·SHA-256을 확인한 뒤 실제 기기에 설치해 로그인·탐색·지갑 복귀를 확인합니다. Google Play 설치본은 별도 서명 인증서를 사용하므로 GitHub APK와 구분합니다.
- 시연: 전용 인증·DB의 공개 HTTPS, `kr.masscom.wolgye.demo` 서명·운영 앱과 동시 설치, 실제 기기 두 Google 계정의 점주 발급→고객 직접 코드 수령·도감·중복 거절과 private Release는 확인했습니다. 카메라로 QR을 촬영해 수령하는 경로, 별도 Reown 지갑·NFT, `demo.masscom.kr` App Link는 여전히 미검증입니다.
- 운영 테스트본과 시연 설치본은 각각 다른 private Release에 게시했습니다. 시연 앱의 미완료 기능을 운영 기능으로 표기하지 않습니다. 저장소 공개·Play 제출·일반 공개는 별도 결정입니다.

개발 절차와 분리 기준은 [모바일 README](../apps/mobile/README.md)와 [시연·운영 분리 설계](superpowers/specs/2026-09-23-showcase-production-separation-design.md)를 따릅니다.
