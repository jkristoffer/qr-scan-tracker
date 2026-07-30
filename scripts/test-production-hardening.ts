import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { migrateWithRetry } from '../instrumentation';
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from '../lib/browserStorage';

async function main() {
assert.equal(readBrowserStorage('local', 'gate_name'), null);
assert.equal(writeBrowserStorage('local', 'gate_name', 'Main Gate'), false);
assert.equal(removeBrowserStorage('session', 'manage-access'), false);

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    get localStorage() {
      throw new DOMException('denied', 'SecurityError');
    },
    sessionStorage: {
      getItem() { throw new DOMException('denied', 'SecurityError'); },
      setItem() { throw new DOMException('quota', 'QuotaExceededError'); },
      removeItem() { throw new DOMException('denied', 'SecurityError'); },
    },
  },
});

assert.equal(readBrowserStorage('local', 'gate_name'), null);
assert.equal(readBrowserStorage('session', 'manage-access'), null);
assert.equal(writeBrowserStorage('session', 'manage-access', 'hash'), false);
assert.equal(removeBrowserStorage('session', 'manage-access'), false);

const migrationFailure = new Error('permanent migration failure');
let migrationAttempts = 0;
await assert.rejects(
  migrateWithRetry(
    async () => {
      migrationAttempts += 1;
      throw migrationFailure;
    },
    [0, 0, 0],
    async () => undefined,
  ),
  error => error === migrationFailure,
);
assert.equal(migrationAttempts, 3);

let eventualAttempts = 0;
await migrateWithRetry(
  async () => {
    eventualAttempts += 1;
    if (eventualAttempts < 3) throw new Error('temporary migration failure');
  },
  [0, 0, 0],
  async () => undefined,
);
assert.equal(eventualAttempts, 3);

type ExtendableEvent = { waitUntil(promise: Promise<unknown>): void };
type ServiceWorkerHandlers = {
  install?: (event: ExtendableEvent) => void;
  activate?: (event: ExtendableEvent) => void;
};

const launcherHtml = [
  '<link rel="stylesheet" href="/_next/static/chunks/app.css">',
  '<script src="/_next/static/chunks/runtime.js"></script>',
  '<script src="https://cdn.example/external.js"></script>',
].join('');

function serviceWorkerHarness({
  failPaths = new Set<string>(),
  launcherStatus = 200,
  html = launcherHtml,
}: {
  failPaths?: Set<string>;
  launcherStatus?: number;
  html?: string;
} = {}) {
  const handlers: ServiceWorkerHandlers = {};
  const deletedCaches: string[] = [];
  const addedPaths: string[] = [];
  const storedPaths: string[] = [];
  const cache = {
    async add(path: string) {
      if (failPaths.has(path)) throw new Error(`Could not cache ${path}`);
      addedPaths.push(path);
    },
    async addAll(paths: string[]) {
      await Promise.all(paths.map(path => cache.add(path)));
    },
    async put(path: string) {
      storedPaths.push(path);
    },
  };
  const context = {
    self: {
      clients: { async claim() {} },
      addEventListener(type: keyof ServiceWorkerHandlers, handler: NonNullable<ServiceWorkerHandlers[typeof type]>) {
        handlers[type] = handler;
      },
    },
    caches: {
      async open() { return cache; },
      async match() { return undefined; },
      async delete(key: string) { deletedCaches.push(key); return true; },
    },
    fetch: async (path: string) => {
      if (path !== '/offline-scanner') throw new Error(`Unexpected fetch ${path}`);
      return new Response(html, { status: launcherStatus });
    },
    location: { origin: 'https://scanner.example' },
    URL,
    Response,
  };
  vm.runInNewContext(readFileSync('public/scanner-sw.js', 'utf8'), context);
  return { handlers, deletedCaches, addedPaths, storedPaths };
}

async function runExtendableHandler(handler: ((event: ExtendableEvent) => void) | undefined) {
  assert.ok(handler);
  let pending: Promise<unknown> | undefined;
  handler({ waitUntil(promise) { pending = promise; } });
  assert.ok(pending);
  await pending;
}

const failedLauncher = serviceWorkerHarness({ launcherStatus: 503 });
await assert.rejects(runExtendableHandler(failedLauncher.handlers.install), /Offline launcher request failed/);

const failedDependency = serviceWorkerHarness({ failPaths: new Set(['/_next/static/chunks/runtime.js']) });
await assert.rejects(runExtendableHandler(failedDependency.handlers.install), /Could not cache/);
assert.deepEqual(failedDependency.storedPaths, []);

const failedOptional = serviceWorkerHarness({ failPaths: new Set(['/scanner-icon-512.svg']) });
await runExtendableHandler(failedOptional.handlers.install);
await runExtendableHandler(failedOptional.handlers.activate);
assert.deepEqual(
  [...failedOptional.addedPaths].sort(),
  [
    '/_next/static/chunks/app.css',
    '/_next/static/chunks/runtime.js',
    '/manifest.webmanifest',
    '/scanner-icon-192.svg',
  ].sort(),
);
assert.deepEqual(failedOptional.storedPaths, ['/offline-scanner']);
assert.deepEqual(failedOptional.deletedCaches, []);

const routeBoundary = readFileSync('app/error.tsx', 'utf8');
const globalBoundary = readFileSync('app/global-error.tsx', 'utf8');
const admission = readFileSync('lib/admission.ts', 'utf8');
const scanner = readFileSync('components/Scanner.tsx', 'utf8');

assert.match(routeBoundary, /reset:\s*\(\) => void/);
assert.match(globalBoundary, /Global application error/);
assert.match(admission, /Offline storage is unavailable on this device/);
assert.match(scanner, /transient camera\/canvas frame failure/);

console.log('PASS: storage denial, recovery boundaries, fail-closed migration retries, offline cache promotion, connected admission fallback, and scanner frame containment are guarded.');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
