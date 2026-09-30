# 이용약관·개인정보 동의와 보관 기간 강제 설계 (Issue #253)

2026-09-30 소유자가 실제 운영 전 꼭 필요한 기능(P0) 다섯 번째로 "추천방식으로 다 해줘"라고 승인했다(`USER_CONFIRMED`, [Issue #253](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/253), 결정 [D-056](../../DECISIONS.md)). 이 문서는 그 7개 항목의 구현 방식을 정한다. 소유자가 정한 것은 Issue 본문의 결정 표이고, 아래에서 "구현 선택"이라고 적은 것은 에이전트가 그 범위 안에서 정했으며 소유자가 확인하지 않았다.

## 1. 원칙

- **말한 것은 지킨다.** 처리방침에 적는 보관 기간은 코드·서버 작업으로 실제 실행되는 것만 적는다. 실행되지 않는 것은 "아직 없다"고 적는다.
- **이미 배포된 앱을 깨지 않는다.** 서버는 동의 여부를 **알려 주기만** 하고 기존 쓰기 요청을 막지 않는다. 막는 것은 새 앱·웹의 동의 화면이다. 쓰기 차단은 옛 앱(운영 `0.1.0-test.3`, 시연 Preview 11 이하)을 정리한 뒤 후속 Issue로 한다.
- **더하기만 한다.** migration 0033은 새 표 하나뿐이다. 기존 표·제약·다른 브랜치(`feat/246-store-go-live`, migration 0032)의 `platform_admin_audit_action_check`에 손대지 않는다.
- 동의 기록과 정리 명령은 개인정보를 새로 모으지 않는다. 기록에는 계정 식별자, 버전 이름, 시각, 경로만 있고 정리 명령은 개수만 출력한다.

## 2. 이용약관 페이지 (`docs/terms.html`)

`docs/privacy.html`·`docs/account-deletion.html`과 같은 CSS(`assets/project.css`·`assets/legal.css`)·머리글·바닥글·다크 모드·건너뛰기 링크를 쓴다. 공개 주소는 `https://www.masscom.kr/terms`이고 `privacy`와 같은 방식으로 연결한다.

- 연결 위치: `scripts/build-public-site.mjs` 공개 파일 목록, `infra/lightsail/Caddyfile`의 `/terms` → `/terms.html` 재작성(`/privacy`와 같은 형태), `scripts/deploy-lightsail.sh`·`scripts/deploy-lightsail-web.sh`의 공개 소스 경로와 배포 뒤 확인 경로, 운영 웹 스모크(`tests/ops/run_aws_web_smoke.sh`), `scripts/verify-project-site.sh`와 포털 시험, 공개 번들 시험(`tests/site/build_public_site_test.mjs`), 접근성 검사.
- 내용(Issue 결정 1): 무료·개발 단계 서비스이며 대회 심사용/일반 공개 전, 계정(Google 로그인)과 만 14세 이상, **양도 불가 NFT**(발행된 기록은 서비스가 지울 수 없고 재산적 가치·환불 없음), 혜택은 **점주가 제공**하며 서비스는 중개·기록만 한다, 계정 삭제(웹 삭제 안내, 24시간 취소·7일 처리), 금지 행위(부정 방문, 남의 계정, 자동화 남용, 점주·직원 사칭, 서비스 방해), 서비스 변경·중단, 책임 한계, 준거법 대한민국, 문의 이메일, 시행일과 버전 `terms-2026-09-30`.
- 개발 단계에 솔직하게 쓴다: 법률 검토 전 문안이며 일반 공개 전에 갱신한다는 경고 문단을 `privacy.html`의 `legal-warning`과 같은 형태로 둔다.

## 3. 동의 기록 (서버)

### 3.1 버전

`apps/api/src/account-consent.ts`에 코드 상수로 둔다.

```
CURRENT_TERMS_VERSION   = 'terms-2026-09-30'
CURRENT_PRIVACY_VERSION = 'privacy-2026-09-30'
```

약관 또는 처리방침 본문을 실질적으로 바꿀 때 이 상수를 올리면 모든 계정이 다시 동의해야 한다(`required=true`). 상수는 코드에 있어 배포와 함께 바뀌고 환경 변수로 열어 두지 않는다(운영·시연이 같은 값을 쓰지 않을 이유가 없고, 설정 실수로 동의가 조용히 풀리는 것을 막는다).

### 3.2 표 (migration 0033, 구 API와 호환)

```sql
CREATE TABLE account_consents (
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  terms_version text NOT NULL CHECK (length(btrim(terms_version)) BETWEEN 1 AND 64),
  privacy_version text NOT NULL CHECK (length(btrim(privacy_version)) BETWEEN 1 AND 64),
  age_confirmed boolean NOT NULL CHECK (age_confirmed),
  source text NOT NULL CHECK (source IN ('WEB', 'ANDROID', 'SHOWCASE_APP')),
  agreed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, terms_version, privacy_version)
);
CREATE INDEX account_consents_agreed_at ON account_consents (agreed_at);
```

- 기본 키가 `(계정, 약관 버전, 처리방침 버전)`이라 같은 버전에 다시 동의해도 행이 늘지 않는다(멱등). 버전이 바뀌면 새 행이 생기고 옛 행은 그 계정이 무엇에 언제 동의했는지의 이력으로 남는다.
- `age_confirmed`는 `true`만 저장한다(CHECK). 세 항목 중 하나라도 거부하면 행이 생기지 않는다.
- 이 표는 새 표이므로 배포된 API(`02cb7e7`)가 알지 못해도 아무 문장도 깨지지 않는다. 옛 API는 이 표를 읽거나 쓰지 않는다. 롤백해도 표는 남고 무해하다.
- 계정 식별자를 가진 표이므로 계정 삭제(`pseudonymizeAccount`)가 이 표의 행을 **지운다**(가명으로 남기지 않는다). 삭제된 계정의 동의 이력을 남길 이유가 없다. 삭제 검증 시험의 원본 ID 검사에 이 표를 더한다.

### 3.3 API

앱은 Bearer 세션, 웹은 `web_session` 쿠키를 쓴다. 본문은 `application/json`이다.

| 경로 | 인증 | 동작 |
| --- | --- | --- |
| `GET /me/consent` | Bearer(앱) | `{ required, termsVersion, privacyVersion }` |
| `POST /me/consent` | Bearer(앱) | 동의 기록, 같은 모양 응답 |
| `GET /api/web/consent` | 웹 쿠키 | 같음 |
| `POST /api/web/consent` | 웹 쿠키 + `Origin`·`Content-Type` 검사(계정 삭제 접수와 같은 검사) | 같음 |

- `required`는 이 계정에 **현재 두 버전이 모두 일치하는 행이 없을 때** `true`다.
- POST 본문은 정확히 `{ "termsVersion", "privacyVersion", "ageConfirmed": true, "termsAccepted": true, "privacyAccepted": true }`다. 다른 키·자료형은 400 `INVALID_REQUEST`. 세 참/거짓 값 중 하나라도 `true`가 아니면 400 `CONSENT_INCOMPLETE`. 버전이 현재 값과 다르면 409 `CONSENT_VERSION_MISMATCH`(화면이 옛 문구를 보여 준 채 새 버전에 동의하는 일을 막는다. 클라이언트는 GET으로 다시 읽고 새 문구를 보여 준다).
- 성공하면 200과 `{ required: false, termsVersion, privacyVersion }`. 이미 같은 버전에 동의했으면 행을 바꾸지 않고 같은 응답(멱등, 처음 동의한 시각과 경로를 덮어쓰지 않는다).
- 경로(`source`)는 서버가 정한다. 웹 경로는 `WEB`, 앱 경로는 운영 API면 `ANDROID`, 시연 서버면 `SHOWCASE_APP`이다(계정 삭제 접수의 `source`와 같은 방식). 클라이언트가 보낸 값은 받지 않는다.
- 삭제된 계정은 기록하지 않는다(`assertActive`가 던지는 `ACCOUNT_DELETED` → 410). 기록과 삭제는 같은 계정 잠금을 잡아 직렬화되므로 삭제 뒤에 행이 생기지 않는다.
- **기존 쓰기 요청은 막지 않는다.** 서버는 `required`를 알려 줄 뿐이다.
- Caddy는 `/api/web/consent`를 API로 넘기고 `Cache-Control: no-store`·`noindex`를 붙인다(`@webSession`·`@privateSurface` 목록에 더한다).

## 4. 동의 화면

### 4.1 문구 (앱·웹 공통 내용)

화면에 보이는 필수 항목 세 개(선택 동의 없음). 세 개를 모두 눌러야 "동의하고 시작"이 켜진다.

1. 만 14세 이상입니다.
2. 이용약관에 동의합니다. (이용약관 보기 링크)
3. 개인정보 수집·이용에 동의합니다. (개인정보 처리방침 보기 링크)

세 번째 항목 위에 "개인정보 수집·이용 안내" 네 가지를 쉬운 말로 보인다.

- **목적:** 음식점 탐색, 방문 인증과 보상 지급, 로그인 유지, 부정 이용 방지, 계정 삭제 처리
- **항목:** Google 계정 식별자(이메일·이름은 저장하지 않아요), 방문·보상·도감 기록, 로그인 세션. 지갑을 연결하면 공개 지갑 주소, 친구 기능을 쓰면 별명·친구 관계
- **보유 기간:** 계정을 삭제할 때까지. 삭제 요청을 처리하면 삭제하거나 알아볼 수 없게 바꿔요. 세션·삭제 접수 기록·감사 기록 등 세부 기간은 처리방침에서 확인할 수 있어요
- **거부할 권리와 불이익:** 동의하지 않을 수 있어요. 동의하지 않으면 로그인이 필요한 방문 인증·도감·보상을 쓸 수 없어요. 언제든 로그아웃하거나 동의 없이 나갈 수 있어요

문구는 앱(`apps/mobile/src/privacy/consent-copy.ts`)과 웹(`apps/production-web/assets/production.mjs`) 각각에 한 번씩 있고, 두 곳의 네 항목 표제가 같은지 시험이 본문을 읽어 비교한다.

### 4.2 앱 (운영 `kr.masscom.wolgye`·시연 `.demo` 공통 코드)

- 로그인(`signedIn`) 직후 `GET /me/consent`로 확인한다. `required`면 메인 탭·시연 점주 화면보다 **앞에** 전체 화면 `ConsentScreen`을 보인다(`_layout.tsx`의 `AuthenticatedRoot`). 확인하는 동안은 상태 안내가 있는 로딩 화면이다. 확인이 실패하면 오류 문구·"다시 시도"·"로그아웃"을 보인다(막힌 채로 두지 않고 나갈 길을 둔다). 서버가 옛 버전이라 404면 실패와 같이 취급한다(배포 순서가 API 먼저다).
- "동의하고 시작"은 `POST /me/consent`를 보낸다. 성공하면 게이트를 풀고 다음 실행 때도 서버가 `required=false`로 답한다(기기에는 아무것도 저장하지 않는다).
- 접근성: 각 체크박스 줄은 `accessibilityRole="checkbox"`와 `accessibilityState.checked`·`accessibilityLabel`을 갖고, 링크는 `accessibilityRole="link"`와 힌트, 버튼은 비활성 상태를 스크린리더가 읽는다. 상태 메시지는 `accessibilityLiveRegion="polite"`. 세로 스크롤 화면이라 글자 200%에서도 잘리지 않고, 줄 높이를 고정하지 않으며 눌러야 하는 곳은 48dp 이상이다.
- 링크는 `Linking.openURL('https://www.masscom.kr/terms')`·`/privacy`로 열고, 열지 못하면 화면에 알린다(계정 삭제 안내 링크와 같은 방식).
- **내 정보(계정 설정)**에 "이용약관"·"개인정보 처리방침"·"계정 삭제 안내" 링크 세 개를 둔다. 계정 삭제 안내 링크는 운영 앱에는 이미 "웹에서 계정 삭제 요청"이 있고 시연 앱에는 앱 안 요청 화면이 있으므로, 새 카드가 삭제 요청 화면을 대신하지 않고 안내 페이지(`/account-deletion`) 링크만 더한다.

### 4.3 웹 `/app/`

로그인 쿠키가 있으면 도감을 읽기 전에 `GET /api/web/consent`를 부른다. 401이면 지금처럼 로그인 안내, `required`면 도감 대신 같은 동의 폼(체크박스 세 개, `<label>`, 링크, 비활성 버튼, `role="status"` 안내)을 보인다. 폼 제출은 `POST /api/web/consent`(같은 출처·JSON)이며 성공하면 도감을 다시 읽는다. 푸터에 이용약관·개인정보 처리방침·계정 삭제 안내 링크를 둔다. 관리자·점주 웹(`/admin/`·`/merchant/`)은 이번 범위 밖이다(고객 기능이 아니다).

## 5. 보관 기간 정리 명령 (API CLI)

`apps/api/src/postgres/retention.ts`(서비스)와 `retention-command.ts`(명령). `admin:deletion`처럼 `npm run admin:retention`(tsx)과 컴파일된 `node dist/postgres/retention-command.js`(호스트)가 있다. 하위 명령은 `run`(삭제)과 `report`(지우지 않고 개수만).

한 단계마다 **하나의 거래**로 지운다. 한 단계가 실패해도 나머지 단계는 계속하고, 마지막에 실패한 단계 이름만 출력하며 종료 코드 1로 끝난다. 출력은 `단계<TAB>개수`뿐이다(계정 ID·행 ID·접수번호를 출력하지 않는다). 기준 시각은 명령이 시작할 때 한 번 정한다.

| 단계 | 지우는 것 | 기준 | 안전한 이유 |
| --- | --- | --- | --- |
| `auth_sessions` | 앱 로그인 세션 | `expires_at <= now` 또는 `revoked_at IS NOT NULL` | 로그인 때마다 이미 같은 조건으로 100건씩 지우는 정리(`cleanupStaleSessions`)와 같은 조건이다. 만료·해지된 토큰은 어차피 인증에 쓰이지 않는다 |
| `web_sessions` | 웹 로그인 세션 | 같음 | 웹에는 정리가 없어 쌓이기만 했다. 인증 조회가 `revoked_at IS NULL AND expires_at > now`만 쓴다 |
| `deletion_intake` | 처리·취소·거절된 삭제 접수 | `status <> 'REQUESTED'` 이고 끝난 시각(`processed_at`, 없으면 `cancelled_at`)이 1년보다 오래됨 | 끝난 행에는 계정 ID가 이미 없다(0031의 CHECK). 활성 접수(`REQUESTED`)와 계정 삭제 원장은 건드리지 않는다. 이 행을 참조하는 외래 키가 없다(참조하는 쪽이다) |
| `admin_audit` | `platform_admin_audit` | `created_at`이 1년보다 오래됨 | 쓰기만 하는 표이고 이를 참조하는 외래 키·읽는 코드가 없다 |
| `admin_role_audit` | `platform_admin_role_audit` | 같음 | 같음 |
| `staff_registration_audit` | `staff_registration_audit` | 같음 | 같음(`request_id`는 이 표가 참조하는 쪽이며 `ON DELETE SET NULL`) |
| `coupon_audit` | `badge_coupon_audit` | 같음 | 아래 참고 |

**`badge_coupon_audit`을 지워도 되는 이유(Issue의 "필요한 곳이 없을 때만"):** 이 표를 읽는 코드는 한 곳이다. 쿠폰 사용 되돌리기가 이미 되돌려진 쿠폰을 다시 요청받았을 때 "이미 되돌렸다"고 멱등하게 답하려고 `REDEMPTION_UNDONE` 행을 찾는다(`reversal.ts`). 되돌리기는 사용 처리 뒤 10분 안에만 되므로 1년이 지난 행이 필요한 재시도는 없다. 그 행이 사라진 뒤 아주 늦은 재요청은 멱등 응답 대신 409 `COUPON_NOT_REDEEMED`를 받을 뿐 상태는 바뀌지 않는다. 쿠폰 자체(`badge_coupons`)의 사용·무효 상태와 처리자·시각 열은 그대로 남는다. 나머지 행 종류(`VOIDED_ON_RECOUNT`·`REISSUED_AFTER_RECOUNT`)는 읽는 곳이 없다.

**Issue에 없던 두 표(구현 선택):** `platform_admin_role_audit`·`staff_registration_audit`도 "관리자 처리·감사 기록"이다. 이 둘을 남겨 두면 처리방침의 "관리자 처리·감사 기록 1년" 문장이 거짓이 되므로 같은 기준으로 함께 지운다. 1년은 개인정보의 안전성 확보조치 기준 제8조의 접속기록 **최소** 보관 기간이라 그 뒤 지우는 것은 기준에 맞다.

**지우지 않는 것(그리고 처리방침에 적는 것):** 계정 삭제 원장 `account_deletion_requests`(계정 식별자의 HMAC 해시·가명 별칭·처리 결과)는 삭제된 계정이 다시 살아나지 않게 하고 제출된 발행 작업과 대조하려고 계속 보관한다. 삭제 처리 때 가명으로 바꾼 방문·쿠폰·수령 기록도 발급 수·정원 집계와 중복 발행 방지 때문에 남는다. 이는 이미 처리방침 5절에 적혀 있고 이번에 보관 기간 표에 다시 적는다.

**시험(PostgreSQL 통합):** 표마다 경계 시각에서 정확히 무엇이 지워지고 무엇이 남는지 증명한다. 1년보다 1밀리초 오래된 행은 지워지고 정확히 1년인 행과 1밀리초 젊은 행은 남는다. 만료 정확히 지금인 세션은 지워지고 1밀리초 뒤 만료되는 세션은 남는다. `REQUESTED` 접수와 삭제 원장은 아무리 오래돼도 남는다. `report`는 아무것도 지우지 않는다. 출력에 계정·행 식별자가 없다.

## 6. 호스트 정리 작업 (운영·시연)

같은 Lightsail 호스트에 운영(`/opt/masscom`)과 시연(`/opt/masscom-showcase`)이 따로 있으므로 각자의 폴더에 작업을 둔다.

- `infra/lightsail/host-jobs/`와 `infra/showcase-host/host-jobs/`에 각각 `masscom-retention.sh`, systemd `masscom-retention.service`·`masscom-retention.timer`, `install.sh`를 둔다.
- 스크립트 두 단계(하루 한 번, 한 단계가 실패해도 다음 단계를 하고 마지막에 실패를 종료 코드로 알린다):
  1. **DB 정리:** compose 레이블(`com.docker.compose.project`·`service`)로 실행 중인 API 컨테이너를 찾아(`deploy-lightsail.sh`가 쓰는 방식) 컨테이너 안에서 `node dist/postgres/retention-command.js run`을 실행한다. 컨테이너에 `DATABASE_URL`이 이미 있으므로 비밀을 호스트 파일에서 읽지 않는다. 컨테이너가 하나가 아니면 실행하지 않고 실패한다.
  2. **백업 30일 정리:** 백업 폴더(`/opt/masscom/backups`, 시연은 `/opt/masscom-showcase/backups`) **바로 아래의 일반 파일 중 `*.dump*`**이고 수정 시각이 30일(43200분)보다 오래된 것만 지운다. 하위 폴더, 심볼릭 링크, 다른 이름의 파일은 건드리지 않는다. 지운 개수만 출력한다.
- **환경 백업은 지우지 않는다(구현 선택):** `runtime-before-*.env.*`(비밀 포함)·`caddyfile-before-*`·`caddy-rollback-*.yml.*`은 이 작업 대상이 아니다. 배포 롤백 뒤에는 실행 중인 Caddy가 이 백업 파일을 마운트로 물고 있을 수 있어(`deploy-lightsail.sh`의 `compose_old_caddy`) 지우면 다음 배포의 사전 검사(`old_caddyfile_source` 파일 존재)가 깨진다. 환경 백업의 비밀은 개인정보가 아니라 처리방침의 약속 밖이다. 정리 정책은 소유자와 따로 정한다.
- **설치는 한 번, 서버에서 손으로:** `sudo bash /opt/masscom/current/infra/lightsail/host-jobs/install.sh`(시연은 시연 release 폴더의 `infra/showcase-host/host-jobs/install.sh`). 스크립트를 `/usr/local/sbin/`에, 유닛을 `/etc/systemd/system/`에 복사하고 `systemctl daemon-reload`·`enable --now`를 한다. **이 저장소 작업은 설치를 실행하지 않는다.** 배포 스크립트도 자동으로 설치하지 않는다(서버 시스템 설정 변경이므로 소유자가 한 번 실행한다). 매일 19:20 UTC(04:20 KST, 시연은 19:35)에 돌고 `Persistent=true`로 꺼져 있던 동안의 실행을 다음 부팅에 만회한다.
- 스크립트는 저장소 시험(`tests/ops/host_retention_job_test.sh`)이 가짜 `docker`로 실행해 컨테이너 선택·명령·백업 삭제 범위를 확인한다.

## 7. 컨테이너 로그 순환 (compose)

운영·시연 compose의 `postgres`·`api`(시연은 `showcase-api`)·`production-web`·`caddy`에 공통 `logging`을 둔다: `json-file`, `max-size: 10m`, `max-file: 3`(`x-logging` 앵커).

- **실제 한도:** 컨테이너마다 최대 30 MB(10 MB 파일 3개)이며 차면 가장 오래된 조각부터 사라진다. 이는 **용량 기준**이다. 시간 기준 삭제는 없다. 컨테이너를 다시 만들면 그 컨테이너의 로그도 함께 사라지고(배포 때 api·web·caddy가 다시 만들어진다) PostgreSQL은 다시 만들지 않는다.
- **접속 기록이 없다는 사실:** 운영 `Caddyfile`에는 `log` 지시문이 없어 Caddy 2.10.2는 요청별 접속 기록(access log)을 남기지 않는다(같은 형태의 설정으로 로컬 Caddy 2.10.2에 요청을 보내 표준 출력에 요청 줄이 없음을 확인했다. 운영 서버 실측은 `NOT_RUN`). API는 시작·처리하지 못한 오류(오류 이름만, 계정·토큰 없음)만 출력한다. 따라서 Issue의 "접속 로그 3개월 이내 순환"은 **접속 기록을 남기지 않는 구성 + 남는 컨테이너 로그의 용량 한도**로 지킨다. "3개월"이라는 **시간 보장은 하지 않으며** 처리방침에도 쓰지 않는다. 실제 값(용량 한도, 시간 기준 없음)을 쓴다.
- 이 값은 컨테이너를 **다시 만들어야** 적용된다(다음 배포 때 api·web·caddy, PostgreSQL은 `up -d`로 별도). 적용 확인은 `docker inspect --format '{{.HostConfig.LogConfig}}'`다.

## 8. 개인정보처리방침 변경 (`docs/privacy.html`)

- 5절 마지막의 "보관 기간이 확정되지 않았습니다" 문장과 상단 경고의 "보관 기간… 확정" 문구, 되돌리기 기록의 "보관 기간은 아직 정하지 않았습니다" 문장을 지우고 **보관 기간 표**(Issue 결정 5 + 위 6·7절의 실제 값)를 넣는다.
- 4절 OpenAI 항목의 문의 연락처를 채운다(공식 한국 부록 2026-03-27 기준): 개인정보처리자 OpenAI OpCo, L.L.C.(1455 3rd Street, San Francisco, CA, USA), `privacy@openai.com`, 국내대리인 오픈에이아이코리아 유한회사 `privacykorea@openai.com`·02-722-3599.
- 동의 기록(항목·목적·보관·삭제)을 1·2·5절에 추가하고 이용약관 링크(`terms.html`)를 머리글·바닥글에 더한다. 시행일·변경 이력 줄에 이번 변경(이용약관·동의 기록·보관 기간)을 더하고 버전을 `privacy-2026-09-30`으로 명시한다. 기존 문장은 모두 사실 그대로 유지한다.

## 9. 배포 순서와 호환

1. **migration 0033 + API 먼저.** 새 표뿐이라 옛 API·옛 앱이 그대로 동작한다. 새 API는 옛 앱이 모르는 경로만 더한다. `scripts/deploy-lightsail.sh`가 migration 호환 증거 `backward_compatible=yes`를 요구하는데, 0033은 표 추가 하나라 성립한다(0032와 독립).
2. **웹(`/app/` 동의 폼·`/terms`·처리방침)**은 API가 나간 뒤(`/api/web/consent`가 있어야 폼이 동작한다).
3. **새 앱(운영·시연 APK).** 옛 앱은 동의 화면 없이 계속 동작하고, 서버는 옛 앱의 쓰기를 막지 않는다.
4. **호스트 정리 작업 설치.** API 이미지에 `retention-command.js`가 들어간 뒤 서버에서 한 번 `install.sh`.
5. **compose `logging`**은 다음 배포에서 컨테이너가 다시 만들어질 때 적용된다.

롤백: 표는 남고 무해하다. 새 API를 내려도 앱·웹의 동의 확인이 실패하면 화면이 "다시 시도/로그아웃"을 보인다(막힘). 그 경우 앱·웹도 함께 이전 버전으로 돌린다.

## 10. 이번에 하지 않는 것

- 서버의 쓰기 요청 차단(후속 Issue, 옛 앱 정리 뒤).
- 선택 동의·마케팅 동의·약관 동의 철회 화면(철회는 계정 삭제로 한다).
- 점주·관리자 웹의 동의 화면.
- 환경 백업(`runtime-before-*.env.*`)·시간 기준 컨테이너 로그 삭제·Caddy 파일 로그.
- 호스트 작업의 설치·서버 실측(소유자가 배포 뒤 실행하고 확인한다).

## 11. 검증

- API 단위·PostgreSQL 통합(`masscom_253_test`): 동의 기록·멱등·버전 변경 시 `required`·세 값 거부·삭제된 계정·계정 삭제 뒤 행 삭제·경로 값, 정리 명령의 경계 시각별 삭제 범위, 라우트 검사(웹 출처·본문 형식).
- 모바일: 문구·API 클라이언트·게이트 상태 판단 단위 시험, 화면 접근성 의미 검사, 타입·린트.
- 웹: `/app/` 동의 폼 시험(가짜 fetch), `/terms` 공개 번들·접근성·포털 시험, Caddy 경로 시험.
- 운영·시연 실측(배포된 서버·설치본)은 `NOT_RUN`으로 남기고 배포 뒤 소유자·오케스트레이터가 채운다.
