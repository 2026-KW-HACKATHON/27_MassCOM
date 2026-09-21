# Documentation, Design, and Evidence Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile dark-mode/TalkBack behavior and repository, portal, presentation, and evidence claims agree with the merged code and executable truth sources.

**Architecture:** Mobile semantic tokens and accessibility status helpers are tested independently of React Native rendering. A repository consistency verifier derives test totals and scene counts from canonical files, then documentation and screenshots are updated only after the security and mobile PRs merge so SHA, commands, dates, and acceptance boundaries remain current.

**Tech Stack:** React Native semantic styles, TypeScript 6, Bash, Node.js 24, static HTML/CSS, existing site accessibility checker, browser screenshots, visual-verdict workflow

**Spec:** `docs/superpowers/specs/2026-09-21-audit-remediation-design.md`

## Global Constraints

- Execute this plan after the security-release and mobile-auth-recovery PRs merge; use their actual merge SHAs and CI results.
- Do not invent partner stores, participants, revenue, public hosting, Google device results, upload-key installation, App Links, or Play approval.
- Keep the 36 v3 test IDs and numbering unchanged; derive totals from `tests/catalog/required-tests.tsv` and cross-check `docs/TEST_STATUS.md`.
- Actual PR content validation is `bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"`; `tests/bootstrap/check_pr_korean_test.sh` only tests the checker.
- Clone/setup instructions must initialize `contracts/lib/forge-std` and `contracts/lib/openzeppelin-contracts` submodules.
- API and Worker commands must state whether they run from repository root with `--prefix` or from the app directory.
- Native TalkBack, projector rehearsal, production OAuth, AAB install, App Links, and Play submission remain separate manual evidence classes.
- Use the visual-verdict workflow after every portal/presentation screenshot iteration and retain the final verdict JSON.

## Review Focus

- Dark mode must not leave hard-coded light status containers or Reown `themeMode: 'light'`; Task 1 owns the token tests.
- TalkBack must announce loading/success/error changes without reading internal IDs as the primary message; Task 2 owns the semantics check.
- A contributor following README from a fresh clone must receive both submodules and run the actual PR checker correctly; Task 3 owns the fixture.
- Worker docs must describe both Local Anvil unlocked accounts and Base Sepolia encrypted keystore signer, while HANDOFF must not say the entrypoint is local-only; Task 4 owns the drift check.
- Presentation scene copy/nav count, required-test totals, evidence date, and baseline SHA must be mechanically consistent; Tasks 5 and 6 own the verifier and refreshed artifacts.

---

### Task 1: Convert mobile colors to explicit light/dark semantic tokens

**Files:**
- Modify: `apps/mobile/src/theme/colors.ts`
- Create: `apps/mobile/src/theme/colors.test.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Modify: `apps/mobile/src/wallet/appkit.ts`
- Modify: all files under `apps/mobile/src/screens/` that import `colors`

**Interfaces:**
- Produces: `lightColors`, `darkColors`, `colorsForScheme(scheme)`, and `createStyles(colors)` per screen.

- [ ] **Step 1: Write semantic token tests**

Require both schemes to define label/background/surface, primary/container, success/container, and error/container foreground pairs. Calculate WCAG contrast and require 4.5:1 for body/status text. Assert light and dark background/surface values differ.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `(cd apps/mobile && npx --no-install tsx --test src/theme/colors.test.ts)`

Expected: FAIL because explicit light/dark palettes do not exist.

- [ ] **Step 3: Implement palettes and scheme selection**

Use opaque color strings in pure palettes so Node tests can measure them. `colorsForScheme(null)` returns light. Screens call `useColorScheme()` and memoize `createStyles(colorsForScheme(scheme))`. Replace `#EAF5FB`, `#FCE4DA`, and other light-only status fills with semantic tokens; retain black only for the camera surface.

- [ ] **Step 4: Synchronize navigation and Reown theme**

Set Stack header/content colors from the active palette. Expose `setWalletThemeMode('light' | 'dark')` from the account-scoped AppKit wrapper and update it with the system scheme. Do not leave a fixed `themeMode: 'light'` initializer.

- [ ] **Step 5: Verify and commit**

Run `npm test --prefix apps/mobile && npm run typecheck --prefix apps/mobile && npm run lint --prefix apps/mobile && npm run export:android --prefix apps/mobile` and expect PASS.

```bash
git add apps/mobile/src/theme apps/mobile/src/app/_layout.tsx apps/mobile/src/wallet/appkit.ts apps/mobile/src/screens
git commit -m "밝은 화면과 어두운 화면이 같은 의미 색상을 쓰게 한다" \
  -m "Constraint: 상태 의미와 4.5:1 본문 대비를 두 scheme에서 유지" \
  -m "Rejected: 화면별 hard-coded dark override | 상태 색상과 Reown modal이 다시 분기됨" \
  -m "Confidence: medium" -m "Scope-risk: broad" \
  -m "Tested: palette contrast unit, mobile typecheck, lint, Android export" \
  -m "Not-tested: physical OLED dark-mode visual acceptance"
```

### Task 2: Add TalkBack status announcements and user-facing copy contracts

**Files:**
- Create: `apps/mobile/src/accessibility/status-copy.ts`
- Create: `apps/mobile/src/accessibility/status-copy.test.ts`
- Modify: dynamic status screens under `apps/mobile/src/screens/`
- Create: `tests/mobile/check_accessibility_semantics_test.sh`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `statusAnnouncement(kind, context): string` using user terms only.
- Dynamic status containers use `accessibilityLiveRegion="polite"`; terminal errors may use `role="alert"`.

- [ ] **Step 1: Write copy and semantics RED tests**

Cover login restore/failure, claim preview/replay, collection binding outage, polling paused/recovered, wallet verified/disconnected, logout/account switch, and blocked destructive reauthentication. Assert copy omits raw merchant/campaign/binding/job IDs and server error codes. The shell fixture removes one live region and must make its checker fail.

- [ ] **Step 2: Run RED**

Run `(cd apps/mobile && npx --no-install tsx --test src/accessibility/status-copy.test.ts)` and `bash tests/mobile/check_accessibility_semantics_test.sh`.

Expected: both fail because helper/checker contracts are absent.

- [ ] **Step 3: Implement announcements and labels**

Render one live status node per screen. Use “음식점”, “캠페인”, “방문 수령”, “앱 수집품”, “외부 지갑 주소 확인”, and “NFT 등록”. Give QR/camera/icon actions an accessibility role, label, and hint.

- [ ] **Step 4: Verify and commit**

Run `bash tests/mobile/check_accessibility_semantics_test.sh && npm test --prefix apps/mobile && npm run typecheck --prefix apps/mobile && npm run lint --prefix apps/mobile` and expect PASS.

```bash
git add apps/mobile/src/accessibility apps/mobile/src/screens tests/mobile/check_accessibility_semantics_test.sh .github/workflows/ci.yml
git commit -m "상태 변화와 사용자 용어를 TalkBack에 같은 의미로 전한다" \
  -m "Constraint: 자동 semantics 검사는 native TalkBack 실기를 대신하지 않음" \
  -m "Rejected: 내부 ID와 오류 code 직접 낭독 | 사용자가 다음 행동을 알 수 없음" \
  -m "Confidence: medium" -m "Scope-risk: moderate" \
  -m "Tested: status copy unit, semantics static gate, mobile typecheck, lint" \
  -m "Not-tested: physical TalkBack gesture traversal"
```

### Task 3: Lock fresh-clone, submodule, and Korean PR instructions

**Files:**
- Modify: `README.md:113-125,215-217`
- Modify: `AGENTS.md:31-50`
- Modify: `docs/HANDOFF.md:141-179`
- Modify: `scripts/verify-bootstrap.sh`
- Modify: `tests/bootstrap/verify_bootstrap_test.sh`

**Interfaces:**
- README provides fresh-clone and existing-clone submodule paths.
- Contributor docs distinguish actual PR validation from the checker regression test.

- [ ] **Step 1: Add failing documentation fixtures**

Mutate copied docs to remove each required command and require verifier failure:

```bash
git clone --recurse-submodules https://github.com/2026-KW-HACKATHON/27_MassCOM.git
git submodule update --init --recursive
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
```

Also reject wording that presents `tests/bootstrap/check_pr_korean_test.sh` as validation of a real PR.

- [ ] **Step 2: Run RED**

Run `bash tests/bootstrap/verify_bootstrap_test.sh`.

Expected: FAIL because current clone omits `--recurse-submodules` and AGENTS names the fixture test as the PR gate.

- [ ] **Step 3: Correct docs and verify**

README includes both clone paths. AGENTS requires the actual checker. HANDOFF shows actual `PR_TITLE`/`PR_BODY` variables and labels the fixture test correctly. Run bootstrap, checker regression, and secret scan; expect PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md docs/HANDOFF.md scripts/verify-bootstrap.sh tests/bootstrap/verify_bootstrap_test.sh
git commit -m "새 clone과 실제 PR 검사가 문서 그대로 동작하게 한다" \
  -m "Constraint: Foundry 의존성은 Git submodule 두 개로 공급" \
  -m "Rejected: checker 회귀 시험을 실제 PR 검사로 안내 | 실제 제목과 본문을 검사하지 않음" \
  -m "Confidence: high" -m "Scope-risk: narrow" \
  -m "Tested: bootstrap, Korean checker regression, secret scan"
```

### Task 4: Reconcile API, Worker, mobile, and HANDOFF operational instructions

**Files:**
- Modify: `apps/api/README.md`
- Modify: `apps/worker/README.md`
- Modify: `apps/mobile/README.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/PROJECT_STATE.md`
- Create: `scripts/verify-operations-docs.mjs`
- Create: `tests/bootstrap/verify_operations_docs_test.sh`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a verifier for package scripts, auth modes, signer modes, environment names, and root/app-directory command forms.

- [ ] **Step 1: Write operations-doc RED fixtures**

Require failure when API says account POSTs always use `x-account-id`, Worker says `start:once` is Local Anvil-only, Worker PostgreSQL instructions omit API migration behavior, HANDOFF names a merged PR as open, or mobile README claims destructive Google reauthentication complete.

- [ ] **Step 2: Run RED**

Run `bash tests/bootstrap/verify_operations_docs_test.sh`.

Expected: FAIL because the verifier is absent.

- [ ] **Step 3: Implement verifier and correct copy**

Read the three package JSON files plus docs. API must describe production Bearer and loopback DEMO. Worker must describe both `CHAIN_ID=31337 + ALLOW_UNLOCKED_LOCAL_MINTER=true` and `CHAIN_ID=84532 + MINTER_KEYSTORE_PATH + MINTER_KEYSTORE_PASSWORD_FILE`, with Base Sepolia still NOT_RUN. Commands state their working directory or use `--prefix`. HANDOFF uses actual branch/SHA/PR/CI facts after predecessor merges.

- [ ] **Step 4: Verify and commit**

Run operations docs, bootstrap, and all three package typechecks; expect PASS.

```bash
git add apps/api/README.md apps/worker/README.md apps/mobile/README.md docs/HANDOFF.md docs/PROJECT_STATE.md \
  scripts/verify-operations-docs.mjs tests/bootstrap/verify_operations_docs_test.sh .github/workflows/ci.yml
git commit -m "API와 Worker 운영 지침을 실제 실행 경계에 맞춘다" \
  -m "Constraint: 실행하지 않은 Google·Base Sepolia·Play 검증은 상태를 올리지 않음" \
  -m "Rejected: HANDOFF 수동 갱신만 의존 | merge 뒤 같은 drift가 반복됨" \
  -m "Confidence: high" -m "Scope-risk: moderate" \
  -m "Tested: operations docs, bootstrap, package typechecks"
```

### Task 5: Make portal, presentation, manifest, and scene/test totals self-checking

**Files:**
- Create: `scripts/verify-evidence-consistency.mjs`
- Create: `tests/site/verify_evidence_consistency_test.sh`
- Modify: `scripts/verify-presentation.sh`
- Modify: `tests/site/verify_presentation_test.sh`
- Modify: `scripts/verify-project-site.sh`
- Modify: `tests/site/verify_project_site_test.sh`
- Modify: `docs/index.html`
- Modify: `docs/presentation.html`
- Modify: `docs/PRESENTATION.md`
- Modify: `docs/SUBMISSION_EVIDENCE.json`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: catalog, TEST_STATUS, HTML, presentation script, manifest, and Git history.
- Produces: derived counts instead of hard-coded `36/30/2/4` verifier constants.

- [ ] **Step 1: Write drift RED fixtures**

Mutate one value at a time: catalog/ledger/manifest/README/portal/presentation total, opening fact, scene section count, scene-nav count, “아홉 장면” copy, evidence date, evidence path, and manifest baseline ancestry. Each mutation must fail.

- [ ] **Step 2: Run RED**

Run `bash tests/site/verify_evidence_consistency_test.sh`.

Expected: FAIL because the verifier is absent.

- [ ] **Step 3: Implement dynamic checks and correct drift**

Derive status counts from TSV and independently compare TEST_STATUS. Count `<section class="scene` and `.scene-nav a`; require equality and “일곱 장면” for 7. Validate dates, evidence paths, and that baseline commit is an ancestor of HEAD. Update portal `2026-09-19`, presentation `2026-09-20`, “아홉 장면”, stale phase/security copy, test totals, baseline/PR/CI evidence, while keeping unsupported outcome claims false.

- [ ] **Step 4: Wire existing verifiers and CI**

Call the consistency verifier from portal and presentation tests and a named CI step. Remove hard-coded test totals from `verify-presentation.sh`.

- [ ] **Step 5: Verify and commit**

Run evidence consistency, site accessibility, portal, presentation, and bootstrap tests; expect PASS.

```bash
git add scripts/verify-evidence-consistency.mjs tests/site/verify_evidence_consistency_test.sh \
  scripts/verify-presentation.sh tests/site/verify_presentation_test.sh \
  scripts/verify-project-site.sh tests/site/verify_project_site_test.sh \
  docs/index.html docs/presentation.html docs/PRESENTATION.md docs/SUBMISSION_EVIDENCE.json README.md .github/workflows/ci.yml
git commit -m "포털과 발표가 같은 시험·장면·증거 기준을 말하게 한다" \
  -m "Constraint: 시험 상태 정본은 catalog와 TEST_STATUS의 일치 결과" \
  -m "Rejected: verifier에 현재 합계 상수 유지 | 다음 상태 전환 때 다시 drift함" \
  -m "Confidence: high" -m "Scope-risk: moderate" \
  -m "Tested: evidence consistency, portal, presentation, accessibility, bootstrap"
```

### Task 6: Refresh visual evidence and finish the docs PR

**Files:**
- Modify: `docs/evidence/project-portal-desktop.png`
- Modify: `docs/evidence/project-portal-mobile.png`
- Modify: `docs/evidence/project-portal-visual-verdict.json`
- Modify: `docs/evidence/presentation-desktop.png`
- Modify: `docs/evidence/presentation-mobile.png`
- Modify: `docs/evidence/presentation-visual-verdict.json`
- Modify: `docs/TEST_STATUS.md` only for newly executed evidence
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Produces: portal 1440x1000 and 390x844 captures; presentation 1440x900 and 390x844 captures; verdicts describing those exact files/current totals.

- [ ] **Step 1: Serve and capture locally**

Run `python3 -m http.server 4173 --directory docs --bind 127.0.0.1`. Capture both viewports for `/` and `/presentation.html`; do not publish externally.

- [ ] **Step 2: Run visual-verdict after each capture iteration**

Check overflow, Korean clipping, focus visibility, current totals/dates, seven scenes, and visible BLOCKED/NOT_RUN. Persist only the final matching JSON and screenshots. Correct the portal verdict's stale “26 PASS” reasoning.

- [ ] **Step 3: Keep native accessibility separate**

If a device exists, test light/dark and TalkBack focus/announcements on login, claim, collection polling error, wallet, and settings. Otherwise keep native acceptance NOT_RUN; static semantics and screenshots are not substitutes.

- [ ] **Step 4: Run the complete docs/design gate**

Run mobile semantics/unit/typecheck/lint, operations/bootstrap, evidence/site/presentation/accessibility, secret, and privacy checks. Expect all automated checks PASS.

- [ ] **Step 5: Update HANDOFF and commit artifacts**

Record actual branch/base/head, predecessor merges, commands, artifact paths, and remaining external inputs. Do not say the current PR is merged before confirmation.

```bash
git add docs/evidence/project-portal-desktop.png docs/evidence/project-portal-mobile.png \
  docs/evidence/project-portal-visual-verdict.json docs/evidence/presentation-desktop.png \
  docs/evidence/presentation-mobile.png docs/evidence/presentation-visual-verdict.json \
  docs/TEST_STATUS.md docs/HANDOFF.md
git commit -m "현재 화면과 검증 경계를 최종 증거로 남긴다" \
  -m "Constraint: screenshot은 화면만, native TalkBack과 외부 운영은 별도 상태" \
  -m "Confidence: high" -m "Scope-risk: narrow" \
  -m "Tested: portal/presentation visual verdict and full docs gate" \
  -m "Not-tested: any native or external scenario still marked NOT_RUN"
```

- [ ] **Step 6: Validate the Korean PR and request independent review**

```bash
PR_TITLE='다크 모드와 문서·발표 증거를 같은 기준으로 맞춘다'
PR_BODY='모바일 의미 색상과 TalkBack 상태 알림을 정리하고 README·AGENTS·HANDOFF·API·Worker 실행 지침, submodule 설치, 실제 PR 검사 명령, 포털·발표 수치와 장면 및 시각 증거를 자동 정합 검사로 고정했습니다. native와 외부 실기는 실행 결과에 따라 NOT_RUN 또는 BLOCKED로 유지합니다.'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
```

Expected: checker PASS. Reviewer checks contrast, duplicate announcements, executable setup commands, signer/auth truth, derived counts, scene count, screenshot/verdict freshness, and unsupported claims. Resolve every HIGH/CRITICAL finding and rerun the complete gate before merge.
