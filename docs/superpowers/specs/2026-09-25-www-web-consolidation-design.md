# `www.masscom.kr` 웹 경로 통합 설계

상태: **사용자 서면 설계 승인·독립 설계 검토 CLEAR**. 2026-09-25 사용자가 `www.masscom.kr/app`·`www.masscom.kr/preview` 방향과 기존 apex 호환 유지 권장안에 동의한 뒤 서면 설계도 승인했다. 독립 검토에서 발견한 세션 호스트 바인딩·지연 콜백 롤백 경계를 반영해 차단 지적이 해소됐다. 이는 구현·DNS 변경·Google 콜백 등록의 완료 근거가 아니다. 관련 [Issue #137](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/137), [현재 상태](../../PROJECT_STATE.md), [실제 시험](../../TEST_STATUS.md)을 먼저 확인한다.

## 목적과 경계

하나의 웹 호스트 `www.masscom.kr`에서 프로젝트 포털(`/`), 운영용 읽기 전용 도감(`/app/`), 가상 데이터임이 명확한 정적 시연 웹(`/preview/`)을 제공한다. 시연 웹의 주 안내 주소를 기존 Vercel 주소에서 `https://www.masscom.kr/preview/`로 바꾼다. 기존 `https://masscom.kr`은 Android App Link `/open`, Reown에 표시되는 공식 지갑 출처, 기존 웹 로그인과 오래된 링크의 호환 경로로 유지한다. `api.masscom.kr`의 모바일 API·SIWE, `demo-api.masscom.kr`의 미완료 시연 API, 체인·키·Play 배포는 변경하지 않는다.

| URL | 전환 후 역할 | 데이터·인증 |
| --- | --- | --- |
| `https://www.masscom.kr/` | 프로젝트 포털 | 공개 정적 파일만 |
| `https://www.masscom.kr/app/` | 운영 음식점 목록·본인 도감 | 기존 운영 API, 같은 호스트의 Google 웹 세션 |
| `https://www.masscom.kr/preview/` | 시연용 가상 점포 A·B·C와 예시 도감 | 읽기 전용 정적 HTML/CSS, 운영 DB와 무관 |
| `https://masscom.kr/`·`/app/`·`/open` | 기존 링크·지갑·앱 링크 호환 | 기존 동작 유지, 새 `www` 세션과 쿠키 공유하지 않음 |
| `https://api.masscom.kr/` | 운영 Android API·SIWE | 변경 없음; 웹 인증 요청의 `Host`로는 허용하지 않음 |

`/preview`는 `/preview/`로만 308 이동한다. 루트 포털의 Android 앱 열기 링크는 계속 `https://masscom.kr/open`을 사용한다. 정적 시연 웹은 QR 촬영·방문 수령·지갑 연결·NFT 발행 요청이나 실제 방문·NFT 실적을 제공하지 않는다. 기존 `https://masscom-showcase-web.vercel.app/` 배포는 전환 안정화 기간에 원복 후보로 보존하되 README·시연 웹 릴리스의 주 링크에서는 내린다. Vercel 프로젝트 삭제는 이 작업 범위가 아니다.

## 검토한 선택지

1. **채택: 기존 Lightsail Caddy에 `www`를 추가하고 `/preview/`만 공개 allowlist에 복사한다.** 새 유료 서버 없이 같은 출처의 `/app/` 로그인과 시연 웹 링크를 제공한다. 인증 호스트 추가와 DNS 전환을 각각 검증해야 한다.
2. `www/preview`만 AWS로 옮기고 `www/app`은 apex로 리디렉션한다. 변경량은 작지만 로그인 후 주소가 `masscom.kr`로 돌아가 사용자가 요청한 `www/app` 동작을 충족하지 못한다.
3. `www`의 Vercel rewrite/proxy로 두 경로를 합친다. 기존 Vercel 의존성을 계속 유지해 사용자 요청의 AWS 단일 웹 호스트 방향과 맞지 않는다.

## 정적 웹·라우팅

`scripts/build-public-site.mjs`는 기존 14개 공개 파일 외에 `apps/showcase-web/index.html`과 `assets/showcase.css` **두 파일만** `site/public/preview/`에 복사한다. `.vercel/`, `.env*`, 저장소 Markdown, API/DB 자료는 복사하지 않는다. 현재 시연 HTML의 상대 CSS 경로는 `/preview/`의 trailing slash를 기준으로 유지된다. Caddy는 기존 `/api/web/{auth/start,auth/callback,logout,collection}` 네 경로와 `/app/*`, `/merchants`, 법적 페이지, assetlinks의 허용 경계를 보존한다. `MASSCOM_WEB_DOMAIN`은 로컬 fixture에서는 기존 `:8080`, 운영에서만 정확히 `masscom.kr, www.masscom.kr` 두 주소로 지정한다. wildcard 호스트나 임의 `/api/*` 웹 프록시는 허용하지 않는다. [Caddy의 다중 사이트 주소·환경변수 규칙](https://caddyserver.com/docs/caddyfile/concepts)을 따른다.

## Google 웹 로그인과 쿠키

기존 Google Web client에 `https://www.masscom.kr/api/web/auth/callback`을 추가 승인 URI로 등록한다. 기존 `https://masscom.kr/api/web/auth/callback`은 삭제하지 않는다. Google은 요청의 redirect URI가 승인 URI와 일치해야 하므로 단순 DNS 변경만으로 로그인 완료를 주장하지 않는다([공식 문서](https://developers.google.com/identity/protocols/oauth2/web-server)). 클라이언트 비밀값은 교체하거나 Git에 넣지 않는다.

API는 Caddy가 전달한 실제 `Host`를 **정확히** `masscom.kr` 또는 `www.masscom.kr`와 대조해 origin과 callback을 고른다. `api.masscom.kr`, 임의 포트/호스트, 클라이언트 제공 `X-Forwarded-Host`를 웹 로그인 origin으로 신뢰하지 않는다. `www` 경로는 명시적인 비밀값 없는 런타임 플래그로, Google 승인 URI 등록을 확인한 뒤에만 활성화한다. 기존 apex 시작·콜백·로그아웃은 플래그와 관계없이 유지한다. 로그아웃 `Origin`은 선택된 호스트의 정확한 HTTPS origin이어야 한다.

OAuth `state`를 저장하는 PostgreSQL 행에 선택한 **정확한 redirect URI**를 바인딩한다. additive migration은 기존 만료 대기 행을 apex URI로 해석하므로 배포 중 5분 이내의 기존 로그인도 안전하게 끝나거나 만료된다. 콜백은 `state`·호스트·등록된 redirect URI가 일치할 때만 일회성으로 소비하고, Google 코드 교환에도 같은 URI를 사용한다. nonce·PKCE·검증된 ID token `sub`·기존 계정 조회와 세션 해시 저장은 유지한다.

`web_auth_state`와 `web_session` 쿠키는 `Domain` 속성을 추가하지 않는다. apex·`www` 브라우저는 각각 독립적인 호스트 전용 쿠키와 로그인 상태를 갖고, 운영 DB의 계정 권한만 공유한다. 브라우저의 자동 쿠키 전송 경계뿐 아니라 수동 복사된 토큰도 거부하도록 `web_sessions.origin_host`를 `masscom.kr`·`www.masscom.kr` 중 정확한 발급 호스트로 저장하고 세션 생성·조회·개별 로그아웃을 같은 요청 호스트에 묶는다. additive migration은 기존 세션을 apex 발급으로 해석해 기존 휴대전화 로그인 상태를 유지한다. 잘못된 호스트의 로그아웃은 해당 토큰을 철회하지 않아야 하며, 계정 삭제는 발급 호스트와 관계없이 해당 계정의 모든 웹 세션을 회수한다. 시연 웹 `/preview/`에는 계정 쿠키를 요구하지 않으며, 도감·로그인 API를 호출하는 스크립트도 싣지 않는다. [호스트 전용 쿠키 규칙](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)을 따른다. 개인 도감 응답의 `no-store`를 유지한다.

## 전환·검증·복구 순서

1. **기준선 보존:** 가비아 `www` CNAME `bda696dd0b1fd89e.vercel-dns-017.com.`·TTL 600초, Vercel의 기존 `/` 200과 `/app/`·`/preview/` 404, Lightsail API/DB 컨테이너 ID·health·비용/용량을 기록한다. `masscom.kr` DNS는 바꾸지 않는다.
2. **코드 PR:** 정적 allowlist·Caddy 다중 호스트·API의 명시적 호스트 선택·state/세션 호스트 바인딩을 테스트 먼저 구현한다. 실제 PostgreSQL migration에서 기존 apex state·세션을 보존하고, 로컬 Caddy 두 호스트, 수동 복사한 타 호스트 쿠키 거부, OAuth 거절/재시도/로그아웃·계정 삭제, 기존 apex 회귀를 검사한다. 롤백 시험에서는 느린 Google 코드 교환 콜백을 보류한 채 `www` 차단·API 재기동·세션 철회를 수행해 철회 확인 뒤 새 `www` 세션이 생기지 않는지 증명한다. 독립 보안 리뷰 및 CI를 통과시키며 여기서는 공개 DNS를 바꾸지 않는다.
3. **외부 인증 선행:** 소유자가 승인한 Google Web client의 `www` 콜백 등록을 실제 콘솔에서 확인한다. 새 credential 생성이나 secret 노출 없이 런타임 플래그를 켠다. 필요한 브라우저 보안 권한 확장은 실행 시점에 별도로 확인한다.
4. **서버 staging 후 DNS:** 검증된 커밋을 기존 Lightsail에 배포하고 apex `/app/`·`/open`·API health와 기존 DB ID를 확인한다. `www` DNS를 기존 CNAME에서 `43.200.56.97` A로 바꾸는 저장 동작 한 번에 적용한다. 새 과금 자원은 만들지 않는다. Caddy의 `www` 공인 인증서 취득 뒤 표준 TLS 검증으로 `/`, `/app/`, `/preview/`, CSS, Google 로그인·쿠키·로그아웃을 검사한다. 인증서 미발급 동안 성공으로 표시하지 않는다.
5. **실기·안정화:** Samsung Android Chrome에서 기존 두 계정의 `www/app` 순차 로그인·로그아웃, 익명 도감 401, 공개 점포 0건과 시연 웹의 상시 가상 고지를 확인한다. apex `/open` Android 링크·지갑 출처·기존 웹 로그인과 `api.masscom.kr/health`를 재검증한다. 비어 있지 않은 두 계정의 개인 기록 격리는 데이터가 없으면 `NOT_RUN`이다. 통과 후 README·GitHub 웹 전용 Release의 주 링크를 `www/preview/`로 바꾸고, 프로젝트 포털·법적 페이지의 canonical 주소도 `www`로 맞춘다. Android `/open`의 canonical·링크는 apex로 유지하고 현재 증거를 기록한다.

실패하면 우선 `www`만 저장한 CNAME으로 되돌리고 TTL 전파를 기다린다. 기존 apex 웹·API·DB와 Vercel 원본 배포는 유지한다. 새 `origin_host` 열을 무시하는 구버전 API 이미지는 **활성 `www` 세션을 apex에서 수동 재사용할 수 있으므로 즉시 복귀 대상이 아니다**. API 이미지까지 내려야 한다면 (1) Caddy에서 `www` 웹 인증·도감 경로를 차단하고, (2) 새 API의 `www` 활성 플래그를 끈 채 컨테이너를 재기동해 **이전 컨테이너가 종료됐고 진행 중이던 콜백이 더 이상 세션을 만들 수 없음**을 확인한다. 새 API의 apex health와 `www` 인증 거부도 확인한다. (3) 그 뒤에만 짧은 DB 트랜잭션으로 활성 `www` 세션을 철회하고 0건을 확인하고, (4) 구버전 API로 전환한다. 이 과정에서 `www` 사용자 로그아웃은 불가피하므로 장애 기록에 남긴다. 이전 프로세스 종료·콜백 배출 또는 DB의 0건을 확인할 수 없으면 구버전 API로 내리지 않고 새 API를 유지한 채 `www`만 격리하거나 최대 24시간 세션 만료 후 재판정한다. additive DB 열은 삭제하지 않으며 apex 세션과 운영 DB 볼륨, 기존 Google 승인 URI, 키, Vercel 프로젝트도 자동 삭제하지 않는다. DNS·공개 인증·사용자 세션이 확인되기 전에는 새 www 링크를 공식 완료 주소로 표기하지 않는다.

## 완료 기준과 제외

- `www.masscom.kr/preview/`가 공개 HTTPS 200이며 HTML·CSS가 허용된 정적 원본과 같고 가상 데이터 고지를 유지한다. 비공개 문서·환경 파일과 `/claim`·`/mint`는 웹에서 404다.
- `www.masscom.kr/app/`의 공개 점포와 실제 Google 로그인·본인 빈 도감·새로고침·로그아웃이 동작하고, 알 수 없는 Host/Origin·다른 호스트의 state·쿠키 재사용은 거부된다.
- `masscom.kr` 기존 웹 로그인·`/open` App Link, `api.masscom.kr/health`가 회귀하지 않는다. GitHub PR 및 병합 후 main CI가 통과한다.
- 두 도메인에서 다른 호스트의 쿠키가 전송되지 않는지 실제 브라우저로 확인한다. 비어 있지 않은 계정 간 도감 격리·시연 Android APK/전용 API·지갑/NFT·Play 제출은 별도 Issue 기준이며 이 도메인 전환만으로 완료 처리하지 않는다.
