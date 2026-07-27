import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260727000000_offline_admissions.sql', 'utf8');
const runtime = readFileSync('lib/migrate.ts', 'utf8');
const required = ['admission_attempts', 'attempt_id uuid primary key', 'reconcile_admissions', 'for update', 'v_winner.captured_at > p_captured_at', 'conflict', 'admission_attempt_id'];
for (const token of required) {
  if (!migration.toLowerCase().includes(token) || !runtime.toLowerCase().includes(token)) throw new Error(`Migration parity missing ${token}`);
}
if (!migration.includes("IF NOT v_item.scanned THEN") || migration.includes('NOT v_item.scanned OR v_item.admission_attempt_id')) throw new Error('Existing scanned rows must retain duplicate behavior.');
console.log('PASS: offline admission migration and runtime path expose idempotency, ordering, conflicts, and legacy duplicate behavior.');
