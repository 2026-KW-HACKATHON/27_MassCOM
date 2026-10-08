# MassCOM NFT Worker

PostgreSQL Outbox의 mint job을 임대해 계약 설정·기존 reward key·receipt·`MascotMinted` 이벤트·owner·series·locked 상태를 대조합니다. 재시작 시 `chain_cursors.next_block - CHAIN_REORG_MARGIN`부터 먼저 조회하고, 특정 reward key를 못 찾으면 `CHAIN_FROM_BLOCK`까지 되돌아가 오래된 미복구 이벤트를 놓치지 않습니다.

체인 확인이 초기 lease보다 오래 걸려도 Worker가 1/3 주기로 lease를 갱신합니다. 소유권 갱신에 실패한 Worker는 다음 신규 전송 전에 중단하며, 다른 Worker는 기존 reward key와 transaction hash부터 복구합니다.

기본 로컬 예시는 Anvil이며 `CHAIN_ID=31337`에서는 `ALLOW_UNLOCKED_LOCAL_MINTER=true`가 있어야만 RPC의 잠금 해제 계정을 사용합니다. 공개 체인 경로는 Base Sepolia `CHAIN_ID=84532`와 저장소 밖 암호화 keystore를 함께 요구합니다. 다른 체인과 raw private key 환경변수는 거절합니다. 서비스 민터 코드는 로컬 Anvil에서 검증됐고, Base Sepolia 테스트넷에서는 Worker 한 번 실행으로 발행한 proof가 `PASS`입니다([증거](../../docs/evidence/base-sepolia-deployment.json)의 `workerProof`, 2026-09-22, 로컬 임시 DB). 메인넷 전송과 운영 서버 상시 실행은 `NOT_RUN`입니다.

아래 명령은 `apps/worker` 디렉터리에서 실행합니다. Worker PostgreSQL 시험은 package script 안에서 API schema의 `npm run db:migrate --prefix ../api`를 먼저 실행합니다.

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

Worker는 user private key·recovery phrase를 사용하지 않습니다. 로컬 시험은 Anvil unlocked account만 사용합니다. Base Sepolia에서는 소유자가 만든 암호화 keystore를 저장소 밖에 두고 Worker가 직접 서명합니다(아래 "공개 테스트넷 서비스 민터"). 키 생성과 비밀번호 입력은 소유자만 하고, Worker·에이전트는 만들지 않습니다.

재시도 지연은 전송 시도마다 두 배(기본 1초, 최대 5분)로 늘고, 전송 시도가 5회에 도달한 작업은 `MANUAL_REVIEW`(`RETRY_LIMIT_EXCEEDED`)로 닫혀 다시 임대되지 않습니다. 전송 전 단계의 완결성 대기와 RPC 조회 실패는 시도 횟수를 늘리지 않습니다.

5회 상한은 **새 거래 전송**에만 적용됩니다. 이미 보낸 거래(job에 `transaction_hash`가 남아 있는 상태)의 결과 확인은 상한과 무관하게 같은 backoff로 계속되며, 그 거래의 제출 시각부터 `receiptTimeoutMs`(기본 24시간)가 지나면 `MANUAL_REVIEW`(`RECEIPT_TIMEOUT`)로 닫힙니다. 나중에 성공이 확인되면 추가 전송 없이 `FINALIZED`가 됩니다. 그 hash를 제출한 시도 기록을 찾을 수 없으면 기다릴 기준 시각이 없으므로 `RECEIPT_ATTEMPT_MISSING`으로 닫습니다.

Worker가 재시작해 저장된 거래 hash를 다시 확인할 때도 신규 전송과 같은 판정 함수를 씁니다. receipt가 확실히 revert(status 0)인 경우에만 발행 여부를 다시 조회하고, 중지·잔액·RPC 같은 일시 조건이면 그 hash를 제출한 시도 기록을 찾아 `FAILED`로 바꾸면서 hash 제거와 재시도 전환을 한 트랜잭션으로 처리합니다. receipt를 아직 못 찾은 거래와 설정·이벤트 불일치 같은 영구 오류는 재전송하지 않습니다.

일시 장애는 작업을 수동 검토로 보내지 않습니다. RPC 연결 불가는 `RPC_UNAVAILABLE`, 계약 중지는 `MINT_PAUSED`, 민터 잔액이 `MINTER_MIN_BALANCE_WEI`(기본 0) 이하이면 `MINTER_BALANCE_LOW`로 물러나 작업은 `RETRYABLE`로 남고 전송 시도를 소모하지 않습니다. 중지·잔액 검사는 신규 전송 직전에만 하므로 이미 제출됐거나 체인에 발행된 작업의 확인·완료는 계속됩니다. 다른 chain ID·계약 code 없음·MINTER role 없음, 그리고 code는 있지만 인터페이스가 다른 계약(`CONTRACT_INTERFACE_MISMATCH`, EVM 반환 데이터가 있는 revert나 해석할 수 없는 응답일 때만) 같은 설정 오류는 재시도하지 않고 `MANUAL_REVIEW`입니다. 연속 재시도는 `retry_streak`에 기록해 지연을 1초부터 최대 5분까지 두 배씩 늘리며, 이 값은 수동 검토 전환에 쓰지 않아 장기 발행 중지에서도 작업은 `RETRYABLE`로 남습니다. 제출한 거래가 revert됐고 기존 발행도 없으면 중지·잔액·RPC를 다시 확인해 일시 조건이면 revert된 거래 hash를 지우고 재시도합니다. 재확인 시점에 조건이 이미 풀렸다면 기존처럼 `MANUAL_REVIEW`입니다.

## 발행 확정 때 NFT 메타데이터 고정 (Issue #254, D-060)

`finalize`는 `nft_assets`를 넣은 같은 트랜잭션에서 공개 메타데이터를 `nft_token_metadata`에 고정합니다([생성기](src/nft-metadata.ts)). 주소·방문 시각·주문·계정·지갑·tx hash는 입력으로도 받지 않습니다.

- **공개 중인 점포**(스냅샷 때 `ACTIVE`이고 시연 점포이거나 동의서 참조 번호가 있음): 이름 `<가게 이름> 방문 도장`, 설명, 이미지, 속성(가게 이름·동네·업종·방문 단계·캠페인, 가게 AI 그림이면 `그림: AI 생성`).
- **공개 중이 아닌 점포**(숨김·동의서 없는 실제 점포): 이름 `월계 방문 도장`, 일반 설명, 기본 도장, 속성은 방문 단계뿐입니다(가게 이름·동네·업종·캠페인·그림 없음).
- **이미지:** 가게가 적용한 그림(`merchant_art`)을 그 트랜잭션에서 읽어 `nft_metadata_images`에 복사하고 Worker가 계산한 sha256으로 `<출처>/nft-metadata/images/<sha256>.webp`를 씁니다. 그림이 없거나 운영자가 내린 그림(`nft_metadata_takedowns`의 `image:<sha256>`)이면 판이 붙은 기본 도장 `<출처>/nft-metadata/default/mascot-stamp-v1.png`입니다.
- 스냅샷이 이미 있으면 읽지도 쓰지도 않으므로 재확정·재시작이 내용을 바꾸지 않습니다. 어떤 실패든 `NFT_METADATA_SNAPSHOT_FAILED`(재시도 가능)로 감싸 확정 전체를 되돌리고, 작업은 이 코드를 `last_error_code`에 남긴 채 재시도 대기(`RETRYABLE`)가 됩니다. 이미 보낸 거래를 다시 보내지 않고 같은 hash를 다시 확인합니다. 원인은 SQLSTATE·제약 이름만 한 번 로그(`{"event":"NFT_METADATA_SNAPSHOT_FAILED",...}`)로 남깁니다.
- **스냅샷 실패가 오래가면:** 결과 대기 시간(`CHAIN_RECEIPT_TIMEOUT_MS`)이나 전송 상한에 걸려 `MANUAL_REVIEW`로 닫혀도 `last_error_code`는 `NFT_METADATA_SNAPSHOT_FAILED`로 남고 채굴된 시도는 `SUBMITTED` 그대로입니다(발행은 체인에서 끝났으므로 재전송하지 않음). 원인을 고친 뒤 작업을 다시 큐에 넣으면 다음 실행의 `findMintByRewardKey`가 기존 발행을 찾아 확정합니다:

```sql
-- <job-id>를 바꿔 실행한다. 스냅샷 실패로 닫힌 작업만 되돌린다.
BEGIN;
UPDATE mint_jobs SET status = 'RETRYABLE', updated_at = now()
WHERE id = '<job-id>' AND status = 'MANUAL_REVIEW' AND last_error_code = 'NFT_METADATA_SNAPSHOT_FAILED';
UPDATE outbox_events SET status = 'PENDING', available_at = now(), lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
WHERE aggregate_id = '<job-id>'
  AND EXISTS (SELECT 1 FROM mint_jobs WHERE id = '<job-id>' AND status = 'RETRYABLE');
COMMIT;
```


| 환경변수 | 조건 |
| --- | --- |
| `NFT_METADATA_ORIGIN` | **필수, 기본값 없음**(저장소 클래스도 이 옵션을 반드시 받는다). 메타데이터·그림을 내보내는 공개 출처(`https://호스트`만, 경로·끝 슬래시·쿼리 거절, 로컬 `http://localhost`·`http://127.0.0.1`만 예외). 운영 `https://masscom.kr`, 시연 `https://demo-api.masscom.kr`. 한 번 고정한 메타데이터는 바꿀 수 없으므로 환경마다 정확히 넣습니다 |

**시리즈 만들기 규칙.** 온체인 `createSeries`의 base URI는 `<NFT_METADATA_ORIGIN>/nft-metadata/<nft_series.id>/`여야 공개 경로(API `GET /nft-metadata/<series>/<tokenId>.json`)와 맞습니다. `nft_series.id`는 뜻 없는 불투명 id `s-` + 소문자 hex 32자(예: `s-$(openssl rand -hex 16)`)여야 합니다(migration 0036 CHECK). id는 온체인 baseTokenURI와 모든 토큰 주소에 영구히 남으므로 **가게 이름·동네·업종·캠페인을 id에 넣지 않습니다**(넣으면 공개 중이 아닌 가게의 일반 메타데이터 보호가 무너집니다). **같은 `nft_series.id`를 다른 계약(또는 다른 체인)의 시리즈에 다시 쓰지 않습니다** — 공개 경로는 시리즈 id와 token id만으로 찾으므로 두 계약의 같은 token id가 한 주소를 두고 겹칩니다. 시리즈를 활성화하기 전에 온체인 값을 확인합니다: `cast call <계약> 'series(bytes32)(string,uint64,uint64,bool)' <seriesKey> --rpc-url <RPC>`의 첫 값이 정확히 `<출처>/nft-metadata/<nft_series.id>/`여야 하고, 다르면 활성화하지 않습니다(시리즈 설정은 바꿀 수 없으므로 새 시리즈를 만듭니다).

`CHAIN_REORG_MARGIN`은 1 이상의 블록 수이며 기본값은 12입니다. 공개 체인 운영 전에는 해당 체인의 finality 정책과 RPC 조회 한도에 맞춰 다시 결정해야 합니다.

## 상시 실행(반복) 모드 (D-089)

`start:once`는 한 건만 처리하고 끝납니다. 접수된 작업을 사람이 매번 실행하지 않고 계속 처리하려면 반복 모드를 씁니다.

```bash
npm start            # 개발: tsx src/run-worker-loop.ts
npm run build && npm run start:prod   # 배포: node dist/run-worker-loop.js
```

- **한 번 만들고 재사용합니다.** 설정 검증·keystore 복호화·DB 풀·체인 게이트웨이를 시작할 때 한 번만 만들고, 이후 반복에서 재사용합니다(`createConfiguredWorker`). 설정 오류(`MinterConfigurationError`, 필수 환경변수 누락)는 다시 띄워도 같은 결과이므로 반복하지 않고 로그 한 줄을 남기고 종료 코드 1로 끝납니다.
- **반복 동작.** 작업이 있으면 짧은 쉼(200ms)만 두고 이어서 처리해 밀린 것을 비우고, 없으면 `WORKER_IDLE_POLL_MS`(기본 3000, 500~60000)에 지터를 더해 쉽니다. 한 번에 한 건만 처리하므로 같은 민터의 nonce 순서를 지킵니다. 재시도 대기 중인 작업은 대기열이 `available_at`으로 거르므로 반복이 그 작업을 두드리지 않습니다.
- **예외.** 예상 못 한 예외(DB 순단 등)는 1초에서 `WORKER_ERROR_BACKOFF_MAX_MS`(기본 30000, 1000~300000)까지 두 배씩 늘려 다시 시도하고, 한 번 성공하면 처음 간격으로 돌아갑니다. 로그에는 오류 이름과 코드만 남깁니다(RPC 주소·연결 문자열이 든 메시지는 남기지 않음). 잡히지 않은 예외·거절은 `MINT_WORKER_CRASHED` 한 줄을 남기고 종료 코드 1로 끝나며(컨테이너 재시작 정책이 다시 띄움), DB 연결의 오류(DB 재시작 등)는 유휴 연결이든 처리 중에 빌려 간 연결이든 `MINT_WORKER_DB_POOL_ERROR` 한 줄만 남기고(같은 오류가 풀과 연결 양쪽으로 와도 한 줄) 넘어가 다음 질의가 정상 경로로 실패해 물러납니다. 망가진 연결은 반납될 때 풀이 버립니다.
- **이벤트 조회 시작 블록.** `start:once`는 실행마다 기록된 커서에서 조회 시작 블록을 다시 계산합니다. 반복 모드도 같은 값을 반복마다 다시 계산해 게이트웨이에 넘깁니다(`setScanFromBlock`). 시작 때 한 번만 계산하면 오래 떠 있는 프로세스의 조회 범위가 시작 시점부터 계속 늘어납니다.
- **종료.** `SIGTERM`·`SIGINT`를 받으면 처리 중인 한 건을 끝낸 뒤 멈추고 종료 코드 0으로 끝납니다. 두 번째 신호는 즉시 종료합니다. 강제 종료돼도 임대 만료와 "서명한 거래를 먼저 기록 후 같은 거래를 재전송"하는 기존 복구가 이어받습니다.
- **상태 확인.** `WORKER_HEARTBEAT_FILE`(절대 경로)을 주면 반복이 예외 없이 한 번 끝날 때마다 시각(ms)을 적습니다. 컨테이너 헬스체크가 이 파일이 3분 안에 갱신됐는지 봅니다. **이 신호는 루프가 살아 있다는 뜻이지 발행이 성공한다는 뜻이 아닙니다.** 작업 단위 실패(RPC 중단, `MINT_PAUSED`, `MINTER_BALANCE_LOW` 등)는 작업을 재시도 대기로 돌려놓고 `runOnce`가 정상으로 끝나므로, 아무것도 발행되지 않는 동안에도 하트비트와 헬스체크는 정상일 수 있습니다. 반대로 DB 장애처럼 반복 자체가 예외로 끝나는 동안에는 갱신되지 않아 unhealthy가 됩니다. 실제 신호는 대기열 길이입니다: `SELECT count(*), min(available_at) FROM outbox_events WHERE status IN ('PENDING', 'LEASED')`가 줄지 않고 `min(available_at)`이 계속 과거로 벌어지면 막힌 것이니 `mint_jobs.last_error_code`를 봅니다. 로그의 `MINT_WORKER_JOB_HANDLED`도 작업 한 건을 **처리했거나 재시도 대기로 돌렸다**는 뜻일 뿐 성공을 뜻하지 않습니다.
- **프로세스는 하나만 둡니다.** 체인당 서비스 민터가 하나라는 전제입니다(위 nonce 설명). 둘을 띄워도 안전한 것은 **둘이 같은 `DATABASE_URL`을 볼 때뿐**입니다(어드바이저리 락과 기록된 서명 거래 장부가 그 DB에 있고, 얻는 것도 없습니다). **운영 민터 키는 운영 DB를 보는 Worker 외에는 어디서도 쓰지 않습니다.** 다른 DB를 보는 Worker(로컬 개발, 시연 등)에 같은 키를 주면 서로의 거래를 모른 채 같은 nonce로 보내 충돌합니다. 임대 소유자(`lease_owner`)는 `WORKER_ID`(기본 `local-mint-worker`)에 호스트 이름과 pid를 붙여 프로세스마다 달라집니다.

| 환경변수 | 기본 | 설명 |
| --- | --- | --- |
| `WORKER_IDLE_POLL_MS` | 3000 | 작업이 없을 때 쉬는 시간(ms, 500~60000) |
| `WORKER_ERROR_BACKOFF_MAX_MS` | 30000 | 예외 뒤 재시도 간격 상한(ms, 1000~300000) |
| `WORKER_HEARTBEAT_FILE` | 없음 | 비우면 상태 확인 파일을 쓰지 않음. 절대 경로만 허용 |

컨테이너 구성(`infra/lightsail/compose.yml`의 `mint-worker`, 프로파일 `nft-live`)은 [Lightsail 문서](../../infra/lightsail/README.md)를 봅니다. **저장소 루트 판정 때문에 Dockerfile은 `/app/apps/worker/dist`에 둡니다.** Worker는 `dist/`에서 세 단계 위를 저장소 루트로 보고 그 안의 keystore를 거절하므로, `/app/dist`에 두면 루트가 `/`가 되어 어느 경로의 keystore도 거절됩니다.

## 공개 테스트넷 서비스 민터(Base Sepolia 84532)

로컬 Anvil 경로(chainId 31337 + `ALLOW_UNLOCKED_LOCAL_MINTER=true`, 노드의 잠금 해제 계정)는 그대로이며 공개 체인에서는 쓰이지 않습니다. 허용 목록에 있는 공개 테스트넷(현재 84532뿐)에서는 승인된 **서비스 민터의 암호화 keystore**로 Worker가 직접 서명합니다. 사용자 지갑 키는 어떤 경로에서도 쓰지 않습니다.

| 환경변수 | 조건 |
| --- | --- |
| `MINTER_KEYSTORE_PATH` | 암호화 JSON keystore의 절대 경로. 저장소 안의 경로는 거절. 파일 권한은 600 이하(그룹·기타 접근 불가) |
| `MINTER_KEYSTORE_PASSWORD_FILE` | 비밀번호가 든 파일 경로(권한 600 이하). 비밀번호를 환경변수 값으로 받지 않음 |
| `CHAIN_RECEIPT_TIMEOUT_MS` | 보낸 거래의 결과 대기 상한(`start:once`의 기본 24시간, 운영 컨테이너 `mint-worker`는 compose가 10분 `600000`으로 둠). 전송 불가능한 기록 거래가 같은 민터의 모든 발행을 막는 시간의 상한이기도 하므로 Base Sepolia에서는 분 단위로 낮추는 것을 권장. 한 번의 영수증 확인은 2초 간격 조회를 30초 기한까지 이어가고, RPC 요청 하나는 10초에서 끊기므로(ethers 기본 300초) 기한 직전에 시작한 조회가 걸려도 최대 약 50초(기한 30초 + 요청 2건 × 10초)에 끝난다. 영수증이나 확인 깊이가 아직 없으면 `RECEIPT_NOT_READY`, 마지막 조회가 RPC 오류였으면 `RECEIPT_LOOKUP_FAILED`로 재시도 대기(둘 다 같은 재시도 경로이고 코드는 기록만 됨) |
| `MINTER_MAX_TX_FEE_WEI` | 발행 1건의 최대 수수료(gas 한도×`maxFeePerGas`) 상한, 기본 0.01 ETH. RPC가 비정상적으로 큰 수수료를 돌려주면 서명하지 않고 `FEE_ABOVE_CEILING`으로 재시도 |
| `MINTER_LOCK_TIMEOUT_MS` | chain+minter advisory lock 대기 상한, 기본 10초·허용 0.5~60초 |
| `WORKER_DATABASE_POOL_MAX` | Worker PostgreSQL pool 크기, 기본·최소 4·최대 100 |

- 환경에 개인키 변수가 있으면 기동을 거절합니다. 복호화 실패는 `MINTER_KEYSTORE_DECRYPT_FAILED`, 주소 불일치는 `MINTER_ADDRESS_MISMATCH`, 계약에 `MINTER_ROLE`이 없으면 `MINTER_ROLE_MISSING`이며 모두 설정 오류(재시도 안 함)입니다. 오류와 로그에 비밀번호·keystore 내용·키를 넣지 않습니다.
- **전송 전 기록**: 거래를 먼저 서명하고 recovered `from`·hash·chainId·contract·`mintWithRewardKey` calldata가 해당 job과 같은지 확인한 뒤 서명된 raw 거래(`mint_tx_attempts.signed_transaction`, 공개 정보)를 DB에 기록하고 broadcast합니다. 기록 직후 종료되거나 RPC 응답을 잃어도 재시작한 Worker는 새 거래를 만들지 않고 **같은 서명 거래**를 다시 보내거나 기존 hash를 확인합니다.
- **nonce**: 같은 민터로 여러 작업·여러 Worker가 돌 때 PostgreSQL advisory lock(체인+민터) 안에서 “결과가 없는 기록된 서명 거래를 오래된 순서로 먼저 전송 → pending nonce 조회 → 서명 → 기록 → 전송”을 직렬화합니다. 현재 체인당 서비스 민터 하나를 전제로 합니다. 두 번째 민터를 추가하기 전에는 `mint_jobs`/`mint_tx_attempts`에 minter address를 저장하고 sweep을 chain+minter로 좁히는 migration이 필수입니다.
- 기록된 거래가 전송될 수 없는 상태(예: 수수료 급등)로 남아 있으면 같은 민터의 다른 작업은 시도 횟수를 쓰지 않고 `MINTER_NONCE_BLOCKED`로 재시도 대기합니다. 이때 Worker는 막고 있는 거래 hash를 오류 로그에 남깁니다. 결과를 모르는 기록 거래가 50건을 넘으면 일부만 보고 nonce를 정하지 않도록 같은 방식으로 멈춥니다(`MINTER_UNCONFIRMED_BACKLOG` → `MINTER_NONCE_BLOCKED`). 그 거래의 작업이 확정되거나 운영자 검토로 닫히면 시도 기록도 함께 닫혀 다음 작업이 진행됩니다. lock 대기가 길어지면 `MINTER_LOCK_TIMEOUT`(시도 횟수 미소모)입니다.
- 수수료 정보를 받지 못하거나 `0 < maxPriorityFeePerGas <= maxFeePerGas` 관계가 깨지면 서명하지 않고 `FEE_DATA_UNAVAILABLE`로 재시도합니다(기록되는 것이 없음). gas 한도는 추정값의 1.2배입니다. nonce는 `latest`·`pending`·기록된 미확정 거래의 nonce+1 중 가장 큰 값입니다.
- keystore·비밀번호 파일은 canonical 경로 기준으로 저장소 밖이어야 하고, 파일은 권한 600 이하, 모든 상위 디렉터리는 현재 사용자 또는 root 소유이며 그룹·기타 쓰기 불가여야 합니다(root 소유 sticky 임시 디렉터리 제외). 이름 정규화 뒤 개인키·mnemonic·seed/recovery phrase로 끝나는 환경변수가 있으면 로컬 경로를 포함해 기동을 거절합니다.
- 대체(가속) 거래는 만들지 않습니다. 오래 채굴되지 않는 거래는 `RECEIPT_TIMEOUT` → 운영자 검토로 갑니다.
- Base Sepolia 서비스 민터 전송은 `workerProof`(2026-09-22)로 `PASS`했습니다. 메인넷 전송과 운영 서버에서 상시 실행한 기록은 아직 없습니다(`NOT_RUN`).

운영 모드 요약: Local Anvil은 `CHAIN_ID=31337`와 `ALLOW_UNLOCKED_LOCAL_MINTER=true`, Base Sepolia encrypted keystore는 `CHAIN_ID=84532`와 `MINTER_KEYSTORE_PATH`·`MINTER_KEYSTORE_PASSWORD_FILE`을 사용합니다. Base Sepolia 서비스 민터 전송은 `PASS`(`workerProof`), 메인넷과 운영 서버 상시 실행은 `NOT_RUN`입니다.
