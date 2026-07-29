import QRCode from 'qrcode';
import type { QueuedAdmission } from './offlineScanner';

const PREFIX = 'QST1:';
export const QR_SYNC_BATCH_SIZE = 8;

type CompactAdmission = [
  attemptId: string,
  itemId: string,
  gateName: string,
  source: QueuedAdmission['source'],
  capturedAt: string,
];

interface QrSyncPayload {
  v: 1;
  s: string;
  p: number;
  t: number;
  a: CompactAdmission[];
}

export function encodeQrSyncPage(sessionId: string, attempts: QueuedAdmission[], page: number, total: number) {
  const payload: QrSyncPayload = {
    v: 1,
    s: sessionId,
    p: page,
    t: total,
    a: attempts.map(entry => [entry.attemptId, entry.itemId, entry.gateName, entry.source, entry.capturedAt]),
  };
  return PREFIX + JSON.stringify(payload);
}

export function decodeQrSyncPage(value: string, sessionId: string) {
  if (typeof value !== 'string' || value.length > 12_000 || !value.startsWith(PREFIX)) throw new Error('This is not a scanner sync QR.');
  let payload: QrSyncPayload;
  try {
    payload = JSON.parse(value.slice(PREFIX.length)) as QrSyncPayload;
  } catch {
    throw new Error('This scanner sync QR is invalid.');
  }
  if (payload.v !== 1 || payload.s !== sessionId) throw new Error('This QR belongs to another event.');
  if (!Number.isInteger(payload.p) || !Number.isInteger(payload.t) || payload.p < 1 || payload.t < payload.p || payload.t > 10_000 || !Array.isArray(payload.a) || payload.a.length > QR_SYNC_BATCH_SIZE) throw new Error('This scanner sync QR is invalid.');
  const attempts: QueuedAdmission[] = payload.a.map(row => {
    if (
      !Array.isArray(row)
      || row.length !== 5
      || typeof row[0] !== 'string'
      || row[0].length < 1
      || row[0].length > 128
      || typeof row[1] !== 'string'
      || row[1].length < 1
      || row[1].length > 128
      || typeof row[2] !== 'string'
      || row[2].length < 1
      || row[2].length > 120
      || !['camera', 'manual'].includes(row[3])
      || typeof row[4] !== 'string'
      || row[4].length > 40
      || Number.isNaN(Date.parse(row[4]))
    ) throw new Error('This scanner sync QR is invalid.');
    return { attemptId: row[0], sessionId, itemId: row[1], gateName: row[2], source: row[3], capturedAt: row[4], state: 'pending' };
  });
  return { attempts, page: payload.p, total: payload.t };
}

export function toQrSyncDataUrl(value: string) {
  return QRCode.toDataURL(value, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'L',
    color: { dark: '#161618', light: '#ffffff' },
  });
}
