CREATE TABLE scan_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  gate_name TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE
);
