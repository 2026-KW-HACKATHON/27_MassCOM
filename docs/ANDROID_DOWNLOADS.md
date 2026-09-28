# Android 설치본과 GitHub 배포 상태

상태 확인일: 2026-09-29. 기존 대회 조직 저장소는 `PUBLIC`·`Archived`이며 아래 이전 GitHub Release 파일은 로그인 없이 볼 수 있습니다. 현재 개발 저장소 `choijunhuk/MassCOM`은 `PRIVATE`이고 Preview 5는 이 저장소 권한이 있는 계정만 받을 수 있습니다. GitHub 소스 ZIP은 설치용 APK가 아닙니다.

| 구분 | package | GitHub 다운로드 | 실제 상태 |
| --- | --- | --- | --- |
| 운영 테스트 앱 최신 | `kr.masscom.wolgye` | [test.3 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.3) | `VERIFIED` — source `c5cba68`, [서명·GitHub digest·Samsung Google 로그인/복원·16KB 설치](evidence/operating-android-test3-2026-09-28.json) 확인. Play 승인·현장 QR·운영 지갑 실기는 아님 |
| 운영 테스트 앱 이전 | `kr.masscom.wolgye` | [test.2 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.2) | `VERIFIED` — 당시 APK 재다운로드 해시·Samsung/AVD 설치·App Link 확인. 최신 코드가 아님 |
| 시연 앱 최신 | `kr.masscom.wolgye.demo` | [개인 비공개 Preview 5 APK](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.5) | `IMPLEMENTED` — source `88932cb`, [서명·GitHub digest·전용 API 사전검사](evidence/showcase-preview5-release-2026-09-29.json) 확인. **Preview 5 설치·새 2분 고객 식별 QR 휴대전화 실기는 `NOT_RUN`** |
| 시연 앱 이전 | `kr.masscom.wolgye.demo` | [개인 비공개 Preview 4 APK](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.4) | `IMPLEMENTED` — source `6585614`, [서명·GitHub digest·같은 소스의 시연 API HTTPS](evidence/showcase-customer-qr-deployment-2026-09-28.json) 확인. 실제 설치·새 QR 휴대전화 실기는 `NOT_RUN` |
| 시연 앱 이전 | `kr.masscom.wolgye.demo` | [Preview 3 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3) | `VERIFIED` — source `128ce5f`, [서명·GitHub digest](evidence/showcase-preview3-release-2026-09-27.json)와 [같은 계정 Samsung 카메라 15분 수령 QR 촬영→수령](evidence/showcase-preview3-camera-claim-2026-09-28.json) 확인. 새 API에서는 구 STAFF 발급 요청이 호환되지 않으므로 직원 시연은 현재 Preview 5를 사용 |
| 시연 앱 이전 | `kr.masscom.wolgye.demo` | [Preview 2 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.2) | `VERIFIED` — 점포별 그림 카드의 [Samsung 라이트·다크·200% 글자](evidence/showcase-collectible-art-2026-09-27/device-check.json)와 재다운로드 해시·바이트 일치. 이 APK에서 방문 수령은 재실행하지 않음 |
| 시연 앱 이전 | `kr.masscom.wolgye.demo` | [Preview 1 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.1) | `VERIFIED` — [두 계정 실기](evidence/showcase-two-account-phone-2026-09-27.json)의 점주 발급→고객 직접 코드 수령→중복 거절·도감. 새 점포별 그림은 없음 |

시연 **웹**은 앱 설치와 별개입니다. [공개 주소](https://www.masscom.kr/preview/)에서 다운로드 없이 볼 수 있고, [웹 전용 GitHub 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)에는 정적 HTML/CSS ZIP만 있습니다. 이 태그에 Android APK는 없으며 가상 점포·예시 수집품을 실제 방문·NFT 발행 실적으로 보지 않습니다. [www 전환 증거](evidence/www-web-cutover-2026-09-25.json)를 참고하세요. 기존 Vercel 주소는 복구용으로 보존합니다.

휴대전화 브라우저에서 바로 확인하려면 [운영 App Link의 웹 대체 설치 안내](https://masscom.kr/open)를 여세요. 운영 test.3과 시연 Preview 3을 각각 받도록 연결하며, [공개 페이지 실측](evidence/public-open-page-2026-09-28.json)을 기록했습니다.

시연 앱을 운영 API에 연결하거나, 운영 APK를 시연용으로 이름만 바꾸어 게시하지 않습니다. 로컬 개발 앱 `kr.masscom.wolgye.dev`에서 가상 점포의 수동 코드 흐름을 확인한 결과도 시연 APK 완성과 다릅니다.

## 설치 방법

1. 공개 GitHub Release에서 원하는 앱의 `.apk`를 내려받습니다. 운영 테스트 앱과 시연 앱은 이름·package·데이터가 다릅니다. `.aab` 또는 소스 ZIP은 직접 설치 파일이 아닙니다.
2. APK의 SHA-256을 Release의 `SHA256SUMS.txt`와 비교합니다. 파일과 체크섬을 모두 신뢰할 수 있는 같은 Release에서 받습니다.
3. Android에서 브라우저의 ‘알 수 없는 앱 설치’ 권한을 이 설치에만 허용하고 설치합니다. 필요하지 않으면 권한을 다시 끕니다.

시연 APK `MassCOM-showcase-android-c53c199.apk`의 SHA-256은 `9e645198fd955602bdb25beedf8411f81e9be11280488af11d32f4da169bd063`이며, 앱 소스는 `c53c199`, 서명 인증서는 시연 전용입니다. APK 내부 버전 이름은 `0.1.0-test.2`이고 Release의 `Preview 1`은 배포 단계 표시입니다. 이 설치본은 Google Play 승인본이 아니고, 최신 운영 코드의 QA 결과를 대신하지 않습니다. 기기에서 지갑 비밀번호·복구 문구를 GitHub 페이지나 이 프로젝트 웹에 입력하지 마세요.

Issue #189의 새 점포별 그림은 [Preview 2 사전 릴리스](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.2)의 `MassCOM-showcase-android-7322470.apk`(SHA-256 `cdc30ef9222c0b2557dc934958e99dce0d4dcd69df6cb7d12916cc57503184e1`)에 포함됩니다. Samsung의 [라이트·다크·200% 글자](evidence/showcase-collectible-art-2026-09-27/device-check.json)를 확인했고 GitHub에서 APK·체크섬을 다시 내려받아 SHA-256 및 로컬 원본과 바이트 일치를 검증했습니다. Preview 1은 이전 그림 없는 설치본으로 보존합니다. 두 버전 모두 카메라 QR 촬영 수령·App Link·외부 지갑/NFT는 미검증입니다.

새 [Preview 3 사전 릴리스](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3)는 `MassCOM-showcase-android-128ce5f.apk`(SHA-256 `c47104ce3fc7f6bf27f83120731f07fd89ebf84165a23d548059160a25b64fae`)입니다. APK 내부 버전 이름·코드는 아직 `0.1.0-test.2`·`2`이며 Release의 Preview 3은 배포 순서 표시입니다. [원격 digest·서명](evidence/showcase-preview3-release-2026-09-27.json)과 [Samsung의 같은 계정 카메라 QR 촬영·별도 수령 확정·도감](evidence/showcase-preview3-camera-claim-2026-09-28.json)은 PASS, 초대 밖 계정 및 서로 다른 두 계정·두 휴대전화 QR 수령은 `NOT_RUN`입니다.

[개인 비공개 Preview 4](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.4)의 `MassCOM-showcase-android-6585614.apk` SHA-256은 `a0d1fb76bed70547c1291f05534264e0312460c7586173512aee0dbbea6d4c21`입니다. [빌드·서명·GitHub 자산 digest·시연 API 마이그레이션/HTTPS](evidence/showcase-customer-qr-deployment-2026-09-28.json)는 PASS이고, 휴대전화가 `adb`에 잡히지 않아 새 APK 설치·카메라 고객 식별 QR 실기는 `NOT_RUN`입니다. 내부 versionName/code는 `0.1.0-test.2`·`2`로 유지되어 Preview 4 태그만 배포 순서입니다. 직원 발급은 구 Preview 3이 아닌 새 고객 식별 QR 흐름의 Preview 4 이상에서 검증해야 하며 현재 최신은 Preview 5입니다.

[개인 비공개 Preview 5](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.5)의 `MassCOM-showcase-android-88932cb.apk` SHA-256은 `bc8c5bd6e0cd1ac0ae6a53db806dbad70714169f9c5573483c01386173ed19e0`입니다. [빌드·시연 전용 서명·소스 마커·원격 자산 digest](evidence/showcase-preview5-release-2026-09-29.json)가 PASS이며 GitHub 태그는 `88932cb` 소스를 가리킵니다. 내부 versionName/code는 여전히 `0.1.0-test.2`·`2`이므로 Preview 5는 배포 순서이고 자동 업데이트 검증이 아닙니다. 휴대전화가 `adb`에 보이지 않아 설치·새 2분 고객 QR 촬영·두 기기 수령은 `NOT_RUN`입니다. 운영 test.3은 별도 패키지·서명·실데이터 API를 사용하며 이번 시연 APK로 대체하지 않습니다.

새 [운영 test.3 사전 릴리스](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.3)는 `MassCOM-operating-android-c5cba68.apk`(SHA-256 `69fe089ce3c7bee8cb4ec2239254dca9b9de2736f2479e7a10fad32950890185`)입니다. 이전 로컬 AAB `22283d7`은 서명됐지만 Android 번들의 Google 설정이 빠져 배포하지 않았습니다. test.3은 [설정 값 포함·Samsung 로그인/복원·16KB 설치](evidence/operating-android-test3-2026-09-28.json)를 확인했습니다. 내부 버전 이름·코드는 여전히 `0.1.0-test.2`·`2`로, test.3 태그는 GitHub 배포 순서입니다.

**로그인 검증 주의:** 시연 API는 PR #192의 고객 로그인 정책으로 [교체](evidence/showcase-open-login-api-deployment-2026-09-27.json)됐고 Preview 3에 새 오류 복구 코드가 들어 있습니다. 초대 밖 **실제** Google 계정의 Android 로그인은 아직 시험하지 않았으므로 임의 계정 로그인 완료라고 안내하지 않습니다([정책·게이트](SHOWCASE_AUTH_GUARD.md)). 운영 앱은 고객 화면만 제공하고, 시연 가상 데이터는 운영 API/DB에 넣지 않습니다.

## 두 앱을 각각 게시하기 전 조건

- 운영: upload key AAB/APK의 source commit·package·서명·SHA-256과 Samsung 로그인·빈 점포 탐색, 16KB 설치·콜드 실행은 확인했습니다. **운영 release의 외부 지갑 복귀와 실제 점포·QR 수령은 아직 미검증**이며 Google Play 설치본은 별도 서명 인증서를 사용하므로 GitHub APK와 구분합니다.
- 시연: 전용 인증·DB의 공개 HTTPS, `kr.masscom.wolgye.demo` 서명·운영 앱과 동시 설치, 두 Google 계정의 점주 발급→고객 **직접 코드** 수령 및 같은 계정의 **카메라 QR** 촬영→수령·도감을 각각 확인했습니다. 두 계정·두 휴대전화의 카메라 QR, 별도 Reown 지갑·NFT, `demo.masscom.kr` App Link는 미검증입니다.
- 운영 테스트본과 시연 설치본은 각각 다른 GitHub 사전 릴리스에 게시했습니다. 시연 앱의 미완료 기능을 운영 기능으로 표기하지 않습니다. 저장소 공개는 완료됐지만 Play 제출·일반 공개 승인은 별도입니다.

개발 절차와 분리 기준은 [모바일 README](../apps/mobile/README.md)와 [시연·운영 분리 설계](superpowers/specs/2026-09-23-showcase-production-separation-design.md)를 따릅니다.
