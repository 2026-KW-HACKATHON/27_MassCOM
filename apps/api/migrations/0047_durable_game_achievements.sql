-- 실행 입력은 30일 뒤 삭제해도 획득한 성취는 계정 삭제 때까지 유지한다.
ALTER TABLE play_records
  ADD COLUMN skill_progress integer NOT NULL DEFAULT 0 CHECK (skill_progress >= 0),
  ADD COLUMN skill_achieved boolean NOT NULL DEFAULT false;

INSERT INTO play_records (account_id, kind, best_score, plays, skill_progress, skill_achieved)
SELECT account_id, kind, 0, 0,
  coalesce(max((result->'skill'->>'progress')::integer)
    FILTER (WHERE result->'skill'->>'progress' ~ '^[0-9]{1,2}$'), 0),
  coalesce(bool_or(result->'skill'->>'achieved' = 'true'), false)
FROM play_runs WHERE result IS NOT NULL GROUP BY account_id, kind
ON CONFLICT (account_id, kind) DO UPDATE SET
  skill_progress = greatest(play_records.skill_progress, excluded.skill_progress),
  skill_achieved = play_records.skill_achieved OR excluded.skill_achieved;

-- 롤백 시 추가 열과 기존 성취를 유지한다. 이전 API는 이 열을 읽거나 덮어쓰지 않는다.
