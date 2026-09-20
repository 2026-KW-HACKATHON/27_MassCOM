# MassCOM API

ERC-4361(SIWE) 주소 확인, Phase 2 공개 점포·캠페인·방문·도감·추천, Phase 3 wallet binding·mint job·Outbox·체인 확정 상태 조회를 제공하는 Node.js API입니다.

## 실행

```bash
npm ci
npm test
npm run typecheck
npm run build
cp .env.example .env
npm run db:migrate:local
npm run start:local
```

로컬 앱 연동 시험에서만 `ALLOW_INSECURE_DEMO_ACCOUNT=true`로 바꿀 수 있습니다. 기본값 `false`에서는 실제 account resolver가 없으므로 wallet POST 요청을 `503 ACCOUNT_AUTH_NOT_CONFIGURED`로 거절합니다.

`GET /merchants`를 사용하려면 `DATABASE_URL`을 실제 PostgreSQL에 지정한 뒤 migration을 실행합니다. claim slot API는 `MERCHANT_REFERENCE_HMAC_SECRET`에 32바이트 이상의 별도 비밀값도 필요하며 저장소에는 실제 값을 커밋하지 않습니다. 운영 seed는 제공하지 않으며 테스트의 가상 점포만 `demo: true`로 사용합니다.

## 엔드포인트

- `GET /health`
- `GET /merchants`: 로그인·지갑 없이 활성 점포와 공개 중인 현재 캠페인 조회
- `GET /collection`: 서버가 확인한 계정의 유효 방문·앱 수집품과 `NOT_REQUESTED / QUEUED / CONFIRMING / FINALIZED / REVIEW_REQUIRED` NFT 상태 조회; 정확한 식사 시각과 token 제외
- `GET /recommendations`: 정원 마감 제외·미방문 우선·다음 고정 보상과 한국 날짜 회전을 reason code와 함께 조회
- `GET /merchant/merchants/:merchantId/context`: 서버가 확인한 계정의 활성 점포 멤버십과 허용 권한 조회
- `POST /merchant/merchants/:merchantId/claim-slots`: 대상 계정의 1인용 수령 슬롯과 일회용 token 발급
- `POST /merchant/merchants/:merchantId/claim-slots/:claimSlotId/reissue`: 본문의 `expectedTokenVersion`이 현재 버전과 같을 때만 이전 token을 폐기하고 재발급
- `POST /claim-slots/preview`: 로그인한 대상 계정이 token을 소비하지 않고 상태 확인
- `POST /claim-slots/redeem`: 로그인한 대상 계정이 token을 한 번 소비하고 방문·한국 날짜 진행도·고정 보상권을 원자 확정
- `POST /wallet/challenges`
- `POST /wallet/verify`
- `GET /wallets/active-binding`: 서버가 확인한 현재 binding ID·version·주소 조회
- `DELETE /wallets/:id/binding`: 본문의 정확한 `bindingVersion`만 연결 해제
- `POST /entitlements/:id/mint`: `Idempotency-Key`와 binding/version/동의만 받아 고정 수령인 job·Outbox 원자 생성
- `GET /mint-jobs/:id`: 해당 계정 소유 작업의 고정 수령인·체인·상태 조회
- `POST /account-deletion-requests`: 재인증된 계정의 삭제 요청; 미전송 작업 취소와 제출된 거래 결과 확인을 분리

두 POST 요청의 계정은 서버 `AccountResolver`가 결정합니다. `x-account-id`는 loopback 서버의 명시적 insecure demo 모드에서만 읽으며 실제 로그인 인증을 대신하지 않습니다.

## 검증 조건

- domain, URI, version 1, Base Sepolia chain ID 84532
- 서버 발급 nonce, issuedAt, 5분 expirationTime
- 요청 계정, challenge 원문, 현재 선택 주소
- 실제 secp256k1 서명 복구 주소
- 성공 nonce 단일 소비와 동시 검증 claim

## PostgreSQL 검증

```bash
read -s PGPASSWORD && export PGPASSWORD
export TEST_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom_test'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run test:postgres
```

통합 테스트는 테이블을 비우므로 DB 이름이 `_test`로 끝나는 전용 데이터베이스만 허용합니다. PostgreSQL 18에서 카탈로그, Q01~Q03·Q05와 R01·R03을 확인합니다. QR token은 SHA-256, 점포 주문 참조는 점포 ID를 함께 넣은 HMAC-SHA-256만 저장하며 token 원문은 발급·재발급 응답에서 한 번만 반환합니다. 재발급은 `tokenVersion` 낙관적 잠금으로 같은 버전의 동시 요청 중 한 건만 성공합니다. preview는 상태를 바꾸지 않으며, redeem은 슬롯·방문·보상권 중 일부만 성공하면 전체를 롤백합니다.

지갑 challenge 원문·nonce claim은 `DATABASE_URL`이 설정되면 PostgreSQL `wallet_challenges` 테이블(migration 0008)에 원자적 claim으로 저장되어 프로세스 재시작에도 남습니다. `DATABASE_URL`이 없으면 DEMO 전용 in-memory 저장소로 대체되며 이 경우에만 재시작 시 사라집니다. 계정 삭제 요청은 남은 challenge를 저장소 종류와 무관하게 즉시 제거합니다. 성공한 주소 연결과 mint job·Outbox·체인 이벤트·NFT 자산은 PostgreSQL에 남습니다. Worker 실행과 Local Anvil 재현은 [`../worker/README.md`](../worker/README.md)를 따르며 운영 signer·Base Sepolia는 포함하지 않습니다.

계정 삭제는 `ACCOUNT_DELETION_HMAC_SECRET`이 설정된 경우에만 켜집니다. 실제 운영 재인증 guard는 아직 연결되지 않았으며 `ALLOW_INSECURE_DEMO_ACCOUNT=true`에서만 `x-demo-reauthenticated: true`를 받는 loopback DEMO 경계를 사용합니다. 미전송 mint job만 `CANCELLED`로 바꾸고, 제출·확정 작업의 체인 대조 자료는 비식별 account alias와 함께 보존합니다.
