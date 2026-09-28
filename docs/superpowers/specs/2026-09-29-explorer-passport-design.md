# 탐험 여권: 메달·보상 상자·쿠폰 설계 (Issue #216)

UI/UX 피드백 "포켓몬고 같은 수집 게임성, 더 감성적으로, 공유, 배지를 모으면 쿠폰"을 반영한다. #212의 텍스트 배지 3단계·글자 공유·사용 불가 쿠폰 문구를 대체한다. 다른 게임의 캐릭터·화면·상표는 쓰지 않고 승인된 월계 마스코트(D-036)와 코드로 그린 SVG만 사용한다.

## 1. 핵심 순환

방문 인증 → **도장 쾅 축하** → 메달 등급 상승 → 배지 3·6·9개마다 **보상 상자** → 상자 열기 → **쿠폰** → 매장에서 식별 QR로 사용 → 다음 가게 탐험. 획득한 메달은 **이미지 카드로 공유**한다.

## 2. 메달 규칙 (서버 계산이 정본)

입력은 본인의 `visit_events` 중 `status='VALID' AND progress_counted`인 방문뿐이다. `progress_counted`는 (계정, 점포, 한국 날짜)당 최대 1건이므로 같은 날 반복 방문은 늘지 않는다. 다만 실제 점포(`merchants.is_demo = false`)에서 고객 본인이 발급한 수령 슬롯(`claim_slots.created_by_account_id` = 고객)의 방문은 세지 않는다. 시연 점포는 한 사람이 점원과 고객을 함께 시연하므로 그대로 센다.

| kind | 이름 | 값 | 브론즈·실버·골드 |
| --- | --- | --- | --- |
| `explorer` | 동네 탐험가 | 서로 다른 점포 수 `count(DISTINCT merchant_id)` | 1 · 2 · 3 |
| `regular` | 단골손님 | 한 점포 최다 방문일 수 `max(count(*)) GROUP BY merchant_id` | 2 · 3 · 5 |
| `steady` | 꾸준한 걸음 | 방문한 날 수 `count(DISTINCT business_date)` | 2 · 4 · 7 |

`tier`는 0(없음)~3(골드), `earnedTiers`는 세 메달 tier 합(0~9). 탐험가 등급 이름은 앱 표시 전용: 0 새내기 탐험가, 1–2 동네 산책가, 3–5 골목 탐험가, 6–8 월계 미식가, 9 월계 마스터.

## 3. 보상 상자와 쿠폰

| milestone | 필요 배지 | 이름 |
| --- | --- | --- |
| 1 | 3 | 첫 번째 상자 |
| 2 | 6 | 두 번째 상자 |
| 3 | 9 | 황금 상자 |

- **혜택(offer)** 은 `badge_reward_offers`에 milestone별 최대 1개 `ACTIVE`. 사용 점포, 제목, 설명, 유효 일수, 선택적 발급 상한, **점주 동의 기록(`consent_note`, 필수)** 을 가진다. 시연 DB는 seed로 가상 점포 A·B·C의 체험 혜택을 넣고, 운영 DB는 점주 동의 뒤 수동 등록 전까지 비어 있다(D-043).
- 상자 상태: `LOCKED`(배지 부족) · `READY`(달성·혜택 있음·상한 여유·미개봉) · `UNAVAILABLE`(달성했지만 혜택 없음/상한 소진) · `OPENED`(쿠폰 존재). `LOCKED`에도 등록된 혜택을 보여줘 다음 목표를 알린다. 사용 점포가 숨김(`PAUSED`)이면 혜택은 보이지 않고 열 수 없다(`UNAVAILABLE`/`REWARD_OFFER_UNAVAILABLE`). 관리자 점포 숨김은 그 점포의 `ACTIVE` 혜택을 같은 트랜잭션에서 `PAUSED`로 바꾸며, 이미 연 쿠폰은 그대로 남는다.
- 상자 열기는 서버가 같은 트랜잭션에서 메달을 다시 계산해 판정한다. 계정·상자당 쿠폰 1장(`UNIQUE(customer_account_id, milestone)`), 재요청은 기존 쿠폰을 `replayed:true`로 돌려준다.
- 쿠폰 상태: `ISSUED`, `REDEEMED`; 응답에서는 `ISSUED`이면서 `expires_at <= now`이면 `EXPIRED`로 표시한다. 클라이언트가 만료를 날짜("~10월 29일까지")로만 보여주므로 `expires_at`은 **발급일(한국 날짜) + 유효 일수째 날의 23:59:59.999 KST**다(다음 날 00:00 KST − 1ms). 오후에 발급해도 표시된 마지막 날 저녁까지 쓸 수 있다.
- **사용**: 고객이 쿠폰의 "매장에서 사용하기"를 누르면 기존 2분 고객 식별 QR을 만든다. 점원은 기존과 같이 QR을 촬영해 해당 점포 `CONFIRM_VISIT` 권한으로 고객의 **그 점포 쿠폰만** 조회·사용 처리한다. 쿠폰 사용은 식별 토큰을 소모하지 않으므로 쿠폰을 먼저 처리한 뒤 같은 QR로 방문 코드를 발급할 수 있다(방문 코드 발급은 토큰을 소모하므로 반대 순서는 새 QR 필요). 원시 계정 ID는 점원에게 보내지 않는다.

## 4. API 계약

모든 응답은 기존 규칙대로 JSON, 오류는 `{code}`.

### 고객 (Bearer / 개발 DEMO 헤더)

`GET /me/badges` → 200

```json
{
  "medals": [
    { "kind": "explorer", "value": 2, "tier": 2, "thresholds": [1, 2, 3] },
    { "kind": "regular", "value": 1, "tier": 0, "thresholds": [2, 3, 5] },
    { "kind": "steady", "value": 1, "tier": 0, "thresholds": [2, 4, 7] }
  ],
  "earnedTiers": 2,
  "rewards": [
    {
      "milestone": 1, "requiredTiers": 3, "state": "LOCKED",
      "offer": { "merchantId": "m", "merchantName": "가상 점포 A", "title": "체험 음료 1잔", "detail": "…", "validDays": 30 },
      "coupon": null
    }
  ]
}
```

`rewards`는 항상 milestone 1·2·3 세 개. `offer`는 `ACTIVE` 혜택(사용 점포도 `ACTIVE`)이 없거나 **이미 상자를 열어 `coupon`이 있으면 `null`**(열린 상자는 발급 시점 사본인 쿠폰으로 그린다). `coupon`:

```json
{ "couponId": "uuid", "milestone": 1, "merchantId": "m", "merchantName": "가상 점포 A",
  "title": "체험 음료 1잔", "detail": "…", "status": "ISSUED", "issuedAt": "ISO", "expiresAt": "ISO", "redeemedAt": null }
```

`POST /me/badges/rewards/:milestone/open` (본문 없음 또는 `{}`) → 200 `{ "coupon": Coupon, "replayed": boolean }`
오류: 400 `INVALID_REQUEST`(milestone 1–3 외), 409 `REWARD_LOCKED`, 409 `REWARD_OFFER_UNAVAILABLE`, 409 `REWARD_CAPACITY_EXHAUSTED`, 삭제 계정은 기존 계정 수명주기 오류 매핑.

### 점원 (시연 앱 Bearer)

- `POST /merchant/merchants/:merchantId/coupons/lookup` `{ "customerIdentityToken": "masscom-customer:v1:…" }` → 200 `{ "identityExpiresAt": "ISO", "coupons": [{ "couponId", "title", "detail", "expiresAt" }] }` — 해당 점포의 사용 가능(`ISSUED`·미만료) 쿠폰만.
- `POST /merchant/merchants/:merchantId/coupons/:couponId/redeem` `{ "customerIdentityToken" }` → 200 `{ "couponId", "status": "REDEEMED", "redeemedAt", "replayed": boolean }`
- 두 요청 모두 `CONFIRM_VISIT` 권한 확인, 식별 토큰은 기존 resolve와 같은 규칙(미만료·미폐기·미소모, 다른 점포/점원에 묶였으면 거절, 미결합이면 이 점포·점원에 결합)으로 검증하고 소모하지 않는다.
- 오류: 기존 `MERCHANT_ACCESS_DENIED`·`CUSTOMER_IDENTITY_UNAVAILABLE`·`CUSTOMER_IDENTITY_EXPIRED`, 404 `COUPON_NOT_FOUND`(다른 고객·다른 점포·없는 쿠폰), 409 `COUPON_EXPIRED`, 403 `COUPON_SELF_REDEEM`(실제 점포에서 점원 계정이 쿠폰 소유 고객 본인일 때 사용 처리만 거절; 조회는 목록을 그대로 반환하고 시연 점포는 예외). 이미 사용한 같은 쿠폰은 `replayed:true`.

### 운영 웹

- 점원: `/api/web/merchant/merchants/:merchantId/coupons/lookup`, `/api/web/merchant/merchants/:merchantId/coupons/:couponId/redeem` — 기존 웹 claim 경로와 같은 Origin·JSON·세션·`staffRegistration.mine` 검사.
- 고객 읽기 전용 도감: `GET /api/web/badges` — `GET /me/badges`와 같은 본문. 웹은 표시만 하고 상자 열기는 앱에서 한다.

## 5. DB (`0027_badge_rewards.sql`)

- `badge_reward_offers(id uuid PK, milestone smallint 1–3, merchant_id → merchants, title 1–40자, detail ≤120자, valid_days 1–365(쿠폰 만료는 §3의 한국 날짜 기준), issuance_cap NULL|>0, issued_count ≥0, status ACTIVE|PAUSED, consent_note NOT NULL 비어 있지 않음, created_at)`, 부분 유일 색인 `(milestone) WHERE status='ACTIVE'`.
- `badge_coupons(id uuid PK, customer_account_id, milestone, offer_id → offers, merchant_id, title, detail(발급 시점 사본), status ISSUED|REDEEMED, issued_at, expires_at, redeemed_at, redeemed_by_account_id)`, `UNIQUE(customer_account_id, milestone)`, `REDEEMED`이면 `redeemed_at`·`redeemed_by_account_id` 필수 CHECK.
- ID는 기존처럼 애플리케이션 `randomUUID()`로 만든다.
- 상자 열기 트랜잭션: `BEGIN` → `assertActive` → 계정 단위 `pg_advisory_xact_lock` → 기존 쿠폰 조회(있으면 replay) → 메달 재계산 → 혜택 `FOR UPDATE` → 상한 확인 → 쿠폰 INSERT·`issued_count+1` → `COMMIT`.
- 사용 트랜잭션: 쿠폰 행 `FOR UPDATE` 후 조건부 UPDATE로 중복 사용 차단.
- 계정 삭제: `pseudonymizeAccount`에 두 계정 열을 추가한다.

## 6. 모바일 화면

- **도감**: ① 탐험 여권(마스코트·등급 이름·배지 n/9·다음 상자까지 남은 수·방문/앱 수집품/실제 NFT 요약) ② 배지(메달 3개, 등급 링·다음 등급 진행 호, 미획득은 마스코트 실루엣) — 누르면 상세(등급표·진행·이미지 공유) ③ 보상 상자 트랙과 내 쿠폰(티켓) ④ 스탬프판 ⑤ 앱 수집품 ⑥ 방문 기록. 시연 안내는 여권에 한 번만 둔다.
- **방문 인증 축하**: 코드 확인 시점과 수령 뒤의 배지 응답을 비교해 새 등급·새로 열 수 있는 상자를 보여준다. 도장 낙하·잉크 번짐·색종이·햅틱. `useReducedMotion`이면 정지 화면.
- **상자 열기**: 흔들림→열림→쿠폰 티켓. **쿠폰 사용**: 식별 QR·확인 코드·남은 초와 쿠폰 요약, 3초마다 상태 확인 후 `REDEEMED`면 "사용 완료" 도장.
- **공유 카드**: 하늘색 그라데이션·마스코트·메달·"동네 탐험가 골드"·"서로 다른 가게 3곳을 발견했어요"·서비스 주소. 계정 ID·날짜·점포 목록·지갑·QR 없음. 시연 앱은 카드에 "체험용 가상 기록"을 표시. `react-native-view-shot` 캡처 → `expo-sharing`; 실패하면 글자 공유.
- 의미를 색에만 맡기지 않는다: 등급 이름·상태 문구를 함께 표시하고 TalkBack 라벨에 값·다음 목표를 넣는다. 48dp 터치, 200% 글씨에서 세로 쌓기, 다크 모드 대비 유지.

## 7. 비범위

위치 추적, AR, 순위 경쟁, 운영 점주의 혜택 등록 화면(문서의 등록 절차로 대체), 공개 서버 배포, Play 제출.
