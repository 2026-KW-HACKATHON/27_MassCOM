ALTER TABLE web_oauth_states
  ADD COLUMN return_to text NOT NULL DEFAULT '/app/' CHECK (return_to IN ('/app/', '/admin/'));
