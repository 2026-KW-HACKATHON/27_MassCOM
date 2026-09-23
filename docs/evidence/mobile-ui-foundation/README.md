# 모바일 UI 기초 검증 — Issue #136

2026-09-23, Windows / Node / Expo SDK 57. 기준 main `60d37a7`, 브랜치 `feat/mobile-ui-foundation`. PR 검토용이며 병합·배포하지 않는다.

## 자동 검사

- PASS: `npm test --prefix apps/mobile` — 153개. 기존 인증·외부지갑 회귀 포함, 새 공개 경계와 페이지 범위/폭 변경 검사 추가.
- PASS: `npm run typecheck --prefix apps/mobile`, `npm run lint --prefix apps/mobile`.
- PASS: `npm run export:android --prefix apps/mobile` — Android JS 번들. 설치용 APK나 실기 성공을 의미하지 않는다. 기존 의존성의 package exports fallback 경고는 남아 있다.
- PASS: bootstrap, operations docs, accessibility semantics, secret-scanner regression, privacy 검사와 `git diff --check`.
- 독립 소스 리뷰에서 루트 navigator remount, 숨겨진 시작 화면의 Android BackHandler, 지갑 취소 시 history 처리 문제를 발견해 수정했다. 수정 후 두 리뷰는 APPROVE / CLEAR.

## UI 실행 검사

실제 `FoundationScreen`을 React Native Web으로 렌더링한 로컬 하네스에서 확인했다. 시스템 appearance·reduce motion 입력은 하네스에서 지정했다. 아래 PNG는 **브라우저 미리보기이며 Android 캡처가 아니다**.

- PASS: 390×844 역할 선택 → 사용자 → 선택 지갑 안내 → 건너뛰기 → 중앙(03) 빈 공간.
- PASS: 점주 선택 → DEMO 표식 → 중앙 빈 공간.
- PASS: 다섯 탭, 처음/마지막/빠른 탭 전환, 04→03 수평 스크롤에 페이지 번호·선택 표시 연동.
- PASS: 390→320px 폭 변경 시 04 유지, 라이트/다크, 모션 감소 설정의 즉시 탭 이동, 웹 `aria-selected`.
- PASS: 실제 RouteBoundary에 명시적인 auth/router mock을 주입하여 signedOut/restoring/switchingAccount의 보호 자식 미마운트, 로그인 완료 후 wallet 목적지 유지, 계정 변경 시 보호 자식 remount, history 유무에 따른 back/replace 복귀를 확인했다. Google·지갑 실제 인증 검증과는 별개다.

| 역할 선택 | 지갑 선택 | 사용자 | 점주 DEMO |
| --- | --- | --- | --- |
| ![역할 선택](role-light.png) | ![지갑 선택](wallet-light.png) | ![사용자](customer-light.png) | ![점주](merchant-light.png) |

[320px 다크 화면](customer-dark-320.png)

## 미실행 범위

NOT_RUN: 새 UI의 Android 설치·터치 관성/드래그 취소·하드웨어 뒤로가기·실제 safe area, TalkBack, 200% 시스템 글꼴, 실제 Google 로그인·외부지갑 연결/복귀·딥링크·계정 전환. 기존 지갑 코드와 auth-provider는 변경하지 않았으며 과거 실기 PASS를 이번 UI 증거로 쓰지 않는다. GitHub CI 결과는 PR의 실제 check 상태에서 확인한다.
