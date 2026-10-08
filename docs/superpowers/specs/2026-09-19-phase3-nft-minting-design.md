# Phase 3 NFT 발행 파이프라인 설계

## 목표

Phase 2에서 생성된 고정 보상권을 사용자가 검증한 외부 지갑 주소로만 발행 요청하고, DB Outbox와 별도 Worker가 기존 Base 계열 체인에 양도 제한 NFT를 멱등하게 발행하도록 한다.

Phase 3 완료 기준은 로컬 Anvil에서 계약·API·PostgreSQL·Worker·이벤트 대조·Android 상태를 끝까지 검증하는 것이다. Base Sepolia 배포는 전용 시험 키와 가스가 준비됐을 때만 수행하며, 메인넷·운영 키·사용자 자산은 이 범위에서 건드리지 않는다.

## 확정 정책

- D-004: 첫/3/5회 고정형 보상만 발행한다.
- D-005: 첫 컬렉션은 ERC-721 + ERC-5192 방식으로 항상 잠기며 전송·승인·소각·관리자 회수를 제공하지 않는다.
- D-006: 같은 계정·캠페인·목표 보상권은 하나이며, 달성 후 신청 기간은 90일이다.
- D-007: Base Sepolia 체인 ID 84532를 시험 기준으로 사용하고, 운영은 별도 승인을 받는다.
- 사용자는 `personal_sign`으로 주소 통제만 확인한다. 앱은 거래·approve·permit·스왑·구매를 요청하지 않는다.

## 시스템 경계

```text
Android 발행 확인
  → API: 보상권·지갑 연결 버전·동의·Idempotency-Key 검증
  → 한 DB 트랜잭션: 보상권 MINT_REQUESTED + 고정 수령인 MintJob + Outbox
  → Worker: 작업 임대 → 기존 발행 키/거래 확인 → 계약 호출
  → receipt + 체인 ID + 계약 + 수령인 + MascotMinted 이벤트 대조
  → 확인 중 → 확정 블록 뒤 FINALIZED
  → Collection: 앱 수집품과 실제 NFT 상태·식별자 분리
```

## 계약

`WolgyeMascot`은 Solidity 0.8.24, OpenZeppelin Contracts v5.7.0, Foundry v1.8.3을 사용한다.

- `DEFAULT_ADMIN_ROLE`: 시리즈 생성·활성화, 민터/중지 역할 관리, 중지 해제
- `MINTER_ROLE`: 활성 시리즈의 발행만 가능
- `PAUSER_ROLE`: 신규 발행 긴급 중지 가능
- 시리즈는 `seriesId`, 메타데이터 base URI, 누적 발행 수 `everMinted`, 활성 상태를 가진다. 수량 상한(`maxEverMinted`)은 2026-10-08 D-095로 없앴다.
- 시리즈 생성 뒤 설정 변경 API를 제공하지 않고, 활성화 뒤에는 발행만 허용한다.
- `rewardKey`는 추측 불가능한 32바이트 값이며 계약에서 한 번만 소비한다.
- 발행 이벤트는 `rewardKey`, `tokenId`, `recipient`, `seriesId`만 포함한다.
- `approve`, `setApprovalForAll`, `transferFrom`, `safeTransferFrom`의 모든 경로는 거절한다.
- `locked(tokenId)`는 존재하는 모든 토큰에 `true`를 반환하고 발행 시 ERC-5192 `Locked`를 방출한다.
- `tokenURI`에는 사용자 ID·주문번호·정확한 식사 시각·지갑 외 개인정보를 넣지 않는다.
- 업그레이드 프록시, 소각, 교환, 관리자 회수는 없다.

## 데이터 모델

### wallet_bindings

- `id`, `account_id`, 체크섬 주소·검색용 정규화 주소, `chain_id`, `binding_version`
- `VERIFIED / DISCONNECTED`, 검증·해제 시각
- 계정당 활성 연결 하나, 같은 주소의 다른 활성 계정 연결 금지

### mint_jobs

- 보상권당 하나의 `reward_key`와 하나의 작업
- 요청 시점의 `wallet_binding_id`, `binding_version`, `recipient_address`, `chain_id`를 복사해 고정
- `QUEUED / PREPARED / SUBMITTED / CONFIRMING / FINALIZED / RETRYABLE / PAUSED / MANUAL_REVIEW`
- 현재 프로필 주소 변경으로 기존 수령인을 갱신하지 않는다.

### mint_tx_attempts

- 서명 전 의도, nonce, transaction hash, raw transaction 참조, 제출·receipt 상태
- 응답 유실 시 새 reward key를 만들지 않고 같은 시도 또는 체인 reward key를 조회한다.

### outbox_events

- `MINT_REQUESTED` 이벤트를 mint job과 같은 트랜잭션에 저장한다.
- Worker는 `FOR UPDATE SKIP LOCKED` 임대와 만료 시각으로 재시작 복구한다.

### nft_assets / chain_events / chain_cursors

- `(chain_id, contract_address, token_id)`와 `(chain_id, transaction_hash, log_index)` 고유
- 확정 전 이벤트는 되돌릴 수 있고 확정 뒤에만 작업을 `FINALIZED`로 만든다.

## API

- `POST /entitlements/:id/mint`
  - 소유자, `GRANTED`, 만료 전, 검증된 활성 binding/version, 동의 버전, Idempotency-Key 검증
  - 클라이언트는 수령 주소·seriesId·rewardKey를 제출하지 않는다.
  - 같은 키·같은 본문은 기존 `202` 결과를 반환하고, 같은 키·다른 본문은 `409`다.
- `GET /mint-jobs/:id`
  - 소유자만 고정 수령인·체인·단계·NFT 식별자를 조회한다.
- `GET /collection`
  - `접수`, `확인 중`, `최종 완료`를 앱 수집품과 분리해 표시한다.

현재 loopback `x-account-id`는 개발 resolver일 뿐 운영 인증으로 표현하지 않는다.

## Worker와 체인 대조

- 외부 RPC 호출 중 PostgreSQL 트랜잭션 잠금을 유지하지 않는다.
- 잘못된 chain ID·contract address·code hash는 서명 전에 중지한다.
- 제출 응답이 끊기면 reward key와 저장한 transaction hash/nonce를 먼저 조회한다.
- receipt status만 보지 않고 `MascotMinted`의 계약·수령인·seriesId·rewardKey·tokenId를 대조한다.
- 이벤트 반복 수집은 고유 제약으로 무효화한다.
- 확정 블록 수는 환경 설정으로 두되 로컬 Anvil 시험은 명시적으로 1블록을 사용한다.
- RPC·잔액·설정 이상은 보상권을 `MINT_REQUESTED`로 보존하고 작업을 `PAUSED` 또는 `MANUAL_REVIEW`로 둔다.

## 화면

- 보상권 카드에서 외부 지갑 미연결/미검증, 받을 주소, 체인, 양도 제한, 공개 정보, 비용 부담 주체를 구분한다.
- 발행 버튼은 `personal_sign` 외 지갑 메서드를 호출하지 않고 서버 API만 호출한다.
- 상태는 `NFT 접수`, `블록체인 확인 중`, `등록 완료`, `확인 필요`로 구분한다.
- 앱 재시작·주소 변경 뒤에도 job의 고정 수령인은 변하지 않는다.

## 테스트

- C01~C04: Foundry 단위·fuzz 테스트로 권한, 상한, reward key, 모든 전송/승인 경로, 시리즈 동결 검증
- W07, M01~M08: PostgreSQL 통합, Worker 재시작·중복 전달·응답 유실·설정 오류·이벤트 대조·복원 검증
- M04~M06: 실제 Anvil 계약을 통해 잘못된 설정과 이벤트 중복을 검증
- Android: 서버 접수만으로 완료를 표시하지 않고 상태 전이를 관측

실행하지 못한 Base Sepolia·외부 HTTPS·운영 복원은 `NOT_RUN` 또는 `BLOCKED`로 남긴다.

## PR 경계

1. NFT 계약·Foundry·로컬 Anvil 검증 — C01~C04
2. 지갑 연결 영속화·발행 요청·Outbox — W07, M01, M07의 DB/API 경계
3. Worker·체인 이벤트·복구·Android 상태 — M01~M08와 Phase 3 최종 문서

상태 전용 PR은 만들지 않는다.

## 범위 밖

- 메인넷 배포, 운영 키 생성, 사용자 자산 이동
- 공개 서비스·유료 클라우드·Google Play·대회 제출
- NFT 거래·교환·무작위 보상·내장 지갑·Paymaster
- 업그레이드 프록시·소각·관리자 회수
