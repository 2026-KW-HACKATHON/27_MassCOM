# 프로젝트 상태

마지막 갱신 시각: 2026-09-27 KST

## 최신 작업 경계

- **최신 판정:** [PR #175](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/175) merge `036f31f`·PR/main CI PASS 뒤 기존 Lightsail의 별도 시연 API/DB와 운영 Caddy만 내부 edge에 연결했다. [공개 HTTPS 실측](evidence/showcase-public-edge-2026-09-27.json)에서 `demo-api.masscom.kr` TLS·health 200·가상 점포 3곳·익명 도감 401, 운영 API/웹 200·운영 점포 0곳, 운영 API/DB/웹 컨테이너 보존을 확인했다. Samsung ADB·전용 키·Google client는 준비됐지만 Keychain 비밀번호 접근의 OS 승인 대기로 서명 APK·기기 설치·카메라 QR·GitHub Release는 `BLOCKED/NOT_RUN`. Issue #137은 계속 OPEN이다.

### 아래 세 항목은 공개 전 단계의 당시 기록

- `demo-api.masscom.kr` A가 권한·외부 DNS에서 기존 Lightsail IP로 확인됐고, 운영 Google Web client의 실제 ID 토큰은 시연 API에서 `401 ID_TOKEN_AUDIENCE_MISMATCH`로 거절돼 identity/session 쓰기 0이었다. 시험용 `localhost:4176` 운영 OAuth 원본은 제거·재조회했다([DNS·교차 인증 증거](evidence/showcase-dns-audience-2026-09-27.json)). **DNS A 등록만 완료**이며 운영 Caddy·공인 TLS·시연 APK는 미적용/`NOT_RUN`. 공개 라우팅은 별도 사용자 확인과 PR #175 병합·Caddy-only 롤백 시험 전까지 보류한다.

- Issue #137 내부 실계정·가상 흐름은 전용 Web OAuth 두 계정의 API 로그인 200/200, 비초대 유효 토큰 403·추가 DB 쓰기 0, 가상 A점포 STAFF 권한 1계정만 허용을 [실측](evidence/showcase-internal-auth-claim-2026-09-27.json)했다. 가상 코드 발급→미리보기→수령→재수령은 201/200/200/200(`replayed=true`), 시연 DB claim slot/방문/보상권 1/1/1·mint 0, 고객 도감 1/1·STAFF 0/0이며 시험 세션은 모두 철회했다. 이는 내부 SSH 터널을 통한 API 시험이지 실제 Android QR·외부 HTTPS·NFT 발행이 아니다. 운영 audience 유효 토큰의 실제 교차 거절과 기록 있는 두 고객 계정 격리는 아직 `NOT_RUN`. 현재 [PR #175](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/175)의 전용 edge/Caddy는 독립 리뷰 지적을 수정하고 CI PASS했지만 아직 병합·운영 Caddy 적용 전이다.

- Issue #137: [PR #174](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/174) merge `7dba450`·PR/main CI PASS 이후 기존 Lightsail의 별도 `/opt/masscom-showcase`에서 시연 API·DB를 loopback 전용으로 기동했다. 가상 점포·캠페인·목표 `3/3/9`, 시연 방문/계정/세션 0, 운영 DB 가상 점포 0, 운영 컨테이너 ID·재시작 횟수 불변과 운영 HTTPS 200을 [내부 증거](evidence/showcase-internal-2026-09-27.json)로 확인했다. 현재 `feat/137-showcase-edge`는 공개 라우팅용 전용 네트워크·Caddy 변경을 로컬에서 시험 중이며 실제 서버 Caddy/DNS는 미변경이다. 전용 키·Google Web/Android client·OAuth 테스트 사용자 2명·Samsung ADB와 APK `--check`는 준비됐지만 실제 초대 로그인·외부 HTTPS·서명 APK/Release/실기는 `BLOCKED/NOT_RUN`([B-018](BLOCKERS.md), [시험](TEST_STATUS.md)).

- D-034 `www.masscom.kr/app/`·`/preview/` [설계](superpowers/specs/2026-09-25-www-web-consolidation-design.md)·[계획](superpowers/plans/2026-09-25-www-web-consolidation.md)은 사용자 승인됐고 [PR #169](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/169) merge `3c59ac0` 및 PR/main CI PASS다. 정적 preview allowlist, host-bound OAuth state·웹 세션, 정확한 Host·Origin 검사는 [로컬 검증](evidence/www-web-local-2026-09-25.json) 후 기존 Lightsail에 배포됐다. 운영 DB 0016·0017 적용·기존 DB 컨테이너 보존·백업, Google `www` 승인 URI와 가비아 DNS A 전환, 공인 www TLS·정적 시연 원본 일치·Samsung Chrome의 www 한 계정 로그인/재열기/로그아웃 및 apex 세션 보존은 [전환 증거](evidence/www-web-cutover-2026-09-25.json)에 기록했다. www의 두 번째 계정·기록 있는 도감 격리·시연 Android APK는 별도 미완료다.

- 시연 웹은 [공개 www HTTPS](https://www.masscom.kr/preview/)에서 설치 없이 볼 수 있고, 기존 Vercel 배포는 복구 후보로 보존한다([전환 증거](evidence/www-web-cutover-2026-09-25.json)). [private GitHub 웹 전용 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)의 HTML/CSS ZIP·digest는 그대로이며 릴리스 설명의 기본 링크만 www로 갱신했다([태그 생성 당시 증거](evidence/showcase-web-release-2026-09-25.json)). 시연 Android APK·Release는 아직 없고 `demo-api.masscom.kr`·별도 인증·서명 설치 실기도 미완료다. 웹 예시 기록을 운영 데이터·NFT 발행 실적으로 표시하지 않는다.

- 이전 운영 웹 실증 기준: [PR #166](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/166) merge `c0ad8d6`, PR CI `36047283723`·당시 main CI `36048047690` PASS. 당시 운영 API 배포는 `d787471`이었고 최신 배포는 위 D-034 항목을 따른다. 실제 최신 HEAD·브랜치·CI·Issue는 `git`·`gh`로 확인한다. 운영 웹 로그인과 시연 API/앱 전체 완료를 혼동하지 않는다.

- 2026-09-25 Samsung Android Chrome에서 기존 Google 계정 A 로그인·빈 도감, A 로그아웃, B의 소유자 본인 확인 후 로그인·빈 도감, URL 재열기 뒤 B 세션 유지를 확인했다. 운영 서버에는 최근 세션 3건·서로 다른 계정 2개·철회 2건·활성 1건이 기록됐다([증거](evidence/android-web-auth-2026-09-25.json)). 실제 기록이 있는 계정 간 도감 교차 노출, 최신 APK, 일반 App Link 탭은 `NOT_RUN`; 이전 아래 항목의 휴대전화 로그인 `NOT_RUN`은 검증 전 시점의 상태다.

### 이전 단계 기록 — 당시 상태, 현재 판정 아님

- 2026-09-25 운영 웹 Google 로그인 최신: [PR #164](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/164) merge `d787471`·PR/main CI PASS 후 동일 커밋을 기존 Lightsail에 배포했다. 런타임 비밀값은 Git 밖 mode 600으로 반영하고 클립보드를 비웠다. Google 로그인 시작 302·정확한 callback·state/PKCE/Secure/HttpOnly 쿠키, 기존 계정 1개의 본인 빈 도감·새로고침 유지·로그아웃 후 미로그인 및 서버 세션 revoke, 익명 도감 401, 공개 점포 0건 200을 확인했다. 실계정 A/B 도감 격리·휴대전화 브라우저 로그인·최신 Android APK는 `NOT_RUN`; Issue #137 전체는 OPEN([세부](TEST_STATUS.md)).

- 2026-09-25 최신: [PR #163](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/163) merge `ec57eb4`와 main CI `36034481207` PASS 뒤 AWS 웹 staging, 가비아 apex DNS `43.200.56.97` 전환, Let's Encrypt TLS 및 공개 포털·`/app/`·`/merchants` HTTPS 200을 확인했다. Samsung SM-S928N에서 이전 `test.2` APK의 `/open` 명시적 VIEW intent와 Chrome의 `/app/` 로드를 확인했지만, Android 사용자 선택 상태 `Disabled`이므로 일반 링크 탭의 기본 열기는 미검증이다. 같은 커밋의 운영 API와 migration 0014·0015를 배포했고 DB 백업·API health를 확인했다. Google 콜백 URI는 등록됐으나 비밀값 미설정으로 로그인·개인 도감은 503 `BLOCKED`; 실제 Google 계정 A/B는 `NOT_RUN`이다([상세](TEST_STATUS.md)).

- 2026-09-25 과거 첫 AWS 웹 staging 명령은 tar 전송 뒤 실패했다. 없는 `/opt/masscom/web/current`의 `readlink -f` fallback 오류를 `fix/137-first-web-release`에서 수정했고 후속 PR #163·main CI와 위 실제 배포로 해소했다. 이 실패는 현재 원격 상태가 아니다.

- 2026-09-25 과거 CI 중단: PR #161 병합 후 main CI `36029974084`의 PostgreSQL 초기화 경합은 PR #162 merge `cde6a2d`·main CI `36031948040` PASS로 해소했다. [실패·수정 근거](TEST_STATUS.md)를 보존한다.

- 2026-09-25 `feat/137-web-collection-auth`: [PR #159](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/159)에서 웹 전용 Google OIDC state·PKCE·nonce, 해시 저장 세션, 계정 삭제 시 회수, 읽기 전용 도감 UI 및 Caddy 네 경로를 구현·시험했다. 당시 로컬/CI 결과와 현재의 외부 배포·실계정 미완료 상태는 별개이며 최신 판정은 위 항목과 [검증 세부](TEST_STATUS.md)를 따른다.

- 2026-09-24 `feat/137-aws-web`: PR #158로 병합된 공개 파일 allowlist·기존 Lightsail Caddy 포털과 `/app/`·웹 전용 배포/rollback 코드([당시 로컬 증거](evidence/aws-web-local-2026-09-24.json)). 이후 AWS apex DNS·TLS·기기 검증은 위 최신 항목을 따른다.
- 2026-09-24 시연 호스트 경계는 PR #157 merge `96341e8`·main CI `36005667769` PASS다. 별도 로컬 Docker에서 API/DB healthy, A/B/C 3곳·목표 9개, 반복 seed, 익명 도감 401을 확인했다([증거](evidence/showcase-host-local-2026-09-24.json)). 운영 Lightsail 비용·용량과 전용 OAuth·DNS·외부 HTTPS는 미확인이라 실제 서버 배포는 BLOCKED다.
- 2026-09-24 D-032의 #136 시연 앱 전용 첫 역할 선택은 PR #156 merge `5e91728`·main CI `35998825263` PASS다. 개발·운영 첫 화면은 유지하며 시연 설치본·외부 API 실기는 `NOT_RUN`이다.
- 2026-09-24 이슈 #136·#137의 `CLOSED / NOT_PLANNED` 처리는 미완료 작업을 계획 없이 닫은 오류여서 되돌렸고 둘 다 `OPEN`이다. [#136 시연 앱 진입](superpowers/plans/2026-09-24-issue136-showcase-entry.md), [#137 외부 시연 전달](superpowers/plans/2026-09-24-issue137-showcase-delivery.md), [#137 운영 웹 본인 도감](superpowers/plans/2026-09-24-issue137-production-collection.md)을 계획했다. 현재 구현·외부 검증 상태는 아래 항목과 각 계획의 게이트를 따른다. 이 문서 수정은 미완료 기능을 PASS로 승격하지 않는다.

- Issue #137 공개 시연 API의 초대 제한 코드를 추가했다. `SHOWCASE_MODE=true`는 정확한 `masscom_showcase` DB·Google audience 한 개·초대된 `sub` 해시 목록이 없으면 시작을 거절한다. 유효한 Google 토큰이라도 초대되지 않으면 DB identity/session 저장 전 `INVITE_REQUIRED` 403, 초대 목록 변경 후 모든 인스턴스를 재시작하면 기존 세션 조회도 거절한다. API 단위 90/90·PostgreSQL 45/45·typecheck/build 로컬 PASS. 실제 외부 API·DNS·Google client·Android 시연 APK는 `NOT_RUN`이다.

- 무료 Vercel Hobby의 분리 프로젝트에 정적 시연 웹을 올렸다. `https://masscom-showcase-web.vercel.app` HTML·CSS HTTPS 200과 A·B·C 표기를 확인했다. `demo.masscom.kr` DNS는 아직 미연결이며 운영 `masscom.kr` 포털은 변경하지 않았다. 시연 Android는 전용 Google Web client ID를 빌드 설정에서 요구하고 실제 `.demo` package에서만 읽도록 코드·시험을 추가하는 중이다. 시연 OAuth client·외부 API·APK 설치는 `NOT_RUN`이다.

- Issue #137에서 사용자 요청에 따라 읽기 전용 시연 웹과 격리 로컬 seed를 가상 점포 A·B·C 총 3곳으로 확장했다. 웹의 A 방문·수집품은 고정 예시이며 B·C를 방문 완료로 꾸미지 않는다. 실제 PostgreSQL 반복 seed·A 기존 진행 보존·동시 생성·손상 거절과 로컬 API 공개 목록 3곳은 PASS. 외부 `demo.masscom.kr`·시연 APK는 여전히 `NOT_RUN`이다.

- Issue #137 후속으로 별도 `apps/production-web` 운영 웹을 추가했다. 공개 `GET /merchants`는 실제 0건을 빈 상태로 보이고 시연 행을 제거한다. 운영 웹 외부 배포는 위 최신 항목과 같이 확인됐지만 개인 도감 로그인은 아직 503이다. GitHub 운영 test.2 APK는 이전 코드이며 시연 APK·최신 운영 APK는 없다([다운로드 구분](ANDROID_DOWNLOADS.md)).

- Issue #137의 로컬 개발 DEMO에서 Samsung Android 16 실기 수동 코드 흐름을 새 USB 연결로 완료했다. STAFF 발급→고객 수령→도감 1/1/0→다음 보상 추천과 동일 코드 추가 효과 0을 확인했다([증거](evidence/android-local-claim-2026-09-24/README.md)). 실제 QR 카메라·외부 시연 API/앱·지갑/NFT와 운영 웹 개인 도감은 여전히 미완료다.

- Issue #146 `fix/146-account-link-style`에서 Samsung 개발 앱의 ‘내 정보’ Expo Router 오류를 RED→GREEN 수정했다. 모바일 182/182·typecheck·lint와 동일 폰의 내 정보·역할 시안 진입은 PASS. 로컬 가상 점포 코드 발급/미리보기만 PASS, USB 연결 해제로 방문 수령·보상은 BLOCKED([증거](evidence/android-dev-ui-2026-09-24/README.md)). PR·병합 상태는 `gh pr list`로 확인하며 운영 앱 배포로 표현하지 않는다.

- PR #138은 merge `d257d0b`, main CI `35879966085` PASS. 역할 선택은 개발용 미리보기이며 운영 네 탭은 유지된다. Issue #136의 원래 첫 화면 요구는 OPEN이다.
- Issue #137에서는 정적 시연 웹 PR #139, 로컬 `_test` seed PR #140, 시연 Android 빌드 경계 PR #141을 병합했다. PR #141의 `main` CI `35889398325`는 PASS다. 후속 `fix/137-demo-auth-boundary`는 개발 DEMO 인증을 정확한 `.dev` package로 제한한다(브랜치·PR 상태는 `gh pr list`로 확인). 시연 package/scheme/API 설정만 구현됐고 외부 시연 API/DB·OAuth/Reown·APK·실기와 운영 웹 개인 도감은 미완료다.
- 후속 `feat/137-showcase-local-runtime`은 별도 로컬 Docker API·DB를 인증 없이 실행해 가상 점포 공개 조회와 계정 요청 거절을 검증했다. 로컬 환경은 외부 시연 API/DB 배포·시연 앱 연결 완료가 아니다. 실제 PR·CI·병합 상태는 `gh pr list`로 확인한다.
- Issue #142의 개발용 파란 시안 기준을 운영 11개 화면과 읽기 전용 시연 웹의 라이트/다크 의미색에 적용했다. 한글 PR #143의 현재 CI·병합 상태는 `gh pr view 143`과 `git log origin/main -1`로 확인한다. 모바일 자동 180/180, typecheck·lint·Android 개발 JS export, 시연 웹 19/19·접근성·정적 검사, 테스트 AVD의 로그인 화면 라이트/다크·200%는 PASS. 로그인 후 네 탭·실제 휴대전화·공개 HTTPS는 NOT_RUN([증거](evidence/design-consistency-2026-09-24/README.md)). 아래 2026-09-23 수치를 이번 작업의 최신 결과로 오인하지 않는다.

## 기준선

| 항목 | 값 |
| --- | --- |
| 저장소 | `2026-KW-HACKATHON/27_MassCOM` (`PRIVATE`) |
| 기본 브랜치 | `main` |
| 기준 커밋 | 이 문서는 SHA를 고정하지 않는다. 실제 기준은 `git log origin/main -1`, 직전 검증 기준은 `docs/HANDOFF.md` 머리말 |
| 현재 작업·열린 PR | `gh pr list`, `gh issue list`가 기준. 인수인계 요약은 `docs/HANDOFF.md` |
| 현재 검증 기준 | PR #134 merge `e9f5b58`, main CI `35809960551` PASS, 기존 Vercel 도메인 새 SVG·`/open` HTTPS PASS. API 단위 82·PostgreSQL 37·Worker 단위 47/PG 23·모바일 149. MetaMask 재연결은 지갑 잠금으로 `BLOCKED`; 검색·필터 조작과 외부 두 IP 제한은 `NOT_RUN` |

## Issue #133 공식 서비스 URL·지갑 출처 진행

- README에는 원래 `https://masscom.kr`이 있었지만 긴 목록 안에 있었고 첫 미리보기 링크는 로컬 `docs/index.html`이었다. 공개 포털·`/open`·API·private GitHub의 역할을 상단에서 구분한다.
- Reown 승인 메타데이터는 GitHub URL 대신 `https://masscom.kr`과 기존 포털 표식을 사용한다. `api.masscom.kr` SIWE 검증, native 복귀 스킴, Base Sepolia와 허용 메서드는 변경하지 않는다.
- [PR #134](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/134) 병합과 PR·main CI PASS. 모바일 149개 단위 시험·typecheck·lint·Android export 및 포털 구조·접근성·bootstrap·비밀 검사 PASS. 기존 Vercel 프로젝트 배포 후 공개 표식 HTTPS 200·`image/svg+xml`·소스 hash 일치, `/open` 200·홈 링크 확인 PASS([증거](evidence/domain-wallet-origin-2026-09-23.json)).
- 개발 앱 새 JS와 지갑 화면은 Samsung 실기에서 열림. MetaMask 8.11.0 재연결은 비밀번호 잠금으로 `BLOCKED`; 기존 세션은 앱에서 해제되어 화면은 `NOT_CONNECTED / UNVERIFIED`. 운영 test.2 APK는 변경 전 코드이므로 새 운영 빌드·재연결은 `NOT_RUN`. Issue #133은 이 실기 완료 전 열린 상태로 유지.

## Issue #129 탐색·운영 방어와 배포

- 공개 카탈로그의 실제 점포 검색·참여 가능 필터, 첫 화면 0건/검색 0건/오류 구분을 구현했다. 148개 모바일 자동 시험·typecheck·lint·Android export는 PASS. Samsung Android 16의 실제 0건 라이트·다크·상태표시줄은 PASS([증거](evidence/android-discovery-2026-09-23.json)); 점포가 없어 검색·필터 실기와 TalkBack·200% 확대는 `NOT_RUN`.
- DEMO 인증의 외부 바인드를 기동 단계에서 차단하고, Caddy가 덮어쓴 단일 IP로 운영 로그인 제한을 분리했다. API 82개 자동 시험·typecheck PASS. Caddy·API의 변경 후 운영 배포와 외부 HTTPS/401은 [실증](evidence/lightsail-api-deployment-2026-09-23.json) PASS, 외부 2-IP 제한은 `NOT_RUN`.
- Worker는 먼저 이벤트와 정식 블록 해시를 대조하고, 블록이 사라지거나 해시가 다르면 최종화하지 않고 재시도한다. Worker 47개 자동 시험·typecheck PASS; 변경 후 Anvil 재구성 통합 시험과 Base Sepolia 재실증은 `NOT_RUN`.
- 오프라인 로그아웃 시 로컬 키를 지우되 서버 세션 회수 실패를 명시한다. 이전 서버 토큰 자동 재회수는 아직 미구현이며 만료 전 유효할 수 있다.
- 개인 Codex 설정의 기본 추론은 GPT‑6 Sol medium으로 조정했고 역할별 Luna/Sol/Astra 배분을 정리했다. 저장소의 협업 기준은 [AI 모델 사용 기준](AI_MODEL_ROUTING.md)에 기록했다.
- [PR #130](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/130)을 merge `fcaa1c0`으로 통합했고 main CI `35772682920`이 PASS했다. 기존 Lightsail 인스턴스에 같은 커밋의 API·Caddy를 배포했다. Worker 운영 서비스·계정 전환·Play는 이번 배포 범위가 아니다.

## Issue #126 모바일 UI 완료

- [PR #127](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/127)을 merge commit `4437607`로 main에 통합했다. 네 기본 탭과 탐색·방문·도감·내 정보의 시각 계층을 구현했으며 기존 API·인증·지갑·NFT 상태 로직은 변경하지 않았다.
- 모바일 자동 시험 `146/146 PASS`, typecheck·lint·Android export·Android 36 arm64 개발 APK 빌드/설치 `PASS`.
- Samsung Android 16에서 네 탭·정직한 빈 상태·360dp·200% 글씨·실시간 다크 모드·뒤로 가기·개발 scheme를 PASS했다. TalkBack 서비스와 접근성 포커스는 부분 확인했으나 첫 실행 안내로 앱 콘텐츠 낭독은 `NOT_RUN`; 두 계정 marker와 cold restore는 확인했지만 데이터·지갑이 모두 비어 D02는 `NOT_RUN`; [증거](evidence/android-ui-navigation-2026-09-23.json). 필수 36개 집계는 31/2/3 그대로다.
- `RQ-001`의 ‘로그인 없이 음식점 탐색 VERIFIED’는 현재 앱 루트의 인증 게이트와 충돌한다. 공개 API의 무로그인 조회가 앱 전체 탐색을 증명하지 않으므로 요구사항 상태를 `IN_PROGRESS`로 바로잡았다. 인증 모델 변경은 이번 UI PR 범위 밖이다.

## Issue #124 중단 체크포인트

- 브랜치 `feat/124-release-closeout`, Base Sepolia Worker proof `83e1c29`, App Link APK 기준 `0d93c49`.
- AWS Lightsail 서울 2GB 인스턴스에 커밋 `73e07c8`의 PostgreSQL·API·Caddy를 배포했고 세 컨테이너 상태를 healthy/running으로 확인했다. DB 5432·API 3000은 인터넷에 publish하지 않았다.
- Vercel 정적 포털 `https://masscom.kr`과 `/privacy`, `/account-deletion`은 HTTPS 200 `VERIFIED`다.
- `api.masscom.kr` DNS·Let’s Encrypt와 외부 `/health` 200을 확인했다. Samsung Android 16에서 실제 Google 동의·session 발급·콜드 스타트 복원·logout revoke가 PASS했다. 두 번째 계정 전환 D02는 `NOT_RUN`이다.
- Google Cloud `masscom-wolgye-2026`에 Web·개발 Android·upload-key Android client를 만들고 잘못된 DailyCoding MassCOM client 3개를 삭제했다. Play 앱 서명 인증서 client는 Play Console 키가 생긴 뒤 별도로 만든다.
- 상세 값과 재개 순서는 [`docs/evidence/external-oauth-hosting-2026-09-22.json`](evidence/external-oauth-hosting-2026-09-22.json), [`docs/HANDOFF.md`](HANDOFF.md)를 따른다.

## 검증 수준별 현황

필수 36개: 31 PASS / 2 BLOCKED / 3 NOT_RUN. 아래 네 묶음은 서로 다른 상태이며 섞어 말하지 않는다.

| 수준 | 해당 항목 |
| --- | --- |
| 로컬 검증 완료 | 탐색·발급·수령·도감·추천, 지갑 주소 확인(SIWE), 발행 요청·Outbox·Worker·계약(Local Anvil), 계정 삭제, 백업·복원 drill, upload-key 운영 AAB 서명·W08·source marker·16KB 정적 검사 |
| 시험망 검증 완료 | Base Sepolia 계약 배포, admin/minter/pauser role, cap 1 series, Worker service minter 발행 1건, receipt/event/owner/locked/metadata, 재실행 무작업 PASS |
| 운영 실기 미검증 | 외부 HTTPS·첫 Google 로그인·private GitHub APK·4KB/16KB·App Links는 PASS. D02, fresh reauthentication, O01, Play는 `NOT_RUN` |
| 사용자 승인·입력 대기 | Foundry keystore 숨김 비밀번호, D-023 수령 시 캠페인 등록 요구 여부, W04·W05용 지갑 환경(B-010·B-011), Play App Signing 인증서 client. 호스팅·도메인·OAuth·faucet·upload AAB는 해소 |

## 열린 Issue·PR과 최근 병합

실시간 목록은 `gh pr list --state all --limit 20`이 기준이다. 2026-09-23 최근 기준선은 PR #127 merge `4437607`, main CI run `35763199480` PASS다. 직전 release 기준선은 PR #125 merge `de1448f`, main CI `35733488626` PASS다.

## Phase 상태

| Phase | 상태 | 실제 근거 |
| --- | --- | --- |
| Phase 0 저장소·개발 기반 | `VERIFIED` | README·프로젝트 포털·한국어 PR 검사·CI |
| Phase 1 외부 지갑 연결 | `IN_PROGRESS` | 개발 package MetaMask 연결→Base Sepolia→`personal_sign`→서버 `VERIFIED`→콜드 스타트 binding 복원, W06 PASS; 운영 release package·W04·W05는 `NOT_RUN/BLOCKED` |
| Phase 2 지역 상권 핵심 기능 | `VERIFIED` | loopback DEMO 탐색→점주 발급→고객 수령→도감→추천→상세 순환 PASS |
| Phase 3 NFT | `VERIFIED` | Local Anvil 복구 흐름과 Base Sepolia 계약→job/Outbox→암호화 service minter→이벤트·소유자·locked·중복 방지 PASS |
| Phase 4 출시 기반 | `IN_PROGRESS` | 외부 HTTPS·첫 Google 로그인·삭제 페이지·GitHub test.2 APK·4KB/16KB·verified App Link PASS. D02·fresh reauth·Play는 미완료 |
| Phase 5 대회 검증·발표 | `IN_PROGRESS` | 발표 웹·3/5분 원고·시연 runbook·빈 현장 기록지·증거 manifest 구현; 현장·리허설·영상·제출은 NOT_RUN |
| Phase 6 후속 기능 | `PLANNED` | 별도 승인 전 미착수 |

## 구현·검증 완료

- Expo Android 앱, Reown 외부 지갑 전용 연결, 금지 RPC 메서드 차단
- Reown 새 개발 package 허용 목록 실기, MetaMask 자동 복귀, 서버 binding과 현재 주소·체인을 대조한 콜드 스타트 `VERIFIED` 복원
- ERC-4361 주소 확인, nonce 단일 소비, 버전된 PostgreSQL wallet binding
- 공개 음식점·캠페인, 점포별 OWNER/STAFF 권한, 1인 일회용 방문 코드
- QR slot 소비·방문·KST 일일 진행·첫/3/5회 고정 보상권 원자 처리
- 방문·앱 수집품·실제 NFT를 분리한 도감과 이유가 보이는 다음 가게 추천
- OpenZeppelin ERC-721/ERC-5192 계약의 역할·누적 상한·reward key·영구 잠금
- 보상권·고정 수령인 mint job·Outbox 원자 생성과 동일 요청 20개 수렴
- Worker의 `SKIP LOCKED` lease·heartbeat, 제출 attempt, 체인 이벤트, NFT 자산, cursor 저장
- 전송 전 chain/contract/MINTER 검사와 receipt·계약·수령인·series·reward key·owner·locked 대조
- 응답 유실, 두 Worker 경쟁, lease 만료, 이벤트 반복, 확정 전 재조직, DB 자산 복구
- Samsung Android 16에서 NFT 공개 안내→접수→등록 완료와 기존 token #1 재전송 없는 복구
- 계정 삭제 동시 10요청 수렴, 미전송 mint 취소, 제출/확정 보존, 원 account ID 비식별화 D01
- 민감 로그 인자·미검토 analytics SDK CI 차단과 raw API error 로그 제거 D03
- Samsung Android 16 계정 설정·공개 장부 안내·Local DEMO 삭제 요청
- 다운로드 없이 여는 발표 페이지, 3분·5분 원고, 실제 시연/실패 대체 runbook
- 결과를 미리 채우지 않은 현장 검증 기록지와 제출 증거 manifest·허위 주장 gate
- 삭제·wallet·claim·redeem·mint request 공통 account lifecycle lock과 삭제 tombstone write 차단
- 활성 Worker lease 삭제 보호, submit 직전 lease 재검사, duplicate revert reward-key 복구
- chain cursor 기반 재시작 범위, 12블록 reorg margin, 오래된 reward 이벤트 fallback 복구
- 36개 테스트 catalog/ledger ID별 상태 동기화와 강화된 secret·PR·presentation gate

## 미완료

- Android 카메라 QR·수동 코드 대체 입력·오프라인 A01
- 단체 인원·금액 한도 정책(v3 제안값, 미승인). 사람별 슬롯 독립성 Q04는 PASS
- W04 동일 세션 서명 중 주소 변경, W05 미지원 스마트 지갑 실기
- 실제 운영 계정 전환·캐시 복원 D02
- 운영 권한 O01
- mainnet·Google Play 제품 배포
- 실제 현장 참여·발표 리허설·영상 촬영·저장소 공개·대회 최종 제출

## 영역별 현재 상태

| 영역 | 상태 | 내용 |
| --- | --- | --- |
| 배포 | `IN_PROGRESS` | `masscom.kr` 포털·법적 페이지·`/app/` 및 `api.masscom.kr`이 기존 AWS Lightsail에서 공인 TLS로 응답하고 `/health` 200을 확인. 운영 웹 Google 로그인·개인 도감·Worker·백업 복원 실험은 별도 `BLOCKED/NOT_RUN` |
| Android 빌드 | `IN_PROGRESS` | private GitHub test.2 APK, upload key AAB gate, Samsung 4KB·Android 36 16KB AVD·verified `/open` App Link PASS. Play 업로드는 `NOT_RUN` |
| NFT·시험망 | `VERIFIED` | Local Anvil 복구·장애 흐름과 Base Sepolia 실제 계약·role·series·Worker mint #1·중복 방지 PASS. mainnet 범위 밖 |
| 외부 지갑 연동 | `IN_PROGRESS` | `kr.masscom.wolgye.dev` MetaMask 연결·Base Sepolia·`personal_sign`·서버 검증·자동 복귀·콜드 스타트 복원과 W06 실기 PASS(B-014 해소). 운영 `kr.masscom.wolgye` release 복귀는 `NOT_RUN`; W04·W05는 `BLOCKED`(B-010·B-011) |

## 검증 상태

- 필수 36개: 31 PASS / 2 BLOCKED / 3 NOT_RUN
- API 단위: `82/82 PASS`; PostgreSQL: 직전 `37/37 PASS`(이번 변경 뒤 미재실행)
- Worker 단위: `47/47 PASS`; PostgreSQL: 직전 `23/23 PASS`(이번 변경 뒤 미재실행); Anvil W07/M01~M08: 직전 `PASS`
- 모바일: `148/148 PASS`; typecheck·lint·Android export `PASS`. Issue #129의 Samsung 빈 화면 라이트·다크·상태표시줄 실기 PASS. 첫 Google 로그인·콜드 복원·logout과 Issue #126 네 탭 실기는 이전 코드 기준 PASS이며, 변경 후 검색·필터·TalkBack 앱 낭독·완전한 D02는 `NOT_RUN`
- Foundry: `8/8 PASS`, fuzz 128, fmt·build·lint `PASS`
- 비밀 검사·부트스트랩·프로젝트 포털 접근성/구조: `PASS`
- production dependency audit: API·Worker high 이상 0; 모바일 high 이상 0, Expo 전이 moderate 14건은 B-008

## BLOCKED

- B-002 저장소 공개 전환과 심사 public 준비: 명시 승인 필요
- B-004 Google Play 정책: 공식 확인 필요. B-007 package ID는 `kr.masscom.wolgye`로 해소(D-022)
- B-008 Expo 전이 moderate advisory: 2026-09-20 Expo 57.0.24·expo-router 57.0.22 patch 적용 뒤 재평가에서도 14건 유지. 근원은 `xcode`→`uuid`(iOS 설정 도구, 빌드 시점)와 `expo-router`→`query-string`→`decode-uri-component`이며 npm이 제시하는 수정은 expo 46 다운그레이드뿐이라 호환되는 upstream 수정 필요
- Issue #129 재평가에서는 모바일 moderate 15건, high/critical 0건. 자동 downgrade는 적용하지 않았다. 오프라인 서버 세션 회수 재시도와 운영 프록시 실증은 남아 있다.
- B-010/B-011 W04·W05용 실제 지갑 환경 부재
- Base Sepolia Worker proof와 upload-key AAB·16KB runtime·App Links는 PASS. Play는 별도 `NOT_RUN`

상세 실행 근거는 [TEST_STATUS.md](TEST_STATUS.md), Phase 3 증거는 [phase3-worker-anvil-android.json](evidence/phase3-worker-anvil-android.json), 차단 사유는 [BLOCKERS.md](BLOCKERS.md), 다음 세션 상태는 [HANDOFF.md](HANDOFF.md)를 기준으로 합니다.
