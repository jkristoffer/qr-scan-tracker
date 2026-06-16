export interface ScanSession {
  id: string;
  name: string;
  created_at: string;
}

export interface Item {
  id: string;
  session_id: string;
  barcode: string;
  name: string;
  scanned: boolean;
  scanned_at: string | null;
  scanned_by: string | null;
  removed: boolean;
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
