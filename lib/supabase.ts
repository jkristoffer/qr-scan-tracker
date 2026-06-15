import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
}

// Database functions
export const db = {
  // Sessions
  async createSession(name: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('scan_sessions')
      .insert({ name })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getSession(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('scan_sessions')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async listSessions() {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('scan_sessions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Items
  async createItems(items: { barcode: string; name: string }[], sessionId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('items')
      .insert(items.map(item => ({ ...item, session_id: sessionId })))
      .select();
    if (error) throw error;
    return data;
  },

  async getItems(sessionId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('session_id', sessionId);
    if (error) throw error;
    return data;
  },

  async getItemByBarcode(sessionId: string, barcode: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('session_id', sessionId)
      .eq('barcode', barcode)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // Atomic scan - prevents duplicates
  async scanItem(itemId: string, scannedBy: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('items')
      .update({
        scanned: true,
        scanned_at: new Date().toISOString(),
        scanned_by: scannedBy,
      })
      .eq('id', itemId)
      .eq('scanned', false) // Only update if not already scanned
      .select()
      .maybeSingle();

    if (error) throw error;
    return data; // Returns null if already scanned (duplicate)
  },

  // Reset session
  async resetSession(sessionId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('items')
      .update({
        scanned: false,
        scanned_at: null,
        scanned_by: null,
      })
      .eq('session_id', sessionId)
      .select();
    if (error) throw error;
    return data;
  },

  // Realtime subscription
  subscribeToItems(sessionId: string, callback: (payload: any) => void) {
    const supabase = getSupabaseClient();
    return supabase
      .channel(`items:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'items',
          filter: `session_id=eq.${sessionId}`,
        },
        callback
      )
      .subscribe();
  },
};
