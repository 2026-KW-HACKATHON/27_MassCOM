# Issue #137 외부 시연 앱·API·웹 전달 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the dependent deployment sequence, with an independent security reviewer before public routing. Steps use checkbox (`- [ ]`) syntax for tracking. A passing local test is not external acceptance.

**Goal:** 세 가상 점포의 실제 Android 시연 수령→도감 흐름을 운영 데이터와 격리된 외부 HTTPS에서 검증하고, private GitHub에 설치 가능한 시연 APK를 증거와 함께 제공한다.

**Architecture:** 현재 [기본 HTTPS 시연 웹](https://masscom-showcase-web.vercel.app)은 고정 읽기 전용 예시로 유지한다. 기존 Lightsail을 재사용할 수 있을 때만 별도 Compose 프로젝트·PostgreSQL DB/계정/볼륨·API 네트워크를 둔다. 초대 Google 계정만 시연 API 세션을 받으며 기존 운영 Caddy는 검증된 host만 분기한다. Android `kr.masscom.wolgye.demo`는 운영 package·API·OAuth·Reown·서명 상태를 상속하지 않는다.

**Tech Stack:** Node.js 24/TypeScript API, PostgreSQL 16, Docker Compose/Caddy, Expo SDK 57 Android, Google OIDC, 선택적 Reown AppKit, Vercel 정적 웹, GitHub private pre-release.

**Spec:** [시연·운영 분리 설계](../specs/2026-09-23-showcase-production-separation-design.md), [초대 인증 경계](../../SHOWCASE_AUTH_GUARD.md), [Issue #137](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/137).

**시작 순서:** 1. Task 1 비용·용량·운영 건강 상태를 읽기 전용으로 확인한다. 2. Task 2~5의 격리·인증·HTTPS·APK 게이트를 차례로 통과한다. 3. Task 6의 실기와 병합 후 증거로 종료를 판정한다.

## 현재 기준선과 중복 방지

- `main faa04cd`: 시연 웹 기본 URL HTTPS 200, 가상 점포 A/B/C·로컬 seed·`.demo` package 경계·Google 전용 ID 설정 코드·초대 해시 가드까지 구현. 최신 CI `35993488180` PASS.
- `demo.masscom.kr`·`demo-api.masscom.kr` DNS는 미설정, 별도 OAuth/Reown·외부 시연 API·서명 시연 APK는 없음. 운영 `test.2` APK를 시연 설치본으로 재사용하지 않는다.
- 기존 `infra/showcase-local/compose.yml`은 loopback/인증 미설정 테스트 전용이다. 외부 공개 설정으로 이름만 바꾸지 않는다.

## Global Constraints

- 새 유료 인스턴스·요금제·과금 자원은 만들지 않는다. 기존 Lightsail/무료 Vercel의 남은 용량·요금 한도를 먼저 확인하고 부족하면 해당 배포를 `BLOCKED`로 둔다.
- 운영 DB `masscom`, 운영 API `api.masscom.kr`, 운영 앱 package `kr.masscom.wolgye`와 기존 키·세션·release 파일은 변경하지 않는다.
- 시연 API DB는 정확히 `masscom_showcase`, `SHOWCASE_MODE=true`, Google audience 하나, 초대 Google `sub` SHA-256 목록을 필수로 한다. 개발 DEMO 헤더는 외부에서 금지한다.
- 가상 점포 A/B/C·1/3/5회 고정 목표만 사용하고 실제 제휴·방문·매출·NFT 발행 실적으로 표현하지 않는다.
- 지갑·NFT는 선택 사항이다. 첫 APK의 앱 수집품과 실제 온체인 NFT를 구분하고, 별도 Reown·체인/Worker 검증 전 발행 버튼을 열지 않는다.
- 운영 키·메인넷·Play 제출·저장소 공개·대회 최종 제출은 이 계획의 자동 실행 범위 밖이다.

## Review Focus

- 시연 컨테이너가 운영 DB/볼륨/네트워크에 붙거나 외부에 3000/5432를 노출하지 않는지 Task 1 변조 시험.
- A만 있던 시연 DB를 확장할 때 기존 방문·보상권·진행이 지워지지 않는지 Task 2 PostgreSQL 시험.
- 유효한 Google 토큰이라도 초대 외 계정이 세션을 만들지 못하고 점주 UI 선택만으로 STAFF가 되지 않는지 Task 3/5 시험.
- Caddy host 변경 뒤 운영 API 건강 상태·로그인·원복 경로가 유지되는지 Task 4 외부 시험.
- 서명 APK가 기대한 `.demo` package·source commit·API를 포함하고 운영 앱과 동시 설치되는지 Task 5/6 실기 시험.

---

### Task 1: 비용·용량 사전 검사와 독립 호스트 구성

**Files:** 새 `infra/showcase-host/compose.yml`, 새 `infra/showcase-host/runtime.env.example`, 새 `scripts/verify-showcase-host.mjs`, 새 `tests/ops/verify_showcase_host_test.mjs`, `docs/HANDOFF.md`.

**Interfaces:** Compose project `masscom-showcase`는 자체 `postgres_data`와 API/DB 네트워크를 갖는다. 첫 단계의 API·DB host publish는 모두 `127.0.0.1`로 제한한다. 운영 Compose와 `scripts/deploy-lightsail.sh`는 수정하지 않는다.

- [ ] 운영 `free -m`, 디스크, 기존 컨테이너 ID/재시작 수, `https://api.masscom.kr/health`, 요금/크레딧 상태를 읽기 전용으로 기록한다. 추가 비용 가능성이 있거나 운영 여유가 부족하면 원격 생성 없이 `BLOCKED`.
- [ ] `verify_showcase_host_test.mjs`에 운영 DB/볼륨 이름 공유, 외부 `ports`, 운영 Google audience 승계, DEMO 헤더 활성화, Worker 자동 기동을 넣은 변조 fixture가 거절되는 시험을 먼저 작성하고 실패를 확인한다.
- [ ] 별도 Compose를 작성하고 `docker compose -f infra/showcase-host/compose.yml config`와 변조 시험을 통과시킨다. 예를 들어 공개 금지 검사는 `127.0.0.1:3301:3000`만 허용하고 `0.0.0.0:3301:3000`을 거절한다.
- [ ] 한국어 PR CI·리뷰 뒤 기존 Lightsail의 별도 `/opt/masscom-showcase`에만 배포한다. 운영 `current` 심볼릭 링크·runtime.env·Compose를 덮어쓰지 않는다. 운영 전후 health·컨테이너 ID·재시작 수를 대조한다.

### Task 2: `masscom_showcase`의 안전한 가상 seed와 점주 권한 부여

**Files:** `apps/api/src/showcase/local-seed.ts`, 새 `apps/api/src/showcase/host-seed.ts`, 새 `apps/api/src/showcase/host-seed.postgres.integration.ts`, 새 `apps/api/src/showcase/grant-staff.ts`, 새 `apps/api/src/showcase/grant-staff.postgres.integration.ts`.

**Interfaces:** `seedHostedShowcase(pool)`은 연결된 실제 DB 이름이 `masscom_showcase`일 때에만 A/B/C fixture를 같은 advisory lock·트랜잭션으로 검사/추가한다. `grantShowcaseStaff(pool, accountId, merchantId)`는 초대된 Google identity로 로그인한 기존 account와 가상 점포만 허용하며 역할 선택 화면만으로 권한을 만들지 않는다.

- [ ] 실제 PostgreSQL `_test` DB에서 운영 DB 이름 거절, 기존 A 방문·보상/진행 보존, 3회 반복 seed, 동시 8회 seed 중복 0, fixture 손상 시 전체 rollback 시험을 먼저 작성해 실패를 확인한다.
- [ ] 기존 로컬 seed의 데이터 상수·검증을 재사용하되 외부 DB 허용을 `masscom_showcase` 하나로 한정한다. 운영 DB `masscom`을 허용하는 일반 스위치를 만들지 않는다.
- [ ] 점주 권한 부여는 확인된 account ID·merchant ID만 다루고, 미초대/미로그인·비가상 점포·다른 DB를 거절하는 통합 시험을 통과시킨다. Google `sub`·이메일·방문 코드는 로그에 출력하지 않는다.
- [ ] migration·seed·STAFF 부여 후 A/B/C·1/3/5 목표·직원 1명과 운영 DB 가상 점포 0건을 읽기 전용 조회로 확인한다. 실 DB 초기화/삭제 명령은 실행하지 않는다.

### Task 3: 별도 Google OAuth와 초대 로그인 검증

**Files:** `apps/mobile/app.config.ts`, `apps/mobile/src/config/build-environment.test.ts`, `apps/api/src/showcase/invite-config.ts`, `apps/api/src/auth-session.postgres.integration.ts`, `docs/SHOWCASE_AUTH_GUARD.md`, 저장소 밖의 접근 제한된 시연 runtime env.

- [ ] 시연 전용 Google Web client 하나와 `kr.masscom.wolgye.demo`·실제 시연 서명 인증서 SHA-1에 맞는 Android client를 준비한다. client ID는 공개 설정, client secret·서명 키는 Git 밖에 둔다. Android package/SHA 조합은 [Google 공식 설정](https://support.google.com/cloud/answer/15549257)을 따른다.
- [ ] 시연 API의 `GOOGLE_OAUTH_CLIENT_IDS`가 전용 Web ID 하나와 일치하고 운영 audience와 다르다는 설정 시험을 작성해 확인한다. 초대 subject 해시는 **검증된** Google 토큰에서만 산출한다. 계정 이메일을 식별 키로 사용하지 않는다.
- [ ] 비초대 토큰 403·DB identity/session 0, 운영 audience 토큰 401, 초대 고객 로그인 200, 초대 STAFF만 `CONFIRM_VISIT`, 계정 A/B 도감 격리를 실제 시연 DB와 로컬/터널 HTTPS에서 검증한다. 실패 항목이 있으면 Caddy 공개를 진행하지 않는다.

### Task 4: DNS·TLS·공개 라우팅의 독립 배포

**Files:** `infra/lightsail/Caddyfile`, `tests/ops/verify_showcase_host_test.mjs`, `apps/showcase-web/README.md`, `docs/evidence/`의 신규 실제 결과 파일.

1. 가비아에서 `demo-api.masscom.kr`을 기존 Lightsail 고정 IP에, `demo.masscom.kr`을 Vercel이 **그 시점에 권장하는** DNS 값에 연결한다. `dig`로 실제 A/CNAME을 확인하기 전 결과를 PASS로 쓰지 않는다.
2. 시연 API 컨테이너를 기존 Caddy와 전용 edge network에서만 연결하고 DB는 그 network에 연결하지 않는다. Caddy는 현재 `admin off`이므로 변경 파일 구문 검사→백업→짧은 재시작→두 host HTTPS health/401/403·보안 헤더 확인→실패 시 원래 파일/컨테이너로 원복 순서로 실행한다.
3. 외부 두 네트워크에서 시연/운영 접근 교차 0, 운영 `/health` 200, 운영 DB 가상 점포 0, 시연 DB A/B/C, API/DB 직접 포트 외부 접근 불가를 확인한다. 모바일 빌드의 정확한 시연 API origin이 실제로 응답할 때만 Task 5로 간다.

### Task 5: 별도 시연 APK·App Link·선택 지갑

**Files:** 새 `scripts/build-showcase-apk.sh`, 새 `tests/release/verify_showcase_apk_test.sh`, `apps/mobile/README.md`, `apps/showcase-web/index.html`, `apps/showcase-web/.well-known/assetlinks.json`(서명 지문 확인 후에만).

- [ ] 소유자가 저장소 밖에서 관리하는 **시연 전용 서명 키**가 준비돼야 한다. 에이전트는 키·비밀번호·복구 문구를 만들거나 대화/Git에 기록하지 않는다. 키가 없으면 서명 APK Release는 `BLOCKED`.
- [ ] `APP_VARIANT=showcase`, 정확한 `https://demo-api.masscom.kr`, 전용 Google Web ID, source SHA로 격리 checkout에서 `expo prebuild --clean`·release APK를 빌드한다. 운영 `.env.local`이 상속되면 실패해야 한다([Expo variant 안내](https://docs.expo.dev/build-reference/variants/)). package·scheme·서명 지문·소스 커밋·SHA-256·금지 지갑 메서드 검사 시험을 먼저 실패→통과시킨다.
- [ ] `demo.masscom.kr/open`과 서명 인증서의 assetlinks를 연결하고 실제 HTTPS·Android verified App Link를 확인한다. 별도 Reown 프로젝트가 없으면 지갑 기능은 비활성으로 표시하며 운영 ID를 빌려 쓰지 않는다. 별도 프로젝트를 연결할 때는 주소 확인 서명만 요청하고 NFT 발행은 별도 체인/Worker 증거 전까지 닫는다.
- [ ] 앱 수집품만 가능한 첫 시연과 실제 시험망 NFT를 화면·README에서 구분한다. GitHub private pre-release에는 **실기에서 통과한** APK, SHA256SUMS, package/source/서명·제약을 함께 게시한다. APK 없이 AAB만 올리거나 운영 test.2 파일명을 바꾸지 않는다.

### Task 6: 실제 Android·웹 수용과 종료 판정

**Files:** `docs/TEST_STATUS.md`, `docs/HANDOFF.md`, `docs/ANDROID_DOWNLOADS.md`, `docs/EVALUATION_MAP.md`, `README.md`.

1. 같은 휴대전화에서 운영·시연 앱 동시 설치 후 각 API URL·scheme/App Link·계정/지갑 분리를 검사한다. 초대 고객/STAFF 두 계정으로 STAFF 발급→실제 카메라 QR→고객 수령→앱 도감→다음 가게 탐색을 완료하고 같은 코드 재시도 효과 0을 DB와 화면에서 확인한다.
2. 지갑 미설치·거절·주소 변경·앱 종료 복귀는 별도 Reown 준비 시 실제 외부 지갑으로 시험한다. 모킹 결과는 실기 PASS로 승격하지 않는다. 시연 웹이 고정 예시이고 앱 진행과 자동 동기화되지 않는다는 안내를 확인한다.
3. 명령, 커밋, 서버/체인, 기기·지갑 버전, PASS/FAIL/BLOCKED/NOT_RUN, 개인정보 없는 재현 근거를 기록한다. PR CI·독립 보안 리뷰·병합 후 main CI가 모두 통과하고 이 Issue의 환경·실기 수용 기준이 입증될 때만 #137을 `COMPLETED`로 닫는다. 운영 웹 개인 도감은 [별도 후속 계획](2026-09-24-issue137-production-collection.md)의 판정도 필요하다.

**되돌리기:** 먼저 시연 host 라우팅만 제거하고 운영 Caddy/HTTPS health를 확인한다. 시연 Compose만 중지하며 운영 Compose/볼륨을 건드리지 않는다. 시연 DB 자료 정리는 정확한 대상·백업 확인 뒤 별도 작업으로 진행한다.

**다음 행동:** Task 1의 운영 health·기존 호스트 여유·요금 한도를 읽기 전용으로 재확인하고 결과를 기록한다.
