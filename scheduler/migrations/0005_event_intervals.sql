ALTER TABLE events ADD COLUMN slot_minutes INTEGER NOT NULL DEFAULT 15
  CHECK(slot_minutes IN (15, 30, 60));
