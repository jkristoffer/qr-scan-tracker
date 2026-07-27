import type { Item, ScanSession } from './types';

export type AdmissionSyncState = 'confirmed' | 'pending' | 'conflict';
export type OfflineItem = Pick<Item, 'id' | 'session_id' | 'barcode' | 'name' | 'isVIP' | 'scanned' | 'scanned_at' | 'scanned_by' | 'removed' | 'created_at'>;
export interface PreparedScanner { session: Pick<ScanSession, 'id' | 'name' | 'created_at' | 'archived'>; preparedAt: string; items: OfflineItem[]; }
export interface QueuedAdmission { attemptId: string; sessionId: string; itemId: string; gateName: string; source: 'camera' | 'manual'; capturedAt: string; state: AdmissionSyncState; }
export interface ConflictNotice { attemptId: string; sessionId: string; itemId: string; capturedAt: string; gateName: string; winnerCapturedAt: string; winnerGateName: string; }

const DB = 'gate-scanner-offline';
const VERSION = 1;
const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('snapshots', { keyPath: 'session.id' });
    const queue = db.createObjectStore('queue', { keyPath: 'attemptId' });
    queue.createIndex('sessionId', 'sessionId');
    const conflicts = db.createObjectStore('conflicts', { keyPath: 'attemptId' });
    conflicts.createIndex('sessionId', 'sessionId');
    db.createObjectStore('meta', { keyPath: 'key' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await open(); const tx = db.transaction(stores, mode);
  try { const result = await work(tx); await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); return result; } finally { db.close(); }
}

export const offlineScanner = {
  async prepare(session: PreparedScanner['session'], items: Item[]) {
    const snapshot: PreparedScanner = { session, preparedAt: new Date().toISOString(), items: items.filter(item => !item.removed).map(({ email, qr_email_sent_at, qr_email_resend_id, qr_email_last_error, ...item }) => item) };
    await transaction(['snapshots', 'meta'], 'readwrite', async tx => { tx.objectStore('snapshots').put(snapshot); tx.objectStore('meta').put({ key: 'lastSessionId', value: session.id }); });
    return snapshot;
  },
  async get(sessionId: string): Promise<PreparedScanner | null> { return (await transaction(['snapshots'], 'readonly', tx => request(tx.objectStore('snapshots').get(sessionId)))) || null; },
  async lastSessionId(): Promise<string | null> { const value = await transaction(['meta'], 'readonly', tx => request<any>(tx.objectStore('meta').get('lastSessionId'))); return value?.value || null; },
  async queueAdmission(entry: QueuedAdmission): Promise<boolean> {
    return transaction(['snapshots', 'queue'], 'readwrite', async tx => {
      const snapshot = await request<PreparedScanner | undefined>(tx.objectStore('snapshots').get(entry.sessionId));
      if (!snapshot) return false;
      const item = snapshot.items.find(candidate => candidate.id === entry.itemId);
      if (!item || item.scanned) return false;
      item.scanned = true; item.scanned_at = entry.capturedAt; item.scanned_by = entry.gateName;
      tx.objectStore('snapshots').put(snapshot); tx.objectStore('queue').put(entry); return true;
    });
  },
  async pending(sessionId: string): Promise<QueuedAdmission[]> { return transaction(['queue'], 'readonly', tx => request(tx.objectStore('queue').index('sessionId').getAll(sessionId))); },
  async removeAttempt(attemptId: string) { await transaction(['queue'], 'readwrite', async tx => { tx.objectStore('queue').delete(attemptId); }); },
  async undoPending(sessionId: string, itemId: string): Promise<boolean> {
    return transaction(['snapshots', 'queue'], 'readwrite', async tx => {
      const entries = await request<QueuedAdmission[]>(tx.objectStore('queue').index('sessionId').getAll(sessionId)); const entry = entries.find(candidate => candidate.itemId === itemId);
      if (!entry) return false;
      const snapshot = await request<PreparedScanner | undefined>(tx.objectStore('snapshots').get(sessionId)); const item = snapshot?.items.find(candidate => candidate.id === itemId);
      if (snapshot && item) { item.scanned = false; item.scanned_at = null; item.scanned_by = null; tx.objectStore('snapshots').put(snapshot); }
      tx.objectStore('queue').delete(entry.attemptId); return true;
    });
  },
  async recordConflict(notice: ConflictNotice) { await transaction(['conflicts'], 'readwrite', async tx => { tx.objectStore('conflicts').put(notice); }); },
  async conflicts(sessionId: string): Promise<ConflictNotice[]> { return transaction(['conflicts'], 'readonly', tx => request(tx.objectStore('conflicts').index('sessionId').getAll(sessionId))); },
  async mergeItem(sessionId: string, item: Item) { await transaction(['snapshots'], 'readwrite', async tx => { const snapshot = await request<PreparedScanner | undefined>(tx.objectStore('snapshots').get(sessionId)); const target = snapshot?.items.find(candidate => candidate.id === item.id); if (snapshot && target) { Object.assign(target, item); delete (target as any).email; tx.objectStore('snapshots').put(snapshot); } }); },
  async clear(sessionId: string) { await transaction(['snapshots', 'queue', 'conflicts'], 'readwrite', async tx => { const pending = await request<QueuedAdmission[]>(tx.objectStore('queue').index('sessionId').getAll(sessionId)); if (pending.length) throw new Error('Pending admissions must sync before clearing offline data'); tx.objectStore('snapshots').delete(sessionId); for (const conflict of await request<ConflictNotice[]>(tx.objectStore('conflicts').index('sessionId').getAll(sessionId))) tx.objectStore('conflicts').delete(conflict.attemptId); }); },
};
