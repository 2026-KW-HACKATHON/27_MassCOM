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

## 사장님 AI 가게 그림 키 (D-048·D-058, Issue #236·#256)

시연 API의 AI 가게 그림은 `SHOWCASE_OPENAI_API_KEY`가 **비어 있으면 꺼진 채**다(앱에는 "준비 중", 다른 기능에는 영향 없음). [`compose.yml`](compose.yml)이 이 값을 컨테이너의 `OPENAI_API_KEY`로 넘기고, 비어 있으면 빈 값을 넘긴다. 시연 DB의 월 예산·하루 한도는 운영과 따로 계산한다.

**현재 상태(2026-09-30): 팀 결제가 확정되지 않아 키를 넣지 않았다**([B-026](../../docs/BLOCKERS.md): 팀 결제 확정 대기). 소유자가 "넣었다는 가정하에 완성해 달라"고 해서 켜기 준비는 끝났다: 아래 켜기 스크립트와 컨테이너 리허설, **월 예산 USD 5 확정**(하루 한도는 가게당 시안 3회·최종 3회 기본값 그대로, [D-058](../../docs/DECISIONS.md)). **운영 키는 D-050대로 계속 비운다.** 실제 키 입력과 실제 호출은 결제 확정 뒤이며 `NOT_RUN`이다.

- **키는 소유자가 직접 넣는다.** 에이전트가 만들거나 저장소·대화·로그에 두지 않는다. 서버 `/opt/masscom-showcase/runtime.env`(권한 600)에 `SHOWCASE_OPENAI_API_KEY=<키>` 한 줄을 더한다. `scripts/prepare-showcase-runtime.sh`는 기존 파일을 덮어쓰지 않으므로 직접 덧붙인다.
- 선택 값(`SHOWCASE_AI_ART_MONTHLY_BUDGET_USD` 기본 5, `SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS`·`SHOWCASE_AI_ART_DAILY_FINALS` 기본 3, `SHOWCASE_AI_ART_DRAFT_MODEL`·`SHOWCASE_AI_ART_FINAL_MODEL`)은 [`runtime.env.example`](runtime.env.example)에 주석으로 있다. 비우면 기본값이다(예산 USD 5는 이미 기본값이라 따로 적지 않아도 된다).
- 이 compose는 `AI_ART_STAFF_MAY_MANAGE=true`를 켠다: 가게 그림 권한(`MANAGE_ART`)이 기본은 활성 OWNER뿐인데, 시연은 CLI(`grant:showcase:staff`)로 소유자 계정에만 STAFF를 주기 때문이다. 운영 compose에는 이 값이 없다.
- 점주 화면은 시연 앱의 "점주예요" 모드에만 있다.

### 켜기·끄기·상태 스크립트

[`enable-ai-art.sh`](enable-ai-art.sh)가 켜기(`enable`)·끄기(`disable`)·읽기 전용 상태(`status`)를 맡는다. 서버에서 `sudo`로 실행한다. 스크립트는 자기 위치에 의존하지 않고 **실행 중인 `showcase-api` 컨테이너의 라벨·이미지**에서 릴리스 폴더와 이미지 태그를 읽는다(추측하지 않는다). 이 스크립트가 들어 있지 않은 이전 릴리스가 떠 있으면 저장소의 파일을 서버로 복사해 어디서든 실행하면 된다.

| 모드 | 하는 일 |
| --- | --- |
| `status` | 읽기 전용. `runtime.env` 권한, 키 줄 상태(값 없이 "present (N chars)"), 실행 중 컨테이너·이미지 태그·릴리스 폴더·건강 상태, 마지막 `AI store art:` 기동 줄(알려진 세 줄과 줄 전체가 같은 것만), **실행 중 컨테이너의 `OPENAI_API_KEY`가 비어 있는지·파일의 키와 같은지**(메모리에서만 비교), 유효 한도(컨테이너 환경 중 `AI_ART_*` 값만 `docker inspect` 템플릿 안에서 걸러 읽는다)를 보여 주고 `state: ENABLED`·`DISABLED`·`NEEDS_RECREATE_OR_CHECK`(runtime.env와 실행 중 컨테이너가 어긋나거나 키 줄이 쓸 수 없는 꼴)를 낸다. 아무것도 바꾸지 않는다 |
| `check` | 읽기 전용. 컨테이너·Docker Compose 버전(`docker compose version --short`)과 함께 compose가 렌더한 설정 검사(`rendered config: OK\|MISMATCH`)와 설정 어긋남 검사(`drift: OK\|MISMATCH`, 실행 중 컨테이너의 `config-hash` 라벨·계산한 해시 두 값을 그대로 보여 준다. 해시는 비밀이 아니다)만 하고 아무것도 바꾸지 않는다. **키를 넣기 전에** 이 서버에서 `enable`이 통과할지 미리 확인할 때 쓴다(키 줄이 없어도 된다). 하나라도 `MISMATCH`이면 종료 코드 1 |
| `enable` | 바꾸기 전에 다음을 모두 확인한다. ① `runtime.env`가 읽을 수 있는 일반 파일이고 권한이 정확히 600이며 NUL 바이트가 없다. ② `SHOWCASE_OPENAI_API_KEY`가 **정확히 한 줄의 `SHOWCASE_OPENAI_API_KEY=<값>`** 꼴이고 값이 비어 있지 않으며 허용 글자(`A-Z a-z 0-9 . _ : ~ + / = -`, 512자 이하)만 쓴다(값은 출력하지 않는다). ③ 실행 중 `showcase-api`가 정확히 하나이고 그 라벨의 compose 파일이 `/opt/masscom-showcase/releases/<릴리스>/infra/showcase-host/compose.yml` 실제 경로 그대로다(심볼릭 링크를 거치지 않는다). ④ compose가 **렌더한 설정**(`compose config --format json`, 메모리에서만 읽고 출력하지 않는다)의 `OPENAI_API_KEY`가 파일의 값과 같고, 한도 값(`SHOWCASE_AI_ART_*`)이 API 범위(예산 0~1000·소수 여섯 자리, 하루 횟수 0~50, 모델 이름 `[A-Za-z0-9._:-]{1,80}`) 안이며 다른 값에 키가 섞여 있지 않다. ⑤ **설정 어긋남 검사:** 실행 중 컨테이너의 `com.docker.compose.config-hash` 라벨이, 키와 가게 그림 설정(`AI_ART_*`)만 실행 중인 값으로 고정한 현재 compose 설정의 `config --hash`와 같다. 다르면 키 말고 다른 설정(다른 runtime.env 값·compose 파일)이 컨테이너와 어긋난 것이므로 "전체 시연 배포를 먼저 하라"며 아무것도 바꾸지 않고 멈춘다. 통과하면 **`showcase-api`만** 실행 중인 이미지 태그로 `up -d --no-deps --no-build --pull never --force-recreate --wait`(`postgres`·`migrate`는 건드리지 않음)하고, 새 컨테이너가 healthy이고 그 컨테이너의 키가 파일의 키와 같으며 기동 로그의 마지막 `AI store art:` 줄이 정확히 `AI store art: enabled`인지 확인한 뒤 유효 한도를 보여 준다 |
| `disable` | 소유자가 **먼저** `runtime.env`에서 키 줄을 지우거나 비운 뒤에만 진행한다(키 줄이 남아 있거나 `export`·중복 등 비표준 줄이 있으면 거절). `enable`과 같은 검사(렌더된 `OPENAI_API_KEY`는 빈 값이어야 한다)를 거쳐 `showcase-api`만 다시 만들고, 새 컨테이너의 키가 비어 있고 로그가 `AI store art: disabled (OPENAI_API_KEY is empty)`인지 확인한다. **`disable --force-drift`**는 비용을 멈추는 비상 스위치라 설정 어긋남(⑤)만 경고를 내고 건너뛴다: 키 줄이 비어 있어야 하고 나머지 검사와 `showcase-api`만 다시 만드는 동작은 그대로이며, 다시 만들 때 `runtime.env`·compose 파일과 실행 중 컨테이너의 **모든 차이**가 함께 적용된다는 경고와 두 해시를 보여 준다 |

- 스크립트는 `runtime.env`를 **고치지 않는다**(키 줄은 소유자가 직접 넣고 지운다). 키 값은 출력하지 않고 명령줄 인자로도 넘기지 않으며, compose가 오류 메시지에 키를 섞어 내도 `[redacted]`로 가린다. `bash -x`나 `SHELLOPTS=xtrace`로 불려도 첫 명령 `set +x`가 추적을 끄므로 키가 찍히지 않는다. 바꾸기 전 검사가 하나라도 실패하면 아무것도 바꾸지 않고 끝난다. 다시 만든 뒤 검사(healthy·컨테이너 키·기동 줄)가 실패하면 컨테이너는 이미 새 설정으로 떠 있으므로, 메시지의 안내대로 `runtime.env`를 고쳐 다시 `enable`하거나 키 줄을 비우고 `disable`한다.
- **compose와 다르게 읽지 않는다.** compose는 `export NAME=값`·들여쓴 줄·`NAME: 값`·`NAME = 값`·나중 중복 줄·값 안의 `$` 치환·셸 환경 변수(`sudo -E`로 물려받은 `SHOWCASE_OPENAI_API_KEY`)를 모두 받아들여 파일의 한 줄만 보는 검사를 속일 수 있다. 그래서 키 줄은 위의 표준 꼴 한 줄만 받고 그 밖의 줄·`$`·비ASCII·따옴표 안의 특수 글자는 거절하며, compose를 부르기 전에 `SHOWCASE_*`·`COMPOSE_*`·`MASSCOM_SHOWCASE_*`·`OPENAI_API_KEY`·`AI_ART_*`와 `DOCKER_HOST`·`DOCKER_CONTEXT`·`DOCKER_TLS_VERIFY`·`DOCKER_CERT_PATH` 환경 변수를 모두 지우고 프로젝트 이름을 `-p masscom-showcase`로 고정하며 활성 Docker 컨텍스트가 이 서버의 로컬 소켓이 아니면(`ssh://`·`tcp://` 등) 거절하고(컨텍스트 이름을 `docker context: ...` 줄로 알려 준다), 마지막으로 compose가 렌더한 값을 직접 확인한다. Docker Compose v2의 `config --format json`과 `config --hash`가 필요하다(없으면 거절하고 아무것도 바꾸지 않는다).
- `runtime.env`의 `MASSCOM_SHOWCASE_IMAGE_TAG`가 실행 중인 태그와 다르면 알림을 내고 **실행 중인 태그를 그대로** 쓴다(키 한 줄 때문에 이미지가 바뀌지 않게 한다). 설정 어긋남 검사가 실패하는 흔한 이유는 마지막 시연 배포 뒤 `runtime.env`의 다른 값이나 compose 파일이 바뀐 것, 또는 그 뒤 Docker Compose를 올려 해시 계산이 달라진 것이다: 그때는 전체 시연 배포로 컨테이너를 새로 만든 뒤 다시 실행한다.
- 시험: [`tests/ops/enable_ai_art_test.sh`](../../tests/ops/enable_ai_art_test.sh)(가짜 `docker`가 compose의 파일 읽기·셸 변수 우선·렌더 JSON·config-hash 라벨을 흉내 낸다. 키 없음·빈 키·비표준 줄 다섯 가지·중복·`$`·비ASCII·NUL·권한 644·심볼릭 링크 거절과 docker 미호출, 켜기·끄기·키 바꾸기 성공, 물려받은 변수 무시, `bash -x` 무누출, 렌더된 키 불일치·한도 범위·설정 어긋남·라벨 없음·심볼릭 릴리스 폴더 거절, 로그·재생성·건강·컨테이너 키 실패, `status`·`check` 읽기 전용, `disable --force-drift`, 원격 Docker 컨텍스트·물려받은 `DOCKER_*` 처리, `docker ps -a` 힌트). CI의 시연 호스트 검사에서 실행한다. 진짜 Docker Compose로는 [`scripts/rehearse-enable-ai-art-real-compose.sh`](../../scripts/rehearse-enable-ai-art-real-compose.sh)가 임시 폴더에 진짜 postgres·migrate·showcase-api를 띄워(가짜 키, OpenAI 호출 없음) status·enable·disable·설정 어긋남 거절·한도 범위 거절·물려받은 변수 무시를 실제로 확인한다(로컬 전용, CI 아님; 시연 서버에서는 실행하지 않는다).

**켜는 순서(팀 결제 확정 뒤, 소유자):**

0. 서버에 떠 있는 릴리스에 이 스크립트가 없으면(이 스크립트를 넣기 전 릴리스) 저장소의 [`enable-ai-art.sh`](enable-ai-art.sh)를 먼저 서버로 복사한다(예: `scp infra/showcase-host/enable-ai-art.sh <서버>:/tmp/`). 스크립트는 자기 위치에 의존하지 않는다. 아래 `<스크립트>`는 그 경로다(릴리스에 들어 있으면 `/opt/masscom-showcase/releases/<릴리스>/infra/showcase-host/enable-ai-art.sh`).
1. **키를 넣기 전에** `sudo bash <스크립트> check`로 이 서버에서 `drift: OK`·`rendered config: OK`가 나오는지 본다. `MISMATCH`이면 키를 넣지 말고 원인(마지막 시연 배포 뒤 바뀐 `runtime.env`·compose 파일, Docker Compose 버전 차이)을 먼저 해결한다: 전체 시연 배포로 컨테이너를 새로 만든 뒤 다시 확인한다.
2. 서버 `/opt/masscom-showcase/runtime.env`(권한 600)를 **`sudoedit`이나 편집기**로 열어 `SHOWCASE_OPENAI_API_KEY=` 줄이 **이미 있으면 그 줄의 값을 채우고, 없을 때만 새 줄을 더한다**(같은 이름의 줄이 둘이면 스크립트가 거절한다). `echo '...' >> runtime.env`처럼 명령줄로 쓰지 않는다: 키가 셸 기록(history)에 남고, 파일 끝에 개행이 없으면 앞 줄과 붙어 버린다. 줄은 정확히 `SHOWCASE_OPENAI_API_KEY=<키>` 꼴로 쓴다(`export`·들여쓰기·공백·따옴표 안 특수 글자 금지).
3. `sudo bash <스크립트> status`로 지금 상태를 본다(키는 있는데 `state: NEEDS_RECREATE_OR_CHECK`이면 정상: 아직 다시 만들지 않았다).
4. `sudo bash <스크립트> enable`.
5. 출력에서 `SHOWCASE_OPENAI_API_KEY: present`, `docker context: ...`, `showcase-api recreated: ... (health: healthy)`, `startup log: AI store art: enabled`, `monthly budget ... 5`·`daily draft rounds per store: 3`·`daily finals per store: 3`을 확인한다.
6. 아래 "첫 실제 호출 확인표"를 실행한다.

`enable`이 `compose up failed`로 끝나면 옛 컨테이너가 이미 없어졌거나 새 컨테이너가 `created`로 남았을 수 있다: `sudo docker ps -a --filter label=com.docker.compose.service=showcase-api`와 `sudo docker logs <id>`를 보고, `runtime.env`의 키 줄을 이전 상태로 되돌린 뒤 스크립트를 다시 돌리거나 아래 수동 절차를 쓴다. `found 0 running of N in total (...=created|exited)`라는 메시지가 나오면 바로 이 상태다.

**끄는 순서:** ① `runtime.env`를 `sudoedit`으로 열어 키 줄을 지우거나 비운다 ② `sudo bash <스크립트> disable` ③ `startup log: AI store art: disabled (OPENAI_API_KEY is empty)`를 확인한다(앱은 "준비 중"으로 돌아간다). ②가 `config drift`로 거절되면 **비용을 먼저 멈추기 위해** `sudo bash <스크립트> disable --force-drift`를 쓸 수 있다(키 줄이 비어 있어야 하고 `showcase-api`만 다시 만든다. 다시 만들 때 `runtime.env`·compose 파일의 다른 변경도 함께 적용되므로 그 뒤 전체 시연 배포로 정리한다).

**스크립트 없이 끄는 수동 절차(스크립트가 안 돌 때의 비상 경로):** ① 위처럼 키 줄을 지우거나 비운다 ② `runtime.env`의 `MASSCOM_SHOWCASE_IMAGE_TAG`가 실행 중인 이미지 태그(`sudo docker inspect --format '{{.Config.Image}}' <컨테이너>`)와 같은지 확인한다(다르면 compose가 다른 이미지로 다시 만든다) ③ 다음을 실행한다.

```bash
sudo docker compose -p masscom-showcase --env-file /opt/masscom-showcase/runtime.env \
  -f /opt/masscom-showcase/releases/<릴리스>/infra/showcase-host/compose.yml \
  up -d --no-deps --no-build --force-recreate showcase-api
```

④ `sudo docker logs $(sudo docker ps -q --filter label=com.docker.compose.service=showcase-api) 2>&1 | grep 'AI store art:'`에서 `disabled (OPENAI_API_KEY is empty)`를 확인한다.

### 켜진 상태 컨테이너 리허설 (Issue #256)

배포와 같은 Dockerfile(`infra/lightsail/api.Dockerfile`)로 만든 이미지에 **가짜 키와 가짜 OpenAI 서버**([`scripts/fake-openai-images.mjs`](../../scripts/fake-openai-images.mjs))를 붙여 켜진 상태를 미리 시험한다. `bash scripts/rehearse-ai-art-container.sh`가 로컬 PostgreSQL 컨테이너(`masscom-sky-qa-pg`)에 실행마다 이름이 다른 자기 DB `masscom_256_<프로세스 번호>_test`를 만들고, 끝나면 그 실행의 컨테이너(실행별 라벨)·DB·이미지를 지운다(다른 실행의 것은 건드리지 않고, `REHEARSAL_IMAGE`는 `masscom-256-rehearsal`로 시작하는 이름만 받는다). 시나리오마다 새로 띄워 기동 로그, 시안 4장→고급 그림→적용→공개 그림, 월 예산 소진(503 `AI_ART_BUDGET_EXHAUSTED`), 하루 한도(429 `AI_ART_DAILY_LIMIT`), OpenAI 429·500·503의 **한 번 재시도**(성공·계속 실패 둘 다)와 400·잔액 소진 429의 무재시도, 그리고 요청 횟수·`ai_art_spend` 비용 기록·로그의 키 값 부재를 센다. 결과와 한계는 [증거](../../docs/evidence/ai-art-enable-rehearsal-2026-09-30.json)에 있다. **실제 OpenAI 호출·실제 키·배포는 하지 않았다.**

### 첫 실제 호출 확인표 (키를 넣은 뒤, `NOT_RUN`)

첫 실제 호출은 돈이 든다. 아래를 한 번에 확인하고 결과를 `docs/evidence/`와 [B-026](../../docs/BLOCKERS.md)에 남긴다. 실패하거나 이상하면 바로 `disable`한다.

| 확인 | 방법 | 기준·기록 |
| --- | --- | --- |
| 켜짐 | `enable` 출력 | `AI store art: enabled`, health healthy |
| 시안 지연 | 시연 앱 "점주예요" → 가게 그림 → "AI 시안 받기"를 누른 때부터 시안 4장이 뜰 때까지 초 | 앱 안내는 "1~2분". 실제 초와 실패 여부를 기록 |
| 시안 비용 | 서버에서 `sudo docker compose --env-file /opt/masscom-showcase/runtime.env -f /opt/masscom-showcase/releases/<릴리스>/infra/showcase-host/compose.yml exec postgres psql -U masscom_showcase -d masscom_showcase -c "SELECT id, kind, micro_usd, created_at FROM ai_art_spend ORDER BY id DESC LIMIT 6"` | 시안 4행의 합(µUSD)을 예상 $0.04(40,000)와 비교 |
| 최종 지연·비용 | 시안을 고른 뒤 "고급 그림"이 뜰 때까지 초와 같은 조회의 `FINAL` 행 | 실제 값을 예상 $0.18(180,000)과 비교하고, 크게 다르면 `estimatedFinalMicroUsd`(D-050 (5))를 다시 정한다 |
| 월 예산 잔여 | 같은 방식으로 `SELECT coalesce(sum(micro_usd), 0) FROM ai_art_spend WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'` | 이번 달 합계가 USD 5(5,000,000) 안인지 |
| 고객 화면 표시 | "가게 그림으로 쓰기"로 적용한 뒤 고객 모드의 탐색 목록·상세·동네 지도·도장판 | 새 그림이 보이는지 스크린샷. 공개 주소 `https://demo-api.masscom.kr/merchant-art/<sha256>.webp`가 200 `image/webp`인지, 실제 이미지 크기(바이트)와 앱 로딩 |
| 되돌리기 | "기본 그림으로 되돌리기" | 그림이 글자 도장으로 돌아오고 옛 공개 주소가 404인지 |
| 정책 차단·개인정보 | 그림에 글자·사람·상표·QR이 없는지 눈으로 확인 | 있으면 프롬프트 제약 재검토 항목으로 기록 |

## 보관 기간 정리 작업과 로그 순환 (Issue #253, D-059)

시연 스택도 운영과 같은 기간을 지킨다. **시연에는 배포 스크립트가 없어 시연 API를 새 릴리스로 교체할 때마다 소유자가 아래 절차를 손으로 한다.** 하지 않으면 시연 서버에서는 처리방침의 "서버의 정리 작업"·"DB 오류 로그" 문장이 사실이 아니다.

[`host-jobs/`](host-jobs/)의 `masscom-retention.sh`(기본값: compose 프로젝트 `masscom-showcase`, 서비스 `showcase-api`, 백업 폴더 `/opt/masscom-showcase/backups`)가 하루 한 번(`masscom-showcase-retention.timer`, 19:35 UTC=04:35 KST) 시연 API 컨테이너 안에서 `node dist/postgres/retention-command.js run`을 실행하고(`DATABASE_URL`·`PGPASSWORD`는 컨테이너에 이미 있다) 30일 지난 `*.dump`·`*.dump.*` 백업(예: `pre-<커밋>-<날짜>.dump`)만 `find -delete` 한 명령으로 지운다. 유닛은 `ProtectSystem=strict`·`ReadWritePaths=/opt/masscom-showcase/backups` 등으로 권한을 좁혔다. 30일이 지난 백업은 다음 날 정리 때 삭제되므로 30일 넘게 교체가 없으면 남는 백업이 없다.

**운영 배포보다 먼저(게시 전 관문):** 운영 배포가 게시하는 공개 개인정보처리방침·이용약관은 **시연 앱도 다룬다.** 그래서 이 커밋의 시연 배포(시연 API 교체, migration 0033 자동 적용)와 아래 1~3(정리 작업 설치·`--verify`·PostgreSQL 재생성·확인)을 **운영 배포보다 먼저, 늦어도 같은 작업 창 안에서** 끝낸다. 그러지 않으면 시연 서버에서 처리방침의 "서버 정리 작업"·"DB 오류 로그" 문장이 사실이 아닌 채로 공개된다. 또 매일 정리 작업(19:35 UTC=04:35 KST)과 배포·PostgreSQL 재생성이 겹치면 그날의 DB 정리 단계가 연결 오류로 실패해 종료 코드 1로 남을 수 있으니(다음 날 다시 돈다) 그 시각 전후 교체는 피한다.

**시연 API를 교체할 때마다(소유자, 서버에서):**

1. 정리 작업 설치·갱신(멱등): `sudo bash /opt/masscom-showcase/releases/<커밋>/infra/showcase-host/host-jobs/install.sh`(그 release에 이 폴더가 들어 있어야 한다). 끝에서 `systemctl is-enabled masscom-showcase-retention.timer`가 `enabled`가 아니면 실패한다.
2. **하드닝 검증(한 번 실제로): 이 저장소 시험은 systemd를 기동하지 못하므로 시연 호스트에서 직접 확인한다.** 먼저 `systemd-analyze verify /etc/systemd/system/masscom-showcase-retention.service /etc/systemd/system/masscom-showcase-retention.timer`가 아무것도 출력하지 않아야 한다(경고·오류가 있으면 멈춘다). 그 다음 `sudo systemctl start masscom-showcase-retention.service`로 **실제로 한 번** 돌려 `journalctl -u masscom-showcase-retention.service`에서 단계별 개수가 나오고 `systemctl show -p Result --value masscom-showcase-retention.service`가 `success`인지 본다. `ProtectSystem=strict`·`RestrictAddressFamilies=AF_UNIX`·`ReadWritePaths` 같은 제한이 docker 소켓 접근이나 백업 삭제를 막으면 여기서 처음 드러난다(미리 `report`: `docker compose … exec -T showcase-api node dist/postgres/retention-command.js report`). 운영은 배포 스크립트가 같은 첫 실행을 하지만 `systemd-analyze verify /etc/systemd/system/masscom-retention.service`는 처음 배포 뒤 한 번 직접 실행해 본다.
2-1. **확인(읽기 전용):** `sudo bash /opt/masscom-showcase/releases/<커밋>/infra/showcase-host/host-jobs/install.sh --verify`가 `last run result: success`와 `verified: masscom-showcase-retention.timer is enabled and matches this release`를 출력해야 한다. 마지막 실행이 실패했거나(`exit-code` 등) **한 번도 실행하지 않았으면**(마지막 실행 시각이 비어 있음) 실패로 끝난다: 설치만 하고 돌려 보지 않은 작업을 확인됨으로 세지 않는다.
3. **PostgreSQL 로그 설정 적용(한 번, 짧은 DB 재시작):** `compose.yml`의 `postgres`에는 `json-file` 10 MB × 3개와 `command: ["postgres", "-c", "log_error_verbosity=terse", "-c", "log_min_error_statement=panic"]`이 들어 있다. 실행 중인 컨테이너는 다시 만들어야 적용된다. 시연 DB를 백업한 뒤(교체 절차의 `pre-<커밋>-<날짜>.dump`) 시연 Compose를 기동할 때 쓴 것과 같은 `-f`·`--env-file` 인자로 `docker compose … up -d --no-deps --wait postgres`를 실행하고, 확인한다: `docker inspect --format '{{json .HostConfig.LogConfig.Config}} {{json .Config.Cmd}}' <시연 postgres 컨테이너>`에 `"max-size":"10m"`·`"max-file":"3"`·`log_error_verbosity=terse`·`log_min_error_statement=panic`이 모두 있고 `docker compose … exec -T postgres psql -U masscom_showcase -d masscom_showcase -Atc 'SHOW log_min_error_statement'`가 `panic`을 출력해야 한다. **다시 만들기 전후로 같은 데이터가 붙어 있는지도 확인한다:** 전에 `docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' <시연 postgres 컨테이너>`로 볼륨 이름을, `docker compose … exec -T postgres psql -U masscom_showcase -d masscom_showcase -Atc "SELECT count(*) || '|' || coalesce(max(filename), '') FROM schema_migrations"`로 데이터 지문을 적어 두고 다시 만든 뒤 두 값이 같아야 한다(다르면 멈추고 백업으로 복구를 검토한다, 볼륨은 지우지 않는다). 그리고 `SHOW log_error_verbosity`가 `terse`여야 한다. 이미 맞으면 다시 만들지 않는다. `showcase-api` 컨테이너의 `json-file` 설정은 시연 API를 `up -d`로 교체할 때 적용된다.

시험은 `bash tests/ops/host_retention_job_test.sh`(가짜 docker), `node --test tests/ops/compose_log_rotation_test.mjs`. 서버 설치·확인은 `NOT_RUN`이다.

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
