# 앱·시연 웹 파란 UI 일관화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 Android 네 탭·맥락 화면·개발용 시안·읽기 전용 시연 웹의 색/간격/상태 시각 언어를 한 팔레트로 통일한다.

**Architecture:** 기존 `theme/palette.ts`와 `ui-metrics.ts`를 정본으로 두고 파란 시안의 대비를 충족하는 토큰으로 갱신한다. `foundation.ts`는 정본의 별칭만 가지며, 시스템 dynamic 색을 쓰는 화면은 scheme별 팔레트로 색을 선택한다. 시연 웹은 정적 CSS 변수로 같은 의미색을 사용하고 읽기 전용 경계는 유지한다. 라우트·인증·API·지갑 동작은 변경하지 않는다.

**Tech Stack:** Expo SDK 57/React Native 0.86, TypeScript/tsx node:test, 기존 CSS/HTML·Python site verifier. 신규 의존성·폰트·이미지 없음.

**Spec:** `docs/superpowers/specs/2026-09-24-blue-design-consistency.md`와 Issue #142.

**Execution dependency:** Task 1 token export must land before Task 2/3/4. Task 2 owns only four tab screen files, Task 3 owns only seven contextual screen files, Task 4 owns only `apps/showcase-web`/site tests, and Task 5 alone owns shared docs/evidence. Task 2/3/4 may run in parallel after Task 1 without editing each other's files.

## Global Constraints

- 새 파란 시안을 잠정 기준으로 삼되 `#376CF4` 일반 글자는 연한 배경 대비가 약하므로 행동색 `#2456D6`(light), `#9BB8FF`(dark)를 사용한다. 의미색 success/error/NFT 상태와 가상 점포 고지는 텍스트로 보존한다.
- 라이트 배경/표면/본문/보조 본문은 `#FFFFFF`/`#F5F7FA`/`#192331`/`#58677D`; 다크는 `#14171D`/`#20252F`/`#F3F5F9`/`#A6B0C0`이다. 행동 연한 면은 `#EBF1FF`/`#25334F`다.
- 20dp 페이지 여백·24dp 섹션 간격·20dp 카드 반경·48dp 최소 터치는 유지한다. 큰 글씨를 숨기지 않는다.
- 운영 네 탭·앱 화면의 기능/라우트·인증/점주 권한·지갑 메서드·API/DB·시연 웹의 무스크립트·무쓰기 규칙을 바꾸지 않는다.
- 과거 캡처·자동 번들 통과를 새 Android 실기 완료 증거로 쓰지 않는다.

## Review Focus

1. light/dark 본문·보조 글자·primary 버튼/면·성공/오류 배지가 실제 배경에서 4.5:1 이상인가? `opacity: 0.78`의 합성 대비를 확인했는가?
2. 시스템 테마 전환 뒤 11개 화면 및 하위 상태 컴포넌트가 같은 scheme의 색으로 다시 렌더되는가?
3. `@expo/ui Host seedColor`에서 파생된 네이티브 버튼 글자/배경이 실기에서 읽히는가?
4. 시연 웹의 다크 media 변수와 필수 가상 고지·키보드 초점이 360px/데스크톱에서 보이는가?
5. 스타일 이동이 탐색→방문 인증→도감과 지갑/점주 권한 동작을 바꾸지 않았는가?

## 실행 가능한 색상 시험 경계

각 화면은 기존 `StyleSheet.create({...})` 안에서 정적 `theme/colors.ts`를 참조하는 색상 부분을 `make<Screen>Styles(palette: AppColors)` 형태의 **같은 화면 폴더 `styles.ts` 순수 함수**로 옮긴다. 함수는 React Native runtime을 import하지 않고 plain style object를 반환한다. 화면은 `const palette = colorsForScheme(useColorScheme())`와 `useMemo(() => StyleSheet.create(make...Styles(palette)), [palette])`로 실제 사용한다. 이 함수의 반환값(배경·본문·버튼·상태색)을 light/dark로 실행해 시험한다. 정적 import가 사라졌는지만 검사하는 테스트는 보조 구조 검사이며 기능 PASS가 아니다. 이미 palette inline override를 쓰는 네 탭은 실제로 사용되는 정적 색상 스타일만 분리하고 나머지 handler/props를 옮기지 않는다.

| 화면 | 기존 진입 | 검증할 표시 상태 |
| --- | --- | --- |
| `merchant-list` | `/`·로컬 DEMO API | 점포 0건, 가상 점포 1건, 요청 실패 |
| `claim-redeem` | `/claim` | 빈/잘못된 코드, 카메라 권한 안내 |
| `collection` | `/collection` | 빈 도감, 앱 수집품/NFT 미발행 구분 |
| `account-settings` | `/settings` | DEMO/운영 차단 안내, 삭제 상태 |
| `merchant-detail` | `/merchants/showcase-local-merchant` | 가상 점포 고지와 `CenteredState` 오류 |
| `merchant-claim` | `/merchant`·로컬 STAFF | 시험 직원 권한, 발급 설정 부족 |
| `recommendations` | `/recommendations` | 추천 0건·오류·재시도 |
| `auth-required` | 인증 없는 development bundle | 설정 필요·로그인 필요 |
| `demo-configuration-required` | 개발 API/점주 env 누락 | 설정 안내 |
| `wallet-link/index` | `/wallet`·개발 DEMO | 연결 전/거절 안내·기존 메서드 경계 |
| `wallet-link/configuration-required` | Reown ID 누락 | 설정 안내 |

실제 Android 검증은 새 사용자 데이터가 없는 `Small_Phone` 에뮬레이터 또는 사용자가 연결한 시험 기기의 **개발 앱**과 loopback `_test` API/DB만 사용한다. 정확한 패키지·기기·커밋을 기록하고, `adb reverse tcp:3000 tcp:3000` 뒤 가능한 경로를 연다. 인증/지갑/권한 때문에 도달할 수 없는 화면은 `NOT_RUN` 또는 `BLOCKED`로 남기며 전체 실기 완료로 주장하지 않는다. 네 탭과 도달 가능한 보조 화면의 라이트·다크·200% 캡처는 `docs/evidence/design-consistency-2026-09-24/`에 경로별로 남긴다. 웹은 `python3 -m http.server 4174 --directory apps/showcase-web --bind 127.0.0.1`로 열고 브라우저의 light/dark emulation에서 `getComputedStyle(document.documentElement)` 변수와 본문/고지/포커스의 실제 색을 읽어 360px·1440px 캡처를 같은 증거 폴더에 둔다.

---

### Task 1: 정본 팔레트와 대비 회귀

**Files:** `apps/mobile/src/theme/palette.ts`, `apps/mobile/src/theme/foundation.ts`, `apps/mobile/src/theme/colors.test.ts`, `DESIGN.md`.

**Interfaces:** `colorsForScheme(scheme): AppColors`와 `foundationColors.light/dark` 이름은 유지. 기존 화면은 Task 2/3에서 같은 `AppColors` 타입을 사용.

- [ ] RED: `colors.test.ts`에 라이트 `primary='#2456D6'`, 다크 `primary='#9BB8FF'`, foundation alias 일치, `secondaryLabel/background`, `secondaryLabel/surface`, `primary/background`, `onPrimary/primary`, `onPrimaryContainer/primaryContainer` 등 실제 조합의 대비 4.5:1을 직접 계산하는 시험을 추가한다. 78% 불투명 흰 글자가 light primary 위에서 4.5 미만이라는 합성 함수 시험도 넣는다. 수정 전 새 토큰 기대값이 FAIL하는지 확인한다.
- [ ] GREEN: `palette.ts`를 지정 토큰으로 바꾸고 success/error 및 따뜻한 accent 의미를 보존한다. `foundation.ts`는 `lightColors/darkColors`를 import해 `ink/soft/accent/tint`를 파생하며 별도 hex를 없앤다. `DESIGN.md`의 독립 파랑/잎색 충돌을 새 기준과 역사적 시안 설명으로 바로잡는다.
- [ ] `npm test --prefix apps/mobile`, typecheck, 대비 검사를 실행하고 결과를 읽는다.

### Task 2: 운영 네 탭의 화면 토큰 정렬

**Files:** `apps/mobile/src/screens/merchant-list/index.tsx`, `claim-redeem/index.tsx`, `collection/index.tsx`, `account-settings/index.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`, 관련 테스트.

**Interfaces:** 각 화면은 기존 기능 props·API·라우트를 바꾸지 않고 `colorsForScheme(useColorScheme())`를 렌더 시점의 기준으로 사용한다. `uiMetrics` 값은 유지.

- [ ] RED: 네 화면의 adjacent `styles.ts`에서 `makeMerchantListStyles`, `makeClaimRedeemStyles`, `makeCollectionStyles`, `makeAccountSettingsStyles`가 반환하는 `content.backgroundColor`, `title.color`, `primaryButton.backgroundColor`, `errorText.color` 등 **현재 JSX가 참조하는 style key**를 light/dark 입력으로 시험한다. 예: `assert.equal(makeClaimRedeemStyles(darkColors).content.backgroundColor, '#14171D')`. 현재 파일이 없으므로 test import가 실패하는 것을 확인한 뒤 구현한다. 인증·방문·도감 API fixture 기대값은 바꾸지 않는다.
- [ ] GREEN: 각 화면의 정적 `colors.*` style을 adjacent 순수 `styles.ts`의 factory로 옮기고 실제 화면에서 `StyleSheet.create(make...Styles(palette))`를 사용한다. nested component는 이미 받는 `palette`를 계속 사용한다. 반복되는 14–20dp 반경·48dp 터치 크기는 기존 `uiMetrics`를 재사용한다. 검색·카메라·수령·발행 요청 로직은 옮기지 않는다.
- [ ] 모바일 대상 회귀·전체 단위·typecheck·lint를 실행한다. 360/390/412dp·200%·라이트/다크 화면 증거를 실제 사용한 빌드/기기와 연결한다.

### Task 3: 보조·인증·지갑·점주 화면 정렬

**Files:** `apps/mobile/src/screens/merchant-detail/index.tsx`, `merchant-claim/index.tsx`, `recommendations/index.tsx`, `auth-required/index.tsx`, `demo-configuration-required.tsx`, `wallet-link/index.tsx`, `wallet-link/configuration-required.tsx`, 관련 테스트.

**Interfaces:** `theme/colors.ts`의 시스템 dynamic 정적 색 사용을 각 화면의 현재 light/dark palette로 대체한다. API·auth·Reown import 위치와 허용 메서드는 변경하지 않는다.

- [ ] RED: 일곱 화면의 adjacent `styles.ts` factory 반환값 중 현재 JSX가 사용하는 root background, title/body, primary/error/status style을 light/dark에서 시험한다. `merchant-detail`은 **먼저 기존 값을 보존한** `makeMerchantDetailStyles(palette)`를 추출해 실제 JSX에 연결한다. 그 다음 `styles.demoBadge.color`를 부모 `styles.hero.backgroundColor` 위에 `styles.demoBadge.opacity ?? 1`로 합성해 대비 ≥4.5를 요구하는 시험을 실행한다. light에서 기존 `opacity: 0.78`은 계산상 약 **4.438:1**이므로 RED여야 한다. `styles.story`도 같은 `hero` 배경을 사용해 검사한다. `collection`의 성공 글자가 `surface` 위에 있는 실제 조합과 `wallet-link`의 label이 status container 위에 있는 조합도 대비 fixture에 포함한다.
- [ ] GREEN: nested `InfoRow`, `CenteredState`, `PrimaryButton`, `StatusRow`에도 palette를 전달하거나 같은 화면 factory styles를 전달한다. DEMO 고지의 `opacity: 0.78`을 제거해 일반 텍스트 대비를 보장한다. `Host seedColor`는 선택한 primary를 넘기고 실제 화면에서 파생 버튼 색을 확인한다.
- [ ] 모바일 전체 단위·typecheck·lint, 개인정보 로그·지갑 release 표면 검사를 실행한다. 실제 외부 지갑 연결·점주 실기는 수행한 범위만 PASS로 기록한다.

### Task 4: 읽기 전용 시연 웹 라이트/다크 정렬

**Files:** `apps/showcase-web/assets/showcase.css`, `tests/site/verify_showcase_site_test.mjs` 또는 별도 CSS 대비 시험, `apps/showcase-web/README.md`.

**Interfaces:** 기존 HTML/CSP/허용 목록/가상 문구는 그대로, CSS 변수·media만 변경.

- [ ] RED: CSS light/dark에서 `--ink/--paper/--stream/--surface` 등 필수 변수와 대비를 확인하고 `@media (prefers-color-scheme: dark)`의 `getComputedStyle` 결과를 요구하는 로컬 브라우저 회귀를 추가해 현재 웹에서 FAIL을 본다. 문자열로 media 선언 존재만 검사하지 않는다.
- [ ] GREEN: CSS 변수와 고지·카드·링크 포커스 색을 정본 팔레트에 맞추고 dark media에서 각 변수의 값을 명시한다. `url()`, `@import`, JS·쓰기 요소를 추가하지 않는다.
- [ ] 기존 시연 웹 verifier와 mutation 테스트, 실제 브라우저 360px/desktop·라이트/다크·큰 글씨·키보드 초점·요청 경로를 확인한다.

### Task 5: 증거·문서·CI/PR

**Files:** `README.md`, `DESIGN.md`, `docs/TEST_STATUS.md`, `docs/HANDOFF.md`, `docs/PROJECT_STATE.md`, `docs/evidence/`.

- [ ] 실제 변경 화면·자동/실기 결과를 PASS/FAIL/BLOCKED/NOT_RUN으로 기록한다. 기존 36개 ID를 변경하지 않고, 디자인 통일을 Issue #137의 외부 시연 완료로 표현하지 않는다.
- [ ] 모바일 전체·typecheck·lint·Android JS export, 사이트·accessibility·bootstrap·privacy·W08 회귀와 `git diff --check`를 실행한다.
- [ ] 한글 PR 하나로 Issue #142에 연결하고 독립 코드/디자인 리뷰·CI 후 병합한다. 외부 공개·Play 제출은 하지 않는다.
