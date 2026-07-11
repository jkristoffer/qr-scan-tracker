import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  CheckInSource,
  Item,
  ReplaceTicketCodeResult,
  UndoCheckInResult,
  UpdateItemDetailsInput,
} from './types';

let _client: SupabaseClient | null = null;
const SESSION_COLUMNS = 'id,name,created_at,archived';
const MANAGE_SESSION_COLUMNS = `${SESSION_COLUMNS},manage_password_hash`;

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Missing Supabase environment variables');
    _client = createClient(url, key);
  }
  return _client;
}

export const db = {
  async createSession(name: string, managePasswordHash: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .insert({ name, manage_password_hash: managePasswordHash })
      .select(SESSION_COLUMNS)
      .single();
    if (error) throw error;
    return data;
  },

  async getSession(id: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .select(SESSION_COLUMNS)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getManageSession(id: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .select(MANAGE_SESSION_COLUMNS)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async claimManagePassword(id: string, managePasswordHash: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .update({ manage_password_hash: managePasswordHash })
      .eq('id', id)
      .is('manage_password_hash', null)
      .select(MANAGE_SESSION_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async changeManagePassword(id: string, currentHash: string, nextHash: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .update({ manage_password_hash: nextHash })
      .eq('id', id)
      .eq('manage_password_hash', currentHash)
      .select(MANAGE_SESSION_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async renameSession(id: string, name: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .update({ name })
      .eq('id', id)
      .select(MANAGE_SESSION_COLUMNS)
      .single();
    if (error) throw error;
    return data;
  },

  async getSessionsProgress(sessionIds: string[]): Promise<Record<string, { total: number; scanned: number }>> {
    if (sessionIds.length === 0) return {};
    const [{ data: activeData, error: e1 }, { data: scannedData, error: e2 }] = await Promise.all([
      getClient().from('items').select('session_id').in('session_id', sessionIds).eq('removed', false),
      getClient().from('items').select('session_id').in('session_id', sessionIds).eq('scanned', true),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const result: Record<string, { total: number; scanned: number }> = {};
    for (const item of (activeData || [])) {
      if (!result[item.session_id]) result[item.session_id] = { total: 0, scanned: 0 };
      result[item.session_id].total++;
    }
    for (const item of (scannedData || [])) {
      if (!result[item.session_id]) result[item.session_id] = { total: 0, scanned: 0 };
      result[item.session_id].scanned++;
    }
    return result;
  },

  async listSessions() {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .select(SESSION_COLUMNS)
      .eq('archived', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async listArchivedSessions() {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .select(SESSION_COLUMNS)
      .eq('archived', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async archiveSession(id: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .update({ archived: true })
      .eq('id', id)
      .select(SESSION_COLUMNS)
      .single();
    if (error) throw error;
    return data;
  },

  async unarchiveSession(id: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .update({ archived: false })
      .eq('id', id)
      .select(SESSION_COLUMNS)
      .single();
    if (error) throw error;
    return data;
  },

  async createItems(items: { barcode: string; name: string; email?: string | null }[], sessionId: string) {
    const client = getClient();
    const BATCH_SIZE = 100;
    const results = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const { data, error } = await client
        .from('items')
        .insert(batch.map(item => ({ ...item, session_id: sessionId })))
        .select();
      if (error) throw error;
      results.push(...(data || []));
    }
    return results;
  },

  async getItems(sessionId: string) {
    const { data, error } = await getClient()
      .from('items')
      .select('*')
      .eq('session_id', sessionId)
      .eq('removed', false);
    if (error) throw error;
    return data;
  },

  async getAllItems(sessionId: string) {
    const { data, error } = await getClient()
      .from('items')
      .select('*')
      .eq('session_id', sessionId);
    if (error) throw error;
    return data;
  },

  async getItemByBarcode(sessionId: string, barcode: string) {
    const { data, error } = await getClient()
      .from('items')
      .select('*')
      .eq('session_id', sessionId)
      .eq('barcode', barcode)
      .eq('removed', false)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getItemById(sessionId: string, itemId: string) {
    const { data, error } = await getClient()
      .from('items')
      .select('*')
      .eq('session_id', sessionId)
      .eq('id', itemId)
      .maybeSingle();
    if (error) throw error;
    return data as Item | null;
  },

  async updateItemDetails(
    sessionId: string,
    itemId: string,
    input: UpdateItemDetailsInput
  ): Promise<Item | null> {
    const { data: currentData, error: currentError } = await getClient()
      .from('items')
      .select('*')
      .eq('session_id', sessionId)
      .eq('id', itemId)
      .maybeSingle();
    if (currentError) throw currentError;
    const current = currentData as Item | null;
    if (!current) return null;

    const name = input.name.trim();
    const email = input.email?.trim() || null;
    if (current.name === name && current.email === email) return current;

    const { data, error } = await getClient()
      .from('items')
      .update({
        name,
        email,
        qr_email_sent_at: null,
        qr_email_resend_id: null,
        qr_email_last_error: null,
      })
      .eq('session_id', sessionId)
      .eq('id', itemId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as Item | null;
  },

  async replaceItemTicketCode(
    sessionId: string,
    itemId: string,
    expectedCode: string,
    newCode: string
  ): Promise<ReplaceTicketCodeResult> {
    const { data, error } = await getClient().rpc('replace_item_ticket_code', {
      p_session_id: sessionId,
      p_item_id: itemId,
      p_expected_code: expectedCode,
      p_new_code: newCode,
    });
    if (error) throw error;
    return data as ReplaceTicketCodeResult;
  },

  async suggestNextTicketCode(sessionId: string): Promise<string> {
    const { data, error } = await getClient().rpc('suggest_next_ticket_code', {
      p_session_id: sessionId,
    });
    if (error) throw error;
    return data as string;
  },

  async scanItem(sessionId: string, itemId: string, scannedBy: string) {
    const { data, error } = await getClient()
      .from('items')
      .update({
        scanned: true,
        scanned_at: new Date().toISOString(),
        scanned_by: scannedBy,
      })
      .eq('id', itemId)
      .eq('session_id', sessionId)
      .eq('scanned', false)
      .eq('removed', false)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async addItem(sessionId: string, name: string, barcode: string, email?: string | null) {
    const { data, error } = await getClient()
      .from('items')
      .insert({ session_id: sessionId, name, barcode, email: email || null, scanned: false })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getItemsByIds(sessionId: string, itemIds: string[]) {
    if (itemIds.length === 0) return [];
    const { data, error } = await getClient()
      .from('items')
      .select('*')
      .eq('session_id', sessionId)
      .in('id', itemIds);
    if (error) throw error;
    return data || [];
  },

  async updateQrEmailStatus(
    itemId: string,
    status: {
      sentAt?: string | null;
      resendId?: string | null;
      lastError?: string | null;
    }
  ) {
    const patch: Record<string, string | null> = {};
    if ('sentAt' in status) patch.qr_email_sent_at = status.sentAt ?? null;
    if ('resendId' in status) patch.qr_email_resend_id = status.resendId ?? null;
    if ('lastError' in status) patch.qr_email_last_error = status.lastError ?? null;

    const { data, error } = await getClient()
      .from('items')
      .update(patch)
      .eq('id', itemId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async logScanAttempt(
    itemId: string,
    sessionId: string,
    gateName: string,
    isDuplicate: boolean,
    source: CheckInSource = 'camera'
  ) {
    await getClient()
      .from('scan_attempts')
      .insert({
        item_id: itemId,
        session_id: sessionId,
        gate_name: gateName,
        is_duplicate: isDuplicate,
        event_type: isDuplicate ? 'duplicate' : 'check_in',
        source,
      });
  },

  async undoItemCheckIn(
    sessionId: string,
    itemId: string,
    expectedScannedAt: string,
    actorLabel: string,
    source: CheckInSource
  ): Promise<UndoCheckInResult> {
    const { data, error } = await getClient().rpc('undo_item_check_in', {
      p_session_id: sessionId,
      p_item_id: itemId,
      p_expected_scanned_at: expectedScannedAt,
      p_actor_label: actorLabel,
      p_source: source,
    });
    if (error) throw error;
    return data as UndoCheckInResult;
  },

  async removeItem(itemId: string) {
    const { data, error } = await getClient()
      .from('items')
      .update({ removed: true })
      .eq('id', itemId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async restoreItem(itemId: string) {
    const { data, error } = await getClient()
      .from('items')
      .update({ removed: false })
      .eq('id', itemId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  subscribeToItems(sessionId: string, callback: (payload: any) => void) {
    return getClient()
      .channel(`items:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items', filter: `session_id=eq.${sessionId}` },
        callback
      )
      .subscribe();
  },

  joinPresence(sessionId: string, gateName: string) {
    const channel = getClient().channel(`presence:${sessionId}`, {
      config: { presence: { key: gateName } },
    });
    channel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ gate_name: gateName, joined_at: Date.now() });
      }
    });
    return channel;
  },

  watchPresence(sessionId: string, onChange: (gateNames: string[]) => void) {
    const channel = getClient().channel(`presence:${sessionId}`);
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ gate_name: string }>();
      const names = Object.values(state).flatMap(presences => presences.map(p => p.gate_name));
      onChange([...new Set(names)]);
    });
    channel.subscribe();
    return channel;
  },
};
