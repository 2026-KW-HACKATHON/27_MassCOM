# 사장님 AI 가게 그림: 시안 4장 → 선택 → 고품질 (D-048)

2026-09-29 소유자 요청: "사장님한테 4개 예시 보내고 선택하면 그거 AI 더 좋게 퀄리티 높여서 만드는 거". 소유자 결정 D-048: 가게 이름·메뉴로 스탬프·수집품 그림 시안 4장 → 사장님 선택 → 서버가 고해상도로 다시 만들어 고객 도감에 씀, OpenAI 이미지 API. 키는 소유자가 서버 비밀값 파일에 직접 넣는다(에이전트가 만들거나 저장소에 두지 않음). 소유자 지시(2026-09-29): "API 키가 있다는 가정하에 진행하고 나중에 넣어 달라고 요청". 계정·외부 유료 API·DB 스키마를 바꾸므로 민감 경로 규칙(서로 다른 모델 교차 리뷰 2회)을 따른다.

## 1. 목표와 성공 기준

- 점주 권한이 있는 사람이 앱에서 "AI 시안 받기"를 누르면 1~2분 안에 스타일이 다른 시안 4장을 본다.
- 하나를 고르면 같은 구도를 고품질로 다시 그린 최종본을 보고, "가게 그림으로 쓰기"를 누르면 고객 앱의 목록·지도·상세·도감에 그 그림이 나온다. "기본 그림으로 되돌리기"도 된다.
- 키가 없으면 기능은 "준비 중"으로 꺼져 있고 다른 기능에 영향이 없다. 키를 서버 비밀값에 넣고 API를 다시 시작하면 켜진다.
- 비용은 서버가 강제한다: 가게당 하루(KST) 시안 3회·최종 3회, 환경(운영/시연)별 월 예산 상한(기본 USD 5). 넘으면 요청 전에 거절한다.
- 키 없이도 로컬 가짜 이미지 서버(`AI_ART_OPENAI_BASE_URL`)로 전체 흐름을 시험할 수 있다.

## 2. 누가 어디서

- **점주 화면:** 시연 앱의 "점주예요" 모드(`ShowcaseMerchantScreen`)에 "가게 그림" 칸과 새 화면 `가게 그림 만들기`를 둔다. 운영 앱은 고객 전용이라는 기존 규칙(AGENTS.md, D-038)을 유지해 운영 앱에는 점주 화면을 넣지 않는다. 실제 점포용 웹(`/merchant/`) 화면은 이번 범위 밖이다(서버 API는 같은 것을 쓸 수 있다).
- **권한:** 서버의 기존 가게 멤버십 확인(`merchantAccess.requirePermission`)에 새 권한 `MANAGE_ART`를 더한다. OWNER를 부여하는 경로가 아직 없으므로 ACTIVE인 OWNER·STAFF 모두에게 준다(시연은 CLI로 소유자 계정에만 STAFF를 준다). OWNER 부여 경로가 생기면 OWNER 전용으로 좁힌다.

## 3. 그림 만들기 흐름

1. **시안(DRAFTING → DRAFTS_READY):** 서버가 가게 이름과 메뉴 이름 최대 5개로 프롬프트를 만든다. 사장님이 자유 문장을 넣지 않는다(남용·정책 위반 방지). 스타일 4종 각 1장, 병렬 4요청: `도장`(둥근 고무 도장 문양), `스티커`(두꺼운 외곽선 다이컷 스티커), `수채화`(부드러운 수채 카드), `판화`(목판화 느낌). 공통 제약: 동네 음식점의 귀여운 수집품 그림, 정사각 구도, **사진처럼 보이지 않게**, 실존 인물·상표·로고·글자·숫자·QR 없음. 모델 `gpt-image-2.5-flare`, `quality: low`, `1024x1024`, `output_format: webp`, 압축 70.
2. **선택 → 최종(FINALIZING → FINAL_READY):** 고른 시안을 `/v1/images/edits`에 넣고 "같은 디자인·구도·색을 고해상도의 깔끔한 일러스트로" 다시 그린다. 모델 `gpt-image-2.5-sunburst`, `quality: high`, `1024x1024`, webp 압축 85.
3. **적용(APPLIED):** 사장님이 최종본을 보고 "가게 그림으로 쓰기"를 누르면 가게 대표 그림이 된다. 적용 전에는 고객에게 보이지 않는다.
4. **되돌리기:** 가게 대표 그림을 지워 기본(시연 번들 그림 또는 글자 도장)으로 돌린다.

- 모델 이름·품질은 환경 변수로 바꿀 수 있다(`AI_ART_DRAFT_MODEL`, `AI_ART_FINAL_MODEL`). 기본값은 위 값.
- 생성은 오래 걸리므로(공식 문서: 최대 2분) **비동기**다. POST는 바로 202로 라운드를 돌려주고, API 프로세스 안에서 생성을 이어 간다. 앱은 3초마다 라운드를 조회한다. 진행 중 라운드가 5분 넘게 갱신되지 않으면(API 재시작 등) 읽을 때 `FAILED(AI_ART_INTERRUPTED)`로 바꾼다.
- 한 가게에 진행 중(DRAFTING·FINALIZING) 라운드는 하나뿐이다(DB 부분 유일 색인).
- 실패 코드: `AI_ART_MODERATION_BLOCKED`(정책 차단, 재시도 안 함), `AI_ART_UPSTREAM_UNAVAILABLE`(429·5xx·네트워크, 한 번만 백오프 재시도 후 실패), `AI_ART_TIMEOUT`(요청당 180초), `AI_ART_BUDGET_EXHAUSTED`, `AI_ART_INTERRUPTED`. OpenAI의 `x-request-id`는 서버 로그에만 남긴다.

## 4. 비용 한도

- `ai_art_spend`에 호출마다 실제 비용(마이크로 USD)을 적는다. 응답 `usage`로 계산: 텍스트 입력 $5/1M, 이미지 입력 $8/1M, 이미지 출력 $30/1M 토큰(2026-09 공식 단가). 요율도 환경 변수로 둔다.
- 호출 전에 예상 비용(시안 라운드 $0.04, 최종 $0.12, 보수적으로 잡음)을 이번 달(KST) 합계에 더해 상한(`AI_ART_MONTHLY_BUDGET_USD`, 기본 5)을 넘으면 `503 AI_ART_BUDGET_EXHAUSTED`로 거절한다. 예산 확인과 기록은 환경 전체 advisory lock으로 직렬화한다.
- 가게당 하루(KST) 시안 라운드 3회·최종 3회를 넘으면 `429 AI_ART_DAILY_LIMIT`(다음 KST 0시까지 Retry-After).

## 5. 데이터 (migration 0029, 추가형)

- `merchant_art_rounds(id uuid PK, merchant_id text FK merchants, requested_by_account_id text NULL, status text CHECK IN ('DRAFTING','DRAFTS_READY','FINALIZING','FINAL_READY','APPLIED','FAILED'), chosen_index int NULL CHECK 0..3, failure_code text NULL, business_date date NOT NULL, created_at, updated_at)` + 가게별 진행 중 라운드 부분 유일 색인 + `(merchant_id, business_date)` 색인.
- `merchant_art_images(round_id uuid FK ON DELETE CASCADE, kind text CHECK IN ('DRAFT','FINAL'), idx int CHECK 0..3, style text, image bytea NOT NULL, sha256 text NOT NULL, created_at, PRIMARY KEY(round_id, kind, idx))`. 이미지는 webp 바이트를 DB에 둔다(파일 볼륨이 없고 컨테이너가 읽기 전용이라 가장 단순하다. 수가 적다).
- `merchant_art(merchant_id text PK FK merchants, image bytea NOT NULL, sha256 text NOT NULL UNIQUE, round_id uuid NULL, applied_at)`.
- `ai_art_spend(id bigserial PK, merchant_id text NULL, round_id uuid NULL, kind text, micro_usd bigint NOT NULL CHECK >= 0, created_at)` + `created_at` 색인.
- 정리: 새 라운드를 만들 때 그 가게의 적용되지 않은 30일 지난 라운드를 지운다(이미지 CASCADE).
- 계정 삭제(`account-deletion.ts`): 그 계정의 `merchant_art_rounds.requested_by_account_id`를 같은 거래에서 NULL로 바꾼다. 가게 그림은 가게 자산이라 지우지 않는다.

## 6. API

점주용(기존 고객 Bearer 인증 + `MANAGE_ART`):
- `GET /merchant/merchants/:id/art` → `{ configured, current: { artUrl } | null, quota: { draftRoundsLeft, finalsLeft }, round: Round | null }` (가장 최근 적용되지 않은 라운드)
- `POST /merchant/merchants/:id/art/rounds` → `202 Round`. 오류 `409 AI_ART_ROUND_IN_PROGRESS`, `429 AI_ART_DAILY_LIMIT`, `503 AI_ART_NOT_CONFIGURED`, `503 AI_ART_BUDGET_EXHAUSTED`
- `GET /merchant/merchants/:id/art/rounds/:roundId` → `Round`
- `POST /merchant/merchants/:id/art/rounds/:roundId/choose { index }` → `202 Round`(상태가 DRAFTS_READY일 때만, 아니면 `409 AI_ART_ROUND_STATE`)
- `POST /merchant/merchants/:id/art/rounds/:roundId/apply` → `200 { artUrl }`(FINAL_READY일 때만)
- `DELETE /merchant/merchants/:id/art` → `200 { status: 'RESET' }`
- `Round = { id, status, drafts: [{ index, style, label, imageDataUrl }], chosenIndex, final: { imageDataUrl } | null, failureCode, createdAt }`. 시안·최종 이미지는 점주에게만 data URL로 준다(낮은 품질 webp 4장 합 수백 KB 이하).

공개:
- `GET /merchant-art/:sha256.webp` → `image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. sha256 형식이 아니면 404. 현재 적용된 그림만 제공한다.
- `GET /merchants`·`/merchants/:id`의 `PublicMerchant`에 `artUrl: string | null`(`/merchant-art/<sha256>.webp` 상대 경로)을 더한다.

## 7. 앱

- **고객:** `merchantArtSource(merchantId)`가 서버 `artUrl`이 있으면 `{ uri: apiUrl + artUrl }`를 먼저 쓰고, 없으면 기존 시연 번들 그림, 그것도 없으면 글자 도장. 목록 문장(`merchant-crest`), 지도 핀, 가게 상세 히어로, 도감 도장판·수집품 카드가 모두 이 다리를 쓴다(수집품 카드도 다리로 바꾼다). AI 그림에는 상세 히어로의 작은 안내 "사장님이 고른 AI 그림"을 붙인다. 친구 여권은 이번에도 글자 도장.
- **점주(시연 앱):** `가게 그림 만들기` 화면.
  - 지금 그림(없으면 기본 그림 안내)과 오늘 남은 횟수, "AI 시안 받기" 버튼.
  - 만드는 중: 마스코트 연출과 "1~2분 걸려요", 3초 간격 조회, 화면을 떠나도 서버에서 계속 만든다.
  - 시안 4장 2×2(스타일 이름을 글자로도 보임, 선택 표시는 색 외 테두리·체크), "이 시안으로 고급 그림 만들기" 확인.
  - 최종본 크게 보기, "가게 그림으로 쓰기"·"다시 고르기(새 시안)".
  - 되돌리기 확인 창. 키 없음·예산 소진·하루 한도·정책 차단은 각자 한 줄 안내.
  - 모든 버튼 접근성 라벨, 이미지 설명은 "AI 시안 1, 도장 스타일".

## 8. 개인정보·정책·문서

- OpenAI에는 **가게 이름과 메뉴 이름만** 보낸다. 고객·점주 개인 정보, 계정 id는 보내지 않는다. `user` 필드에는 가게 id의 해시만 넣는다. OpenAI API 데이터는 기본적으로 학습에 쓰이지 않고 남용 감시용으로 최대 30일 보관된다(공식 문서).
- `docs/privacy.html` 외부 서비스 목록에 "OpenAI(가게 그림 생성, 가게 이름·메뉴만 전송)"를 더한다.
- D-036·D-045 경계 유지: 실제 음식점 사진처럼 보이는 그림 금지(프롬프트 제약), 그림은 "AI로 만든 그림"임을 점주·고객 화면에 밝힌다. 운영 NFT 메타데이터에는 쓰지 않는다.
- 키: 운영은 `.tmp/lightsail-runtime.env`와 서버 `/opt/masscom/runtime.env`의 `OPENAI_API_KEY`, 시연은 `/opt/masscom-showcase/runtime.env`의 `SHOWCASE_OPENAI_API_KEY`. 소유자가 직접 넣는다. compose가 비어 있으면 빈 값으로 넘겨 기능이 꺼진다. `scripts/check-secrets.sh`에 `sk-` 형태 키 패턴을 더한다.

## 9. 범위 밖

- 실제 점포 웹(`/merchant/`) 화면, 가게 등록 시 자동 생성, 관리자 검수 대기열, 자유 프롬프트, 친구 여권의 그림, NFT 메타데이터 연결.

## 10. 시험과 증거

- API 단위: 프롬프트 조립(이름·메뉴 정리, 금지 제약 포함, 자유 입력 없음), 비용 계산(usage→마이크로 USD), 상태 전이, 오류 매핑(moderation_blocked·429·5xx·시간 초과), 예산·하루 한도, data URL·공개 URL 형식, 가짜 OpenAI fetch 주입.
- PostgreSQL 통합: migration, 진행 중 라운드 하나, 한도, 예산 직렬화, 적용·되돌리기·공개 그림 조회, 오래된 진행 중 라운드의 INTERRUPTED 처리, 계정 삭제 시 요청자 NULL, 권한 없는 계정 거절.
- 모바일: 화면 상태 모델(행동 시험), 폴링 수명, 그림 다리 우선순위, 접근성 라벨.
- 로컬 실측: 가짜 OpenAI 서버(고정 webp를 돌려줌)로 시연 앱 점주 모드에서 시안→선택→최종→적용→고객 화면 표시를 실폰에서 확인.
- 교차 리뷰: sonnet 코드 + opus 보안·비용·개인정보.
- 키를 넣은 뒤의 실제 호출(비용·지연 측정)은 소유자 키 입력 뒤 따로 한다(`NOT_RUN`까지 표시).
