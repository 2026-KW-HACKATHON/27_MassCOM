# 시연 API·DB 호스트

현재 상태: 별도 Compose와 가상 점포 A/B/C seed는 로컬 격리 시험 뒤 기존 AWS 호스트의 별도 `/opt/masscom-showcase`에서 **loopback 전용으로 기동·검증**했다([내부 증거](../../docs/evidence/showcase-internal-2026-09-27.json)). 기존 호스트 크레딧·용량과 운영 건강 상태는 [선행 확인](../../docs/evidence/showcase-host-preflight-2026-09-26.json)을 따릅니다. 외부 DNS·HTTPS와 실제 시연 Google 로그인은 아직 `NOT_RUN`입니다.

## 실행 순서

1. 기존 Lightsail의 비용·크레딧, 메모리·디스크 여유, 운영 컨테이너 ID/재시작 수와 `https://api.masscom.kr/health`를 읽기 전용으로 확인한다. 여유 또는 요금이 불명확하면 원격 생성·기동을 멈춘다. 이유: 시연 스택이 운영 API를 밀어내거나 유료 자원을 만들면 안 된다. 완료 기준: 확인 시각·수치·운영 건강 상태가 `docs/evidence/`에 기록된다.
2. 저장소 밖의 접근 제한된 파일에 [`runtime.env.example`](runtime.env.example)의 값을 준비한다. `SHOWCASE_GOOGLE_WEB_CLIENT_ID`는 운영 ID와 다른 전용 Web ID, 초대/직원 해시는 **검증된 Google `sub`**의 SHA-256이다. 새 환경에서만 `scripts/prepare-showcase-runtime.sh`를 한 번 실행해 DB/HMAC 비밀을 무작위로 만들 수 있다. 기존 `runtime.env`가 있으면 이 스크립트는 덮어쓰지 않는다. 초대 해시는 검증된 로그인 근거에서 별도로 준비해야 하며 스크립트가 이메일을 해시하지 않는다. 비밀번호·해시 원문·토큰은 Git·출력에 남기지 않는다. 완료 기준: 빈 필수 값이 없고, 파일 권한은 소유자만 읽을 수 있다.
3. 운영 Web client ID를 `MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID` 환경 변수로 주고 `node scripts/verify-showcase-host.mjs --runtime-env <저장소 밖의 파일>`을 실행한다. 이는 실제 설정을 렌더해 격리 경계를 검사할 뿐 배포하지 않는다. 완료 기준: `showcase host runtime boundary verified (not deployed)`가 표시된다. 운영 ID 비교 입력이 없거나 같은 ID면 실패한다.
4. 한국어 PR의 CI·독립 보안 리뷰와 1~3단계가 통과한 뒤에만 별도 `/opt/masscom-showcase` 경로에서 시연 Compose를 기동한다. 운영 `/opt/masscom/current`, 운영 DB 볼륨과 Caddy 설정은 이 단계에서 건드리지 않는다. 완료 기준: 시연 API/DB만 healthy, API `127.0.0.1:3301`, DB는 host port 없음, 운영 health·컨테이너 ID가 전후 동일하다.
5. 시연 DB 마이그레이션 완료 후 API 컨테이너에서 `node dist/showcase/host-seed-command.js`를 실행한다. 초대된 직원이 실제 Google 로그인을 완료한 후에만 `SHOWCASE_STAFF_SUBJECT_SHA256`을 별도 설정하고 `node dist/showcase/grant-staff-command.js`로 A점포 STAFF를 부여한다. 완료 기준: A/B/C·1/3/5 목표와 초대된 계정 한 명의 권한을 읽기 전용 조회로 확인한다. 로그인 전 고정 개발 STAFF ID는 hosted DB에 넣지 않는다.

공개 `demo-api.masscom.kr` 연결·Caddy 변경·Android APK는 [외부 시연 전달 계획](../../docs/superpowers/plans/2026-09-24-issue137-showcase-delivery.md)의 후속 게이트다. 실패 시 시연 Compose만 중지하고 운영 health를 다시 확인한다. 볼륨 삭제·운영 자료 변경은 이 절차에 포함하지 않는다.

**다음 행동:** 두 계정의 내부 로그인 200/200, 비초대 유효 토큰 403, 가상 A점포 STAFF 1계정과 고객 발급→수령→도감·재수령 효과 1회는 [내부 실증](../../docs/evidence/showcase-internal-auth-claim-2026-09-27.json)했습니다. 운영 audience의 실제 교차 거절·기록 있는 두 고객 계정 분리, Caddy edge·DNS·TLS·되돌리기 시험 전에는 공개 라우팅을 추가하지 않습니다. 운영 컨테이너 ID·건강 상태는 내부 기동 전후 동일했습니다.

## 공개 edge 연결 게이트 — 아직 실행하지 않음

`masscom_showcase_edge`는 시연 API와 운영 Caddy만 함께 연결하는 외부 Docker bridge 네트워크입니다. 시연 PostgreSQL·migrate와 운영 API·DB·웹은 이 네트워크에 넣지 않습니다. [Docker Compose 외부 네트워크 안내](https://docs.docker.com/compose/how-tos/networking/)와 `scripts/verify-showcase-host.mjs`·`scripts/verify-lightsail-web.mjs`·`scripts/verify-showcase-edge-routes.mjs`의 변조 시험을 따릅니다. 현재 서버에는 이 edge 네트워크가 없고 Caddy도 시연 API를 프록시하지 않습니다.

실제 초대 계정 로그인 200, 비초대 유효 토큰 403·쓰기 0, 운영 audience 401, STAFF 발급 권한과 계정별 도감 격리를 내부/터널에서 확인한 뒤에만 다음 단계로 갑니다. 그때 가비아 `demo-api.masscom.kr` A와 공인 TLS, edge 네트워크의 정확한 구성원을 확인하고 Caddy의 **현재 운영 파일·마운트**를 백업합니다. 새 Compose/Caddy 구문·별도 proxy/IP 헤더를 검증한 후 Caddy만 짧게 재생성하고 `api.masscom.kr`·운영 웹·시연 health/401/403·보안 헤더를 검사합니다. 실패하면 이전 Caddy release로 되돌린 뒤 운영 API/DB ID·건강 상태를 다시 확인합니다. [`deploy-lightsail-web.sh`](../../scripts/deploy-lightsail-web.sh)는 edge 네트워크가 없으면 운영 웹 변경 전에 실패하고, 로컬 probe에서는 시연 호스트를 비공개 `:8082`로 치환합니다. 이 문단은 절차이며 공개 배포 완료 증거가 아닙니다.
