ALTER TABLE participants ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
ALTER TABLE participants ADD COLUMN password_salt TEXT;
ALTER TABLE participants ADD COLUMN password_hash TEXT;
UPDATE participants SET name_key = lower(trim(name));
CREATE UNIQUE INDEX participants_name ON participants(event_id, name_key);

CREATE TABLE participant_sessions (
  token_hash TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE
);
CREATE INDEX participant_sessions_person ON participant_sessions(participant_id);
-- Keep existing local browser sessions while replacing personal editing links.
INSERT INTO participant_sessions (token_hash, participant_id)
  SELECT edit_token_hash, id FROM participants;
ALTER TABLE participants DROP COLUMN edit_token_hash;
