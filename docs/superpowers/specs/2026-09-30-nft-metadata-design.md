# NFT 메타데이터(가게 이름·동네·업종·방문 단계·가게 그림) 발행 때 고정 설계 (Issue #254)

2026-09-30 소유자가 NFT 메타데이터에 **가게 이름 + 동네(동)** 를 넣고 추천안 전체를 적용하기로 정했다(`USER_CONFIRMED`, D-060 결정 1~6). 이 문서가 먼저 쓰이고 구현이 이 문서를 따른다. 아래 "구현 선택"은 소유자 결정 안에서 에이전트가 정한 엔지니어링 선택이라 D-060에 `PROPOSED`로 따로 표시한다.

## 1. 소유자 결정(요약, `USER_CONFIRMED`)

1. **담는 것:** 이름(`<가게 이름> 방문 도장`), 설명, 이미지(사장님이 적용한 AI 가게 그림, 없으면 기본 도장), 속성(가게 이름, 동네(예: 월계동), 업종, 방문 단계(예: 3번째 방문), 캠페인 이름).
2. **담지 않는 것:** 정확한 주소, 방문·발행 시각, 주문·결제, 계정·지갑 등 개인정보(AGENTS 보안 불변조건).
3. **발행 때 고정:** 발행이 체인에서 확정될 때 메타데이터를 DB에 저장한다. 그 뒤 가게 정보가 바뀌어도 이미 발행한 토큰의 내용은 바뀌지 않는다. 이미지는 내용 해시 주소로 고정한다.
4. **내보내기:** 공개 HTTPS `https://masscom.kr/nft-metadata/<series>/<tokenId>.json`, `application/json`, CORS 허용, 하루 캐시(거부 목록이 하루 안에 반영, §8). 없는 토큰은 404.
5. **가게 정보 입력:** 관리자 웹에서 동네(동)·업종을 입력한다(공개 조건과는 별개). 동네는 행정동 이름만 받는다.
6. **기존 실증 토큰:** `docs/nft-metadata/base-sepolia-proof/1.json`은 그대로 둔다.

## 2. 지금 상태(코드 확인)

- 컨트랙트 `contracts/src/WolgyeMascot.sol`: `tokenURI(tokenId) = series[seriesByToken[tokenId]].baseTokenURI + tokenId + ".json"`. 시리즈의 `baseTokenURI`는 `createSeries` 때 정해지고 바꿀 수 없다.
- 시리즈는 코드가 만들지 않는다. 운영자가 온체인 `createSeries`와 DB `nft_series` 행을 따로 만든다(저장소에는 시험 fixture와 실증 기록 `docs/evidence/base-sepolia-deployment.json`의 `metadataBase: https://masscom.kr/nft-metadata/base-sepolia-proof/`뿐). 운영 DB·시연 DB에는 `nft_series` 행이 없고, 운영 compose·시연 compose 모두 Worker 서비스가 없다(운영은 `NFT_MINTING_MODE=PREPARING`, D-054).
- 발행 확정 지점: Worker `PostgresMintRepository.finalize`(`apps/worker/src/postgres-mint-repository.ts`)가 한 트랜잭션에서 `chain_events`·`nft_assets`를 넣고 `mint_jobs.status='FINALIZED'`, `token_id`를 적는다. `finalize`는 요구 확인 수(`CHAIN_CONFIRMATIONS`)를 채운 receipt·이벤트 대조 뒤에만 불린다.
- 가게 그림(`merchant_art`, 0029)은 점포당 한 행이고 되돌리거나 새 그림을 적용하면 바뀐다/지워진다. 공개 경로 `/merchant-art/<sha256>.webp`는 **지금 적용된** 그림만 준다.
- 운영 Caddy는 `masscom.kr`의 `/nft-metadata/*`를 정적 파일(`/srv/masscom`, `scripts/build-public-site.mjs`가 `nft-metadata/base-sepolia-proof/1.json`만 넣음)로 주고 `Access-Control-Allow-Origin: *`를 붙인다. 시연 API 호스트 `demo-api.masscom.kr`는 모든 경로를 `showcase-api:3000`으로 넘긴다(`scripts/verify-showcase-edge-routes.mjs`가 이 경계를 검사).

## 3. 구현 선택(`PROPOSED`)

### 3.1 시리즈 경로와 `baseTokenURI`

- 공개 경로의 `<series>`는 **`nft_series.id` 그대로**다. 시리즈를 만들 때 온체인 `createSeries`의 `baseTokenURI`는 `<메타데이터 출처>/nft-metadata/<nft_series.id>/`로 준다.
  - 운영: `https://masscom.kr/nft-metadata/<id>/`(Caddy가 API로 넘김, 3.5).
  - 시연: `https://demo-api.masscom.kr/nft-metadata/<id>/`(시연 API 호스트가 이미 모든 경로를 `showcase-api`로 넘기므로 Caddy 변경 없음. `demo.masscom.kr`은 DNS·웹 서버가 없다).
- `nft_series.id`는 뜻 없는 불투명 id `^s-[0-9a-f]{32}$`이고 대소문자와 무관하게 `base-sepolia-proof`가 아니어야 한다. id는 온체인 baseTokenURI와 모든 토큰 주소에 영구히 남으므로 가게 이름·동네·업종·캠페인을 넣지 않는다(넣으면 공개 중이 아닌 가게의 일반 메타데이터 보호가 무너진다). migration 0036이 이 CHECK를 **`NOT VALID`** 로 더해 새로 넣는 행만 검사한다(기존 행이 있어도 migration이 실패하지 않음. 운영·시연 DB에는 행이 없다). API·Caddy의 경로 규칙은 더 넓은 `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`로 이 모양을 받는다.
- `base-sepolia-proof`는 정적 파일로 남는다. Caddy가 이 경로를 API로 넘기지 않으므로 실증 토큰 #1은 지금과 바이트까지 같다.

### 3.2 스냅샷 시점과 저장

- `finalize` 트랜잭션 안에서 `nft_assets`를 넣은 직후 스냅샷을 만든다. 같은 트랜잭션이라 `FINALIZED`인데 메타데이터가 없는 순간이 없고, 스냅샷이 실패하면 확정도 되돌려져 다음 실행이 다시 한다.
- 이미 확정된 작업을 다시 확정하는 경로(`findExistingAsset` 뒤 조기 반환)도 같은 스냅샷 함수를 부른다. 스냅샷 함수는 행이 이미 있으면 아무것도 읽거나 쓰지 않는다(`INSERT … ON CONFLICT DO NOTHING`과 사전 확인). 그래서 재확정은 내용을 바꾸지 않는다.
- 새 표(0036):
  - `nft_token_metadata`: `nft_asset_id uuid PK → nft_assets`, `nft_series_id text → nft_series`, `token_id numeric(78,0)`, `metadata_json text`(유효한 JSON 객체 CHECK), `image_sha256 text NULL`(형식 CHECK만, 참조 제약 없음 — 아래 그림 내리기 때문), `created_at`. `UNIQUE (nft_series_id, token_id)`.
  - `nft_metadata_images`: `sha256 text PK`(소문자 hex 64), `image bytea`(비어 있지 않음), `created_at`. 스냅샷 때 적용된 가게 그림 바이트를 복사해 둔다. 가게가 그림을 바꾸거나 되돌려도 이 행은 남는다.
  - 행 트리거(`nft_metadata_immutable()`)가 `nft_token_metadata`의 `UPDATE`·`DELETE`와 `nft_metadata_images`의 `UPDATE`를 막는다. 한 번 쓴 토큰 메타데이터와 그림 내용은 바뀌지 않는다(`TRUNCATE`는 행 트리거를 타지 않아 시험 초기화는 그대로 된다).
  - **내리기:** 신고·정책 문제로 토큰 메타데이터나 그림을 내려야 하면 행을 고치거나 지우지 않고 거부 목록 `nft_metadata_takedowns`(`asset:<nft_assets.id>`·`image:<sha256>`)에 넣는다(7절). 그 주소만 404가 되고 메타데이터 문장은 그대로 남는다.
- `metadata_json`은 **응답 바이트 그대로의 text**다(jsonb는 키 순서를 바꾸므로 쓰지 않는다). API는 저장된 문자열을 그대로 보낸다.

### 3.3 생성기(`apps/worker/src/nft-metadata.ts`, 순수 함수)

입력(스냅샷 때 DB에서 읽음): 가게 이름(`merchants.name`), 동네(`merchants.neighborhood`, 없을 수 있음), 업종(`merchants.category`, 없을 수 있음), 캠페인 이름(`campaigns.title`), 방문 단계(`nft_series.target_visit_count` = 캠페인 목표 1·3·5), 적용된 가게 그림 바이트(`merchant_art.image`, 없을 수 있음).

출력 JSON(키 순서 고정):

```json
{
  "name": "월계 김밥 방문 도장",
  "description": "월계동 월계 김밥 3번째 방문 도장입니다. 월계 마스코트 방문 도감이 발행한 기념 NFT이며 다른 지갑으로 보낼 수 없습니다.",
  "image": "https://masscom.kr/nft-metadata/images/<sha256>.webp",
  "attributes": [
    { "trait_type": "가게 이름", "value": "월계 김밥" },
    { "trait_type": "동네", "value": "월계동" },
    { "trait_type": "업종", "value": "분식" },
    { "trait_type": "방문 단계", "value": "3번째 방문" },
    { "trait_type": "캠페인", "value": "가을 방문 도감" }
  ]
}
```

- 방문 단계: 1은 `첫 방문`, 그 밖은 `<n>번째 방문`.
- 동네·업종이 비어 있으면 그 속성을 빼고, 설명에서도 동네를 뺀다(`월계 김밥 첫 방문 도장입니다. …`).
- 이미지: 가게 그림이 있으면 **바이트의 sha256을 Worker가 직접 계산**해 `<출처>/nft-metadata/images/<sha256>.webp`로 쓰고 바이트를 `nft_metadata_images`에 복사한다(열에 적힌 값이 아니라 실제 내용으로 주소를 정한다). 없거나 쓸 수 없으면 판이 붙은 기본 도장 `<출처>/nft-metadata/default/mascot-stamp-v1.png`(바이트 고정, 7절).
- 넣지 않는 것: 도로명 주소, 소개·메뉴·영업시간, 방문·발행·확정 시각, 주문·결제, 계정 ID, 지갑 주소, tx hash, reward key, 참조 번호. 생성기는 이런 값을 입력으로 받지도 않는다.
- 출처(`<출처>`)는 Worker 환경 변수 `NFT_METADATA_ORIGIN`(필수, `https://호스트`만, 경로·쿼리 없음. 로컬 시험용 `http://localhost`·`http://127.0.0.1`만 예외). 운영 `https://masscom.kr`, 시연 `https://demo-api.masscom.kr`. Worker 저장소 클래스도 이 옵션을 기본값 없이 반드시 받고, 실행기(`run-worker.ts`)는 환경 변수에서 받는다.

### 3.4 가게 정보: 동네·업종(migration 0036, 관리자 API·웹)

- `merchants.neighborhood text NULL`: 앞뒤 공백을 지운 뒤 `^[가-힣][가-힣0-9·]{0,8}[동가리]$`(2~10자, 한글로 시작, `동`·`가`·`리`로 끝남, 가운데에 숫자·가운뎃점 `·` 허용 — 행정동 `월계1동`·`상계3·4동` 때문)이고 숫자가 3자리 이상 이어지면 안 된다. 공백·영문·다른 기호는 거절. DB CHECK가 같은 규칙의 최후 방어선이다. 도로명 주소·번지는 이 규칙을 통과할 수 없다(공백·숫자열).
- `merchants.category text NULL`: 고정 목록 `한식`·`중식`·`일식`·`양식`·`분식`·`카페`·`베이커리`·`주점`·`기타` 중 하나(DB CHECK).
- 관리자 API(`POST /api/web/admin/merchants`, `PATCH /api/web/admin/merchants/:id`): 본문에 선택 키 `neighborhood`·`category`. 키가 없으면 그대로 두고(옛 관리자 웹 호환), `null`·빈 문자열이면 비우고, 값이면 검사해 틀리면 `400 ADMIN_INVALID_INPUT`. `AdminMerchant`에 두 필드가 더해진다(옛 웹은 무시).
- 공개 조건(#246의 메뉴·영업시간·주소·동의서 참조 번호)은 **바꾸지 않는다.** 동네·업종이 없어도 공개할 수 있고, 그때 메타데이터에서 해당 속성이 빠진다.
- 관리자 웹: 점포 등록·수정 양식에 `동네(행정동)` 입력과 `업종` 선택을 둔다. 보내기 전에 같은 동네 규칙을 먼저 알려 주고(서버가 최종 판단), 이 값이 공개 NFT 메타데이터에 들어간다는 안내를 붙인다.
- 시연 seed: 가상 점포 A·B·C에 동네 `월계동`, 업종 `카페`·`분식`·`한식`. 이미 seed된 시연 DB에는 두 열이 모두 비어 있는 시연 점포(`is_demo`)에만 채운다(다른 값은 건드리지 않음). 운영 DB에는 넣지 않는다.

### 3.5 공개 경로

API(`apps/api/src/server.ts`, 로그인 없음):

| 경로 | 응답 |
| --- | --- |
| `GET`·`HEAD /nft-metadata/<series>/<tokenId>.json` | 스냅샷이 있으면 200, 저장된 바이트 그대로, `content-type: application/json; charset=utf-8`, `cache-control: public, max-age=86400`(거부 목록이 늦어도 하루 안에 반영), `access-control-allow-origin: *` |
| `GET`·`HEAD /nft-metadata/images/<sha256>.webp` | 보존된 그림이 있고 내리지 않았으면 200 `image/webp`, 같은 캐시·CORS |
| `GET`·`HEAD /nft-metadata/default/mascot-stamp-v1.png` | 판이 붙은 기본 도장 200 `image/png`, `public, max-age=31536000, immutable`(바이트가 영원히 같음) |
| 그 밖·없는 토큰·아직 확정 전 | 404 `{"code":"NOT_FOUND"}`, `cache-control: no-store`, `access-control-allow-origin: *` |

- `<series>`는 3.1 규칙, `<tokenId>`는 앞자리 0 없는 10진수(`0|[1-9][0-9]{0,77}`). 시리즈와 토큰이 **둘 다** 맞는 스냅샷만 준다(다른 시리즈 경로로 같은 토큰을 읽을 수 없음).
- 존재 누설: 스냅샷은 체인 확정 뒤에만 생기므로 404/200은 체인에서 이미 보이는 사실(토큰 발행)보다 더 알려 주지 않는다. 확정 전 토큰은 404다.

운영 Caddy(`infra/lightsail/Caddyfile`, `masscom.kr`·`www`):

- `@nftMetadataApi`: `GET`·`HEAD`이고 경로가 `^/nft-metadata/(images/[0-9a-f]{64}\.webp|default/mascot-stamp-v1\.png|[A-Za-z0-9][A-Za-z0-9_-]{0,127}/(0|[1-9][0-9]{0,77})\.json)$`이며 `/nft-metadata/base-sepolia-proof/*`가 **아닌** 요청만 `api:3000`으로 넘긴다. 나머지(실증 토큰 포함)는 지금처럼 정적 파일이다.
- 기존 `Access-Control-Allow-Origin: *` 헤더는 `defer`로 바꿔 API가 보낸 값과 겹치지 않고 한 값만 남게 한다.
- `api.masscom.kr`은 원래 모든 경로를 API로 넘기므로 같은 경로가 그곳에서도 보인다(같은 공개 데이터). 시연 Caddy(`demo-api`)는 바꾸지 않는다.

## 4. 호환(배포된 API `d004d7f`)

migration이 API 교체보다 먼저 돈다. 0036는 추가만 한다.

| 변경 | 옛 API·옛 Worker에 미치는 영향 |
| --- | --- |
| `merchants.neighborhood`·`category` NULL 열 추가 | 옛 `INSERT`(열 목록 명시)·`UPDATE`·`SELECT`는 새 열을 모르고 NULL로 둔다 |
| `nft_series` id CHECK `NOT VALID` | 옛 API는 `nft_series`에 쓰지 않는다. 기존 행은 검사하지 않는다 |
| 새 표 2개·트리거 | 옛 코드는 읽지도 쓰지 않는다. 옛 Worker(배포된 곳 없음)는 스냅샷을 만들지 않을 뿐이다 |

0036는 `SET LOCAL lock_timeout = '5s'`로 운영 표(`merchants`) 잠금을 오래 기다리지 않는다(0032와 같은 규칙). 병렬 PR #257(0034·0035, D-056·D-057)·#253(0033, D-059)과 겹치는 표·열이 없어 적용 순서와 무관하다. 번호 충돌을 피하려고 이 브랜치는 migration 0036·결정 D-060을 쓴다.

배포 순서: ① migration(API 배포가 먼저 돌림) → ② API → ③ 운영 웹(새 관리자 웹은 새 키를 보내므로 옛 API면 400이 난다) → ④ Caddy(웹 배포에 포함) → ⑤ 발행을 열 때 Worker(`NFT_METADATA_ORIGIN` 필수)와 시리즈 생성(3.1 규칙). 운영 발행은 여전히 `PREPARING`(D-054, B-027)이라 이번 변경으로 운영 토큰이 생기지 않는다.

## 5. 개인정보·공개 범위

- 새로 공개되는 것: 가게 이름·동네·업종·캠페인 이름·방문 단계와 가게 그림. 모두 가게가 이미 고객 앱·웹에 공개한 가게 정보이고 사람에 대한 정보가 아니다. 메타데이터는 누구나 읽을 수 있는 공개 주소이며 한 번 확정되면 바뀌지 않는다는 점을 개인정보 처리방침에 적는다.
- 넣지 않는 것은 3.3 목록과 같다. 보유 지갑은 체인에 이미 공개돼 있지만 메타데이터에는 넣지 않는다.
- 관리자 웹 안내: 동네·업종은 공개 NFT 메타데이터에 들어가 발행 뒤 바꿀 수 없다.

## 6. 시험

- 생성기 단위(`npm test --prefix apps/worker`): 담는 속성·순서, 동네·업종 없을 때 생략, 방문 단계 문구, 이미지(그림 해시 주소 / 기본 도장), 주소·시각·지갑·계정·주문 모양 값이 결과에 없음, `NFT_METADATA_ORIGIN` 검사.
- Worker PostgreSQL 통합(`npm run test:postgres --prefix apps/worker`): 확정 때 스냅샷·그림 보존, 가게 이름·동네·업종·그림 변경 뒤에도 불변, 재확정 멱등, 확정 전 없음, 트리거가 수정·삭제 거절.
- API 단위: 동네·업종 규칙. API PostgreSQL 통합: 관리자 수정·생성·비우기·키 없으면 유지·잘못된 값 거절, 공개 조건 불변, 공개 경로 200/404·헤더·시리즈 불일치 404·그림.
- 공개 경로(`tests/ops/verify_nft_metadata_proxy_test.mjs`, Docker Caddy): 실증 토큰은 정적 바이트 그대로, 동적 경로는 API로, CORS 한 값, 잘못된 경로·쓰기 메서드는 넘기지 않음.
- 관리자 웹(`tests/site/nft-metadata-admin.test.mjs`): 입력 칸·안내·요청 본문·로컬 검사. 기존 `tests/site/*.mjs` 전부 통과.

## 7. 리뷰 후속(2026-09-30, PR #260: sonnet 코드 APPROVE·opus 보안 APPROVE, 🟡 4는 발행 전 필수)

위 3~6절에서 바뀐 점만 적는다. 번호 충돌을 피하려고 migration은 **0036**, 결정은 **D-060**이다.

- **발행 동의 v2(🟡1):** 앱의 발행 확인창이 "지갑 주소와 함께 가게 이름·동네·업종·캠페인과 방문 단계가 NFT 공개 정보로 영구히 남고 발행 시각이 공개 블록체인에 기록되며, 발행 뒤 지우거나 바꿀 수 없다"고 알리고 판을 `nft-mint-v2`로 올린다(`apps/mobile/src/screens/collection/mint-consent.ts`). API 기본값과 운영 compose는 v2만 받는다. 운영에는 시리즈가, 시연에는 Worker가 없어 v1로 대기 중인 발행 작업은 없다. 이미 설치된 시연 앱(v1)은 새 발행 요청에서 `CONSENT_REQUIRED`("최신 공개·양도 제한 안내 동의가 필요합니다")를 받는다. 개인정보 처리방침은 "메타데이터는 가게 정보지만 지갑에 묶여 그 지갑이 그 가게를 몇 번째로 방문했는지가 공개된다"로 고쳤다.
- **공개 중이 아닌 점포는 일반 메타데이터(🟡2, 추천안 적용):** 스냅샷 때 점포가 `status = 'ACTIVE'`이고 (`is_demo` 또는 `consent_document_ref IS NOT NULL`)이 아니면 이름 `월계 방문 도장`, 설명 `월계 마스코트 방문 도감의 <단계> 도장입니다. 다른 지갑으로 보낼 수 없는 기념 NFT입니다.`, 기본 도장, 속성은 `방문 단계`뿐이다. 캠페인 이름에도 가게 이름이 들어갈 수 있어 캠페인 속성도 뺀다(구현 선택). #246 숨김 코드는 바꾸지 않았다.
- **거부 목록(🟡3):** `nft_metadata_takedowns(target PK: image:<sha256> | asset:<nft_assets.id>, reason, created_at)`. API는 내린 토큰의 메타데이터·내린 그림을 `404`(no-store)로 하고, 스냅샷은 내린 그림을 복사하지 않는다(기본 도장). 행 자체는 고치지 않는다. 운영 절차와 커밋 뒤 확인은 `apps/api/README.md`.
- **기본 도장 고정(🟡4):** `<출처>/nft-metadata/default/mascot-stamp-v1.png`. API가 고정 바이트(sha256 `147545653d7dca77c744aaf778ea4ae5836e8ce3c395aeb094eac5fec3926a11`, 시험으로 고정)를 `image/png`·immutable로 준다. 배포 경로를 늘리지 않도록 PNG를 `apps/api/src/nft-default-stamp.ts`에 base64로 둔다(구현 선택). 시연은 자기 출처(`demo-api`)의 같은 경로를 쓴다. 운영 Caddy 경로 정규식에 이 경로를 더했다.
- **AI 표시(🔵10):** 가게 AI 그림을 쓰면 속성 `{"trait_type":"그림","value":"AI 생성"}`을 붙인다(기본 도장에는 붙이지 않음).
- **실패 코드(🔵5):** 스냅샷의 모든 실패를 `NFT_METADATA_SNAPSHOT_FAILED`(재시도 가능)로 감싸 확정 전체를 되돌리고 작업의 `last_error_code`에 남긴다. 스냅샷은 존재 확인을 따로 하고 사실 행이 없으면 실패한다(코드 리뷰 8).
- **DB 보강:** `nft_metadata_images`에 `sha256 = encode(sha256(image), 'hex')` CHECK, 예약 시리즈 id는 `lower(id) <> 'base-sepolia-proof'`(API도 소문자로 비교). 불변 트리거는 앱 실수를 막는 장치이고 표 소유자 역할의 권한 경계는 아니다(🔵8).
- **운영 확인:** 웹 배포 뒤 확인이 `/nft-metadata/no-such/1.json`에서 API의 JSON 404(no-store)와 CORS `*` 한 줄을 확인한다. 메타데이터·그림 응답은 `Content-Length`를 붙인다(HEAD 포함). Worker 저장소는 출처 옵션을 반드시 받는다.
- **관리자 웹:** 점포 수정 양식과 캠페인 초안 양식에 공개 NFT 정보·발행 뒤 고정 안내를 둔다(🔵9·코드 리뷰 4). 웹과 서버의 동네 정규식이 같은지 시험한다.
- **속성 구성(코드 리뷰 9):** 공개 점포의 속성은 가게 이름·동네·업종·방문 단계·캠페인(+그림)이며 별도 "시리즈 이름" 속성은 두지 않는다. 이슈의 "캠페인·시리즈 이름"은 캠페인 속성과 방문 단계(시리즈 = 캠페인 목표 1·3·5)로 나타낸다.

## 8. 재리뷰 후속(2026-09-30, opus APPROVE 🔴 0)

- **스냅샷 실패와 시간 초과(🟡1):** 발행은 체인에서 끝났고 스냅샷만 실패한 작업(`NFT_METADATA_SNAPSHOT_FAILED`)이 결과 대기 시간(`receiptTimeoutMs`)이나 전송 상한에 걸려 수동 검토로 닫힐 때 원인 코드를 `RECEIPT_TIMEOUT` 등으로 덮지 않고, 채굴된 시도를 `FAILED`로 닫지 않는다(`SUBMITTED` 유지, 재전송 대상은 수동 검토 작업을 빼므로 다시 보내지 않음). 운영자는 원인을 고친 뒤 작업을 `RETRYABLE`, Outbox를 `PENDING`으로 되돌리고, 다음 실행의 `findMintByRewardKey`가 기존 발행을 찾아 확정한다(`apps/worker/README.md`). 실패 원인은 SQLSTATE·제약 이름만 한 번 로그로 남긴다.
- **불투명 시리즈 id(🟡2):** 3.1의 규칙. 시험 fixture의 시리즈 id도 모두 `s-` + hex 32자로 바꿨다.
- **캐시:** 토큰 메타데이터·가게 그림은 `public, max-age=86400`(거부 목록이 늦어도 하루 안에 반영), 판이 붙은 기본 도장만 immutable.
- **동의 판:** API는 `NFT_MINT_CONSENT_VERSION`이 v2보다 낮거나 형식이 틀리면 시작하지 않는다. 낮은 판의 요청은 `400 CONSENT_VERSION_OUTDATED`(새 앱 문구: "발행 안내가 바뀌었어요. 앱을 업데이트해 주세요."), 판이 없거나 모르는 값이면 `CONSENT_REQUIRED`. 이 코드를 모르는 옛 앱은 "NFT 접수 실패: CONSENT_VERSION_OUTDATED"로 보인다. compose·API 기본값·앱의 판이 모두 v2인지 시험한다.
- **거부 목록 대상:** `asset:`은 정확한 UUID 모양(`[0-9a-f]{8}-…-[0-9a-f]{12}`)만 받는다.
