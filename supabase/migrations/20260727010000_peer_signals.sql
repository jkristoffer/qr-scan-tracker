CREATE TABLE IF NOT EXISTS peer_signals (
  signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  recipient_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('hello', 'offer', 'answer')),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_peer_signals_session_created_at
  ON peer_signals(session_id, created_at DESC);

ALTER TABLE peer_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS peer_signals_recent_read ON peer_signals;
CREATE POLICY peer_signals_recent_read ON peer_signals
  FOR SELECT TO anon, authenticated
  USING (created_at > NOW() - INTERVAL '5 minutes');

DROP POLICY IF EXISTS peer_signals_recent_insert ON peer_signals;
CREATE POLICY peer_signals_recent_insert ON peer_signals
  FOR INSERT TO anon, authenticated
  WITH CHECK (created_at > NOW() - INTERVAL '1 minute');

GRANT SELECT, INSERT ON peer_signals TO anon, authenticated;
REVOKE DELETE ON peer_signals FROM anon, authenticated;
