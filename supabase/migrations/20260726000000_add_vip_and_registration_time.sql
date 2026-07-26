ALTER TABLE items
  ADD COLUMN IF NOT EXISTS "isVIP" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE;

UPDATE items
SET created_at = COALESCE(items.created_at, scan_sessions.created_at, NOW())
FROM scan_sessions
WHERE items.session_id = scan_sessions.id
  AND items.created_at IS NULL;

UPDATE items
SET created_at = NOW()
WHERE created_at IS NULL;

ALTER TABLE items
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_items_session_created_at
  ON items(session_id, created_at);
