# 운영 웹

`node apps/production-web/server.mjs`로 로컬 서버를 실행하면 `http://127.0.0.1:4173`에서 웹을 볼 수 있습니다. 공개 음식점은 같은 출처의 `GET /merchants`를 거쳐 `https://api.masscom.kr/merchants`에서 읽습니다. API 연결이 없으면 이용 불가 안내를 표시하며 예시 점포를 만들지 않습니다.

개인 도감 UI와 API는 `GET /api/web/collection`의 웹 전용 HttpOnly 세션 쿠키로만 연결됩니다. 브라우저에는 모바일 Bearer 토큰을 저장하지 않습니다. 로그인은 `/api/web/auth/start` → Google → `/api/web/auth/callback`, 로그아웃은 같은 출처의 `POST /api/web/logout`입니다. 대표 운영 웹은 [https://www.masscom.kr/app/](https://www.masscom.kr/app/)이며 기존 `https://masscom.kr/app/`도 호환 경로로 유지합니다. Samsung Android Chrome에서 www의 기존 Google 계정 1개로 본인 빈 도감·URL 재열기 유지·로그아웃, www 로그아웃 후 apex 세션 유지를 확인했습니다. www의 두 번째 계정과 실제 기록이 있는 도감 격리는 아직 실증하지 않았습니다. 이 페이지에는 방문 코드 발급·QR 인증·지갑 연결·NFT 발행 동작이 없습니다.

첫 로그인 동의(Issue #253, D-056): 로그인한 계정이 도감을 읽기 전에 `GET /api/web/consent`로 동의 여부를 먼저 확인한다. `required`이면 도감 요청을 하지 않고 같은 동의 화면(필수 세 개·개인정보 수집·이용 안내 네 가지·`/terms`·`/privacy` 링크, `<label>`·`role="status"`·비활성 버튼)을 보이며, 동의하면 `POST /api/web/consent`(같은 출처·JSON, 폼 없음)로 기록한 뒤 도감을 읽는다. 확인하지 못하면 다시 시도를 보이고, 서버가 이 화면의 문구와 다른 버전을 요구하면 새로 열도록 안내한다. 푸터에 이용약관·개인정보 처리방침·계정 삭제 안내 링크가 있다. Caddy는 `/api/web/consent`를 API로 넘기고 캐시하지 않는다(`tests/ops/verify_web_session_proxy_test.mjs`). 서버는 아직 쓰기 요청을 막지 않는다.

로컬 검사: `node --test tests/site/verify_production_web_test.mjs`, `node --test tests/ops/verify_web_session_proxy_test.mjs`, `bash tests/ops/run_aws_web_smoke.sh`. 외부 www `/app/`의 Android Chrome 단일 계정·호스트별 로그아웃과 기존 apex의 A/B 순차 로그인은 `PASS`; www의 별도 두 번째 계정과 실제 기록이 있는 두 계정의 교차 노출은 `NOT_RUN`입니다.

별도 [운영 관리자 웹](https://www.masscom.kr/admin/)은 기존 Google 웹 로그인 뒤 서버가 운영 관리자 권한을 다시 검사합니다. 실제 점포의 비공개 생성·수정·숨김만 제공하고, 숨길 때 활성 캠페인의 신규 참여도 멈춥니다. 유효한 미수령 QR이 있으면 숨김은 거절되고 수령·만료 뒤 다시 시도할 수 있습니다. 모바일 고객 토큰이나 시연 STAFF 역할은 관리자 권한이 아닙니다. 권한 없는 계정에는 계정 전환 경로가 있습니다. [운영 API·웹 배포와 주 계정 권한 1건](../../docs/evidence/operating-admin-deployment-2026-09-28.json)은 확인했고, 인증된 브라우저의 실제 점포 변경은 미검증입니다. [설계·남은 업무](../../docs/superpowers/specs/2026-09-28-admin-foundation-design.md)를 참고하세요.

[공개 계정 삭제 안내](https://www.masscom.kr/account-deletion)는 운영 Google 웹 세션으로 삭제를 접수해 접수번호를 받는 별도 경로입니다(접수·취소는 최근 10분 안의 로그인이 필요하고, 접수만으로는 삭제하지 않으며 24시간 취소 기간 뒤 운영자가 7일 안에 처리, [D-052](../../docs/DECISIONS.md)). 접수번호가 없는 옛 접수는 처리할 수 없다고 표시하고 거절 사유는 요청자가 그대로 본다고 안내합니다. 관리자 화면(`/admin/`)의 "계정 삭제 요청" 구역에서 플랫폼 관리자가 처리·거절합니다. [옛 접수 전용 외부 HTTPS 기록](../../docs/evidence/operating-deletion-intake-deployment-2026-09-28.json)만 있고 이 버전의 배포·실계정 종단 실행은 미검증입니다.

`/merchant/`는 운영 Google 웹 세션으로 내 점포 권한을 읽고, 실제 활성 점포를 골라 내 계정에 묶인 15분 등록 코드를 발급하는 소스입니다. 관리자는 `/admin/`에서 확인된 경로로 받은 코드를 해당 점포에 승인하거나 기존 STAFF를 회수할 수 있습니다. 고객 Android 앱에서 먼저 로그인해 운영 계정을 만든 뒤 웹에 로그인해야 합니다. 코드 원문은 DB에 남지 않고 재발급 시 이전 코드는 무효입니다. 이 소스의 로컬 시험과 미완료 범위는 [운영 직원 등록 절차](../../docs/OPERATING_STAFF_REGISTRATION.md)에 기록합니다.
