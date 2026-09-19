# Phase 4 Account Deletion and Release Readiness Plan

> Issue: #52. Keep this phase in one PR to avoid status-only PR proliferation.

## Task 1: deletion model and API

- [x] Add failing service and PostgreSQL D01 tests.
- [x] Add deletion ledger migration and `CANCELLED` mint-job state.
- [x] Implement HMAC lookup, deterministic pseudonymization, pre-submit cancellation, submitted-job preservation, and idempotent replay.
- [x] Add authenticated `POST /account-deletion-requests` and purge in-memory wallet challenges.

## Task 2: Android and privacy boundary

- [x] Add deletion API client tests and a Korean settings/deletion screen.
- [x] Show public-chain permanence and pending-mint consequences before confirmation.
- [x] Remount account-scoped routes when account identity changes.
- [x] Add D03 privacy scan regression without storing real secrets.

## Task 3: release readiness and evidence

- [x] Add backup/restore, reviewer access, Data safety, AAB/signing/16KB/App Link, and closed-test checklists.
- [x] Update README, portal, requirements, evaluation map, 36-test ledger, blockers, AI usage, and handoff.
- [x] Run API/PostgreSQL/mobile/Worker/Foundry/secret/portal/Android export regression.
- [ ] Commit, push, create one Korean PR, wait for CI, merge, verify main CI, and close Issue #52.
