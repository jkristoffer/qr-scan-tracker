ALTER TABLE items ADD COLUMN IF NOT EXISTS admission_attempt_id UUID;

CREATE TABLE IF NOT EXISTS admission_attempts (
  attempt_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  gate_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('camera', 'manual')),
  captured_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('admitted', 'duplicate', 'conflict', 'not_found')),
  winner_attempt_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admission_attempts_item_captured_at ON admission_attempts(item_id, captured_at);

CREATE OR REPLACE FUNCTION undo_item_check_in(p_session_id UUID, p_item_id UUID, p_expected_scanned_at TIMESTAMPTZ, p_actor_label TEXT, p_source TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_item items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM items WHERE id=p_item_id AND session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','item',null); END IF;
  IF NOT v_item.scanned OR v_item.scanned_at IS DISTINCT FROM p_expected_scanned_at THEN RETURN jsonb_build_object('status','stale','item',to_jsonb(v_item)); END IF;
  UPDATE items SET scanned=false, scanned_at=null, scanned_by=null, admission_attempt_id=null WHERE id=p_item_id AND session_id=p_session_id RETURNING * INTO v_item;
  INSERT INTO scan_attempts(item_id,session_id,gate_name,is_duplicate,event_type,source) VALUES(p_item_id,p_session_id,coalesce(nullif(trim(p_actor_label),''),'Manage'),false,'undo_check_in',p_source);
  RETURN jsonb_build_object('status','undone','item',to_jsonb(v_item));
END; $$;

CREATE OR REPLACE FUNCTION reconcile_admissions(
  p_session_id UUID, p_item_id UUID, p_attempt_id UUID, p_gate_name TEXT, p_source TEXT, p_captured_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_item items%ROWTYPE; v_existing admission_attempts%ROWTYPE; v_winner admission_attempts%ROWTYPE; v_outcome TEXT;
BEGIN
  IF p_source NOT IN ('camera', 'manual') OR p_captured_at IS NULL THEN RAISE EXCEPTION 'Invalid admission input' USING errcode = '22023'; END IF;
  SELECT * INTO v_existing FROM admission_attempts WHERE attempt_id = p_attempt_id;
  IF FOUND THEN
    SELECT * INTO v_item FROM items WHERE id = v_existing.item_id;
    SELECT * INTO v_winner FROM admission_attempts WHERE attempt_id = v_existing.winner_attempt_id;
    RETURN jsonb_build_object('item', to_jsonb(v_item), 'outcome', v_existing.outcome, 'winnerCapturedAt', v_winner.captured_at, 'winnerGateName', v_winner.gate_name);
  END IF;
  SELECT * INTO v_item FROM items WHERE id = p_item_id AND session_id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_item.removed THEN
    INSERT INTO admission_attempts(attempt_id,session_id,item_id,gate_name,source,captured_at,outcome) VALUES(p_attempt_id,p_session_id,p_item_id,coalesce(nullif(btrim(p_gate_name),''),'Gate'),p_source,p_captured_at,'not_found');
    RETURN jsonb_build_object('item', null, 'outcome', 'not_found');
  END IF;
  IF NOT v_item.scanned THEN
    UPDATE items SET scanned=true, scanned_at=p_captured_at, scanned_by=coalesce(nullif(btrim(p_gate_name),''),'Gate'), admission_attempt_id=p_attempt_id WHERE id=p_item_id RETURNING * INTO v_item;
    INSERT INTO admission_attempts(attempt_id,session_id,item_id,gate_name,source,captured_at,outcome,winner_attempt_id) VALUES(p_attempt_id,p_session_id,p_item_id,v_item.scanned_by,p_source,p_captured_at,'admitted',p_attempt_id);
    RETURN jsonb_build_object('item', to_jsonb(v_item), 'outcome', 'admitted');
  END IF;
  IF v_item.admission_attempt_id IS NULL THEN
    INSERT INTO admission_attempts(attempt_id,session_id,item_id,gate_name,source,captured_at,outcome) VALUES(p_attempt_id,p_session_id,p_item_id,coalesce(nullif(btrim(p_gate_name),''),'Gate'),p_source,p_captured_at,'duplicate');
    RETURN jsonb_build_object('item', to_jsonb(v_item), 'outcome', 'duplicate');
  END IF;
  SELECT * INTO v_winner FROM admission_attempts WHERE attempt_id = v_item.admission_attempt_id;
  IF v_winner.captured_at > p_captured_at THEN
    UPDATE admission_attempts SET outcome='conflict', winner_attempt_id=p_attempt_id WHERE attempt_id=v_winner.attempt_id;
    UPDATE items SET scanned_at=p_captured_at, scanned_by=coalesce(nullif(btrim(p_gate_name),''),'Gate'), admission_attempt_id=p_attempt_id WHERE id=p_item_id RETURNING * INTO v_item;
    INSERT INTO admission_attempts(attempt_id,session_id,item_id,gate_name,source,captured_at,outcome,winner_attempt_id) VALUES(p_attempt_id,p_session_id,p_item_id,v_item.scanned_by,p_source,p_captured_at,'admitted',p_attempt_id);
    RETURN jsonb_build_object('item', to_jsonb(v_item), 'outcome', 'admitted');
  END IF;
  INSERT INTO admission_attempts(attempt_id,session_id,item_id,gate_name,source,captured_at,outcome,winner_attempt_id) VALUES(p_attempt_id,p_session_id,p_item_id,coalesce(nullif(btrim(p_gate_name),''),'Gate'),p_source,p_captured_at,'conflict',v_winner.attempt_id);
  RETURN jsonb_build_object('item', to_jsonb(v_item), 'outcome', 'conflict', 'winnerCapturedAt', v_winner.captured_at, 'winnerGateName', v_winner.gate_name);
END; $$;
