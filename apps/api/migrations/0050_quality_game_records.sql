-- Keep legacy scores untouched; v2 has a separate comparable leaderboard.
ALTER TABLE play_runs DROP CONSTRAINT play_runs_rules_version_check;
ALTER TABLE play_runs ADD CONSTRAINT play_runs_rules_version_check CHECK (rules_version IN (1, 2));
ALTER TABLE play_records ADD COLUMN version2_best_score integer NOT NULL DEFAULT 0 CHECK (version2_best_score >= 0);
ALTER TABLE play_records ADD COLUMN version2_plays integer NOT NULL DEFAULT 0 CHECK (version2_plays >= 0);
