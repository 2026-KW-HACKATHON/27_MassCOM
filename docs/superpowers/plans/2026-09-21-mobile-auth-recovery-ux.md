# Mobile Authentication, Recovery, and Core UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace production `x-account-id` use with secure Google-backed Bearer sessions, preserve an explicit development DEMO path, and make claim/NFT recovery and next-store UX resilient to partial failures.

**Architecture:** A versioned SecureStore session and one `AccountCredential` union sit between authentication and every account-scoped API client. `AuthSessionProvider` owns restore/login/logout/account-switch state, while route components receive only the active credential. Claim replay is made idempotent on the server, and collection/binding/polling failures are modeled independently so a wallet or network problem does not erase the user's visit record.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript 6, `react-native-nitro-google-signin@2.3.0`, `react-native-nitro-modules@0.37.1`, SDK-compatible `expo-secure-store`, Node test runner, Node.js API, PostgreSQL 18

**Spec:** `docs/superpowers/specs/2026-09-21-audit-remediation-design.md`

## Global Constraints

- Pin `react-native-nitro-google-signin` to `2.3.0` and `react-native-nitro-modules` to `0.37.1`; install `expo-secure-store` through `npx expo install` so Expo SDK 57 selects its compatible version.
- Google configuration requires a server-audience Web OAuth client plus Android clients for each package/SHA combination; do not create or invent client IDs.
- Google mobile `signIn`, `getTokens`, and `presentExplicitSignIn` cannot reliably force fresh `auth_time`. Implement initial login, Bearer use, logout, and account switch only.
- Keep server `auth_time` validation unchanged. Do not substitute `iat`, weaken the five-minute window, or claim destructive reauthentication complete.
- Production account requests send only `Authorization: Bearer`; development DEMO requests send only `x-account-id`. Never send both.
- Store the server session token only in SecureStore and an in-memory provider state. Never store it in AsyncStorage, URL parameters, logs, evidence, or screen copy.
- Preserve wallet method allowlist, binding/version checks, fixed mint recipient, mint idempotency, and account deletion retention rules.
- Point-of-sale customer identity and merchant production authentication remain unresolved and out of scope; the `/merchant` development DEMO route stays development-only.
- No mainnet, Play submission, paid hosting, new operations keys, multi-minter, trading, random rewards, or paid features.

## Review Focus

- SecureStore read/write/delete failure and an expired local record must fail closed to signed-out without exposing or reusing the token; Task 1 owns these tests.
- Bearer and DEMO headers must be mutually exclusive across commerce, recommendation, wallet, and deletion clients; Task 2 owns the matrix.
- Account switch must revoke the old server session, clear SecureStore, disconnect/purge the old wallet session, and remount state under the new account ID; Tasks 4 and 5 own the ordering tests.
- A lost redeem response followed by the same account/token retry must return the original visit/reward result without a second DB effect; Task 7 owns the PostgreSQL regression.
- Three consecutive NFT polling failures must stop the timer but retain collection/mint state and expose a manual retry; Task 6 owns the state-machine tests.

---

### Task 1: Add pinned Google native dependencies and fail-closed SecureStore sessions

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/.env.example`
- Modify: `apps/mobile/src/types/env.d.ts`
- Create: `apps/mobile/src/auth/auth-config.ts`
- Create: `apps/mobile/src/auth/auth-config.test.ts`
- Create: `apps/mobile/src/auth/session-store.ts`
- Create: `apps/mobile/src/auth/session-store.test.ts`

**Interfaces:**
- Produces: `AuthConfiguration = { available: true; webClientId: string } | { available: false; missing: readonly ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] }`.
- Produces: `StoredAuthSessionV1 = { version: 1; sessionToken: string; accountId: string; expiresAt: string }`.
- Produces: `createSessionStore(secureStore, now)` with `load()`, `save(session)`, and `clear()`.

- [ ] **Step 1: Install the exact native dependencies**

Run from the repository root:

```bash
npm install --prefix apps/mobile --save-exact \
  react-native-nitro-google-signin@2.3.0 \
  react-native-nitro-modules@0.37.1
(cd apps/mobile && npx expo install expo-secure-store)
```

Expected: `package.json` and lockfile record exactly the two Nitro versions, while `expo-secure-store` resolves to the Expo SDK 57-compatible version. Do not add `expo-auth-session` or `@react-native-google-signin/google-signin`.

- [ ] **Step 2: Write auth config and session-store tests**

Test exact parsing for missing/trimmed Web client ID. For storage, use an in-memory fake implementing `getItemAsync`, `setItemAsync`, and `deleteItemAsync` and cover:

- valid v1 restore;
- expired `expiresAt` deletes the record and returns `undefined`;
- malformed JSON, wrong version, empty token/account, and invalid date delete the record;
- read failure and write failure throw `AuthStorageError` without returning a session;
- saved JSON contains no key other than `version`, `sessionToken`, `accountId`, `expiresAt`.

```ts
export type StoredAuthSessionV1 = {
  version: 1;
  sessionToken: string;
  accountId: string;
  expiresAt: string;
};
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
(cd apps/mobile && npx --no-install tsx --test \
  src/auth/auth-config.test.ts src/auth/session-store.test.ts)
```

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement config and SecureStore adapter**

Use fixed key `masscom.auth.session.v1`. Parse before returning and compare `Date.parse(expiresAt)` with the injected `now()`. On malformed/expired data call `deleteItemAsync` before returning `undefined`. Wrap storage implementation failures in `AuthStorageError('READ_FAILED' | 'WRITE_FAILED' | 'DELETE_FAILED')` without embedding underlying messages.

```ts
export function createSessionStore(
  secureStore: Pick<typeof SecureStore, 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'>,
  now: () => Date = () => new Date(),
) {
  return {
    load(): Promise<StoredAuthSessionV1 | undefined>,
    save(session: StoredAuthSessionV1): Promise<void>,
    clear(): Promise<void>,
  };
}
```

- [ ] **Step 5: Configure the native plugin and environment typing**

Add `react-native-nitro-google-signin` and `expo-secure-store` to `plugins` in `app.config.ts` without weakening Task 3 of the security plan's production environment assertion. Add `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to `.env.example` as an empty, non-secret public client identifier slot and to `env.d.ts`.

- [ ] **Step 6: Run mobile install/static gates**

Run:

```bash
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
```

Expected: PASS. Native prebuild is deferred until auth provider wiring is present.

- [ ] **Step 7: Commit storage and dependency contract**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/app.config.ts \
  apps/mobile/.env.example apps/mobile/src/types/env.d.ts apps/mobile/src/auth
git commit \
  -m "운영 로그인 세션을 기기 보안 저장소에만 둔다" \
  -m "Constraint: Nitro Google Sign-In 2.3.0과 Nitro Modules 0.37.1 고정" \
  -m "Rejected: AsyncStorage session token | 다른 앱 데이터와 같은 일반 저장 경계" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: mobile auth config/session storage unit, typecheck, lint"
```

### Task 2: Introduce one mutually exclusive account credential for all clients

**Files:**
- Create: `apps/mobile/src/auth/account-credential.ts`
- Create: `apps/mobile/src/auth/account-credential.test.ts`
- Modify: `apps/mobile/src/commerce/commerce-api.ts:80-199`
- Modify: `apps/mobile/src/commerce/commerce-api.test.ts`
- Modify: `apps/mobile/src/recommendation/recommendation-api.ts:21-60`
- Modify: `apps/mobile/src/recommendation/recommendation-api.test.ts`
- Modify: `apps/mobile/src/wallet/wallet-api.ts:50-124`
- Modify: `apps/mobile/src/wallet/wallet-api.test.ts`
- Modify: `apps/mobile/src/privacy/account-deletion-api.ts:14-61`
- Modify: `apps/mobile/src/privacy/account-deletion-api.test.ts`

**Interfaces:**
- Produces: `AccountCredential` union from the design spec.
- Produces: `headersForCredential(credential): Record<string, string>`.
- All account-scoped client constructors consume `credential`, never a free `accountId` plus token pair.

- [ ] **Step 1: Write the credential header matrix**

```ts
test('bearer and demo headers are mutually exclusive', () => {
  assert.deepEqual(
    headersForCredential({ kind: 'bearer', sessionToken: 'server-session' }),
    { Authorization: 'Bearer server-session' },
  );
  assert.deepEqual(
    headersForCredential({
      kind: 'demo',
      accountId: 'customer-1',
      allowInsecureReauthentication: false,
    }),
    { 'x-account-id': 'customer-1' },
  );
});
```

Reject empty bearer tokens and empty demo account IDs in `assertCredential`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `(cd apps/mobile && npx --no-install tsx --test src/auth/account-credential.test.ts)`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the credential union and headers**

```ts
export type AccountCredential =
  | { kind: 'bearer'; sessionToken: string }
  | { kind: 'demo'; accountId: string; allowInsecureReauthentication: boolean };

export function headersForCredential(credential: AccountCredential): Record<string, string> {
  assertCredential(credential);
  return credential.kind === 'bearer'
    ? { Authorization: `Bearer ${credential.sessionToken}` }
    : { 'x-account-id': credential.accountId };
}
```

Do not include the server-generated `accountId` in Bearer headers.

- [ ] **Step 4: Convert each client test to run both credentials**

For every account-scoped client, assert one Bearer request has `Authorization` and no `x-account-id`, and one DEMO request has `x-account-id` and no `Authorization`. For account deletion, assert only a DEMO credential with `allowInsecureReauthentication: true` adds `x-demo-reauthenticated`.

- [ ] **Step 5: Change client constructors and request helpers**

Use `{ apiUrl, credential, fetcher? }` consistently. Preserve public `GET /merchants` as unauthenticated. Preserve response parsing and error code behavior.

- [ ] **Step 6: Run all API-client unit tests**

Run:

```bash
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
```

Expected: screen compile errors are allowed only until Task 4 if the compiler reaches old constructor calls; unit tests for the four clients must pass. Before committing, update temporary compile sites only when necessary to use the explicit DEMO credential factory from `demo-runtime.ts` so the branch remains typecheck-green.

- [ ] **Step 7: Commit the credential boundary**

```bash
git add apps/mobile/src/auth/account-credential.ts \
  apps/mobile/src/auth/account-credential.test.ts \
  apps/mobile/src/commerce/commerce-api.ts apps/mobile/src/commerce/commerce-api.test.ts \
  apps/mobile/src/recommendation/recommendation-api.ts apps/mobile/src/recommendation/recommendation-api.test.ts \
  apps/mobile/src/wallet/wallet-api.ts apps/mobile/src/wallet/wallet-api.test.ts \
  apps/mobile/src/privacy/account-deletion-api.ts apps/mobile/src/privacy/account-deletion-api.test.ts \
  apps/mobile/src/config/demo-runtime.ts
git commit \
  -m "계정 API가 Bearer와 DEMO 신원을 섞지 않게 한다" \
  -m "Constraint: 운영 요청은 서버 session만 계정 주체로 사용" \
  -m "Rejected: accountId와 token을 선택 인자로 함께 받기 | 헤더 혼용 상태를 표현할 수 있음" \
  -m "Confidence: high" \
  -m "Scope-risk: broad" \
  -m "Tested: mobile account-client unit and typecheck"
```

### Task 3: Build Google login and server session adapters

**Files:**
- Create: `apps/mobile/src/auth/auth-api.ts`
- Create: `apps/mobile/src/auth/auth-api.test.ts`
- Create: `apps/mobile/src/auth/google-sign-in.ts`
- Create: `apps/mobile/src/auth/google-sign-in.test.ts`

**Interfaces:**
- Produces: `AuthApiClient.signIn(idToken): Promise<StoredAuthSessionV1>` and `logout(sessionToken): Promise<void>`.
- Produces: `GoogleSignInAdapter.configure(webClientId)`, `signIn(): Promise<{ idToken: string }>`, and `signOut(): Promise<void>`.
- Does not produce a destructive reauthentication method.

- [ ] **Step 1: Write server auth API tests**

Assert `POST /auth/google` sends `{ idToken }` in JSON body with no Authorization header, validates `{ sessionToken, accountId, expiresAt }`, maps non-2xx to `AuthApiError`, and never includes the ID token in an error message. Assert `POST /auth/logout` sends the Bearer token and accepts `{ status: 'LOGGED_OUT' }`.

- [ ] **Step 2: Write Nitro adapter tests around an injected native surface**

Define the injection interface:

```ts
export type NitroGoogleSurface = {
  configure(options: { webClientId: string; offlineAccess: false }): void;
  signIn(): Promise<{ data?: { idToken?: string | null } } | { idToken?: string | null }>;
  signOut(): Promise<void>;
};
```

Test trimmed Web client ID, missing ID token failure `GOOGLE_ID_TOKEN_MISSING`, native cancellation mapping `GOOGLE_SIGN_IN_CANCELLED`, and signOut forwarding. Do not add `getTokens` or `presentExplicitSignIn` to this interface.

- [ ] **Step 3: Run adapter tests and verify RED**

Run:

```bash
(cd apps/mobile && npx --no-install tsx --test \
  src/auth/auth-api.test.ts src/auth/google-sign-in.test.ts)
```

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement the auth API client**

Normalize API URL with existing `normalizePublicApiUrl`. Parse only the three server session fields and set `version: 1`. `AuthApiError` carries only status/code, not payload or token.

- [ ] **Step 5: Implement the Nitro wrapper**

Import the package's documented Google Sign-In export in the runtime adapter only. Keep the injected wrapper pure enough for Node tests. Configure once with `{ webClientId, offlineAccess: false }`. Normalize the installed package's `signIn` result into `{ idToken }` and map cancellation without logging the native error object.

- [ ] **Step 6: Run unit and static tests**

Run:

```bash
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
```

Expected: PASS.

- [ ] **Step 7: Commit auth adapters**

```bash
git add apps/mobile/src/auth/auth-api.ts apps/mobile/src/auth/auth-api.test.ts \
  apps/mobile/src/auth/google-sign-in.ts apps/mobile/src/auth/google-sign-in.test.ts
git commit \
  -m "Google ID token을 서버 Bearer session으로 교환한다" \
  -m "Constraint: Web OAuth client는 서버 audience이며 실제 ID는 저장소에 발명하지 않음" \
  -m "Rejected: Google token을 API Bearer로 직접 사용 | 서버 session 폐기와 account 경계를 우회함" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: mobile Google/auth API adapter unit, typecheck, lint"
```

### Task 4: Add the auth state machine, login gate, logout, and account switch

**Files:**
- Create: `apps/mobile/src/auth/auth-controller.ts`
- Create: `apps/mobile/src/auth/auth-controller.test.ts`
- Create: `apps/mobile/src/auth/auth-provider.tsx`
- Create: `apps/mobile/src/screens/auth-required/index.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx:1-66`
- Modify: `apps/mobile/src/wallet/forget-wallet-session.ts`
- Modify: `apps/mobile/src/wallet/forget-wallet-session.test.ts`
- Modify: `apps/mobile/src/wallet/appkit.ts:13-52`
- Modify: `apps/mobile/src/wallet/wallet-runtime-config.ts:3-83`
- Modify: `apps/mobile/src/wallet/wallet-runtime-config.test.ts`

**Interfaces:**
- Produces: `AuthState = { status: 'restoring' } | { status: 'signedOut'; reason? } | { status: 'signedIn'; session; credential } | { status: 'switchingAccount'; previousAccountId }`.
- Produces: controller methods `restore`, `signIn`, `logout`, `switchAccount`.
- Produces: React `useAuthSession()` with `destructiveReauthentication: 'BLOCKED'` for production sessions.

- [ ] **Step 1: Write deterministic controller ordering tests**

Inject `sessionStore`, `authApi`, `google`, and `clearWalletSession`. Record calls and assert:

- restore valid session → signedIn Bearer;
- restore storage error → signedOut with `SECURE_STORAGE_UNAVAILABLE`, no token returned;
- login order is Google signIn → server signIn → SecureStore save;
- logout order is server logout attempt → SecureStore clear → wallet cleanup → Google signOut → signedOut;
- logout still clears local state when server is unreachable;
- switch order completes old logout cleanup before new Google signIn;
- switch success returns a different account ID and never retains old credential;
- switch cancellation leaves signedOut, not the old session silently restored.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `(cd apps/mobile && npx --no-install tsx --test src/auth/auth-controller.test.ts)`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the controller without UI imports**

Use a callback `publish(state)` so Node tests can observe transitions. Clear the store if server login succeeds but SecureStore save fails; the newly issued server session should receive best-effort logout before returning signedOut.

- [ ] **Step 4: Implement provider and signed-out screen**

`AuthSessionProvider` selects behavior as follows:

- auth config available: restore SecureStore then show signed-in routes or a Google login screen;
- auth config unavailable and development DEMO credential available: expose DEMO credential;
- production with missing auth config: show configuration-required, never DEMO.

The signed-out screen must include one “Google로 로그인” button, progress copy, error copy, and `accessibilityLiveRegion="polite"` on changing status.

- [ ] **Step 5: Remove account ID from AppKit runtime config**

`WalletRuntimeConfig` keeps Reown project/API/chain/features but no longer requires `EXPO_PUBLIC_DEMO_ACCOUNT_ID`. Export `createAccountScopedAppKit(config, accountId)` or an equivalent factory used after auth restoration. Key the provider subtree by `accountId`; on switch, finish `forgetWalletSession` before creating the new account-scoped storage prefix.

- [ ] **Step 6: Run provider-adjacent tests and Android export**

Run:

```bash
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
```

Expected: PASS. This proves bundling, not real Google login or native account switching.

- [ ] **Step 7: Commit the auth lifecycle**

```bash
git add apps/mobile/src/auth apps/mobile/src/screens/auth-required \
  apps/mobile/src/app/_layout.tsx apps/mobile/src/wallet/appkit.ts \
  apps/mobile/src/wallet/wallet-runtime-config.ts \
  apps/mobile/src/wallet/wallet-runtime-config.test.ts \
  apps/mobile/src/wallet/forget-wallet-session.ts \
  apps/mobile/src/wallet/forget-wallet-session.test.ts
git commit \
  -m "로그인과 계정 전환이 이전 session을 남기지 않게 한다" \
  -m "Constraint: 계정 전환 전에 서버·SecureStore·Reown 상태를 모두 정리" \
  -m "Rejected: process 고정 DEMO account로 AppKit 생성 | 운영 계정 전환에서 이전 wallet scope를 재사용함" \
  -m "Confidence: medium" \
  -m "Scope-risk: broad" \
  -m "Tested: auth lifecycle unit, mobile typecheck, lint, Android export" \
  -m "Not-tested: real Google Credential Manager account switch"
```

### Task 5: Route customer screens through the active credential and block destructive reauthentication honestly

**Files:**
- Modify: `apps/mobile/src/app/claim.tsx`
- Modify: `apps/mobile/src/app/collection.tsx`
- Modify: `apps/mobile/src/app/recommendations.tsx`
- Modify: `apps/mobile/src/app/settings.tsx`
- Modify: `apps/mobile/src/app/wallet.tsx`
- Modify: `apps/mobile/src/screens/claim-redeem/index.tsx`
- Modify: `apps/mobile/src/screens/collection/index.tsx`
- Modify: `apps/mobile/src/screens/recommendations/index.tsx`
- Modify: `apps/mobile/src/screens/wallet-link/index.tsx`
- Modify: `apps/mobile/src/screens/account-settings/index.tsx`
- Modify: `apps/mobile/src/privacy/account-deletion-api.ts`

**Interfaces:**
- Consumes: `useAuthSession()` and `AccountCredential` from Tasks 2 and 4.
- Produces: each customer route keyed by active `accountId`; settings actions `logout()` and `switchAccount()`.
- Production deletion produces a visible `BLOCKED` state and does not call `/auth/reauthenticate` or `/account-deletion-requests`.

- [ ] **Step 1: Add a pure deletion capability test**

Extract `deletionCapability(credential, destructiveReauthentication)` and test:

```ts
assert.deepEqual(
  deletionCapability({ kind: 'bearer', sessionToken: 'live' }, 'BLOCKED'),
  { allowed: false, reason: 'DESTRUCTIVE_REAUTHENTICATION_BLOCKED' },
);
assert.deepEqual(
  deletionCapability(
    { kind: 'demo', accountId: 'demo', allowInsecureReauthentication: true },
    'BLOCKED',
  ),
  { allowed: true },
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `(cd apps/mobile && npx --no-install tsx --test src/privacy/deletion-capability.test.ts)`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Migrate routes and screens**

Remove direct reads of `demoRuntimeConfig.customerAccountId` from the five customer routes and `_layout` cleanup path. Pass `credential` into screens and clients. Use `session.accountId` only for React keys and account-scoped wallet storage, never for an HTTP header in Bearer mode.

- [ ] **Step 4: Add logout and switch controls**

In account settings, display the opaque account ID only as shortened diagnostic text, add “로그아웃” and “Google 계정 바꾸기” buttons, and announce completion/failure through a polite live region. Disable duplicate taps while switching.

- [ ] **Step 5: Keep destructive account deletion blocked for production**

For Bearer credentials, replace the active destructive button with disabled copy:

> 운영 계정 삭제는 최근 사용자 확인 수단이 확정되지 않아 아직 요청할 수 없습니다. Google 모바일 로그인만으로 fresh auth_time을 보장하지 않으며 서버 검사를 완화하지 않습니다.

Do not invoke `getTokens`, `presentExplicitSignIn`, `/auth/reauthenticate`, or `/account-deletion-requests` in this state. Preserve the existing development DEMO deletion fixture path.

- [ ] **Step 6: Keep the merchant route development-only**

`apps/mobile/src/app/merchant.tsx` continues to require `demoRuntimeConfig.merchant`. Add visible copy that the route is a local staff demo and is unavailable in production. Do not map the signed-in customer account to merchant staff or customer account input.

- [ ] **Step 7: Run route/static regression**

Run:

```bash
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
```

Expected: PASS. Real Google client/device remains NOT_RUN.

- [ ] **Step 8: Commit customer route migration**

```bash
git add apps/mobile/src/app apps/mobile/src/screens apps/mobile/src/privacy \
  apps/mobile/src/commerce apps/mobile/src/recommendation apps/mobile/src/wallet
git commit \
  -m "고객 화면이 서버 Bearer session으로 같은 계정을 보게 한다" \
  -m "Constraint: Google mobile 로그인은 파괴적 재인증의 fresh auth_time을 보장하지 못함" \
  -m "Rejected: iat를 auth_time으로 대체 | 사용자 재확인을 증명하지 못함" \
  -m "Confidence: medium" \
  -m "Scope-risk: broad" \
  -m "Tested: mobile unit, typecheck, lint, Android export" \
  -m "Not-tested: real Google login and production deletion reauthentication"
```

### Task 6: Decouple collection from wallet binding and make NFT polling recoverable

**Files:**
- Create: `apps/mobile/src/commerce/collection-recovery.ts`
- Create: `apps/mobile/src/commerce/collection-recovery.test.ts`
- Modify: `apps/mobile/src/screens/collection/index.tsx:10-125`

**Interfaces:**
- Produces: `resolveCollectionLoad(collectionResult, bindingResult): CollectionLoadState`.
- Produces: `nextPollingState(current, event)` with stop threshold `3` consecutive failures.
- Collection content and wallet action errors are separate fields.

- [ ] **Step 1: Write independent-load and polling state tests**

Cover:

- collection fulfilled + binding rejected → collection visible, `binding: undefined`, wallet retry message;
- collection rejected + binding fulfilled → fatal collection load error;
- one/two poll failures → keep polling and increment;
- third failure → `mode: 'manual-retry'`, preserve last snapshot;
- manual success → `mode: 'polling'`, failure count 0, replace snapshot;
- finalized transition → `mode: 'complete'`, show completion message.

- [ ] **Step 2: Run the focused recovery test and verify RED**

Run: `(cd apps/mobile && npx --no-install tsx --test src/commerce/collection-recovery.test.ts)`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement pure state transitions**

```ts
export const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export type PollingState = {
  mode: 'idle' | 'polling' | 'manual-retry' | 'complete';
  consecutiveFailures: number;
  snapshot: CollectionSnapshot;
};
```

`nextPollingState` must never convert a network failure into `REVIEW_REQUIRED` and must never delete the last snapshot.

- [ ] **Step 4: Replace `Promise.all` and swallowed interval errors**

Initial load and pull-to-refresh use `Promise.allSettled`. Only collection failure blocks the screen. Binding failure renders a wallet-action banner with “지갑 상태 다시 확인”. The timer dispatches failure events; after three, clear the interval and render “NFT 작업 결과를 확인하지 못했습니다. 접수는 취소되지 않았습니다.” with “지금 다시 확인”.

- [ ] **Step 5: Run mobile regression**

Run:

```bash
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
```

Expected: PASS.

- [ ] **Step 6: Commit partial-failure recovery**

```bash
git add apps/mobile/src/commerce/collection-recovery.ts \
  apps/mobile/src/commerce/collection-recovery.test.ts \
  apps/mobile/src/screens/collection/index.tsx
git commit \
  -m "지갑과 polling 장애가 방문 도감을 가리지 않게 한다" \
  -m "Constraint: 마지막 서버 snapshot과 보상권은 network 실패에도 유지" \
  -m "Rejected: polling 오류 무시 | 무한 재시도와 사용자 오판을 만듦" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: collection recovery unit, mobile typecheck, lint"
```

### Task 7: Make claim redemption replay-safe after response loss

**Files:**
- Modify: `apps/api/src/claim-slot-service.ts:8-49`
- Modify: `apps/api/src/postgres/claim-slot-service.ts:33-77,300-553`
- Modify: `apps/api/src/claim-slot.postgres.integration.ts`
- Modify: `apps/api/src/visit-reward.postgres.integration.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/mobile/src/commerce/commerce-api.ts:14-70,239-306`
- Modify: `apps/mobile/src/commerce/commerce-api.test.ts`

**Interfaces:**
- `ClaimSlotPreview` adds `merchantName`, `campaignId`, `campaignTitle`.
- `RedeemedClaimSlot` adds top-level `merchantName`, `campaignTitle`, and `replayed: boolean`.
- New redemption returns `replayed: false`; same account/token recovery returns the same visit/reward IDs with `replayed: true`.

- [ ] **Step 1: Add the PostgreSQL response-loss regression**

Issue a slot, redeem it once, discard that response, then redeem the same token again. Assert:

```ts
assert.equal(first.replayed, false);
assert.equal(recovered.replayed, true);
assert.equal(recovered.claimSlotId, first.claimSlotId);
assert.equal(recovered.visit.visitEventId, first.visit.visitEventId);
assert.deepEqual(recovered.grantedRewards, first.grantedRewards);
```

Query `claim_slots`, `visit_events`, and `reward_entitlements` to require counts `1, 1, 1`. Retry under a different account must remain `CLAIM_TOKEN_UNAVAILABLE`.

- [ ] **Step 2: Add preview/display contract tests**

Require preview and redeem to return the seeded merchant name and campaign title. Update server and mobile parser fixtures so a missing/empty display field is `INVALID_RESPONSE`.

- [ ] **Step 3: Run API PostgreSQL tests and verify RED**

Run:

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/masscom_test' \
  npm run test:postgres --prefix apps/api
```

Expected: FAIL because a second redemption currently throws `CLAIM_TOKEN_UNAVAILABLE` and display/replayed fields are absent.

- [ ] **Step 4: Extend the service result types and active campaign query**

`CampaignRow` becomes `{ id: string; title: string; merchant_name: string }`. `findActiveCampaign` joins `merchants` and selects `campaign.title`, `merchant.name`. Preview uses the same active-campaign conditions at `now()` and returns display names. Do not accept a client-supplied name.

- [ ] **Step 5: Add a read-only replay query**

When the initial `UPDATE ... WHERE status = 'ISSUED'` returns no row, query by `token_hash`, `customer_account_id`, and `status = 'CLAIMED'`, join its `visit_events`, `campaigns`, `merchants`, and source reward entitlements, and reconstruct the existing response with `replayed: true`. This path performs no INSERT/UPDATE and returns no result to another account.

- [ ] **Step 6: Preserve original transaction behavior**

The first redemption remains one transaction and returns `replayed: false`. Campaign unavailable, expired, deleted-account, duplicate-day, and reward-goal behavior keep their existing expectations apart from the added display/replayed fields.

- [ ] **Step 7: Run API/mobile contract tests**

Run:

```bash
npm test --prefix apps/api
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/masscom_test' \
  npm run test:postgres --prefix apps/api
npm run typecheck --prefix apps/api
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
```

Expected: PASS with no second visit/reward effect.

- [ ] **Step 8: Commit idempotent claim recovery**

```bash
git add apps/api/src/claim-slot-service.ts apps/api/src/postgres/claim-slot-service.ts \
  apps/api/src/claim-slot.postgres.integration.ts \
  apps/api/src/visit-reward.postgres.integration.ts apps/api/src/server.test.ts \
  apps/mobile/src/commerce/commerce-api.ts apps/mobile/src/commerce/commerce-api.test.ts
git commit \
  -m "수령 응답 유실이 두 번째 방문 효과를 만들지 않게 한다" \
  -m "Constraint: 같은 account와 token의 이미 확정된 결과만 read-only replay" \
  -m "Rejected: client가 성공을 추측 | token 소비와 응답 유실을 구분할 근거가 없음" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: API unit/PostgreSQL, mobile parser/typecheck"
```

### Task 8: Show merchant/campaign names and close the next-store loop

**Files:**
- Create: `apps/mobile/src/commerce/claim-recovery.ts`
- Create: `apps/mobile/src/commerce/claim-recovery.test.ts`
- Modify: `apps/mobile/src/screens/claim-redeem/index.tsx:16-201`

**Interfaces:**
- Consumes: Task 7 display/replayed response fields.
- Produces: `claimSuccessCopy(redeemed)` and `claimFailureAction(error, preview)` pure helpers.
- Produces: success links to `/collection` and `/recommendations`.

- [ ] **Step 1: Write copy and ambiguous-failure tests**

Require:

- preview label uses `merchantName` and `campaignTitle`, never “점포 ID” as the primary label;
- `replayed: true` copy says the already completed visit was recovered;
- an unknown network failure after redeem keeps token/preview and offers “수령 결과 다시 확인”;
- `CLAIM_TOKEN_UNAVAILABLE` after an ambiguous attempt triggers a collection refresh hint rather than saying the visit definitely failed;
- success has both “내 도감 확인” and “다음 가게 추천” destinations.

- [ ] **Step 2: Run the focused helper test and verify RED**

Run: `(cd apps/mobile && npx --no-install tsx --test src/commerce/claim-recovery.test.ts)`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement display and recovery state**

Keep `pendingRedeemToken` until a definitive success or explicit user reset. On network failure, leave preview visible and change the primary action to retry the same idempotent server operation. On success clear the token and announce merchant/campaign/result through `accessibilityLiveRegion="polite"`.

- [ ] **Step 4: Add the next-store action**

The success card contains two distinct links:

```tsx
<Link href="/collection" asChild>{/* 내 도감 확인 */}</Link>
<Link href="/recommendations" asChild>{/* 다음 가게 추천 */}</Link>
```

Use user-facing names in visible copy. Keep IDs out of the primary status row.

- [ ] **Step 5: Run mobile regression**

Run:

```bash
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
```

Expected: PASS.

- [ ] **Step 6: Commit the recovery UX**

```bash
git add apps/mobile/src/commerce/claim-recovery.ts \
  apps/mobile/src/commerce/claim-recovery.test.ts \
  apps/mobile/src/screens/claim-redeem/index.tsx
git commit \
  -m "방문 결과를 가게 이름과 다음 동선으로 이어 준다" \
  -m "Constraint: 응답 유실 뒤에는 실패를 추측하지 않고 같은 결과를 복구" \
  -m "Rejected: 점포 ID 중심 확인 화면 | 사용자가 방문 대상을 검증하기 어려움" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: claim recovery unit, mobile typecheck, lint, Android export"
```

### Task 9: Full verification, native evidence boundary, and Korean PR

**Files:**
- Modify: `apps/mobile/README.md`
- Modify: `apps/api/README.md`
- Modify: `docs/TEST_STATUS.md`
- Create only after a real device run: `docs/evidence/android-google-auth-recovery.json`

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces: one Korean PR for mobile auth/recovery/UX with automated and native evidence explicitly separated.

- [ ] **Step 1: Document exact setup and blocked reauthentication**

Document Web client audience, Android client package/SHA mapping, Nitro dependency versions, SecureStore record boundary, logout/switch cleanup, and production Bearer header. State plainly that destructive reauthentication remains BLOCKED because mobile Google sign-in does not guarantee fresh `auth_time`; do not describe `getTokens` or explicit sign-in as a completed substitute.

- [ ] **Step 2: Run clean dependency and full automated verification**

Run sequentially:

```bash
rm -rf apps/mobile/node_modules
npm ci --prefix apps/mobile
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
npm test --prefix apps/api
npm run typecheck --prefix apps/api
npm run build --prefix apps/api
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/masscom_test' \
  npm run test:postgres --prefix apps/api
bash scripts/check-privacy.sh
bash tests/bootstrap/check_privacy_test.sh
bash tests/bootstrap/verify_bootstrap_test.sh
```

Expected: PASS. If the test DB is unavailable, record the exact command as BLOCKED rather than substituting unit tests for PostgreSQL evidence.

- [ ] **Step 3: Generate a development native build**

Run:

```bash
(cd apps/mobile && CI=1 APP_VARIANT=development \
  npx --no-install expo prebuild --platform android --clean --no-install)
(cd apps/mobile/android && ./gradlew assembleDebug --console=plain)
```

Expected: native module compilation PASS. This is not a real Google authentication PASS.

- [ ] **Step 4: Run device scenarios only if real OAuth inputs exist**

On a physical Android device, record separate results for first login, cold-start restore, Bearer collection load, logout, account switch, old-account data absence, Reown disconnect/purge, claim response-loss retry, wallet-binding failure with collection visible, and three-failure polling recovery. If Web/Android client configuration is unavailable, keep all real Google cases NOT_RUN and do not create the evidence JSON.

- [ ] **Step 5: Keep required-test statuses honest**

D02 changes only after a real account-switch/device test proves the previous user's API and wallet data are absent. Account deletion operating reauthentication remains BLOCKED/NOT_RUN. Automated fake Google adapter tests do not change either status.

- [ ] **Step 6: Validate Korean PR text**

```bash
PR_TITLE='모바일 운영 로그인과 응답 유실 복구를 연결한다'
PR_BODY='Google ID token을 서버 Bearer session과 SecureStore에 연결하고 로그아웃·계정 전환·도감 부분 실패·수령 replay·NFT polling 복구를 구현했습니다. fresh auth_time을 보장할 수 없는 파괴적 재인증과 실제 OAuth 기기 검증은 BLOCKED 또는 NOT_RUN으로 유지합니다.'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
```

Expected: `PR 한국어 작성 규칙 확인 완료`.

- [ ] **Step 7: Request independent auth/state-race review**

Reviewer focus: token persistence, header exclusivity, logout/switch ordering, AppKit account scope, destructive reauth truth boundary, redeem replay authorization, and polling state races. Resolve every HIGH/CRITICAL finding and rerun affected automated and native checks before merge.
