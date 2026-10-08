-- 일반 상자의 신규 보상 계약. 기존 COIN/CHARACTER 영수증과 대표 선택은 유지한다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE grade_draws ADD COLUMN rarity text CHECK (rarity IN ('BRONZE','SILVER','GOLD','PLATINUM'));
ALTER TABLE grade_draws ADD COLUMN reward_amount integer CHECK (reward_amount > 0);
ALTER TABLE grade_draws DROP CONSTRAINT grade_draws_reward_kind_check;
ALTER TABLE grade_draws ADD CONSTRAINT grade_draws_reward_kind_check
  CHECK (reward_kind IN ('COIN','CHARACTER','THEME','REROLL_TICKET','MILEAGE','FURNITURE'));
ALTER TABLE grade_draws DROP CONSTRAINT grade_draws_check;
ALTER TABLE grade_draws ADD CONSTRAINT grade_draws_check CHECK (
  (reward_kind = 'COIN' AND item_id IS NULL AND publication_id IS NOT NULL AND grade_id IS NOT NULL
    AND rarity IS NULL AND reward_amount IS NULL)
  OR (reward_kind IN ('CHARACTER','THEME') AND item_id IS NOT NULL AND publication_id IS NULL AND grade_id IS NULL
    AND reward_amount IS NULL)
  OR (reward_kind IN ('REROLL_TICKET','FURNITURE') AND item_id IS NOT NULL AND publication_id IS NULL
    AND grade_id IS NULL AND rarity IS NOT NULL AND reward_amount IS NULL)
  OR (reward_kind = 'MILEAGE' AND item_id IS NOT NULL AND publication_id IS NULL AND grade_id IS NULL
    AND rarity IS NOT NULL AND reward_amount IS NOT NULL)
);
