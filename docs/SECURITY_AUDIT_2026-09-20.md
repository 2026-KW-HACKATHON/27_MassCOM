# 2026-09-20 전체 코드·보안 감사

대상 기준선: `main@8b244b2`

검토 방법:

- 로컬 Claude CLI 전체 저장소 읽기 전용 감사
- 독립 code-reviewer의 코드·보안·CI·문서 대조
- 독립 architect의 삭제·민팅 상태 전이 반대 검토
- API·PostgreSQL·Worker·Anvil·모바일·Foundry·저장소 gate 재실행

초기 합성 결과는 `REQUEST CHANGES`였습니다. code-reviewer는 HIGH 3건, architect는 `BLOCK`을 반환했습니다. 수정 후 Claude는 `APPROVE`, 독립 code-reviewer는 새 CRITICAL/HIGH 없음으로 `COMMENT`를 반환했습니다.

## 해결한 HIGH

### 삭제 완료 뒤 Worker가 NFT를 전송할 수 있는 경쟁

- 계정 삭제는 만료되지 않은 `LEASED` Outbox 작업을 취소하지 않습니다.
- 활성 lease는 `pendingMintJobs`에 포함되어 삭제 상태를 `WAITING_FOR_MINT_FINALITY`로 유지합니다.
- Worker는 `markPrepared` 후 submit 직전에 DB lease를 즉시 갱신·검사합니다.
- 외부에서 job이 `CANCELLED`로 바뀌면 `renewLease`가 `MINT_JOB_LEASE_LOST`를 반환합니다.

### 삭제와 계정 쓰기 경로의 lock 불일치

- `PostgresAccountLifecycle`이 HMAC account reference 기반 advisory lock을 단일 정의합니다.
- 삭제·wallet binding·claim issue/reissue/redeem·mint request가 같은 lock을 사용합니다. 두 계정이 참여하는 claim issue는 HMAC lock key 정렬 순서로 creator와 customer를 모두 잠급니다.
- 삭제 ledger가 있으면 신규 wallet/claim/redeem/mint write는 `ACCOUNT_DELETED`로 거절됩니다.
- 삭제와 mint 요청을 동시에 실행해도 원 account ID·활성 job·pending Outbox가 남지 않는 PostgreSQL 회귀를 추가했습니다.

### 36개 테스트 정본 충돌

- `tests/catalog/required-tests.tsv`를 `TEST_STATUS.md`의 현재 상태와 동기화했습니다.
- bootstrap gate가 36개 ID별 상태를 두 파일에서 직접 비교합니다.
- submission manifest는 TEST_STATUS 합계, 발표 화면 수치, evidence 파일 실존을 함께 검증합니다.

## 추가 보완

- duplicate transaction revert 뒤 기존 reward key를 찾으면 `MANUAL_REVIEW` 대신 `FINALIZED`로 수렴합니다.
- 만료 lease는 갱신할 수 없고, 취소된 `PREPARED` job은 `SUBMITTED`로 되살릴 수 없습니다.
- secret scanner가 camelCase token/secret/key assignment와 로컬 `.worktrees/.omx/.omc/.serena` 경계를 처리합니다.
- insecure DEMO 재인증 헤더는 `EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION=true`일 때만 전송됩니다.
- 한글 PR gate는 제목·본문의 최소 한글 문자 수를 요구합니다.
- merge 완료 local/remote branch와 오래된 worktree를 정리했습니다.

## 운영 전 남은 MEDIUM

| 항목 | 현재 조치 | 운영 전 조건 |
| --- | --- | --- |
| `chain_cursors` write-only | 로컬 데이터 소량, M08 복구 PASS | cursor 기반 스캔 범위 전진·재조직 여유 정책 |
| Worker retry 상한 없음 | 중복 효과는 계약·DB가 차단 | backoff·최대 횟수·dead-letter/manual review |
| SIWE challenge 메모리 저장 | 단일 인스턴스 DEMO로 명시 | PostgreSQL/공유 저장소 또는 단일 인스턴스 강제 |
| 모바일 moderate advisory 14건 | high/critical 0, B-008 유지 | Expo 호환 upstream 업데이트 후 release 회귀 |
| SecureStore 미사용 세션 | 개인키 없음·RPC allowlist 적용 | 운영 세션 저장 정책 검토 |

이 항목들은 운영·Play·외부 HTTPS가 이미 BLOCKED인 현재 로컬 DEMO 범위의 완료 주장을 바꾸지 않지만, 운영 배포 전에는 반드시 다시 판정합니다.

Issue #56의 실행 수치와 검토 판정은 [security-audit-issue-56.json](evidence/security-audit-issue-56.json)에 별도 고정했습니다. 기존 [account-deletion-privacy.json](evidence/account-deletion-privacy.json)은 PR #53 당시 Android 실기·자동화 증거를 그대로 유지합니다.
