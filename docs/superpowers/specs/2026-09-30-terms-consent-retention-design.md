# 이용약관·개인정보 동의와 보관 기간 강제 설계 (Issue #253)

2026-09-30 소유자가 실제 운영 전 꼭 필요한 기능(P0) 다섯 번째로 "추천방식으로 다 해줘"라고 승인했다(`USER_CONFIRMED`, [Issue #253](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/253), 결정 [D-059](../../DECISIONS.md)). 이 문서는 그 7개 항목의 구현 방식을 정한다. 소유자가 정한 것은 Issue 본문의 결정 표이고, 아래에서 "구현 선택"이라고 적은 것은 에이전트가 그 범위 안에서 정했으며 소유자가 확인하지 않았다.

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

> 2026-10-01 갱신: PR #257 인수([D-061](../../DECISIONS.md))로 처리방침에 사진·목소리 수집품 처리 안내를 더해 `CURRENT_PRIVACY_VERSION`을 `privacy-2026-10-01`로 올렸다. 위 값은 설계 당시 기록이다.

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
- **항목:** Google 계정 식별자(이메일·이름은 저장하지 않아요), 방문·보상·도감 기록, 로그인 세션. 지갑을 연결하면 공개 지갑 주소, 친구 기능을 쓰면 별명·친구 관계 등(자세한 항목은 개인정보 처리방침)
- **보유 기간:** 계정을 삭제할 때까지. 삭제 요청을 처리하면 삭제하거나 알아볼 수 없게 바꿔요. 세션·삭제 접수 기록·감사 기록 등 세부 기간은 처리방침에서 확인할 수 있어요
- **거부할 권리와 불이익:** 동의하지 않을 수 있어요. 동의하지 않으면 로그인이 필요한 방문 인증·도감·보상을 쓸 수 없어요. 언제든 로그아웃하거나 동의 없이 나갈 수 있어요

문구는 앱(`apps/mobile/src/privacy/consent-copy.ts`)과 웹(`apps/production-web/assets/production.mjs`) 각각에 한 번씩 있고, 두 곳의 네 항목 표제가 같은지 시험이 본문을 읽어 비교한다.

### 4.2 앱 (운영 `kr.masscom.wolgye`·시연 `.demo` 공통 코드)

- 로그인(`signedIn`) 직후 `GET /me/consent`로 확인한다. `required`면 메인 탭·시연 점주 화면보다 **앞에** 전체 화면 `ConsentScreen`을 보인다(`_layout.tsx`의 `AuthenticatedRoot`). 확인하는 동안은 상태 안내가 있는 로딩 화면이다. 확인이 실패하면 오류 문구·"다시 시도"·"로그아웃"을 보인다(막힌 채로 두지 않고 나갈 길을 둔다). 서버가 옛 버전이라 404면 실패와 같이 취급한다(배포 순서가 API 먼저다).
- "동의하고 시작"은 `POST /me/consent`를 보낸다. 성공하면 게이트를 풀고 다음 실행 때도 서버가 `required=false`로 답한다(기기에는 아무것도 저장하지 않는다).
- 접근성: 각 체크박스 줄은 `accessibilityRole="checkbox"`와 `accessibilityState.checked`·`accessibilityLabel`을 갖고, 링크는 `accessibilityRole="link"`와 힌트, 버튼은 비활성 상태를 스크린리더가 읽는다. 상태 메시지는 `accessibilityLiveRegion="polite"`. 세로 스크롤 화면이라 글자 200%에서도 잘리지 않고, 줄 높이를 고정하지 않으며 눌러야 하는 곳은 48dp 이상이다.
- 확인 실패·앱 업데이트 필요 화면의 로그아웃 버튼은 동의를 거부한 것이 아니므로 중립적인 "로그아웃"이라 부르고, 동의 양식 화면에서만 "동의하지 않고 로그아웃"이라 한다. 체크 상자는 시스템 글자 크기에 비례해 커진다(최대 2.5배, `allowFontScaling=false`는 쓰지 않는다). 동의를 물을지 정하는 판단은 순수 함수 `shouldAskConsent`(`consent-flow.ts`)이며 첫 로그인·같은 계정·계정 전환·로그아웃 뒤 다른 계정·API 없음·DEMO를 시험한다.
- 링크는 `Linking.openURL('https://www.masscom.kr/terms')`·`/privacy`로 열고, 열지 못하면 화면에 알린다(계정 삭제 안내 링크와 같은 방식).
- **내 정보(계정 설정)**에 "이용약관"·"개인정보 처리방침"·"계정 삭제 안내" 링크 세 개를 둔다. 계정 삭제 안내 링크는 운영 앱에는 이미 "웹에서 계정 삭제 요청"이 있고 시연 앱에는 앱 안 요청 화면이 있으므로, 새 카드가 삭제 요청 화면을 대신하지 않고 안내 페이지(`/account-deletion`) 링크만 더한다.

### 4.3 웹 `/app/`

로그인 쿠키가 있으면 도감을 읽기 전에 `GET /api/web/consent`를 부른다. 401이면 지금처럼 로그인 안내, `required`면 도감 대신 같은 동의 폼(체크박스 세 개, `<label>`, 링크, 비활성 버튼, `role="status"` 안내)을 보인다. 폼 제출은 `POST /api/web/consent`(같은 출처·JSON)이며 성공하면 도감을 다시 읽는다. 푸터에 이용약관·개인정보 처리방침·계정 삭제 안내 링크를 둔다. 관리자·점주 웹(`/admin/`·`/merchant/`)은 이번 범위 밖이다(고객 기능이 아니다).

접근성 동작(독립 리뷰 반영): 꺼진 "동의하고 시작" 버튼 위에 보이는 안내("세 가지를 모두 선택하면 눌러 시작할 수 있어요.")를 두고 버튼의 `aria-describedby`가 그것을 가리킨다. 새 탭으로 열리는 약관·처리방침 링크는 이름에 "(새 탭)"을 넣는다. 동의 안내 줄(`role="status"`)은 비어 있어도 `display:none`으로 접근성 트리에서 빼지 않는다. 동의 화면이 나타나면 초점을 머리글로, 동의로 사라지면 본문(`#main`)으로 옮긴다. 약관을 새 탭에서 읽고 돌아올 때(`visibilitychange`)는 눌러 둔 체크를 남기고, 다른 탭의 로그인·로그아웃 알림(`BroadcastChannel` `refresh`)이 오면 계정이 바뀌었을 수 있으므로 체크를 지운다.

## 5. 보관 기간 정리 명령 (API CLI)

`apps/api/src/postgres/retention.ts`(서비스)와 `retention-command.ts`(명령). `admin:deletion`처럼 `npm run admin:retention`(tsx)과 컴파일된 `node dist/postgres/retention-command.js`(호스트)가 있다. 하위 명령은 `run`(삭제)과 `report`(지우지 않고 개수만).

한 단계마다 **하나의 거래**로 지운다. 한 단계가 실패해도 나머지 단계는 계속하고, 마지막에 실패한 단계 이름만 출력하며 종료 코드 1로 끝난다. 출력은 `단계<TAB>개수`뿐이다(계정 ID·행 ID·접수번호를 출력하지 않는다). 기준 시각은 명령이 시작할 때 한 번 정하고 시각 계산은 UTC로 고정한다.

**기간은 종류별로 세 가지다.** 개인정보의 안전성 확보조치 기준 제5조 제3항은 접근권한을 부여·변경·말소한 기록을 **최소 3년** 보관하라고 하므로(독립 보안 리뷰의 지적) 그 기록은 3년, 그 밖의 처리·감사 기록은 제8조의 접속기록 최소 기간인 1년, 만료된 일회용 행은 만료 1일 뒤다.

| 단계 | 지우는 것 | 기준 | 안전한 이유 |
| --- | --- | --- | --- |
| `auth_sessions` | 앱 로그인 세션 | `expires_at <= now` 또는 `revoked_at IS NOT NULL` | 로그인 때마다 이미 같은 조건으로 100건씩 지우는 정리(`cleanupStaleSessions`)와 같은 조건이다. 만료·해지된 토큰은 어차피 인증에 쓰이지 않는다 |
| `web_sessions` | 웹 로그인 세션 | 같음 | 웹에는 정리가 없어 쌓이기만 했다. 인증 조회가 `revoked_at IS NULL AND expires_at > now`만 쓴다 |
| `deletion_intake` | 처리·취소·거절된 삭제 접수 | `status <> 'REQUESTED'` 이고 끝난 시각(`processed_at`, 없으면 `cancelled_at`)이 **1년**보다 오래됨 | 끝난 행에는 계정 ID가 이미 없다(0031의 CHECK). 활성 접수(`REQUESTED`)와 계정 삭제 원장은 건드리지 않는다. 이 행을 참조하는 외래 키가 없다(참조하는 쪽이다) |
| `admin_audit` | `platform_admin_audit` 중 점주 지정·해제를 뺀 행 | `created_at`이 **1년**보다 오래됨, `action NOT IN ('MERCHANT_OWNER_GRANTED','MERCHANT_OWNER_REVOKED')` | 쓰기만 하는 표이고 이를 참조하는 외래 키·읽는 코드가 없다 |
| `admin_owner_audit` | `platform_admin_audit` 중 점주 지정·해제(migration 0032) | `created_at`이 **3년**보다 오래됨 | 점포 접근권한의 부여·말소 기록이라 제5조 제3항의 3년 |
| `admin_role_audit` | `platform_admin_role_audit`(관리자 권한 부여·회수) | **3년** | 접근권한 부여·말소 기록, 참조·읽기 없음 |
| `staff_registration_audit` | `staff_registration_audit`(직원 등록 승인·해제) | **3년** | 접근권한 부여·말소 기록(`request_id`는 이 표가 참조하는 쪽이며 `ON DELETE SET NULL`) |
| `coupon_audit` | `badge_coupon_audit` | **1년** | 아래 참고 |
| `customer_identity_tokens` | 고객 확인 QR의 일회용 값(계정 ID를 가짐) | `expires_at`이 **1일**보다 오래됨 | 몇 분 안에 쓰이고 만료된다. 읽는 곳은 둘이다. `customer-identity.ts`는 행이 없거나 만료면 거절하므로 만료 1일 뒤 삭제는 거절 사유를 "만료"에서 "확인 불가"로 바꿀 뿐이다. `claim-slot-service.ts`는 **이미 쓴(consumed) 토큰의 재시도 경로**(:198 근처)가 만료를 확인하지 않고 이미 만든 수령 슬롯을 그대로 돌려주는데, 행이 지워지면 그 재시도는 `CUSTOMER_IDENTITY_UNAVAILABLE`로 거절된다. 즉 삭제는 이 재시도 경로를 **만료 1일 뒤부터 좁힐** 뿐이며(그 전에는 그대로), 몇 분 안에 끝나는 정상 재시도에는 영향이 없다 |
| `wallet_challenges` | 지갑 주소 확인 요청 | `expires_at`이 **1일**보다 오래됨 | 저장소가 새 요청을 만들 때마다 만료 행을 지운다(`create`). 만료 뒤에는 읽는 곳이 없다 |
| `web_oauth_states` | 웹 로그인 진행 상태 | `expires_at`이 **1일**보다 오래됨 | 계정 ID는 없지만 검증 값이 쌓이지 않게 한다. 로그인 시작이 100건씩 지우고 소비는 `expires_at > now`만 본다 |
| `staff_registration_requests` | 직원 등록 요청(계정 ID를 가짐) | `consumed_at` 또는 `expires_at`이 **1일**보다 오래됨 | 승인 조회는 미사용(`consumed_at IS NULL`) 요청만 본다. 감사 표의 `request_id`는 `ON DELETE SET NULL`이다 |

**`badge_coupon_audit`을 지워도 되는 이유(Issue의 "필요한 곳이 없을 때만"):** 이 표를 읽는 코드는 한 곳이다. 쿠폰 사용 되돌리기가 이미 되돌려진 쿠폰을 다시 요청받았을 때 "이미 되돌렸다"고 멱등하게 답하려고 `REDEMPTION_UNDONE` 행을 찾는다(`reversal.ts`). 되돌리기는 사용 처리 뒤 10분 안에만 되므로 1년이 지난 행이 필요한 재시도는 없다. 그 행이 사라진 뒤 아주 늦은 재요청은 멱등 응답 대신 409 `COUPON_NOT_REDEEMED`를 받을 뿐 상태는 바뀌지 않는다. 쿠폰 자체(`badge_coupons`)의 사용·무효 상태와 처리자·시각 열은 그대로 남는다. 나머지 행 종류(`VOIDED_ON_RECOUNT`·`REISSUED_AFTER_RECOUNT`)는 읽는 곳이 없다.

**Issue에 없던 것(구현 선택):** 처리방침의 "관리자 처리·감사 기록" 문장이 사실이 되도록 `platform_admin_role_audit`·`staff_registration_audit`도 같은 명령이 지운다. 일회용 행 넷은 계정 ID를 남길 수 있는 표를 정리하는 데서 더했다(독립 리뷰 요청).

**지우지 않는 것(그리고 처리방침에 적는 것):** 계정 삭제 원장 `account_deletion_requests`(계정 식별자의 HMAC 해시·가명 별칭·처리 결과)는 삭제된 계정이 다시 살아나지 않게 하고 제출된 발행 작업과 대조하려고 계속 보관한다. 삭제 처리 때 가명으로 바꾼 방문·쿠폰·수령 기록도 발급 수·정원 집계와 중복 발행 방지 때문에 남는다. 이는 이미 처리방침 5절에 적혀 있고 이번에 보관 기간 표에 다시 적는다.

**시험(PostgreSQL 통합):** 표마다 그 표의 기간(1년·3년·1일) 경계 시각에서 정확히 무엇이 지워지고 무엇이 남는지 증명한다. 기간보다 1밀리초 오래된 행은 지워지고 정확히 경계인 행과 1밀리초 젊은 행은 남는다. 2년 된 접근권한 행은 남고 2년 된 처리 기록은 지워진다(같은 `platform_admin_audit`에서 `action`으로 갈린다). 만료 정확히 지금인 세션은 지워지고 1밀리초 뒤 만료는 남는다. `REQUESTED` 접수와 삭제 원장은 아무리 오래돼도 남는다. `report`는 아무것도 지우지 않는다. 출력에 계정·행 식별자가 없다.

## 6. 호스트 정리 작업 (운영·시연)

같은 Lightsail 호스트에 운영(`/opt/masscom`)과 시연(`/opt/masscom-showcase`)이 따로 있으므로 각자의 폴더에 작업을 둔다.

- `infra/lightsail/host-jobs/`와 `infra/showcase-host/host-jobs/`에 각각 `masscom-retention.sh`, systemd `.service`·`.timer`, `install.sh`를 둔다.
- 스크립트 두 단계(하루 한 번, 한 단계가 실패해도 다음 단계를 하고 마지막에 실패를 종료 코드로 알린다):
  1. **DB 정리:** compose 레이블(`project`·`service`·`oneoff=False`)로 실행 중인 API 컨테이너를 찾아 컨테이너 안에서 `node dist/postgres/retention-command.js run`을 실행한다. 컨테이너에 `DATABASE_URL`이 이미 있으므로 비밀을 호스트 파일에서 읽지 않는다. 컨테이너가 하나가 아니면 실행하지 않고 실패한다.
  2. **백업 30일 정리:** 백업 폴더(`/opt/masscom/backups`, 시연은 `/opt/masscom-showcase/backups`) **바로 아래의 일반 파일 중 이름이 `*.dump` 또는 `*.dump.*`**이고 수정 시각이 30일(43200분)보다 오래된 것만 **`find … -delete` 한 명령으로** 지운다(고른 이름을 나중에 `rm`에 넘기지 않는다). 하위 폴더·심볼릭 링크·다른 이름은 건드리지 않는다. 지운 개수만 출력한다. 30일이 지난 백업은 다음 날 정리 때 삭제되며, 30일 넘게 배포가 없으면 남는 DB 백업이 없다(운영자 유의).
- **환경 백업은 지우지 않는다(구현 선택):** `runtime-before-*.env.*`(비밀 포함)·`caddyfile-before-*`·`caddy-rollback-*.yml.*`은 이 작업 대상이 아니다. 배포 롤백 뒤에는 실행 중인 Caddy가 그 파일을 마운트로 물고 있을 수 있어(`deploy-lightsail.sh`의 `compose_old_caddy`) 지우면 다음 배포의 사전 검사(`old_caddyfile_source` 파일 존재)가 깨진다. 환경 백업의 비밀은 개인정보가 아니라 처리방침의 약속 밖이다. 정리 정책은 소유자와 따로 정한다.
- **재정의는 시험 표시가 있을 때만:** `MASSCOM_DOCKER`·`MASSCOM_BACKUP_DIR` 같은 환경 변수는 `MASSCOM_RETENTION_TEST=1`을 명시할 때만 받는다. systemd에서는 환경에 무엇이 있든 고정된 경로·기간·`docker`만 쓴다.
- **유닛은 권한을 좁힌다:** `UMask=0077`, `NoNewPrivileges`, `PrivateTmp`, `PrivateDevices`, `ProtectSystem=strict`, `ReadWritePaths=<그 스택의 백업 폴더>`(쓸 수 있는 곳은 그것 하나), `ProtectHome=read-only`, `ProtectKernelTunables`·`Modules`·`ControlGroups`, `RestrictSUIDSGID`, `LockPersonality`. docker 소켓 연결은 읽기 전용 마운트에서도 되므로 `ProtectSystem=strict`와 함께 동작하고, 소켓 경로를 막는 설정(`InaccessiblePaths`·`PrivateNetwork` 등)은 두지 않는다. 백업 폴더가 없으면 `ReadWritePaths`가 유닛 시작을 막으므로 `install.sh`가 먼저 만든다.
- **운영은 배포가 설치·확인한다:** `scripts/deploy-lightsail.sh`가 배포 성공 뒤 그 릴리스의 `host-jobs/install.sh`를 다시 실행하고(멱등: 스크립트·유닛을 그 릴리스 것으로 맞추고 timer를 켠다) `systemctl is-enabled masscom-retention.timer`를 읽기 전용으로 확인한 뒤 설치한 작업을 바로 한 번 실행(`systemctl start masscom-retention.service`)해 `systemctl show -p Result --value`가 `success`인지 확인한다(매일 작업과 같은 일이라 켜져만 있고 실제로는 실패하는 작업을 통과시키지 않는다). 실패하면 이미 올라간 릴리스는 되돌리지 않고 `HOST_JOB_INSTALL_FAILED`로 배포를 실패로 알린다(처리방침의 "서버의 정리 작업" 문장은 이 timer가 켜져 있어야 사실이다). 배포 스크립트가 systemd에 직접 하는 일은 그 읽기 전용 확인과 설치한 작업의 첫 실행·결과 읽기뿐이다(활성화·중지·재시작은 `install.sh`만 한다). `install.sh --verify`는 마지막 실행 결과(`Result`)도 보고하고 `success`가 아니거나 한 번도 실행하지 않았으면(`ExecMainStartTimestamp`가 비어 있음) 실패한다(설치 → 한 번 실행 → 확인 순서). 저장소 시험은 systemd를 기동하지 못하므로 유닛의 하드닝은 서버에서 `systemd-analyze verify`와 실제 한 번 실행으로 확인한다(운영은 처음 배포 뒤, 시연은 게시 전 관문).
- **시연은 소유자가 손으로:** 시연에는 배포 스크립트가 없으므로 시연 API를 교체할 때마다 그 릴리스 폴더의 `install.sh`를 실행하고 `install.sh --verify`(읽기 전용: timer가 켜져 있고 스크립트·유닛이 그 릴리스와 같은지)로 확인한다. 절차는 `infra/showcase-host/README.md`에 있다.
- 스크립트·설치·배포 동작은 저장소 시험(`tests/ops/host_retention_job_test.sh`의 가짜 `docker`, `tests/ops/deploy_lightsail_rollback_test.sh`의 원격 스크립트 모의)이 확인한다.

## 7. 컨테이너 로그 순환과 PostgreSQL 오류 로그 (compose)

운영·시연 compose의 `postgres`·`api`(시연은 `showcase-api`)·`production-web`·`caddy`에 공통 `logging`을 둔다: `json-file`, `max-size: 10m`, `max-file: 3`(`x-logging` 앵커). 두 compose의 `postgres`에는 `command: ["postgres", "-c", "log_error_verbosity=terse", "-c", "log_min_error_statement=panic"]`도 있어 오류 로그에 오류가 난 행의 값(`DETAIL`)과 실패한 SQL 문이 남지 않는다(로컬 PostgreSQL 16.10에서 확인: 클라이언트는 `DETAIL`을 받지만 서버 로그에는 `ERROR` 한 줄만 남고 `STATEMENT` 줄이 없다). 다만 `invalid input syntax for type uuid: "…"`처럼 메시지 본문에 입력값이 들어가는 오류는 그 값이 남는다(처리방침에 그대로 적는다).

- **실제 한도:** 컨테이너마다 최대 30 MB(10 MB 파일 3개)이며 차면 가장 오래된 조각부터 사라진다. 이는 **용량 기준**이다. 시간 기준 삭제는 없다. 컨테이너를 다시 만들면 그 컨테이너의 로그도 함께 사라진다.
- **접속 기록이 없다는 사실:** 운영 `Caddyfile`에는 `log` 지시문이 없어 Caddy 2.10.2는 요청별 접속 기록(access log)을 남기지 않는다(같은 형태의 설정으로 로컬 Caddy 2.10.2에 요청을 보내 표준 출력에 요청 줄이 없음을 확인했다. 운영 서버 실측은 `NOT_RUN`). API는 시작·처리하지 못한 오류(오류 이름만, 계정·토큰 없음)만 출력한다. 따라서 Issue의 "접속 로그 3개월 이내 순환"은 **접속 기록을 남기지 않는 구성 + 남는 컨테이너 로그의 용량 한도**로 대신했고, **"3개월"이라는 시간 보장은 하지 않으며** 처리방침에도 쓰지 않는다. 이 이탈은 D-059에 `PROPOSED`(소유자 확인 대기)로 기록한다.
- **적용은 배포가 확인한다:** 컨테이너는 compose 파일이 바뀌어도 저절로 다시 만들어지지 않는다. 운영 배포는 api·web·caddy를 새 이미지로 다시 만들 때 로그 설정이 적용되고, **PostgreSQL은 사전 백업이 검증된 뒤 `docker inspect`로 `HostConfig.LogConfig`에 `max-size`가 없거나 `Config.Cmd`가 위 명령과 다르면 그 컨테이너만 `up -d --no-deps --wait`로 한 번 다시 만든다**(짧은 DB 재시작). 다시 만든 뒤 설정을 다시 읽고 **같은 데이터 볼륨(이름)과 같은 데이터(적용된 마이그레이션 개수·마지막 파일 이름)가 그대로인지**, `SHOW log_min_error_statement`가 `panic`이고 `SHOW log_error_verbosity`가 `terse`인지 확인하며, 어긋나면 어느 확인이 실패했는지(`POSTGRES_DATA_CHECK_FAILED: baseline|log_settings|volume|fingerprint|min_error_statement|verbosity`) 남기고 마이그레이션 없이 **한 번만** 되돌린다(PostgreSQL도 이전 릴리스의 compose 정의로 한 번 더 다시 만들어진다). 값을 읽는 도우미는 `$(trap - ERR; …)`로 부른다: 옛 bash(3.2)는 명령 치환 안의 실패로 되돌림을 하위 셸과 부모에서 두 번 돌린다. 이미 맞으면 건드리지 않는다. 시연은 소유자가 같은 명령을 절차대로 실행한다(`infra/showcase-host/README.md`).

## 8. 개인정보처리방침 변경 (`docs/privacy.html`)

- 5절 마지막의 "보관 기간이 확정되지 않았습니다" 문장과 상단 경고의 "보관 기간… 확정" 문구, 되돌리기 기록의 "보관 기간은 아직 정하지 않았습니다" 문장을 지우고 **보관 기간 목록**(Issue 결정 5 + 위 5~7절의 실제 값)을 넣는다: 접근권한 기록 3년(제5조 제3항), 그 밖의 처리·감사 기록 1년(제8조), 일회용 확인 기록 만료·사용 1일 뒤, 서버 로그의 용량 기준·DB 오류 로그의 행 값·SQL 문 비기록과 그 예외, 백업 "30일이 지난 백업은 다음 날 정리 때 삭제".
- 4절 OpenAI 항목의 문의 연락처를 채운다(공식 한국 부록 2026-03-27, 오케스트레이터가 2026-09-30 [OpenAI 한국 부록](https://openai.com/ko-KR/policies/kr-privacy-policy-addendum/)과 대조): 개인정보처리자 OpenAI OpCo, L.L.C.(미국 캘리포니아주 샌프란시스코 3번가 1455번지), `privacy@openai.com`, 국내대리인 오픈에이아이코리아 유한회사(서울특별시 강남구 테헤란로 518, 10층) `privacykorea@openai.com`·02) 722-3599.
- 동의 기록(항목·목적·보관·삭제)을 1·2·5절에 추가하고 이용약관 링크(`terms.html`)를 머리글·바닥글에 더한다. 시행일·변경 이력 줄에 이번 변경을 더하고 버전을 `privacy-2026-09-30`으로 명시한다. 기존 문장은 모두 사실 그대로 유지한다.
- **공개 문장은 배포가 끝나면 모두 사실이어야 한다.** 그래서 정리 작업 설치(운영은 배포가 한다)와 DB 로그 설정 적용(운영은 배포가 한다)을 배포 절차에 넣었다. 시연 서버는 소유자가 절차를 실행해야 같은 문장이 사실이 된다.

## 9. 배포 순서, 호환, 롤백

1. **migration 0033 + API 먼저.** 새 표뿐이라 옛 API·옛 앱이 그대로 동작한다. 새 API는 옛 앱이 모르는 경로만 더한다. `scripts/deploy-lightsail.sh`가 migration 호환 증거 `backward_compatible=yes`를 요구하는데, 0033은 표 추가 하나라 성립한다(0032와 독립). 같은 배포가 웹(`/terms`·`/app/` 동의 폼)과 정리 작업 설치, 필요하면 PostgreSQL 로그 설정 적용까지 한다. **웹 전용 배포**(`deploy-lightsail-web.sh`)는 후보 Caddy가 로그인 없는 `/api/web/consent`를 운영 API에서 401로 받는지 확인하고, 404(API에 경로가 없거나 Caddy가 넘기지 않음)나 503이면 멈춘다.
2. **(게시 전 관문) 시연이 먼저:** 운영 배포가 공개하는 처리방침·이용약관은 시연 앱도 다룬다. 그래서 이 커밋의 **시연 API 교체**(migration 0033 자동 적용)와 소유자의 시연 정리 작업 설치·`--verify`·PostgreSQL 재생성·확인을 운영 배포보다 먼저, 늦어도 같은 작업 창 안에서 끝낸다(안 하면 시연 서버에서 공개 문장이 사실이 아니다). 순서상 이 항목이 아래 1번의 운영 배포보다 앞선다.
3. **새 앱(운영·시연 APK).** 옛 앱은 동의 화면 없이 계속 동작하고, 서버는 옛 앱의 쓰기를 막지 않는다.

**롤백:** 표는 남고 무해하다. **API를 0033 이전으로 되돌리면** 새 앱·웹은 `/me/consent`·`/api/web/consent`가 404가 되어 동의 확인이 실패하고 "다시 시도/로그아웃"에 막히므로 **웹과 APK도 함께 이전 버전으로 돌려야 한다.** 또 옛 API의 계정 삭제는 `account_consents`를 지우지 않으므로 옛 API가 도는 동안 삭제 처리된 계정의 동의 행이 남는다. 새 API로 다시 올린 뒤 API 컨테이너 안에서 **한 번** 실행한다: `node dist/postgres/retention-command.js purge-deleted-consents`(`ACCOUNT_DELETION_HMAC_SECRET`이 컨테이너에 있어야 한다). 삭제 원장에는 계정 ID 없이 HMAC 해시만 있으므로 명령이 동의 행의 계정마다 같은 비밀로 해시를 다시 구해 원장과 대조하고, 원장에 있는 계정의 행만 지운 뒤 개수(`deleted_account_consents`)만 출력한다(살아 있는 계정의 행은 지우지 않는다: 시험에서 틀린 비밀로는 0건). 매일 정리에는 넣지 않았다.

**동의 버전을 올릴 때:** 약관·처리방침 본문을 실질적으로 바꿀 때만 올린다. **APK·웹을 새 상수로 먼저 또는 함께 내보낸 뒤에** 서버 상수를 올린다. 서버가 먼저 올라가면 옛 화면은 새 버전을 요구받았을 때 동의를 받지 않고 업데이트를 안내하므로(앱은 이 앱의 문구와 다른 버전이면 `outdated`) 사용자가 막힌다. 올릴 곳: `apps/api/src/account-consent.ts`, `apps/mobile/src/privacy/consent-copy.ts`, `apps/production-web/assets/production.mjs`, `docs/terms.html`·`docs/privacy.html`의 버전 표기(`tests/site/legal-pages.test.mjs`가 다섯 곳이 같은지 본다).

## 10. 이번에 하지 않는 것

- 서버의 쓰기 요청 차단(후속 Issue, 옛 앱 정리 뒤).
- 선택 동의·마케팅 동의·약관 동의 철회 화면(철회는 계정 삭제로 한다).
- 점주·관리자 웹의 동의 화면.
- 환경 백업(`runtime-before-*.env.*`)·시간 기준 컨테이너 로그 삭제·Caddy 파일 로그.
- 개인정보취급자의 접속기록(제8조: 관리자 로그인이 따로 기록되지 않음)의 법률 검토는 후속으로 한다(B-028).
- 호스트 작업의 설치·서버 실측(소유자가 배포 뒤 실행하고 확인한다).

## 11. 검증

- API 단위·PostgreSQL 통합(`masscom_253_test`): 동의 기록·멱등·버전 변경 시 `required`·세 값 거부·삭제된 계정·계정 삭제 뒤 행 삭제·경로 값, 정리 명령의 경계 시각별 삭제 범위, 라우트 검사(웹 출처·본문 형식).
- 모바일: 문구·API 클라이언트·게이트 상태 판단 단위 시험, 화면 접근성 의미 검사, 타입·린트.
- 웹: `/app/` 동의 폼 시험(가짜 fetch), `/terms` 공개 번들·접근성·포털 시험, Caddy 경로 시험.
- 운영·시연 실측(배포된 서버·설치본)은 `NOT_RUN`으로 남기고 배포 뒤 소유자·오케스트레이터가 채운다.
