CREATE TABLE IF NOT EXISTS scan_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  gate_name TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE scan_attempts
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE scan_attempts
SET event_type = CASE WHEN is_duplicate THEN 'duplicate' ELSE 'check_in' END
WHERE event_type IS NULL;

UPDATE scan_attempts
SET source = 'camera'
WHERE source IS NULL;

ALTER TABLE scan_attempts
  ALTER COLUMN event_type SET DEFAULT 'check_in',
  ALTER COLUMN event_type SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'camera',
  ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'scan_attempts'::regclass
      AND conname = 'scan_attempts_event_type_check'
  ) THEN
    ALTER TABLE scan_attempts
      ADD CONSTRAINT scan_attempts_event_type_check
      CHECK (event_type IN ('check_in', 'duplicate', 'undo_check_in'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'scan_attempts'::regclass
      AND conname = 'scan_attempts_source_check'
  ) THEN
    ALTER TABLE scan_attempts
      ADD CONSTRAINT scan_attempts_source_check
      CHECK (source IN ('camera', 'manual', 'manage'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION undo_item_check_in(
  p_session_id UUID,
  p_item_id UUID,
  p_expected_scanned_at TIMESTAMPTZ,
  p_actor_label TEXT,
  p_source TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item items%ROWTYPE;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('camera', 'manual', 'manage') THEN
    RAISE EXCEPTION 'Invalid check-in source: %', p_source
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM items
  WHERE id = p_item_id AND session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'item', NULL);
  END IF;

  IF NOT v_item.scanned OR v_item.scanned_at IS DISTINCT FROM p_expected_scanned_at THEN
    RETURN jsonb_build_object('status', 'stale', 'item', to_jsonb(v_item));
  END IF;

  UPDATE items
  SET scanned = FALSE,
      scanned_at = NULL,
      scanned_by = NULL
  WHERE id = p_item_id AND session_id = p_session_id
  RETURNING * INTO v_item;

  INSERT INTO scan_attempts (
    item_id, session_id, gate_name, is_duplicate, event_type, source
  ) VALUES (
    p_item_id, p_session_id, COALESCE(NULLIF(trim(p_actor_label), ''), 'Manage'),
    FALSE, 'undo_check_in', p_source
  );

  RETURN jsonb_build_object('status', 'undone', 'item', to_jsonb(v_item));
END;
$$;
