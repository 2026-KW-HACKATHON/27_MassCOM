-- 과거 원장은 계정·등급·수령 순서로 세 가지 꾸미기에 대응시킨다.
-- 재시도는 저장한 값을 읽으며 새 구매는 계정 잠금 안에서 미보유 항목을 선택한다.
ALTER TABLE mileage_spends ADD COLUMN cosmetic_bonus_id text;
WITH ordered AS (
  SELECT id, lower(grade) || '-' ||
    (ARRAY['hat','prop','decor'])[((row_number() OVER
      (PARTITION BY account_id,grade ORDER BY created_at,id) - 1) % 3 + 1)::integer] AS bonus_id
  FROM mileage_spends
)
UPDATE mileage_spends AS spend SET cosmetic_bonus_id = ordered.bonus_id
FROM ordered WHERE ordered.id = spend.id;
ALTER TABLE mileage_spends ALTER COLUMN cosmetic_bonus_id SET NOT NULL;
ALTER TABLE mileage_spends ADD CONSTRAINT mileage_spends_cosmetic_grade_check CHECK (
  cosmetic_bonus_id IN (lower(grade) || '-hat', lower(grade) || '-prop', lower(grade) || '-decor')
);
-- 이전 API의 INSERT도 지원한다. 구매 서비스는 기존 계정 수명 잠금을 먼저 잡는다.
-- 세 항목이 모두 있으면 과거 원장/직접 입력을 위해 결정적으로 순환한다.
CREATE FUNCTION assign_mileage_cosmetic_bonus() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cosmetic_bonus_id IS NULL THEN
    SELECT lower(NEW.grade) || '-' || suffix INTO NEW.cosmetic_bonus_id
    FROM unnest(ARRAY['hat','prop','decor']) WITH ORDINALITY AS candidate(suffix,position)
    WHERE NOT EXISTS (SELECT 1 FROM mileage_spends
      WHERE account_id = NEW.account_id AND grade = NEW.grade
        AND cosmetic_bonus_id = lower(NEW.grade) || '-' || candidate.suffix)
    ORDER BY position LIMIT 1;
    IF NEW.cosmetic_bonus_id IS NULL THEN
      SELECT lower(NEW.grade) || '-' || (ARRAY['hat','prop','decor'])[(count(*) % 3 + 1)::integer]
      INTO NEW.cosmetic_bonus_id FROM mileage_spends
      WHERE account_id = NEW.account_id AND grade = NEW.grade;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mileage_spends_cosmetic_bonus_assign BEFORE INSERT ON mileage_spends
FOR EACH ROW EXECUTE FUNCTION assign_mileage_cosmetic_bonus();
CREATE FUNCTION preserve_mileage_cosmetic_bonus() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cosmetic_bonus_id IS DISTINCT FROM OLD.cosmetic_bonus_id THEN
    RAISE EXCEPTION 'recorded cosmetic bonus is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mileage_spends_cosmetic_bonus_immutable BEFORE UPDATE ON mileage_spends
FOR EACH ROW EXECUTE FUNCTION preserve_mileage_cosmetic_bonus();
