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

`CHAIN_REORG_MARGIN`은 1 이상의 블록 수이며 기본값은 12입니다. 현재 entrypoint는 로컬 Anvil 전용이므로 공개 체인 운영 전에는 해당 체인의 finality 정책과 RPC 조회 한도에 맞춰 다시 결정해야 합니다.
