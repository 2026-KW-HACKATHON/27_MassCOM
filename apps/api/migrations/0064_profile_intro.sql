ALTER TABLE explorer_profiles ADD COLUMN intro text NOT NULL DEFAULT '';
ALTER TABLE explorer_profiles ADD CONSTRAINT explorer_profile_intro_length CHECK (char_length(intro) <= 30);
