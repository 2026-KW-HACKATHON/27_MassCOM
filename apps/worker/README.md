# MassCOM NFT Worker

PostgreSQL Outbox의 mint job을 임대해 계약 설정·기존 reward key·receipt·`MascotMinted` 이벤트·owner·series·locked 상태를 대조합니다.

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
