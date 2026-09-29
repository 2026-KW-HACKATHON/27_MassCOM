# 실제 점포 운영 시작(공개·점주·혜택·캠페인) 설계 (Issue #246)

2026-09-30 소유자가 실제 점포를 SQL 없이 운영 관리자 웹에서 운영 시작할 수 있게 하기로 정했다(`USER_CONFIRMED`, D-054). 이 문서가 먼저 쓰이고 구현이 이 문서를 따른다. 아래 "선택한 값"은 소유자 결정 안에서 에이전트가 정한 엔지니어링 선택이라 D-055에 `PROPOSED`로 기록한다.

## 1. 소유자 결정(요약)

1. **점포 공개·숨김은 관리자만 한다.** 공개는 메뉴 1개 이상·영업시간·도로명 주소가 채워져 있고, 점포가 **가게 이름·사진 사용에 동의한 동의서의 참조 번호**를 관리자가 적었을 때만 된다. 참조 번호·시각·처리한 관리자를 남긴다. 공개와 기존 숨김 모두 감사 기록을 남긴다. 숨김은 지금처럼 그 점포의 활성 혜택을 멈춘다.
2. **점주 부여 절차:** 직원 등록 코드 → 그 사람이 기존 직원 등록(활성 점포 필요)으로 STAFF가 됨 → 플랫폼 소유자가 **사업자등록증 원본을 확인하고 점포 전화번호로 전화**해 확인 → 관리자 웹에서 그 ACTIVE STAFF를 OWNER로 올리며 **확인 기록의 참조 번호**를 적는다. OWNER→STAFF 되돌리기(사유·참조 번호)도 있다. 점포당 ACTIVE OWNER는 최대 2명이다. 관리자는 자기 계정을 올리거나 내릴 수 없다. 감사 기록을 남긴다. **참조 번호만 기록하고 사업자등록번호·이름·전화번호는 기록하지 않는다.**
3. **보상 혜택(쿠폰):** 관리자는 활성 점포에만, D-043의 점주 동의 5항목 — (1) 혜택 내용 동의, (2) 비용은 점주 부담, (3) 유효 기간, (4) 발급 상한, (5) 중복 사용 정책 — 을 모두 확인하고 동의서 참조 번호를 적어야 혜택을 만들 수 있다. 관리자가 만드는 혜택은 발급 상한이 필수다. 관리자는 혜택을 멈출 수 있다. 감사 기록을 남긴다.
4. **캠페인 공개·중지:** 초안(DRAFT)을 공개(ACTIVE, `is_public=true`)하고 공개 중인 캠페인을 멈춘다(PAUSED). 점포가 활성이어야 하고 목표가 있어야 한다. 감사 기록을 남긴다.
5. **D-023:** 방문 보상에는 캠페인 참여 등록이 필요 없다(방문한 사람은 누구나 받는다). `enrollment_capacity`는 화면에 보이는 참여자 수일 뿐이고, 비용 상한은 쿠폰 발급 상한과 NFT 시리즈 상한이다. 취소·삭제는 자리를 돌려주지 않는다.
6. **운영 NFT는 "권리 기록, 발행은 나중":** 보상은 권리를 계속 기록하지만 운영은 발행 서버와 메인넷이 승인될 때까지 발행하지 않는다. 고객 앱·웹은 접수·진행 문구 대신 **"발행 준비 중"**을 보인다. 시연은 지금의 발행 동작을 그대로 둔다.
7. **운영 안내서:** 점포 온보딩 절차를 한국어 안내서로 남긴다([`docs/MERCHANT_ONBOARDING.md`](../../MERCHANT_ONBOARDING.md)).

## 2. 범위

- 들어간다: migration 0032, 관리자 서비스(`apps/api/src/postgres/admin.ts`)의 공개·점주·혜택·캠페인 동작, 관리자 API(`/api/web/admin/...`), 계정 삭제의 새 계정 열 가명 처리, 관리자 웹(`apps/production-web/admin.html`·`assets/admin.mjs`), 고객 앱·웹의 "발행 준비 중", 운영 compose 설정, 문서.
- 들어가지 않는다: 점주 전용 운영 채널(운영 Android 앱은 계속 고객 화면만), 사업자등록 진위 자동 조회, 발행 서버·메인넷, 참여 등록 규칙 변경, 혜택 재개(멈춘 혜택은 새 동의로 새로 만든다), 운영 OpenAI 키(D-050대로 비워 둔다).

## 3. 데이터 변경 (migration 0032, 배포된 API `02cb7e7`와 호환)

배포 스크립트는 migration을 먼저 돌리고 API를 바꾼다. 그 사이 옛 API가 새 스키마에서 그대로 동작해야 하므로 **열 추가·CHECK 확장만** 한다.

| 표 | 변경 | 옛 API에 미치는 영향 |
| --- | --- | --- |
| `merchants` | `consent_document_ref text NULL`(형식 CHECK), `published_at timestamptz NULL` 추가 | 옛 `INSERT`(열 목록 명시)·`UPDATE`는 새 열을 모르므로 NULL로 둔다. 옛 `SELECT` 열 목록도 그대로 |
| `badge_reward_offers` | `consent_document_ref text NULL`(형식 CHECK), `consent_checklist_version text NULL` 추가 | 시연 seed·옛 혜택은 NULL. `consent_note NOT NULL`은 그대로라 새 코드도 채운다 |
| `platform_admin_audit` | `target_account_id text NULL` 추가(점주 변경 감사의 대상 계정), 부분 색인, action CHECK를 **기존 8개 + 새 7개의 합집합**으로 다시 만든다, `(action이 점주 변경) = (target_account_id IS NOT NULL)` CHECK 추가 | 옛 API는 8개 action만 쓰고 `target_account_id`를 넣지 않으므로 두 CHECK를 모두 통과한다. `merchant_id` NULL 허용(0031)과 `(ACCOUNT_DELETION_%) = (merchant_id IS NULL)` CHECK는 그대로이며 새 action은 모두 점포 행동이라 `merchant_id`가 있다 |

새 action: `MERCHANT_PUBLISHED`, `MERCHANT_OWNER_GRANTED`, `MERCHANT_OWNER_REVOKED`, `REWARD_OFFER_CREATED`, `REWARD_OFFER_PAUSED`, `CAMPAIGN_PUBLISHED`, `CAMPAIGN_PAUSED`. 이 CHECK를 다시 쓰는 다음 migration은 이 15개 전체를 이어받아야 한다(0030·0031과 같은 규칙).

참조 번호 열의 DB CHECK는 앱 검사의 최후 방어선이다: 형식 `^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$`이고, 영문·숫자만 남겼을 때 8자리 이상 이어진 숫자가 없어야 한다(전화번호·사업자등록번호 모양 차단).

`merchants.status = 'ACTIVE'`면 참조 번호가 있어야 한다는 CHECK는 두지 않는다. 운영·시연 DB에는 SQL로 이미 활성화한 점포(시연 점포 포함)가 있어 migration이 실패하고, 옛 API의 숨김·생성은 PAUSED만 쓰므로 새 코드의 공개 경로만 지키면 된다.

## 4. 참조 번호 규칙

동의서·확인 기록은 종이·파일로 운영자가 보관하고, 서비스에는 그 **참조 번호만** 남긴다.

- 앞뒤 공백을 지운 뒤 `^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$`(영문·숫자로 시작하는 3~40자, 영문·숫자·`.`·`_`·`-`)여야 한다.
- 그리고 기존 `looksLikePersonalData`(`apps/api/src/reversal-rules.ts`, 방문 취소 메모·삭제 거절 사유와 같은 기준)가 걸러 내는 것이 없어야 한다: `@`, 웹 주소 모양(`shop.kr` 같은 흔한 최상위 도메인 포함), 구분자가 끼어도 이어지는 **8자리 이상 숫자열**(사업자등록번호 `123-45-67890`, 전화번호 `010-1234-5678`).
- 그래서 날짜를 통째로 쓰는 `CS-20260930-01`은 거절되고 `CS-2609-01`·`OWN-A01-0930`처럼 숫자를 7자리 이하로 끊어 쓴다. 이메일은 형식에서 먼저 막힌다.
- 틀리면 400 `ADMIN_DOCUMENT_REF_INVALID`(다른 입력 오류 `ADMIN_INVALID_INPUT`과 구분해 화면이 정확히 안내한다).

## 5. 상태 규칙

### 5.1 점포 공개(`MERCHANT_PUBLISHED`)와 숨김

- 요청: `expectedVersion`(수정·숨김과 같은 낙관적 잠금), `consentDocumentRef`.
- 조건: 실제 점포(`is_demo = false`, 아니면 404), 현재 `PAUSED`(이미 `ACTIVE`면 409 `ADMIN_MERCHANT_ALREADY_ACTIVE`), 버전 일치(409 `ADMIN_VERSION_CONFLICT`), `jsonb_array_length(menu_items) >= 1`, `btrim(business_hours) <> ''`, `btrim(road_address) <> ''`(하나라도 아니면 409 `ADMIN_MERCHANT_NOT_READY`), 참조 번호 규칙(400).
- 효과: `status='ACTIVE'`, `consent_document_ref`, `published_at=now()`, `version+1`. 처리한 관리자는 감사 행의 `actor_account_id`에 남는다(점포 행에 관리자 계정 열을 새로 두지 않는다: 계정 식별자 열을 늘리지 않으려는 선택, D-055). 감사 `before_state`는 공개 전 점포, `after_state`는 공개 후 점포(참조 번호 포함).
- 공개가 숨김 때 멈춘 캠페인·혜택을 되살리지 않는다. 캠페인은 5.4의 공개로 다시 열고, 혜택은 새 동의로 새로 만든다.
- 숨김은 지금 그대로다(유효한 미수령 QR이 있으면 409, 활성 캠페인 PAUSED·비공개, 활성 혜택 PAUSED, `MERCHANT_HIDDEN` 감사). 다시 공개할 때는 참조 번호를 다시 적는다(같은 번호여도 된다).

### 5.2 점주 올리기(`MERCHANT_OWNER_GRANTED`)·내리기(`MERCHANT_OWNER_REVOKED`)

- 요청: 대상 계정(경로), 올리기는 `verificationDocumentRef`, 내리기는 `reason`(`OWNER_REQUEST` 점주 요청 · `OWNERSHIP_CHANGED` 대표·운영자 변경 · `VERIFICATION_FAILED` 확인 결과 불일치 · `OTHER` 기타)과 `verificationDocumentRef`.
- 자기 자신: 대상이 요청한 관리자 본인이면 DB에 닿기 전에 403 `ADMIN_SELF_ROLE_CHANGE`.
- 올리기 조건: 점포가 실제·`ACTIVE`(아니면 404 또는 409 `ADMIN_MERCHANT_NOT_ACTIVE`), 대상이 그 점포의 ACTIVE STAFF(이미 ACTIVE OWNER면 409 `ADMIN_ALREADY_OWNER`, 멤버가 아니거나 회수됐으면 404 `ADMIN_MEMBER_NOT_FOUND`), 대상 계정이 삭제되지 않음, **점포 행 잠금을 잡은 뒤 센** ACTIVE OWNER가 2명 미만(아니면 409 `ADMIN_OWNER_LIMIT`).
- 내리기 조건: 점포가 실제(숨김 상태여도 가능), 대상이 ACTIVE OWNER(아니면 404 `ADMIN_MEMBER_NOT_FOUND`). 효과는 `role='STAFF'`(ACTIVE 유지). 직원 권한까지 없애려면 기존 "권한 회수"를 쓴다.
- 감사: `target_account_id`에 대상 계정, `before_state`/`after_state`에는 역할·참조 번호·사유만 넣고 계정 식별자는 JSON에 넣지 않는다(계정 삭제의 가명 처리가 열 단위이기 때문).
- 2명 상한은 DB 제약이 아니라 **점포 행 `FOR UPDATE` 뒤의 계수**로 지킨다. 모든 OWNER 변경 경로가 같은 점포 행 잠금을 먼저 잡으므로 동시 올리기가 직렬화된다(통합 시험: 4명 동시 올리기 → 정확히 2명 성공). SQL로 직접 OWNER를 넣는 경로(시연 seed 등)는 이 규칙 밖이다.

### 5.3 보상 혜택(`REWARD_OFFER_CREATED`·`REWARD_OFFER_PAUSED`)

- 요청: `merchantId`, `milestone`(1·2·3 상자), `title`(1~40자), `detail`(0~120자), `validDays`(1~365), `issuanceCap`(**필수**, 1~10,000 정수), `consentDocumentRef`, `consent`(`benefit`·`ownerPaysCost`·`validity`·`issuanceCap`·`duplicateUse` 다섯 항목이 모두 `true`, 하나라도 아니면 400 `ADMIN_CONSENT_INCOMPLETE`).
- 조건: 점포가 실제·`ACTIVE`(409 `ADMIN_MERCHANT_NOT_ACTIVE`). 상자 번호당 활성 혜택은 **전체에서 하나**(0027의 부분 유일 색인 `badge_reward_offers_one_active_per_milestone`)라서 이미 있으면 409 `ADMIN_OFFER_MILESTONE_TAKEN`(미리 읽고, 동시 경쟁은 색인의 23505를 같은 코드로 바꾼다).
- 효과: `status='ACTIVE'`, `consent_document_ref`, `consent_checklist_version='owner-offer-consent-v1'`, 그리고 기존 읽는 쪽이 계속 동작하도록 `consent_note`를 `점주 동의서 <참조 번호> · 확인 항목 owner-offer-consent-v1(혜택 내용·비용 점주 부담·유효 기간·발급 상한·중복 사용 정책)`로 채운다.
- 멈춤: `ACTIVE → PAUSED`. 이미 `PAUSED`면 저장된 결과를 `replayed: true`로 돌려준다. 멈춘 혜택은 되살리지 않는다(새 동의로 새 혜택). 이미 발급한 쿠폰은 그대로 쓸 수 있다(숨김과 같다).

### 5.4 캠페인 공개(`CAMPAIGN_PUBLISHED`)·중지(`CAMPAIGN_PAUSED`)

- 공개 조건: 점포가 실제·`ACTIVE`(409 `ADMIN_MERCHANT_NOT_ACTIVE`), 캠페인이 `DRAFT` 또는 `PAUSED`(숨김·중지로 멈춘 캠페인을 같은 캠페인으로 다시 여는 것, 진행 횟수가 캠페인 단위라서 새 초안을 만들면 고객 진행이 끊기기 때문), 목표(`campaign_goals`)가 1개 이상, `ends_at > now()`(DB 시계). 아니면 409 `ADMIN_CAMPAIGN_NOT_PUBLISHABLE`. 이미 공개 중이면 `replayed: true`.
- 점포당 공개 중인 캠페인은 하나(0001의 `campaigns_one_active_public_per_merchant`)라서 다른 캠페인이 공개 중이면 409 `ADMIN_CAMPAIGN_ACTIVE_EXISTS`(미리 읽고 23505도 같은 코드).
- 효과: `status='ACTIVE'`, `is_public=true`, `updated_at`. 기존 CHECK(`ends_at > starts_at`, `enrolled_count <= enrollment_capacity`)는 건드리지 않는다. 시작 시각이 미래면 공개돼도 방문 보상은 시작 뒤부터다(방문 수령이 `starts_at <= 수령 시각 < ends_at`을 본다).
- 중지: `ACTIVE → PAUSED`, `is_public=false`(숨김과 같다). 이미 `PAUSED`면 `replayed: true`, `DRAFT`·`ENDED`는 409 `ADMIN_CAMPAIGN_NOT_PAUSABLE`. 점포가 숨김 상태여도 할 수 있다.

## 6. 잠금 순서

새 경로 모두가 기존 경로와 같은 한 방향으로 잠근다:

> **계정 advisory 잠금(정렬된 순서, `PostgresAccountLifecycle`) → `platform_admins` 행(관리자 확인 `FOR UPDATE`) → `merchants` 행(`FOR UPDATE`) → `merchant_members` 행 / `badge_reward_offers` 행 / `campaigns` 행(`FOR UPDATE`)**

- 점주 올리기·내리기는 관리자와 대상 계정의 advisory 잠금을 `lockAllForDeletion`으로 정렬해 먼저 잡고(계정 삭제 처리와 같은 규칙: 두 관리자가 서로를 대상으로 해도 교착하지 않는다) 관리자 확인 → 대상 삭제 여부 → 점포 → 멤버 순서다. 직원 승인(`staff-registration.ts approve`: 두 계정 → 관리자 → 점포 → 요청 → 멤버)과 같다.
- 혜택 멈춤·캠페인 공개·중지는 행의 `merchant_id`를 잠금 없이 읽은 뒤 점포 행을 잠그고, 그다음 그 행을 잠가 점포가 같은지 다시 확인한다. 상자 열기(점포 `FOR SHARE` → 혜택 `FOR UPDATE` → 쿠폰)와 숨김(점포 → 캠페인·혜택)과 같은 방향이라 교착이 없다.
- 기존 쿠폰 무효화(쿠폰 → 혜택)는 점포 행을 잡지 않으므로 이 순서와 부딪히지 않는다.

## 7. API (`/api/web/admin/...`, 기존 관리자 세션·같은 출처·JSON CSRF 검사 그대로)

| 메서드·경로 | 본문 | 응답 |
| --- | --- | --- |
| `POST /merchants/:id/publish` | `{ expectedVersion, consentDocumentRef }` | `{ merchant }` |
| `GET /merchants/:id/owners` | — | `{ owners: [{ accountId, role: 'OWNER', grantedAt }] }` |
| `POST /merchants/:id/members/:accountId/promote-owner` | `{ verificationDocumentRef }` | `{ member: { accountId, role: 'OWNER' } }` |
| `POST /merchants/:id/members/:accountId/demote-owner` | `{ reason, verificationDocumentRef }` | `{ member: { accountId, role: 'STAFF' } }` |
| `GET /reward-offers` | — | `{ offers }`(실제 점포 것만, 최근 100개) |
| `POST /reward-offers` | 5.3의 필드 | `201 { offer }` |
| `POST /reward-offers/:id/pause` | `{}` | `{ offer, replayed }` |
| `GET /campaigns` | — | `{ campaigns }`(초안이 아닌 실제 점포 캠페인, 최근 100개. 초안은 기존 `/campaign-drafts`) |
| `POST /campaigns/:id/publish` | `{}` | `{ campaign, replayed }` |
| `POST /campaigns/:id/pause` | `{}` | `{ campaign, replayed }` |

모르는 본문 키는 400 `INVALID_REQUEST`. `AdminMerchant`에 `consentDocumentRef`·`publishedAt`이 더해진다(옛 관리자 웹은 무시).

## 8. 관리자 웹

- 점포 카드: 상태("비공개"/"공개 중 · 동의서 … · 공개 …"), 비공개 점포에는 공개 준비 점검(메뉴·영업시간·주소 중 빠진 것 안내), 동의서 참조 번호 입력과 "점포 공개" 버튼. 숨김 버튼은 지금처럼 카드 맨 끝이다.
- 직원 권한 구역: 직원 행마다 확인 기록 참조 번호 입력과 "점주로 올리기", 점주 목록(최대 2명 안내)과 사유·참조 번호를 받는 "직원으로 내리기". "사업자등록증 원본 확인과 점포 전화 확인 뒤 적고, 사업자등록번호·이름·전화번호는 적지 말라"고 안내한다.
- "보상 혜택(쿠폰)" 구역: 활성 점포 선택, 상자, 혜택 이름·설명, 유효 기간, 발급 상한(필수), 동의서 참조 번호, 점주 동의 5항목 체크박스(`fieldset`/`legend`), 목록과 "혜택 멈춤".
- 캠페인 구역: 초안 줄에 "공개", 공개·중지된 캠페인 목록과 "중지"/"다시 공개".
- 모든 입력에 `label`이 있고 줄마다 같은 이름의 버튼은 점포·계정 이름을 `aria-label`에 넣는다. 기존 토큰 색(`var(--mc-*)`)만 써서 어두운 화면에서도 같은 대비이고, 390px에서 가로 스크롤이 생기지 않게 그리드·줄바꿈만 쓴다.

## 9. D-023 참여 등록과 방문 보상

코드 확인: 방문 수령(`PostgresClaimSlotService.redeem`)은 `campaign_enrollments`·`enrolled_count`를 읽지 않고 점포의 공개·활성·기간 안 캠페인만 찾는다. 참여 등록은 `campaign-enrollment.ts`에서만 쓰이고 공개 목록의 `enrollmentStatus`(OPEN/FULL) 표시와 정원 계수에만 쓰인다. 코드가 결정과 어긋나지 않아 고치지 않고, **참여 등록이 없고 정원이 가득 찬 캠페인에서도 방문이 권리를 만든다**는 통합 시험으로 고정한다.

## 10. NFT "발행 준비 중"

- API 환경 변수 `NFT_MINTING_MODE`: 비어 있거나 `LIVE`면 지금과 같고, `PREPARING`이면 도감 응답(`GET /collection`, `GET /api/web/collection`)에 선택 필드 `nftMinting: 'PREPARING'`을 더한다. 그 밖의 값이면 API가 시작하지 않는다(설정 실수를 조용히 넘기지 않음).
- 운영 compose는 `NFT_MINTING_MODE: ${NFT_MINTING_MODE:-PREPARING}`, 시연 compose는 넘기지 않아 발행 동작이 그대로다.
- 옛 앱 파서는 모르는 최상위 필드를 무시한다(`parseCollection`은 `visits`·`collectibles`만 옮긴다). 새 앱·웹은 이 필드가 있으면 `FINALIZED`가 아닌 수집품의 NFT 줄을 "발행 준비 중"으로 보이고, 앱은 "양도 제한 NFT 받기"·"외부 지갑 주소 확인" 버튼 대신 "받은 수집품 기록은 그대로 남아요" 안내를 보이며 발행 진행 확인(폴링)을 하지 않는다.
- 권리(`reward_entitlements`)는 계속 기록된다. 운영 DB에는 NFT 시리즈가 없어 옛 앱이 발행을 요청해도 작업이 생기지 않는다(지금과 같다). 권리의 요청 기한(90일)은 바꾸지 않는다.

## 11. 개인정보

새로 저장하는 것은 문서 참조 번호(개인정보가 아니도록 서버가 거절 규칙을 둔다), 공개 시각, 점주 변경 감사의 대상 계정 식별자다. 계정 식별자는 이미 처리방침의 "계정" 항목이고 "점주·직원 권한 관리" 목적 안이다. 대상·처리 관리자 계정이 삭제되면 `platform_admin_audit.target_account_id`·`actor_account_id`를 같은 삭제 처리에서 비식별 별칭으로 바꾼다. 사업자등록번호·이름·전화번호는 저장하지 않는다. 그래서 `docs/privacy.html`은 바꾸지 않는다.

## 12. 시험

- 단위(`npm test --prefix apps/api`): 참조 번호 규칙(사업자등록번호·전화번호·이메일·URL·8자리 날짜 거절, 경계 길이), 혜택 입력 검증, 동의 문구, `NFT_MINTING_MODE` 해석, 관리자 API 라우트(세션·CSRF·모르는 키·오류 코드 매핑·자기 자신).
- PostgreSQL 통합(`admin-store-go-live.postgres.integration.ts`): 공개 전제 조건과 감사, 비관리자 거절, 자기 자신 거절, 동시 올리기 4건 → 2명, 올리기와 숨김 동시 실행의 잠금 순서, 혜택 동의·상한·상자 중복, 캠페인 공개·중지·다시 공개와 공개 캠페인 하나 규칙, 참조 번호 거절이 DB에 닿지 않음과 DB CHECK, 옛 API 문장(0031 시점 `INSERT`)이 0032 뒤에도 동작, 참여 등록 없는 방문 보상(D-023), 계정 삭제 때 감사 대상 계정 가명 처리.
- 관리자 웹(`tests/site/verify_production_web_test.mjs`): 공개 점검·요청 본문, 점주 올리기·내리기 요청, 혜택 동의 5항목, 캠페인 공개·중지, 오류 문구.
- 모바일(`npm test --prefix apps/mobile`): "발행 준비 중" 문구·버튼 숨김·폴링 안 함, 파서의 선택 필드.
