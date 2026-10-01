# 마일리지 상점 설계 (Issue #298, 2026-10-01)

소유자 결정: 재뽑기는 **같은 등급 안에서만** 균등 무작위다. 상점 캐릭터는 펭귄일 필요가 없다(에이전트가
"하늘 동네 가게 친구들" 9종, 등급마다 3종을 선택). 방문 보상·도감·NFT·쿠폰은 바뀌지 않으며, 무작위는
오직 코스메틱 프로필 캐릭터에만 적용된다. 현금 충전·사용자 간 양도·환전은 없다.

## 적립(저장하지 않고 계산)

`earned(account) = 50 × 센 방문 + 100 × 그 방문들의 서로 다른 점포 + 200 × 완성한 점포 시리즈`

- 센 방문: 진행에 실제로 센 방문(배지/메달 집계와 같은 정의: 취소·중복·실제 점포 자기 적립은 자동 제외,
  되돌리기로 승격된 방문은 포함). `apps/api/src/postgres/badge-rewards.ts`의 `countedVisitFromSql`·
  `countedVisitFilterSql`을 그대로 재사용하고 다시 만들지 않는다.
- 완성한 점포 시리즈: 그 점포의 아무 캠페인이든(끝났거나 비공개여도) 캠페인의 보상 목표를 전부
  유효·비철회 `reward_entitlements`(`GRANTED`·`MINT_REQUESTED`·`FULFILLED`)로 채웠으면 그 점포를
  한 번만 센다. 공개 점포 목록(`merchant-catalog.ts`)은 끝난/비공개 캠페인을 가려서 보지 않는다.
- 공식의 가중치는 서버 모듈 하나(`mileage-rules.ts`)에만 있고 API 응답에도 그대로 실어 앱이
  하드코딩하지 않게 한다.

`balance = earned − spent(원장)`. 방문 취소로 잔액이 음수가 되면 그 이상 가격만큼 모일 때까지 구매를
막되, 이미 받은 캐릭터는 되가져가지 않는다.

## 데이터 모델 — migration 0038

- `mileage_spends(id uuid PK, account_id, amount CHECK>0, reason CHECK IN('REROLL'), grade, item_id,
  request_id, created_at, UNIQUE(account_id, request_id))` — `request_id`는 클라이언트가 주는
  멱등 키이고 재시도는 같은 결과를 돌려준다.
- `account_characters(account_id, item_id, acquired_at, source CHECK IN('REROLL'), PK(account_id, item_id))`
- `account_profile(account_id PK, avatar_item_id, updated_at, FK(account_id, avatar_item_id) →
  account_characters(account_id, item_id) ON DELETE SET NULL(avatar_item_id))`
- 카탈로그는 코드의 정적 목록(DB 테이블 아님): 브론즈 cook-cat/cafe-bear/walk-rabbit, 실버
  bakery-squirrel/flower-hedgehog/book-owl, 골드 tteok-tiger/market-raccoon/laundry-seal. 가격은
  브론즈 100P·실버 200P·골드 400P.
- 계정 삭제는 세 테이블을 모두 가명 처리 없이 지운다(보존 기간 없음).
- **번호 순서:** 0037은 PR #300이 먼저 썼을 수 있다(이 설계 당시 main에는 없었다). `migrate.ts`는
  파일명 순서로 적용하므로 두 PR이 어느 순서로 병합돼도 각자 동작하지만, 0037이 아직 main에 없는
  상태로 이 PR이 먼저 병합되면 다음에 0037이 병합될 때 두 migration의 순서가 뒤바뀐 채 적용된다(해롭지
  않음, 둘 다 서로 다른 새 테이블만 만든다). 두 PR 모두 이 의존 관계를 설명에 남긴다.

## API(고객 인증, 운영·시연 공통)

- `GET /shop` → `{mileage: {earned, spent, balance, rules}, grades: [{grade, price, total, owned,
  remaining, probabilityPerItem}], items: [{id, grade, name, owned}], avatar}`
- `GET /shop/history?cursor` → 지출 내역 + 적립 요약(방문별 개인정보 없음)
- `POST /shop/rerolls {grade, requestId, expectedRemaining}` → `201 {item, balance, replayed}`;
  오류 `400 INVALID_REQUEST`, `402 SHOP_INSUFFICIENT_MILEAGE`, `409 SHOP_GRADE_COMPLETE /
  SHOP_STATE_CHANGED / SHOP_REQUEST_CONFLICT`, `410 ACCOUNT_DELETED`, `429 SHOP_RATE_LIMITED`(시간당
  30회). 한 트랜잭션: 계정 잠금 → `requestId` 재생 확인 → 비율 제한 → `expectedRemaining` 일치 확인 →
  등급 완료 확인 → 잔액 확인 → 그 등급 미소유 품목 중 암호화 난수로 균등 선택 → 삽입.
- `PUT /shop/avatar {itemId|null}` → `200`; `404 SHOP_ITEM_NOT_OWNED`.
- 확률 고지: 앱은 구매 전 "남은 N종 중 하나를 같은 확률(1/N)로 받아요"를 보이고, 서버의 선택은 그
  `remaining` 목록 안에서 정확히 균등하다.

## 리뷰 반영(Codex gpt-6.1-sol, 2026-10-01) — 아래가 위 내용을 덮어쓴다

1. **잠금:** 모든 재뽑기/대표 설정 트랜잭션은 기존 `assertActive(client, accountId)`
   (`account-lifecycle.ts:35`)만 쓰고 그 client로 모든 읽기·쓰기를 한다 — 방문 수령·되돌리기와 같은
   잠금이다. 상점 전용 별도 advisory/row 잠금은 없다. 세 테이블 정리는 공유 삭제 경로
   (`account-deletion.ts:102`, 자기 삭제·운영자 처리 공통)에 둔다.
2. **FK:** `FOREIGN KEY (account_id, avatar_item_id) REFERENCES account_characters(account_id,
   item_id) ON DELETE SET NULL (avatar_item_id)`(PostgreSQL 15+ 컬럼 지정). 대표가 설정된 계정을
   지우는 시험을 둔다.
3. **멱등 순서:** `POST /shop/rerolls`는 잠금 확인 → 기존 `(account_id, request_id)` 조회 → 있고
   등급이 같으면 새 검사 없이 **그 품목과 지금 잔액**으로 재생 → 등급이 다르면
   `409 SHOP_REQUEST_CONFLICT` → 새 요청일 때만: 비율 제한 → `expectedRemaining` 확인 → 완료 확인 →
   잔액 확인 → 선택 → 삽입.
4. **적립의 센 방문** = 배지 집계가 쓰는 집합과 정확히 같다(`badge-rewards.ts:71`: `VALID AND
   progress_counted`, 실제 점포 자기 적립 제외) — 그 SQL을 재사용한다(공유 함수로 추출), 도감 목록
   길이로 다시 세지 않고 취소 건수를 빼지도 않는다. 서로 다른 점포 항은 같은 집합의 distinct
   merchant다. 시험: 같은 날 중복, 직원/자기 적립, 취소된 원본, 취소 뒤 승격된 중복(`reversal.ts:203`).
5. **적립의 시리즈 완성** = 점포마다 한 번, 아무 캠페인이든(끝났거나 비공개여도) 그 캠페인의 모든
   보상 목표에 유효(비철회) entitlement가 있으면(`collection.ts:107`의 뜻). 공개 점포 카탈로그는
   절대 보지 않는다(끝났거나 비공개인 캠페인을 가린다, `merchant-catalog.ts:60`). 모바일 표시용
   `store-series.ts`는 그대로 둔다(표시 전용). entitlement/되돌리기/NFT 규칙은 바꾸지 않는다.
6. `POST` 본문은 `expectedRemaining`(클라이언트가 본 수)을 포함하고, 잠금 안에서 지금 그 등급의
   미소유 수와 비교한다. 다르면 과금 없이 `409 SHOP_STATE_CHANGED`이고 클라이언트는 고지를 다시 읽는다.
7. **Android(이 PR의 범위 아님, 후속 PR):** 하단 바를 홈·지도·방문 인증·도감·상점으로 바꾸고 친구는
   홈 헤더/내 정보로 이동(친구 화면 자체는 유지), 상점 탭 UI, 뽑기 애니메이션, 헤더 대표 캐릭터 표시.
8. Migration 번호는 0038(0037은 #294/PR #300이 먼저 쓸 수 있다).

## 시험

- 서버 단위(DB 없음, `mileage-rules.test.ts`): 적립 공식(이미 걸러진 수치에 대한 가중치), 균등
  선택이 미소유 목록 안에서만 고르는지, 재뽑기 분기 순서(재생·충돌·비율 제한·`expectedRemaining`·
  완료·잔액)를 고정한 순수 결정 함수, 대표 설정은 소유한 것만.
- PostgreSQL 통합(`mileage-shop.postgres.integration.ts`, 일회용 `postgres:16`): 적립 공식이 배지
  집계와 같은 집합을 재사용하는지(중복·자기 적립·취소·승격 방문 포함/제외), 점포 시리즈 완성 규칙,
  멱등 재생·등급 충돌·`expectedRemaining`·완료·잔액 부족, 한 계정의 동시 재뽑기가 과소비·중복 지급을
  내지 않는지, 방문 취소로 잔액이 음수가 돼도 보유 캐릭터는 유지되는지, 계정 삭제가 세 테이블(대표
  포함)을 지우는지.
- 모바일(후속 PR): 확률 문구·비활성 상태·그리드 소유 매핑·탭 구성의 순수 시험.

## 위험

- 적립 공식이 방문·진행 정의와 정확히 일치해야 한다 → 기존 서버 질의를 재사용하고 다시 만들지 않는다.
- 동시성 → 지출 트랜잭션 안의 계정별 잠금(기존 `assertActive`).
- 법률·인식 → 코스메틱 전용, 등급 안 균등, 고지, 현금 없음.
