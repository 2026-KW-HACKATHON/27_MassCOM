# 우표 뽑기 영상과 제공 효과음 검증

Issue #442 · `feat/gacha-stamp-reveal` · 기준 main `b37063c0` · 2026-10-09 KST.

사용자가 승인한 검은 배경의 우표 영상 두 개를 등급 뽑기와 기존 재뽑기 화면에 연결한다. 구매 전에는 3초 대기 영상을 무음 반복하고, 서버 결과를 받은 뒤 약 4.208초 개봉 영상을 재생한다. 보상 공개와 도감 등록 확인은 기존 흐름을 따른다. 운영·시연의 공통 화면에 적용한다.

## 사운드와 자산

사용자가 제공한 `sound list`의 OGG 17개 중 10개를 선택해 개봉 트랙을 구성했다. 실제 청음은 이 환경에서 지원하지 않아 파형·주파수·음량 분석으로 선정했다. 소스 이름을 기능 배치의 기준으로 삼지 않았다. 효과음 설정을 끄면 영상도 음소거하며, 대기는 항상 무음이다. 기존 BGM 설정과 보상 결과 효과음은 유지한다.

최종 영상은 `-c:v copy`로 오디오만 교체했다. 대기 영상 스트림 SHA-256은 `c6608d56a7850973c26f5b0e9ede2a2c180a5ae8f346a7b189174442c6ff3dca`, 개봉은 `a15cccd3b5bf0dd50d893233e3e3ade7de706a55686e80a225a4e8e3e8849bb2`다. 사용자 제공 OGG와 재현 스크립트, 음량 수치는 [자산 설명](../apps/mobile/assets/videos/README.md)에 있다. 음량 수치는 청감 수용을 뜻하지 않는다.

## 구현과 복구 경계

- 공통 `StampDrawStage`가 효과음 설정, 동작 줄이기, 화면 초점과 앱 전경 상태, 완료 중복 방지와 12초 watchdog을 맡는다.
- 웹은 실제 HTML video를 사용하고 autoplay 거절 시 음소거로 재시도한다. 화면을 떠나면 재생·decoder·입력 재시도 리스너를 정리한다.
- Android는 기존 로컬 Expo 모듈에 `MasscomStampVideo`를 추가해 MediaPlayer/TextureView로 재생한다. 인코딩·저장 기능과 npm 의존성은 바꾸지 않는다. 새 네이티브 모듈이 없는 기존 설치본은 포스터와 결과 복구 경로로 진행하므로 새 앱 빌드가 있어야 영상이 보인다.
- 서버 결과 전에는 개봉을 시작하지 않고, 연속 터치를 한 번의 구매 요청으로 제한한다. 재생 실패·건너뛰기·복구 결과·동작 줄이기에서도 지급을 다시 요청하지 않는다.

## 검증 환경과 증거

Windows, Node 24.15.0, JDK 17.0.20.1, Android SDK 36, Chrome/Playwright RNW fixture. 브라우저에서는 제품의 뽑기·등록 컴포넌트와 실제 MP4를 사용하고 서버·계정·소리 컨트롤러 경계는 합성 fixture를 사용한다. 운영 API 구매를 수행한 시험이 아니다.

실행 결과는 [TEST_STATUS](TEST_STATUS.md) 최상단, 화면과 동작 측정은 [브라우저 보고서](evidence/gacha-stamp-2026-10-09/browser-qa-report.json), [화면 판정](evidence/gacha-stamp-2026-10-09/visual-verdict.json)에 기록한다. 이전 도감 증거는 보존했다.

Android TextureView의 배경은 부모 View에서 그린다. TextureView에 background drawable을 지정할 수 없는 동작은 [AOSP 원문](https://android.googlesource.com/platform/frameworks/base/+/HEAD/core/java/android/view/TextureView.java)을 확인했다.

## 확인하지 않은 범위

실제 Android 운영·시연 설치본에서의 재생·청음, iOS 영상 재생, 실제 Google 로그인과 실제 구매 API, 배포·Play 업로드는 `NOT_RUN`이다. Android 모듈 컴파일과 JS 번들 생성은 설치·실기 검증과 구분한다. 사용자 제공 소스의 별도 라이선스 문서는 전달받지 않았으며 임의의 라이선스를 부여하지 않는다.

독립 code-reviewer와 보조 critic이 같은 결과 재처리 중 개봉이 생략되는 경로를 찾아 수정·회귀 검증했다. 최종 code-reviewer APPROVE, 보조 critic CLEAR다. 지정 architect 역할은 설치된 모델이 계정에서 지원되지 않아 실행할 수 없었다. 보조 critic의 독립 검토는 수행했지만 이를 지정 architect 실행 성공이나 완전한 스킬 승인으로 기록하지 않는다.

되돌릴 때는 이 PR의 커밋을 revert한다. DB·보상 확률·지급량·요청 식별자·서명 키·의존성 마이그레이션은 없다.
