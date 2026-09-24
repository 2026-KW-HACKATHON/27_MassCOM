# 운영 웹

`node apps/production-web/server.mjs`로 로컬 서버를 실행하면 `http://127.0.0.1:4173`에서 웹을 볼 수 있습니다. 서버는 같은 출처의 `GET /merchants`만 `https://api.masscom.kr/merchants`로 전달합니다. API 연결이 없거나 정적 파일 서버로만 열면 이용 불가 안내를 표시하며 예시 점포를 만들지 않습니다.

개인 도감은 안전한 웹 로그인·서버 세션이 준비될 때까지 이용할 수 없습니다. 이 페이지에는 방문 코드, QR, 지갑, 발행 기능이 없습니다. 외부 배포 상태: `NOT_DEPLOYED`.
