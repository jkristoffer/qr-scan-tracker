#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const REALTIME_TIMEOUT_MS = 12_000;

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function operationError(operation, error) {
  const code = error?.code ? ` (${error.code})` : '';
  return new Error(
    `${operation} failed${code}: ${error?.message || 'unknown Supabase error'}. ` +
    'Confirm the configured anonymous role permits this live test setup and cleanup.'
  );
}

async function admit(client, sessionId, itemId, actor, scannedAt) {
  const { data, error } = await client
    .from('items')
    .update({ scanned: true, scanned_at: scannedAt, scanned_by: actor })
    .eq('id', itemId)
    .eq('session_id', sessionId)
    .eq('scanned', false)
    .eq('removed', false)
    .select('id, scanned, scanned_at, scanned_by')
    .maybeSingle();
  if (error) throw operationError(`Admission by ${actor}`, error);
  return data;
}

async function undo(client, sessionId, itemId, expectedScannedAt, actor, source) {
  const { data, error } = await client.rpc('undo_item_check_in', {
    p_session_id: sessionId,
    p_item_id: itemId,
    p_expected_scanned_at: expectedScannedAt,
    p_actor_label: actor,
    p_source: source,
  });
  if (error) throw operationError(`Undo from ${source}`, error);
  return data;
}

function waitForRealtimeUpdate(client, sessionId, itemId) {
  let resolveUpdate;
  let rejectUpdate;
  const update = new Promise((resolvePromise, rejectPromise) => {
    resolveUpdate = resolvePromise;
    rejectUpdate = rejectPromise;
  });
  const timer = setTimeout(
    () => rejectUpdate(new Error(`No items UPDATE received within ${REALTIME_TIMEOUT_MS}ms`)),
    REALTIME_TIMEOUT_MS
  );
  const channel = client
    .channel(`checkin-correction-live:${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'items', filter: `session_id=eq.${sessionId}` },
      (payload) => {
        if (payload.new?.id === itemId) resolveUpdate(payload);
      }
    );
  const subscribed = new Promise((resolvePromise, rejectPromise) => {
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') resolvePromise();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        rejectPromise(operationError(`Realtime subscription (${status})`, error));
      }
    });
  });
  return {
    channel,
    subscribed,
    update: update.finally(() => clearTimeout(timer)),
  };
}

async function main() {
  loadEnvLocal();
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let sessionId = null;
  let realtimeChannel = null;

  try {
    const { data: session, error: sessionError } = await client
      .from('scan_sessions')
      .insert({ name: `Check-in correction live test ${suffix}` })
      .select('id')
      .single();
    if (sessionError) throw operationError('Temporary session creation', sessionError);
    sessionId = session.id;

    const { data: items, error: itemError } = await client
      .from('items')
      .insert([
        {
          session_id: sessionId,
          barcode: `CORRECTION-${suffix}`,
          name: 'Check-in Correction Test',
          scanned: false,
          removed: false,
        },
        {
          session_id: sessionId,
          barcode: `REMOVED-${suffix}`,
          name: 'Removed Admission Test',
          scanned: false,
          removed: true,
        },
      ])
      .select('id, removed');
    if (itemError) throw operationError('Temporary item creation', itemError);
    const item = items.find((row) => !row.removed);
    const removedItem = items.find((row) => row.removed);
    assert(item && removedItem, 'Temporary active and removed guests were not both created');

    const realtime = waitForRealtimeUpdate(client, sessionId, item.id);
    realtimeChannel = realtime.channel;
    await realtime.subscribed;

    const raceTimes = [new Date().toISOString(), new Date(Date.now() + 1).toISOString()];
    const raceResults = await Promise.all([
      admit(client, sessionId, item.id, 'Race Gate A', raceTimes[0]),
      admit(client, sessionId, item.id, 'Race Gate B', raceTimes[1]),
    ]);
    const winners = raceResults.filter(Boolean);
    assert(winners.length === 1, `Expected one concurrent admission winner, received ${winners.length}`);
    await realtime.update;

    const rejectedRemoved = await admit(
      client,
      sessionId,
      removedItem.id,
      'Removed Gate',
      new Date(Date.now() + 10).toISOString()
    );
    assert(rejectedRemoved === null, 'Removed guest was incorrectly admitted');

    const sourceCases = [
      { source: 'camera', actor: 'Camera Gate', checkedIn: winners[0] },
      { source: 'manual', actor: 'Manual Gate', checkedIn: null },
      { source: 'manage', actor: 'Manage', checkedIn: null },
    ];
    for (let index = 0; index < sourceCases.length; index += 1) {
      const sourceCase = sourceCases[index];
      if (!sourceCase.checkedIn) {
        sourceCase.checkedIn = await admit(
          client,
          sessionId,
          item.id,
          sourceCase.actor,
          new Date(Date.now() + 100 + index).toISOString()
        );
      }
      assert(sourceCase.checkedIn, `Could not prepare ${sourceCase.source} undo`);
      const result = await undo(
        client,
        sessionId,
        item.id,
        sourceCase.checkedIn.scanned_at,
        sourceCase.actor,
        sourceCase.source
      );
      assert(result?.status === 'undone', `Expected ${sourceCase.source} undo, received ${result?.status}`);
      assert(result.item?.scanned === false, `${sourceCase.source} undo did not clear scanned state`);
      assert(result.item?.scanned_at === null, `${sourceCase.source} undo did not clear scanned_at`);
      assert(result.item?.scanned_by === null, `${sourceCase.source} undo did not clear scanned_by`);
    }

    const latest = await admit(
      client,
      sessionId,
      item.id,
      'Latest Gate',
      new Date(Date.now() + 1_000).toISOString()
    );
    assert(latest, 'Could not prepare stale undo check');
    const stale = await undo(client, sessionId, item.id, winners[0].scanned_at, 'Old Gate', 'camera');
    assert(stale?.status === 'stale', `Expected stale undo, received ${stale?.status}`);
    assert(stale.item?.scanned_at === latest.scanned_at, 'Stale undo changed the newer check-in');
    assert(stale.item?.scanned_by === 'Latest Gate', 'Stale undo changed the newer check-in actor');

    const { data: undoEvents, error: eventError } = await client
      .from('scan_attempts')
      .select('event_type, source, gate_name, is_duplicate')
      .eq('session_id', sessionId)
      .eq('item_id', item.id)
      .eq('event_type', 'undo_check_in');
    if (eventError) throw operationError('Undo event verification', eventError);
    assert(undoEvents.length === 3, `Expected three undo events, received ${undoEvents.length}`);
    const sources = new Set(undoEvents.map((event) => event.source));
    for (const source of ['camera', 'manual', 'manage']) {
      assert(sources.has(source), `Undo event did not retain ${source} source`);
    }
    assert(undoEvents.every((event) => !event.is_duplicate), 'Undo event was marked duplicate');

    console.log('PASS: admission race, removal guard, exact/stale undo, sources, realtime, and cleanup work.');
  } finally {
    if (realtimeChannel) await client.removeChannel(realtimeChannel);
    if (sessionId) {
      const { error } = await client.from('scan_sessions').delete().eq('id', sessionId);
      if (error) console.error(`Cleanup failed for temporary session ${sessionId}: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
