CREATE INDEX auth_sessions_expires_at ON auth_sessions (expires_at);

CREATE INDEX auth_sessions_revoked_at ON auth_sessions (revoked_at)
  WHERE revoked_at IS NOT NULL;
