import { db } from '@/lib/supabase';
import type { CheckInSource, Item, ScanResult } from '@/lib/types';

function logAttempt(
  itemId: string,
  sessionId: string,
  gateName: string,
  isDuplicate: boolean,
  source: Extract<CheckInSource, 'camera' | 'manual'>
) {
  void db.logScanAttempt(itemId, sessionId, gateName, isDuplicate, source).catch(() => {
    // Attempt telemetry must never change the admission result shown to the operator.
  });
}

export async function checkInKnownItem(
  item: Item,
  sessionId: string,
  gateName: string,
  source: Extract<CheckInSource, 'camera' | 'manual'>
): Promise<ScanResult> {
  const scanned = await db.scanItem(sessionId, item.id, gateName);

  if (scanned) {
    logAttempt(scanned.id, sessionId, gateName, false, source);
    return { success: true, item: scanned, message: scanned.name, type: 'success' };
  }

  // A failed compare-and-set normally means another gate admitted this guest.
  // Read the persisted row so duplicate feedback and Undo state use authoritative data.
  const current = await db.getItemById(sessionId, item.id);
  if (!current || current.removed) {
    return { success: false, message: 'Not found', type: 'not_found' };
  }

  if (current.scanned) {
    logAttempt(current.id, sessionId, gateName, true, source);
    return {
      success: false,
      item: current,
      message: `Already checked in${current.scanned_by ? ` · ${current.scanned_by}` : ''}`,
      type: 'duplicate',
    };
  }

  return { success: false, message: 'Not found', type: 'not_found' };
}
