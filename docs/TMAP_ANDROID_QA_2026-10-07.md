# Android 주 지도와 대체 지도 검증 — 2026-10-07

[Issue #387](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/387). 기준 소스 main `2bb8491a`. 앞선 [공급자 연결 기록](evidence/tmap-fallback-2026-10-07/README.md)은 당시의 결과이며, 아래 실기 결과로 전체 서비스 출시를 판정하지 않는다.

## 수정 원인

Samsung SM-S928N(Android 16/API 36)의 기존 개발 앱에서 TMAP 리소스 다운로드는 끝났지만 타일이 나타나지 않았다. 비공개 크기 진단에서 바깥 지도와 TMapView는 1080×661, SDK가 나중에 추가한 VSMMapView와 SurfaceView는 0×0이었다. ExpoView의 기본 Yoga 레이아웃은 이 자식의 후속 requestLayout을 처리하지 않았다. 브리지의 `shouldUseAndroidLayout=true`로 후속 Android 레이아웃을 허용하자 모든 자식이 1080×661이 되고 실제 TMAP 타일이 나타났다.

카메라 초기화는 별도 문제였다. SDK의 기본 이동 애니메이션이 끝나기 전에 읽은 서울시청 중심이 JS의 제어 카메라에 돌아갔다. 비애니메이션 center setter와 이미 같은 카메라의 재적용 방지로 광운대 초기 위치와 손가락 이동을 보존한다. 종료 시 ready/active를 내려 늦게 예약된 viewport 이벤트가 폐기된 지도를 읽지 않게 한다. 임시 진단 로그·카메라 관측 가드·타이머는 최종 소스에 없다.

최종 화면 검사에서 보행 거리·시간이 있어도 경로선이 보이지 않는 추가 문제를 발견했다. SDK 3.7의 기본 TMapPolyLine은 별도 lineAlpha를 0으로 두고, 실제 렌더 색상을 만들 때 Color.rgb의 alpha 대신 이 값을 쓴다. 공식 배포 샘플처럼 `setLineAlpha(255)`를 명시해 경로선을 불투명하게 한다. 좌표 순서·보행 응답·선 등록 방식은 정상이라 변경하지 않았다.

## 검증

- 모바일 전체 단위 1777/1777, 타입·lint, tracked source snapshot의 비밀·개인정보 검사와 diff check PASS. native 브리지는 실제 Kotlin/app assembleRelease로 검사했다.
- 독립 검토: 레이아웃 override, 유일한 0-padding 호출자의 카메라 동기화, dispose 후 이벤트 차단에 필수 수정 없음. 비영(非零) padding 카메라는 실기 미검증이다.
- 비공개 최종 APK: 유효키 `f3fcbf4018aa1968cbddc95bb5862829dff74ecfb51e561f6c1dd0dec869d2e3`, TMAP 실패 주입 `e285bd593f5dbdfb8354305daffd223c5c486bd79bdefeddf8e61acf0b591973`. 실패 주입본에는 유효 TMAP 키가 없고 NAVER 공개 ID만 정상이다. 두 빌드에 서버 secret·임시 probe가 없다.
- 두 APK는 `kr.masscom.wolgye.dev`, minSdk24/targetSdk36, 기존 Expo debug 인증서 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`다. TMAP/NAVER 클래스와 64bit ELF/ZIP 16KiB 정렬 PASS. 오디오 녹음·백그라운드 위치·전체 패키지 조회·결제 권한은 없으며, 기존 개발 클라이언트의 overlay 권한은 있다. 운영/시연 배포 서명 또는 Play 릴리스 검증으로 인용하지 않는다.
- 최종 실기 PASS: alpha 유효키 APK에서 실제 TMAP 타일·광운대 중심·서버 묶음4·수동 출발지의 실제 TMAP 보행544m/8분과 철길과 구분되는 청색 도보선. 동일 alpha 소스의 무효키 APK에서 NAVER 실제 타일·묶음4·대체 라벨 PASS. 마지막 유효키 복구 후 폰에서 pull한 base.apk SHA가 f3fcbf4018aa1968cbddc95bb5862829dff74ecfb51e561f6c1dd0dec869d2e3과 완전히 일치했다.
- 클린 prealpha 브리지에서 클러스터 확대·범위 목록5곳·가게 상세/뒤로·지도/목록·드래그 후 위치 유지·HOME 복귀 PASS. alpha 한 줄 후 주요 타일/경로/대체/복구를 재검증했다. prealpha 증거를 alpha 이후 모든 제스처·백그라운드 검증으로 바꾸지 않는다.
- [소스 해시](evidence/tmap-android-2026-10-07/source.json), [최종 비공개 APK 검사](evidence/tmap-android-2026-10-07/private-native-checks.json), [실기 관측](evidence/tmap-android-2026-10-07/device-checks.json)을 따른다. 화면·APK·원시 진단은 비공개 임시 폴더에만 두었다.

## 검증 경계

NAVER Maps의 Dynamic Map/Geocoding 등록과 실제 지오코딩, TMAP REST 실패 후 NAVER 지오코딩 대체는 확인됐다. 별도 NAVER Developers 지역 검색 키는 발급되지 않았다. NAVER 웹 SDK 실행 순서 회귀는 PR #386에서 고쳤지만 현재 브라우저 제어 연결이 없어 수정 후 웹 타일은 NOT_RUN이다. 실제 NAVER Android 타일과 웹 타일 검증은 별도다.

실기는 격리 합성 DB의 가게·계정과 로컬 서버를 사용한다. 실제 TMAP 보행 응답과 지도 타일을 쓰되 사용자 GPS·실제 Google 로그인·점주 동의·방문·쿠폰 지급·현장 도착은 검증하지 않았다. 기존 소리 청음 PASS·진동 체감 FAIL 기록은 유지하고 이번 지도 검증으로 바꾸지 않는다. 공개 서버·공개 설치본·Play는 변경하지 않았다. 키·원시 SDK 응답·정밀 위치·설치 APK·진단 로그는 Git에 넣지 않는다.
