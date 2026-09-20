# 로컬 백업·복원·장애 대응 Runbook

이 문서는 실행 절차 초안입니다. RPC·발행 중지·민터 잔액·DB 장애의 Worker 동작은 Local Anvil과 Docker PostgreSQL에서 검증해 O02를 `PASS`로 기록했습니다(Issue #77). 외부 백업 저장소, 운영 DB, 운영 RPC 제공자의 실제 장애는 검증하지 않았습니다.

## PostgreSQL 백업

1. 신규 발행 요청을 중지하고 Worker의 활성 lease를 확인합니다.
2. 배포 전 백업과 일일 백업을 같은 VM 밖의 승인된 저장소에 암호화해 보관합니다.
3. 접속 비밀번호를 명령행·로그·파일명에 넣지 않고 런타임 비밀 주입을 사용합니다.
4. custom format 백업과 SHA-256, PostgreSQL 버전, schema migration commit을 함께 기록합니다.

```bash
read -s PGPASSWORD && export PGPASSWORD
pg_dump --format=custom --no-owner --file masscom.backup "$DATABASE_URL"
shasum -a 256 masscom.backup
```

## 빈 `_test` DB 복원 연습

```bash
createdb masscom_restore_test
pg_restore --no-owner --clean --if-exists --dbname masscom_restore_test masscom.backup
TEST_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom_restore_test' \
  npm run test:postgres --prefix apps/api
```

복원 DB 이름은 반드시 `_test`로 끝나야 하며 운영 DB에 통합 시험을 실행하지 않습니다. 복원 뒤 `max(CHAIN_FROM_BLOCK, chain_cursors.next_block - CHAIN_REORG_MARGIN)`부터 먼저 이벤트를 재수집하고, 각 mint job의 reward key를 체인에서 확인합니다. 빠른 범위에서 못 찾으면 `CHAIN_FROM_BLOCK`까지 fallback하며, 기존 NFT를 찾으면 새 발행 키나 새 거래를 만들지 않습니다.

## 장애별 중지 기준

| 장애 | 즉시 조치 | 복구 확인 |
| --- | --- | --- |
| RPC chain/contract 불일치 | Worker `PAUSED/MANUAL_REVIEW`, 전송 금지. code는 있지만 인터페이스가 다른 계약은 `CONTRACT_INTERFACE_MISMATCH` | chain ID·contract code·MINTER role·계약 주소 재검증 |
| RPC 연결 불가 | 조치 불필요. Worker가 `RPC_UNAVAILABLE`로 물러나 작업은 `RETRYABLE`, 전송 시도 소모 없음 | `SELECT status, last_error_code, attempt_count FROM mint_jobs WHERE status = 'RETRYABLE'`로 확인, RPC 복구 뒤 다음 실행에서 자동 재개 |
| 발행 중지(pause) | PAUSER가 계약을 중지하면 Worker는 `MINT_PAUSED`로 물러남. 이미 제출된 거래의 확인·완료는 계속됨 | 원인 해소 뒤 admin이 `unpause`, 다음 실행에서 각 작업이 정확히 1개 발행 |
| 민터 잔액 부족 | 잔액이 `MINTER_MIN_BALANCE_WEI` 이하이면 `MINTER_BALANCE_LOW`로 물러남. 보상권·Outbox 유지, 전송 시도 소모 없음 | 승인된 예산·시험 faucet으로 충전 뒤 다음 실행에서 자동 재개, 기존 reward key부터 조회 |
| DB 장애 | API 변경 요청 실패, 완료 화면 금지. Worker는 체인에 아무것도 전송하지 않고 오류로 종료 | DB 일관성·migration·Outbox lease 확인 뒤 Worker 재실행 |
| 전송 응답 유실 | 새 키 발급 금지 | reward key·기존 transaction·event 대조 |
| 확정 전 재조직 | 완료 처리 금지 | 필요한 confirmation과 canonical block hash 확인 |

## 목표와 실제

RPO 1시간·RTO 4시간은 v3 제안값일 뿐 실제 백업/복원 시간 측정 전에는 보장하지 않습니다. 외부 저장소 비용·암호화 키·복원 담당자·알림 채널은 운영 승인 뒤 확정합니다.
