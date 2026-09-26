# Android 설치본과 GitHub 배포 상태

상태 확인일: 2026-09-26. 저장소는 `PRIVATE`이며, GitHub Release 파일은 저장소 읽기 권한이 있는 계정에서만 내려받을 수 있습니다. GitHub 소스 ZIP은 설치용 APK가 아닙니다.

| 구분 | package | GitHub 다운로드 | 실제 상태 |
| --- | --- | --- | --- |
| 운영 테스트 앱 | `kr.masscom.wolgye` | [test.2 Release의 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.2) | `VERIFIED` — 당시 APK 재다운로드 해시·Samsung/AVD 설치·App Link 확인. **최신 `main` UI와 동일한 빌드가 아님** |
| 시연 앱 | `kr.masscom.wolgye.demo` | 아직 없음 | `BLOCKED/NOT_RUN` — 전용 서명 키·Google Web/Android client·ADB 기기는 준비됐지만 외부 HTTPS API/DB·서명 APK·기기 설치가 없음 |

시연 **웹**은 앱 설치와 별개입니다. [공개 주소](https://www.masscom.kr/preview/)에서 다운로드 없이 볼 수 있고, [웹 전용 GitHub 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)에는 정적 HTML/CSS ZIP만 있습니다. 이 태그에 Android APK는 없으며 가상 점포·예시 수집품을 실제 방문·NFT 발행 실적으로 보지 않습니다. [www 전환 증거](evidence/www-web-cutover-2026-09-25.json)를 참고하세요. 기존 Vercel 주소는 복구용으로 보존합니다.

시연 앱을 운영 API에 연결하거나, 운영 APK를 시연용으로 이름만 바꾸어 게시하지 않습니다. 로컬 개발 앱 `kr.masscom.wolgye.dev`에서 가상 점포의 수동 코드 흐름을 확인한 결과도 시연 APK 완성과 다릅니다.

## 설치 방법

1. 접근 권한이 있는 GitHub 계정으로 로그인하고 위 운영 테스트 Release의 `.apk` 파일을 휴대전화에 내려받습니다. `.aab` 또는 소스 ZIP은 직접 설치 파일이 아닙니다.
2. APK의 SHA-256을 Release의 `SHA256SUMS.txt`와 비교합니다. 파일과 체크섬을 모두 신뢰할 수 있는 같은 Release에서 받습니다.
3. Android에서 브라우저의 ‘알 수 없는 앱 설치’ 권한을 이 설치에만 허용하고 설치합니다. 필요하지 않으면 권한을 다시 끕니다.

이 설치본은 Google Play 승인본이 아니고, 최신 운영 코드의 QA 결과를 대신하지 않습니다. 기기에서 지갑 비밀번호·복구 문구를 GitHub 페이지나 이 프로젝트 웹에 입력하지 마세요.

## 두 앱을 각각 게시하기 전 조건

- 운영: 현재 `main` 기준 운영 AAB/APK를 upload key로 빌드하고 source commit·package·서명·SHA-256을 확인한 뒤 실제 기기에 설치해 로그인·탐색·지갑 복귀를 확인합니다. Google Play 설치본은 별도 서명 인증서를 사용하므로 GitHub APK와 구분합니다.
- 시연: `demo-api.masscom.kr`의 전용 인증·DB와 시연용 Google/Reown 프로젝트를 준비하고 운영 API/DB와 격리합니다. `kr.masscom.wolgye.demo` 서명 APK를 만들고 운영 앱과 동시 설치, 실제 기기 로그인·코드 수령·도감·복귀를 확인합니다.
- 두 파일은 이름·package·검증 커밋·체크섬·알려진 한계를 따로 적은 **private GitHub pre-release**에 게시합니다. 시연 앱의 미완료 기능을 운영 기능으로 표기하지 않습니다. 저장소 공개·Play 제출·일반 공개는 별도 결정입니다.

개발 절차와 분리 기준은 [모바일 README](../apps/mobile/README.md)와 [시연·운영 분리 설계](superpowers/specs/2026-09-23-showcase-production-separation-design.md)를 따릅니다.
