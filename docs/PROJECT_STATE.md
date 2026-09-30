# 프로젝트 상태

마지막 갱신 시각: 2026-09-30 KST

## 최신 작업 경계

- **NFT 메타데이터를 발행 확정 때 고정([Issue #254](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/254), [D-057](DECISIONS.md) 결정 1~6 `USER_CONFIRMED`·구현 a~i `PROPOSED`, 브랜치 `feat/254-nft-metadata`, 로컬 커밋만):** migration 0034(점포 `neighborhood`·`category` NULL 열과 CHECK, `nft_series` id 경로 CHECK `NOT VALID`, 수정 불가 `nft_token_metadata`·그림 보존 `nft_metadata_images`), Worker 생성기와 `finalize` 트랜잭션 안의 스냅샷(`NFT_METADATA_ORIGIN` 필수), API 공개 경로 `GET`·`HEAD /nft-metadata/<series>/<tokenId>.json`·`/nft-metadata/images/<sha256>.webp`, 관리자 API·웹의 동네(행정동)·업종, 운영 Caddy 라우팅(실증 토큰은 정적 그대로), 시연 seed 동네·업종, 개인정보 처리방침. 시리즈의 온체인 base URI는 `<출처>/nft-metadata/<nft_series.id>/`(운영 `https://masscom.kr`, 시연 `https://demo-api.masscom.kr`). 운영 발행은 여전히 `PREPARING`이고 Worker가 배포된 환경이 없어 새 토큰은 생기지 않는다. 시험 결과는 [TEST_STATUS](TEST_STATUS.md) 첫 항목, 배포·실발행·교차 리뷰는 `NOT_RUN`.

- **실제 점포 운영 시작: 공개·점주·보상 혜택·캠페인·운영 NFT 발행 준비 중([Issue #246](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/246), [D-054](DECISIONS.md)·D-055 `PROPOSED`·D-023 확정, 브랜치 `feat/246-store-go-live`, main `02cb7e7` 기준, 로컬 커밋만):** 소유자가 2026-09-30 정한 대로 관리자 웹에서 SQL 없이 실제 점포를 운영 시작한다. migration 0032(점포·혜택 참조 번호 열과 공개 시각, 감사 대상 계정 열, 감사 action CHECK를 기존 8개 + 새 7개로 확장; 열 추가·CHECK 확장만이라 배포된 API `02cb7e7`가 그대로 돈다), 점포 공개(메뉴·영업시간·주소 + 가게 이름·사진 사용 동의서 참조 번호), ACTIVE STAFF → OWNER 올리기·내리기(사업자등록증 원본과 점포 전화 확인 뒤 확인 기록 참조 번호만, 점포당 2명, 본인 불가), 점주 동의 5항목·발급 상한 필수의 보상 혜택 등록·멈춤, 캠페인 공개·중지·다시 공개, 운영 compose `NFT_MINTING_MODE=PREPARING`으로 고객 앱·웹의 "발행 준비 중"(시연 발행은 그대로). 참조 번호는 사업자등록번호·전화번호·이메일 모양을 서버·DB가 거절한다. 잠금 순서는 계정 advisory → 관리자 행 → 점포 행 → 멤버·혜택·캠페인 행. 운영자 안내는 [점포 온보딩 안내](MERCHANT_ONBOARDING.md). 교차 리뷰 opus 보안·sonnet 코드 모두 APPROVE(🔴 0)였고 후속(고정 PREPARING·발행 요청 409·점주 변경 10분 로그인·공개 중 수정 제한·혜택 글 검사·lock_timeout·고객 앱 "정원 마감" 제거·관리자 웹 확인창·접근성)을 반영한 뒤 main `4081999`를 합쳤다. 시험: API 단위 240/240, PostgreSQL 229건 중 227 PASS·0 FAIL·2 SKIP, 웹 170/170(운영 웹 114), 모바일 780/780·typecheck·lint, gate PASS([TEST_STATUS](TEST_STATUS.md) 첫 항목). go-live 전제 조건: LIVE 전 PREPARING 동안의 권리 기한 연장 migration([B-027](BLOCKERS.md)). 병합·배포 뒤에는 API를 이 커밋 아래로 되돌리지 않는다(fix forward). `NOT_RUN`: 운영 migration·배포, 인증된 브라우저의 실제 점포 공개·점주 올리기, 실기기 "발행 준비 중" 화면, 독립 교차 리뷰.

- **방문·쿠폰 되돌리기·계정 삭제 처리 운영·시연 배포와 시연 Preview 11 공개([Issue #250](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/250), 기능은 Issue #243·#194):** PR #245(main `1c59f9a`)와 PR #247(main `02cb7e7`, main CI 36643877980 SUCCESS)을 [운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)과 시연 API에 배포](evidence/reversal-deletion-deployment-2026-09-30.json)했다. 운영은 api·production-web 이미지 `02cb7e7c5998`이 2026-09-29T23:14:32Z에 시작해 healthy이고 `f1bba2d`에서 `02cb7e7`까지 migration 0030·0031은 `backward_compatible=yes`(옛 API의 `ON CONFLICT ON CONSTRAINT reward_entitlements_unique_goal`과 `ON CONFLICT (account_id) DO NOTHING`이 그대로 동작하도록 같은 이름의 부분 제외 제약과 `account_id` 고유 색인을 남겼다)이며 마지막 적용은 `0031_account_deletion_processing.sql`, 새 표 `badge_coupon_audit`·`account_deletion_intake_requests`는 0행이다. **운영 백업은 둘이다(호스트에서 오케스트레이터가 확인, 실제 복원 `NOT_RUN`):** 수동 `pre-02cb7e7-20260930.dump`(241항목·112234바이트·mode 600)와 배포 스크립트의 자체 pg_dump `database-before-02cb7e7c5998.dump.bbiAOH`(112234바이트). 시연 API는 수동 compose로 배포 전 백업 `pre-02cb7e7-20260930.dump`(241항목·114642바이트·mode 600)를 만든 뒤 이미지 `masscom-showcase-api:02cb7e7`로 교체하고(재생성 2026-09-29T23:15:52Z, healthy) host seed(`SHOWCASE_HOST_SEEDED`)를 실행했다. 두 API health 200, 운영 `/merchants` `{"merchants":[]}`, 접수번호를 모르는 삭제 조회 404, 세션 없는 삭제 접수 401, Origin 없는 조회 403이며 `privacy.html`·`account-deletion.html` 본문 해시가 apex·www 모두 저장소 `docs/`와 같다(운영에서 계정·방문·쿠폰·삭제 요청은 만들지 않았고 확인은 읽기·거절뿐). 운영 기동 로그는 `AI store art: disabled (OPENAI_API_KEY is empty)` 그대로다. [시연 Preview 11](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.11)(`MassCOM-showcase-android-18a8601.apk` 156643525바이트, SHA-256 `adb6d245c62b9ec11e71e0cfa9175babbd4a7f242a96d470c57c81fc433e2879`, 소스 `18a8601`은 `02cb7e7`과 모바일 접수번호 `Text` 속성만 다르다)을 공개 사전 릴리스로 게시했고 [GitHub digest 일치·익명 다운로드 200·Samsung SM-S928N의 기존 앱 위 `adb install -r` Success·역할 선택 첫 화면·계정 삭제 요청 접수→한 줄 접수번호→취소](evidence/showcase-preview11-release-2026-09-30.json)를 확인했다(점주 화면의 `최근 방문 확인`·`최근 쿠폰 사용` 카드 빈 상태는 후보 `02cb7e7` APK, 이때 찾은 접수번호 줄바꿈 결함은 PR #249로 고침; 시연 DB 시험 접수 둘은 `CANCELLED`·원 계정 ID 지움·접수번호 해시 보존; [캡처 5장](evidence/reversal-deletion-2026-09-30/README.md)에는 계정 식별자·접수번호가 없다). **`NOT_RUN`:** 폐기용 실 Google 계정의 운영 삭제 접수·처리 종단 실행([B-020](BLOCKERS.md)), 실제 점원의 방문 취소·쿠폰 되돌리기(고객 QR을 두 번째 휴대전화로 촬영해야 함), 운영자 CLI의 시연 삭제 처리, 세 DB 백업의 실제 복원, TalkBack·다크·글자 200%, 실제 AI 그림 생성(시연 API에 키 없음), 실제 쿠폰 발급·사용과 Play 제출, 두 시연 계정의 친구 추가·시연 앱 링크 열기([B-024](BLOCKERS.md))·시스템 공유창, 로그인 뒤 메달→상자→쿠폰→점원 사용 처리, 새 2분 고객 QR의 두 기기 수령이며 소유자의 화면 판정은 사용자 판정 필요다. **`VOIDED` 쿠폰·`CANCELED` 방문 행이 생긴 뒤에는 API를 `f1bba2d`로 되돌리지 않고 앞으로 고친다.** 이 브랜치는 문서·증거 JSON·캡처·포털 검사 기대값만 바꾸고 앱·API·DB·서버는 바꾸지 않았다. 공개 /open은 현재 Preview 10 링크이고(2026-09-30 오케스트레이터 확인) Preview 11 링크는 이 문서 병합 뒤 웹 전용 재배포로 반영한다. 다음: [Issue #246](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/246) 점포 공개(go-live, 진행 중 브랜치 `feat/246-store-go-live`), P0 #5 이용약관·동의 화면과 앱 안 개인정보처리방침 링크, P0 #6 NFT 메타데이터 생성기. 소유자 입력 대기: `SHOWCASE_OPENAI_API_KEY`와 월 예산([B-026](BLOCKERS.md)), OpenAI 개인정보 문의 주소, 개인정보 보관 기간. 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다.

- **계정 삭제 요청: 웹 로그인 접수 + 운영자 처리([Issue #194](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/194), [D-052](DECISIONS.md), 브랜치 `feat/194-account-deletion-processing`, [PR #247](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/247) 병합 `02cb7e7`, CI PASS):** 소유자가 2026-09-30 정한 방식을 구현했다. 웹 Google 로그인 세션이 서버에서 대상 계정을 정해 접수하고 접수번호(HMAC 해시만 저장)를 한 번 보여 주며, 접수 뒤 24시간은 취소할 수 있고 그 뒤 플랫폼 관리자(관리자 웹)가 접수 뒤 7일 안에 처리한다. 처리는 D-026의 5분 `auth_time` 검사 없이 기존 forget 핵심(`forgetInTransaction`)을 한 트랜잭션에서 실행하고 삭제 ledger에 이어 `PROCESSED`로 닫으며 원 계정 ID를 접수 표에서 지운다. 요청자는 삭제 뒤에도 접수번호로 상태를 조회하고, `WAITING_FOR_MINT_FINALITY` ledger는 관리자 목록을 열 때 재정산한다. 시연 앱은 앱 안 Bearer 접수, 운영자는 시연 CLI로 처리한다. migration 0031은 추가·완화만이라 구 API 호환이다. opus 보안 리뷰 지적(접수·취소는 10분 안의 웹 로그인만, 옛 접수는 처리하지 않고 다시 접수해야 함, 삭제 때 세션 행 삭제, 공개 조회에서 개수 제거 등)을 반영하고 main `1c59f9a`(Issue #243 병합)를 합친 뒤 API 단위 229·PostgreSQL 219건(217 PASS·2 SKIP)·워커 47·통합 23·모바일 775·웹 154는 통과했지만(자세한 수치는 [TEST_STATUS](TEST_STATUS.md); #243이 더한 계정 열 네 개도 삭제 때 가명 처리됨을 전 열 검색 시험이 확인한다), **배포·폐기용 실계정 종단 실행·Android 실기·Play 제출은 `NOT_RUN`이며 [B-020](BLOCKERS.md)은 `BLOCKED`다.** 앱 안 직접 삭제는 그대로 막혀 있다. **이 문단은 병합 전 상태이며 운영·시연 배포와 시연 앱 접수→취소의 실기기 확인은 바로 위 Issue #250 항목이다(폐기용 실계정 종단 실행·Play 제출은 그대로 `NOT_RUN`, B-020은 `BLOCKED`).**

- **방문·쿠폰 되돌리기와 직원 자기 적립 차단([Issue #243](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/243), D-051, 브랜치 `feat/243-visit-coupon-reversal` 코드 커밋 `7d454fa`와 그 위의 리뷰 반영 커밋, main `f1bba2d` 기준, [PR #245](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/245) 병합 `1c59f9a`):** 소유자가 2026-09-30 실제 운영 전 P0 기능을 순서대로 구현하기로 승인한 첫 작업이다([설계](superpowers/specs/2026-09-30-visit-coupon-reversal-design.md)). migration 0030(방문 취소 열, 권리 유일성을 취소되지 않은 권리에만 거는 같은 이름의 부분 제외 제약(배포된 API와 호환), 쿠폰 `VOIDED`·감사 표, 관리자 감사 `COUPON_VOIDED`)과 점원 되돌리기 API 4개(앱·점주 웹 각각)·관리자 쿠폰 목록·무효화, 실제 점포 직원 계정 방문(본인 적립·방문한 계정이 그 점포의 ACTIVE 직원)의 `progress_counted = false`를 더했고 점주 웹 `/merchant/`·시연 앱 직원 화면·관리자 웹·고객 앱·운영 웹 도감(무효 쿠폰)에 반영했다. 방문 취소는 방문한 한국 영업일 안에서만 하며 발행 전 권리·발행 작업은 함께 취소하고 이미 체인에 보낸 것이 있으면 409로 거절한다. 검증은 [시험 상태](TEST_STATUS.md)에 있다: API 단위 212/212, PostgreSQL 통합 198건 중 196 PASS·0 FAIL·2 SKIP, 워커 47/47·통합 23/23, 모바일 751/751·typecheck·lint, 사이트 시험 127/127. opus 보안 재리뷰는 APPROVE(🔴 0)이고 그 후속(상자 열기와 관리자 무효화의 경쟁 차단·감사 CHECK 합집합·`canUndo`·메모 구분자·관리자 무효 상자 문구 등)을 반영했다. 후속 반영 커밋의 재리뷰·실기기·서버 migration 배포는 `NOT_RUN`이었다(병합 전 기록이며 운영·시연 migration 0030 배포는 바로 위 Issue #250 항목이고, 점주 화면의 새 카드 두 개의 빈 상태만 실기기로 확인했으며 실제 점원의 방문 취소·쿠폰 되돌리기는 그대로 `NOT_RUN`이다). 정책 값(창·사유·권한·승격·발급 수)은 D-051 `PROPOSED`다.

- **AI 가게 그림 운영·시연 배포와 시연 Preview 10 공개([Issue #240](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/240), 기능은 Issue #236):** PR #239를 main `f1bba2d`(main CI 36598828345 SUCCESS)로 병합한 뒤 [운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)과 시연 API에 배포](evidence/ai-store-art-deployment-2026-09-30.json)했다. 운영은 api 컨테이너가 2026-09-29T16:36:27Z에 시작했고 `/opt/masscom/DEPLOYED_COMMIT`이 `f1bba2d`이며 api·production-web·caddy가 healthy다. `87e98f4..f1bba2d`의 migration 차이는 `0029_merchant_art.sql`뿐이라 `backward_compatible=yes`이고 운영 DB에 `ai_art_spend`·`merchant_art`·`merchant_art_images`·`merchant_art_rounds`가 생겼다. **운영 백업은 둘이다(호스트에서 오케스트레이터가 확인, 실제 복원 `NOT_RUN`):** 배포 스크립트의 자체 pg_dump `database-before-f1bba2dd347f.dump.dnZkTu`(103256바이트, 2026-09-29 16:35Z)와 배포 전에 오케스트레이터가 먼저 만든 수동 `pre-f1bba2d-20260930.dump`(218항목·103256바이트·mode 600). 시연 API는 수동 compose 절차로 배포 전 백업(218항목·105671바이트·mode 600)을 만든 뒤 이미지 `masscom-showcase-api:f1bba2d`를 만들고 migration·container 교체(기동 2026-09-29T16:37:15Z, healthy)·host seed(`SHOWCASE_HOST_SEEDED`)를 했고 같은 테이블 4개가 있다. **두 서버의 기동 로그는 `AI store art: disabled (OPENAI_API_KEY is empty)`다.** 운영 `OPENAI_API_KEY`는 D-050에 따라 비워 두고(운영에는 소유자 채널이 없음) 시연 compose는 `AI_ART_STAFF_MAY_MANAGE=true`이며 시연 키는 아직 없다. 운영 API health 200, 없는 sha의 `/merchant-art/<sha>.webp` 404, `/merchants` `{"merchants":[]}`, 시연 API health 200이며 `masscom.kr`·`www`의 `/privacy` 본문 해시 앞 16자(`301e8cb0fa428664`)가 저장소 `docs/privacy.html`(OpenAI 처리자·국외 이전 고지 포함)과 같다. [시연 Preview 10](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.10)(`MassCOM-showcase-android-f1bba2d.apk` 156595653바이트, SHA-256 `403668c40641abaf68cc484c72f9ef7ecfac307d716d311b6cd14e646e0b62ad`)을 공개 사전 릴리스로 게시했고 [GitHub digest 일치·익명 다운로드 200·Samsung SM-S928N의 기존 앱 위 `adb install -r` Success·역할 선택 첫 화면·점주 화면의 "가게 그림 만들기" 카드와 화면 열기](evidence/showcase-preview10-release-2026-09-30.json)를 확인했다(현재 그림은 가상 점포 A의 번들 마스코트 그림, 남은 횟수 "시안 받기 3번 · 고급 그림 만들기 3번", 키가 없어 "AI 그림은 준비 중이에요"; 캡처는 저장하지 않았다). **`NOT_RUN`:** 실제 AI 그림 생성(키 없음)과 그 비용·지연, 공개 시연의 고객 화면 AI 그림 표시, TalkBack·다크·글자 200%, Preview 9에서 이어진 두 시연 계정의 친구 추가·시연 앱 링크 열기([B-024](BLOCKERS.md))·시스템 공유창, 로그인 뒤 메달→상자→쿠폰→점원 사용 처리, 새 2분 고객 QR의 두 기기 수령, 운영·시연 DB 백업의 실제 복원이며 소유자의 가게 그림 화면 판정은 사용자 판정 필요다. 이 브랜치는 문서·증거 JSON·포털 검사 기대값만 바꾸고 앱·API·DB·서버는 바꾸지 않았으며 친구 배포 문서의 운영 백업 서술을 호스트에서 확인한 값으로 바로잡았다. 공개 /open은 작성 당시 Preview 9 링크였고 Preview 10 링크는 이 문서(PR #244, main `f6fa12f`) 병합 뒤 웹 전용 재배포로 반영됐다(2026-09-30 오케스트레이터가 `https://www.masscom.kr/open`에서 최신 링크가 Preview 10임을 확인했고 HTTP 200이며 경로는 후행 슬래시 없는 `/open`이다(`/open/`은 404)). 새 차단 항목: 소유자의 키 입력 대기([B-026](BLOCKERS.md))와 발행한 Base Sepolia 토큰 metadata 주소의 404([B-025](BLOCKERS.md), PR #242와 2026-09-29 17:08Z 웹 전용 재배포로 해결). 다음: 소유자의 키·월 예산·OpenAI 문의 주소 확인 → 시연 API 재생성과 `enabled` 로그 확인 → 첫 실제 호출의 비용·지연 실측과 $0.18 재산정, 웹 전용 재배포. 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다.

- **사장님 AI 가게 그림([Issue #236](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/236), D-048·D-050, 브랜치 `feat/236-ai-store-art` 코드 커밋 `e9344ba`, [PR #239](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/239) 병합 `f1bba2d`, CI PASS):** 소유자가 정한 D-048(가게 이름·메뉴로 시안 4장 → 선택 → 고급 그림 → 고객 도감)을 구현했다. 서버는 migration 0029(라운드·이미지·가게 그림·호출별 비용 기록), 점주용 그림 API(`MANAGE_ART`), 공개 `/merchant-art/<sha256>.webp`, OpenAI 이미지 클라이언트(429·500·503만 한 번 재시도, 502·504와 네트워크 오류는 무재시도·본문 바이트 상한), 가게당 하루 한도(시안 3·최종 3, 한국 날짜)와 환경별 월 예산(기본 USD 5)을 더했고, 앱은 시연 점주 화면과 고객 화면(목록·지도·도장판·도감·상세)의 그림 표시를 더했다. `docs/privacy.html`에 OpenAI(미국)·가게 이름과 메뉴만 전송·국외 이전을 적었다. 독립 리뷰(sonnet 코드 APPROVE, opus 보안·비용·개인정보 REQUEST_CHANGES)의 지적 18건을 반영했다([설계 §11](superpowers/specs/2026-09-29-ai-store-art-design.md), [D-050](DECISIONS.md) `PROPOSED`): `MANAGE_ART`는 활성 OWNER만이고 STAFF는 `AI_ART_STAFF_MAY_MANAGE=true`인 시연 compose에서만 허용, 기본 주소 고정, 잘못된 설정에도 API 기동, 최종 예상 비용 $0.18, 적용 뒤 시안 삭제, 최종 실패 뒤 같은 라운드에서 다시 고르기(옛 시도의 늦은 덮어쓰기 방지 시도 표지 포함) 등, 그 뒤 opus 재리뷰 APPROVE(🔴 0)와 그 🟡·🔵 반영(처리방침 국외 이전 고지 항목 포함). 검증: API 단위 196/196, PostgreSQL 통합 159건 중 157 PASS·2 SKIP, 모바일 725/725, 두 variant export·자산 검사·개인정보·비밀 검사 PASS, 실제 휴대전화(SM-S928N) 개발 빌드 + 로컬 API + 가짜 이미지 서버로 시안→최종→적용→고객 화면 표시 확인([시험 상태](TEST_STATUS.md)). **`NOT_RUN`: 실제 OpenAI 호출·비용·지연 측정, 실제 1024² 이미지의 기기 표시, 정책 차단·준비 중·하루 한도 화면의 기기 확인, TalkBack, 시연 APK(Preview 10), 배포.** **운영 `OPENAI_API_KEY`는 소유자 채널(OWNER 부여 경로)이 생길 때까지 비워 둔다**(운영 STAFF는 이 API를 쓸 수 없다). 남은 일: 소유자가 시연 서버 `/opt/masscom-showcase/runtime.env`에 `SHOWCASE_OPENAI_API_KEY`를 직접 넣고 월 예산을 확인 → 시연 API 배포(migration 0029) → Preview 10 → 실제 호출 실측. **이 문단은 병합 전 상태이며 배포와 Preview 10 공개 결과는 바로 위 항목이다(키는 두 서버 모두 비어 AI 생성은 꺼져 있고 실제 호출 실측은 그대로 `NOT_RUN`).** 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로.

- **친구 운영·시연 배포와 시연 Preview 9 공개([Issue #234](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/234)):** PR #233을 main `87e98f4`(main CI 36577029769 PASS)로 병합한 뒤 [운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)과 시연 API에 배포](evidence/friends-deployment-2026-09-29.json)했다. 운영은 API `758f214`·웹 `cd527dd`에서 `87e98f4`로 바뀌었고 api·production-web·caddy 컨테이너가 다시 만들어져 healthy이며 `/opt/masscom/DEPLOYED_COMMIT`이 `87e98f4`다. migration 0028은 추가만 하는 변경이라 `backward_compatible=yes`이고 운영 DB에 친구 테이블 5개(`explorer_profiles`·`friend_blocks`·`friend_code_attempts`·`friend_codes`·`friendships`)가 생겼다. 운영 배포 스크립트가 migration 전에 자체 pg_dump 백업 `/opt/masscom/backups/database-before-87e98f464218.dump.oIJ7Ui`(95287바이트, 2026-09-29 13:42Z)를 만들었고 실제 복원은 `NOT_RUN`이다. 시연 API는 수동 compose 절차로 배포 전 백업(196항목·97297바이트·mode 600)을 만든 뒤 이미지 `masscom-showcase-api:87e98f4`를 만들고 migration·container 교체·host seed(`SHOWCASE_HOST_SEEDED`)를 했고 같은 친구 테이블 5개가 있다. 운영·시연 API health는 200, 로그인 없는 `/me/friends`는 401이며 `masscom.kr`·`www`의 `/privacy` 본문 해시 앞 16자(`961c0f06270b8d8c`)가 저장소 `docs/privacy.html`과 같고 `/account-deletion`에 친구 문구가 있다. [시연 Preview 9](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.9)(`MassCOM-showcase-android-87e98f4.apk` 156537981바이트, SHA-256 `efebe0fff8aa9cf5ca896e550caed8a15b05763b19df3e1123fc9749708878f5`)를 공개 사전 릴리스로 게시했고 [GitHub digest 일치·익명 다운로드 200·Samsung SM-S928N의 기존 앱 위 `adb install -r` Success·역할 선택 첫 화면·다섯 칸 탭 바와 친구 탭 불러오기](evidence/showcase-preview9-release-2026-09-29.json)를 확인했다(친구 탭에 소유자 본인의 친구 코드가 보여 캡처는 저장하지 않았다). 운영 test.3 앱에는 친구 탭이 없어 운영 서버의 친구 기능을 쓰는 설치본은 아직 없다. **`NOT_RUN`:** 두 시연 계정의 친구 추가·순위·여권, 시연 앱 링크 열기(`demo.masscom.kr`에 DNS·Caddy·assetlinks가 없어 시연 앱은 코드 문구와 `https://masscom.kr/open` 안내를 공유하고 QR은 `masscom-demo://open#friend=`를 씀, [B-024](BLOCKERS.md)), 시스템 공유창, 지도 화면·TalkBack·다크·글자 200%, 로그인 뒤 메달→상자→쿠폰→점원 사용 처리, 새 2분 고객 QR의 두 기기 수령, 시연 DB 백업의 실제 복원이며 소유자의 친구 화면 판정은 사용자 판정 필요다. 이 브랜치는 문서·증거 JSON·포털 검사 기대값만 바꾸고 앱·API·DB·서버는 바꾸지 않았다. (작성 당시) 공개 /open은 Preview 8 링크였고(#232 뒤 웹 전용 재배포, apex·www 확인) Preview 9 링크는 PR #235 병합 뒤 웹 전용 재배포로 반영했다. 다음: 웹 전용 재배포, 두 시연 계정 실기, `demo.masscom.kr` 인프라, 그다음 D-048(소유자가 서버 비밀 파일에 API 키를 직접 넣어야 착수). 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다.

- **친구(코드·QR로 추가, 여권 보기; [Issue #230](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/230), D-047, [PR #233](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/233) 병합 `87e98f4`, CI PASS):** 소유자가 "친구추가 기능이랑 친구 공유 기능"을 요청하고 친구 코드·QR과 공개 범위(메달 등급·배지 수·가본 가게 이름만, 방문 날짜·시각 비공개)를 골랐다. 브랜치 `feat/230-friends`(main `cd527dd` 병합)에서 서버(migration 0028의 별명·친구 코드·친구 관계·끊은 기록·코드 입력 실패 기록, `GET·POST /me/friends`·`DELETE /me/friends/:id`·`POST /me/friend-code/rotate`·`PUT /me/profile`, 하루 지연·계정 기준 재추가 차단·허용 필드 직렬화)와 앱(탭 바 `탐색 · 지도 · 방문 인증 · 도감 · 친구` 다섯 칸, 친구 탭, 친구 여권, `친구에게 추천`, `#friend=`·`#merchant=` 링크 열기)을 구현했고 `docs/privacy.html`·계정 삭제 안내에 친구 항목을 더했다. 두 독립 리뷰(sonnet 코드·opus 보안, 🔴 0 APPROVE)의 지적을 반영했다: 끊기 문구와 끊은 직후 코드 바꾸기 권유(차단은 계정 기준이라 다른 계정으로는 우회), 시연 앱은 없는 `demo.masscom.kr` https 링크 대신 `masscom-demo://` QR과 앱 받기 안내만 사용, 빌드마다 자기 링크만 받음(운영·개발은 같은 https 링크를 써 서로 격리되지 않고 시연 앱만 격리됨), 가게 id 경로 탈출 거절, 잘못된 친구 링크 안내, 로그아웃 때 기다리던 코드 삭제 등(결정은 [설계 §8](superpowers/specs/2026-09-29-friends-design.md)). 모바일 598/598·typecheck·lint·API 단위 149/149 PASS(운영/시연 두 export·variant 자산 검사는 이전 커밋에서 PASS), PostgreSQL 통합 117 PASS·0 FAIL·2 SKIPPED(일회용 로컬 DB, 주 스레드 보고), 실제 휴대전화(SM-S928N, 개발 빌드 + 로컬 API)에서 친구 추가·순위·여권·끊기 확인 창·링크 열기와 재리뷰 지적 반영 뒤 재확인 PASS([시험 상태](TEST_STATUS.md)). **`NOT_RUN`:** PostgreSQL 통합의 호스팅 시드 시험 2개, 시스템 공유창, 실제 App Link 검증, 시연 링크 열기, 이 배치의 재리뷰, 내 코드 링크 수정의 폰 재확인. **이 문단은 병합 전 상태이며 배포 결과는 바로 위 항목이다. 시연 앱 https 링크를 위한 `demo.masscom.kr` 인프라(DNS·Caddy·시연 인증서 assetlinks)는 아직 하지 않았다.** 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다.

- **시연 Preview 8 공개([Issue #231](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/231)):** main `fea9f29`(PR #227 하늘 동네 개편·PR #229 동네 지도, main CI PASS)로 만든 [시연 Preview 8 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.8)를 공개 사전 릴리스로 게시했고 [서명·GitHub digest·체크섬·익명 다운로드 확인](evidence/showcase-preview8-release-2026-09-29.json)을 남겼다(APK 156468121바이트, 시연 API `demo-api.masscom.kr`·시연 전용 서명). 이 브랜치는 README·설치 안내 문서·`docs/open.html`·포털 검사 기대값을 Preview 8로 바꿀 뿐 앱·API·DB·서버 코드는 바꾸지 않는다. **휴대전화가 연결돼 있지 않아 Preview 8 APK의 설치·지도 화면·TalkBack·다크·글자 200%·로그인 뒤 메달→상자→쿠폰 실기는 NOT_RUN**이며 소유자의 디자인·지도 판정이 필요하다. 같은 디자인의 이전 빌드 c75143a는 Samsung에서 새 역할 선택과 점포 그림 탐색 화면을 보였고(작업 보고, 캡처 없음) 지도는 개발 앱으로만 실폰 확인했다. 공개 /open은 #232 병합 뒤 웹 전용 재배포로 Preview 8 링크를 보인다(apex·www 확인). 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다.

- **동네 지도·길찾기([PR #229](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/229) 병합 `fea9f29`, CI PASS):** 소유자가 "찾아가는 지도 기능"을 요청하고 앱 안 일러스트 지도 + 네이버·카카오맵 길찾기를 골랐다(D-046). [Issue #228](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/228) 브랜치 `feat/228-town-map`(main `c75143a` 기준)에서 Android 앱에 `지도` 탭(탭 바 `탐색 · 지도 · 방문 인증 · 도감` 네 칸)·동네 그림 위 가게 핀(도장 받음은 이중 테두리와 체크, 아직 없음은 점선)·핀 카드(`자세히 보기`·`길찾기`)·탐색의 "지도로 보기" 칩을 넣었다. `길찾기`는 네이버 지도·카카오맵 앱(없으면 웹)을 도로명 주소 검색으로 열고 가상 점포는 실제 주소가 없어 이유 문구만 보인다. 지도 API 키·과금 자원·위치 권한·새 의존성·API/DB 변경은 없다([설계](superpowers/specs/2026-09-29-town-map-design.md)). 모바일 477/477 PASS(이 문서를 쓰며 재실행)이고 타입·린트·운영/시연 두 export는 구현 작업의 보고대로 PASS다. [실제 휴대전화(SM-S928N) 로컬 확인](evidence/town-map-2026-09-29/README.md)에서 지도·핀 구분·핀 카드·길찾기 선택 창·네이버 지도와 카카오맵 앱 열림·가상 점포 길찾기 차단이 PASS이고, 검수 중 찾은 도장판 이름·보상 상자 이름 잘림 두 결함은 같은 브랜치에서 고쳐 실폰에서 다시 확인했다. 길찾기 검수에는 **로컬 QA DB에만 넣은** 검수용 가게(공개 주소)를 썼고 시연·운영 DB에는 넣지 않았다. 외부 지도 앱 화면은 휴대전화 위치가 담겨 저장하지 않았다. NOT_RUN: 지도의 다크·글자 200%·TalkBack·앱이 없는 기기의 웹 대체 경로·시연 빌드(Preview 8)의 지도·소유자의 지도 판정이며 공개 시연 Preview 8 APK부터 포함(이 APK의 휴대전화 설치는 NOT_RUN), 운영 test.3 설치본·서버에는 반영하지 않았다. API·DB·권한·보상 규칙은 그대로이며 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다.

- **하늘 동네·여권 도장 개편([PR #227](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/227) 병합 `c75143a`, CI PASS):** 소유자가 "흰 바탕이라 밋밋하다"고 피드백하고 디자인 방향 A 하늘 동네 + B 여권 도장과 Codex 마스코트 세트를 골랐다(D-045). [Issue #224](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/224) 브랜치 `feat/224-sky-town-redesign`에서 Android 앱에 하늘 그림 머리글(내용과 함께 스크롤)·떠 있는 카드·가운데 도장 버튼의 세 칸 탭 바(내 정보는 머리글 아바타)·도감의 여권 도장 페이지·마스코트 포즈 세트·눌림/진입/숨쉬기 연출(동작 줄이기는 실행 중에도 따름)을 넣었다. `DESIGN.md`를 이 체계로 개정하고 지도(D-046)·친구(D-047)·사장님 AI 시안(D-048) 방향을 결정 기록에만 남겼다(구현 없음). 모바일 388/388·타입·린트·운영/시연 두 export PASS, [에뮬레이터 로컬 확인](evidence/sky-town-redesign-2026-09-29/README.md)에서 라이트·다크·글자 200% 렌더 PASS와 결함 5건 수정. 실제 휴대전화·TalkBack·소유자의 "꾸민 느낌" 판정·점포 그림이 있는 시연 빌드 화면은 NOT_RUN이고 공개 시연 Preview 8 APK부터 포함(이 APK의 휴대전화 설치는 NOT_RUN), 운영 test.3 설치본·서버에는 반영하지 않았다. API·DB·권한·보상 규칙은 그대로이며 필수 36개 상태는 31 PASS / 2 BLOCKED / 3 NOT_RUN 그대로다.

- **탐험 여권 운영·시연 배포와 Preview 7:** [Issue #222](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/222)에서 main `758f214`를 기존 Lightsail의 운영 API·웹(migration 27, 혜택·쿠폰·점주 0건)과 시연 API(migration 27, 가상 체험 혜택 3건)에 [배포](evidence/explorer-passport-deployment-2026-09-29.json)했다. `/presentation` 404·익명 `/api/web/badges` 401 no-store·두 API health 200을 외부 HTTPS로 확인했다. [시연 Preview 7 APK](evidence/showcase-preview7-release-2026-09-29.json)는 서명·GitHub digest 확인 뒤 공개 사전 릴리스로 게시했고 Samsung의 기존 앱 위 설치·첫 실행은 PASS, 로그인 뒤 메달→상자→쿠폰→점원 사용 처리·TalkBack은 NOT_RUN이다. 운영 실제 혜택은 점주 합의 전까지 0건을 유지하고, 공개 /open의 Preview 7 링크는 병합 뒤 웹 전용 재배포로 반영한다.

- **발표 페이지 제거:** [Issue #220](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/220)에서 소유자 결정에 따라 공개 발표 페이지(`/presentation`)·발표 원고·발표 검사기를 제거했다. 팀은 발표 자료를 저장소 밖에서 준비하며, 발표 리허설·최종 영상은 계속 `NOT_RUN`이다. 발표와 무관한 필수 시험 합계·현장 성과 부풀림 금지 검사는 증거 정합 검사기로 옮겼고 과거 증거 파일은 기록으로 유지한다. 운영 Caddy의 `/presentation`은 다음 웹 배포 때 404가 된다. [결정 D-044](DECISIONS.md)

- **웹 디자인 체계 통일:** [PR #217](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/217) merge bd8fc1a로 탐험 여권을 main에 넣은 뒤 [Issue #218](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/218)에서 모든 웹 화면을 앱 토큰·마스코트 머리글·카드·다크 모드로 맞추고, 운영 웹 도감을 앱과 같은 메달·상자·쿠폰 표현으로, 시연 웹에 탐험 여권 미리보기를 더했다. 디자인 토큰 5/5·운영 웹 74/74·시연 웹 30/30·시연 테마 1/1·웹 빌드/경로 4/4·세션 프록시 2/2 PASS, [전후 화면](evidence/web-design-system-2026-09-29/README.md). 공개 서버 반영은 NOT_RUN이다.
- **탐험 여권(메달·보상 상자·쿠폰):** UI/UX 피드백(수집 게임성·감성·공유·배지→쿠폰)으로 [Issue #216](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/216)에서 #212의 텍스트 배지를 서버 계산 메달 3종×3등급, 배지 3·6·9개 보상 상자, 점주 동의 혜택이 있을 때만 발급되는 쿠폰과 점원 사용 처리(migration 0027), 방문 축하·이미지 공유로 바꿨다(D-043). 모바일 276/276·API 단위 133/133·PostgreSQL 89 PASS/2 SKIP·운영 웹 66/66, 두 모델 교차 리뷰(opus 보안·sonnet 코드) 🔴 0, [에뮬레이터·Samsung 휴대전화 로컬 실측](evidence/explorer-passport-emulator-2026-09-29/README.md) PASS. 운영 혜택은 0건이며 서버 배포·새 APK·TalkBack 낭독은 NOT_RUN이다.
- **Preview 6 설치 안내 외부 반영:** [PR #214](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/214) merge 2dda864·main CI PASS 뒤 [apex/www /open](evidence/public-open-preview6-deployment-2026-09-29.json)은 HTTPS 200·저장소 소스 SHA-256 일치·최신 시연 Preview 6 링크를 확인했다. 웹 전용 배포이며 API/DB·운영 앱은 바꾸지 않았다.

- **동네 탐험 배지·공유 배포 경계:** [Issue #212](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/212)의 [PR #213](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/213) merge 5caec3a, PR/main CI PASS. 모바일 244/244·웹 48/48·타입·린트·Android 개발 export PASS. [운영 배지 웹](evidence/neighborhood-badges-web-deployment-2026-09-29.json)은 기존 서버에서 로그인한 0방문 계정의 잠긴 배지 3개, 익명 401/no-store를 확인했다. [시연 Preview 6 APK](evidence/showcase-preview6-release-2026-09-29.json)는 서명·GitHub digest 확인 후 공개했다. 실제 휴대전화 화면·공유·쿠폰 발급은 NOT_RUN이다.
- **Preview 5 설치 안내 웹 배포:** 첫 두 SSH exit 255 때 이전 웹을 보존했고, 호스트 한정 keepalive와 기존 롤백·경로 검사로 main 19c5ae4의 /open을 [기존 Lightsail에 반영](evidence/public-open-preview5-deployment-2026-09-29.json)했다. apex/www HTTPS 200·소스 SHA-256 일치, API/DB 불변을 확인했다. 신규 배지 웹 소스는 아직 배포하지 않았다.

- **2026-09-29 조직 저장소 복귀:** 조직 저장소는 `PUBLIC`·활성이고 [PR #207~#210](PUBLIC_SYNC.md)을 PR/main CI 통과 뒤 병합했다. [시연 Preview 5 APK](evidence/showcase-preview5-public-release-2026-09-29.json)를 조직 공개 Release에 같은 SHA-256으로 게시했다. 이전 개인 PR 문서·배포 기록은 당시 사실로 보존한다. [PR #211](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/211)·main CI는 PASS, 공개 /open 서버 반영은 [실측 완료](evidence/public-open-preview5-deployment-2026-09-29.json)됐다.

- **2026-09-29 시연 Preview 5:** [개인 비공개 Release](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.5)의 APK는 `88932cb` 소스·시연 전용 서명·원격 SHA-256이 [일치](evidence/showcase-preview5-release-2026-09-29.json)한다. 내부 versionName/code는 `0.1.0-test.2`/`2`; 휴대전화 설치와 새 고객 QR 실기는 `NOT_RUN`. 운영 test.3과 데이터·키·패키지는 별도다.

- **2026-09-29 비공개 캠페인 초안 배포:** [PR #15](https://github.com/choijunhuk/MassCOM/pull/15) merge `fd0a9b2` PR/main CI PASS 뒤 [기존 운영 API·웹](evidence/operating-campaign-draft-deployment-2026-09-29.json)에 DRAFT/비공개 저장·목록과 감사 migration 0026을 적용했다. 관리자 실계정의 빈 초안 화면, API/웹 건강·익명 거절을 확인했고 운영 점포·캠페인·mint는 0, 시연 3/3/2 불변이다. D-023 정책 미정이므로 공개·참여·방문 보상·NFT는 자동 활성화하지 않는다. 실제 점포 초안 입력은 `NOT_RUN`.

- **2026-09-28 운영 재발급 배포:** 개인 [PR #13](https://github.com/choijunhuk/MassCOM/pull/13) merge `c02da0f`의 PR/main CI PASS 뒤 [기존 운영 API·웹](evidence/operating-merchant-reissue-deployment-2026-09-28.json)에 첫 발급 응답 손실 복구와 명시적 이전 코드 폐기·새 QR 발급을 배포했다. 새 migration 없이 관리자 1명/운영 점포·직원·슬롯·mint 0, 시연 3/3/2를 유지했다. 외부 HTTPS·인증 경계는 PASS, 실제 점주 재발급·두 휴대전화 수령과 재발급 응답 유실 후 상태 조정은 `NOT_RUN/후속`이다.

- **2026-09-29 운영 현황 배포:** 개인 [PR #14](https://github.com/choijunhuk/MassCOM/pull/14) merge `88932cb`의 PR/main CI PASS 뒤 [운영 API·웹](evidence/operating-admin-status-deployment-2026-09-29.json)에 점포별 읽기 전용 QR·방문·보상·NFT 작업 집계를 배포했다. 관리자 주 Google 계정의 빈 점포 현황 화면은 실제 브라우저 PASS, 운영 점포·직원·슬롯·mint 0과 시연 3/3/2를 유지했다. 별도 `_test` PostgreSQL 관리자 11/11·웹 45/45, 리뷰 MEDIUM 2건 수리는 PASS이나 대량 이력 부하는 미측정이다.

- **2026-09-29 비공개 캠페인 초안 소스:** `feat/admin-campaign-drafts`는 실제 점포의 기간·정원·목표 1·3·5를 DRAFT/비공개로만 저장·조회하고 관리자 감사와 한 거래로 묶는다. 로컬 API 122/122·웹 47/47·별도 `_test` PostgreSQL 관리자 12/12·타입/build/gate PASS, 시험 DB 삭제. D-023의 방문 수령 정책은 미확정이라 공개·참여·보상·NFT는 자동 활성화하지 않는다. PR·운영 배포·실계정 입력은 `NOT_RUN`이다.

- **2026-09-28 운영 점주 QR 발급 배포:** 개인 [PR #12](https://github.com/choijunhuk/MassCOM/pull/12) merge `c1ea375`의 PR/main CI PASS 뒤 [운영 API·웹](evidence/operating-merchant-qr-deployment-2026-09-28.json)에 점주 웹의 고객 QR 확인·실제 이용 확정·일회성 방문 수령 QR을 배포했다. DB migration은 없고 mode 600 백업을 임시 DB에 복원해 핵심 수량을 확인한 뒤 임시 DB를 삭제했다. 관리자 1명, 운영 점포·직원·슬롯·mint 0, 시연 3/3/2 불변. 외부 HTTPS·미로그인/Origin 차단은 PASS이나 실제 점주 브라우저·두 휴대전화 촬영/수령은 `NOT_RUN`. 재발급 복구는 별도 소스 브랜치로 운영 배포 전이다.

- **2026-09-28 운영 점포 상세 배포:** 개인 [PR #11](https://github.com/choijunhuk/MassCOM/pull/11) merge `8a8ba78`의 PR/main CI PASS 뒤 [기존 운영 API·웹](evidence/operating-merchant-menu-deployment-2026-09-28.json)에 메뉴·가격·점포 제공 영업시간과 migration 0025를 배포했다. 운영 점포·직원·슬롯·mint는 0, 관리자 1명·시연 3/3/2를 보존했다. 외부 HTTPS와 미로그인 차단은 확인했지만 실제 점포 등록·메뉴 표시·Android 기기 실기는 `NOT_RUN`. 새 모바일은 구형 API의 새 필드 부재를 허용하며 잘못된 명시값은 거절한다. 이후 QR 발급 소스는 위 PR #12로 별도 병합·배포했다.

- **2026-09-28 운영 직원 등록 배포:** 개인 [PR #10](https://github.com/choijunhuk/MassCOM/pull/10) merge `83357d6`의 PR/main CI PASS 뒤 [운영 API·웹](evidence/operating-staff-deployment-2026-09-28.json)에 15분 계정·점포 귀속 코드, 관리자 명시 승인·회수와 `/merchant/`를 배포했다. 운영 DB migration 0024, 관리자 1명·직원/점포/발행 0, 시연 3/3/2 보존. 외부 apex/www `/merchant/` 200·미로그인 401·Origin 없는 등록 403이며 실제 직원 승인·점포 QR 발급 화면·방문 수령은 `NOT_RUN`이다. 통합 로컬 API 116/116·PostgreSQL 73 PASS/2 SKIP·웹 28/28·Caddy 2/2는 이 외부 수락을 대신하지 않는다.

- **2026-09-28 삭제 요청 접수·보안 운영 배포:** 개인 [PR #8](https://github.com/choijunhuk/MassCOM/pull/8) merge `183d5ed`·[PR #9](https://github.com/choijunhuk/MassCOM/pull/9) merge `4d59347`은 PR/main CI PASS 뒤 [운영 배포](evidence/operating-deletion-intake-deployment-2026-09-28.json)를 완료했다. DB 백업·migration 0018/0023, apex/www 안내 200·미로그인 접수 401·Origin 없는 요청 403을 확인했고 접수 행은 0이다. 서명된 Google `auth_time` 5분과 mint 비종결 판정은 코드·PostgreSQL에서 수리됐지만 실계정 인증/접수·실제 삭제·삭제 후 결과 통지는 `NOT_RUN/BLOCKED`; 시연 DB 계정을 운영 접수로 처리하지 않는다.

- **2026-09-28 운영 관리자 첫 구간 배포:** 개인 [Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)의 [PR #5](https://github.com/choijunhuk/MassCOM/pull/5) merge `139e122`와 웹 이미지 누락 복구 [PR #7](https://github.com/choijunhuk/MassCOM/pull/7) merge `977a385`는 PR/main CI가 모두 PASS했다. [운영 배포](evidence/operating-admin-deployment-2026-09-28.json)에서 `/admin/`의 첫 `500`을 이미지 누락으로 진단·수정해 apex/www `200`, 미로그인 `401`, Origin 없는 쓰기 `403`과 주 Google 계정 관리자 1명·감사 1건을 확인했다. 실제 운영 점포 0곳, 가상 점포 0곳이며 권한 있는 브라우저의 실제 점포 업무는 `NOT_RUN`; 직원·캠페인·자산·상태 관리는 후속 범위다. 시연 STAFF 자격 자체를 운영 관리자 권한으로 재사용하지 않았다.

- **2026-09-28 개인 main·시연 Preview 4:** [PR #2](https://github.com/choijunhuk/MassCOM/pull/2) merge `6585614`, PR CI `36370159651`·main CI `36370675407` PASS. [시연 APK](https://github.com/choijunhuk/MassCOM/releases/tag/showcase-android-v0.1.0-preview.4)의 source/package/서명/원격 digest와 같은 커밋의 [시연 API 이미지·migration 0019·외부 HTTPS](evidence/showcase-customer-qr-deployment-2026-09-28.json)를 확인했다. 기존 시연 데이터 3점포/3방문/2보상권, 운영 가상 점포 0건을 보존했다. 새 APK의 실제 휴대전화 설치·2분 고객 식별 QR 전체 흐름은 `NOT_RUN`; 구 Preview 3 STAFF 발급은 새 API에 맞지 않는다. 운영 관리자 [개인 Issue #3](https://github.com/choijunhuk/MassCOM/issues/3)는 구현 중이며 운영 권한 부여·웹 배포를 완료로 표시하지 않는다.

- **2026-09-28 개인 통합 작업 당시:** [Issue #1](https://github.com/choijunhuk/MassCOM/issues/1)의 [PR #2](https://github.com/choijunhuk/MassCOM/pull/2)에 2분 고객 식별 QR·현재 캠페인 도감 목표·기존 시연 카메라 증거를 합쳤다. 결합 소스의 API 109/109·모바일 239/239·PostgreSQL 52 PASS/2 SKIP, 타입·린트·build/export·문서 검사 PASS. 첫 PR CI의 낡은 README 문구 시험을 RED→GREEN으로 고친 뒤 재검사·병합했다. 당시 새 APK/API·실기는 미완료였고 최신 판정은 위 기록을 따른다. Google Play 목표는 D-040으로 유지하지만 제출은 별도다.

- **2026-09-28 시연 APK 카메라 수령:** [Preview 3 동일 SHA 설치본 실측](evidence/showcase-preview3-camera-claim-2026-09-28.json)에서 가상 점포 A의 점주 발급 QR을 Mac에 띄우고 Samsung 카메라로 스캔→미리보기→별도 수령 확정→도감 이동을 완료했다. 시연 DB에서 같은 계정 슬롯 1(`CLAIMED`)·방문 1·보상권 1·mint 0을 확인했다. 처음의 다른 계정용 QR 거절은 미사용·미만료 상태에서 계정 불일치였다. 이는 **같은 계정의 역할 전환 시험**이며 서로 다른 두 계정·두 휴대전화, 오프라인·권한 거부, 새 2분 식별 QR 소스, 운영 앱의 QR 검증은 별도 미완료다.

- **2026-09-28 개인 비공개 이관:** 조직 저장소는 `PUBLIC`·`Archived`이며 사용자는 보관 해제 대신 [개인 비공개 저장소](https://github.com/choijunhuk/MassCOM)를 선택했다. [PR #204](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/204) merge `9706e61`의 PR/main CI와 같은 이력을 옮긴 개인 main [CI `36354490206`](https://github.com/choijunhuk/MassCOM/actions/runs/36354490206)이 PASS다. 이후 조직 [PR #207](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/207)의 CI는 `repository archived`로 CANCELLED되어 OPEN·미병합이다. QR `90fa019`·도감 `dd769ae`·삭제 접수 `d051ef3`·인수인계 `6932649`를 개인 브랜치에 push했지만 **개인 main에 미병합**이며 공개 API/APK에는 반영되지 않았다. 정확한 브랜치·시험·배포 경계는 [HANDOFF](HANDOFF.md) 맨 위를 따른다.

- **2026-09-28 운영 웹·두 앱 사전 릴리스:** [이전 웹 전용 배포](evidence/web-only-deployment-2026-09-28.json)는 `174aa13`에서 삭제 안내와 www 경로를 갱신했고, [최신 `/open` 배포](evidence/public-open-page-2026-09-28.json)는 `088cebe`에서 apex/www 두 앱 공개 다운로드 링크·HTTPS 200·소스 해시 일치와 API/DB 불변을 확인했다. [운영 test.3](evidence/operating-android-test3-2026-09-28.json)는 source `c5cba68`의 서명·GitHub 공개 다운로드·Samsung 새 Google 로그인/복원·16KB AVD 설치/콜드 실행 PASS; 운영 실제 점포는 0곳이고 App Link 자동 열기는 폰 설정상 BLOCKED다. [시연 Preview 3](evidence/showcase-preview3-phone-2026-09-28.json)은 Samsung 설치·가상 3점포·Google 취소 후 재진입 PASS지만 초대 밖 계정의 실제 새 로그인·QR 촬영 수령은 NOT_RUN. Play 제출·실제 계정 삭제([#194](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/194))는 완료가 아니다.

- **이전 2026-09-27 출시 안정화([Issue #193](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/193), [PR #195](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/195) 병합):** `main` merge `128ce5f`, PR/main CI PASS. 공통 인증 시간초과·삭제 요청 진입, 운영 Android bundle의 시연 그림 제외, PostgreSQL 16.10/양쪽 variant CI와 운영 전체 배포 rollback mock을 반영했다. 모바일 220/220·운영 그림 0/시연 3·API PG16 51 PASS/2 SKIP·Worker 23/23·시연 호스트 2/2 PASS. [Preview 3](evidence/showcase-preview3-release-2026-09-27.json) 시연 APK는 전용 서명·원격 digest·익명 HTTPS 200까지 확인했지만 **당시 물리 기기 설치·초대 밖 Google 로그인은 `NOT_RUN`**. 당시 운영 최신 AAB/APK·전체 운영 재배포도 `NOT_RUN`; 이메일 요청의 계정 소유 확인·실제 삭제는 [Issue #194](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/194)로 `BLOCKED`다. 모바일 중간 advisory 15건([B-008](BLOCKERS.md))도 남았다.

- **이전 시연 고객 로그인 개방(Issue #191, PR #192 병합·시연 API 배포):** D-038/D-039에 따라 Google 고객 세션과 STAFF 권한을 분리했다. PR #192 merge `7455791`의 PR/main CI PASS 후 기존 Lightsail의 **시연 API 컨테이너만** `masscom-showcase-api:7455791`로 바꿨다([배포 증거](evidence/showcase-open-login-api-deployment-2026-09-27.json)). 외부 HTTPS·가상 3점포·방문 2·보상권 1과 운영 가상 0건, 운영 컨테이너 불변을 확인했다. **당시 Preview 2 APK는 이전 코드**이고 초대 밖 실계정 Android 로그인·새 서명 APK는 `NOT_RUN`([B-019](BLOCKERS.md)). 이후 Preview 3 설치 결과는 위 최신 항목을 따른다. 공통 Android 로그인 복구·운영 고객 경로는 유지하되 운영 앱에 가상 DB 자료를 넣지 않는다.
- **UI 2차 개편(Issue #184):** [PR #186](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/186)을 병합해 승인된 마스코트(D-036)의 탐색 배너, 도감 스탬프판, 가게 카드 표식을 추가했다. [Samsung 실기](evidence/ui-mascot-2026-09-27/device-check.json)에서 라이트 모드 화면을 확인했다. 스탬프는 앱 방문 기록일 뿐 NFT가 아니며 다크·200% 글자·TalkBack·360dp는 `NOT_RUN`이다.
- **UI 1차 정리(Issue #183):** [PR #185](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/185)를 병합해 제목 크기와 개발자 말투 문구를 정리했다. 시연 서버 점포 설명의 반복 경고 문구는 재seed(배포)가 필요하며, 이번 수집품 그림 작업에서 서버 데이터를 변경하지 않는다.
- **가상 점포 수집품 그림(Issue #189):** A·B·C 별도 그림 3종을 서버가 반환한 본인 가상 보상권 카드에만 연결했다([그림·경계](SHOWCASE_COLLECTIBLE_ART.md)). 모바일 206/206·타입·린트·Android JS 번들, 새 시연 전용 서명 APK의 Samsung 설치와 라이트/다크/200% 글자 화면을 `PASS`로 [실측](evidence/showcase-collectible-art-2026-09-27/device-check.json)했다. [private Preview 2](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.2)의 재다운로드 SHA-256·바이트 일치도 PASS. TalkBack·외부 지갑 NFT 이미지 URI는 `NOT_RUN`이다. 운영 점포·NFT 발행/계약은 변경하지 않았다.
- **문서·AI 규칙 정합(Issue #181):** 기획·완성도·README·AI 규칙 전체 점검 결과 중 문서·설정으로 고칠 수 있는 항목(09-24~27 AI 사용 기록 공백, Lore trailer 정의, AI 공동 작성자 금지, `CLAUDE.md`, `tools/gate.sh`, `.gitignore`, PR 템플릿, 닫힌 PR #180 출처 문구)을 반영했다. 제품 코드·시험 기대값은 바꾸지 않았다. 무로그인 탐색(B-017)·현장 파일럿·저장소 공개·발표 리허설은 사용자 결정으로 남는다.
- **두 계정 폰 실기 판정:** [시연 APK·폰·DB 근거](evidence/showcase-two-account-phone-2026-09-27.json)에서 STAFF 발급→다른 초대 Google 계정의 직접 코드 미리보기·수령→도감 방문 2/앱 수집품1/NFT0→같은 코드 재입력 추가 효과 0을 확인했다. 운영 DB 가상 점포 0, 시연 DB 방문 2·보상권 1·mint 0이다. 실제 카메라 QR 촬영 수령·시연 앱 별도 지갑·App Link·NFT는 `NOT_RUN`, Issue #137은 OPEN이다. README는 콘셉트 일러스트와 실제 폰 화면을 구분하고 최신 검증을 우선 표기한다.

### 아래 한 항목은 시연 APK 첫 릴리스 시점의 기록

- **현재 시연 앱 판정:** [PR #177](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/177) merge `74d9eb1`·PR/main CI PASS와 [Samsung 실기](evidence/showcase-android-apk-2026-09-27.json) 뒤 별도 서명 APK를 [private Preview 1 Release](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.1)에 게시했다. GitHub 재다운로드 SHA-256/바이트 대조, 운영 앱 동시 설치, 전용 Google 로그인, 가상 점포 3곳·도감·QR 카메라·점주 STAFF 발급 PASS. 실제 고객 폰의 QR 촬영→수령·계정별 도감 격리와 시연 App Link/지갑/NFT는 `NOT_RUN`, Issue #137은 OPEN. 가상 발급을 실제 방문·매출·NFT로 기록하지 않는다.

### 아래 한 항목은 APK 전 단계의 당시 기록

- **최신 판정:** [PR #175](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/175) merge `036f31f`·PR/main CI PASS 뒤 기존 Lightsail의 별도 시연 API/DB와 운영 Caddy만 내부 edge에 연결했다. [공개 HTTPS 실측](evidence/showcase-public-edge-2026-09-27.json)에서 `demo-api.masscom.kr` TLS·health 200·가상 점포 3곳·익명 도감 401, 운영 API/웹 200·운영 점포 0곳, 운영 API/DB/웹 컨테이너 보존을 확인했다. Samsung ADB·전용 키·Google client는 준비됐지만 Keychain 비밀번호 접근의 OS 승인 대기로 서명 APK·기기 설치·카메라 QR·GitHub Release는 `BLOCKED/NOT_RUN`. Issue #137은 계속 OPEN이다.

### 이하 항목은 공개 전 단계의 당시 기록

- `demo-api.masscom.kr` A가 권한·외부 DNS에서 기존 Lightsail IP로 확인됐고, 운영 Google Web client의 실제 ID 토큰은 시연 API에서 `401 ID_TOKEN_AUDIENCE_MISMATCH`로 거절돼 identity/session 쓰기 0이었다. 시험용 `localhost:4176` 운영 OAuth 원본은 제거·재조회했다([DNS·교차 인증 증거](evidence/showcase-dns-audience-2026-09-27.json)). **DNS A 등록만 완료**이며 운영 Caddy·공인 TLS·시연 APK는 미적용/`NOT_RUN`. 공개 라우팅은 별도 사용자 확인과 PR #175 병합·Caddy-only 롤백 시험 전까지 보류한다.

- Issue #137 내부 실계정·가상 흐름은 전용 Web OAuth 두 계정의 API 로그인 200/200, 비초대 유효 토큰 403·추가 DB 쓰기 0, 가상 A점포 STAFF 권한 1계정만 허용을 [실측](evidence/showcase-internal-auth-claim-2026-09-27.json)했다. 가상 코드 발급→미리보기→수령→재수령은 201/200/200/200(`replayed=true`), 시연 DB claim slot/방문/보상권 1/1/1·mint 0, 고객 도감 1/1·STAFF 0/0이며 시험 세션은 모두 철회했다. 이는 내부 SSH 터널을 통한 API 시험이지 실제 Android QR·외부 HTTPS·NFT 발행이 아니다. 운영 audience 유효 토큰의 실제 교차 거절과 기록 있는 두 고객 계정 격리는 아직 `NOT_RUN`. 현재 [PR #175](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/175)의 전용 edge/Caddy는 독립 리뷰 지적을 수정하고 CI PASS했지만 아직 병합·운영 Caddy 적용 전이다.

- Issue #137: [PR #174](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/174) merge `7dba450`·PR/main CI PASS 이후 기존 Lightsail의 별도 `/opt/masscom-showcase`에서 시연 API·DB를 loopback 전용으로 기동했다. 가상 점포·캠페인·목표 `3/3/9`, 시연 방문/계정/세션 0, 운영 DB 가상 점포 0, 운영 컨테이너 ID·재시작 횟수 불변과 운영 HTTPS 200을 [내부 증거](evidence/showcase-internal-2026-09-27.json)로 확인했다. 현재 `feat/137-showcase-edge`는 공개 라우팅용 전용 네트워크·Caddy 변경을 로컬에서 시험 중이며 실제 서버 Caddy/DNS는 미변경이다. 전용 키·Google Web/Android client·OAuth 테스트 사용자 2명·Samsung ADB와 APK `--check`는 준비됐지만 실제 초대 로그인·외부 HTTPS·서명 APK/Release/실기는 `BLOCKED/NOT_RUN`([B-018](BLOCKERS.md), [시험](TEST_STATUS.md)).

- D-034 `www.masscom.kr/app/`·`/preview/` [설계](superpowers/specs/2026-09-25-www-web-consolidation-design.md)·[계획](superpowers/plans/2026-09-25-www-web-consolidation.md)은 사용자 승인됐고 [PR #169](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/169) merge `3c59ac0` 및 PR/main CI PASS다. 정적 preview allowlist, host-bound OAuth state·웹 세션, 정확한 Host·Origin 검사는 [로컬 검증](evidence/www-web-local-2026-09-25.json) 후 기존 Lightsail에 배포됐다. 운영 DB 0016·0017 적용·기존 DB 컨테이너 보존·백업, Google `www` 승인 URI와 가비아 DNS A 전환, 공인 www TLS·정적 시연 원본 일치·Samsung Chrome의 www 한 계정 로그인/재열기/로그아웃 및 apex 세션 보존은 [전환 증거](evidence/www-web-cutover-2026-09-25.json)에 기록했다. www의 두 번째 계정·기록 있는 도감 격리·시연 Android APK는 별도 미완료다.

- 시연 웹은 [공개 www HTTPS](https://www.masscom.kr/preview/)에서 설치 없이 볼 수 있고, 기존 Vercel 배포는 복구 후보로 보존한다([전환 증거](evidence/www-web-cutover-2026-09-25.json)). [private GitHub 웹 전용 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)의 HTML/CSS ZIP·digest는 그대로이며 릴리스 설명의 기본 링크만 www로 갱신했다([태그 생성 당시 증거](evidence/showcase-web-release-2026-09-25.json)). 시연 Android APK·Release는 아직 없고 `demo-api.masscom.kr`·별도 인증·서명 설치 실기도 미완료다. 웹 예시 기록을 운영 데이터·NFT 발행 실적으로 표시하지 않는다.

- 이전 운영 웹 실증 기준: [PR #166](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/166) merge `c0ad8d6`, PR CI `36047283723`·당시 main CI `36048047690` PASS. 당시 운영 API 배포는 `d787471`이었고 최신 배포는 위 D-034 항목을 따른다. 실제 최신 HEAD·브랜치·CI·Issue는 `git`·`gh`로 확인한다. 운영 웹 로그인과 시연 API/앱 전체 완료를 혼동하지 않는다.

- 2026-09-25 Samsung Android Chrome에서 기존 Google 계정 A 로그인·빈 도감, A 로그아웃, B의 소유자 본인 확인 후 로그인·빈 도감, URL 재열기 뒤 B 세션 유지를 확인했다. 운영 서버에는 최근 세션 3건·서로 다른 계정 2개·철회 2건·활성 1건이 기록됐다([증거](evidence/android-web-auth-2026-09-25.json)). 실제 기록이 있는 계정 간 도감 교차 노출, 최신 APK, 일반 App Link 탭은 `NOT_RUN`; 이전 아래 항목의 휴대전화 로그인 `NOT_RUN`은 검증 전 시점의 상태다.

### 이전 단계 기록 — 당시 상태, 현재 판정 아님

- 2026-09-25 운영 웹 Google 로그인 최신: [PR #164](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/164) merge `d787471`·PR/main CI PASS 후 동일 커밋을 기존 Lightsail에 배포했다. 런타임 비밀값은 Git 밖 mode 600으로 반영하고 클립보드를 비웠다. Google 로그인 시작 302·정확한 callback·state/PKCE/Secure/HttpOnly 쿠키, 기존 계정 1개의 본인 빈 도감·새로고침 유지·로그아웃 후 미로그인 및 서버 세션 revoke, 익명 도감 401, 공개 점포 0건 200을 확인했다. 실계정 A/B 도감 격리·휴대전화 브라우저 로그인·최신 Android APK는 `NOT_RUN`; Issue #137 전체는 OPEN([세부](TEST_STATUS.md)).

- 2026-09-25 최신: [PR #163](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/163) merge `ec57eb4`와 main CI `36034481207` PASS 뒤 AWS 웹 staging, 가비아 apex DNS `43.200.56.97` 전환, Let's Encrypt TLS 및 공개 포털·`/app/`·`/merchants` HTTPS 200을 확인했다. Samsung SM-S928N에서 이전 `test.2` APK의 `/open` 명시적 VIEW intent와 Chrome의 `/app/` 로드를 확인했지만, Android 사용자 선택 상태 `Disabled`이므로 일반 링크 탭의 기본 열기는 미검증이다. 같은 커밋의 운영 API와 migration 0014·0015를 배포했고 DB 백업·API health를 확인했다. Google 콜백 URI는 등록됐으나 비밀값 미설정으로 로그인·개인 도감은 503 `BLOCKED`; 실제 Google 계정 A/B는 `NOT_RUN`이다([상세](TEST_STATUS.md)).

- 2026-09-25 과거 첫 AWS 웹 staging 명령은 tar 전송 뒤 실패했다. 없는 `/opt/masscom/web/current`의 `readlink -f` fallback 오류를 `fix/137-first-web-release`에서 수정했고 후속 PR #163·main CI와 위 실제 배포로 해소했다. 이 실패는 현재 원격 상태가 아니다.

- 2026-09-25 과거 CI 중단: PR #161 병합 후 main CI `36029974084`의 PostgreSQL 초기화 경합은 PR #162 merge `cde6a2d`·main CI `36031948040` PASS로 해소했다. [실패·수정 근거](TEST_STATUS.md)를 보존한다.

- 2026-09-25 `feat/137-web-collection-auth`: [PR #159](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/159)에서 웹 전용 Google OIDC state·PKCE·nonce, 해시 저장 세션, 계정 삭제 시 회수, 읽기 전용 도감 UI 및 Caddy 네 경로를 구현·시험했다. 당시 로컬/CI 결과와 현재의 외부 배포·실계정 미완료 상태는 별개이며 최신 판정은 위 항목과 [검증 세부](TEST_STATUS.md)를 따른다.

- 2026-09-24 `feat/137-aws-web`: PR #158로 병합된 공개 파일 allowlist·기존 Lightsail Caddy 포털과 `/app/`·웹 전용 배포/rollback 코드([당시 로컬 증거](evidence/aws-web-local-2026-09-24.json)). 이후 AWS apex DNS·TLS·기기 검증은 위 최신 항목을 따른다.
- 2026-09-24 시연 호스트 경계는 PR #157 merge `96341e8`·main CI `36005667769` PASS다. 별도 로컬 Docker에서 API/DB healthy, A/B/C 3곳·목표 9개, 반복 seed, 익명 도감 401을 확인했다([증거](evidence/showcase-host-local-2026-09-24.json)). 운영 Lightsail 비용·용량과 전용 OAuth·DNS·외부 HTTPS는 미확인이라 실제 서버 배포는 BLOCKED다.
- 2026-09-24 D-032의 #136 시연 앱 전용 첫 역할 선택은 PR #156 merge `5e91728`·main CI `35998825263` PASS다. 개발·운영 첫 화면은 유지하며 시연 설치본·외부 API 실기는 `NOT_RUN`이다.
- 2026-09-24 이슈 #136·#137의 `CLOSED / NOT_PLANNED` 처리는 미완료 작업을 계획 없이 닫은 오류여서 되돌렸고 둘 다 `OPEN`이다. [#136 시연 앱 진입](superpowers/plans/2026-09-24-issue136-showcase-entry.md), [#137 외부 시연 전달](superpowers/plans/2026-09-24-issue137-showcase-delivery.md), [#137 운영 웹 본인 도감](superpowers/plans/2026-09-24-issue137-production-collection.md)을 계획했다. 현재 구현·외부 검증 상태는 아래 항목과 각 계획의 게이트를 따른다. 이 문서 수정은 미완료 기능을 PASS로 승격하지 않는다.

- Issue #137 공개 시연 API의 초대 제한 코드를 추가했다. `SHOWCASE_MODE=true`는 정확한 `masscom_showcase` DB·Google audience 한 개·초대된 `sub` 해시 목록이 없으면 시작을 거절한다. 유효한 Google 토큰이라도 초대되지 않으면 DB identity/session 저장 전 `INVITE_REQUIRED` 403, 초대 목록 변경 후 모든 인스턴스를 재시작하면 기존 세션 조회도 거절한다. API 단위 90/90·PostgreSQL 45/45·typecheck/build 로컬 PASS. 실제 외부 API·DNS·Google client·Android 시연 APK는 `NOT_RUN`이다.

- 무료 Vercel Hobby의 분리 프로젝트에 정적 시연 웹을 올렸다. `https://masscom-showcase-web.vercel.app` HTML·CSS HTTPS 200과 A·B·C 표기를 확인했다. `demo.masscom.kr` DNS는 아직 미연결이며 운영 `masscom.kr` 포털은 변경하지 않았다. 시연 Android는 전용 Google Web client ID를 빌드 설정에서 요구하고 실제 `.demo` package에서만 읽도록 코드·시험을 추가하는 중이다. 시연 OAuth client·외부 API·APK 설치는 `NOT_RUN`이다.

- Issue #137에서 사용자 요청에 따라 읽기 전용 시연 웹과 격리 로컬 seed를 가상 점포 A·B·C 총 3곳으로 확장했다. 웹의 A 방문·수집품은 고정 예시이며 B·C를 방문 완료로 꾸미지 않는다. 실제 PostgreSQL 반복 seed·A 기존 진행 보존·동시 생성·손상 거절과 로컬 API 공개 목록 3곳은 PASS. 외부 `demo.masscom.kr`·시연 APK는 여전히 `NOT_RUN`이다.

- Issue #137 후속으로 별도 `apps/production-web` 운영 웹을 추가했다. 공개 `GET /merchants`는 실제 0건을 빈 상태로 보이고 시연 행을 제거한다. 운영 웹 외부 배포는 위 최신 항목과 같이 확인됐지만 개인 도감 로그인은 아직 503이다. GitHub 운영 test.2 APK는 이전 코드이며 시연 APK·최신 운영 APK는 없다([다운로드 구분](ANDROID_DOWNLOADS.md)).

- Issue #137의 로컬 개발 DEMO에서 Samsung Android 16 실기 수동 코드 흐름을 새 USB 연결로 완료했다. STAFF 발급→고객 수령→도감 1/1/0→다음 보상 추천과 동일 코드 추가 효과 0을 확인했다([증거](evidence/android-local-claim-2026-09-24/README.md)). 실제 QR 카메라·외부 시연 API/앱·지갑/NFT와 운영 웹 개인 도감은 여전히 미완료다.

- Issue #146 `fix/146-account-link-style`에서 Samsung 개발 앱의 ‘내 정보’ Expo Router 오류를 RED→GREEN 수정했다. 모바일 182/182·typecheck·lint와 동일 폰의 내 정보·역할 시안 진입은 PASS. 로컬 가상 점포 코드 발급/미리보기만 PASS, USB 연결 해제로 방문 수령·보상은 BLOCKED([증거](evidence/android-dev-ui-2026-09-24/README.md)). PR·병합 상태는 `gh pr list`로 확인하며 운영 앱 배포로 표현하지 않는다.

- PR #138은 merge `d257d0b`, main CI `35879966085` PASS. 역할 선택은 개발용 미리보기이며 운영 네 탭은 유지된다. Issue #136의 원래 첫 화면 요구는 OPEN이다.
- Issue #137에서는 정적 시연 웹 PR #139, 로컬 `_test` seed PR #140, 시연 Android 빌드 경계 PR #141을 병합했다. PR #141의 `main` CI `35889398325`는 PASS다. 후속 `fix/137-demo-auth-boundary`는 개발 DEMO 인증을 정확한 `.dev` package로 제한한다(브랜치·PR 상태는 `gh pr list`로 확인). 시연 package/scheme/API 설정만 구현됐고 외부 시연 API/DB·OAuth/Reown·APK·실기와 운영 웹 개인 도감은 미완료다.
- 후속 `feat/137-showcase-local-runtime`은 별도 로컬 Docker API·DB를 인증 없이 실행해 가상 점포 공개 조회와 계정 요청 거절을 검증했다. 로컬 환경은 외부 시연 API/DB 배포·시연 앱 연결 완료가 아니다. 실제 PR·CI·병합 상태는 `gh pr list`로 확인한다.
- Issue #142의 개발용 파란 시안 기준을 운영 11개 화면과 읽기 전용 시연 웹의 라이트/다크 의미색에 적용했다. 한글 PR #143의 현재 CI·병합 상태는 `gh pr view 143`과 `git log origin/main -1`로 확인한다. 모바일 자동 180/180, typecheck·lint·Android 개발 JS export, 시연 웹 19/19·접근성·정적 검사, 테스트 AVD의 로그인 화면 라이트/다크·200%는 PASS. 로그인 후 네 탭·실제 휴대전화·공개 HTTPS는 NOT_RUN([증거](evidence/design-consistency-2026-09-24/README.md)). 아래 2026-09-23 수치를 이번 작업의 최신 결과로 오인하지 않는다.

## 2026-09-23 당시 기준선 (역사 기록)

| 항목 | 값 |
| --- | --- |
| 저장소 | `2026-KW-HACKATHON/27_MassCOM` (2026-09-23 당시 `PRIVATE`였으나 현재 `PUBLIC`·활성; 개인 당시 개발 저장소는 `choijunhuk/MassCOM` `PRIVATE`) |
| 기본 브랜치 | `main` |
| 기준 커밋 | 당시 상태를 설명하는 표이며 최신 SHA·배포는 `docs/HANDOFF.md` 머리말과 `git log personal/main -1`을 따른다 |
| 현재 작업·열린 PR | 최신 조직 PR은 `gh pr list --repo 2026-KW-HACKATHON/27_MassCOM`, 개인 당시 PR은 [대응표](PUBLIC_SYNC.md). 인수인계 요약은 `docs/HANDOFF.md` |
| 현재 검증 기준 | PR #134 merge `e9f5b58`, main CI `35809960551` PASS, 기존 Vercel 도메인 새 SVG·`/open` HTTPS PASS. API 단위 82·PostgreSQL 37·Worker 단위 47/PG 23·모바일 149. MetaMask 재연결은 지갑 잠금으로 `BLOCKED`; 검색·필터 조작과 외부 두 IP 제한은 `NOT_RUN` |

## Issue #133 공식 서비스 URL·지갑 출처 진행

- README에는 원래 `https://masscom.kr`이 있었지만 긴 목록 안에 있었고 첫 미리보기 링크는 로컬 `docs/index.html`이었다. 공개 포털·`/open`·API·private GitHub의 역할을 상단에서 구분한다.
- Reown 승인 메타데이터는 GitHub URL 대신 `https://masscom.kr`과 기존 포털 표식을 사용한다. `api.masscom.kr` SIWE 검증, native 복귀 스킴, Base Sepolia와 허용 메서드는 변경하지 않는다.
- [PR #134](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/134) 병합과 PR·main CI PASS. 모바일 149개 단위 시험·typecheck·lint·Android export 및 포털 구조·접근성·bootstrap·비밀 검사 PASS. 기존 Vercel 프로젝트 배포 후 공개 표식 HTTPS 200·`image/svg+xml`·소스 hash 일치, `/open` 200·홈 링크 확인 PASS([증거](evidence/domain-wallet-origin-2026-09-23.json)).
- 개발 앱 새 JS와 지갑 화면은 Samsung 실기에서 열림. MetaMask 8.11.0 재연결은 비밀번호 잠금으로 `BLOCKED`; 기존 세션은 앱에서 해제되어 화면은 `NOT_CONNECTED / UNVERIFIED`. 운영 test.2 APK는 변경 전 코드이므로 새 운영 빌드·재연결은 `NOT_RUN`. Issue #133은 이 실기 완료 전 열린 상태로 유지.

## Issue #129 탐색·운영 방어와 배포

- 공개 카탈로그의 실제 점포 검색·참여 가능 필터, 첫 화면 0건/검색 0건/오류 구분을 구현했다. 148개 모바일 자동 시험·typecheck·lint·Android export는 PASS. Samsung Android 16의 실제 0건 라이트·다크·상태표시줄은 PASS([증거](evidence/android-discovery-2026-09-23.json)); 점포가 없어 검색·필터 실기와 TalkBack·200% 확대는 `NOT_RUN`.
- DEMO 인증의 외부 바인드를 기동 단계에서 차단하고, Caddy가 덮어쓴 단일 IP로 운영 로그인 제한을 분리했다. API 82개 자동 시험·typecheck PASS. Caddy·API의 변경 후 운영 배포와 외부 HTTPS/401은 [실증](evidence/lightsail-api-deployment-2026-09-23.json) PASS, 외부 2-IP 제한은 `NOT_RUN`.
- Worker는 먼저 이벤트와 정식 블록 해시를 대조하고, 블록이 사라지거나 해시가 다르면 최종화하지 않고 재시도한다. Worker 47개 자동 시험·typecheck PASS; 변경 후 Anvil 재구성 통합 시험과 Base Sepolia 재실증은 `NOT_RUN`.
- 오프라인 로그아웃 시 로컬 키를 지우되 서버 세션 회수 실패를 명시한다. 이전 서버 토큰 자동 재회수는 아직 미구현이며 만료 전 유효할 수 있다.
- 개인 Codex 설정의 기본 추론은 GPT‑6 Sol medium으로 조정했고 역할별 Luna/Sol/Astra 배분을 정리했다. 저장소의 협업 기준은 [AI 모델 사용 기준](AI_MODEL_ROUTING.md)에 기록했다.
- [PR #130](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/130)을 merge `fcaa1c0`으로 통합했고 main CI `35772682920`이 PASS했다. 기존 Lightsail 인스턴스에 같은 커밋의 API·Caddy를 배포했다. Worker 운영 서비스·계정 전환·Play는 이번 배포 범위가 아니다.

## Issue #126 모바일 UI 완료

- [PR #127](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/127)을 merge commit `4437607`로 main에 통합했다. 네 기본 탭과 탐색·방문·도감·내 정보의 시각 계층을 구현했으며 기존 API·인증·지갑·NFT 상태 로직은 변경하지 않았다.
- 모바일 자동 시험 `146/146 PASS`, typecheck·lint·Android export·Android 36 arm64 개발 APK 빌드/설치 `PASS`.
- Samsung Android 16에서 네 탭·정직한 빈 상태·360dp·200% 글씨·실시간 다크 모드·뒤로 가기·개발 scheme를 PASS했다. TalkBack 서비스와 접근성 포커스는 부분 확인했으나 첫 실행 안내로 앱 콘텐츠 낭독은 `NOT_RUN`; 두 계정 marker와 cold restore는 확인했지만 데이터·지갑이 모두 비어 D02는 `NOT_RUN`; [증거](evidence/android-ui-navigation-2026-09-23.json). 필수 36개 집계는 31/2/3 그대로다.
- `RQ-001`의 ‘로그인 없이 음식점 탐색 VERIFIED’는 현재 앱 루트의 인증 게이트와 충돌한다. 공개 API의 무로그인 조회가 앱 전체 탐색을 증명하지 않으므로 요구사항 상태를 `IN_PROGRESS`로 바로잡았다. 인증 모델 변경은 이번 UI PR 범위 밖이다.

## Issue #124 중단 체크포인트

- 브랜치 `feat/124-release-closeout`, Base Sepolia Worker proof `83e1c29`, App Link APK 기준 `0d93c49`.
- AWS Lightsail 서울 2GB 인스턴스에 커밋 `73e07c8`의 PostgreSQL·API·Caddy를 배포했고 세 컨테이너 상태를 healthy/running으로 확인했다. DB 5432·API 3000은 인터넷에 publish하지 않았다.
- Vercel 정적 포털 `https://masscom.kr`과 `/privacy`, `/account-deletion`은 HTTPS 200 `VERIFIED`다.
- `api.masscom.kr` DNS·Let’s Encrypt와 외부 `/health` 200을 확인했다. Samsung Android 16에서 실제 Google 동의·session 발급·콜드 스타트 복원·logout revoke가 PASS했다. 두 번째 계정 전환 D02는 `NOT_RUN`이다.
- Google Cloud `masscom-wolgye-2026`에 Web·개발 Android·upload-key Android client를 만들고 잘못된 DailyCoding MassCOM client 3개를 삭제했다. Play 앱 서명 인증서 client는 Play Console 키가 생긴 뒤 별도로 만든다.
- 상세 값과 재개 순서는 [`docs/evidence/external-oauth-hosting-2026-09-22.json`](evidence/external-oauth-hosting-2026-09-22.json), [`docs/HANDOFF.md`](HANDOFF.md)를 따른다.

## 검증 수준별 현황

필수 36개: 31 PASS / 2 BLOCKED / 3 NOT_RUN. 아래 네 묶음은 서로 다른 상태이며 섞어 말하지 않는다.

| 수준 | 해당 항목 |
| --- | --- |
| 로컬 검증 완료 | 탐색·발급·수령·도감·추천, 지갑 주소 확인(SIWE), 발행 요청·Outbox·Worker·계약(Local Anvil), 계정 삭제, 백업·복원 drill, upload-key 운영 AAB 서명·W08·source marker·16KB 정적 검사 |
| 시험망 검증 완료 | Base Sepolia 계약 배포, admin/minter/pauser role, cap 1 series, Worker service minter 발행 1건, receipt/event/owner/locked/metadata, 재실행 무작업 PASS |
| 운영 실기 미검증 | 외부 HTTPS·첫 Google 로그인·private GitHub APK·4KB/16KB·App Links는 PASS. D02, fresh reauthentication, O01, Play는 `NOT_RUN` |
| 사용자 승인·입력 대기 | Foundry keystore 숨김 비밀번호, W04·W05용 지갑 환경(B-010·B-011), Play App Signing 인증서 client. 호스팅·도메인·OAuth·faucet·upload AAB는 해소 |

## 열린 Issue·PR과 최근 병합

실시간 목록은 `gh pr list --state all --limit 20`이 기준이다. 2026-09-23 최근 기준선은 PR #127 merge `4437607`, main CI run `35763199480` PASS다. 직전 release 기준선은 PR #125 merge `de1448f`, main CI `35733488626` PASS다.

## Phase 상태

| Phase | 상태 | 실제 근거 |
| --- | --- | --- |
| Phase 0 저장소·개발 기반 | `VERIFIED` | README·프로젝트 포털·한국어 PR 검사·CI |
| Phase 1 외부 지갑 연결 | `IN_PROGRESS` | 개발 package MetaMask 연결→Base Sepolia→`personal_sign`→서버 `VERIFIED`→콜드 스타트 binding 복원, W06 PASS; 운영 release package·W04·W05는 `NOT_RUN/BLOCKED` |
| Phase 2 지역 상권 핵심 기능 | `VERIFIED` | loopback DEMO 탐색→점주 발급→고객 수령→도감→추천→상세 순환 PASS |
| Phase 3 NFT | `VERIFIED` | Local Anvil 복구 흐름과 Base Sepolia 계약→job/Outbox→암호화 service minter→이벤트·소유자·locked·중복 방지 PASS |
| Phase 4 출시 기반 | `IN_PROGRESS` | 외부 HTTPS·첫 Google 로그인·삭제 페이지·GitHub test.2 APK·4KB/16KB·verified App Link PASS. D02·fresh reauth·Play는 미완료 |
| Phase 5 대회 검증·발표 | `IN_PROGRESS` | 시연 runbook·빈 현장 기록지·증거 manifest 구현(발표 웹·원고는 #220에서 제거, 발표 자료는 저장소 밖에서 준비); 현장·리허설·영상·제출은 NOT_RUN |
| Phase 6 후속 기능 | `PLANNED` | 별도 승인 전 미착수 |

## 구현·검증 완료

- Expo Android 앱, Reown 외부 지갑 전용 연결, 금지 RPC 메서드 차단
- Reown 새 개발 package 허용 목록 실기, MetaMask 자동 복귀, 서버 binding과 현재 주소·체인을 대조한 콜드 스타트 `VERIFIED` 복원
- ERC-4361 주소 확인, nonce 단일 소비, 버전된 PostgreSQL wallet binding
- 공개 음식점·캠페인, 점포별 OWNER/STAFF 권한, 1인 일회용 방문 코드
- QR slot 소비·방문·KST 일일 진행·첫/3/5회 고정 보상권 원자 처리
- 방문·앱 수집품·실제 NFT를 분리한 도감과 이유가 보이는 다음 가게 추천
- OpenZeppelin ERC-721/ERC-5192 계약의 역할·누적 상한·reward key·영구 잠금
- 보상권·고정 수령인 mint job·Outbox 원자 생성과 동일 요청 20개 수렴
- Worker의 `SKIP LOCKED` lease·heartbeat, 제출 attempt, 체인 이벤트, NFT 자산, cursor 저장
- 전송 전 chain/contract/MINTER 검사와 receipt·계약·수령인·series·reward key·owner·locked 대조
- 응답 유실, 두 Worker 경쟁, lease 만료, 이벤트 반복, 확정 전 재조직, DB 자산 복구
- Samsung Android 16에서 NFT 공개 안내→접수→등록 완료와 기존 token #1 재전송 없는 복구
- 계정 삭제 동시 10요청 수렴, 미전송 mint 취소, 제출/확정 보존, 원 account ID 비식별화 D01
- 민감 로그 인자·미검토 analytics SDK CI 차단과 raw API error 로그 제거 D03
- Samsung Android 16 계정 설정·공개 장부 안내·Local DEMO 삭제 요청
- 실제 시연/실패 대체 runbook(발표 페이지·3분·5분 원고는 Issue #220에서 제거, 발표 자료는 저장소 밖에서 준비)
- 결과를 미리 채우지 않은 현장 검증 기록지와 제출 증거 manifest·허위 주장 gate
- 삭제·wallet·claim·redeem·mint request 공통 account lifecycle lock과 삭제 tombstone write 차단
- 활성 Worker lease 삭제 보호, submit 직전 lease 재검사, duplicate revert reward-key 복구
- chain cursor 기반 재시작 범위, 12블록 reorg margin, 오래된 reward 이벤트 fallback 복구
- 36개 테스트 catalog/ledger ID별 상태 동기화와 강화된 secret·PR gate와 증거 정합 검사

## 미완료

- Android 카메라 QR·수동 코드 대체 입력·오프라인 A01
- 단체 인원·금액 한도 정책(v3 제안값, 미승인). 사람별 슬롯 독립성 Q04는 PASS
- W04 동일 세션 서명 중 주소 변경, W05 미지원 스마트 지갑 실기
- 실제 운영 계정 전환·캐시 복원 D02
- 운영 권한 O01
- mainnet·Google Play 제품 배포
- 실제 현장 참여·발표 리허설·영상 촬영·저장소 공개·대회 최종 제출

## 영역별 현재 상태

| 영역 | 상태 | 내용 |
| --- | --- | --- |
| 배포 | `IN_PROGRESS` | `masscom.kr` 포털·법적 페이지·`/app/` 및 `api.masscom.kr`이 기존 AWS Lightsail에서 공인 TLS로 응답하고 `/health` 200을 확인. 운영 웹 Google 로그인·개인 도감·Worker·백업 복원 실험은 별도 `BLOCKED/NOT_RUN` |
| Android 빌드 | `IN_PROGRESS` | private GitHub test.2 APK, upload key AAB gate, Samsung 4KB·Android 36 16KB AVD·verified `/open` App Link PASS. Play 업로드는 `NOT_RUN` |
| NFT·시험망 | `VERIFIED` | Local Anvil 복구·장애 흐름과 Base Sepolia 실제 계약·role·series·Worker mint #1·중복 방지 PASS. mainnet 범위 밖 |
| 외부 지갑 연동 | `IN_PROGRESS` | `kr.masscom.wolgye.dev` MetaMask 연결·Base Sepolia·`personal_sign`·서버 검증·자동 복귀·콜드 스타트 복원과 W06 실기 PASS(B-014 해소). 운영 `kr.masscom.wolgye` release 복귀는 `NOT_RUN`; W04·W05는 `BLOCKED`(B-010·B-011) |

## 검증 상태

- 필수 36개: 31 PASS / 2 BLOCKED / 3 NOT_RUN
- API 단위: `82/82 PASS`; PostgreSQL: 직전 `37/37 PASS`(이번 변경 뒤 미재실행)
- Worker 단위: `47/47 PASS`; PostgreSQL: 직전 `23/23 PASS`(이번 변경 뒤 미재실행); Anvil W07/M01~M08: 직전 `PASS`
- 모바일: `148/148 PASS`; typecheck·lint·Android export `PASS`. Issue #129의 Samsung 빈 화면 라이트·다크·상태표시줄 실기 PASS. 첫 Google 로그인·콜드 복원·logout과 Issue #126 네 탭 실기는 이전 코드 기준 PASS이며, 변경 후 검색·필터·TalkBack 앱 낭독·완전한 D02는 `NOT_RUN`
- Foundry: `8/8 PASS`, fuzz 128, fmt·build·lint `PASS`
- 비밀 검사·부트스트랩·프로젝트 포털 접근성/구조: `PASS`
- production dependency audit: API·Worker high 이상 0; 모바일 high 이상 0, Expo 전이 moderate 14건은 B-008

## BLOCKED

- B-002 저장소 공개 전환과 심사 public 준비: 명시 승인 필요
- B-004 Google Play 정책: 공식 확인 필요. B-007 package ID는 `kr.masscom.wolgye`로 해소(D-022)
- B-008 Expo 전이 moderate advisory: 2026-09-20 Expo 57.0.24·expo-router 57.0.22 patch 적용 뒤 재평가에서도 14건 유지. 근원은 `xcode`→`uuid`(iOS 설정 도구, 빌드 시점)와 `expo-router`→`query-string`→`decode-uri-component`이며 npm이 제시하는 수정은 expo 46 다운그레이드뿐이라 호환되는 upstream 수정 필요
- Issue #129 재평가에서는 모바일 moderate 15건, high/critical 0건. 자동 downgrade는 적용하지 않았다. 오프라인 서버 세션 회수 재시도와 운영 프록시 실증은 남아 있다.
- B-010/B-011 W04·W05용 실제 지갑 환경 부재
- Base Sepolia Worker proof와 upload-key AAB·16KB runtime·App Links는 PASS. Play는 별도 `NOT_RUN`

상세 실행 근거는 [TEST_STATUS.md](TEST_STATUS.md), Phase 3 증거는 [phase3-worker-anvil-android.json](evidence/phase3-worker-anvil-android.json), 차단 사유는 [BLOCKERS.md](BLOCKERS.md), 다음 세션 상태는 [HANDOFF.md](HANDOFF.md)를 기준으로 합니다.
