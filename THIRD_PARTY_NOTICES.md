# Third-party notices

## Phase 1 Android·지갑 의존성

| 이름 | 버전 | 출처·라이선스 | 사용 범위 |
| --- | --- | --- | --- |
| Expo / React Native | Expo 57.0.23 / RN 0.86.3 | [Expo](https://github.com/expo/expo), MIT | Android 앱·Router·development build·native UI |
| Reown AppKit React Native | 2.0.6 | [upstream](https://github.com/reown-com/appkit-react-native), package metadata의 LICENSE.md 및 Community License 확인 필요 | 외부 지갑 연결 UI·provider |
| WalletConnect React Native compat | 2.25.0 | [upstream](https://github.com/WalletConnect/walletconnect-monorepo), LICENSE.md | React Native WalletConnect polyfill |
| SIWE | 3.0.0 | [SpruceID SIWE](https://github.com/spruceid/siwe), MIT | ERC-4361 메시지 생성·파싱·검증 |
| ethers | 6.17.0 | [ethers.js](https://github.com/ethers-io/ethers.js), MIT | 서명 복구·주소 정규화 |
| node-postgres (`pg`) | 8.23.0 | [node-postgres](https://github.com/brianc/node-postgres), MIT | PostgreSQL 연결·parameterized query·migration 실행 |
| PostgreSQL | 18 Alpine(개발·CI) | [PostgreSQL](https://www.postgresql.org/), PostgreSQL License | 점포·캠페인 영속 저장과 실제 통합 테스트 |

Expo 기본 템플릿의 개발 아이콘·스플래시 자산이 현재 `apps/mobile/assets`에 남아 있습니다. 출시 브랜딩 자산이 아니며 Expo MIT License 범위에서 사용합니다.

GitHub Actions의 공식 `actions/checkout`은 CI에서 커밋 SHA로 고정해 사용합니다. 향후 외부 자산이나 코드를 추가할 때 아래 정보를 함께 기록합니다.

- 이름과 버전 또는 커밋
- 원본 URL
- 라이선스
- 프로젝트에서 사용·수정한 범위
- 저작권·표시 의무의 이행 위치
