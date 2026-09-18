# 지갑 주소 확인 API

ERC-4361(SIWE) 메시지를 발급하고 Base Sepolia 주소 서명을 검증하는 Phase 1 최소 API입니다.

## 실행

```bash
npm ci
npm test
npm run typecheck
npm run build
cp .env.example .env
npm start
```

로컬 앱 연동 시험에서만 `ALLOW_INSECURE_DEMO_ACCOUNT=true`로 바꿀 수 있습니다. 기본값 `false`에서는 실제 account resolver가 없으므로 wallet POST 요청을 `503 ACCOUNT_AUTH_NOT_CONFIGURED`로 거절합니다.

## 엔드포인트

- `GET /health`
- `POST /wallet/challenges`
- `POST /wallet/verify`

두 POST 요청의 계정은 서버 `AccountResolver`가 결정합니다. `x-account-id`는 loopback 서버의 명시적 insecure demo 모드에서만 읽으며 실제 로그인 인증을 대신하지 않습니다.

## 검증 조건

- domain, URI, version 1, Base Sepolia chain ID 84532
- 서버 발급 nonce, issuedAt, 5분 expirationTime
- 요청 계정, challenge 원문, 현재 선택 주소
- 실제 secp256k1 서명 복구 주소
- 성공 nonce 단일 소비와 동시 검증 claim

현재 저장소는 메모리 구현이므로 프로세스 재시작 시 challenge가 사라집니다. PostgreSQL 원자 소비는 Phase 2 작업입니다.
