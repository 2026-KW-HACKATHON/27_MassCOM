# 시연 Android 인증 정체성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** `kr.masscom.wolgye.demo`가 운영 Google/Reown 설정을 상속하지 않고 전용 Google 공개 클라이언트로 로그인할 수 있는 앱 코드를 만든다.

**Architecture:** `app.config.ts`는 시연 전용 Google Web client ID를 앱 설정 `extra.masscomShowcase`에 넣는다. 런타임은 실제 설치 package가 `.demo`일 때만 그 값을 사용하며, 값이 없으면 로그인 구성을 닫는다. 운영·개발 앱은 기존 `EXPO_PUBLIC_*` 경로를 유지한다. 지갑은 별도 Reown 프로젝트가 준비될 때까지 시연 앱에서 비활성이다.

**Tech Stack:** Expo SDK 57, React Native, TypeScript, Node `tsx --test`.

**Spec:** [시연·운영 환경 분리 설계](../specs/2026-09-23-showcase-production-separation-design.md), Issue #137.

## Global Constraints

- 시연 API URL은 정확히 `https://demo-api.masscom.kr`, 운영은 `https://api.masscom.kr`이다.
- 시연 앱 package/scheme은 `kr.masscom.wolgye.demo`/`masscom-demo`이며 개발 DEMO 계정 헤더는 허용하지 않는다.
- Google Web client ID는 공개 식별자이며 client secret이 아니다. 앱 설정에 비밀값을 넣지 않는다.
- 개인키·복구 문구·송금·approve·permit·스왑·구매를 추가하지 않는다.
- 외부 DNS/API·실기 APK·Google 로그인은 코드와 별도 검증 상태로 남긴다.

## Review Focus

- 시연 package에 운영 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`가 남아 있을 때 빌드가 거절되는지 Task 1에서 시험한다.
- 시연 전용 ID가 빠졌을 때 운영 ID를 런타임에서 대신 쓰지 않는지 Task 2에서 시험한다.
- 운영 package가 시연 `extra`를 읽지 않는지 Task 2에서 시험한다.
- 잘못된 client ID 형식이 빌드에 들어오지 않는지 Task 1에서 시험한다.
- 시연 지갑 설정이 준비되지 않았는데 운영 Reown 프로젝트로 연결되지 않는지 Task 2에서 시험한다.

---

### Task 1: 시연 전용 Google 빌드 설정

**Files:** `apps/mobile/src/config/build-environment.cjs`, `apps/mobile/src/config/build-environment.ts`, `apps/mobile/app.config.ts`, `apps/mobile/src/config/build-environment.test.ts`.

**Interfaces:** `validateBuildEnvironment('showcase', env)`는 `MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID`가 Google Web client ID 형식일 때만 성공한다. `app.config.ts`는 이를 `extra.masscomShowcase.googleWebClientId`에 넣는다.

- [ ] `build-environment.test.ts`에 시연 전용 Web ID가 없거나 잘못되면 거절하고, 운영 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`·`EXPO_PUBLIC_REOWN_PROJECT_ID`가 있으면 거절하는 시험을 쓴다. 실제 Expo config에서 전용 ID가 `extra.masscomShowcase.googleWebClientId`로 보이는지 시험한다.

```ts
assert.throws(() => validateBuildEnvironment('showcase', {
  EXPO_PUBLIC_API_URL: 'https://demo-api.masscom.kr',
  MASSCOM_BUILD_SOURCE_COMMIT: 'a'.repeat(40),
}), /MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID/);
```

- [ ] `cd apps/mobile && npx --no-install tsx --test src/config/build-environment.test.ts`에서 새 시험이 실패하는 것을 확인한다.
- [ ] `validateBuildEnvironment`에 `MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID` 형식·누락 검사를 넣고, `app.config.ts`에서 아래 형태의 `extra`를 구성한다. 운영·개발 `extra`에서는 해당 값을 제거한다.

```ts
extra: showcase
  ? { ...config.extra, masscomShowcase: { googleWebClientId: process.env.MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID?.trim() } }
  : { ...config.extra, masscomShowcase: undefined },
```
- [ ] 같은 대상 시험과 `npm run typecheck --prefix apps/mobile`을 다시 실행해 통과를 확인한다.
- [ ] 보안 경계만 독립 커밋한다. 커밋 제목은 의도 중심 한국어로 쓰고 실제 시험을 trailer에 기록한다.

### Task 2: 설치 package 기반 런타임 선택

**Files:** 새 `apps/mobile/src/config/showcase-identity.ts`, 새 `apps/mobile/src/config/showcase-identity.test.ts`, `apps/mobile/src/auth/auth-provider.tsx`, `apps/mobile/src/wallet/appkit.ts`.

**Interfaces:** `resolveRuntimeIdentity(packageId, extra, env)`는 `{ googleWebClientId?: string; reownProjectId?: string }`을 반환한다. `.demo`는 `extra.masscomShowcase.googleWebClientId`만 사용하고 `reownProjectId`는 반환하지 않는다. 나머지 기존 package는 기존 공개 환경변수를 사용한다.

- [ ] `showcase-identity.test.ts`에 `.demo`는 전용 ID만 사용, 설정 누락 시 운영 ID fallback 없음, 운영/개발 package는 기존 경로 유지, 잘못된 `extra` 값 거절을 시험한다.

```ts
assert.deepEqual(resolveRuntimeIdentity('kr.masscom.wolgye.demo', {}, {
  googleWebClientId: 'production-id', reownProjectId: 'production-project',
}), { googleWebClientId: undefined, reownProjectId: undefined });
```
- [ ] `cd apps/mobile && npx --no-install tsx --test src/config/showcase-identity.test.ts`에서 실패를 확인한다.
- [ ] 최소 resolver를 구현하고 `auth-provider.tsx`·`appkit.ts`에 연결한다. package ID는 `expo-application`에서 읽고 `extra`는 `expo-constants`에서 읽는다.

```ts
const identity = resolveRuntimeIdentity(
  Application.applicationId,
  Constants.expoConfig?.extra,
  { googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    reownProjectId: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID },
);
```
- [ ] 대상 시험·모바일 전체 시험·typecheck·lint·Android JS export를 실행한다.
- [ ] 런타임 경계와 시험을 독립 커밋한다.

### Task 3: 기록·검증·통합

**Files:** `apps/mobile/README.md`, `README.md`, `docs/HANDOFF.md`, `docs/PROJECT_STATE.md`, `docs/TEST_STATUS.md`.

- [ ] 문서에 전용 Web ID 설정 방법과 `demo-api.masscom.kr`·Android OAuth client·서버 audience·실기 미완료를 적는다. 비밀값이나 실제 사용하지 않은 client ID는 기록하지 않는다.
- [ ] `bash tests/bootstrap/verify_bootstrap_test.sh`, `bash tests/bootstrap/verify_operations_docs_test.sh`, `bash tests/release/check_release_wallet_surface_test.sh`, `git diff --check`를 실행한다.
- [ ] 한국어 PR을 열고 필수 CI·독립 보안 검토를 확인한 뒤 일반 병합한다. 새 유료 자원과 공개 배포는 이 PR에서 만들지 않는다.

## 후속 외부 작업 경계

전용 Google Web/Android OAuth client 생성, 별도 시연 DB·API, 무료 정적 시연 웹 도메인, 실기 APK는 각자의 자원·인증·기기 검증을 거쳐 진행한다. 코드가 통과해도 외부 시연 앱 완료로 기록하지 않는다.
