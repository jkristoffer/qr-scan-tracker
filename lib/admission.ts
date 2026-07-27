import { db } from './supabase';
import { offlineScanner, type AdmissionSyncState, type QueuedAdmission } from './offlineScanner';
import type { CheckInSource, Item, ScanResult } from './types';

export type AdmissionInput = { sessionId: string; itemId: string; attemptId: string; gateName: string; source: Extract<CheckInSource, 'camera' | 'manual'>; capturedAt: string };
export type AdmissionResult = { item: Item | null; outcome: 'admitted' | 'duplicate' | 'conflict' | 'not_found'; winnerCapturedAt?: string; winnerGateName?: string };
const uuid = () => crypto.randomUUID();

export async function reconcileAdmission(input: AdmissionInput): Promise<AdmissionResult> { return db.reconcileAdmission(input); }

function result(item: Item, state: AdmissionSyncState, type: ScanResult['type'] = 'success', message = item.name): ScanResult { return { success: type === 'success', item, message, type, syncState: state }; }

export async function admitKnownItem(item: Item, input: Omit<AdmissionInput, 'itemId' | 'attemptId' | 'capturedAt'>): Promise<ScanResult> {
  const attempt: QueuedAdmission = { ...input, itemId: item.id, attemptId: uuid(), capturedAt: new Date().toISOString(), state: 'pending' };
  const queued = await offlineScanner.queueAdmission(attempt);
  if (!queued) {
    if (!navigator.onLine) return item.scanned ? result(item, 'confirmed', 'duplicate', `Already checked in${item.scanned_by ? ` · ${item.scanned_by}` : ''}`) : { success: false, message: 'Prepare this event while connected before scanning offline.', type: 'not_found' };
    const synced = await reconcileAdmission(attempt);
    if (synced.outcome === 'admitted') return result(synced.item || item, 'confirmed');
    if (synced.outcome === 'conflict') return result(synced.item || item, 'conflict', 'duplicate', 'Admission lost reconciliation');
    return result(synced.item || item, 'confirmed', 'duplicate', 'Already checked in');
  }
  const provisional: Item = { ...item, scanned: true, scanned_at: attempt.capturedAt, scanned_by: attempt.gateName };
  if (!navigator.onLine) return result(provisional, 'pending', 'success', `${item.name} · Pending sync`);
  try {
    const synced = await reconcileAdmission(attempt);
    if (synced.item) await offlineScanner.mergeItem(input.sessionId, synced.item);
    await offlineScanner.removeAttempt(attempt.attemptId);
    if (synced.outcome === 'admitted') return result(synced.item || provisional, 'confirmed');
    if (synced.outcome === 'conflict') { await offlineScanner.recordConflict({ attemptId: attempt.attemptId, sessionId: input.sessionId, itemId: item.id, capturedAt: attempt.capturedAt, gateName: attempt.gateName, winnerCapturedAt: synced.winnerCapturedAt || '', winnerGateName: synced.winnerGateName || '' }); return result(synced.item || provisional, 'conflict', 'duplicate', 'Admission lost reconciliation'); }
    return result(synced.item || provisional, 'confirmed', 'duplicate', 'Already checked in');
  } catch { return result(provisional, 'pending', 'success', `${item.name} · Pending sync`); }
}

export async function flushAdmissions(sessionId: string): Promise<AdmissionResult[]> {
  const results: AdmissionResult[] = [];
  for (const attempt of await offlineScanner.pending(sessionId)) {
    try { const synced = await reconcileAdmission(attempt); results.push(synced); if (synced.item) await offlineScanner.mergeItem(sessionId, synced.item); if (synced.outcome === 'conflict') await offlineScanner.recordConflict({ attemptId: attempt.attemptId, sessionId, itemId: attempt.itemId, capturedAt: attempt.capturedAt, gateName: attempt.gateName, winnerCapturedAt: synced.winnerCapturedAt || '', winnerGateName: synced.winnerGateName || '' }); await offlineScanner.removeAttempt(attempt.attemptId); } catch { break; }
  }
  return results;
}
