# Issue #137 로컬 시연 API·DB 격리 실행 계획

목적: 기존 운영 Compose·도메인·DB를 수정하지 않고, 별도 로컬 Docker 프로젝트에서 가상 점포 조회와 인증 차단을 검증한다. 이 작업은 공개 시연 API나 앱 로그인을 완성하지 않는다.

1. `infra/showcase-local/compose.yml`에 별도 프로젝트 이름·볼륨/네트워크와 PostgreSQL·migration·API만 둔다. 공개 바인딩은 호스트 loopback의 API 3301, DB 55434만 허용한다. Google audience·개발 DEMO 인증·Caddy 신뢰는 모두 비활성화한다. 기존 API 이미지/Dockerfile을 재사용하고 운영 Compose를 override하지 않는다.
2. 렌더된 Compose에 대한 허용 목록 검사를 먼저 실패시키고, 검증기를 구현한다. 운영 DB 이름/프로젝트/볼륨 재사용, 외부 포트, Google/DEMO 인증, Worker/Caddy/외부 네트워크가 들어가면 CI가 실패해야 한다.
3. 로컬 컨테이너에서 migration 뒤 기존 loopback 전용 seed를 두 번 실행한다. `/merchants`의 가상 점포 1곳과 `/collection`·`/auth/google`의 인증 거절, 재기동 후 데이터 유지, 운영 DB 미접촉을 확인한다. `down -v`는 실행하지 않는다.
4. 사용법·검증 수치·`NOT_RUN` 경계를 README/HANDOFF/TEST_STATUS에 기록하고 한글 PR·CI·리뷰 후 병합한다. DNS·외부 배포·시연 OAuth/Reown·실제 QR/NFT는 별도 결정과 실증 전까지 미완료다.

테스트 전제: Docker Compose, 로컬 3301/55434 포트 가용, 기존 `apps/api` 의존성. 포트 충돌 시 기존 서비스를 멈추지 않고 BLOCKED로 남긴다. 테스트용 DB는 정확히 `masscom_showcase_test`이고 운영 자료를 seed하지 않는다.
