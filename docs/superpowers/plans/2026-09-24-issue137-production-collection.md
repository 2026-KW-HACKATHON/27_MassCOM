# Issue #137 운영 웹 본인 도감 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking. Authentication and cookie changes require an independent security review before external deployment.

**Goal:** 운영 웹에서 공개 음식점을 로그인 없이 읽고, 로그인한 사람만 자신의 실제 방문·앱 수집품·검증 완료 NFT 도감을 읽는다.

**Architecture:** 기존 `apps/production-web`의 공개 `GET /merchants`는 유지한다. `masscom.kr` 웹에서 `/api/web/*`만 기존 운영 API로 전달하는 같은 출처 프록시를 먼저 검증하고, API가 Google OIDC code callback·서버 저장 웹 session·HttpOnly cookie를 소유한다. 브라우저에는 모바일 Bearer token이나 WalletConnect 세션을 복사하지 않는다. 웹에는 QR/방문 수령·지갑 서명·발행 쓰기 경로를 만들지 않는다.

**Tech Stack:** 기존 Vercel 정적 포털, Node.js/TypeScript API, PostgreSQL, Google OIDC, 실제 Chrome·Android 브라우저.

**Spec:** [시연·운영 분리 설계](../specs/2026-09-23-showcase-production-separation-design.md), [Issue #137](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/137), [Google OIDC server flow](https://developers.google.com/identity/openid-connect/openid-connect), [Vercel 외부 rewrite](https://vercel.com/docs/routing/rewrites).

**시작 순서:** 1. Task 1에서 무료 preview의 쿠키·rewrite 실증을 마친다. 2. 성공한 경로에 한해서 Task 2~4의 서버 세션·로그인·읽기 화면을 개발한다. 3. Task 5의 외부 계정 격리·보안 리뷰·CI로 종료를 판정한다.

## 현재 기준선과 결정 게이트

- `apps/production-web/server.mjs`는 로컬에서 공개 점포만 읽고, 개인 도감은 의도적으로 닫혀 있다. 외부 운영 웹 배포·웹 Google 로그인은 `NOT_RUN`.
- 먼저 **Vercel preview에서** `/api/web/*` 외부 rewrite가 `Set-Cookie`·redirect·캐시 금지 헤더를 예상대로 전달하는지 민감 정보 없는 fixture로 검증한다. 실패하면 실제 계정 데이터를 붙이지 않고 별도 `web.masscom.kr` 서버 방식으로 설계를 재검토한다. 이 분기는 실증 결과로 결정하며 프록시가 동작한다고 추정하지 않는다.
- 무료 범위(기존 Vercel/기존 Lightsail)로 처리할 수 없으면 유료 전환 없이 `BLOCKED`로 둔다. Google Play·일반 공개 제출은 범위 밖이다.

## Global Constraints

- 개인 도감은 현재 세션 계정 ID의 `GET /collection` 결과만 사용한다. 브라우저에 장기 Bearer token·지갑 세션을 `localStorage`/URL/HTML/로그로 내보내지 않는다.
- 웹 세션 쿠키는 `HttpOnly; Secure; SameSite=Lax`, 범위가 좁은 Path를 사용한다. 개인 응답은 `Cache-Control: no-store`이고 공유 캐시·검색 색인을 거절한다.
- 세션의 계정 A/B 분리, 만료·로그아웃·계정 삭제 시 즉시 무효화, OAuth `state`·PKCE·검증된 ID token `sub`는 서버에서 처리한다.
- 웹은 음식점·도감 **읽기 전용**이다. QR/claim, 지갑 연결·서명, NFT 발행 요청·송금 경로는 만들지 않는다.
- 실제 방문 0건을 예시 기록으로 채우지 않는다. 앱 수집품과 온체인 NFT는 다른 상태로 표시한다.

## Review Focus

- 로그인 전·로그아웃 후·만료 후·다른 계정 쿠키로 `/api/web/collection`이 401이고 개인정보가 응답/캐시에 남지 않는지 Task 2/4 시험.
- OAuth callback의 잘못된 `state`·PKCE·redirect URL·중복 code가 세션을 만들지 않는지 Task 3 시험.
- Vercel rewrite가 쿠키와 `no-store`를 보존하며 `/api/web/*` 밖의 QR/claim/mint를 프록시하지 않는지 Task 1/4 시험.
- 웹 새로고침·뒤로 가기·계정 전환 때 이전 사용자 도감이 잠깐도 렌더되지 않는지 Task 4/5 브라우저 시험.
- 계정 삭제와 모바일 로그아웃이 어떤 웹 세션을 회수하는지 실제 정책에 맞게 Task 2에서 결정·시험하고 문서화한다.

---

### Task 1: 같은 출처 프록시·쿠키 전달 최소 실증

**Files:** `docs/vercel.json`, 새 `tests/site/verify_web_session_proxy_test.mjs`, `docs/TEST_STATUS.md`.

- [ ] 신규 공개 경로 없이 Vercel preview에 고정 비밀이 없는 임시 응답(redirect·`Set-Cookie`·`Cache-Control: no-store`)을 두고, Chrome에서 same-origin 응답·쿠키 범위·로그아웃 요청을 확인한다. `vercel.json`의 rewrite `source`는 `/api/web/:path*`로 제한하고 destination은 기대한 운영 HTTPS API만 허용한다.
- [ ] `verify_web_session_proxy_test.mjs`에 `/api/web/collection` 허용과 `/api/claim`, `/api/mint`, 임의 외부 host 거절을 실제 라우팅 설정으로 시험하고, 잘못된 destination fixture에서 실패를 확인한다.
- [ ] preview의 실제 쿠키/캐시 판정과 무료 사용량을 기록한다. 실패·사용량 초과면 개인 도감 코드에 실제 계정을 연결하지 않고 설계 분기로 돌아간다. preview는 운영 출시 완료가 아니다.

### Task 2: 웹 전용 서버 세션과 계정 삭제 경계

**Files:** 새 `apps/api/migrations/0011_web_sessions.sql`, 새 `apps/api/src/web-session.ts`, 새 `apps/api/src/postgres/web-session.ts`, 새 `apps/api/src/web-session.postgres.integration.ts`, `apps/api/src/postgres/account-deletion.ts`.

**Interfaces:** `createWebSession(accountId, ttl)`은 난수 토큰을 한 번 반환하고 DB에는 해시만 저장한다. `resolveWebSession(cookie)`은 유효하고 미삭제인 계정 ID만 반환한다. `revokeWebSession(cookie)`와 계정 삭제는 해당 범위의 활성 웹 세션을 무효화한다.

- [ ] 실제 `_test` PostgreSQL에서 계정 A/B 분리·토큰 해시만 저장·만료·로그아웃·계정 삭제·동시 로그아웃 시험을 먼저 작성해 실패를 확인한다.
- [ ] 단일 migration과 저장소 구현을 추가하고 기존 모바일 `auth_sessions`·계정 ID 형식을 재사용하되, 웹 쿠키 토큰과 모바일 Bearer 토큰을 혼용하지 않는다.
- [ ] `npm run test:postgres --prefix apps/api`, API 단위·typecheck·build·privacy 검사를 통과시키고 독립 보안 리뷰를 받는다.

### Task 3: Google OIDC 웹 로그인·callback

**Files:** 새 `apps/api/src/web-auth.ts`, 새 `apps/api/src/web-auth.test.ts`, `apps/api/src/server.ts`, `apps/api/src/server.test.ts`, `infra/lightsail/runtime.env.example`.

- [ ] Google Web OAuth client의 실제 redirect URI를 운영 웹 `/api/web/auth/callback`로 등록한다. client secret은 저장소 밖의 기존 운영 runtime env에만 둔다. 실행 전 Google의 최신 프로젝트 정책·redirect 규칙을 공식 문서로 다시 확인한다.
- [ ] `state`·PKCE verifier·짧은 만료·일회성 callback·redirect allowlist·ID token 서명/`iss`/`aud`/`exp`/`sub`를 시험한다. 잘못된 code/state·다른 audience가 웹 세션을 만들지 못하는 RED를 먼저 확인한다.
- [ ] 서버에서 Google code를 교환하고 검증된 `sub`를 기존 운영 계정에 연결한다. `Set-Cookie`에는 웹 세션만 담고 `HttpOnly; Secure; SameSite=Lax`를 적용한다. redirect/에러 본문·서버 로그에 code, ID token, 세션 토큰이 남지 않게 한다.
- [ ] 로그아웃은 same-origin `Origin`/CSRF 조건을 통과한 POST만 허용한다. 잘못된 Origin·GET logout·중복 callback을 403/405로 거절하는 API 시험을 통과시킨다.

### Task 4: 운영 웹 도감의 실제 읽기 전용 화면

**Files:** `apps/production-web/index.html`, `apps/production-web/assets/production.mjs`, `apps/production-web/server.mjs`, `tests/site/verify_production_web_test.mjs`, `docs/index.html`.

- [ ] 로그인 전 안내, 실제 빈 도감, 방문/앱 수집품/NFT 상태, 서버 오류·다시 시도, 로그아웃 후 빈 화면을 실제 DOM·API 응답 시험으로 먼저 정의해 실패를 확인한다.
- [ ] same-origin `/api/web/collection`에서 자신의 결과만 받아 `textContent`로 렌더한다. 기존 음식점 공개 조회는 유지하고 가상 점포를 운영 결과에서 제외한다. QR/claim·wallet/mint 쓰기 버튼·라우트는 넣지 않는다.
- [ ] 접근성 트리·키보드·390px/데스크톱·200% 글씨·라이트/다크를 실제 브라우저에서 검증한다. 빈 컬렉션을 가짜 방문으로 채우지 않는다.

### Task 5: 외부 검증·통합·되돌리기

**Files:** `docs/TEST_STATUS.md`, `docs/HANDOFF.md`, `docs/PROJECT_STATE.md`, `docs/EVALUATION_MAP.md`, `README.md`.

1. 준비된 실제 운영 HTTPS에서 Google 계정 A 로그인→본인 도감, 계정 B 로그인→A 자료 0, 로그아웃/만료/계정 삭제 뒤 개인 응답 401, 브라우저 공유 캐시·검색 색인 노출 0을 확인한다. 각 요청의 명령·커밋·환경·결과를 기록한다.
2. PR CI·독립 보안 리뷰·병합 후 main CI와 실제 Android/Web 브라우저 실기가 통과하기 전에는 개인 도감을 `VERIFIED`로 승격하지 않는다. 공개 서비스에서 실패하면 신규 웹 auth/rewrite만 되돌리고 기존 `masscom.kr` 포털·`api.masscom.kr` 모바일 경로를 확인한다.
3. [시연 전달 계획](2026-09-24-issue137-showcase-delivery.md)까지 #137 전체 수용 기준이 충족됐을 때만 이슈를 `COMPLETED`로 닫는다. 부분 통과 시 열린 상태와 `NOT_RUN/BLOCKED`를 유지한다.

**다음 행동:** Task 1의 preview rewrite·쿠키 전달 최소 실증을 비밀·실계정 데이터 없이 시작한다.
