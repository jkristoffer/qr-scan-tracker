const MANAGE_PIN_PATTERN = /^\d{4}$/;
const HASH_ALGORITHM = 'PBKDF2';
const HASH_DIGEST = 'SHA-256';
const HASH_ITERATIONS = 100_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const VERIFIER_PREFIX = 'pbkdf2-sha256';

export function isValidManagePin(pin: string): boolean {
  return MANAGE_PIN_PATTERN.test(pin);
}

export function manageAccessStorageKey(sessionId: string): string {
  return `manage-access:${sessionId}`;
}

export async function hashManagePin(pin: string): Promise<string> {
  if (!isValidManagePin(pin)) throw new Error('Manage PIN must be exactly four digits');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePinHash(pin, salt, HASH_ITERATIONS);
  return `${VERIFIER_PREFIX}$${HASH_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyManagePin(pin: string, verifier: string): Promise<boolean> {
  if (!isValidManagePin(pin)) return false;

  const parts = verifier.split('$');
  if (parts.length !== 4 || parts[0] !== VERIFIER_PREFIX) return false;

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isSafeInteger(iterations) || iterations <= 0) return false;

  try {
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    const actual = await derivePinHash(pin, salt, iterations);
    if (actual.length !== expected.length) return false;

    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
}

async function derivePinHash(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const saltBuffer = salt.slice().buffer as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    { name: HASH_ALGORITHM },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: HASH_ALGORITHM, hash: HASH_DIGEST, salt: saltBuffer, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
