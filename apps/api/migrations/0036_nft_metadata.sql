-- Issue #254: NFT 메타데이터(가게 이름·동네·업종·방문 단계·가게 그림)를 발행 확정 때 고정한다.
-- 배포된 API(d004d7f)가 이 스키마에서 그대로 동작하도록 NULL 열·새 표·NOT VALID CHECK만 더한다(migration이 API 교체보다 먼저 돈다).
-- 병렬 PR #257(0034·0035)·#253(0033)과 겹치는 표·열이 없어 적용 순서와 무관하다.

-- 실행기(runMigrations)가 파일마다 BEGIN … COMMIT으로 감싸므로 이 값은 이 파일의 트랜잭션에서만 산다(0032와 같은 규칙).
SET LOCAL lock_timeout = '5s';

-- 동네는 행정동 이름만: 한글로 시작해 동·가·리로 끝나는 2~10자, 가운데에 숫자·가운뎃점(월계1동·상계3·4동) 허용, 숫자 3자리 이상 연속 금지.
-- 업종은 고정 목록이다. 둘 다 공개 NFT 메타데이터에 들어가며 점포 공개 조건과는 무관하다(NULL 허용).
ALTER TABLE merchants
  ADD COLUMN neighborhood text CHECK (
    neighborhood IS NULL OR (
      neighborhood ~ '^[가-힣][가-힣0-9·]{0,8}[동가리]$' AND neighborhood !~ '[0-9]{3}'
    )
  ),
  ADD COLUMN category text CHECK (
    category IS NULL OR category IN ('한식', '중식', '일식', '양식', '분식', '카페', '베이커리', '주점', '기타')
  );

-- 시리즈 id는 온체인 baseTokenURI와 모든 토큰 주소(/nft-metadata/<id>/<tokenId>.json)에 영구히 남는다. 가게 이름·동네·업종·캠페인이
-- 들어간 id는 공개 중이 아닌 가게의 일반 메타데이터 보호를 무너뜨리므로 뜻 없는 불투명 id(s- + 소문자 hex 32자)만 받는다.
-- 정적 실증 경로와도 대소문자까지 겹치지 않게 한다. 운영·시연 DB에는 시리즈 행이 없지만 수동으로 만든 행이 있어도
-- migration이 실패하지 않도록 새 행만 검사한다.
ALTER TABLE nft_series
  ADD CONSTRAINT nft_series_metadata_path_check
  CHECK (id ~ '^s-[0-9a-f]{32}$' AND lower(id) <> 'base-sepolia-proof') NOT VALID;

-- 스냅샷 때 복사한 가게 그림. 파일 이름이 내용의 sha256이라 가게가 그림을 바꾸거나 되돌려도 이미 발행한 토큰의 그림은 남는다.
-- 내용은 바꿀 수 없고(UPDATE 거절), 신고·정책 문제로 운영자가 내려야 할 때만 행을 지운다(그 주소는 404가 된다).
CREATE TABLE nft_metadata_images (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  image bytea NOT NULL CHECK (octet_length(image) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 주소의 해시가 실제 바이트의 해시와 같아야 한다(내용 해시 주소).
  CHECK (sha256 = encode(sha256(image), 'hex'))
);

-- 발행 확정(finalize) 트랜잭션에서 한 번 쓰는 토큰 메타데이터. metadata_json은 공개 응답 바이트 그대로다(jsonb는 키 순서를 바꾼다).
CREATE TABLE nft_token_metadata (
  nft_asset_id uuid PRIMARY KEY REFERENCES nft_assets(id),
  nft_series_id text NOT NULL REFERENCES nft_series(id),
  token_id numeric(78, 0) NOT NULL CHECK (token_id >= 0),
  metadata_json text NOT NULL CHECK (jsonb_typeof(metadata_json::jsonb) = 'object'),
  -- 그림 행은 운영자가 내릴 수 있어 참조 제약을 두지 않는다(메타데이터는 그대로, 그림 주소만 404).
  image_sha256 text CHECK (image_sha256 IS NULL OR image_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nft_series_id, token_id)
);

-- 신고·정책 문제로 내린 대상 목록(거부 목록). image:<sha256>은 그림 주소를, asset:<nft_assets.id>는 그 토큰의 메타데이터 주소를
-- 404로 만들고, 내린 그림은 다음 스냅샷이 복사하지 않는다(기본 도장). 메타데이터 문장 자체는 지우지 않는다.
CREATE TABLE nft_metadata_takedowns (
  target text PRIMARY KEY CHECK (
    target ~ '^(image:[0-9a-f]{64}|asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
  ),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 한 번 쓴 메타데이터는 바꾸거나 지우지 않고, 그림은 바꾸지 않는다. TRUNCATE는 행 트리거를 타지 않는다(시험 초기화용).
-- 이 트리거는 앱 코드의 실수(잘못된 UPDATE·DELETE)를 막는 장치다. 표 소유자 역할은 트리거를 끌 수 있으므로 DB 권한 경계는 아니다.
CREATE FUNCTION nft_metadata_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER nft_token_metadata_immutable
  BEFORE UPDATE OR DELETE ON nft_token_metadata
  FOR EACH ROW EXECUTE FUNCTION nft_metadata_immutable();

CREATE TRIGGER nft_metadata_images_immutable
  BEFORE UPDATE ON nft_metadata_images
  FOR EACH ROW EXECUTE FUNCTION nft_metadata_immutable();
