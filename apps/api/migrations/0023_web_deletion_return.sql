ALTER TABLE web_oauth_states DROP CONSTRAINT web_oauth_states_return_to_check;
ALTER TABLE web_oauth_states ADD CONSTRAINT web_oauth_states_return_to_check
  CHECK (return_to IN ('/app/', '/admin/', '/account-deletion'));
