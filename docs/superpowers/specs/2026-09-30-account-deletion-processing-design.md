# 계정 삭제 요청을 검증된 계정과 연결해 운영자가 처리하기 (Issue #194)

2026-09-30 소유자가 고른 방식(D-052, `USER_CONFIRMED`): **웹 Google 로그인으로 본인 확인 + 운영자 처리.** 앱의 직접 자동 삭제는 Google Credential Manager가 서명된 `auth_time`을 주지 않아 막혀 있고(D-026, `deletion-capability.ts`) 이 설계는 그 보안 조건을 **바꾸지 않는다.** 운영자가 웹 OIDC로 검증된 접수를 처리하는 것은 D-026과 다른 경로이며, 이 경로의 조건은 접수·접수번호 다시 받기·취소에 최근 10분 안의 웹 로그인이 필요하고 삭제는 접수 24시간 뒤 운영자가 처리한다는 것이다(opus 보안 리뷰 반영, §8).

## 1. 목표와 성공 기준

- 앱을 다시 설치하지 않아도 외부 웹에서 기존 Google OIDC 웹 세션으로 요청자를 검증하고, 서버가 세션에서 대상 `account_id`를 정한다(요청 본문의 계정 값은 받지 않는다).
- 접수하면 **접수번호**(한 번만 보이는 무작위 코드)를 받는다. 접수 뒤 **24시간은 취소 기간**이고, 그 뒤 **7일 안에** 운영자가 처리한다. 처리 뒤에는 접수번호만으로 상태를 볼 수 있다(계정·세션이 이미 없기 때문).
- 다른 계정의 접수번호·중복 요청·취소 기간 뒤 취소·처리 전 재접수·네트워크 실패가 타인 데이터 삭제나 가짜 완료를 만들지 않는다.
- 시연 앱은 웹 삭제 페이지와 웹 인증이 없으므로 앱 안 Bearer 세션으로 같은 접수를 하고 같은 방식으로 운영자가 처리한다.

## 2. 데이터 (migration 0031, 추가형·구 API `f1bba2d` 호환)

`account_deletion_intake_requests`(0018: `account_id PK, requested_at`)를 다음처럼 바꾼다.

| 열 | 내용 |
| --- | --- |
| `id uuid PK` | 새 기본 키(`gen_random_uuid()`). 옛 `account_id` PK는 **버리고** 아래 고유 색인으로 대체한다: 처리 뒤 `account_id`를 NULL로 만들어야 하는데 PK 열은 NULL일 수 없기 때문이다. |
| `account_id text NULL` | 고유 색인. `REQUESTED`일 때만 값이 있고 `CANCELLED/PROCESSED/REJECTED`에서는 NULL이다(CHECK). 그래서 처리·취소·거절 뒤에는 원 계정 ID가 이 표에 남지 않는다. |
| `receipt_hash bytea NULL` | 접수번호의 HMAC-SHA256(32바이트). 원문은 저장하지 않는다. 고유 색인. NULL은 이 migration 이전 행(접수번호 없음)뿐이며 그 행은 처리하지 않는다(§7). |
| `status` | `REQUESTED`(기본) / `CANCELLED` / `PROCESSED` / `REJECTED` |
| `source` | `WEB`(기본) / `SHOWCASE_APP` |
| `cancel_until`, `due_at` | `requested_at + 24h`, `+ 7d`(앱이 명시하고, 열 기본값은 `now() + …`이라 구 API의 열 없는 INSERT도 유효) |
| `cancelled_at`, `processed_at`, `processed_by`, `reject_reason`, `deletion_request_id` | 결과 기록. `deletion_request_id`는 `account_deletion_requests(id)`(삭제 ledger)에 대한 참조. `processed_by`는 `admin-web`·`cli:<운영자>`·`self-service`(같은 계정이 최근 재인증으로 직접 삭제한 경우). |

- **구 API 호환:** `INSERT … (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`은 `account_id`의 일반(부분 아닌) 고유 색인이 있으므로 그대로 동작하고, 새 열은 모두 기본값이거나 NULL 허용이다. 구 forget의 `DELETE … WHERE account_id = $1`도 그대로 동작한다(그 행만 지워지고 접수번호 조회는 "없음"이 된다. 구 API는 배포 전환 동안만 산다).
- **활성 요청은 계정당 하나:** `account_id` 고유 색인 + "`REQUESTED`일 때만 `account_id` 존재" CHECK로 계정당 `REQUESTED` 행이 최대 하나다. 취소·거절 뒤에는 행이 계정에서 떨어지므로 새로 접수할 수 있다(이력은 접수번호 해시 행으로 남는다).
- **기존 행:** `REQUESTED`로 유지하고 `cancel_until/due_at`을 채운다(마이그레이션 시각부터 24시간 취소 기간). 접수번호가 없으므로 **처리하지 않고**, 그 계정이 다시 접수하면 접수번호를 새로 발급하며 그때부터 24시간 취소 기간과 7일 처리 기한이 새로 시작한다(§7).
- `platform_admin_audit`: `merchant_id`를 NULL 허용으로 바꾸고(계정 삭제 행동은 점포와 무관) action CHECK에 `ACCOUNT_DELETION_PROCESSED`·`ACCOUNT_DELETION_REJECTED`·`ACCOUNT_DELETION_RECONCILED`를 더한다. 점포 행동은 `merchant_id` 필수를 유지하는 CHECK를 둔다.

## 3. 접수번호

- 형태: Crockford Base32(`0-9A-HJKMNP-TV-Z`, 헷갈리는 I·L·O·U 제외) 16자를 4글자씩 하이픈으로 나눈 `XXXX-XXXX-XXXX-XXXX`(80비트, `crypto.randomBytes`의 하위 5비트라 치우침 없음).
- 조회 입력은 대소문자·하이픈·공백을 무시하고 `O→0`, `I/L→1`로 정규화한 뒤 `HMAC-SHA256(ACCOUNT_DELETION_HMAC_SECRET, "deletion-receipt:" + 정규화값)`으로 색인 조회한다. 알 수 없는 값·형식이 틀린 값 모두 같은 404로 답한다(형식 오라클 없음). 접수번호는 응답 **본문에만** 나오고 URL·로그·Caddy 경로에는 없다.
- **중복 접수 정책(선택·기록):** 이미 `REQUESTED`가 있으면 같은 요청의 상태만 돌려주고 **새 접수번호를 발급하지 않는다**(더블 클릭이 접수번호를 무효로 만들지 않게). 접수번호를 잃어버렸거나 옛 행(접수번호 없음)이면 본문 `{"reissue": true}`(옛 행은 자동)로 **다시 발급**한다: 세션으로 본인이 확인된 경우에만 가능하고 옛 접수번호는 즉시 무효가 된다. 다시 발급은 접수를 새로 만들지 않는다(활성 요청이 없으면 `404 DELETION_NO_ACTIVE_REQUEST`).

## 4. 흐름과 API

접수(운영): `POST /api/web/account-deletion-intake`(웹 세션 쿠키, 동일 `Origin`, JSON) → `202 { receipt?, receiptIssued, status:"REQUESTED", requestedAt, cancelUntil, dueAt }`.
취소: `POST /api/web/account-deletion-intake/cancel` → 세션 계정 본인의 `REQUESTED` 행을 `cancel_until` 이전에만 `CANCELLED`로(`409 DELETION_CANCEL_WINDOW_CLOSED`, 없으면 `404 DELETION_NO_ACTIVE_REQUEST`).
조회: `POST /api/web/account-deletion-status { receipt }` → 로그인 불필요, 상태·날짜·거절 사유·삭제 ledger 상태만(계정 ID·이메일 없음). IP당 분당 30회 제한 뒤 `429`.
세 경로 모두 Origin·JSON 검사(`ORIGIN_FORBIDDEN`)가 있고 Caddy `@webSession`·`@privateSurface`에 더한다.

**시연 앱(Bearer, 시연 서버에서만 켠다):** `POST /account-deletion-intake`(접수·재발급), `GET /account-deletion-intake`(내 활성 요청 상태, 접수번호 없음), `POST /account-deletion-intake/cancel`, `POST /account-deletion-status { receipt }`. **운영 API에는 이 Bearer 경로가 없다**(서비스가 시연 모드에서만 만들어짐): 운영 앱은 D-052에 따라 웹 페이지를 쓴다.

**운영자(웹 관리자, 기존 `/api/web/admin/*` 가드 위):**

- `GET …/account-deletion-intakes`: 대기 건이 먼저, 기한 순. 항목 = `id`, `status`, `source`, 요청·취소 마감·처리 기한, `canProcess`(취소 기간 지남), `overdue`, 마스킹한 계정 표지(`acct_1a2b…9f0e` 형태의 앞 4·뒤 4), 처리 결과. 이메일·전체 ID는 절대 내지 않는다.
- `POST …/account-deletion-intakes/:id/process`: **취소 기간이 지난 뒤에만**(`409 DELETION_COOLING_OFF`). 기존 forget 핵심(`PostgresAccountDeletionService.forgetInTransaction`)을 **세션 `auth_time` 검사 없이** 같은 거래 안에서 실행하고, ledger에 잇고, 행을 `PROCESSED`(계정 ID NULL)로 바꾸고, `platform_admin_audit`에 `ACCOUNT_DELETION_PROCESSED`를 남긴다. 운영자가 자기 접수를 처리하면 `403 DELETION_SELF_PROCESSING_REFUSED`.
- `POST …/account-deletion-intakes/:id/reject { reason }`: 취소 기간과 무관하게 거절 가능, 사유 1~200자, 감사 기록. 자기 접수 거절도 SELF로 거절.
- `POST …/account-deletions/reconcile`: `WAITING_FOR_MINT_FINALITY` ledger를 다시 세어 `COMPLETED`로 진행(기존 `reconcileExistingRequest` 재사용). 기존에는 같은 계정이 다시 요청할 때만 실행돼 삭제 뒤(세션 폐기)에는 영원히 진행되지 않았다. 관리자 화면이 목록을 열 때 자동으로 부른다.

**시연 운영자(CLI):** `npm run admin:deletion --prefix apps/api -- list | process <id> | reject <id> <사유> | reconcile`(호스트는 `node dist/postgres/account-deletion-command.js …`). 시연 DB(`masscom_showcase` 호스트 URL 또는 로컬 시연 `_test` URL)만 받는다. 취소 기간·SELF 없음·감사 기록은 관리자 경로와 같은 서비스 코드를 쓰고 `processed_by='cli:<운영자>'`, 감사 `actor_account_id='cli:<운영자>'`이다. 운영 DB는 이 CLI를 거절한다(운영자 인증 경로는 관리자 웹뿐).

## 5. 계정 삭제 핵심과의 관계

- `PostgresAccountDeletionService.requestDeletion`(D-026, 최근 5분 재인증)은 **바뀌지 않는다**. forget 본문을 `forgetInTransaction(client, accountId, now)`로 뽑아 두 경로가 같은 코드를 쓰고, 옛 `DELETE FROM account_deletion_intake_requests WHERE account_id = …`(pseudonymize 안)는 "그 계정의 접수 행을 `PROCESSED`로 닫고 `account_id`를 NULL로"로 바뀐다. 직접 삭제가 먼저 이뤄져도 원 계정 ID가 접수 표에 남지 않고 접수번호로 결과를 볼 수 있다(`processed_by='self-service'`).
- 잠금 순서: 계정 advisory 잠금 → 접수 행 `FOR UPDATE`(접수·취소·처리 모두 같은 순서). 취소는 `now ≤ cancel_until`, 처리는 `now > cancel_until`이므로 겹칠 수 없고, 행 잠금 뒤에 시계를 읽어 경계에서도 하나만 성공한다.
- 삭제되는 것·남는 것은 기존 개인정보 문구(`PRIVACY_DELETION.md`)를 그대로 쓴다. 제출된 거래가 있으면 ledger가 `WAITING_FOR_MINT_FINALITY`이고 조회에 그대로 보인다(완료로 표시하지 않음).

## 6. 화면

- **웹 `docs/account-deletion.html`:** 로그인 → 확인 문구 → 접수번호 표시(선택 가능한 글자, "이 번호만이 삭제 뒤 처리 결과를 확인할 방법입니다") → 취소 버튼(24시간 안) → 접수번호로 상태 조회 칸. 24시간 취소·7일 처리·삭제/보존 목록을 적는다. 접수번호는 화면에서만 다루고 URL·`localStorage`에 두지 않는다.
- **관리자 웹:** "계정 삭제 요청" 구역: 대기 건 목록·기한·처리(2단계 확인)·거절(사유 입력)·재정산.
- **앱:** 운영 앱은 옛 "이메일" 안내를 "웹에서 Google 로그인 후 접수"로 고치고 웹 링크를 유지. 시연 앱은 계정 설정에서 "계정 삭제 요청" → 확인 창 → 접수번호(선택 가능)·24시간 취소·7일 처리 안내·상태를 보이고, 접수번호 입력칸으로 취소됨·처리되지 않음(사유)·처리 완료를 조회한다. 복사 버튼은 새 의존성이 필요해(하드 레일 5) 넣지 않고 `selectable` 글자로 둔다.

## 7. opus 보안 리뷰 반영 (2026-09-30)

- **최근 로그인 조건:** 접수·다시 받기·취소는 `web_sessions.created_at`이 10분 이내인 세션만 받는다. 세션 저장소가 `resolveWithAge`(`{accountId, ageMs}`, 저장소의 시계로 계산)를 내고 서버 경로가 `freshWebSessionMs`를 넘으면 `401 WEB_SESSION_REAUTH_REQUIRED`로 거절한다. 세션 쿠키(`Path=/api/web`)를 `/app/`·`/merchant/`·`/admin/`이 함께 쓰므로 브라우저에 오래 남은 로그인으로 접수하거나 소유자의 접수번호를 무효로 만들 수 없게 하려는 것이다. 페이지는 기존 로그인 링크(`prompt=select_account`)로 다시 로그인하라고 안내한다(`prompt=login`·`max_age`는 Google이 문서화하지 않아 기대지 않는다). 접수번호 조회는 로그인이 없어 영향이 없다.
- **옛 접수(접수번호 없음):** `process`는 `receipt_hash IS NULL`이면 `409 DELETION_LEGACY_NEEDS_REFILE`로 거절한다(취소 기간 확인 뒤; 거절은 가능). 첫 접수번호를 받을 때(다시 접수·다시 받기) `cancel_until = now+24h`, `due_at = now+7d`로 다시 시작한다. 관리자 목록·CLI는 "옛 접수: 본인이 다시 접수해야 처리할 수 있어요"를 보이고 `canProcess`는 거짓이다.
- **세션 행 삭제:** forget 트랜잭션이 `auth_sessions`·`web_sessions`를 `DELETE`한다(폐기 표시는 원 계정 ID를 남긴다). 유출된 토큰은 행이 없어 `*_INVALID`이고, 통합 시험이 `information_schema.columns`로 만든 전 text/jsonb 열 검색으로 원 ID가 어디에도 없음을 확인한다.
- **공개 조회:** `pendingMintJobs`·`retainedFinalizedNfts`를 뺐고(접수번호를 아는 누구나 읽는 응답), `overdue`(아직 접수됨인데 `now > due_at`)를 더했다. 페이지·앱은 "처리 기한이 지났어요. 문의해 주세요."를 보인다.
- **거절 사유:** 요청자가 그대로 보므로 NFKC 뒤 `@`·URL·8자리 이상 숫자열(구분자 허용)이 든 사유는 `DELETION_REJECT_REASON_INVALID`로 거절하고, 관리자 화면이 "요청자가 접수번호로 이 사유를 그대로 봅니다. 개인정보를 쓰지 마세요."를 보인다. 필터는 #243의 메모 필터와 같은 패턴이다.
- **잠금 순서:** 관리자와 대상의 계정 잠금을 정렬된 한 순서로 먼저 잡아(`lockAllForDeletion`) 서로의 접수를 동시에 처리해도 교착하지 않는다. 그래도 40P01이면 `409 DELETION_BUSY`.
- **거절된 처리 시도 기록:** 본인 접수·취소 기간·옛 접수는 구조화 로그 한 줄(`account_deletion.process_refused`·`account_deletion.reject_refused`, `safeErrorMetadata`로 만든 거절 코드만)을 남긴다. 개인정보 로그 검사(`check-privacy-logs`)가 이 층에서 상수·승인된 메타데이터 밖의 값을 허용하지 않으므로 계정 ID·요청 번호·운영자 이름은 넣지 않는다.

## 8. 남는 것 (`NOT_RUN`)

폐기용 실계정으로 웹 접수 → 24시간 뒤 처리 → 세션 폐기 → 접수번호 조회의 실제 종단 실행, 운영 HTTPS·Caddy 반영(배포는 이 브랜치에 없음), Android 두 variant의 실기, Google Play 제출은 열려 있다(B-020 유지).
