CREATE TABLE IF NOT EXISTS ticket_code_registry (
  session_id UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  PRIMARY KEY (session_id, code)
);

DO $$
DECLARE
  duplicate_summary TEXT;
BEGIN
  SELECT string_agg(format('%s/%s (%s rows)', session_id, barcode, duplicate_count), ', ')
  INTO duplicate_summary
  FROM (
    SELECT session_id, barcode, count(*) AS duplicate_count
    FROM items
    GROUP BY session_id, barcode
    HAVING count(*) > 1
    ORDER BY session_id, barcode
    LIMIT 10
  ) duplicates;

  IF duplicate_summary IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot install ticket code registry: duplicate items(session_id, barcode): %', duplicate_summary;
  END IF;
END $$;

INSERT INTO ticket_code_registry (session_id, code, item_id)
SELECT session_id, barcode, id
FROM items
ON CONFLICT (session_id, code) DO NOTHING;

DO $$
DECLARE
  missing_count BIGINT;
BEGIN
  SELECT count(*) INTO missing_count
  FROM items item
  LEFT JOIN ticket_code_registry registry
    ON registry.session_id = item.session_id
   AND registry.code = item.barcode
   AND registry.item_id = item.id
   AND registry.retired_at IS NULL
  WHERE registry.session_id IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot install ticket code registry: % item(s) lack a matching active registry reservation', missing_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_session_barcode_unique
  ON items(session_id, barcode);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_code_registry_active_item
  ON ticket_code_registry(session_id, item_id)
  WHERE retired_at IS NULL;

CREATE OR REPLACE FUNCTION reserve_item_ticket_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_code TEXT;
BEGIN
  normalized_code := btrim(NEW.barcode);
  IF normalized_code IS NULL OR normalized_code = '' THEN
    RAISE EXCEPTION 'Ticket code cannot be empty' USING ERRCODE = '22023';
  END IF;
  NEW.barcode := normalized_code;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO ticket_code_registry (session_id, code, item_id)
    VALUES (NEW.session_id, NEW.barcode, NEW.id);
  ELSIF NEW.barcode IS DISTINCT FROM OLD.barcode THEN
    UPDATE ticket_code_registry
    SET retired_at = now()
    WHERE session_id = OLD.session_id
      AND code = OLD.barcode
      AND item_id = OLD.id
      AND retired_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active ticket code reservation is missing for item %', OLD.id
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO ticket_code_registry (session_id, code, item_id)
    VALUES (NEW.session_id, NEW.barcode, NEW.id);

    NEW.qr_email_sent_at := NULL;
    NEW.qr_email_resend_id := NULL;
    NEW.qr_email_last_error := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reserve_item_ticket_code_trigger ON items;
CREATE TRIGGER reserve_item_ticket_code_trigger
BEFORE INSERT OR UPDATE OF barcode ON items
FOR EACH ROW EXECUTE FUNCTION reserve_item_ticket_code();

CREATE OR REPLACE FUNCTION replace_item_ticket_code(
  p_session_id UUID,
  p_item_id UUID,
  p_expected_code TEXT,
  p_new_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  current_item items%ROWTYPE;
  updated_item items%ROWTYPE;
  normalized_code TEXT;
BEGIN
  normalized_code := btrim(p_new_code);
  IF normalized_code IS NULL OR normalized_code = '' THEN
    RAISE EXCEPTION 'Ticket code cannot be empty' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_item
  FROM items
  WHERE id = p_item_id AND session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'item', NULL);
  END IF;

  IF current_item.barcode IS DISTINCT FROM p_expected_code THEN
    RETURN jsonb_build_object('status', 'stale', 'item', to_jsonb(current_item));
  END IF;

  BEGIN
    UPDATE items
    SET barcode = normalized_code
    WHERE id = p_item_id AND session_id = p_session_id
    RETURNING * INTO updated_item;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'code_unavailable', 'item', to_jsonb(current_item));
  END;

  RETURN jsonb_build_object('status', 'replaced', 'item', to_jsonb(updated_item));
END;
$$;

CREATE OR REPLACE FUNCTION suggest_next_ticket_code(p_session_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT 'TKT-' || lpad(next_value, greatest(4, length(next_value)), '0')
  FROM (
    SELECT (COALESCE(max(substring(code FROM 5)::NUMERIC), 0) + 1)::TEXT AS next_value
    FROM ticket_code_registry
    WHERE session_id = p_session_id
      AND code ~ '^TKT-[0-9]{4,}$'
  ) next_code;
$$;
