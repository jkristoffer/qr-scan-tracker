-- Scan Sessions
CREATE TABLE IF NOT EXISTS scan_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Items
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    name TEXT NOT NULL,
    scanned BOOLEAN DEFAULT FALSE,
    scanned_at TIMESTAMP WITH TIME ZONE,
    scanned_by TEXT,
    UNIQUE(session_id, barcode)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_items_session ON items(session_id);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
CREATE INDEX IF NOT EXISTS idx_items_scanned ON items(scanned);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE items;
