# Phase 4 Account Deletion and Release Readiness Design

## Goal

Implement the local, no-cost release-readiness slice that can be verified without creating cloud resources, operational keys, a public deployment, or a Play release.

## Account deletion contract

- `POST /account-deletion-requests` uses the authenticated account boundary and requires the exact confirmation phrase `DELETE MY ACCOUNT`.
- A keyed HMAC derives both the lookup hash and a deterministic deleted-account alias. The original account ID is not stored in the deletion ledger.
- Repeated requests for the same account return the same request.
- Wallet challenges are removed immediately and every wallet binding is disconnected.
- Jobs with no transaction hash in `QUEUED / PREPARED / RETRYABLE / PAUSED` become `CANCELLED`; their Outbox row is closed and their entitlement becomes `CANCELED`.
- `SUBMITTED / CONFIRMING` jobs and any job with a transaction hash are preserved. The request remains `WAITING_FOR_MINT_FINALITY` so deletion is not described as complete while chain outcome is unknown.
- `FINALIZED` jobs, chain events, and NFT assets are preserved because deleting the service account cannot erase the public chain or break duplicate-mint recovery.
- Customer and staff account identifiers are replaced in one transaction with a deterministic deletion alias. The old identifier can no longer read a collection or wallet binding.

## Privacy verification

- Extend the secret scanner with private key, recovery phrase, raw claim token, and exact-account-log regression fixtures.
- Record D03 as PASS only for repository/static/API response coverage; production log aggregation remains an operational check.
- Keep D02 NOT_RUN until a real production authentication/account-switch implementation exists. Add route remount safeguards now but do not claim a real account switch.

## Release readiness artifacts

- Prepare Data safety, deletion URL, reviewer access, signed AAB, upload-key, 16KB, App Link, closed-test, backup, and rollback checklists.
- Do not invent a package ID, domain, reviewer account, tester count, signed AAB, policy approval, or public URL.
- Do not create paid cloud resources, operational keys, a Play release, or a competition submission.

## Test boundary

- D01: actual PostgreSQL integration for pre-submit cancellation, submitted-job preservation, pseudonymization, and request replay.
- D02: remains NOT_RUN; only code-level remount protection is added.
- D03: repository/static/API response scan PASS, with external production logging explicitly NOT_RUN.
- A02/O01/O02 remain NOT_RUN or BLOCKED unless an actual release/environment exercise is performed.
