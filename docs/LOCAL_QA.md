# 로컬 QA 한 번에 띄우기 (Issue #295)

`scripts/qa-local.sh`가 임시 DB·시연 seed(가상 점포 A·B·C, 사진 수집품 하나 포함)·API·Metro(dev-client)를 한 명령으로 띄우고, 다시 한 명령으로 정리합니다. 모두 `127.0.0.1` 전용이며 운영 DB·운영 API·실제 Android 패키지에는 절대 연결하지 않습니다.

## 전제

- Docker(로컬에서 `postgres:16.10-alpine`을 받아 띄울 수 있어야 합니다)
- `curl`, `openssl`(표준 macOS/Linux 셸 도구)
- `npm ci --prefix apps/api && npm ci --prefix apps/mobile`를 먼저 실행해 둡니다.

## 사용법

```bash
scripts/qa-local.sh up     # 기본값. 임시 DB+seed+API+Metro를 띄운다.
scripts/qa-local.sh down   # API·Metro를 끝내고 컨테이너를 지우고 .env.local을 되돌린다.
```

`up`이 하는 일:

1. 임시 PostgreSQL 컨테이너(`masscom-qa-pg`, `127.0.0.1:55432`, DB 이름 `masscom_showcase_test`)를 띄우고 `pg_isready`로 준비될 때까지 기다립니다.
2. `npm run seed:showcase:local --prefix apps/api`로 migration과 가상 점포 A·B·C(각 캠페인·목표 1·3·5회)를 넣습니다.
3. `npm run seed:showcase:qa-collectible --prefix apps/api`(새 `apps/api/src/showcase/qa-collectible-seed.ts`)로 가상 점포 A의 캠페인에 사진 수집품 하나를 만들고 바로 게시합니다(목표 1·3회에 연결).
4. `DATABASE_URL`을 그 DB로, `ALLOW_INSECURE_DEMO_ACCOUNT=true`·`API_BIND_HOST=127.0.0.1`·`PORT=3000`으로 API를 백그라운드로 띄우고 `/health`가 200을 줄 때까지 기다립니다. `ACCOUNT_DELETION_HMAC_SECRET`·`MERCHANT_REFERENCE_HMAC_SECRET`는 실행마다 `openssl rand -hex 32`로 새로 만들어 그 프로세스 환경에만 넘기고 어디에도 적거나 찍지 않습니다. `GOOGLE_OAUTH_CLIENT_IDS`는 설정하지 않아 DEMO 헤더(`x-account-id`) 로그인만 허용되는 로컬 전용 모드로 뜹니다.
5. `apps/mobile/.env.local`이 있으면 `.tmp/qa-local/mobile.env.local.bak`로 백업한 뒤(이미 백업이 있으면 **거절**하고 먼저 `down`을 하라고 안내합니다), `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`(Android 에뮬레이터의 호스트 루프백 별칭)과 `EXPO_PUBLIC_DEMO_*` 값을 쓴 새 `.env.local`을 만듭니다.
6. 짧은 `TMPDIR`(`.tmp/qa-local/tmp`, macOS의 긴 기본 TMPDIR 경로에서 Watchman 소켓이 깨지는 것을 피함)과 `APP_VARIANT=development`로 `npx expo start --dev-client`를 백그라운드로 띄웁니다. 에뮬레이터·실기기 연결은 별도입니다(이 스크립트는 Metro를 띄우기만 합니다).

`down`이 하는 일: Metro·API 프로세스를 끝내고, `masscom-qa-pg` 컨테이너를 지우고, `.env.local`을 백업에서 복사한 뒤 `cmp`로 원본과 바이트까지 같은지 확인하고서만 백업을 지웁니다(다르면 백업을 남기고 실패로 끝냅니다). 백업이 없었다면(= `up`이 새로 만든 파일) 그 `.env.local`을 지웁니다. 이 복원·삭제는 `up`이 `.env.local`을 바꾸기 직전에 남긴 표시(`.tmp/qa-local/mobile.env.local.owned`)가 있을 때만 합니다. `up` 전에 `down`만 돌리거나, `down`을 두 번 돌리거나, `up`이 `.env.local`에 닿기 전에 실패하면 사용자의 `.env.local`을 건드리지 않습니다(`tests/ops/qa_local_env_test.sh`, CI의 로컬 시연 API·DB 격리 설정 검사).

## 확인에 쓰는 로컬 계정

`seed:showcase:local`이 만드는 이름입니다(가상 데이터이며 운영 DB에는 없습니다):

| 역할 | 계정 ID |
|---|---|
| 고객 | `showcase-local-customer` |
| 점포 A 직원 | `showcase-local-staff` |
| 점포 A | `showcase-local-merchant` |

DEMO 헤더로 고객처럼 호출하는 예:

```bash
curl -s http://127.0.0.1:3000/merchants
curl -s -X POST http://127.0.0.1:3000/showcase/test-visits \
  -H 'content-type: application/json' -H 'x-account-id: showcase-local-customer' \
  -d '{"merchantId":"showcase-local-merchant"}'
```

## 격리

- `masscom_showcase_test`가 아닌 DB 이름으로는 `seed:showcase:local`·`seed:showcase:qa-collectible` 모두 DB를 열기 전에 거절합니다.
- `/showcase/test-visits`는 `resolveShowcaseDeployment`가 `local`/`hosted`로 판정할 때만 열립니다(운영 로그인에서는 다른 시연 전용 경로처럼 `404 NOT_FOUND`). 자세한 서버 경로는 [apps/api/README.md](../apps/api/README.md)를 봅니다.
- 이 스크립트가 만지는 파일은 `apps/mobile/.env.local`(백업·복원)과 `.tmp/qa-local/`(git 추적 밖) 뿐입니다. 저장소의 다른 환경 파일(`.env`, `.env.example`)은 건드리지 않습니다.
