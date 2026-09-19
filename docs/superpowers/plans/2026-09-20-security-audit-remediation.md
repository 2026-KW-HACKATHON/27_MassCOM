# Security Audit Remediation Plan

> Issue #56. One branch and one Korean PR; no production deployment.

- [x] Run Claude CLI whole-repository audit and capture the artifact.
- [x] Run independent code-reviewer and architect lanes.
- [x] Add RED tests for active lease deletion, deletion tombstones, concurrent deletion/mint, catalog drift, and camelCase secrets.
- [x] Add one HMAC account lifecycle lock across deletion, wallet, claim, redeem, and mint request writes.
- [x] Prevent deletion from cancelling active Worker leases and recheck lease before submit.
- [x] Recover duplicate-transaction revert through the existing reward key.
- [x] Synchronize the 36-test catalog and enforce ID-level status equality in CI.
- [x] Strengthen secret, presentation evidence, DEMO reauthentication, and Korean PR gates.
- [x] Remove merged worktrees and local/remote branches after exact merged-state checks.
- [ ] Run full regression, update evidence, request independent re-review, create PR, merge, and verify main CI.
