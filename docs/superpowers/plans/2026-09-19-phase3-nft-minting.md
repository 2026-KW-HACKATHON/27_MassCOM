# Phase 3 NFT Minting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an idempotent, recipient-frozen, soulbound NFT mint pipeline from Phase 2 reward entitlement through local Anvil finalization.

**Architecture:** A non-upgradeable ERC-721/ERC-5192 contract enforces role, cap, lock, and reward-key invariants. The API atomically stores a fixed-recipient mint job and Outbox event; a separate Worker leases jobs, verifies chain configuration and contract events, and updates the Android-visible collection state.

**Tech Stack:** Solidity 0.8.24, Foundry v1.8.3, OpenZeppelin Contracts v5.7.0, Node.js TypeScript, ethers 6.17.0, PostgreSQL 18, Expo SDK 57, local Anvil.

**Spec:** `docs/superpowers/specs/2026-09-19-phase3-nft-minting-design.md`

## Global Constraints

- Base Sepolia chain ID is `84532`; local Anvil is test-only and must never be reported as Base Sepolia.
- No operational key, mainnet deployment, user asset movement, paid cloud, public release, Play submission, or competition submission.
- Never request or store a user private key or recovery phrase.
- App wallet methods remain limited to account lookup, chain check/switch, and readable `personal_sign`.
- Reward keys are random 32-byte values and remain stable across retries.
- Mint recipient, binding version, chain, series, and consent version freeze at request time.
- No user/order/exact-meal-time data in token metadata or chain events.
- Preserve all 36 v3 test IDs and only record `PASS / FAIL / BLOCKED / NOT_RUN`.
- Korean PR title/body and Lore commit trailers are required.

---

### Task 1: Foundry contract and locked collection invariants

**Files:**
- Create: `contracts/foundry.toml`
- Create: `contracts/remappings.txt`
- Create: `contracts/src/IERC5192.sol`
- Create: `contracts/src/WolgyeMascot.sol`
- Create: `contracts/test/WolgyeMascot.t.sol`
- Create: `contracts/script/DeployLocal.s.sol`
- Modify: `.gitmodules`, `.github/workflows/ci.yml`, `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces: `createSeries(bytes32,string,uint64)`, `activateSeries(bytes32)`, `mintWithRewardKey(address,bytes32,bytes32)`, `pause()`, `unpause()`, `locked(uint256)`.
- Produces event: `MascotMinted(bytes32 indexed rewardKey,uint256 indexed tokenId,address indexed recipient,bytes32 seriesId)`.

- [x] Add pinned `openzeppelin-contracts@v5.7.0` and `forge-std@v1.16.2` submodules.
- [x] Write failing C01 tests: only `MINTER_ROLE` mints and a minter cannot grant itself admin.
- [x] Write failing C02 tests: duplicate reward key, zero recipient, inactive series, and cap+1 revert; fuzz the configured cap boundary.
- [x] Write failing C03 tests for `approve`, `setApprovalForAll`, both `safeTransferFrom` overloads, and `transferFrom`.
- [x] Write failing C04 tests: inactive series cannot mint and no series mutation surface exists after activation.
- [x] Run `forge test -vvv` and confirm RED because `WolgyeMascot` is missing.
- [x] Implement `IERC5192` and the minimum non-upgradeable `WolgyeMascot` contract.
- [x] Run `forge fmt --check`, `forge build`, `forge test -vvv`; C01~C04 PASS.
- [x] Start Anvil with chain ID 31337, deploy using test accounts, mint one token, and verify owner/locked/event without recording private keys.
- [x] Add Foundry to CI and update license/source records.
- [x] Commit, push, and create Korean PR #49.
- [ ] Wait for CI/review, merge, and verify main CI.

### Task 2: Persistent wallet binding and atomic mint request Outbox

**Files:**
- Create: `apps/api/migrations/0005_wallet_mint_outbox.sql`
- Create: `apps/api/src/wallet-binding.ts`
- Create: `apps/api/src/postgres/wallet-binding.ts`
- Create: `apps/api/src/mint-request-service.ts`
- Create: `apps/api/src/postgres/mint-request-service.ts`
- Create: `apps/api/src/mint-request.postgres.integration.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/src/server.test.ts`, `apps/api/src/wallet-challenge-service.ts`

**Interfaces:**
- Consumes: successful SIWE verification `{ accountId, address, chainId }`.
- Produces: `POST /entitlements/:entitlementId/mint` with headers `Idempotency-Key` and body `{ walletBindingId, bindingVersion, consentVersion }`.
- Produces: `GET /mint-jobs/:jobId` owner-scoped result.

- [ ] Write failing PostgreSQL tests that a successful verification creates or versions one active binding and disconnect never changes an existing job recipient.
- [ ] Write failing W07/M01/M07 tests for same idempotency key replay, different-body conflict, concurrent requests, binding version mismatch, and address change after request.
- [ ] Add migration constraints: one job per entitlement, unique reward key, unique account+idempotency key, Outbox/job same transaction.
- [ ] Implement binding persistence behind a `WalletBindingStore` interface while retaining the in-memory challenge store.
- [ ] Implement mint request transaction that locks the entitlement, verifies owner/status/expiry/binding/chain, creates a random reward key, job, and Outbox, then sets `MINT_REQUESTED`.
- [ ] Add API routes and Korean recovery error codes without accepting recipient/series/reward key from the client.
- [ ] Run API unit, PostgreSQL integration, typecheck, build, secret scan, and existing regression.
- [ ] Update docs/evidence in the same functional PR.
- [ ] Commit, push, create a Korean PR, wait for CI/review, merge, and verify main CI.

### Task 3: Worker, Anvil event verification, recovery, and Android status

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/worker.ts`
- Create: `apps/worker/src/postgres-mint-repository.ts`
- Create: `apps/worker/src/ethers-chain-gateway.ts`
- Create: `apps/worker/src/mint-event.ts`
- Create: `apps/worker/src/**/*.test.ts`
- Create: `apps/worker/src/**/*.postgres.integration.ts`
- Create: `apps/api/migrations/0006_mint_attempts_chain_events.sql`
- Modify: `apps/api/src/collection.ts`, `apps/api/src/postgres/collection.ts`
- Modify: `apps/mobile/src/commerce/commerce-api.ts`, `apps/mobile/src/screens/collection/index.tsx`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: leased `MINT_REQUESTED` Outbox/mint job.
- Produces: `PREPARED → SUBMITTED → CONFIRMING → FINALIZED` or `RETRYABLE / PAUSED / MANUAL_REVIEW`.
- Produces: collection NFT states `NOT_REQUESTED / QUEUED / CONFIRMING / FINALIZED / REVIEW_REQUIRED`.

- [ ] Write failing M01/M03 tests for duplicate delivery, two-worker lease race, and restart after lease expiry.
- [ ] Write failing M02 tests that submission-response loss checks transaction/reward key before any new transaction.
- [ ] Write failing M04/M05 tests for wrong chain, wrong contract code/address, wrong recipient, wrong series, and wrong reward key event.
- [ ] Write failing M06/M08 tests for repeated log ingestion, cursor rewind, and restored DB reconciling an already-used on-chain reward key.
- [ ] Implement PostgreSQL lease, attempts, assets, events, and cursor repositories with unique constraints.
- [ ] Implement ethers gateway that validates chain/contract before sign/send and verifies `MascotMinted` after receipt.
- [ ] Run real Anvil contract integration for one finalized mint and every M01~M08 recovery path that can be locally simulated.
- [ ] Extend collection API/mobile UI to distinguish queued, confirming, finalized, and review-required without changing app collectible state.
- [ ] Run Worker/API/mobile tests, PostgreSQL integration, Foundry, typecheck, lint, Android export, secret scan, and portal checks.
- [ ] Exercise Android mint-request/state polling against local API/Anvil without asking the user wallet to send a transaction.
- [ ] Record Base Sepolia as `BLOCKED` if no funded dedicated test deployer is available; never substitute an operational/user key.
- [ ] Update final Phase 3 handoff/evaluation/test ledger in the same PR.
- [ ] Commit, push, create a Korean PR, wait for CI/review, merge, verify main CI, and close the Phase 3 umbrella Issue.
