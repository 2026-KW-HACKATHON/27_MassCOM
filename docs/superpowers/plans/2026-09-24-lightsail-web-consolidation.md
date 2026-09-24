# Lightsail 포털·운영 웹 통합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Each checkbox is a task checkpoint; passing local tests is not external HTTPS acceptance.

**Goal:** 기존 Lightsail 한 대에서 `masscom.kr` 포털과 `/app/` 읽기 전용 운영 웹을 제공하되 API·DB를 재배포하지 않고 현재 공개 주소를 안전하게 이관한다.

**Architecture:** 공개 파일 allowlist 번들을 Caddy에 읽기 전용으로 mount하고 production-web Node 서버를 내부 서비스로 둔다. 새 웹 전용 release는 기존 API 이미지 태그를 보존하며 Caddy·웹만 재생성한다. apex DNS는 호스트 용량·비용·TLS·rollback 검증 전까지 Vercel을 유지한다.

**Tech Stack:** Node.js 24, Docker Compose, Caddy 2.10.2, 기존 Lightsail·가비아 DNS.

**Spec:** [Lightsail 웹 통합 설계](../specs/2026-09-24-lightsail-web-consolidation-design.md), [Issue #137](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/137).

## Global Constraints

- 운영 `api.masscom.kr`·PostgreSQL·운영 API 이미지와 `/opt/masscom/DEPLOYED_COMMIT`은 웹 전용 배포에서 변경하지 않는다.
- 새 유료 자원·새 DNS zone은 만들지 않는다. 현재 2GB 인스턴스의 메모리·디스크·전송량/요금 확인 전에는 원격 기동을 중지한다.
- `docs/` 전체를 공개하지 않고 명시된 HTML·CSS·아이콘·화면 이미지·assetlinks만 번들에 포함한다.
- `/merchants`는 기존 웹 서버가 `demo:false` 행만 공개 필드로 축소한다. 개인 도감은 로그인 전까지 닫는다.
- DNS·공인 HTTPS·Android App Link는 실제 외부·휴대전화 시험 전 `NOT_RUN`이다.

## Review Focus

- `docs/HANDOFF.md`·환경 파일·JSON 증거를 URL로 요청하면 404여야 한다.
- `/app/assets/production.mjs`가 루트 포털 자산과 섞이지 않고 200이어야 한다.
- `/merchants`는 가상 행과 개인 필드를 제거하고, `/claim`·`/mint`는 웹 route가 되지 않아야 한다.
- Caddy 교체 중 API/DB 컨테이너 ID·재시작 수가 변하지 않아야 한다.
- apex DNS 전후 `/open`과 assetlinks의 내용·MIME·verified App Link가 유지돼야 한다.

---

### Task 1: 공개 파일 allowlist 번들

**Files:** 새 `scripts/build-public-site.mjs`, 새 `tests/site/build_public_site_test.mjs`, `docs/presentation.html`.

**Interface:** `buildPublicSite(repoRoot, targetDirectory)`는 대상 경로가 없을 때만 정해진 공개 파일을 복사하고, 복사 목록을 반환한다. 다른 `docs/` 파일은 복사하지 않는다.

- [ ] 빠진 공개 자산, 비공개 Markdown·JSON 누출, 대상 경로 덮어쓰기를 거절하는 시험을 먼저 작성하고 실패를 확인한다.
- [ ] 허용 파일만 새 대상에 복사한다. `presentation.html`의 테스트 원장 링크는 private GitHub로 바꿔 파일 서버의 비공개 Markdown에 의존하지 않는다.
- [ ] `node --test tests/site/build_public_site_test.mjs`, 기존 프로젝트 포털·발표 회귀를 실행한다. 번들 manifest와 source SHA를 증거에 기록한다.

### Task 2: 내부 웹 서비스와 Caddy 경로

**Files:** 새 `infra/lightsail/production-web.Dockerfile`, `infra/lightsail/compose.yml`, `infra/lightsail/Caddyfile`, `apps/production-web/server.mjs`, 새 `tests/ops/verify_aws_web_routes_test.mjs`.

**Interface:** Caddy는 `masscom.kr`의 allowlist 정적 root와 `/app/*` prefix-stripped 웹 프록시, 정확한 `/merchants` 프록시를 제공한다. production-web은 컨테이너일 때만 `0.0.0.0:4173`에서 대기하고 host port를 publish하지 않는다.

- [ ] API 블록 변경·DB/API 외부 포트·웹 비밀 env·임의 write proxy가 들어가면 실패하는 config/route 회귀를 먼저 작성한다.
- [ ] 로컬 Docker에서 Caddyfile 구문 검사와 `Host: masscom.kr` 경로 시험을 실행한다. `/`, 법적 페이지, `/open`, assetlinks, `/app/`·자산, `/merchants`, 비공개 파일 404를 확인한다.
- [ ] `npm` 웹 서버 회귀, Compose 경계, 실제 Caddy 라우트 테스트를 통과시키고 DB/API 컨테이너를 기동하지 않았음을 기록한다.

### Task 3: 웹 전용 배포·되돌리기

**Files:** 새 `scripts/deploy-lightsail-web.sh`, 새 `tests/ops/deploy_lightsail_web_test.sh`, `infra/lightsail/README.md` 또는 해당 운영 문서.

- [ ] dry-run에서 비용·용량·SSH 접속·운영 API 이미지 태그/컨테이너 상태·기존 release 확인이 빠지면 실패하도록 스크립트 회귀를 먼저 쓴다.
- [ ] 새 웹 release만 업로드하고 Caddy·production-web만 `--no-deps`로 교체한다. `admin off`를 우회해 `reload`하지 않는다. 실패 시 이전 웹 Caddy와 이미지로 복구하고 운영 API health·ID를 확인한다.
- [ ] 운영 로그인/SSH가 없어도 로컬 dry-run과 시험을 통과시킨다. 실제 배포는 현재 요금·여유 자원과 대상 확인 뒤 실행한다.

### Task 4: 외부 cutover·실기

**Files:** `docs/TEST_STATUS.md`, `docs/HANDOFF.md`, `docs/PROJECT_STATE.md`, `README.md`, 새 `docs/evidence/` 결과.

1. 기존 DNS A/AAAA/CNAME·TTL·CAA, Vercel rollback 주소와 운영 health를 기록한다. Lightsail 메모리·디스크·요금·크레딧을 읽기 전용으로 확인한다.
2. 웹 release의 로컬/원격 health가 통과한 뒤 apex DNS를 현재 확인한 static IP로 전환한다. 인증서 발급·리디렉션 중단 가능성을 실시간으로 감시한다.
3. 두 외부 네트워크와 Android에서 모든 공개 경로·`/app/`·assetlinks·로그인된 운영 앱 복귀를 확인한다. 실패하면 Caddy 이전 release 또는 DNS Vercel 경로로 되돌리고 재현 자료를 남긴다.
4. 실제 외부 배포와 [운영 웹 본인 도감 계획](2026-09-24-issue137-production-collection.md)이 각각 완료되기 전에는 #137을 닫지 않는다.

**다음 행동:** Task 1의 공개 파일 누출을 막는 실패 시험부터 실행한다.
