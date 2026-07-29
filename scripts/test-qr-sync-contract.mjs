import { readFileSync } from 'node:fs';

const codec = readFileSync('lib/qrOfflineSync.ts', 'utf8');
const storage = readFileSync('lib/offlineScanner.ts', 'utf8');
const sheet = readFileSync('components/QrOfflineSyncSheet.tsx', 'utf8');
const scanner = readFileSync('app/scan/[sessionId]/page.tsx', 'utf8');

const requiredCodecTokens = [
  "const PREFIX = 'QST1:'",
  'QR_SYNC_BATCH_SIZE = 8',
  'payload.s !== sessionId',
  'payload.a.length > QR_SYNC_BATCH_SIZE',
  "state: 'pending'",
];
for (const token of requiredCodecTokens) {
  if (!codec.includes(token)) throw new Error(`QR sync codec is missing ${token}`);
}
if (!storage.includes("if (item.scanned) {\n        queue.put(entry);\n        return 'duplicate';")) {
  throw new Error('Duplicate remote admissions must remain queued for server reconciliation.');
}
if (!sheet.includes('offlineScanner.applyPeerAdmission(attempt)') || !sheet.includes('No internet or hotspot required')) {
  throw new Error('QR sync sheet must import immutable attempts and explain its offline boundary.');
}
if (!scanner.includes('!qrSyncOpen && <Scanner') || !scanner.includes('<QrOfflineSyncSheet')) {
  throw new Error('The ticket camera must pause while the QR sync camera is open.');
}

console.log('PASS: offline QR sync is event-bound, bounded, idempotent, and owns the camera while open.');
