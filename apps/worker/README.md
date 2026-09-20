# MassCOM NFT Worker

PostgreSQL Outbox의 mint job을 임대해 계약 설정·기존 reward key·receipt·`MascotMinted` 이벤트·owner·series·locked 상태를 대조합니다. 재시작 시 `chain_cursors.next_block - CHAIN_REORG_MARGIN`부터 먼저 조회하고, 특정 reward key를 못 찾으면 `CHAIN_FROM_BLOCK`까지 되돌아가 오래된 미복구 이벤트를 놓치지 않습니다.

체인 확인이 초기 lease보다 오래 걸려도 Worker가 1/3 주기로 lease를 갱신합니다. 소유권 갱신에 실패한 Worker는 다음 신규 전송 전에 중단하며, 다른 Worker는 기존 reward key와 transaction hash부터 복구합니다.

현재 실행 entrypoint는 **로컬 Anvil 전용**입니다. `CHAIN_ID=31337`과 `ALLOW_UNLOCKED_LOCAL_MINTER=true`가 아니면 시작하지 않습니다. 운영 키·Base Sepolia·메인넷 실행 경로가 아닙니다.

```bash
npm ci
npm test
npm run typecheck
npm run build

export TEST_DATABASE_URL='postgresql://.../masscom_test'
npm run test:postgres

export ANVIL_RPC_URL='http://127.0.0.1:8545'
npm run test:anvil
```

로컬 한 작업 실행:

```bash
cp .env.example .env
set -a; source .env; set +a
npm run start:once
```

Worker는 user private key·recovery phrase를 사용하지 않습니다. 로컬 시험은 Anvil unlocked account만 사용하며 Base Sepolia 전용 시험 키는 별도 승인·주입 방식이 정해질 때까지 `BLOCKED`입니다.

재시도 지연은 전송 시도마다 두 배(기본 1초, 최대 5분)로 늘고, 전송 시도가 5회에 도달한 작업은 `MANUAL_REVIEW`(`RETRY_LIMIT_EXCEEDED`)로 닫혀 다시 임대되지 않습니다. 전송 전 단계의 완결성 대기와 RPC 조회 실패는 시도 횟수를 늘리지 않습니다.

5회 상한은 **새 거래 전송**에만 적용됩니다. 이미 보낸 거래(job에 `transaction_hash`가 남아 있는 상태)의 결과 확인은 상한과 무관하게 같은 backoff로 계속되며, 그 거래의 제출 시각부터 `receiptTimeoutMs`(기본 24시간)가 지나면 `MANUAL_REVIEW`(`RECEIPT_TIMEOUT`)로 닫힙니다. 나중에 성공이 확인되면 추가 전송 없이 `FINALIZED`가 됩니다. 그 hash를 제출한 시도 기록을 찾을 수 없으면 기다릴 기준 시각이 없으므로 `RECEIPT_ATTEMPT_MISSING`으로 닫습니다.

Worker가 재시작해 저장된 거래 hash를 다시 확인할 때도 신규 전송과 같은 판정 함수를 씁니다. receipt가 확실히 revert(status 0)인 경우에만 발행 여부를 다시 조회하고, 중지·잔액·RPC 같은 일시 조건이면 그 hash를 제출한 시도 기록을 찾아 `FAILED`로 바꾸면서 hash 제거와 재시도 전환을 한 트랜잭션으로 처리합니다. receipt를 아직 못 찾은 거래와 설정·이벤트 불일치 같은 영구 오류는 재전송하지 않습니다.

일시 장애는 작업을 수동 검토로 보내지 않습니다. RPC 연결 불가는 `RPC_UNAVAILABLE`, 계약 중지는 `MINT_PAUSED`, 민터 잔액이 `MINTER_MIN_BALANCE_WEI`(기본 0) 이하이면 `MINTER_BALANCE_LOW`로 물러나 작업은 `RETRYABLE`로 남고 전송 시도를 소모하지 않습니다. 중지·잔액 검사는 신규 전송 직전에만 하므로 이미 제출됐거나 체인에 발행된 작업의 확인·완료는 계속됩니다. 다른 chain ID·계약 code 없음·MINTER role 없음, 그리고 code는 있지만 인터페이스가 다른 계약(`CONTRACT_INTERFACE_MISMATCH`, EVM 반환 데이터가 있는 revert나 해석할 수 없는 응답일 때만) 같은 설정 오류는 재시도하지 않고 `MANUAL_REVIEW`입니다. 연속 재시도는 `retry_streak`에 기록해 지연을 1초부터 최대 5분까지 두 배씩 늘리며, 이 값은 수동 검토 전환에 쓰지 않아 장기 발행 중지에서도 작업은 `RETRYABLE`로 남습니다. 제출한 거래가 revert됐고 기존 발행도 없으면 중지·잔액·RPC를 다시 확인해 일시 조건이면 revert된 거래 hash를 지우고 재시도합니다. 재확인 시점에 조건이 이미 풀렸다면 기존처럼 `MANUAL_REVIEW`입니다.

`CHAIN_REORG_MARGIN`은 1 이상의 블록 수이며 기본값은 12입니다. 현재 entrypoint는 로컬 Anvil 전용이므로 공개 체인 운영 전에는 해당 체인의 finality 정책과 RPC 조회 한도에 맞춰 다시 결정해야 합니다.

## 공개 테스트넷 서비스 민터(Base Sepolia 84532)

로컬 Anvil 경로(chainId 31337 + `ALLOW_UNLOCKED_LOCAL_MINTER=true`, 노드의 잠금 해제 계정)는 그대로이며 공개 체인에서는 쓰이지 않습니다. 허용 목록에 있는 공개 테스트넷(현재 84532뿐)에서는 승인된 **서비스 민터의 암호화 keystore**로 Worker가 직접 서명합니다. 사용자 지갑 키는 어떤 경로에서도 쓰지 않습니다.

| 환경변수 | 조건 |
| --- | --- |
| `MINTER_KEYSTORE_PATH` | 암호화 JSON keystore의 절대 경로. 저장소 안의 경로는 거절. 파일 권한은 600 이하(그룹·기타 접근 불가) |
| `MINTER_KEYSTORE_PASSWORD_FILE` | 비밀번호가 든 파일 경로(권한 600 이하). 비밀번호를 환경변수 값으로 받지 않음 |
| `CHAIN_RECEIPT_TIMEOUT_MS` | 보낸 거래의 결과 대기 상한(기본 24시간) |

- 환경에 개인키 변수가 있으면 기동을 거절합니다. 복호화 실패는 `MINTER_KEYSTORE_DECRYPT_FAILED`, 주소 불일치는 `MINTER_ADDRESS_MISMATCH`, 계약에 `MINTER_ROLE`이 없으면 `MINTER_ROLE_MISSING`이며 모두 설정 오류(재시도 안 함)입니다. 오류와 로그에 비밀번호·keystore 내용·키를 넣지 않습니다.
- **전송 전 기록**: 거래를 먼저 서명해 hash와 서명된 raw 거래(`mint_tx_attempts.signed_transaction`, 공개 정보)를 DB에 기록한 뒤 broadcast합니다. 기록 직후 종료되거나 RPC 응답을 잃어도 재시작한 Worker는 새 거래를 만들지 않고 **같은 서명 거래**를 다시 보내거나 기존 hash를 확인합니다.
- **nonce**: 같은 민터로 여러 작업·여러 Worker가 돌 때 PostgreSQL advisory lock(체인+민터) 안에서 “결과가 없는 기록된 서명 거래를 오래된 순서로 먼저 전송 → pending nonce 조회 → 서명 → 기록 → 전송”을 직렬화합니다. 체인당 서비스 민터 하나를 전제로 합니다.
- 실제 Base Sepolia 전송은 아직 하지 않았습니다(로컬 Anvil에서 시험용 keystore로만 검증).
