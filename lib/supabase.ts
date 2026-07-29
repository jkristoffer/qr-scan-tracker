import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  CheckInSource,
  Item,
  ReplaceTicketCodeResult,
  UndoCheckInResult,
  UpdateItemDetailsInput,
} from './types';
import type { AdmissionInput, AdmissionResult } from './admission';
import { normalizeGuestTag } from './guestTags';

let _client: SupabaseClient | null = null;
const SESSION_COLUMNS = 'id,name,registration_at,venue,created_at,archived';
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
  async createSession(name: string, managePasswordHash: string, registrationAt: string | null, venue: string | null) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .insert({ name, manage_password_hash: managePasswordHash, registration_at: registrationAt, venue })
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

  async updateEventDetails(id: string, registrationAt: string | null, venue: string | null) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .update({ registration_at: registrationAt, venue })
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

  async createItems(items: { barcode: string; name: string; email?: string | null; tag?: string | null; isVIP?: boolean; isStaff?: boolean }[], sessionId: string) {
    const client = getClient();
    const BATCH_SIZE = 100;
    const results = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const { data, error } = await client
        .from('items')
        .insert(batch.map(item => ({ ...item, tag: normalizeGuestTag(item.tag), session_id: sessionId })))
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
    const tag = normalizeGuestTag(input.tag);
    const ticketDetailsChanged = current.name !== name || current.email !== email || current.isVIP !== input.isVIP || current.isStaff !== input.isStaff;
    if (!ticketDetailsChanged && current.tag === tag) return current;

    const patch: Record<string, string | boolean | null> = {
      name,
      email,
      tag,
      isVIP: input.isVIP,
      isStaff: input.isStaff,
    };
    if (ticketDetailsChanged) {
      patch.qr_email_sent_at = null;
      patch.qr_email_resend_id = null;
      patch.qr_email_last_error = null;
    }

    const { data, error } = await getClient()
      .from('items')
      .update(patch)
      .eq('session_id', sessionId)
      .eq('id', itemId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as Item | null;
  },

  async updateItemsTag(sessionId: string, itemIds: string[], tag: string | null): Promise<Item[]> {
    if (itemIds.length === 0) return [];
    const normalizedTag = normalizeGuestTag(tag);
    const updatedItems: Item[] = [];
    const BATCH_SIZE = 100;
    for (let index = 0; index < itemIds.length; index += BATCH_SIZE) {
      const batch = itemIds.slice(index, index + BATCH_SIZE);
      const { data, error } = await getClient()
        .from('items')
        .update({ tag: normalizedTag })
        .eq('session_id', sessionId)
        .in('id', batch)
        .select();
      if (error) throw error;
      updatedItems.push(...((data || []) as Item[]));
    }
    return updatedItems;
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

  async reconcileAdmission(input: AdmissionInput): Promise<AdmissionResult> {
    const { data, error } = await getClient().rpc('reconcile_admissions', {
      p_session_id: input.sessionId,
      p_item_id: input.itemId,
      p_attempt_id: input.attemptId,
      p_gate_name: input.gateName,
      p_source: input.source,
      p_captured_at: input.capturedAt,
    });
    if (error) throw error;
    return data as AdmissionResult;
  },

  async addItem(sessionId: string, name: string, barcode: string, email?: string | null, isVIP = false, tag?: string | null, isStaff = false) {
    const { data, error } = await getClient()
      .from('items')
      .insert({ session_id: sessionId, name, barcode, email: email || null, tag: normalizeGuestTag(tag), isVIP, isStaff, scanned: false })
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

  joinPeerSignaling(sessionId: string, onSignal: (payload: unknown) => void) {
    const channel = getClient().channel(`peer-sync:${sessionId}`, {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload));
    return channel;
  },

  async publishPeerSignal(sessionId: string, signal: { id: string; type: 'hello' | 'offer' | 'answer'; from: string; to?: string; signal?: unknown }) {
    const { error } = await getClient().from('peer_signals').insert({
      signal_id: signal.id,
      session_id: sessionId,
      sender_id: signal.from,
      recipient_id: signal.to || null,
      kind: signal.type,
      payload: signal.signal || null,
    });
    if (error) throw error;
  },

  async listPeerSignals(sessionId: string, deviceId: string, since: string) {
    const { data, error } = await getClient()
      .from('peer_signals')
      .select('signal_id,sender_id,recipient_id,kind,payload,created_at')
      .eq('session_id', sessionId)
      .neq('sender_id', deviceId)
      .or(`recipient_id.is.null,recipient_id.eq.${deviceId}`)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    return data || [];
  },

};
