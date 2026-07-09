export interface ScanSession {
  id: string;
  name: string;
  created_at: string;
  archived: boolean;
}

export interface Item {
  id: string;
  session_id: string;
  barcode: string;
  name: string;
  email: string | null;
  scanned: boolean;
  scanned_at: string | null;
  scanned_by: string | null;
  removed: boolean;
  qr_email_sent_at: string | null;
  qr_email_resend_id: string | null;
  qr_email_last_error: string | null;
}

export interface ScanResult {
  success: boolean;
  item?: Item;
  message: string;
  type: 'success' | 'duplicate' | 'not_found';
}

export interface Progress {
  total: number;
  scanned: number;
  remaining: number;
  percentage: number;
}
