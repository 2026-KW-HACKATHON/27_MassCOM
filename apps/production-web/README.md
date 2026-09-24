# 운영 웹

`node apps/production-web/server.mjs`로 로컬 서버를 실행하면 `http://127.0.0.1:4173`에서 웹을 볼 수 있습니다. 공개 음식점은 같은 출처의 `GET /merchants`를 거쳐 `https://api.masscom.kr/merchants`에서 읽습니다. API 연결이 없으면 이용 불가 안내를 표시하며 예시 점포를 만들지 않습니다.

개인 도감 UI와 API는 `GET /api/web/collection`의 웹 전용 HttpOnly 세션 쿠키로만 연결됩니다. 브라우저에는 모바일 Bearer 토큰을 저장하지 않습니다. 로그인은 `/api/web/auth/start` → Google → `/api/web/auth/callback`, 로그아웃은 같은 출처의 `POST /api/web/logout`입니다. 운영 웹은 `https://masscom.kr/app/`에 배포됐고 Google 콜백 URI도 등록됐습니다. 아직 운영 OAuth 비밀값이 없어서 로그인·도감 API는 503이며 실계정 검증 전입니다. 이 페이지에는 방문 코드 발급·QR 인증·지갑 연결·NFT 발행 동작이 없습니다.

로컬 검사: `node --test tests/site/verify_production_web_test.mjs`, `node --test tests/ops/verify_web_session_proxy_test.mjs`, `bash tests/ops/run_aws_web_smoke.sh`. 외부 `/app/`과 Samsung Android Chrome 표시는 `PASS`; 실계정 A/B 로그인·개인 도감은 `BLOCKED/NOT_RUN`입니다.
