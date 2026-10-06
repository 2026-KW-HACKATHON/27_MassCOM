# Third-party notices

## Phase 1 Android·지갑 의존성

| 이름 | 버전 | 출처·라이선스 | 사용 범위 |
| --- | --- | --- | --- |
| Expo / React Native | Expo 57.0.23 / RN 0.86.3 | [Expo](https://github.com/expo/expo), MIT | Android 앱·Router·development build·native UI |
| Reown AppKit React Native | 2.0.6 | [upstream](https://github.com/reown-com/appkit-react-native), package metadata의 LICENSE.md 및 Community License 확인 필요 | 외부 지갑 연결 UI·provider |
| patch-package | 8.0.1 | [upstream](https://github.com/ds300/patch-package), MIT | Reown 2.0.6 최소 호환 패치의 clean install 재적용 |
| WalletConnect React Native compat | 2.25.0 | [upstream](https://github.com/WalletConnect/walletconnect-monorepo), LICENSE.md | React Native WalletConnect polyfill |
| SIWE | 3.0.0 | [SpruceID SIWE](https://github.com/spruceid/siwe), MIT | ERC-4361 메시지 생성·파싱·검증 |
| ethers | 6.17.0 | [ethers.js](https://github.com/ethers-io/ethers.js), MIT | 서명 복구·주소 정규화 |
| node-postgres (`pg`) | 8.23.0 | [node-postgres](https://github.com/brianc/node-postgres), MIT | PostgreSQL 연결·parameterized query·migration 실행 |
| qrcode | 1.5.3 | [node-qrcode](https://github.com/soldair/node-qrcode), MIT | Android·운영 점주 웹의 일회성 QR 표시용 서버 이미지 생성 |
| PostgreSQL | 18 Alpine(개발·CI) | [PostgreSQL](https://www.postgresql.org/), PostgreSQL License | 점포·캠페인 영속 저장과 실제 통합 테스트 |

## 실사용 지도·위치·사진 의존성 (Issue #381)

| 이름 | 버전 | 출처·라이선스 | 사용 범위 |
| --- | --- | --- | --- |
| TMAP Android VSM SDK | 3.7 / VSM 2.0.14 | [공식 Android 문서](https://tmapapi.tmapmobility.com/androidVSM/docs/androidDoc.html), [서비스 약관](https://tmapapi.tmapmobility.com/terms.html), 계정별 SDK 배포 조건 확인 필요 | 실제 Android 지도. 공식 ZIP/AAR 해시는 검증하며 AAR은 Git에서 제외한다. 공개 APK/AAR 배포 권리를 이 문서로 확정하지 않는다. |
| TMAP Vector JS·REST | 공식 Web V3 / REST | [공식 웹 문서](https://tmapapi.tmapmobility.com/webv3VSM/guide/webGuide.html), TMAP 서비스 약관 | 지도·장소·주소 후보·보행 경로. 공급자 표시를 유지하고 외부 응답의 보관은 24시간 미만으로 제한한다. |
| expo-location | 57.0.20 | [Expo](https://github.com/expo/expo/tree/main/packages/expo-location), MIT | 사용자가 용도를 확인한 뒤 전경 위치를 한 번 조회한다. 백그라운드 위치 서비스는 추가하지 않는다. |
| sharp | 0.35.5 | [sharp](https://github.com/lovell/sharp), Apache-2.0; 하위 libvips 라이선스 포함 | 실제 점포 사진 디코드·방향 보정·크기 제한·메타데이터 제거·WebP 재인코드 |
| FlatBuffers Java | 24.3.25 | [FlatBuffers](https://github.com/google/flatbuffers), Apache-2.0 | 공식 TMAP Android SDK의 JVM 런타임 요구 |
| source-map-js | 1.2.2 | [upstream](https://github.com/7rulnik/source-map-js), BSD-3-Clause | 기존 PostCSS 전이 의존성의 보안 패치. 별도 기능·의존성은 추가하지 않았다. |

## Phase 3 NFT 계약 의존성

| 이름 | 버전 | 출처·라이선스 | 사용 범위 |
| --- | --- | --- | --- |
| Foundry | 1.8.3, Docker digest `sha256:2e428727…a46ce9e7` | [foundry-rs/foundry](https://github.com/foundry-rs/foundry), Apache-2.0 / MIT | Solidity 포맷·컴파일·단위/fuzz 테스트·로컬 Anvil |
| OpenZeppelin Contracts | 5.7.0, commit `cab19933` | [OpenZeppelin/openzeppelin-contracts](https://github.com/OpenZeppelin/openzeppelin-contracts), MIT | ERC-721·AccessControl·Pausable·Strings |
| forge-std | 1.16.2, commit `bf647bd6` | [foundry-rs/forge-std](https://github.com/foundry-rs/forge-std), Apache-2.0 / MIT | Foundry 테스트·배포 script 기반 |

Expo 기본 템플릿의 개발 아이콘·스플래시 자산이 현재 `apps/mobile/assets`에 남아 있습니다. 출시 브랜딩 자산이 아니며 Expo MIT License 범위에서 사용합니다.

Reown 수정 범위와 upstream 교체 조건은 [`docs/REOWN_PATCH.md`](docs/REOWN_PATCH.md)에 기록합니다. 원본 패키지 전체를 저장소에 복제하지 않고 `apps/mobile/patches/@reown+appkit-react-native+2.0.6.patch` diff만 보관합니다.

GitHub Actions의 공식 `actions/checkout`은 CI에서 커밋 SHA로 고정해 사용합니다. 향후 외부 자산이나 코드를 추가할 때 아래 정보를 함께 기록합니다.

- 이름과 버전 또는 커밋
- 원본 URL
- 라이선스
- 프로젝트에서 사용·수정한 범위
- 저작권·표시 의무의 이행 위치

## README 시각 자료의 출처

- `docs/assets/readme/hero.png`: 사용자가 제공한 MassCOM 콘셉트 이미지를 imagegen으로 편집한 장식용 배너입니다. 원본의 Play 배지·앱 목업·성과 문구를 제거했으며 실제 점포나 출시 증거로 사용하지 않습니다. 원본의 공개 사용 권리는 저장소 공개 전에 사용자가 확인해야 합니다.
- `docs/evidence/readme-showcase-2026-09-27/*.png`: 사용자가 연결한 Samsung SM-S928N의 비공개 시연 APK 화면을 ADB로 촬영했습니다. 가상 데이터만 보이는 역할·탐색·도감·추천 화면이며 계정 선택, 일회용 코드, 지갑 비밀은 포함하지 않습니다.
- `apps/mobile/assets/images/collectibles/showcase-{a,b,c}.png`: 사용자가 앱 사용을 승인한 MassCOM 마스코트 그림을 시각 참고로 imagegen에서 새로 만든 가상 점포 카드 그림입니다. 기존 마스코트 원본의 공개 웹·NFT 메타데이터 이용 권리는 별도로 확인해야 하며, 현재 외부 지갑용 공개 이미지 URI는 없습니다.
