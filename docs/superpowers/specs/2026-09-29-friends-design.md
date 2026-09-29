# 친구: 친구 코드로 서로 추가하고 탐험 여권을 보기 (Issue #230, D-047)

2026-09-29 소유자 요청: "친구추가 기능이랑 친구 공유 기능". 소유자 선택(D-047): 친구 코드·QR로 서로 추가하고, 친구에게는 **메달 등급·배지 수·가본 가게 도장만** 보인다. 방문 날짜·시간은 비공개. 가게 추천 보내기와 친구 도감 순위를 둔다. 계정·개인정보·DB 스키마를 바꾸므로 민감 경로 규칙(서로 다른 모델 교차 리뷰 2회)을 따른다.

## 1. 목표와 성공 기준

- 두 사람이 만나서(또는 메신저로) 친구 코드를 주고받으면 서로의 탐험 여권을 볼 수 있다.
- 친구 목록은 배지 수로 순위를 보여 "누가 더 많이 탐험했나"를 비교한다.
- 가게 카드·상세에서 "친구에게 추천"을 누르면 시스템 공유창으로 가게 링크를 보낸다(앱 안 메시지 없음).
- 친구가 볼 수 있는 정보는 서버가 **허용 목록으로만** 만든다: 별명, 메달 3종 등급, 배지 n/9, 가본 가게 이름 목록(도장 순서 없음). 방문 날짜·시각·횟수, 쿠폰, 지갑·NFT, 계정 ID, 이메일은 절대 포함하지 않는다.
- 친구 끊기·코드 바꾸기·계정 삭제 시 관계와 노출이 즉시 사라진다.

## 2. 데이터 (migration 0028, 추가형)

- `explorer_profiles(account_id text PK, nickname text NOT NULL CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 12), updated_at timestamptz)`: 별명이 없으면 "탐험가 + 코드 뒤 4자리"를 보인다.
- `friend_codes(account_id text PK, code text UNIQUE NOT NULL CHECK (code ~ '^[2-9A-HJ-NP-Z]{8}$'), created_at, rotated_at)`: 헷갈리는 글자(0·O·1·I) 없는 8자리. 처음 친구 화면을 열 때 만든다. 바꾸면 옛 코드는 즉시 무효, 기존 친구 관계는 유지.
- `friendships(id uuid PK, account_low text, account_high text, created_at, UNIQUE(account_low, account_high), CHECK (account_low < account_high))`: 한 쌍에 한 행. 화면·API에는 `id`만 보이고 상대 계정 ID는 보이지 않는다.
- `friend_code_attempts(account_id text, attempted_at timestamptz)` 또는 기존 속도 제한 패턴: 코드 추가 실패는 계정당 10분 10회로 제한한다(무차별 대입 방지).
- 계정 삭제(`account-deletion.ts`): 그 계정의 `friend_codes`, `explorer_profiles`, 양쪽 `friendships`, 시도 기록을 같은 거래에서 지운다.

## 3. API (고객 인증 필수, 기존 Bearer 세션)

- `GET /me/friends` → `{ me: { nickname, code, badges, medals }, friends: [{ friendshipId, nickname, badges: { earned, total: 9 }, medals: [{ key, tier }], stamps: [{ merchantName }], rank }] }`. 순위는 나와 친구들을 배지 수 → 도장 수 → 별명 순으로.
- `POST /me/friends { code }` → 추가(자기 자신 거절 `FRIEND_SELF`, 없는 코드 `FRIEND_CODE_NOT_FOUND`, 이미 친구면 같은 결과 재응답, 친구 최대 100명 `FRIEND_LIMIT`, 속도 제한 `FRIEND_CODE_RATE_LIMITED` 429).
- `DELETE /me/friends/:friendshipId` → 내 관계만 끊는다(양쪽에서 사라짐).
- `POST /me/friend-code/rotate` → 새 코드.
- `PUT /me/profile { nickname }` → 1~12자, 앞뒤 공백 제거, URL·이메일 모양 거절.
- 메달·배지·도장 계산은 기존 `badge-rules`·도감 모델을 재사용하고, 친구 응답 직렬화는 전용 함수 하나에서 허용 필드만 고른다(시험으로 필드 목록 고정).
- 시연 서버·운영 서버 모두 같은 코드. 시연 DB의 가상 점포 도장은 시연 계정끼리만 보인다.

## 4. 앱

- **탭:** 다섯 번째 칸 `친구`를 더해 `탐색 · 지도 · (방문 인증) · 도감 · 친구`로 가운데 도장 버튼이 정가운데가 된다.
- **친구 화면:** `AppHeader`("친구", "코드를 주고받으면 서로의 여권을 볼 수 있어요") + `friends` 마스코트.
  - 내 카드: 별명(바꾸기), 친구 코드 크게, QR(내용 `https://masscom.kr/open?friend=CODE`), "코드 공유"(시스템 공유), "코드 바꾸기".
  - "친구 추가": 코드 입력칸(8자리, 자동 대문자) 또는 QR 촬영(기존 방문 인증 카메라 스캐너 재사용).
  - 친구 순위 목록: 순위·별명·메달 점·배지 n/9, 누르면 친구 여권.
- **친구 여권:** 메달 3종 등급, 배지 수, 가본 가게 도장판(읽기 전용, 날짜 없음), "친구 끊기"(확인 창).
- **가게 추천:** 음식점 상세와 지도 가게 카드에 "친구에게 추천" → 시스템 공유창(`https://masscom.kr/open?merchant=ID` + 가게 이름). 가상 점포는 "시연용 가상 점포" 문구를 함께 넣는다.
- **링크:** `/open?friend=CODE`는 친구 추가 확인 화면으로, `/open?merchant=ID`는 음식점 상세로 연다(기존 App Link 도메인 재사용). 로그인 전이면 로그인 뒤 이어서 처리한다.

## 5. 개인정보·문서

- `docs/privacy.html`(공개 개인정보 안내)와 계정 삭제 안내에 별명·친구 코드·친구 관계·친구에게 보이는 항목·삭제 시 처리 문구를 추가한다. 공개 웹 배포가 필요하다.
- 친구가 보는 정보는 "메달 등급·배지 수·가본 가게 이름"으로 앱 화면에도 한 번 밝힌다.

## 6. 범위 밖

- 앱 안 메시지·알림·친구 요청 승인 단계(코드를 준 것 자체를 동의로 본다), 전체 사용자 검색, 친구의 방문 날짜.

## 7. 시험과 증거

- API 단위: 코드 형식·생성 충돌 재시도, 별명 검증, 추가 오류 코드, 직렬화 허용 필드 고정.
- PostgreSQL 통합: migration, 추가·중복·자기 추가·한도·속도 제한, 끊기, 코드 바꾸기, 계정 삭제 정리, 동시 추가 경쟁(같은 쌍 한 행).
- 모바일: 탭 다섯 칸, 코드 입력 정규화, 순위 정렬, 링크 처리, 추천 공유 문구.
- 교차 리뷰: sonnet 코드 + opus 보안·개인정보.
- 실폰 두 계정 확인은 소유자 두 번째 계정이 필요하다(없으면 로컬 DEMO 계정 두 개로 에뮬레이터·실폰 확인).
