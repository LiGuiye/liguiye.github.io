CREATE TABLE organizer_profiles (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE events ADD COLUMN owner_id TEXT REFERENCES organizer_profiles(id);
CREATE INDEX events_owner ON events(owner_id);
ALTER TABLE events DROP COLUMN admin_token_hash;
ALTER TABLE organizer_sessions ADD COLUMN organizer_id TEXT REFERENCES organizer_profiles(id) ON DELETE CASCADE;
CREATE INDEX organizer_sessions_profile ON organizer_sessions(organizer_id);
ALTER TABLE organizer_login_attempts ADD COLUMN kind TEXT NOT NULL DEFAULT 'login';
CREATE INDEX organizer_attempts_kind_ip_time ON organizer_login_attempts(kind, ip, attempted_at);
