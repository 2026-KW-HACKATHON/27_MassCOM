-- NFT 시리즈 발행 수량 상한을 없앤다(2026-10-08 소유자 결정). API는 더 이상 max_ever_minted를 읽지 않는다.
-- 새 API는 이 열을 읽지 않으므로 옛 스키마에서도 동작한다. 옛 API를 위해 열은 지우지 않고 NOT NULL만 푼다.
-- 옛 API는 NULL 상한 행을 CAPACITY_UNAVAILABLE로 거절하므로 새 API가 모든 인스턴스에 배포된 뒤에만 NULL 행을 넣는다.
-- 옛 API로 롤백하려면 integer 열을 numeric(20,0)으로 넓히고 NULL 행을 uint64 최댓값(18446744073709551615)으로 채운 뒤 SET NOT NULL 한다.
-- 열 삭제는 새 API가 모두 배포된 뒤 별도 migration에서 한다. 운영·시연 DB에는 nft_series 행이 없다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE nft_series
  ALTER COLUMN max_ever_minted DROP NOT NULL;

COMMENT ON COLUMN nft_series.max_ever_minted IS
  '폐기됨(0075): 발행 수량 상한이 없다. 새 시리즈는 NULL로 두고 API는 읽지 않는다.';
