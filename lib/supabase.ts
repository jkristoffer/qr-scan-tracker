import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

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

export const auth = {
  async signIn(email: string, password: string): Promise<User> {
    const { data, error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  },

  async signUp(email: string, password: string, role: 'admin' | 'scanner'): Promise<User | null> {
    const { data, error } = await getClient().auth.signUp({
      email,
      password,
      options: { data: { role } },
    });
    if (error) throw error;
    return data.user;
  },

  async signOut(): Promise<void> {
    const { error } = await getClient().auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    const { data: { session } } = await getClient().auth.getSession();
    return session;
  },

  onAuthStateChange(callback: (user: User | null) => void) {
    return getClient().auth.onAuthStateChange((_, session) => {
      callback(session?.user ?? null);
    });
  },
};

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
    const { data, error } = await getClient()
      .from('items')
      .select('session_id, scanned')
      .in('session_id', sessionIds);
    if (error) throw error;
    const result: Record<string, { total: number; scanned: number }> = {};
    for (const item of (data || [])) {
      if (!result[item.session_id]) result[item.session_id] = { total: 0, scanned: 0 };
      result[item.session_id].total++;
      if (item.scanned) result[item.session_id].scanned++;
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

  async resetSession(sessionId: string) {
    const { data, error } = await getClient()
      .from('items')
      .update({ scanned: false, scanned_at: null, scanned_by: null })
      .eq('session_id', sessionId)
      .select();
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
};
