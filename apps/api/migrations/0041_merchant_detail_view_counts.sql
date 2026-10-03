-- 개인 식별자 없이 공개 점포 상세의 날짜·유입 경로별 열람 횟수만 보관한다.
CREATE TABLE merchant_detail_view_counts (
  merchant_id text NOT NULL REFERENCES merchants(id),
  business_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('list', 'map', 'recommendation', 'collection', 'friend', 'link', 'other')),
  views integer NOT NULL CHECK (views > 0),
  PRIMARY KEY (merchant_id, business_date, source)
);
