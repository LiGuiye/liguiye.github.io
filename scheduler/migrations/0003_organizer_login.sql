CREATE TABLE organizer_sessions (
  token_hash TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX organizer_sessions_expiry ON organizer_sessions(expires_at);

CREATE TABLE organizer_login_attempts (
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX organizer_attempts_ip_time ON organizer_login_attempts(ip, attempted_at);
CREATE INDEX organizer_attempts_expiry ON organizer_login_attempts(attempted_at);
