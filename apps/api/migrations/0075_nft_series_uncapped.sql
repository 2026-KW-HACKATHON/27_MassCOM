-- NFT 시리즈 발행 수량 상한을 없앤다(2026-10-08 소유자 결정). API는 더 이상 max_ever_minted를 읽지 않는다.
-- 배포된 API(상한 검사 있음)가 migration 뒤에도 돌 수 있도록 열은 지우지 않고 NOT NULL만 푼다.
-- 열 삭제는 새 API가 모두 배포된 뒤 별도 migration에서 한다. 운영·시연 DB에는 nft_series 행이 없다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE nft_series
  ALTER COLUMN max_ever_minted DROP NOT NULL;

COMMENT ON COLUMN nft_series.max_ever_minted IS
  '폐기됨(0075): 발행 수량 상한이 없다. 새 시리즈는 NULL로 두고 API는 읽지 않는다.';
