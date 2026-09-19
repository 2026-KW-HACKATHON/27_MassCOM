# HANDOFF

마지막 갱신 시각: 2026-09-19 KST

기준 브랜치: `feat/phase3-mint-worker`

검증 기준 커밋: `7ca3c72`·`d4597cd`

현재 작업: PR #51 Phase 3 Worker·Anvil·Android 상태 CI·리뷰·merge

## 이번 작업에서 완료한 것

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

- API `34/34`, API PostgreSQL `8/8`
- Worker `6/6`, Worker PostgreSQL `1/1`, Anvil `W07 M01~M08 PASS`
- 모바일 `45/45`, typecheck·lint·Android export PASS
- Foundry `8/8`, fuzz 128, fmt·build·lint PASS
- secret scan·bootstrap·portal accessibility/structure PASS
- 필수 36개 `24 PASS / 2 BLOCKED / 10 NOT_RUN`

## 보존해야 할 경계

- Worker 실행 entrypoint는 Local Anvil unlocked account 전용이다. 운영 signer 경로로 확대하지 않는다.
- 사용자 개인키·복구 문구·지갑 비밀번호를 요청하거나 저장하지 않는다.
- Base Sepolia는 전용 무자산 배포자와 faucet gas 없이 실행하지 않는다.
- mainnet, 사용자 자산 이동, 유료 자원, 공개 전환, Play 배포, 대회 제출은 별도 승인 전 실행하지 않는다.
- 앱 수집품과 실제 NFT를 계속 분리하고, NFT 수를 매출 증가로 표현하지 않는다.

## 다음 실행 순서

1. PR #51 CI·필수 리뷰 확인, 실패 시 같은 브랜치에서 수정
2. 통과 후 merge하고 main CI 확인
3. Issue #48을 실제 merge 근거와 함께 닫기
4. 이후 Phase 4는 외부 HTTPS·개인정보·탈퇴·release AAB 중 승인 없이 가능한 로컬 준비부터 별도 Issue/PR로 진행

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
