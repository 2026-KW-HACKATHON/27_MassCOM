# 선택 작업 브라우저 검증

2026-10-09 KST, Codex in-app Browser, 실제 React Native Web·Reanimated 컴포넌트. 화면의 모든 계정·가게·코인 데이터는 명시된 로컬 QA 합성 데이터다. `.invalid` GET 스텁 외 요청은 차단하고 쓰기는 실행하지 않는다. 운영 기록으로 복사하지 않는다.

재현:

```sh
node tests/fixtures/reward-album-rnw/run-qa.cjs --serve-only
# 출력된 localhost URL에 아래 query를 붙인다.
# ?scenario=coin  / &rarity=bronze|silver|gold|prism / &recovered=1
# ?scenario=home&mode=first|reward|coin|progress|loading|error
# ?scenario=collection / &mode=empty / &fontScale=2
```

실제 CoinReveal의 결과 children만 합성 카드이며, HomeScreen·CoinCollectionScreen은 실제 전체 화면이다. 계정 인증·라우터·음향/진동 등 네이티브 경계는 mock이다. 라우터 이동 요청은 `QA 이동 요청`으로 표시한다. 가게 B 버튼이 가게 B의 ID를 전달하고 홈 코인권 안내가 `/coin-shop`을 전달함을 확인했다.

390×844, 320×740 및 다크 모드·움직임 감소를 검사했다. `fontScale=2`는 hook 분기만 바꾸므로 실제 200% 텍스트 픽셀 수용은 아니다. 출처 화면·홈·도감 캡처가 이 디렉터리에 있다. 작은 화면에서는 스크롤 캡처 위치가 다를 수 있다.

`browser-checks.json`의 PASS는 위 합성 컴포넌트 범위다. 최초 fixture 실행에서 Node 환경변수 및 지갑 초기화 의존성이 없어서 중단됐고, 테스트 전용 환경/인증 경계를 보완한 뒤 재실행했다. RNW SVG의 기존 `accessible=false` DOM 경고는 남아 있다. 실제 Google 로그인, 운영 API, QR·쿠폰 지급, Android 설치·TalkBack·음향·진동·성능은 검사하지 않았다.
