# Issue #136 시연 앱 역할 진입 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for one-owner implementation. Steps use checkbox (`- [ ]`) syntax for tracking. Do not interpret this plan as implementation evidence.

**Goal:** 실제 설치한 시연 Android 앱의 첫 화면에서 사용자·점주 역할을 고르게 하되 인증·점주 권한·기존 탐색 기능을 보존한다.

**Architecture:** 권장 범위는 `kr.masscom.wolgye.demo`의 첫 진입에만 역할 선택을 표시하고 `kr.masscom.wolgye`의 네 탭 기본 경로를 유지하는 것이다. 역할은 UI 선택이지 서버 권한이 아니다. 개발용 `foundation-preview`의 다섯 빈 공간은 시연 앱에서 선택적으로 열 수 있는 투어로 재사용하되 실제 탐색·방문·도감 경로를 가리지 않는다.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, TypeScript, 기존 `FoundationScreen`과 `AuthSessionProvider`.

**Spec:** [Issue #136](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/136), [시연·운영 분리 설계](../specs/2026-09-23-showcase-production-separation-design.md), [D-027](../../DECISIONS.md).

**시작 순서:** 1. 아래 역할 진입 적용 범위를 확정한다. 2. Task 1~3을 순서대로 RED→GREEN 검증한다. 3. Task 4 실기와 PR·CI 증거를 확인한 뒤 이슈 종료를 판정한다.

## 실행 결정 게이트

사용자가 2026-09-24 시연 앱 전용 A안을 확정했다([D-032](../../DECISIONS.md)). 운영 시작 경로·비로그인 탐색 정책은 이 계획에서 변경하지 않는다. 이전 PR #138의 개발용 미리보기 승인을 운영 첫 화면 변경 승인으로 해석하지 않는다.

## Global Constraints

- `kr.masscom.wolgye.demo`/`masscom-demo`와 `kr.masscom.wolgye`/`masscom`은 설치·인증·API·지갑 상태를 섞지 않는다.
- 역할 선택만으로 `STAFF`·`OWNER` 권한을 부여하지 않는다. 실제 점주 화면은 API의 `CONFIRM_VISIT` 권한이 필요하다.
- 외부 지갑은 선택 사항이며 주소 확인 서명 외 자산 요청을 추가하지 않는다.
- 다섯 공간은 빈 UI 시안이다. 가짜 점포·방문·수집품을 실제 데이터처럼 넣지 않는다.
- `PASS`는 수정 코드의 자동/실기 실행 범위에만 기록한다. 시연 APK가 없으면 기기 항목은 `NOT_RUN`이다.

## Review Focus

- 시연 앱에서 역할을 고르기 전 Google 로그인이 시작되거나 운영 앱에 역할 선택이 나타나지 않는지 Task 1 시험.
- 점주 역할만 눌러 미권한 계정이 코드 발급 화면에 들어가지 않는지 Task 2 실제 API 거절 시험.
- 지갑을 건너뛴 사용자가 탐색·방문·도감으로 갈 수 있는지 Task 2 경로 시험.
- 다섯 빈 공간의 스와이프와 하단 선택 상태·TalkBack 이름이 어긋나지 않는지 Task 3 시험.
- 앱 종료·계정 전환 후 다른 계정의 역할·지갑 화면이 남지 않는지 Task 4 기기 시험.

---

### Task 1: 시연 package 전용 첫 화면 경계

**Files:** `apps/mobile/src/app/_layout.tsx`, 새 `apps/mobile/src/navigation/showcase-entry.ts`, 새 `apps/mobile/src/navigation/showcase-entry.test.ts`.

**Interfaces:** `showShowcaseRoleEntry(packageId: string | null | undefined, selectedRole?: 'customer' | 'merchant'): boolean`은 `.demo`이고 역할을 고르지 않았을 때만 `true`다. 앱의 기존 인증·AppKit provider 생성 순서는 유지한다.

- [ ] `showcase-entry.test.ts`에 `.demo` 첫 진입 `true`, 선택 후 `false`, 운영·개발 package `false`, 빈 package `false`를 실제 함수 호출로 시험한다.
- [ ] `cd apps/mobile && npx --no-install tsx --test src/navigation/showcase-entry.test.ts`가 함수 부재로 실패함을 확인한다.
- [ ] 함수를 최소 구현하고 `AuthenticatedRoot`에서 인증 안내 이전에 `.demo` 역할 선택을 표시한다. 운영 앱은 기존 `AuthRequiredScreen`/`Routes` 경로를 그대로 사용한다.
- [ ] 대상 시험·`npm run typecheck --prefix apps/mobile`을 통과시키고 의도 중심 한국어 커밋을 만든다.

### Task 2: 역할 선택 후 실제 기능·권한 경로

**Files:** 새 `apps/mobile/src/screens/showcase-role-entry/index.tsx`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/merchant.tsx`, `apps/mobile/src/screens/account-settings/index.tsx`, 관련 모바일 화면 시험.

**Interfaces:** 역할 선택은 메모리의 계정별 UI 상태다. 고객은 인증 후 기존 `/` 탐색으로 간다. 점주는 인증 후 `/merchant`를 열되 실제 STAFF/OWNER 허가는 기존 API가 판단한다. 권한 거절 시 한국어 안내와 고객 탐색 복귀를 제공한다.

- [ ] 고객 선택→로그인→탐색, 지갑 건너뛰기→도감 경로와 점주 선택→미권한 403 거절의 회귀 시험을 먼저 작성하고 실패를 확인한다.
- [ ] 기존 `FoundationScreen`의 역할 카드 시각 언어를 필요한 만큼 재사용해 시연용 첫 화면을 만들고, 가상 체험임을 텍스트·접근성 이름에 표시한다. 역할만으로 점주 권한을 생성하는 코드는 넣지 않는다.
- [ ] `npm test --prefix apps/mobile`, typecheck·lint·`npm run export:android --prefix apps/mobile`, API 점주 권한 시험을 통과시킨다.
- [ ] README·상태 문서에 자동 시험과 실기 미검증을 나누어 기록하고 한국어 PR로 검토한다.

### Task 3: 다섯 빈 공간 투어를 기능 흐름과 분리

**Files:** `apps/mobile/src/screens/foundation/index.tsx`, `apps/mobile/src/app/foundation-preview.tsx`, 새 `apps/mobile/src/app/showcase-tour.tsx`, `apps/mobile/src/navigation/foundation-pages.test.ts`.

- [ ] 실제 시연 앱의 투어 진입·복귀, 1~5페이지 스와이프/하단 표시 동기화, 선택한 역할의 표시와 빈 본문을 자동 시험으로 고정한다. 실패 경로를 먼저 확인한다.
- [ ] 개발용 시안의 빈 페이지 로직을 재사용하되 시연 화면에서는 `개발용 화면 시안` 문구를 노출하지 않는다. 투어를 닫으면 기존 탐색 화면에 도달한다. 본문에 기능 버튼·가짜 점포를 넣지 않는다.
- [ ] 감소된 동작·200% 글씨·라이트/다크·접근성 이름을 기존 테스트와 Android 실기 계획으로 확인한다.
- [ ] 대상 시험, 모바일 전체 시험·typecheck·lint·Android export를 통과시킨 뒤 한국어 PR에 변경 화면 근거를 첨부한다.

### Task 4: 실기 수용과 이슈 종료

**Files:** `docs/TEST_STATUS.md`, `docs/HANDOFF.md`, `docs/PROJECT_STATE.md`, `apps/mobile/README.md`.

1. 별도 시연 APK가 준비되면 실제 Android에서 첫 화면·고객/점주 선택·Google 로그인·권한 거절·탐색/도감·뒤로 가기·콜드 스타트·계정 전환을 실행한다. 각 결과에 package/커밋/기기/명령·재현 방법을 적는다.
2. 360/390/412dp, 200% 글씨, TalkBack, 라이트/다크, 감소된 동작을 확인한다. 실행하지 않은 항목은 `NOT_RUN`으로 둔다.
3. PR CI·필수 리뷰·병합 후 `main` CI와 위 실기가 모두 만족될 때만 #136을 `COMPLETED`로 닫는다. 시연 APK가 없으면 #136은 열린 채로 둔다.

**되돌리기:** 시연 역할 진입과 투어 route만 비활성화하거나 해당 PR을 되돌린다. 기존 운영 네 탭·API·DB·지갑 상태는 변경하지 않는다.

**다음 행동:** Task 1의 회귀 시험과 `.demo` 실기 경로를 진행한다. 실제 시연 APK/외부 API가 준비되지 않았으면 Task 4는 `NOT_RUN`으로 남긴다.
