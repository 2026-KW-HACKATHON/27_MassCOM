# 시연 API·DB 호스트

현재 배포 상태(2026-09-30, 방문·쿠폰 되돌리기와 계정 삭제 처리): 시연 API를 main `02cb7e7` 이미지(`masscom-showcase-api:02cb7e7`)로 교체하고 migration 0030·0031을 적용했고(마지막 적용 `0031_account_deletion_processing.sql`) host seed(`SHOWCASE_HOST_SEEDED`)를 실행했다(showcase-api 재생성 `2026-09-29T23:15:52Z`, healthy). 배포 전 백업 `pre-02cb7e7-20260930.dump`(241항목·114642바이트·mode 600, 실제 복원 `NOT_RUN`)와 공개 health 200은 [실측](../../docs/evidence/reversal-deletion-deployment-2026-09-30.json)에 있고, 이 API를 쓰는 [Preview 11 APK](../../docs/evidence/showcase-preview11-release-2026-09-30.json)(소스 `18a8601`은 `02cb7e7`과 모바일 접수번호 `Text` 속성만 다르다)는 공개 사전 릴리스다. 시연 앱의 계정 삭제 요청 접수→취소는 Samsung에서 두 번 실행했고 시연 DB 두 행은 `CANCELLED`·원 계정 ID 지움·접수번호 해시 보존이었다. 운영자 CLI의 실제 처리와 점원의 방문 취소·쿠폰 되돌리기 실기는 `NOT_RUN`이고, 시연 API에 OpenAI 키가 아직 없어 AI 생성은 꺼져 있다. 이전 상태(2026-09-30, 사장님 AI 가게 그림): 시연 API를 main `f1bba2d` 이미지(`masscom-showcase-api:f1bba2d`)로 교체하고 migration 0029(가게 그림 테이블 4개)를 적용했고 host seed(`SHOWCASE_HOST_SEEDED`)를 실행했다(showcase-api 기동 `2026-09-29T16:37:15Z`, healthy). 배포 전 백업 `pre-f1bba2d-20260930.dump`(218항목·105671바이트·mode 600, 실제 복원 `NOT_RUN`)와 공개 health 200은 [실측](../../docs/evidence/ai-store-art-deployment-2026-09-30.json)에 있고, 이 커밋의 [Preview 10 APK](../../docs/evidence/showcase-preview10-release-2026-09-30.json)는 공개 사전 릴리스다. 기동 로그는 `AI store art: disabled (OPENAI_API_KEY is empty)`라 소유자가 아래 절차로 `SHOWCASE_OPENAI_API_KEY`를 넣기 전까지 AI 생성은 꺼져 있고(앱은 "준비 중") 시연 compose는 `AI_ART_STAFF_MAY_MANAGE=true`다. 실제 호출의 비용·지연 측정은 `NOT_RUN`이다. 이전 상태(2026-09-29, 친구): 시연 API를 main `87e98f4` 이미지(`masscom-showcase-api:87e98f4`)로 교체하고 migration 0028(친구 테이블 5개)을 적용했고 host seed(`SHOWCASE_HOST_SEEDED`)를 실행했다. 배포 전 백업 `pre-87e98f4-20260929.dump`(196항목·97297바이트·mode 600)와 공개 health 200·로그인 없는 `/me/friends` 401은 [실측](../../docs/evidence/friends-deployment-2026-09-29.json)에 있고, 이 커밋의 [Preview 9 APK](../../docs/evidence/showcase-preview9-release-2026-09-29.json)는 공개 사전 릴리스다. 두 시연 계정의 친구 추가·`demo.masscom.kr` 링크 열기는 `NOT_RUN`이다. 이전 상태: 시연 API를 main `758f214` 이미지(`masscom-showcase-api:758f214`)로 교체하고 migration 0018·0020~0027(18→27)을 적용했고 가상 점포 A/B/C의 체험 혜택 3건을 seed했다. 백업 mode 600·Postgres 컨테이너 유지·공개 health 200은 [실측](../../docs/evidence/explorer-passport-deployment-2026-09-29.json)에 있고, 같은 커밋의 [Preview 7 APK](../../docs/evidence/showcase-preview7-release-2026-09-29.json)는 공개 사전 릴리스다. 로그인 뒤 메달→상자→쿠폰→점원 사용 처리 실기는 `NOT_RUN`이다. 이전 상태: 별도 Compose·DB의 가상 점포 A/B/C와 두 초대 계정의 로그인·가상 수령·운영 audience 거절을 확인했다([당시 내부 증거](../../docs/evidence/showcase-internal-auth-claim-2026-09-27.json)). [PR #192](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/192) 병합과 PR/main CI PASS 후 **시연 API만** `7455791` 이미지로 교체하고 운영 API/DB 보존을 [실측](../../docs/evidence/showcase-open-login-api-deployment-2026-09-27.json)했다. 운영 웹·Caddy는 이후 [별도 웹 전용 배포](../../docs/evidence/web-only-deployment-2026-09-28.json)로 갱신했다. [Preview 3 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3)는 [Samsung 설치·가상 3점포·Google 취소 복귀](../../docs/evidence/showcase-preview3-phone-2026-09-28.json)를 확인했으나 초대 밖 실제 계정의 폰 로그인·카메라 QR 촬영 수령·외부 지갑은 미검증이다.

## 실행 순서

1. 기존 Lightsail의 비용·크레딧, 메모리·디스크 여유, 운영 컨테이너 ID/재시작 수와 `https://api.masscom.kr/health`를 읽기 전용으로 확인한다. 여유 또는 요금이 불명확하면 원격 생성·기동을 멈춘다. 이유: 시연 스택이 운영 API를 밀어내거나 유료 자원을 만들면 안 된다. 완료 기준: 확인 시각·수치·운영 건강 상태가 `docs/evidence/`에 기록된다.
2. 저장소 밖의 접근 제한된 파일에 [`runtime.env.example`](runtime.env.example)의 값을 준비한다. `SHOWCASE_GOOGLE_WEB_CLIENT_ID`는 운영 ID와 다른 전용 Web ID다. 과거 이름 `SHOWCASE_INVITED_SUBJECT_SHA256`의 해시는 새 정책에서 **직원 권한 부여 적격성에만** 사용하고 고객 로그인을 제한하지 않는다. 해시는 검증된 Google `sub`의 SHA-256이어야 한다. 새 환경에서만 `scripts/prepare-showcase-runtime.sh`를 한 번 실행해 DB/HMAC 비밀을 무작위로 만들 수 있다. 기존 `runtime.env`가 있으면 이 스크립트는 덮어쓰지 않는다. 스크립트가 이메일을 해시하지 않으며 비밀번호·해시 원문·토큰은 Git·출력에 남기지 않는다. 완료 기준: 빈 필수 값이 없고, 파일 권한은 소유자만 읽을 수 있다.
3. 운영 Web client ID를 `MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID` 환경 변수로 주고 `node scripts/verify-showcase-host.mjs --runtime-env <저장소 밖의 파일>`을 실행한다. 이는 실제 설정을 렌더해 격리 경계를 검사할 뿐 배포하지 않는다. 완료 기준: `showcase host runtime boundary verified (not deployed)`가 표시된다. 운영 ID 비교 입력이 없거나 같은 ID면 실패한다.
4. 한국어 PR의 CI·독립 보안 리뷰와 1~3단계가 통과한 뒤에만 별도 `/opt/masscom-showcase` 경로에서 시연 Compose를 기동한다. 운영 `/opt/masscom/current`, 운영 DB 볼륨과 Caddy 설정은 이 단계에서 건드리지 않는다. 완료 기준: 시연 API/DB만 healthy, API `127.0.0.1:3301`, DB는 host port 없음, 운영 health·컨테이너 ID가 전후 동일하다.
5. 시연 DB 마이그레이션 완료 후 API 컨테이너에서 `node dist/showcase/host-seed-command.js`를 실행한다. 초대된 직원이 실제 Google 로그인을 완료한 후에만 `SHOWCASE_STAFF_SUBJECT_SHA256`을 별도 설정하고 `node dist/showcase/grant-staff-command.js`로 A점포 STAFF를 부여한다. 완료 기준: A/B/C·1/3/5 목표와 초대된 계정 한 명의 권한을 읽기 전용 조회로 확인한다. 로그인 전 고정 개발 STAFF ID는 hosted DB에 넣지 않는다.

STAFF 적격 해시를 삭제해도 이미 활성화된 점주 권한은 사라지지 않는다. 권한 회수는 시연 DB의 정확한 멤버십 한 건을 `REVOKED`·`revoked_at`으로 변경하고 기존 세션의 점주 요청 403을 확인하는 별도 운영 작업이다. 고객 로그인 자체는 이 권한 회수와 무관하다.

아래는 첫 배포 때 적용한 순서와 복구 절차입니다. `demo-api.masscom.kr` 연결·Caddy 변경은 [공개 실측](../../docs/evidence/showcase-public-edge-2026-09-27.json)에서, Android APK 설치·로그인은 [폰 실증](../../docs/evidence/showcase-android-apk-2026-09-27.json)에서 PASS입니다. 고객 QR 수령은 후속 게이트입니다. 실패 시 운영 Caddy의 이전 Compose/Caddyfile 마운트로 복귀한 뒤 운영 health를 확인합니다. 볼륨 삭제·운영 자료 변경은 이 절차에 포함하지 않습니다.

**다음 행동:** 설치·두 계정 로그인·가상 점포·카메라 미리보기·점주 발급→고객 직접 코드 수령·도감·중복 거절과 GitHub 재다운로드 해시는 [폰 증거](../../docs/evidence/showcase-two-account-phone-2026-09-27.json)에서 PASS입니다. 카메라로 QR을 촬영하는 경로, 기록 있는 두 **고객** 계정 사이의 분리·실제 롤백 실행은 후속 `NOT_RUN`입니다.

## 공개 edge 연결·복구 게이트 — 첫 적용 완료

`masscom_showcase_edge`는 시연 API와 운영 Caddy만 함께 연결하는 내부 Docker bridge 네트워크입니다. 시연 PostgreSQL·migrate와 운영 API·DB·웹은 이 네트워크에 넣지 않습니다. [Docker Compose 외부 네트워크 안내](https://docs.docker.com/compose/how-tos/networking/)와 `scripts/verify-showcase-host.mjs`·`scripts/verify-lightsail-web.mjs`·`scripts/verify-showcase-edge-routes.mjs`의 변조 시험을 따릅니다. 첫 적용 당시 실제 구성원 둘과 운영 컨테이너 보존은 [실측](../../docs/evidence/showcase-public-edge-2026-09-27.json)으로 확인했습니다.

첫 공개 전환 때에는 초대 계정 로그인 200, 비초대 유효 토큰 403·쓰기 0, 운영 audience 401, STAFF 발급 권한과 계정별 도감 격리를 확인했습니다. Issue #191의 다음 시연 API 배포에서는 이 과거 판정을 재사용하지 않습니다. 새 게이트는 초대 목록 밖의 유효 Google **고객** 로그인 200·본인 도감, 점주 권한 403, 운영 audience 401, 운영 DB 가상 점포 0건입니다. 적용 전 가비아 `demo-api.masscom.kr` A와 공인 TLS, edge 네트워크 구성원을 확인하고 Caddy의 **현재 운영 파일·마운트**를 백업합니다. 새 Compose/Caddy 구문·별도 proxy/IP 헤더를 검증한 후 시연 API만 교체하고 운영 API·DB·웹·Caddy ID/건강 상태를 비교합니다. 실패하면 이전 시연 API 이미지로 되돌린 뒤 운영 건강 상태를 다시 확인합니다. [`deploy-lightsail-web.sh`](../../scripts/deploy-lightsail-web.sh)는 edge 네트워크가 없으면 운영 웹 변경 전에 실패하고, 로컬 probe에서는 시연 호스트를 비공개 `:8082`로 치환합니다. 이 문단은 절차이며 새 로그인 정책의 배포 완료 증거가 아닙니다.

첫 공개 전환에서는 운영 웹 재빌드를 피하도록 [`caddy-override.yml`](caddy-override.yml)을 **기존 운영 Compose의 두 번째 `-f` 파일**로 합성해 Caddy만 재생성했습니다. `MASSCOM_SHOWCASE_CADDYFILE`은 병합된 코드에서 검증·서버에 별도 저장한 후보 파일의 절대 경로입니다. `docker compose config`와 후보 Caddy 2.10.2 validate를 먼저 통과시켰고 `up -d --no-deps --no-build --force-recreate caddy`만 실행했습니다. 같은 마운트 경로 덮어쓰기는 [Docker 공식 병합 규칙](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)을 따릅니다. 문제 발생 시 기존 운영 Compose 파일만으로 Caddy를 재생성해 원래 Caddyfile 마운트로 복귀합니다. `web/current`나 운영 웹 이미지·API/DB 볼륨은 바꾸지 않았습니다. 정상 동작으로 실제 롤백은 실행하지 않았습니다.

첫 적용 시 백업은 서버의 `/opt/masscom/backups/showcase-edge-036f31f`에, 운영 Compose 기준선은 `/opt/masscom/web/releases/4a42475275e3/infra/lightsail/compose.yml`에 있습니다. 시연 호스트만 제거할 때에는 운영 Compose **단독**으로 `caddy` 서비스를 `--no-deps --no-build --force-recreate`해 이전 Caddyfile 마운트로 되돌리고, `api.masscom.kr`·`www.masscom.kr`의 TLS/health와 운영 API·DB·웹 ID를 검사합니다. 기존 시연 DB 볼륨이나 운영 리소스를 삭제하지 않습니다.

## 사장님 AI 가게 그림 키 (D-048, Issue #236)

시연 API의 AI 가게 그림은 `SHOWCASE_OPENAI_API_KEY`가 **비어 있으면 꺼진 채**다(앱에는 "준비 중", 다른 기능에는 영향 없음). [`compose.yml`](compose.yml)이 이 값을 컨테이너의 `OPENAI_API_KEY`로 넘기고, 비어 있으면 빈 값을 넘긴다. 시연 DB의 월 예산·하루 한도는 운영과 따로 계산한다.

- **키는 소유자가 직접 넣는다.** 에이전트가 만들거나 저장소·대화·로그에 두지 않는다. 서버 `/opt/masscom-showcase/runtime.env`(권한 600)에 `SHOWCASE_OPENAI_API_KEY=<키>` 한 줄을 더한다. `scripts/prepare-showcase-runtime.sh`는 기존 파일을 덮어쓰지 않으므로 직접 덧붙인다.
- 넣은 뒤 시연 Compose를 기동할 때 쓴 것과 같은 `--env-file`·`-f` 인자로 `up -d showcase-api`를 실행해 시연 API 컨테이너를 **다시 만든다**(`restart`는 환경 변수를 다시 읽지 않는다). 기동 로그에 `AI store art: enabled`가 나오면 켜진 것이다.
- 선택 값(`SHOWCASE_AI_ART_MONTHLY_BUDGET_USD` 기본 5, `SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS`·`SHOWCASE_AI_ART_DAILY_FINALS` 기본 3, `SHOWCASE_AI_ART_DRAFT_MODEL`·`SHOWCASE_AI_ART_FINAL_MODEL`)은 [`runtime.env.example`](runtime.env.example)에 주석으로 있다.
- 이 compose는 `AI_ART_STAFF_MAY_MANAGE=true`를 켠다: 가게 그림 권한(`MANAGE_ART`)이 기본은 활성 OWNER뿐인데, 시연은 CLI(`grant:showcase:staff`)로 소유자 계정에만 STAFF를 주기 때문이다. 운영 compose에는 이 값이 없다.
- 점주 화면은 시연 앱의 "점주예요" 모드에만 있다. 키를 넣은 뒤의 실제 호출(비용·지연 측정)은 `NOT_RUN`이며 키 입력 뒤 따로 확인한다.


## 계정 삭제 요청 처리 (D-052, Issue #194)

시연 앱은 웹 삭제 페이지와 웹 로그인이 없어 앱 안(Bearer 세션)에서 "계정 삭제 요청"을 접수하고, 접수번호로 처리 상태(취소됨·처리되지 않음과 사유·처리 완료)를 앱에서 조회한다. 접수는 실제 삭제가 아니다: 접수번호를 한 번 보여 주고 24시간은 앱에서 취소할 수 있으며, 그 뒤 **운영자(소유자)가 이 호스트의 CLI로 접수 뒤 7일 안에 처리**한다. 이 요청은 시연 DB에서만 다루고 운영 DB·운영 관리자 웹과 섞지 않는다. 운영 앱은 이 경로 대신 웹 페이지를 쓰므로 운영 API에는 앱 안 접수 경로가 없다.

- **migration:** 0031이 접수 표를 넓힌다(추가·완화만, 구 API 호환). 시연 API를 새 이미지로 교체할 때 기존 절차대로 migration이 먼저 적용된다.
- **처리 절차:** 시연 API 컨테이너 안에서 실행한다(`DATABASE_URL`과 `ACCOUNT_DELETION_HMAC_SECRET`은 컨테이너에 이미 있다). 운영자 이름은 감사 기록에 남으므로 `MASSCOM_OPERATOR`로 지정한다.

  ```bash
  # 시연 Compose를 기동할 때 쓴 것과 같은 -f/--env-file 인자를 붙인다.
  docker compose ... exec -e MASSCOM_OPERATOR=<이름> showcase-api node dist/postgres/account-deletion-command.js list
  docker compose ... exec -e MASSCOM_OPERATOR=<이름> showcase-api node dist/postgres/account-deletion-command.js process <id>
  docker compose ... exec -e MASSCOM_OPERATOR=<이름> showcase-api node dist/postgres/account-deletion-command.js reject <id> "<사유>"
  docker compose ... exec -e MASSCOM_OPERATOR=<이름> showcase-api node dist/postgres/account-deletion-command.js reconcile
  ```

  `list`는 대기 건을 기한 순으로 먼저 보이고 `READY`(처리 가능)·`COOLING_OFF`(취소 기간 중)·`OVERDUE`(기한 초과)와 마스킹한 계정 표지를 보인다(이메일·전체 ID 없음). `process`는 취소 기간이 지나기 전에는 `DELETION_COOLING_OFF`로 거절되고, 처리하면 그 계정의 로그인·세션·지갑 연결·점주 권한이 삭제 처리되며 `platform_admin_audit`에 `ACCOUNT_DELETION_PROCESSED`(`cli:<이름>`)가 남는다. 제출된 거래가 있는 계정은 `ledger=WAITING_FOR_MINT_FINALITY`로 보이고, 거래가 확정된 뒤 `reconcile`을 실행해야 `COMPLETED`로 진행한다.
- **DB 가드:** CLI는 시연 호스트 URL(`postgresql://masscom_showcase@postgres:5432/masscom_showcase`) 또는 로컬 시연 `_test` URL만 받고, 운영 DB URL에서는 `ACCOUNT_DELETION_SHOWCASE_DATABASE_REQUIRED`로 멈춘다.
- **결과 확인:** 시연 앱 사용자는 로그인 중에는 계정 설정에서 상태를 보고, 처리 뒤에는 접수번호로 `POST https://demo-api.masscom.kr/account-deletion-status`(본문 `{"receipt":"…"}`)를 조회할 수 있다. 앱 안 접수→취소는 Samsung에서 두 번 실행했지만([Preview 11 증거](../../docs/evidence/showcase-preview11-release-2026-09-30.json)) 실제 종단 실행(앱 안 접수→CLI 처리→접수번호 조회)은 `NOT_RUN`이다.
