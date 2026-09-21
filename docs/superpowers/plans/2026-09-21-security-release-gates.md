# Security and Release Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** W08, credential-safe logging, production environment validation, and AAB provenance become deterministic release gates without claiming Play readiness.

**Architecture:** Keep each verdict at its owning boundary: W08 inspects a fully materialized DEX string corpus, API logging accepts only allowlisted metadata, Expo config rejects production-only configuration violations before prebuild, and an AAB assessor records signature/W08/provenance separately from manual release readiness. Existing signature exit codes remain stable so callers do not silently reinterpret failures.

**Tech Stack:** Bash 3.2-compatible shell, Node.js 24 ESM, TypeScript 6, Expo SDK 57 app config, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-21-audit-remediation-design.md`

## Global Constraints

- Issue #118 scope only; do not add wallet purchase, transfer, swap, on-ramp, embedded wallet, or new signing methods.
- Do not create, replace, read, or print Android keystores, passwords, private keys, or recovery phrases.
- `verify-aab-signature.sh` proves only artifact integrity and approved public certificate fingerprint; it must not claim device, App Links, Play upload, or review readiness.
- `APP_VARIANT=production` must reject loopback API URLs and every non-empty `EXPO_PUBLIC_DEMO_*` identity/reauthentication setting.
- Development loopback DEMO and existing signature exit codes `0, 3, 4, 5, 6, 7` remain compatible.
- No dependency additions are required for this plan.
- Base mainnet, Play submission, paid hosting, public repository conversion, and new operations keys remain out of scope.

## Review Focus

- A forbidden DEX string followed by more than one pipe buffer of data must fail W08 instead of becoming exit 141 and a false PASS; Task 1 owns the regression.
- A malformed wallet signature copied into an Error message/stack/cause must never appear in captured logs; Task 2 owns the regression.
- Production with HTTPS plus one stray DEMO variable must fail just as production loopback does; Task 3 owns both cases.
- A correctly signed fixture must record `signature.status: "PASS"` while `releaseReadiness.status: "NOT_RUN"`; Task 4 owns this non-conflation test.
- A rejected signature must still leave an artifact with an unambiguous rejected name and a provenance record explaining the signature exit code; Task 5 owns this build-flow test.

---

### Task 1: Make W08 immune to SIGPIPE false PASS

**Files:**
- Modify: `scripts/check-release-wallet-surface.sh:17-31`
- Modify: `tests/release/check_release_wallet_surface_test.sh:11-89`

**Interfaces:**
- Consumes: `<app-release.aab>` and optional mobile source directory, exactly as the current script does.
- Produces: unchanged success line and failure prefix; new internal `dex_strings` file containing complete `strings` output from every `base/dex/*.dex` member.

- [ ] **Step 1: Add the failing oversized DEX regression**

Extend `make_aab` with a fixture whose first DEX bytes contain `Lcom/android/billingclient/api/BillingClient;` and whose remaining bytes exceed 1 MiB. The test must call the real checker and require the existing payment-SDK failure text.

```bash
make_large_forbidden_aab() {
  local dir="$work/large-forbidden.d"
  mkdir -p "$dir/base/manifest" "$dir/base/dex"
  printf '%s\n' "$good_manifest" >"$dir/base/manifest/AndroidManifest.xml"
  {
    printf '%s\n' 'Lcom/android/billingclient/api/BillingClient;'
    dd if=/dev/zero bs=1048576 count=2 2>/dev/null | tr '\0' 'A'
  } >"$dir/base/dex/classes.dex"
  (cd "$dir" && zip -q -r "$work/large-forbidden.aab" base)
}

make_large_forbidden_aab
expect_fail \
  'large DEX payment class after pipefail' \
  'payment or embedded-wallet SDK class' \
  "$work/large-forbidden.aab" \
  "$good_src"
```

- [ ] **Step 2: Run the regression and verify RED**

Run: `bash tests/release/check_release_wallet_surface_test.sh`

Expected: FAIL at `large DEX payment class after pipefail` because the existing `cat | strings | grep -m1` pipeline returns a SIGPIPE-derived non-zero status and the forbidden class is missed.

- [ ] **Step 3: Materialize all DEX strings before matching**

Replace the pipeline at lines 29-32 with a loop that finishes every `strings` producer before `grep` runs.

```bash
dex_strings="$work/dex-strings.txt"
: >"$dex_strings"
for dex in "$work"/base/dex/*.dex; do
  strings "$dex" >>"$dex_strings" || fail "could not inspect DEX strings: $(basename "$dex")"
done

if hit="$(grep -iE -m1 \
  'com/android/billingclient|com/coinbase|com/stripe|com/moonpay|com/transak|io/meld|com/web3auth|io/privy|link/magic' \
  "$dex_strings")"; then
  fail "dex contains a payment or embedded-wallet SDK class: $hit"
fi
```

Do not replace this with any producer piped into `grep -m1`, `head`, or another early-exit consumer.

- [ ] **Step 4: Run W08 positive and negative fixtures**

Run: `bash tests/release/check_release_wallet_surface_test.sh`

Expected: PASS, including clean AAB, billing permission, development package, payment class, oversized payment class, feature flag, AppKit view/controller/button, and signing-method mutations.

- [ ] **Step 5: Commit the independent W08 fix**

```bash
git add scripts/check-release-wallet-surface.sh tests/release/check_release_wallet_surface_test.sh
git commit \
  -m "W08가 SIGPIPE로 금지 SDK를 놓치지 않게 한다" \
  -m "Constraint: Bash pipefail 아래 조기 종료 consumer가 검사 결과를 뒤집으면 안 됨" \
  -m "Rejected: grep -m1 pipeline 유지 | 대형 DEX에서 producer SIGPIPE가 재현됨" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: bash tests/release/check_release_wallet_surface_test.sh"
```

### Task 2: Restrict API error logging to non-secret metadata

**Files:**
- Create: `apps/api/src/security-log.ts`
- Create: `apps/api/src/security-log.test.ts`
- Modify: `apps/api/src/server.ts:425-469`
- Modify: `apps/api/src/wallet-challenge-service.ts:280-288`
- Modify: `scripts/check-privacy.sh:8-19`
- Modify: `tests/bootstrap/check_privacy_test.sh:17-38`
- Modify: `apps/api/src/server.test.ts:1100-1185`

**Interfaces:**
- Consumes: `safeErrorMetadata(event: string, error: unknown, allowedCodes?: ReadonlySet<string>)`.
- Produces: `{ event: string; errorName: string; errorCode?: string }`; never produces `message`, `stack`, `cause`, request values, token, address, message, or signature.

- [ ] **Step 1: Write unit tests for hostile Error objects**

Create `security-log.test.ts` with an Error whose message, stack, cause, and custom fields contain a sentinel signature. Require exact output and absence of the sentinel after JSON serialization.

```ts
test('returns only allowlisted error metadata', () => {
  const signature = `0x${'ab'.repeat(65)}`;
  const error = Object.assign(new Error(`invalid signature ${signature}`), {
    code: 'SIGNER_MISMATCH',
    cause: new Error(signature),
    signature,
  });

  const metadata = safeErrorMetadata(
    'wallet.verify.failed',
    error,
    new Set(['SIGNER_MISMATCH']),
  );

  assert.deepEqual(metadata, {
    event: 'wallet.verify.failed',
    errorName: 'Error',
    errorCode: 'SIGNER_MISMATCH',
  });
  assert.equal(JSON.stringify(metadata).includes(signature), false);
});
```

Also test that an unallowlisted string `code` and a thrown non-Error do not add fields beyond `event` and `errorName`.

- [ ] **Step 2: Run the new unit test and verify RED**

Run: `(cd apps/api && npx --no-install tsx --test src/security-log.test.ts)`

Expected: FAIL with module-not-found for `./security-log.js`.

- [ ] **Step 3: Implement the closed metadata shape**

```ts
export type SafeErrorMetadata = {
  event: string;
  errorName: string;
  errorCode?: string;
};

export function safeErrorMetadata(
  event: string,
  error: unknown,
  allowedCodes: ReadonlySet<string> = new Set(),
): SafeErrorMetadata {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const candidate =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof candidate === 'string' && allowedCodes.has(candidate)
    ? { event, errorName, errorCode: candidate }
    : { event, errorName };
}
```

Use this helper in `server.ts` and the wallet challenge release fallback. Do not pass an Error object as a second logger argument.

- [ ] **Step 4: Make the privacy scanner reject unsafe error projections**

Add fixtures for all of these forms and require scanner failure for each one:

```ts
console.error('request failed', error)
console.error('request failed', { message: error.message })
console.error('request failed', { stack: error.stack })
console.error('request failed', { cause: error.cause })
console.error('request failed', { signature: body.signature })
```

Update `check-privacy.sh` patterns without banning `safeErrorMetadata(...)` or fixed non-secret event strings.

- [ ] **Step 5: Add an HTTP malformed-signature log assertion**

In `server.test.ts`, temporarily replace `console.error`, submit a sentinel invalid signature to `/wallet/verify`, and serialize all captured logger arguments. Require a 401/400 mapped wallet error and `captured.includes(signature) === false`. Restore `console.error` in `t.after` even if the assertion fails.

- [ ] **Step 6: Run API and privacy gates**

Run:

```bash
npm test --prefix apps/api
npm run typecheck --prefix apps/api
bash scripts/check-privacy.sh
bash tests/bootstrap/check_privacy_test.sh
```

Expected: all PASS; the scanner's intentionally unsafe fixtures fail internally and the wrapper test exits 0.

- [ ] **Step 7: Commit the log boundary**

```bash
git add apps/api/src/security-log.ts apps/api/src/security-log.test.ts \
  apps/api/src/server.ts apps/api/src/server.test.ts \
  apps/api/src/wallet-challenge-service.ts \
  scripts/check-privacy.sh tests/bootstrap/check_privacy_test.sh
git commit \
  -m "서명과 인증값이 오류 로그로 새지 않게 한다" \
  -m "Constraint: 운영 로그는 고정 event와 allowlist 오류 분류만 포함" \
  -m "Rejected: Error message 정규식 마스킹 | 새 SDK 오류 형태와 stack/cause를 완전하게 열거할 수 없음" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: API unit, typecheck, privacy scanner regression"
```

### Task 3: Reject DEMO and loopback inputs in production mobile config

**Files:**
- Create: `apps/mobile/src/config/build-environment.ts`
- Create: `apps/mobile/src/config/build-environment.test.ts`
- Modify: `apps/mobile/app.config.ts:3-25`
- Modify: `apps/mobile/.env.example:1-6`

**Interfaces:**
- Consumes: `validateBuildEnvironment(variant: string | undefined, environment: MobileBuildEnvironment): void`.
- Produces: no return on valid input; throws a fixed error naming the unsafe key/category on invalid production input.

- [ ] **Step 1: Write production/development boundary tests**

Cover this table in `build-environment.test.ts`:

| Variant | API URL | DEMO setting | Result |
| --- | --- | --- | --- |
| production | `https://api.example.test` | none | PASS |
| production | `http://127.0.0.1:3000` | none | throw `production API must use non-loopback HTTPS` |
| production | `https://api.example.test` | `EXPO_PUBLIC_DEMO_ACCOUNT_ID=customer-1` | throw naming that key |
| production | `https://api.example.test` | `EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION=true` | throw naming that key |
| development | `http://127.0.0.1:3000` | DEMO customer/staff IDs | PASS |

- [ ] **Step 2: Run the focused config test and verify RED**

Run: `npm test --prefix apps/mobile -- --test-name-pattern='production build environment'`

Expected: FAIL with module-not-found for `./build-environment`.

- [ ] **Step 3: Implement the production assertion**

```ts
export type MobileBuildEnvironment = Partial<Record<
  | 'EXPO_PUBLIC_API_URL'
  | 'EXPO_PUBLIC_DEMO_ACCOUNT_ID'
  | 'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID'
  | 'EXPO_PUBLIC_DEMO_MERCHANT_ID'
  | 'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
  string
>>;

const demoKeys = [
  'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ID',
  'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
] as const;

export function validateBuildEnvironment(
  variant: string | undefined,
  environment: MobileBuildEnvironment,
): void {
  if (variant !== 'production') return;
  const rawApiUrl = environment.EXPO_PUBLIC_API_URL?.trim();
  if (!rawApiUrl) throw new Error('production EXPO_PUBLIC_API_URL is required');
  const apiUrl = new URL(rawApiUrl);
  if (apiUrl.protocol !== 'https:' || ['localhost', '127.0.0.1', '10.0.2.2'].includes(apiUrl.hostname)) {
    throw new Error('production API must use non-loopback HTTPS');
  }
  const unsafeKey = demoKeys.find((key) => environment[key]?.trim());
  if (unsafeKey) throw new Error(`production build rejects ${unsafeKey}`);
}
```

- [ ] **Step 4: Call the assertion before returning Expo config**

At the start of `app.config.ts`'s exported callback, pass `process.env.APP_VARIANT` and all five relevant variables. Keep package/scheme and blocked permission behavior unchanged. Update `.env.example` comments to say DEMO variables are development-only and must be unset, not merely false, for production.

- [ ] **Step 5: Run config and mobile regression**

Run:

```bash
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
```

Expected: PASS. Do not run a production prebuild with the checked-in DEMO example exported.

- [ ] **Step 6: Commit the fail-closed production config**

```bash
git add apps/mobile/app.config.ts apps/mobile/.env.example \
  apps/mobile/src/config/build-environment.ts \
  apps/mobile/src/config/build-environment.test.ts
git commit \
  -m "운영 앱이 DEMO 계정과 loopback API를 품지 않게 한다" \
  -m "Constraint: development loopback DEMO는 기기 검증을 위해 유지" \
  -m "Rejected: 런타임 경고만 표시 | 잘못된 값이 이미 AAB에 포함됨" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: mobile unit, typecheck, lint"
```

### Task 4: Separate signature verdict from release readiness and write provenance

**Files:**
- Create: `scripts/write-aab-provenance.mjs`
- Create: `scripts/assess-release-aab.sh`
- Create: `tests/release/assess_release_aab_test.sh`
- Modify: `scripts/verify-aab-signature.sh:1-78`
- Modify: `tests/release/verify_aab_signature_test.sh:24-80`
- Modify: `.github/workflows/ci.yml:35-65`

**Interfaces:**
- Consumes: `scripts/assess-release-aab.sh <file.aab> [mobile-src-dir] [provenance.json]`.
- Produces: provenance schema `masscom.aab-provenance.v1` and exits non-zero if an automated gate fails.
- Produces JSON fields: `artifact`, `source`, `android`, `signature`, `walletSurface`, `releaseReadiness`, `generatedAt`.

- [ ] **Step 1: Write the assessor regression with stub gate executables**

The test creates a tiny AAB plus stub signature/W08 commands so it does not need a real Android build. For a successful automated assessment require:

```json
{
  "schema": "masscom.aab-provenance.v1",
  "signature": { "status": "PASS", "exitCode": 0 },
  "walletSurface": { "status": "PASS", "exitCode": 0 },
  "releaseReadiness": {
    "status": "NOT_RUN",
    "pending": ["A02_DEVICE_INSTALL", "APP_LINKS", "PLAY_UPLOAD_AND_REVIEW"]
  }
}
```

Also assert artifact SHA-256, byte size, basename, exact `git rev-parse HEAD`, and `source.mobileDirty` boolean.

- [ ] **Step 2: Run the assessor regression and verify RED**

Run: `bash tests/release/assess_release_aab_test.sh`

Expected: FAIL because `scripts/assess-release-aab.sh` does not exist.

- [ ] **Step 3: Implement the Node provenance writer**

Parse explicit CLI arguments rather than secrets from the environment. Normalize statuses to `PASS | FAIL | BLOCKED | NOT_RUN`. Reject missing artifact, malformed 64-hex digest, unknown status, and an attempt to set release readiness to PASS while any pending gate remains.

```js
if (record.releaseReadiness.status === 'PASS' && record.releaseReadiness.pending.length > 0) {
  throw new Error('release readiness cannot pass with pending gates');
}
writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
```

The writer must not record environment values, command lines, keystore paths, or passwords.

- [ ] **Step 4: Implement the assessor orchestration**

`assess-release-aab.sh` must:

1. resolve artifact and repo paths;
2. calculate SHA-256 and bytes;
3. capture source commit and whether `apps/mobile` differs from HEAD;
4. run `verify-aab-signature.sh` and `check-release-wallet-surface.sh` separately, retaining both exit codes;
5. extract only the public certificate fingerprint from verifier output;
6. invoke the writer with `releaseReadiness=NOT_RUN` and the three pending manual gates;
7. print the provenance path;
8. return the first automated non-zero gate code after the JSON exists.

Support test-only command overrides `AAB_SIGNATURE_CHECK_COMMAND` and `AAB_WALLET_SURFACE_CHECK_COMMAND`; reject overrides unless `MASSCOM_TEST_MODE=true` so production callers cannot silently replace gates.

- [ ] **Step 5: Make signer wording describe signature only**

Change `NOT UPLOADABLE:` to `SIGNATURE REJECTED:` and keep the final success line `signature verified against the approved upload certificate`. Update the signature regression's expected text in the same step. Keep exit codes and public fingerprint output unchanged.

- [ ] **Step 6: Add the assessor regression to CI**

After the existing signature verdict fixture, add:

```yaml
- name: Verify AAB assessment provenance
  run: bash tests/release/assess_release_aab_test.sh
```

- [ ] **Step 7: Run focused release tests**

Run:

```bash
bash tests/release/check_release_wallet_surface_test.sh
bash tests/release/verify_aab_signature_test.sh
bash tests/release/assess_release_aab_test.sh
```

Expected: all three PASS, with signature exit-code assertions unchanged.

- [ ] **Step 8: Commit provenance infrastructure**

```bash
git add scripts/write-aab-provenance.mjs scripts/assess-release-aab.sh \
  scripts/verify-aab-signature.sh tests/release/verify_aab_signature_test.sh \
  tests/release/assess_release_aab_test.sh \
  .github/workflows/ci.yml
git commit \
  -m "AAB 서명과 출시 준비 판단을 분리한다" \
  -m "Constraint: 자동 서명 PASS는 A02·App Links·Play 검증을 대신하지 않음" \
  -m "Rejected: verify-aab-signature에서 release-ready 출력 | 서로 다른 증거 단계를 합치게 됨" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: W08, signature fixture, provenance fixture"
```

### Task 5: Integrate provenance into the release build without losing rejected artifacts

**Files:**
- Modify: `scripts/build-release-aab.sh:1-64`
- Modify: `tests/release/verify_aab_signature_test.sh:24-114`
- Modify: `apps/mobile/README.md`
- Modify: `docs/RELEASE_READINESS.md`

**Interfaces:**
- Consumes: the Task 4 assessor and existing `RELEASE_ARTIFACT_DIR` override.
- Produces: `app-release-<short-sha>.aab` plus `app-release-<short-sha>.provenance.json`; rejected artifact/provenance basenames include `.NOT-RELEASE-READY-exitN`.

- [ ] **Step 1: Extend the build-flow test for paired artifacts**

In the sandbox test, copy the assessor and writer. Stub W08 to succeed. Assert:

- successful build leaves both AAB and JSON outside `android/`;
- JSON artifact digest matches the copied AAB;
- `signature.status` is PASS and `releaseReadiness.status` is NOT_RUN;
- missing certificate pin returns 7 and leaves both files renamed with `.NOT-RELEASE-READY-exit7`;
- `--restore-dev` still regenerates development variant after both paths.

- [ ] **Step 2: Run the signature/build test and verify RED**

Run: `bash tests/release/verify_aab_signature_test.sh`

Expected: FAIL because the build script does not create provenance and still uses `.NOT-UPLOADABLE-exit7`.

- [ ] **Step 3: Replace direct signer invocation with the assessor**

After copying the AAB, set `provenance="${aab%.aab}.provenance.json"`, invoke the assessor, and capture its exit code. On failure rename both outputs before exiting. Keep restoration in the existing EXIT trap.

```bash
assessment=0
"$repo_root/scripts/assess-release-aab.sh" "$aab" "$mobile_dir/src" "$provenance" || assessment=$?
if [[ "$assessment" != "0" ]]; then
  rejected_base="${aab%.aab}.NOT-RELEASE-READY-exit$assessment"
  mv "$aab" "$rejected_base.aab"
  mv "$provenance" "$rejected_base.provenance.json"
  echo "AAB retained for diagnosis: $rejected_base.aab" >&2
  echo "Provenance: $rejected_base.provenance.json" >&2
  exit "$assessment"
fi
```

The success path must print `Automated gates: PASS` and `Release readiness: NOT_RUN`, never `UPLOADABLE` or `READY`.

- [ ] **Step 4: Correct operator-facing documentation**

Document the paired artifact, public provenance contents, rejection naming, and the distinction among build success, signature PASS, automated gate PASS, A02 install/App Links, Play upload, and Play review. State that provenance must not be committed if it reveals a private local filesystem path; the schema stores basenames only.

- [ ] **Step 5: Run all security/release gates**

Run:

```bash
bash tests/release/check_release_wallet_surface_test.sh
bash tests/release/verify_aab_signature_test.sh
bash tests/release/assess_release_aab_test.sh
bash scripts/check-privacy.sh
bash tests/bootstrap/check_privacy_test.sh
npm test --prefix apps/api
npm run typecheck --prefix apps/api
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
bash tests/bootstrap/verify_bootstrap_test.sh
```

Expected: all PASS. A real upload-key AAB, device installation, App Links, and Play operations remain NOT_RUN.

- [ ] **Step 6: Commit build integration and documentation**

```bash
git add scripts/build-release-aab.sh tests/release/verify_aab_signature_test.sh \
  apps/mobile/README.md docs/RELEASE_READINESS.md
git commit \
  -m "출시 AAB가 입력과 미실행 gate를 함께 증명하게 한다" \
  -m "Constraint: keystore 경로와 비밀번호는 provenance에 기록하지 않음" \
  -m "Rejected: 서명 PASS를 upload 가능으로 표기 | 기기·App Links·Play 증거가 없음" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: release shell regressions, API/mobile static gates, bootstrap"
```

### Task 6: Final review and PR gate

**Files:**
- Modify only if evidence requires correction: `docs/TEST_STATUS.md`
- Modify only if a new non-secret automated artifact is intentionally tracked: `docs/evidence/release-wallet-surface.json`

**Interfaces:**
- Consumes: commits from Tasks 1-5.
- Produces: one Korean PR for the security/release gate bundle; W08 may stay PASS only if its strengthened test passes, while A02 stays NOT_RUN.

- [ ] **Step 1: Inspect the complete diff for scope and secrets**

Run:

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- \
  scripts apps/api/src apps/mobile/src apps/mobile/app.config.ts apps/mobile/.env.example \
  apps/mobile/plugins tests .github/workflows/ci.yml apps/mobile/README.md \
  docs/RELEASE_READINESS.md docs/TEST_STATUS.md
bash scripts/check-secrets.sh
bash scripts/check-privacy.sh
```

Expected: no application feature outside the four audit gates, no generated AAB, no keystore path/password, no production URL or credential.

- [ ] **Step 2: Run the branch verification set once more**

Run the exact Task 5 Step 5 block. Expected: all PASS with no skipped fixture.

- [ ] **Step 3: Validate the Korean PR text with the actual checker**

```bash
PR_TITLE='보안 검사와 AAB 출시 근거를 신뢰할 수 있게 한다'
PR_BODY='W08 SIGPIPE 거짓 통과를 막고 서명 원문 비노출 로그, 운영 DEMO 차단, AAB provenance 분리를 구현했습니다. 자동 gate는 통과했지만 실제 upload-key AAB 설치와 App Links 및 Play 제출은 NOT_RUN으로 유지합니다.'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
```

Expected: `PR 한국어 작성 규칙 확인 완료`.

- [ ] **Step 4: Request independent security/release review before merge**

Reviewer focus: shell exit semantics, logger field closure, production config fail-closed behavior, provenance truth boundary, and preservation of A02 NOT_RUN. Resolve every HIGH/CRITICAL finding and rerun affected tests before PR merge.

- [ ] **Step 5: Record final evidence without upgrading external acceptance**

If `docs/TEST_STATUS.md` changes, add only the new commands/commit/environment to the W08 execution history. Do not change A02, App Links, upload-key install, or Play statuses without those exact external runs.
