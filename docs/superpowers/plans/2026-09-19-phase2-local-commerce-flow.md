# Phase 2 Local Commerce Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the wallet-optional merchant discovery, visit claim, collection, and recommendation flow through three reviewable PRs.

**Architecture:** Reuse the existing Node/PostgreSQL domain services, add only missing read models, and keep Expo Router routes thin over typed clients and focused screen modules. Customer and merchant demo routes share the configured API while preserving account/permission boundaries.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, Node TypeScript, PostgreSQL 18, node:test.

**Spec:** `docs/superpowers/specs/2026-09-19-phase2-local-commerce-flow-design.md`

## Global Constraints

- Phase 3 NFT contract, worker, testnet, paid cloud, public deployment are out of scope.
- Do not add dependencies unless a feature cannot be implemented with the current stack.
- Do not record QR tokens, wallet addresses, signatures, device serials, or private wallet data in repository evidence.
- Keep PR titles and bodies in Korean and bundle code, tests, docs, and evidence in the same functional PR.
- Preserve all 36 v3 test IDs and use only PASS, FAIL, BLOCKED, NOT_RUN.

---

### Task 1: Customer merchant discovery and detail

**Files:**
- Create: `apps/mobile/src/merchant/merchant-api.ts`
- Create: `apps/mobile/src/merchant/merchant-api.test.ts`
- Create: `apps/mobile/src/screens/merchant-list/index.tsx`
- Create: `apps/mobile/src/screens/merchant-detail/index.tsx`
- Create: `apps/mobile/src/app/merchants/[merchant-id].tsx`
- Create: `apps/mobile/src/app/wallet.tsx`
- Modify: `apps/mobile/src/app/index.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Modify: README and Phase 2 state/evaluation docs

**Interfaces:**
- Consumes: `GET /merchants`
- Produces: `MerchantApiClient.listMerchants(signal?)`, typed `PublicMerchant`, merchant list/detail routes

- [x] Write parser/client tests for valid response, invalid response, HTTP error, and abort.
- [x] Run mobile tests and confirm RED.
- [x] Implement the minimum typed client and parser.
- [x] Build list loading/error/empty/content states and pull-to-refresh.
- [x] Build detail campaign, capacity, demo, condition, and first/3/5 reward presentation.
- [x] Move the Phase 1 wallet UI to `/wallet` as an optional action.
- [x] Run mobile tests, typecheck, lint, Android export, and update docs.
- [x] Commit, push, and create Korean PR #45.
- [ ] Wait for CI and required review, then merge.

### Task 2: Merchant claim, customer redemption, and collection

**Files:**
- Create focused mobile claim/merchant/collection clients, tests, screens, and routes.
- Create API collection read model/service and PostgreSQL integration test.
- Modify API server routes and state/evaluation docs.

**Interfaces:**
- Consumes: merchant context, claim-slot issue/reissue/preview/redeem services
- Produces: collection read API, merchant issue UI, customer preview/redeem UI, collection UI

- [ ] Add failing API tests for collection visits, entitlements, and separated NFT status.
- [ ] Implement collection PostgreSQL query and authenticated route.
- [ ] Add failing mobile client tests for context, issue, preview, redeem, collection.
- [ ] Implement typed clients and error mapping without token logging.
- [ ] Implement merchant context/issue route using development account resolver labels.
- [ ] Implement claim preview/confirm route with duplicate-submit protection.
- [ ] Implement collection route separating visit, app collectible, and NFT states.
- [ ] Run API, PostgreSQL, mobile, typecheck, lint, export, secret checks.
- [ ] Commit, push, create Korean PR, wait for CI, merge.

### Task 3: Explainable recommendations and end-to-end proof

**Files:**
- Create recommendation domain/read model, tests, mobile client/screen/route.
- Modify test ledger, evaluation map, portal, README, HANDOFF, and evidence.

**Interfaces:**
- Consumes: public merchants plus authenticated visit progress
- Produces: ordered recommendations with stable reason codes and Korean explanations

- [ ] Write failing recommendation tests for unvisited priority, campaign availability, and deterministic rotation.
- [ ] Implement minimal recommendation API with reasons.
- [ ] Implement loading/error/empty/content recommendation screen.
- [ ] Run full automated regression.
- [ ] Exercise merchant issue → customer preview/redeem → collection → recommendation on Android.
- [ ] Record PASS/FAIL/BLOCKED/NOT_RUN evidence without secrets.
- [ ] Update evaluation and final Phase 2 handoff in the same functional PR.
- [ ] Commit, push, create Korean PR, wait for CI, merge, verify main CI.
