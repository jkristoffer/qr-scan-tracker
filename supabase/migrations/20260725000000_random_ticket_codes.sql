CREATE OR REPLACE FUNCTION suggest_next_ticket_code(p_session_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := 'TKT-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20));
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM ticket_code_registry
      WHERE session_id = p_session_id
        AND code = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;
