import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

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
  async createSession(name: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .insert({ name })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getSession(id: string) {
    const { data, error } = await getClient()
      .from('scan_sessions')
      .select('*')
      .eq('id', id)
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
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async createItems(items: { barcode: string; name: string }[], sessionId: string) {
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

  async scanItem(itemId: string, scannedBy: string) {
    const { data, error } = await getClient()
      .from('items')
      .update({
        scanned: true,
        scanned_at: new Date().toISOString(),
        scanned_by: scannedBy,
      })
      .eq('id', itemId)
      .eq('scanned', false)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async addItem(sessionId: string, name: string, barcode: string) {
    const { data, error } = await getClient()
      .from('items')
      .insert({ session_id: sessionId, name, barcode, scanned: false })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async logScanAttempt(itemId: string, sessionId: string, gateName: string, isDuplicate: boolean) {
    await getClient()
      .from('scan_attempts')
      .insert({ item_id: itemId, session_id: sessionId, gate_name: gateName, is_duplicate: isDuplicate });
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
