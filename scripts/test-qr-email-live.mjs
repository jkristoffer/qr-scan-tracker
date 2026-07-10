#!/usr/bin/env node
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'RESEND_API_KEY',
  'QR_EMAIL_FROM',
];
const DEFAULT_TO = 'delivered@resend.dev';
const KEEP = process.argv.includes('--keep');

function parseDotenvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = parseDotenvValue(trimmed.slice(index + 1));
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function isPlaceholder(value) {
  return !value || value.startsWith('your_');
}

function requireEnv() {
  const missing = REQUIRED_ENV.filter((key) => isPlaceholder(process.env[key]));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function formatError(error) {
  const messages = [];
  let current = error;

  while (current && messages.length < 5) {
    const code = current.code ? ` [${current.code}]` : '';
    const message = current.message || String(current);
    messages.push(`${message}${code}`);
    current = current.cause;
  }

  const details = messages.filter((message, index) => message !== messages[index - 1]);
  if (details.some((message) => message.includes('[ENOTFOUND]'))) {
    details.push(
      'Check NEXT_PUBLIC_SUPABASE_URL in .env.local; its hostname could not be resolved.'
    );
  }

  return details.join('\nCaused by: ');
}

function randomSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function randomUuid() {
  return randomUUID();
}

async function verifySupabaseReachable() {
  try {
    await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error('Unable to reach the configured Supabase project.', { cause: error });
  }
}

async function getFreePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('Unable to allocate a local port'));
      });
    });
  });
}

async function waitForServer(baseUrl, child) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < 60_000) {
    if (child?.exitCode !== null) {
      throw new Error(`Next server exited before becoming ready with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/qr-email/readiness-probe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (response.status === 400) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1_000);
  }

  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError?.message || 'no response'}`);
}

async function startNextServer() {
  if (process.env.QR_EMAIL_TEST_BASE_URL) {
    const baseUrl = process.env.QR_EMAIL_TEST_BASE_URL.replace(/\/$/, '');
    console.log(`Using configured Next server: ${baseUrl}`);
    return { baseUrl, stop: async () => {} };
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  const collect = (chunk) => {
    output.push(chunk.toString());
    if (output.length > 20) output.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  try {
    await waitForServer(baseUrl, child);
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}\nRecent server output:\n${output.join('').trim()}`);
  }

  console.log(`Started temporary Next server: ${baseUrl}`);
  return {
    baseUrl,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolveStop) => child.once('exit', resolveStop)),
        delay(5_000).then(() => child.kill('SIGKILL')),
      ]);
    },
  };
}

async function postQrEmail(baseUrl, sessionId, body) {
  const response = await fetch(`${baseUrl}/api/qr-email/${sessionId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  assert(response.ok, `QR email route returned HTTP ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

function statusFor(statuses, itemId) {
  return statuses.find((status) => status.itemId === itemId);
}

async function fetchItem(supabase, itemId) {
  const { data, error } = await supabase
    .from('items')
    .select('id, qr_email_sent_at, qr_email_resend_id, qr_email_last_error')
    .eq('id', itemId)
    .single();
  if (error) throw error;
  return data;
}

async function main() {
  loadEnvLocal();
  requireEnv();

  const recipient = process.env.QR_EMAIL_TEST_TO || DEFAULT_TO;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  let sessionId = null;
  let server = null;
  try {
    await verifySupabaseReachable();
    server = await startNextServer();

    const suffix = randomSuffix();
    const { data: session, error: sessionError } = await supabase
      .from('scan_sessions')
      .insert({ name: `QR Email Live Test ${suffix}` })
      .select('id')
      .single();
    if (sessionError) throw sessionError;
    sessionId = session.id;

    const rows = [
      { session_id: sessionId, barcode: `LIVE-${suffix}-VALID`, name: 'Live Email Valid', email: recipient },
      { session_id: sessionId, barcode: `LIVE-${suffix}-NOEMAIL`, name: 'Live Email Missing', email: null },
      { session_id: sessionId, barcode: `LIVE-${suffix}-REMOVED`, name: 'Live Email Removed', email: recipient, removed: true },
    ];
    const { data: items, error: itemsError } = await supabase
      .from('items')
      .insert(rows)
      .select('id, barcode, email, removed');
    if (itemsError) throw itemsError;

    const valid = items.find((item) => item.barcode.endsWith('-VALID'));
    const missingEmail = items.find((item) => item.barcode.endsWith('-NOEMAIL'));
    const removed = items.find((item) => item.barcode.endsWith('-REMOVED'));
    assert(valid && missingEmail && removed, 'Failed to create all live test items');

    console.log(`Created temporary session: ${sessionId}`);
    console.log(`Created test items: valid=${valid.id}, missing_email=${missingEmail.id}, removed=${removed.id}`);

    const first = await postQrEmail(server.baseUrl, sessionId, {
      itemIds: [valid.id, missingEmail.id, removed.id, randomUuid()],
    });
    assert(first.sent.length === 1 && statusFor(first.sent, valid.id), 'Expected valid item to be sent');
    assert(statusFor(first.skipped, missingEmail.id)?.reason === 'missing_email', 'Expected missing email skip');
    assert(statusFor(first.skipped, removed.id)?.reason === 'removed', 'Expected removed skip');
    assert(first.skipped.some((status) => status.reason === 'not_found'), 'Expected not_found skip');
    assert(first.failed.length === 0, `Expected no failed sends: ${JSON.stringify(first.failed)}`);

    const sent = await fetchItem(supabase, valid.id);
    assert(sent.qr_email_sent_at, 'Expected qr_email_sent_at to be set');
    assert(sent.qr_email_resend_id, 'Expected qr_email_resend_id to be set');
    assert(sent.qr_email_last_error === null, 'Expected qr_email_last_error to be null');
    const firstResendId = sent.qr_email_resend_id;
    console.log(`First Resend email ID persisted as qr_email_resend_id: ${firstResendId}`);

    const second = await postQrEmail(server.baseUrl, sessionId, { itemIds: [valid.id] });
    assert(second.sent.length === 0, 'Expected no send without force after first send');
    assert(statusFor(second.skipped, valid.id)?.reason === 'already_sent', 'Expected already_sent skip');
    console.log('No-force request skipped as already_sent');

    const forced = await postQrEmail(server.baseUrl, sessionId, { itemIds: [valid.id], force: true });
    assert(forced.sent.length === 1 && statusFor(forced.sent, valid.id), 'Expected forced resend to send');
    assert(forced.failed.length === 0, `Expected no forced resend failures: ${JSON.stringify(forced.failed)}`);

    const resent = await fetchItem(supabase, valid.id);
    assert(resent.qr_email_resend_id, 'Expected forced resend qr_email_resend_id to be set');
    assert(
      resent.qr_email_resend_id !== firstResendId,
      'Expected forced resend to persist a new qr_email_resend_id'
    );
    assert(resent.qr_email_last_error === null, 'Expected forced resend qr_email_last_error to be null');
    console.log(`Forced resend produced new qr_email_resend_id: ${resent.qr_email_resend_id}`);

    if (KEEP) {
      console.log(`Keeping temporary session for debugging: ${sessionId}`);
    } else {
      const cleanupId = sessionId;
      const { error: cleanupError } = await supabase.from('scan_sessions').delete().eq('id', cleanupId);
      if (cleanupError) throw cleanupError;
      sessionId = null;
      console.log(`Cleanup completed for session: ${cleanupId}`);
    }
  } catch (error) {
    if (sessionId && !KEEP) {
      try {
        await supabase.from('scan_sessions').delete().eq('id', sessionId);
        console.error(`Cleaned up temporary session after failure: ${sessionId}`);
      } catch (cleanupError) {
        console.error(`Cleanup failed for temporary session ${sessionId}: ${cleanupError.message}`);
      }
    } else if (sessionId) {
      console.error(`Temporary session kept: ${sessionId}`);
    }
    throw error;
  } finally {
    await server?.stop();
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
