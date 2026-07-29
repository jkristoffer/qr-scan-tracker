export interface ScanSession {
  id: string;
  name: string;
  event_date: string | null;
  registration_start: string | null;
  venue: string | null;
  venue_field2: string | null;
  created_at: string;
  archived: boolean;
}

export interface ManageSession extends ScanSession {
  manage_password_hash: string | null;
}

export interface Item {
  id: string;
  session_id: string;
  barcode: string;
  name: string;
  email: string | null;
  tag: string | null;
  isVIP: boolean;
  isStaff: boolean;
  created_at: string;
  scanned: boolean;
  scanned_at: string | null;
  scanned_by: string | null;
  removed: boolean;
  qr_email_sent_at: string | null;
  qr_email_resend_id: string | null;
  qr_email_last_error: string | null;
  admission_attempt_id?: string | null;
}

export type AdmissionSyncState = 'confirmed' | 'pending' | 'conflict';

export interface ScanResult {
  success: boolean;
  item?: Item;
  message: string;
  type: 'success' | 'duplicate' | 'not_found';
  syncState?: AdmissionSyncState;
}

export interface Progress {
  total: number;
  scanned: number;
  remaining: number;
  percentage: number;
}

export type CheckInEventType = 'check_in' | 'duplicate' | 'undo_check_in';
export type CheckInSource = 'camera' | 'manual' | 'manage';
export type UndoCheckInStatus = 'undone' | 'stale' | 'not_found';

export interface UndoCheckInResult {
  status: UndoCheckInStatus;
  item: Item | null;
}

export interface UpdateItemDetailsInput {
  name: string;
  email: string | null;
  tag: string | null;
  isVIP: boolean;
  isStaff: boolean;
}

export type ReplaceTicketCodeStatus = 'replaced' | 'stale' | 'code_unavailable' | 'not_found';

export interface ReplaceTicketCodeResult {
  status: ReplaceTicketCodeStatus;
  item: Item | null;
}
