# HANDOFF

마지막 갱신 시각: 2026-09-20 KST

기준 브랜치: `main`

검증 기준: PR #57 merge `9794c70`, main CI `35455419805` PASS

현재 작업: 사용자 요청에 따라 중지. 새 기능 작업 없음.

## 이번 작업에서 완료한 것

- Claude CLI 전체 감사와 독립 code-reviewer·architect `REQUEST CHANGES/BLOCK` 수신
- 수정 후 Claude `APPROVE`, 독립 code-reviewer 새 CRITICAL/HIGH 없음 확인
- 활성 Worker lease 삭제 경쟁과 account lifecycle lock 부재 재현·수정
- 삭제 tombstone 뒤 wallet/claim/redeem/mint write 거절과 동시 deletion/mint 수렴 시험
- 테스트 카탈로그 36개 상태 정본 동기화·CI ID별 diff
- duplicate revert reward-key 복구, secret/presentation/DEMO/한글 PR gate 보강
- merge 완료 worktree 2개, local branch 11개, remote branch 8개 정리
- PR #57 merge `9794c70`, PR·main CI PASS, Issue #56 종료

- PR #53 merge `62196f0`, main CI `35450443943` PASS, Issue #52 종료
- 브라우저 발표 페이지와 데스크톱·390px 시각 검증
- 3분·5분 발표 원고, Android 시연·장애 대체 runbook
- 결과를 채우지 않은 점주·이용자 현장 검증 기록지
- main SHA·PR·CI·36개 테스트·BLOCKED/NOT_RUN 제출 증거 manifest
- 허위 매출·협약·Play 승인 문구와 NOT_RUN 은폐를 막는 CI verifier

- PR #51 merge `36065ab`, main CI `35448436859` PASS, Issue #48 종료
- 계정 삭제 ledger와 `CANCELLED` mint 상태 migration 추가
- 동시 삭제 요청 HMAC 잠금·원 account ID 비식별화·지갑 연결 해제·challenge 제거
- 미전송 mint job만 취소하고 제출/확정 NFT는 결과 대조 자료와 함께 보존
- Android 계정·개인정보 화면과 삭제 전 공개 블록체인·외부 지갑 불변 안내
- 민감 console 인자·미검토 analytics SDK privacy gate와 CI 연결
- Google Play 계정 삭제·폐쇄 테스트·16KB·App Links·package 등록 공식 근거 재확인
- privacy/deletion, release readiness, backup/restore runbook 작성

- `0006_mint_attempts_chain_events.sql`로 mint attempt·chain event·NFT asset·cursor 저장 구조 추가
- Outbox `SKIP LOCKED` lease, 장기 체인 확인 중 heartbeat, 만료 lease 복구, retry/manual-review/finalize 상태 전이 구현
- 기존 reward key를 전송보다 먼저 확인해 응답 유실·DB 복구 시 재발행 방지
- RPC chain·contract code·MINTER role을 전송 전에 검사
- receipt 성공만으로 완료하지 않고 contract·recipient·series·reward key·owner·locked를 대조
- 신규 전송과 기존 이벤트 복구에 동일 confirmation 기준 적용
- Anvil snapshot/revert로 미확정 이벤트가 완료 상태를 만들지 않음을 검증
- 도감 API·Android에 `NOT_REQUESTED / QUEUED / CONFIRMING / FINALIZED / REVIEW_REQUIRED` 추가
- NFT 접수 전에 전체 공개 시험 주소·체인·양도 제한·서비스 부담 gas·공개 장부 안내 표시
- Samsung Android 16에서 접수→등록 완료→기존 token #1 재전송 없는 DB 복구 PASS
- Phase 3 증거와 36개 테스트 원장 갱신; Base Sepolia는 B-012 유지

## 최신 검증

- API `35/35`, API PostgreSQL `14/14`
- Worker `8/8`, Worker PostgreSQL `4/4`, Anvil `W07 M01~M08 PASS`
- 모바일 `48/48`, typecheck·lint·Android export PASS
- Foundry `8/8`, fuzz 128, fmt·build·lint PASS
- secret scan·bootstrap·portal accessibility/structure PASS
- 필수 36개 `26 PASS / 2 BLOCKED / 8 NOT_RUN`

## 보존해야 할 경계

- Worker 실행 entrypoint는 Local Anvil unlocked account 전용이다. 운영 signer 경로로 확대하지 않는다.
- 사용자 개인키·복구 문구·지갑 비밀번호를 요청하거나 저장하지 않는다.
- Base Sepolia는 전용 무자산 배포자와 faucet gas 없이 실행하지 않는다.
- mainnet, 사용자 자산 이동, 유료 자원, 공개 전환, Play 배포, 대회 제출은 별도 승인 전 실행하지 않는다.
- 앱 수집품과 실제 NFT를 계속 분리하고, NFT 수를 매출 증가로 표현하지 않는다.

## 재개 시 할 일

1. 운영 배포를 시작하기 전에 `chain_cursors` read path와 reorg margin을 구현·검증
2. Worker retry 상한·지수 backoff·dead-letter 또는 `MANUAL_REVIEW` 전환 추가
3. SIWE challenge 공유 저장소와 운영 세션 저장 정책 결정
4. Expo 호환 업데이트로 모바일 moderate advisory 14건을 재평가
5. 외부 HTTPS·Base Sepolia·release AAB·Google Play·공개/최종 제출은 별도 승인 뒤 진행

## 재현 명령

```bash
npm test --prefix apps/api
npm run test:postgres --prefix apps/api
npm test --prefix apps/worker
npm run test:postgres --prefix apps/worker
npm run test:anvil --prefix apps/worker
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
./scripts/forge.sh test -vvv
bash scripts/check-secrets.sh
bash tests/bootstrap/verify_bootstrap_test.sh
```

PostgreSQL 통합·Anvil 시험은 이름이 `_test`로 끝나는 전용 `TEST_DATABASE_URL`만 사용합니다. Anvil 시험 전에 `./scripts/anvil.sh --chain-id 31337 --silent`를 실행합니다.
