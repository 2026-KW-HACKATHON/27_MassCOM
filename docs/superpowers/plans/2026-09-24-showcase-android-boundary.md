# 시연 Android 빌드 경계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영·개발 앱과 동시에 설치 가능한 시연 Android 정체성을 추가하고 시연/운영 API 교차 연결을 빌드 전에 차단한다.

**Architecture:** 기존 `APP_VARIANT` 분기를 명시적 `development | showcase | production` 세 값으로 고정한다. 빌드 환경 검사에서 production은 `https://api.masscom.kr`, showcase는 `https://demo-api.masscom.kr`만 허용하고, 둘 다 개발 DEMO 헤더 변수를 거절한다. Expo config는 showcase 이름·package·scheme·App Link host를 독립 지정하되 기존 계정/지갑/기능 라우트를 바꾸지 않는다. 외부 API·OAuth·Reown·DNS·새 유료 자원은 이 코드 단위에서 생성하지 않는다.

**Tech Stack:** Expo SDK 57, TypeScript, Node.js 내장 URL/IP 검사, 기존 `node:test`·`tsx`. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-23-showcase-production-separation-design.md`의 환경별 앱·데이터 계약과 교차 연결 거절.

## Global Constraints

- 운영 package/scheme `kr.masscom.wolgye`/`masscom`, 개발 `kr.masscom.wolgye.dev`/`masscom-dev`는 유지한다. 시연은 `kr.masscom.wolgye.demo`/`masscom-demo`, 사용자 표시 이름 `월계 마스코트 체험용`으로 식별한다.
- 시연 API origin은 정확히 `https://demo-api.masscom.kr`, 운영은 정확히 `https://api.masscom.kr`이다. URL userinfo·path(최상위 `/` 제외)·query·fragment·비표준 port는 거절한다. 외부 시연 API가 준비되지 않은 현재에는 package 설정·차단 시험만 PASS이며 Android QR·외부 HTTPS는 NOT_RUN이다.
- production/showcase에서 `EXPO_PUBLIC_DEMO_ACCOUNT_ID`, `EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID`, `EXPO_PUBLIC_DEMO_MERCHANT_ID`, `EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION`는 값이 `false`라도 설정돼 있으면 거절한다. development만 현행 loopback DEMO를 유지한다.
- 알 수 없는 `APP_VARIANT` 값을 development로 묵시 처리하지 않는다. 빈 값은 기존 기본 development로 유지한다.
- 기존 운영 지갑 메서드·SIWE 체인·nonce·서버 검증과 사용자 자산 경계를 바꾸지 않는다. 이 **경계만 구현하는 단위**의 showcase 빌드는 기존 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`·`EXPO_PUBLIC_REOWN_PROJECT_ID`가 비어 있어야 한다. 별도 OAuth/Reown 프로젝트와 API 인증이 다음 단위에서 명시적으로 연결되기 전에는 showcase 앱의 로그인·지갑·QR을 동작 완료로 주장하지 않는다.
- 새 클라우드·도메인·DNS·공개 APK·Google Play 제출은 이 계획의 자동 실행 범위가 아니다.

## Review Focus

1. `APP_VARIANT=showcase`가 운영 URL 또는 우회된 `demo-api.masscom.kr.evil`을 받으면 Expo config 읽기 전에 실패하는가?
2. `APP_VARIANT=production`이 `demo-api.masscom.kr`, userinfo, query, path, 포트를 거절하는가?
3. 알 수 없는 variant와 `false` DEMO 설정이 각각 fail-closed 되는가?
4. 세 variant가 다른 package/scheme/name을 가지며 시연 빌드에서 개발 launcher가 빠지는가?
5. 앱에 포함된 지갑 복귀 scheme이 설치된 showcase package에서도 `masscom-demo`를 선택하고, package와 config scheme이 다르면 중단하는가?

---

### Task 1: URL·variant fail-closed 검사

**Files:**
- Modify: `apps/mobile/src/config/build-environment.cjs`
- Modify: `apps/mobile/src/config/build-environment.ts`
- Modify: `apps/mobile/src/config/build-environment.test.ts`

**Interfaces:** `validateBuildEnvironment(variant: string | undefined, environment: MobileBuildEnvironment): void`를 유지한다.

- [ ] **Step 1 RED:** `build-environment.test.ts`에 `showcase`는 `https://demo-api.masscom.kr`만 허용, production은 `https://api.masscom.kr`만 허용, URL userinfo/path/query/fragment/port·교차 host·`APP_VARIANT=prodction`·두 release variant의 DEMO env를 거절하는 표 기반 시험을 먼저 추가한다. showcase에서 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` 또는 `EXPO_PUBLIC_REOWN_PROJECT_ID`가 한 값이라도 있으면 거절하는 시험을 포함한다. `evaluateExpoConfig`의 환경 정리 목록에도 두 키를 넣어 테스트 프로세스의 운영 공개 ID를 물려받지 않게 한다. `npx tsx --test src/config/build-environment.test.ts`에서 현재 코드가 showcase를 묵시 development 처리하므로 FAIL을 확인한다.
- [ ] **Step 2 GREEN:** 빈 variant를 development로 정규화하고 나머지 미지 값은 `UNSUPPORTED_APP_VARIANT`로 거절한다. release origin은 `new URL`의 `origin`, `pathname`, `search`, `hash`, `username`, `password`, `port`를 검사하고 원본 URL을 오류에 출력하지 않는다. 기존 production source-commit 검사는 유지하고 showcase도 추후 배포 추적을 위해 40-hex commit을 요구한다.
- [ ] **Step 3:** 대상 시험·전체 `npm test --prefix apps/mobile`, typecheck를 실행한다. production 기존 API 호스트 시험 값을 새 정확한 도메인에 맞추되 거절 시험을 약화하지 않는다.

### Task 2: Expo 시연 package·scheme·표식

**Files:**
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/src/config/build-environment.test.ts`
- Modify: `apps/mobile/src/wallet/appkit.ts`
- Modify: `apps/mobile/src/wallet/wallet-metadata.ts`
- Modify: `apps/mobile/src/wallet/wallet-metadata.test.ts`
- Create: `apps/mobile/src/wallet/return-scheme.ts`, `apps/mobile/src/wallet/return-scheme.test.ts`

**Interfaces:** Expo config의 `name`, `scheme`, `android.package`, `android.intentFilters`, `plugins`; 지갑 metadata 생성 함수 `createWalletMetadata(appScheme)`는 기존 운영·개발 출처를 유지하고 시연 scheme에서는 시연 명칭/URL만 사용한다.

- [ ] **Step 1 RED:** 실제 `expo config --type public --json`을 자식 프로세스로 평가해 showcase package=`kr.masscom.wolgye.demo`, scheme=`masscom-demo`, name=`월계 마스코트 체험용`, `/open` host=`demo.masscom.kr`, `expo-dev-client` 제외, overlay 권한 차단을 기대한다. `createWalletMetadata('masscom-demo')`의 시연 URL·복귀 scheme 시험을 추가한다. `resolveWalletReturnScheme`의 demo/dev/prod package fallback, 문자열·배열 config, package-config 불일치와 미지 package 거절을 별도 단위 시험한다.
- [ ] **Step 2 GREEN:** `app.config.ts`에서 세 variant를 명시 분기하고 production/showcase만 출시형 플러그인·source-commit marker·권한 차단을 공유한다. `wallet/return-scheme.ts`는 설치 package를 세 정확한 scheme에 매핑하고 주어진 config와 충돌하면 고정 오류로 중단한다. `appkit.ts`는 이 함수를 사용한다. `wallet-metadata.ts`는 demo scheme에서 `월계 마스코트 체험용`과 `https://demo.masscom.kr`, 기존 공개 SVG 아이콘, `masscom-demo://wallet`을 사용한다. showcase 빌드에 실제 인증·지갑 공개 ID는 설정하지 않으며 승인된 별도 프로젝트 후속 전까지 기능은 BLOCKED로 둔다.
- [ ] **Step 3:** 실제 Expo config 세 종류, 단위 전체·typecheck·lint·Android JS export·`bash tests/release/check_release_wallet_surface_test.sh` 회귀를 실행한다. `scripts/check-release-wallet-surface.sh`의 실제 showcase AAB 판정과 Android 동시 설치는 native artifact+기기 전까지 NOT_RUN이다. [Expo 공식 variant 가이드](https://docs.expo.dev/build-reference/variants/)에 따라 서로 다른 package의 native 빌드를 실제로 할 때는 격리된 checkout에서 해당 `APP_VARIANT`로 `prebuild --clean` 후 빌드하고 현재 개발 native 트리를 덮어쓰지 않는다.

### Task 3: 상태·실행 경계 기록과 한국어 PR

**Files:**
- Modify: `apps/mobile/README.md`, `.env.example`, `README.md`, `docs/TEST_STATUS.md`, `docs/HANDOFF.md`, `docs/superpowers/specs/2026-09-23-showcase-production-separation-design.md`

**Interfaces:** 개발자가 세 variant와 필요한 외부 입력을 구별하고, 미실행을 PASS로 오인하지 않도록 하는 문서.

- [ ] README에 세 variant의 package/scheme/API URL, 시연 외부 인증·Reown 미구성, 기존 development만 로컬 DEMO가 가능함을 적는다. 승인·실행하지 않은 demo DNS/API/DB/호스팅/실제 APK를 완료로 쓰지 않는다.
- [ ] `docs/TEST_STATUS.md`에 실제 명령·커밋·환경을 PASS/FAIL/BLOCKED/NOT_RUN으로 기록하고 36개 필수 ID는 변경하지 않는다. 명세 머리말의 초기 검토 상태와 Issue #136 미병합 가정을 현재 검증 상태에 맞춰 바로잡는다.
- [ ] `bash scripts/check-privacy.sh`, `bash scripts/verify-bootstrap.sh`, `node scripts/verify-operations-docs.mjs`, `git diff --check`를 실행하고 한국어 Issue #137 연결 PR을 하나 열어 CI·독립 리뷰 후 통합한다. 기존 무관한 Issue #136을 닫지 않는다.

## 후속 독립 계획

시연 API·DB의 실제 인증/계정 분리, DNS·HTTPS·APK 배포/실기, 운영 웹 본인 도감의 서버 cookie 세션과 CSRF 보안, 새 UI 시안 기준의 전체 디자인 토큰 통합은 각각 별도 수직 단위다. 이 계획의 로컬 빌드 경계 통과는 Issue #137 완료 판정이 아니다.
