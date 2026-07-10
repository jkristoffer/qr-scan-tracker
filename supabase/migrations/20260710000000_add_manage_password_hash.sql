ALTER TABLE scan_sessions
ADD COLUMN IF NOT EXISTS manage_password_hash TEXT;
