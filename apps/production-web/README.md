# 운영 웹

`node apps/production-web/server.mjs`로 로컬 서버를 실행하면 `http://127.0.0.1:4173`에서 웹을 볼 수 있습니다. 공개 음식점은 같은 출처의 `GET /merchants`를 거쳐 `https://api.masscom.kr/merchants`에서 읽습니다. API 연결이 없으면 이용 불가 안내를 표시하며 예시 점포를 만들지 않습니다.

개인 도감 UI와 API는 `GET /api/web/collection`의 웹 전용 HttpOnly 세션 쿠키로만 연결됩니다. 브라우저에는 모바일 Bearer 토큰을 저장하지 않습니다. 로그인은 `/api/web/auth/start` → Google → `/api/web/auth/callback`, 로그아웃은 같은 출처의 `POST /api/web/logout`입니다. 운영 웹은 `https://masscom.kr/app/`에 배포됐고, 기존 Google 계정 1개에서 본인 빈 도감·새로고침 유지·로그아웃을 확인했습니다. 두 계정의 실제 데이터 격리는 아직 실증하지 않았습니다. 이 페이지에는 방문 코드 발급·QR 인증·지갑 연결·NFT 발행 동작이 없습니다.

로컬 검사: `node --test tests/site/verify_production_web_test.mjs`, `node --test tests/ops/verify_web_session_proxy_test.mjs`, `bash tests/ops/run_aws_web_smoke.sh`. 외부 `/app/`, 데스크톱의 계정 1개 로그인·로그아웃, Samsung Android Chrome의 A/B 순차 로그인·빈 도감·세션 전환은 `PASS`; 실제 기록이 있는 두 계정의 교차 노출은 `NOT_RUN`입니다.
