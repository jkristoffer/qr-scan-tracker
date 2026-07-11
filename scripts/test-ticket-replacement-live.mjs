#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

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

async function replaceCode(client, sessionId, itemId, expectedCode, newCode) {
  const { data, error } = await client.rpc('replace_item_ticket_code', {
    p_session_id: sessionId,
    p_item_id: itemId,
    p_expected_code: expectedCode,
    p_new_code: newCode,
  });
  if (error) throw operationError('Ticket replacement RPC', error);
  return data;
}

async function suggestion(client, sessionId) {
  const { data, error } = await client.rpc('suggest_next_ticket_code', {
    p_session_id: sessionId,
  });
  if (error) throw operationError('Ticket suggestion RPC', error);
  return data;
}

function assertPreserved(before, result, expectedCode) {
  assert(result?.status === 'replaced', `Expected replacement, received ${result?.status}`);
  const after = result.item;
  assert(after?.barcode === expectedCode, `Expected replacement code ${expectedCode}`);
  for (const field of ['id', 'session_id', 'name', 'email', 'scanned', 'scanned_at', 'scanned_by', 'removed']) {
    assert(after?.[field] === before[field], `Replacement changed preserved field ${field}`);
  }
  assert(after.qr_email_sent_at === null, 'Replacement did not clear qr_email_sent_at');
  assert(after.qr_email_resend_id === null, 'Replacement did not clear qr_email_resend_id');
  assert(after.qr_email_last_error === null, 'Replacement did not clear qr_email_last_error');
}

async function assertDirectCodeRejected(client, sessionId, code, suffix, label) {
  const { error } = await client.from('items').insert({
    session_id: sessionId,
    barcode: code,
    name: `Rejected ${label} ${suffix}`,
    scanned: false,
    removed: false,
  });
  assert(error, `Direct item creation unexpectedly reused ${label} code ${code}`);
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

  try {
    const { data: session, error: sessionError } = await client
      .from('scan_sessions')
      .insert({ name: `Ticket replacement live test ${suffix}` })
      .select('id')
      .single();
    if (sessionError) throw operationError('Temporary session creation', sessionError);
    sessionId = session.id;

    const sentAt = new Date(Date.now() - 60_000).toISOString();
    const checkedAt = new Date(Date.now() - 30_000).toISOString();
    const rows = [
      {
        session_id: sessionId,
        barcode: 'TKT-0001',
        name: 'Active Replacement Guest',
        email: 'active@example.test',
        scanned: false,
        scanned_at: null,
        scanned_by: null,
        removed: false,
        qr_email_sent_at: sentAt,
        qr_email_resend_id: 'active-resend',
        qr_email_last_error: 'active-error',
      },
      {
        session_id: sessionId,
        barcode: 'TKT-0002',
        name: 'Checked Replacement Guest',
        email: 'checked@example.test',
        scanned: true,
        scanned_at: checkedAt,
        scanned_by: 'Live Gate',
        removed: false,
        qr_email_sent_at: sentAt,
        qr_email_resend_id: 'checked-resend',
        qr_email_last_error: 'checked-error',
      },
      {
        session_id: sessionId,
        barcode: 'TKT-0003',
        name: 'Removed Replacement Guest',
        email: 'removed@example.test',
        scanned: false,
        scanned_at: null,
        scanned_by: null,
        removed: true,
        qr_email_sent_at: sentAt,
        qr_email_resend_id: 'removed-resend',
        qr_email_last_error: 'removed-error',
      },
      { session_id: sessionId, barcode: `RACE-A-${suffix}`, name: 'Race Guest A', scanned: false, removed: false },
      { session_id: sessionId, barcode: `RACE-B-${suffix}`, name: 'Race Guest B', scanned: false, removed: false },
    ];
    const { data: items, error: itemsError } = await client
      .from('items')
      .insert(rows)
      .select('*');
    if (itemsError) throw operationError('Temporary item creation', itemsError);
    assert(items.length === rows.length, 'Not all temporary items were created');

    const byCode = new Map(items.map((item) => [item.barcode, item]));
    const active = byCode.get('TKT-0001');
    const checked = byCode.get('TKT-0002');
    const removed = byCode.get('TKT-0003');
    const raceA = byCode.get(`RACE-A-${suffix}`);
    const raceB = byCode.get(`RACE-B-${suffix}`);
    assert(active && checked && removed && raceA && raceB, 'Could not identify all temporary items');

    assert(await suggestion(client, sessionId) === 'TKT-0004', 'Suggestion did not skip existing numeric codes');

    const activeResult = await replaceCode(client, sessionId, active.id, active.barcode, `ACTIVE-NEW-${suffix}`);
    assertPreserved(active, activeResult, `ACTIVE-NEW-${suffix}`);
    const checkedResult = await replaceCode(client, sessionId, checked.id, checked.barcode, `CHECKED-NEW-${suffix}`);
    assertPreserved(checked, checkedResult, `CHECKED-NEW-${suffix}`);
    const removedResult = await replaceCode(client, sessionId, removed.id, removed.barcode, `REMOVED-NEW-${suffix}`);
    assertPreserved(removed, removedResult, `REMOVED-NEW-${suffix}`);
    assert(await suggestion(client, sessionId) === 'TKT-0004', 'Suggestion ignored retired numeric codes');

    const retiredReuse = await replaceCode(
      client,
      sessionId,
      active.id,
      activeResult.item.barcode,
      'TKT-0001'
    );
    assert(retiredReuse?.status === 'code_unavailable', 'Retired ticket code was reusable through RPC');
    assert(retiredReuse.item?.barcode === activeResult.item.barcode, 'Retired-code conflict partially changed the item');

    const activeReuse = await replaceCode(
      client,
      sessionId,
      active.id,
      activeResult.item.barcode,
      checkedResult.item.barcode
    );
    assert(activeReuse?.status === 'code_unavailable', 'Active ticket code was reusable through RPC');
    assert(activeReuse.item?.barcode === activeResult.item.barcode, 'Active-code conflict partially changed the item');
    await assertDirectCodeRejected(client, sessionId, 'TKT-0001', suffix, 'retired');
    await assertDirectCodeRejected(client, sessionId, checkedResult.item.barcode, suffix, 'active');

    const staleCodes = [`STALE-A-${suffix}`, `STALE-B-${suffix}`];
    const staleRace = await Promise.all([
      replaceCode(client, sessionId, active.id, activeResult.item.barcode, staleCodes[0]),
      replaceCode(client, sessionId, active.id, activeResult.item.barcode, staleCodes[1]),
    ]);
    assert(staleRace.filter((result) => result.status === 'replaced').length === 1, 'Same-item race lacked one winner');
    assert(staleRace.filter((result) => result.status === 'stale').length === 1, 'Same-item race lacked one stale result');

    const sharedCode = `SHARED-${suffix}`;
    const sharedRace = await Promise.all([
      replaceCode(client, sessionId, raceA.id, raceA.barcode, sharedCode),
      replaceCode(client, sessionId, raceB.id, raceB.barcode, sharedCode),
    ]);
    assert(sharedRace.filter((result) => result.status === 'replaced').length === 1, 'Shared-code race lacked one winner');
    assert(
      sharedRace.filter((result) => result.status === 'code_unavailable').length === 1,
      'Shared-code race lacked one code_unavailable result'
    );
    const sharedLoser = sharedRace.find((result) => result.status === 'code_unavailable');
    assert(sharedLoser?.item, 'Shared-code race loser did not return its unchanged item');
    const loserRetryCode = `LOSER-RETRY-${suffix}`;
    const loserRetry = await replaceCode(
      client,
      sessionId,
      sharedLoser.item.id,
      sharedLoser.item.barcode,
      loserRetryCode
    );
    assert(loserRetry?.status === 'replaced', 'Shared-code race partially retired the loser old code');
    assert(loserRetry.item?.barcode === loserRetryCode, 'Shared-code race loser retry returned the wrong code');

    console.log('PASS: suggestions, state preservation, permanent reservations, and replacement races work.');
  } finally {
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
