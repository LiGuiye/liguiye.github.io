CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL,
  admin_token_hash TEXT NOT NULL,
  slot_revision INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  UNIQUE(event_id, start_utc)
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  edit_token_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  mutation_id TEXT NOT NULL,
  last_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX participants_event ON participants(event_id);

CREATE TABLE availability (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  available INTEGER NOT NULL CHECK(available IN (0, 1)),
  PRIMARY KEY(participant_id, slot_id)
);
CREATE INDEX availability_slot ON availability(slot_id);
