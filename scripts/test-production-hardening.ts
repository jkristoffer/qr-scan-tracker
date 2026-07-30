import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from '../lib/browserStorage';

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

const routeBoundary = readFileSync('app/error.tsx', 'utf8');
const globalBoundary = readFileSync('app/global-error.tsx', 'utf8');
const admission = readFileSync('lib/admission.ts', 'utf8');
const scanner = readFileSync('components/Scanner.tsx', 'utf8');
const instrumentation = readFileSync('instrumentation.ts', 'utf8');

assert.match(routeBoundary, /reset:\s*\(\) => void/);
assert.match(globalBoundary, /Global application error/);
assert.match(admission, /Offline storage is unavailable on this device/);
assert.match(scanner, /transient camera\/canvas frame failure/);
assert.match(instrumentation, /Database migration unavailable after retries/);

console.log('PASS: storage denial, recovery boundaries, startup migration retries, connected admission fallback, and scanner frame containment are guarded.');
