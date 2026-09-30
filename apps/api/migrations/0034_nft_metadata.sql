-- Issue #254: NFT 메타데이터(가게 이름·동네·업종·방문 단계·가게 그림)를 발행 확정 때 고정한다.
-- 배포된 API(d004d7f)가 이 스키마에서 그대로 동작하도록 NULL 열·새 표·NOT VALID CHECK만 더한다(migration이 API 교체보다 먼저 돈다).
-- 병렬 브랜치의 0033과 겹치는 표·열이 없어 적용 순서와 무관하다.

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

-- 시리즈 id는 공개 메타데이터 경로(/nft-metadata/<id>/<tokenId>.json)에 그대로 쓰인다. 정적 실증 경로와 겹치지 않게 한다.
-- 운영·시연 DB에는 시리즈 행이 없지만 수동으로 만든 행이 있어도 migration이 실패하지 않도록 새 행만 검사한다.
ALTER TABLE nft_series
  ADD CONSTRAINT nft_series_metadata_path_check
  CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' AND id <> 'base-sepolia-proof') NOT VALID;

-- 스냅샷 때 복사한 가게 그림. 파일 이름이 내용의 sha256이라 가게가 그림을 바꾸거나 되돌려도 이미 발행한 토큰의 그림은 남는다.
CREATE TABLE nft_metadata_images (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  image bytea NOT NULL CHECK (octet_length(image) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 발행 확정(finalize) 트랜잭션에서 한 번 쓰는 토큰 메타데이터. metadata_json은 공개 응답 바이트 그대로다(jsonb는 키 순서를 바꾼다).
CREATE TABLE nft_token_metadata (
  nft_asset_id uuid PRIMARY KEY REFERENCES nft_assets(id),
  nft_series_id text NOT NULL REFERENCES nft_series(id),
  token_id numeric(78, 0) NOT NULL CHECK (token_id >= 0),
  metadata_json text NOT NULL CHECK (jsonb_typeof(metadata_json::jsonb) = 'object'),
  image_sha256 text REFERENCES nft_metadata_images(sha256),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nft_series_id, token_id)
);

-- 한 번 쓴 메타데이터와 그림은 바꾸거나 지우지 않는다. TRUNCATE는 행 트리거를 타지 않는다(시험 초기화용).
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
  BEFORE UPDATE OR DELETE ON nft_metadata_images
  FOR EACH ROW EXECUTE FUNCTION nft_metadata_immutable();
