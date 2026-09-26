# 시연 API·DB 호스트

현재 상태: 별도 Compose와 가상 점포 A/B/C seed는 **로컬 격리 환경에서 검증**했다. 2026-09-26 기존 AWS 호스트의 비용 크레딧·여유 자원·운영 건강 상태는 [읽기 전용 증거](../../docs/evidence/showcase-host-preflight-2026-09-26.json)로 확인했다. 외부 시연 DNS·HTTPS와 실제 시연 Google 로그인은 아직 확인하지 못했다. [로컬 증거](../../docs/evidence/showcase-host-local-2026-09-24.json)는 공개 배포 증거가 아니다.

## 실행 순서

1. 기존 Lightsail의 비용·크레딧, 메모리·디스크 여유, 운영 컨테이너 ID/재시작 수와 `https://api.masscom.kr/health`를 읽기 전용으로 확인한다. 여유 또는 요금이 불명확하면 원격 생성·기동을 멈춘다. 이유: 시연 스택이 운영 API를 밀어내거나 유료 자원을 만들면 안 된다. 완료 기준: 확인 시각·수치·운영 건강 상태가 `docs/evidence/`에 기록된다.
2. 저장소 밖의 접근 제한된 파일에 [`runtime.env.example`](runtime.env.example)의 값을 준비한다. `SHOWCASE_GOOGLE_WEB_CLIENT_ID`는 운영 ID와 다른 전용 Web ID, 초대/직원 해시는 **검증된 Google `sub`**의 SHA-256이다. 새 환경에서만 `scripts/prepare-showcase-runtime.sh`를 한 번 실행해 DB/HMAC 비밀을 무작위로 만들 수 있다. 기존 `runtime.env`가 있으면 이 스크립트는 덮어쓰지 않는다. 초대 해시는 검증된 로그인 근거에서 별도로 준비해야 하며 스크립트가 이메일을 해시하지 않는다. 비밀번호·해시 원문·토큰은 Git·출력에 남기지 않는다. 완료 기준: 빈 필수 값이 없고, 파일 권한은 소유자만 읽을 수 있다.
3. 운영 Web client ID를 `MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID` 환경 변수로 주고 `node scripts/verify-showcase-host.mjs --runtime-env <저장소 밖의 파일>`을 실행한다. 이는 실제 설정을 렌더해 격리 경계를 검사할 뿐 배포하지 않는다. 완료 기준: `showcase host runtime boundary verified (not deployed)`가 표시된다. 운영 ID 비교 입력이 없거나 같은 ID면 실패한다.
4. 한국어 PR의 CI·독립 보안 리뷰와 1~3단계가 통과한 뒤에만 별도 `/opt/masscom-showcase` 경로에서 시연 Compose를 기동한다. 운영 `/opt/masscom/current`, 운영 DB 볼륨과 Caddy 설정은 이 단계에서 건드리지 않는다. 완료 기준: 시연 API/DB만 healthy, API `127.0.0.1:3301`, DB는 host port 없음, 운영 health·컨테이너 ID가 전후 동일하다.
5. 시연 DB 마이그레이션 완료 후 API 컨테이너에서 `node dist/showcase/host-seed-command.js`를 실행한다. 초대된 직원이 실제 Google 로그인을 완료한 후에만 `SHOWCASE_STAFF_SUBJECT_SHA256`을 별도 설정하고 `node dist/showcase/grant-staff-command.js`로 A점포 STAFF를 부여한다. 완료 기준: A/B/C·1/3/5 목표와 초대된 계정 한 명의 권한을 읽기 전용 조회로 확인한다. 로그인 전 고정 개발 STAFF ID는 hosted DB에 넣지 않는다.

공개 `demo-api.masscom.kr` 연결·Caddy 변경·Android APK는 [외부 시연 전달 계획](../../docs/superpowers/plans/2026-09-24-issue137-showcase-delivery.md)의 후속 게이트다. 실패 시 시연 Compose만 중지하고 운영 health를 다시 확인한다. 볼륨 삭제·운영 자료 변경은 이 절차에 포함하지 않는다.

**다음 행동:** 실제 전용 초대 해시·런타임 파일을 준비하고 기존 서버의 별도 `/opt/masscom-showcase`에서만 loopback 스택을 기동한다. 운영 건강 상태·컨테이너 ID를 전후 대조하기 전에는 공개 라우팅을 추가하지 않는다.
