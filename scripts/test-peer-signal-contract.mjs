import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260727010000_peer_signals.sql', 'utf8').toLowerCase();
const runtime = readFileSync('lib/migrate.ts', 'utf8').toLowerCase();
const client = readFileSync('lib/peerSync.ts', 'utf8');
const required = [
  'create table if not exists peer_signals',
  "kind in ('hello', 'offer', 'answer')",
  'idx_peer_signals_session_created_at',
  'alter table peer_signals enable row level security',
  'grant select, insert on peer_signals to anon, authenticated',
  'revoke delete on peer_signals from anon, authenticated',
];

for (const token of required) {
  if (!migration.includes(token) || !runtime.includes(token)) throw new Error(`Peer signaling migration parity missing ${token}`);
}
if (!client.includes('listPeerSignals') || !client.includes('signalPollTimer')) throw new Error('HTTPS polling fallback is not wired.');
console.log('PASS: peer signaling schema and runtime migration match, with HTTPS polling fallback enabled.');
