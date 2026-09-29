# 방문·쿠폰 되돌리기와 직원 자기 적립 차단 설계 (Issue #243)

2026-09-30 소유자가 실제 운영 전 꼭 필요한 기능(P0)을 순서대로 구현하기로 승인했고, 이 기능이 첫 번째다. 보상 규칙을 바꾸므로 AGENTS.md의 승인이 필요한 범위이며 그 승인이 위 결정이다. 아래 "선택한 값"은 승인된 범위 안의 엔지니어링 선택이라 D-051에 `PROPOSED`로 기록한다.

## 1. 원칙

되돌릴 수 없는 일(체인에 보낸 NFT, 이미 사용한 쿠폰)은 건드리지 않고 아직 되돌릴 수 있는 것만 되돌린다. 모든 되돌리기는 사유와 처리자를 남긴다. 기록은 지우지 않고 상태(`CANCELED`·`VOIDED`)와 감사 열로 남긴다. 되돌리기 API는 고객 계정 ID·이메일을 점원에게 돌려주지 않는다.

## 2. 데이터 변경 (migration 0030, 추가·완화만 하고 지우는 변경 없음)

### visit_events

- 열 추가: `canceled_at timestamptz`, `canceled_by_account_id text`, `cancellation_note text`(100자 이하). 기존 `cancellation_reason`(취소면 필수)에 사유 코드를 넣는다.
- 검사: `status = 'VALID'`이면 세 열이 모두 NULL. 취소 행이 세 열을 반드시 채우는 검사는 두지 않는다(기존 시험 데이터가 열 없이 `CANCELED` 행을 넣는다).
- 색인: `(merchant_id, business_date, occurred_at DESC)`(오늘 방문 목록), `canceled_by_account_id`(계정 삭제 가명 처리).
- 하루 1건 색인 `visit_events_daily_progress_unique`(`WHERE status='VALID' AND progress_counted`)는 그대로다. 취소된 행은 색인에서 빠지므로 같은 날 다시 정당한 방문을 셀 수 있다.

### reward_entitlements

- 열 추가: `canceled_at timestamptz`, `revoked_by_visit_event_id uuid REFERENCES visit_events(id)`.
- **유일 제약 완화:** `reward_entitlements_unique_goal (customer, campaign, target)`을 부분 유일 색인 `WHERE status <> 'CANCELED'`로 바꾼다. 취소된 권리는 감사 기록으로 남기고, 같은 목표를 다시 채우면 **새 권리(새 id)** 가 생긴다. 그래서 `mint_jobs.entitlement_id UNIQUE`와 취소된 발행 작업 기록은 바꾸지 않는다. 취소 상태 권리는 기존 조회(도감·발행 요청)가 이미 제외한다.

### badge_coupons

- 상태에 `VOIDED` 추가. 열 추가: `void_reason`(`VISIT_CANCELED`·`ISSUED_IN_ERROR`·`ABUSE_SUSPECTED`·`MERCHANT_REQUEST`·`OTHER`), `void_note`(100자 이하), `voided_at`, `voided_by_account_id`, `void_visit_event_id`.
- 상태 검사를 `ISSUED`(사용·무효 열 없음) / `REDEEMED`(기존) / `VOIDED`(사용 열 없음, `voided_at`·`void_reason` 있음) 세 갈래로 다시 쓴다.
- 새 표 `badge_coupon_audit`(`id`, `coupon_id`, `merchant_id`, `action`: `REDEMPTION_UNDONE`·`VOIDED_ON_RECOUNT`·`REISSUED_AFTER_RECOUNT`, `actor_account_id`, `previous_redeemed_at`, `previous_redeemed_by_account_id`, `visit_event_id`, `created_at`). 관리자 무효화는 기존 `platform_admin_audit`에 남긴다.

### platform_admin_audit

`action` 검사에 `COUPON_VOIDED`를 더한다(0026과 같은 방식). `merchant_id`는 쿠폰의 점포, `before_state`·`after_state`에는 쿠폰 id·상태·상자 번호·사유만 넣고 고객 식별자는 넣지 않는다.

### 계정 삭제

가명 처리에 `visit_events.canceled_by_account_id`, `badge_coupons.voided_by_account_id`, `badge_coupon_audit.actor_account_id`·`previous_redeemed_by_account_id`를 더한다. 고객 삭제는 기존 규칙(방문·쿠폰의 고객 열 가명 처리)으로 충분하다. 감사 표에는 고객 ID가 없다.

## 3. 상태 규칙

### 3.1 방문 취소

- 권한: 그 점포의 **ACTIVE 멤버**(`CONFIRM_VISIT`). 웹은 기존처럼 실제 점포 소속 확인까지 한다. 다른 점포·회수된 멤버는 403 `MERCHANT_ACCESS_DENIED`(방문이 없는지 다른 점포 것인지 구분하지 않는 404 `VISIT_NOT_FOUND`는 권한을 통과한 뒤에만).
- 시간 창: 방문의 `business_date`가 취소 시각의 **한국(KST) 날짜와 같을 때만**. 다음 0시(KST)가 되면 409 `VISIT_CANCEL_WINDOW_CLOSED`. 경계: `2026-09-30T14:59:59.999Z`는 9월 30일 방문 취소 가능, `15:00:00.000Z`는 불가.
- 사유(고정 목록): `WRONG_CUSTOMER`(다른 손님으로 잘못 확인) · `DUPLICATE`(같은 방문을 두 번 확인) · `NOT_A_REAL_VISIT`(실제 방문·이용이 아님) · `OTHER`. 선택 메모는 100자 이하, 제어 문자·연속 공백을 정리하고 이메일·전화번호·주소 같은 개인정보가 보이면 400 `INVALID_REVERSAL_NOTE`로 거절한다. 사유가 목록 밖이면 400 `INVALID_REVERSAL_REASON`.
- **멱등:** 이미 취소된 방문은 저장된 결과를 `replayed: true`로 그대로 돌려준다(새 사유는 무시).
- 한 트랜잭션의 순서(교착 방지를 위해 기존 잠금 순서를 따른다): 방문 읽기(잠금 없음) → 직원·고객 계정 잠금(`assertAllActive`, 정렬된 advisory) → 점포 멤버 확인(`FOR SHARE`) → `[고객, 캠페인]` advisory(방문 수령과 같은 키) → `badge-reward:<고객>` advisory → 방문 `FOR UPDATE` → 취소 표시 → 승격 → 재계산 → 권리 잠금 → 발행 작업 검사·취소 → 권리 취소 → 쿠폰 무효화.
- **승격:** 취소한 방문이 세어지던 것(`progress_counted`)이고 같은 고객·점포·날짜·캠페인에 세어지지 않던 `VALID` 방문(같은 날 두 번째 확인)이 있으면, 실제 점포에서 직원 자기 적립이 아닌 가장 이른 것을 세어지게 올린다. 정당한 방문이 취소된 방문 때문에 가려져 있었던 경우를 살린다.
- **재계산:** 취소·승격 뒤 그 고객의 캠페인 진행 횟수 `p`(세어지는 `VALID` 방문 수)를 다시 센다. 되돌릴 권리 집합 `R` = 그 고객·캠페인의 `CANCELED`가 아닌 권리 중 `source_visit_event_id`가 이 방문이거나 `target_visit_count > p`인 것.
- **권리·발행 작업 되돌리기:** `R`의 권리마다:
  - `GRANTED` → `CANCELED`.
  - `MINT_REQUESTED` → 발행 작업이 **아직 체인에 보내지 않은 상태**면 계정 삭제와 같은 규칙으로 작업을 `CANCELLED`(`last_error_code='VISIT_CANCELED'`), outbox를 `PUBLISHED`로 닫고 권리를 `CANCELED`. 보내지 않은 상태 = 상태가 `QUEUED`·`PREPARED`·`RETRYABLE`·`PAUSED`·`MANUAL_REVIEW`, 트랜잭션 해시 없음, `MINT_SUBMISSION_RESPONSE_LOST` 아님, 유효한 outbox 대여(lease) 없음.
  - `FULFILLED`, 또는 작업이 `SUBMITTED`·`CONFIRMING`·`FINALIZED`이거나 해시가 있거나 응답 분실 → 취소 전체를 거절: 409 `VISIT_REWARD_ALREADY_MINTED`, 방문은 그대로 유효(트랜잭션 롤백).
  - 작업 행이 워커에 잠겨 있거나 유효한 대여가 있으면(전송 직전일 수 있음) 409 `VISIT_REWARD_MINT_IN_PROGRESS`(잠시 뒤 다시 시도). 작업 행은 `FOR UPDATE NOWAIT`로 잡아 대기하지 않는다(워커의 작업→권리 잠금 순서와 뒤집혀도 교착하지 않는다).
- **쿠폰 무효화:** 재계산한 메달로 `earnedTiers`를 구해, 필요 배지 수가 그보다 큰 상자의 **미사용(`ISSUED`)** 쿠폰을 `VOIDED`(`void_reason='VISIT_CANCELED'`, 처리한 점원·방문 id 기록, `badge_coupon_audit`에 `VOIDED_ON_RECOUNT`)로 바꾸고 혜택의 `issued_count`를 1 돌려준다. 이미 사용한 쿠폰은 건드리지 않는다.
- **다시 채우면:** 방문 수령은 `CANCELED`가 아닌 권리만 "이미 있음"으로 보고 부족한 목표를 새 권리로 만든다. `VISIT_CANCELED`로 무효가 된 쿠폰은 앱에서 숨겨지고 상자는 다시 잠김·열기 가능 상태를 따르며, 조건을 다시 채운 고객이 상자를 열면 같은 행을 새 혜택 사본으로 되살린다(`REISSUED_AFTER_RECOUNT`, 발급 수 +1). 관리자 무효화 쿠폰은 되살리지 않는다.
- 취소된 방문의 수령 QR(`claim_slots`)은 `CLAIMED`로 남아 다시 쓸 수 없다. 다시 확인해야 하면 점원이 새 QR을 발급한다(웹은 다른 이용 식별 번호).

### 3.2 쿠폰 사용 되돌리기

- 권한: 그 점포의 **ACTIVE 멤버 누구나**(사용 처리한 직원만으로 제한하지 않는다: 교대·기기 교체가 흔하고, 처리자와 되돌린 사람을 감사에 함께 남긴다). 다른 점포 쿠폰은 404 `COUPON_NOT_FOUND`.
- 창: `redeemed_at`부터 **10분 이내**(정확히 10분 0초는 가능, 그 뒤는 409 `COUPON_UNDO_WINDOW_CLOSED`). `REDEEMED` → `ISSUED`(사용 열 비움), `badge_coupon_audit`에 `REDEMPTION_UNDONE`(되돌린 점원, 이전 사용 시각·처리자).
- 멱등: 이미 되돌려진 쿠폰(`ISSUED`이고 되돌리기 감사가 있음)은 200 `replayed: true`. 사용한 적 없는 쿠폰·`VOIDED`는 409 `COUPON_NOT_REDEEMED`.
- 쿠폰 행을 `FOR UPDATE`로 잡으므로 사용 처리와 되돌리기가 동시에 와도 한 줄로 직렬화된다.

### 3.3 관리자 무효화

- `ISSUED` 쿠폰만 `VOIDED`. 사유는 고정 목록(`ISSUED_IN_ERROR`·`ABUSE_SUSPECTED`·`MERCHANT_REQUEST`·`OTHER`)과 선택 메모(같은 정리 규칙). `platform_admin_audit`에 `COUPON_VOIDED`로 남기고 혜택 `issued_count`를 1 돌려준다. 이미 무효면 200 `replayed`, 사용한 쿠폰은 409 `ADMIN_COUPON_NOT_VOIDABLE`.
- 무효 쿠폰은 사용 조회에서 빠지고 사용 처리는 409 `COUPON_VOIDED`다. 고객 앱은 "사용할 수 없는 쿠폰"으로 보여 준다.

### 3.4 직원 자기 적립 차단

실제 점포(`merchants.is_demo = false`)에서 `claim_slots.created_by_account_id = 고객`인 방문은 생성 때부터 `progress_counted = false`로 기록한다. 캠페인 진행·1/3/5회 권리·NFT·도감 진행에 세지 않는다(메달·배지의 `countedVisitFilterSql`과 같은 규칙). 시연 점포는 지금 동작 그대로다. 방문은 기록하므로 점원 목록과 고객 도감("방문만 기록")에 보인다. 응답 `visit.progressExcludedReason = 'STAFF_SELF'`(세어지지 않을 때만, 이 값일 때만 넣는다)로 앱이 안내 문구를 바꾼다. 하루 1건 색인은 `progress_counted = false` 행을 세지 않으므로 그대로 동작한다. **이미 저장된 옛 행은 다시 쓰지 않는다**(발행된 NFT를 되돌릴 수 없고 운영은 공개 전이다).

## 4. API

오류는 `{code}`. 모든 경로에 `CONFIRM_VISIT` 권한과(웹) 실제 점포 소속을 확인한다. 웹 쓰기는 기존처럼 `Origin`과 JSON 검사를 통과해야 한다.

| 표면 | 메서드 경로 | 설명 |
| --- | --- | --- |
| 앱(Bearer) | `GET /merchant/merchants/:id/recent-visits` | 오늘(KST) 이 점포 방문 최근 50건 |
| 앱 | `POST /merchant/merchants/:id/visits/:visitId/cancel` `{reason, note?}` | 방문 취소 |
| 앱 | `GET /merchant/merchants/:id/recent-coupon-redemptions` | 최근 24시간 쿠폰 사용 20건 |
| 앱 | `POST /merchant/merchants/:id/coupons/:couponId/undo-redeem` `{}` | 사용 되돌리기 |
| 웹(쿠키) | `/api/web/merchant/merchants/:id/…` 같은 네 경로 | 위와 동일 |
| 관리자 웹 | `GET /api/web/admin/merchants/:id/coupons` | 그 점포 쿠폰 100건(가림 표시) |
| 관리자 웹 | `POST /api/web/admin/coupons/:couponId/void` `{reason, note?}` | 무효화 |

응답:

- 방문 목록 `{ businessDate, visits: [{ visitEventId, occurredAt, customerLabel, status, progressCounted, cancellationReason, canCancel }] }`.
- 방문 취소 `{ visitEventId, status: 'CANCELED', reason, note, canceledAt, revokedRewardCount, voidedCouponCount, replayed }`.
- 쿠폰 사용 목록 `{ coupons: [{ couponId, title, redeemedAt, customerLabel, redeemedByMe, undoUntil, canUndo }] }`.
- 되돌리기 `{ couponId, status: 'ISSUED', replayed }`. 관리자 무효화 `{ coupon: { couponId, status: 'VOIDED', voidReason, voidedAt }, replayed }`.
- 고객 표시: `customerLabel`은 `HMAC(점포 id + 고객 계정 id)`에서 뽑은 4글자(`손님 K7QM`)라 점포마다 다르고 계정 ID·이메일과 역산할 수 없다.

오류 코드: 403 `MERCHANT_ACCESS_DENIED`, 404 `VISIT_NOT_FOUND`·`COUPON_NOT_FOUND`·`ADMIN_COUPON_NOT_FOUND`, 400 `INVALID_REVERSAL_REASON`·`INVALID_REVERSAL_NOTE`, 409 `VISIT_CANCEL_WINDOW_CLOSED`·`VISIT_REWARD_ALREADY_MINTED`·`VISIT_REWARD_MINT_IN_PROGRESS`·`COUPON_UNDO_WINDOW_CLOSED`·`COUPON_NOT_REDEEMED`·`COUPON_VOIDED`·`ADMIN_COUPON_NOT_VOIDABLE`, 410 `ACCOUNT_DELETED`.

## 5. UI (모든 문구 한국어, DESIGN.md·기존 웹 스타일)

- **점주 웹 `/merchant/`:** "고객 방문 확인" 아래에 "최근 방문·쿠폰 사용" 구역. 점포 선택과 새로고침. "최근 방문 확인" 목록(시각·가림 표시·상태, `진행 반영`/`기록만`)과 "방문 취소"(사유 선택 + 메모 + 확인 대화상자), "최근 쿠폰 사용" 목록과 10분 안의 "사용 되돌리기". 10분이 지나면 버튼 대신 "되돌리기 시간이 지났어요". 실패 사유는 코드별 한국어 안내.
- **시연 앱 직원 화면:** 같은 두 목록과 동작(`StaffClaimScreen` 아래 카드). 확인 경고창 후 실행, 실패 안내는 같은 문구.
- **관리자 웹:** 점포 카드에 "쿠폰 관리" 목록(상태·발급/사용 시각·가림 표시)과 `ISSUED` 쿠폰의 "무효화"(사유 선택 + 메모 + 확인).
- **고객 앱·운영 웹 도감:** `VOIDED` 쿠폰은 "사용할 수 없는 쿠폰"으로 표시하고 QR 사용 버튼을 없앤다. 사용 시트가 열린 채 쿠폰이 무효가 되면(목록에서 사라지거나 `VOIDED`) 안내로 바꾼다. 기존 앱은 모르는 상태 `VOIDED`를 거절하므로 관리자 무효화 쿠폰이 있는 고객은 앱을 갱신할 때까지 여권 화면이 응답 형식 오류를 낸다(배포 순서에 유의). 방문 취소로 무효가 된 쿠폰은 응답에서 숨겨 이 문제가 없다.
- **방문 수령 화면:** `progressExcludedReason === 'STAFF_SELF'`이면 "직원 본인 계정으로 받은 방문은 기록만 되고 진행·보상에는 세지 않습니다."로 안내한다.

## 6. 선택한 값 (D-051, `PROPOSED`)

| 값 | 선택 | 이유 |
| --- | --- | --- |
| 방문 취소 창 | 방문의 한국 영업일 안 | 소유자 지시. 다음 날 정산이 끝난 뒤 진행·보상 변동을 막는다 |
| 취소 사유 | 고정 4종 + 100자 메모 | 자유 서술의 개인정보 유입을 줄이고 집계 가능 |
| 쿠폰 되돌리기 창 | 사용 시각부터 10분 | 소유자 지시 |
| 쿠폰 되돌리기 권한 | 그 점포 ACTIVE 멤버 누구나 | 교대·기기 교체, 감사 기록으로 보완 |
| 방문 승격 | 가려져 있던 같은 날 정당한 방문을 세어 줌 | 잘못된 방문 취소가 정당한 하루 진행을 지우지 않게 |
| 무효 쿠폰의 발급 수 | 1 돌려줌 | 점주가 동의한 상한을 쓰지 않은 쿠폰이 잠그지 않게 |
| 발행 상한 계산 | 취소된 발행 작업은 `max_ever_minted` 예약에서 뺌 | 체인에 안 나간 작업이 발행 여유를 영구히 먹지 않게 |
| 옛 자기 적립 행 | 다시 쓰지 않음 | 발행된 보상은 되돌릴 수 없고 운영은 공개 전 |

## 7. 시험 계획

- **PostgreSQL 통합(별도 `_test` DB):** 권한(다른 점포·회수된 멤버 403, 없는 방문 404), 시간 창(영업일 경계·10분 경계 정확히·1ms 뒤), 동시성(같은 방문 동시 취소, 취소와 워커 대여·전송 경쟁, 사용 처리와 되돌리기 경쟁, 취소와 방문 수령 경쟁), NFT 전송 뒤 거절과 롤백, 미전송 권리·발행 작업 취소와 재계산 뒤 다시 채우기, 재계산으로 쿠폰 무효·사용한 쿠폰 유지·되살리기, 실제 점포 자기 적립 미반영과 시연 점포 반영·하루 1건 색인, 멱등, 관리자 무효화 감사·계정 삭제 가명 처리, 마이그레이션 제약.
- **단위:** 사유·메모 정리, 영업일·10분 경계 계산, 발행 작업 분류, 되돌릴 권리·무효 쿠폰 선택, 자기 적립 판정, 가림 표시.
- **웹:** `tests/site/verify_production_web_test.mjs` 패턴으로 점주 목록·취소·되돌리기·오류 안내, 관리자 무효화.
- **앱:** API 클라이언트 파서·오류, 쿠폰 `VOIDED` 표시·문구, 방문 수령 안내 문구, 직원 화면의 순수 로직.
- **NOT_RUN(실제 기기·서버):** 실제 휴대전화·TalkBack·다크·글자 200%에서 새 카드 화면, 운영·시연 서버 migration 적용.
