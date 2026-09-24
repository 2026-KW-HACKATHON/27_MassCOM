# `www.masscom.kr` 웹 경로 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Lightsail에서 `www.masscom.kr/app/` 운영 웹과 `www.masscom.kr/preview/` 정적 시연 웹을 실제 HTTPS로 제공하면서 기존 apex 로그인·Android App Link·지갑 출처를 보존한다.

**Architecture:** 현재 Caddy의 정확한 웹 호스트 목록에 `www`를 추가하고 공개 파일 allowlist에 시연 HTML/CSS 두 파일만 포함한다. API는 요청 Host를 apex/www로 명시 분류하고 OAuth state와 웹 세션 모두 발급 호스트에 바인딩한다. 코드·Google 승인 URI·서버를 검증한 뒤 `www` DNS만 Vercel CNAME에서 기존 Lightsail A로 전환한다.

**Tech Stack:** Node.js 24/TypeScript API, PostgreSQL 16, Caddy 2.10.2, Expo Android(회귀 확인만), 기존 AWS Lightsail·가비아 DNS·Google Web OAuth client.

**Spec:** [승인된 www 웹 통합 설계](../specs/2026-09-25-www-web-consolidation-design.md). 설계의 완료 기준과 롤백 순서가 이 계획의 상위 계약이다.

**Execution method:** 사용자 요청대로 이 작업의 담당 에이전트가 순서대로 구현하고, OAuth·DB·배포 경계는 병합 전 독립 보안 리뷰를 받는다. 작은 단계마다 새 PR을 만들지 않는다.

## Global Constraints

- `masscom.kr`의 `/open` Android App Link, Reown 공식 URL, 기존 웹 로그인·쿠키는 유지한다. `api.masscom.kr`의 모바일 API·SIWE는 바꾸지 않는다.
- `www.masscom.kr`는 웹 포털·`/app/`·`/preview/`에 사용한다. 두 Google callback은 정확한 `https://masscom.kr/api/web/auth/callback`과 `https://www.masscom.kr/api/web/auth/callback`만 허용한다.
- `web_auth_state`·`web_session` 쿠키에 `Domain`을 넣지 않는다. DB의 `web_oauth_states.redirect_uri`와 `web_sessions.origin_host`로 수동 복사된 타 호스트 state·세션도 거부한다.
- 정적 시연 번들에는 `apps/showcase-web/index.html`과 `assets/showcase.css`만 더한다. `.vercel`, `.env*`, 비공개 Markdown/JSON, 운영 DB와 쓰기 API는 노출하지 않는다.
- 새 유료 서버·서비스·의존성, 새 운영 키, 메인넷·Play·대회 최종 제출은 범위 밖이다. 기존 Vercel 배포는 원복 후보로 보존한다.
- 기능 코드는 Issue #137의 한 작업 브랜치·한국어 PR로 통합한다. 별도 상태 문서 PR은 실제 외부 검증 뒤 필요한 경우에만 만든다. 필수 CI·리뷰를 우회하지 않는다.

## 파일·책임 경계

| 파일 | 소유 책임 |
| --- | --- |
| `scripts/build-public-site.mjs`, `tests/site/build_public_site_test.mjs` | 공개 번들의 원본/대상 allowlist와 누출 방지 |
| `infra/lightsail/Caddyfile`, `infra/lightsail/compose.yml`, `tests/ops/verify_aws_web_routes_test.mjs`, `tests/ops/verify_web_session_proxy_test.mjs` | 두 웹 Host, 정적 `/preview/`, 정확한 웹 세션 프록시 |
| `apps/api/migrations/0016_web_session_origin.sql`, `apps/api/src/postgres/web-session.ts`, `apps/api/src/postgres/web-origin-migration.postgres.integration.ts`, `apps/api/src/web-session.postgres.integration.ts` | 기존 세션 apex 보존과 호스트별 세션 생성·조회·철회 |
| `apps/api/migrations/0017_web_oauth_redirect.sql`, `apps/api/src/web-auth.ts`, `apps/api/src/web-auth.test.ts`, `apps/api/src/web-auth.postgres.integration.ts` | Google redirect·state 호스트 바인딩과 코드 교환 |
| `apps/api/src/web-origin.ts`, `apps/api/src/server.ts`, `apps/api/src/server.test.ts`, `tests/ops/verify_web_auth_rollback_test.mjs` | 신뢰할 Host allowlist·로그아웃 Origin·지연 콜백 롤백 검사 |
| `infra/lightsail/runtime.env.example`, `infra/lightsail/README.md`, `README.md`, `docs/TEST_STATUS.md`, `docs/HANDOFF.md` | 비밀값 없는 전환·되돌리기·실증 기록 |

## Review Focus

1. `Host: api.masscom.kr` 또는 공격자 Host/X-Forwarded-Host의 웹 인증 요청은 Google로 이동하거나 쿠키를 발급하지 않는다(Task 4 HTTP 시험).
2. apex OAuth state·웹 세션 쿠키를 `www` 요청에 수동으로 복사해도 수령·조회·로그아웃 철회가 일어나지 않는다(Task 2·3 PostgreSQL 시험).
3. Google 코드 교환 중 롤백하면 늦은 콜백이 세션 0건 확인 이후 `www` 세션을 만들지 않는다(Task 4 롤백 회귀).
4. `/preview`의 slash 이동·CSS와 `/app`·`/merchants`가 각 Host에서 맞게 열리고, 비공개 문서·`/claim`·`/mint`는 404다(Task 1·4 Caddy 시험).
5. DNS/인증서 전환 중 `www`가 실패해도 apex `/open`·로그인·API health와 기존 DB 컨테이너는 유지된다(Task 5·6 실증).

---

### Task 1: 정적 시연 웹 allowlist와 `/preview/`

**Files:** Modify `scripts/build-public-site.mjs`, `tests/site/build_public_site_test.mjs`, `infra/lightsail/Caddyfile`, `tests/ops/run_aws_web_smoke.sh`.

**Interfaces:** `buildPublicSite(repoRoot, targetDirectory): Promise<string[]>`는 결과 경로에 `preview/index.html`, `preview/assets/showcase.css`를 추가하고 기존 반환값을 보존한다. Caddy는 `/preview`를 `/preview/`로 308 이동한다.

- [ ] **Step 1: 실패 시험.** `expected`에 두 preview 파일을 추가하고 원본별 byte 비교를 `apps/showcase-web/`에 연결한다. `.vercel/project.json`, `.env.local`, `HANDOFF.md` 누출 거부와 `/preview` 308·`/preview/` 200·CSS 200을 Caddy 시험에 추가한다.
- [ ] **Step 2: RED 확인.** `node --test tests/site/build_public_site_test.mjs`는 preview 파일 부재로, `bash tests/ops/run_aws_web_smoke.sh`는 실제 `/preview` 경로 부재로 각각 실패함을 기록한다.
- [ ] **Step 3: 최소 구현.** 기존 `publicFiles`의 `docs/` 아래 공개 원본 매핑을 유지하고 별도 두 source-target 쌍을 추가한다. 예: `['apps/showcase-web/index.html', 'preview/index.html']`, `['apps/showcase-web/assets/showcase.css', 'preview/assets/showcase.css']`. 모든 원본에 `lstat().isFile()`을 확인한 뒤 새 대상에만 복사한다. Caddy에 `@previewRoot path /preview`와 `redir @previewRoot /preview/ 308`을 추가하고 기존 `file_server`가 `/preview/`를 제공하게 한다.

```js
const previewFiles = [
  { source: 'apps/showcase-web/index.html', target: 'preview/index.html' },
  { source: 'apps/showcase-web/assets/showcase.css', target: 'preview/assets/showcase.css' },
];
```
- [ ] **Step 4: GREEN/안전 검사.** 위 두 Node 시험, `node scripts/verify-lightsail-web.mjs`, `bash tests/ops/run_aws_web_smoke.sh`, `node --test tests/site/verify_showcase_site_test.mjs`를 통과시킨다. 번들에서 `.vercel/`, `.env*`, 비공개 docs가 없는지 확인한다.
- [ ] **Step 5: 커밋.** 공개 정적 경로만 의미 있는 한국어 Lore 커밋으로 남긴다. DNS와 README 주 URL은 아직 바꾸지 않는다.

### Task 2: 기존 apex 세션을 보존하는 DB 호스트 바인딩

**Files:** Create `apps/api/migrations/0016_web_session_origin.sql`, `apps/api/src/web-origin.ts`, `apps/api/src/postgres/web-origin-migration.postgres.integration.ts`; modify `apps/api/src/postgres/web-session.ts`, `apps/api/src/web-session.postgres.integration.ts`, `apps/api/src/web-session.test.ts`, `apps/api/src/web-auth.ts`의 기존 apex store 호출(이번 Task의 임시 호환 경계).

**Interfaces:** `apps/api/src/web-origin.ts`가 `WebOriginHost = 'masscom.kr' | 'www.masscom.kr'`와 `WebOrigin = 'https://masscom.kr' | 'https://www.masscom.kr'`를 내보낸다. `PostgresWebSessionStore.create(accountId: string, originHost: WebOriginHost)`, `resolve(token: string, originHost: WebOriginHost)`, `revoke(token: string, originHost: WebOriginHost)`가 호스트를 조건으로 사용한다. 계정 삭제의 기존 전체 세션 회수 SQL은 호스트 제한 없이 유지한다.

- [ ] **Step 1: 실패 시험.** disposable `_test` DB의 고유 임시 schema에서 기존 `0014_web_sessions.sql`로 구형 테이블·세션을 만든 뒤 실제 `0016_web_session_origin.sql` 텍스트를 같은 client의 `search_path`에서 실행해 기존 행이 `origin_host='masscom.kr'`로 보존되는지 확인한다. 별도 통합 시험에서는 새 www 토큰의 apex 조회/철회가 실패하고 www 조회/철회만 성공하는지, 운영 계정 삭제가 양쪽 세션을 모두 철회하는지 확인한다. 임시 schema는 `finally`에서 정확한 이름만 제거한다.
- [ ] **Step 2: RED 확인.** `TEST_DATABASE_URL`이 이름 `_test`로 끝나는 분리 DB일 때 `DATABASE_URL`도 같은 loopback `_test` DB로 주어 `npm run db:migrate --prefix apps/api`를 먼저 실행한다. 그 다음 `npm run test:postgres --prefix apps/api`에서 호스트 인자/열 부재로 실패함을 확인한다. 운영 DB를 이 시험에 연결하지 않는다.
- [ ] **Step 3: additive migration·구현.** `web-origin.ts`에 위 두 literal union 타입을 선언한다. `0016_web_session_origin.sql`에서 `web_sessions`에 `origin_host text NOT NULL DEFAULT 'masscom.kr'`와 두 호스트만 허용하는 CHECK를 추가한다. `create`의 INSERT와 `resolve`의 SELECT, `revoke`의 UPDATE에 `origin_host=$n` 조건을 넣는다. `token_hash`의 기존 UNIQUE와 계정 삭제 범위는 변경하지 않는다.

```sql
ALTER TABLE web_sessions
  ADD COLUMN origin_host text NOT NULL DEFAULT 'masscom.kr'
  CHECK (origin_host IN ('masscom.kr', 'www.masscom.kr'));
```

- [ ] **Step 4: GREEN/호환 검사.** 실제 PostgreSQL 통합 시험, `npm test --prefix apps/api`, `npm run typecheck --prefix apps/api`, `npm run build --prefix apps/api`를 통과시킨다. 기존 apex 세션을 만들고 migration 후에도 조회되는 시험 결과를 기록한다.
- [ ] **Step 5: 커밋.** DB·세션 경계를 한 한국어 Lore 커밋으로 남긴다.

### Task 3: OAuth state·Google callback의 호스트 바인딩

**Files:** Create `apps/api/migrations/0017_web_oauth_redirect.sql`; modify `apps/api/src/web-auth.ts`, `apps/api/src/web-auth.test.ts`, `apps/api/src/web-auth.postgres.integration.ts`, Task 2의 `apps/api/src/postgres/web-origin-migration.postgres.integration.ts`, `infra/lightsail/runtime.env.example`.

**Interfaces:** Task 2의 `WebOrigin`을 사용해 `WebAuthService.start(origin: WebOrigin)`, `complete(code, state, cookieState, origin)`, `resolveSession(token, origin)`, `logout(token, origin)`를 제공한다. `GOOGLE_WEB_WWW_ENABLED`는 누락 시 apex만, 정확한 `true`일 때 www origin도 허용하며 다른 값은 설정 오류로 거절한다. 기존 apex callback URI·client secret을 유지한다.

- [ ] **Step 1: 실패 시험.** apex/www 시작 URL의 `redirect_uri`가 각각 정확한 Host를 쓰는지, www state를 apex 콜백에서 소비하지 못하는지, nonce/PKCE·일회성·Google 장애 매핑이 유지되는지 단위·PostgreSQL 시험을 추가한다. Task 2의 임시 schema 시험은 기존 `0015_web_oauth_states.sql`로 만든 미완료 state 행에 실제 `0017_web_oauth_redirect.sql`을 적용해 apex URI 기본값과 행 보존을 검사한다. www 플래그 누락 시 apex만 허용, 잘못된 값·`true`와 불완전한 credential tuple은 시작 전 거절한다.
- [ ] **Step 2: RED 확인.** `npm test --prefix apps/api`와 `_test` DB의 `npm run test:postgres --prefix apps/api`에서 새 origin 호출과 state 열이 실패하는 것을 확인한다.
- [ ] **Step 3: 최소 구현.** `0017_web_oauth_redirect.sql`에 `web_oauth_states.redirect_uri`를 기존 apex URI 기본값과 정확한 두 URI CHECK로 추가한다. `start`는 선택 URI를 state row와 Google authorization URL에 함께 기록한다. `complete`는 `state_hash`·`redirect_uri`·만료를 함께 조건으로 원자적 DELETE RETURNING하고, 같은 URI로 code exchange한다. 세션 생성·조회·철회에는 Task 2의 `originHost`를 전달한다. 이미 커밋한 0016 파일을 재편집하지 않는다.

```sql
ALTER TABLE web_oauth_states
  ADD COLUMN redirect_uri text NOT NULL
  DEFAULT 'https://masscom.kr/api/web/auth/callback'
  CHECK (redirect_uri IN (
    'https://masscom.kr/api/web/auth/callback',
    'https://www.masscom.kr/api/web/auth/callback'
  ));
```

- [ ] **Step 4: GREEN/보안 검사.** API 단위·PostgreSQL 통합·typecheck/build를 통과시키고 타 호스트 state 수동 재사용·기존 apex 미완료 state·잘못된 Google token/nonce를 각각 확인한다.
- [ ] **Step 5: 커밋.** OAuth 호스트 바인딩을 한 한국어 Lore 커밋으로 남긴다. 실제 Google 콘솔은 아직 변경하지 않는다.

### Task 4: HTTP Host·Origin과 Caddy 다중 호스트

**Files:** Modify Task 2의 `apps/api/src/web-origin.ts`, `apps/api/src/server.ts`, `apps/api/src/server.test.ts`, `infra/lightsail/Caddyfile`, `infra/lightsail/compose.yml`, `tests/ops/verify_web_session_proxy_test.mjs`, `tests/ops/verify_aws_web_routes_test.mjs`; create `tests/ops/verify_web_auth_rollback_test.mjs`.

**Interfaces:** `resolveWebOrigin(hostHeader: string | undefined, wwwEnabled: boolean): WebOrigin`는 정확한 apex/www Host만 반환하고 나머지에 `WebOriginError`를 던진다. `server.ts`는 이 오류를 403 `{code:'WEB_ORIGIN_FORBIDDEN'}`으로 매핑한다. www 플래그 OFF는 www의 웹 인증·도감 경로만 거절하며 apex는 계속 동작한다. Caddy의 `MASSCOM_WEB_DOMAIN`은 운영에서 정확히 `masscom.kr, www.masscom.kr`, 로컬 fixture에서는 `:8080`이다.

- [ ] **Step 1: 실패 시험.** HTTP 시험에 apex/www 로그인 시작·콜백·도감·로그아웃, `Origin: https://www.masscom.kr` 허용, 타 Host/Origin·위조 `X-Forwarded-Host` 거부, www 플래그 OFF 상태의 apex 회귀를 추가한다. Caddy fixture에 양쪽 Host의 `/app/`, `/preview/`, 웹 세션 네 경로와 비공개 404를 넣는다.
- [ ] **Step 2: RED 확인.** `npm test --prefix apps/api`, `node --test tests/ops/verify_web_session_proxy_test.mjs tests/ops/verify_aws_web_routes_test.mjs`에서 새 Host 계약이 실패하는 것을 기록한다.
- [ ] **Step 3: 최소 구현.** 네 웹 API 경로에서만 실제 `request.headers.host`를 `resolveWebOrigin`으로 분류하고 클라이언트의 `X-Forwarded-Host`는 무시한다. `start/complete/resolveSession/logout`에 선택된 origin을 넘기며 로그아웃 `Origin`은 그 origin의 정확한 문자열과 비교한다. `WebOriginError`는 기존 JSON 응답 helper로 403에 매핑한다. Caddy는 검증된 `MASSCOM_WEB_DOMAIN`의 두 주소를 같은 제한된 웹 블록으로 받고 `/preview` slash redirect를 유지한다.

```ts
export class WebOriginError extends Error {
  readonly code = 'WEB_ORIGIN_FORBIDDEN';
  constructor() { super('WEB_ORIGIN_FORBIDDEN'); }
}
export function resolveWebOrigin(host: string | undefined, wwwEnabled: boolean): WebOrigin {
  if (host === 'masscom.kr') return 'https://masscom.kr';
  if (wwwEnabled && host === 'www.masscom.kr') return 'https://www.masscom.kr';
  throw new WebOriginError();
}
```

```caddyfile
@previewRoot path /preview
redir @previewRoot /preview/ 308
```

- [ ] **Step 4: GREEN/라우팅 검사.** API 단위·PostgreSQL 통합·typecheck/build, 로컬 Caddy 프록시·정적 bundle·웹 smoke, `MASSCOM_WEB_DOMAIN='masscom.kr, www.masscom.kr'` Caddy validate를 통과시킨다. API/DB의 외부 포트 미노출을 재확인한다.
- [ ] **Step 5: 롤백 경합 회귀.** `tests/ops/verify_web_auth_rollback_test.mjs`에 지연된 Google code exchange를 보류한 콜백 fixture를 두고 www 라우트 차단→www 플래그 OFF로 새 API 재기동·이전 프로세스 종료 확인→www 세션 철회 0건→구버전 API 전환 순서를 시험한다. 늦은 콜백이 0건 확인 뒤 세션을 만들면 FAIL이다.
- [ ] **Step 6: 커밋·리뷰.** HTTP/Caddy 경계 커밋 후 독립 보안 리뷰를 받고 지적을 수정한다. 변경된 명령·환경 예시는 같은 브랜치 문서에 갱신한다.

### Task 5: 단일 코드 PR·운영 전 선행 게이트

**Files:** `docs/HANDOFF.md`, `docs/PROJECT_STATE.md`, `docs/TEST_STATUS.md`, `infra/lightsail/README.md`; 기존 코드·시험 파일 전체를 한 PR로 통합.

- [ ] **Step 1: 범위 확인.** `git diff --check`, 변경 파일 비밀 검사, 36개 ID·운영/시연 분리·기존 apex 회귀 결과를 정리한다. README의 `www` 링크는 DNS·TLS 검증 전까지 공식 링크로 바꾸지 않는다.
- [ ] **Step 2: 통합 검사.** `npm test --prefix apps/api`, `_test` DB의 `npm run test:postgres --prefix apps/api`, API typecheck/build, `node --test tests/site/build_public_site_test.mjs`, Caddy 두 호스트·웹 세션 프록시, `bash tests/ops/run_aws_web_smoke.sh`, 운영 문서·포털 검사를 실행한다.
- [ ] **Step 3: GitHub 통합.** Issue #137 수용 기준에 맞는 한국어 PR을 열고 목적·실제 테스트·화면 증거·보안/DB 영향·복구 절차를 적는다. 필수 CI와 독립 보안 리뷰가 PASS인 경우만 merge하고 병합 후 main CI도 확인한다. 소스/DB migration 없는 운영 전환을 이 단계에서 완료라 쓰지 않는다.
- [ ] **Step 4: Google 승인 URI.** 기존 MassCOM Google Web client에 `https://www.masscom.kr/api/web/auth/callback`을 추가할 때 계정·클라이언트·권한 범위를 다시 대조하고 브라우저의 보안 접근 확장 확인 경계를 따른다. 기존 apex 승인 URI·secret을 삭제/노출하지 않는다. 등록 뒤 실제 콘솔에서 두 URI를 재조회한다.

### Task 6: 기존 Lightsail·가비아 www 전환과 실기

**Files:** 운영 서버의 Git 밖 mode 600 runtime env, 기존 가비아 `www` DNS, `docs/evidence/`의 비밀값 없는 새 검증 기록. 새 유료 자원은 만들지 않는다.

- [ ] **Step 1: 최신 사전 상태.** `www` CNAME `bda696dd0b1fd89e.vercel-dns-017.com.`·TTL 600초와 Vercel `/` 200·`/app/`/`/preview/` 404, Lightsail 비용·가용 메모리·디스크·API/DB 컨테이너 ID·`api.masscom.kr/health`를 다시 측정한다. 전용 DB 백업을 서버 내부 root mode 600으로 보관하고 `pg_restore --list`가 성공해야 한다.
- [ ] **Step 2: 코드 배포.** 검증된 `main` 커밋과 기존 SSH 호스트키·비공개 env로 `bash scripts/deploy-lightsail.sh --dry-run`→`--deploy`를 실행한다. Google `www` 승인 URI 확인 후 `GOOGLE_WEB_WWW_ENABLED=true`를 비공개 런타임 env에만 설정하고, apex `/app/`·`/open`·API health 및 이전 DB 컨테이너 보존을 확인한다. 인증서 취득 전 `www` HTTPS는 PASS로 쓰지 않는다.
- [ ] **Step 3: DNS 변경.** 가비아의 정확한 `www.masscom.kr` CNAME 하나만 제거하고 기존 Lightsail static IP `43.200.56.97` A 하나로 저장한다. apex·api 레코드는 수정하지 않는다. 권한 서버와 공용 resolver의 결과, Caddy 공인 `www` 인증서 발급 로그를 확인한다.
- [ ] **Step 4: 실제 HTTPS/기기.** `curl` 표준 TLS 검증(우회 옵션 금지)으로 `www`의 `/`, `/app/`, `/preview/`, CSS, `/privacy`, `/account-deletion`, assetlinks 200 및 비공개 docs·`/claim`·`/mint` 404를 확인한다. Samsung Chrome에서 Google A/B 순차 로그인·호스트별 쿠키·로그아웃, apex의 기존 로그인·`/open` App Link, API health를 다시 검증한다. 직접 실행하지 못한 수용 기준은 `NOT_RUN`으로 적는다.
- [ ] **Step 5: 실패 복구.** `www` 실패 시 기록한 CNAME으로 DNS를 되돌린다. API downgrade가 필요하면 설계의 순서대로 www 웹 경로 차단→www 플래그 OFF로 새 API 재기동/이전 프로세스 종료→www 세션 철회 0건→구버전 API 전환을 따른다. 이전 프로세스 종료나 DB 철회 확인이 실패하면 downgrade를 중단하고 새 API에서 www를 격리한다. apex 세션·운영 DB 볼륨·Vercel 원본은 삭제하지 않는다.

### Task 7: 검증된 대표 URL·Release·인수인계

**Files:** `README.md`, `apps/showcase-web/README.md`, `apps/production-web/README.md`, `docs/index.html`, 법적 페이지의 canonical, `docs/TEST_STATUS.md`, `docs/HANDOFF.md`, `docs/PROJECT_STATE.md`, `docs/ANDROID_DOWNLOADS.md`, 기존 GitHub 웹 전용 Release 설명.

- [ ] **Step 1: 완료 근거 확인.** Task 6의 `www` 인증서·`/preview/` 정적 해시·`/app/` 실계정 세션·apex 회귀가 모두 PASS인지 검증한다. 하나라도 미완료면 공식 링크를 바꾸지 않고 BLOCKER를 남긴다.
- [ ] **Step 2: 링크 갱신.** README와 시연 웹 Release의 주 주소를 `https://www.masscom.kr/preview/`, 운영 웹 링크를 `https://www.masscom.kr/app/`로 바꾼다. 포털·법적 페이지 canonical은 `www`, Android `/open` canonical·CTA 및 Reown URL은 apex로 유지한다. 기존 Vercel URL은 장애 원복 참고에만 남긴다.
- [ ] **Step 3: 증거·문서 검사.** 실제 DNS·TLS·기기·Google client/version·명령·source commit·결과·재현법을 비밀값 없는 증거에 남긴다. `bash tests/bootstrap/verify_operations_docs_test.sh`, `bash tests/site/verify_project_site_test.sh`, `git diff --check`를 실행한다. 시연 Android APK나 실제 방문·NFT 실적을 추가하지 않는다.
- [ ] **Step 4: 문서 PR·실제 웹 반영.** 필요하면 한 개의 한국어 상태 PR로 문서·canonical 변경을 통합하고 CI·리뷰 후 merge한다. 병합 후 main CI가 PASS이면 24시간 이내의 mode 600 용량 증거와 기존 SSH/런타임 env로 `bash scripts/deploy-lightsail-web.sh --dry-run`→`--deploy`를 실행해 포털·법적 페이지의 새 canonical을 실제 Lightsail에 반영한다. 외부 www/apex 경로·API health와 이전 DB/API 컨테이너 ID를 재확인하고 Issue #137은 남은 시연 앱·기록 있는 도감 검증 때문에 OPEN 유지한다.
