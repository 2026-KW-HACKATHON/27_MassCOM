# 격리된 로컬 시연 API·DB

이 구성은 `masscom-showcase-local`이라는 별도 Docker 프로젝트에서만 실행합니다. 운영 `infra/lightsail/compose.yml`, `api.masscom.kr`, 운영 DB·키·Caddy에는 연결하지 않습니다. API는 `127.0.0.1:3301`, PostgreSQL은 `127.0.0.1:55434`에서만 열립니다. 공개 배포나 시연 앱 연결용 구성이 아닙니다.

```bash
read -r -s SHOWCASE_LOCAL_POSTGRES_PASSWORD
export SHOWCASE_LOCAL_POSTGRES_PASSWORD
docker compose -f infra/showcase-local/compose.yml up -d --build --wait

PGPASSWORD="$SHOWCASE_LOCAL_POSTGRES_PASSWORD" \
SHOWCASE_TEST_DATABASE_URL='postgresql://masscom_showcase@127.0.0.1:55434/masscom_showcase_test' \
npm run seed:showcase:local --prefix apps/api

curl --fail http://127.0.0.1:3301/health
curl --fail http://127.0.0.1:3301/merchants
node --test tests/ops/verify_showcase_local_test.mjs
node scripts/verify-showcase-local.mjs

# 중지: DB 볼륨은 보존합니다.
docker compose -f infra/showcase-local/compose.yml down
```

기존 seed는 DB URL의 loopback과 정확한 `_test` 데이터베이스 이름, 연결 후 실제 DB 이름을 확인합니다. 시연 가상 점포를 운영 DB에 넣지 않습니다. 포트가 이미 사용 중이면 기존 서비스를 멈추지 말고 실행을 중단하세요. `down -v`는 사용하지 마세요.

현재 Google audience와 불안전한 DEMO 계정 헤더가 모두 꺼져 있으므로 개인 도감·방문·QR·NFT 요청은 사용할 수 없습니다. 별도 시연 OAuth/Reown, 외부 HTTPS, 공개 API, Android 시연 APK/실기 검증은 `NOT_RUN`입니다. 이 로컬 구성을 외부에 공개하려면 인증·초대 정책, 비용·호스트 용량, DNS/TLS와 격리 수준을 별도로 검토해야 합니다.
