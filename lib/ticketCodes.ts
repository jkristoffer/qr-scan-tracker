const TICKET_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TICKET_CODE_LENGTH = 16;
const MAX_GENERATION_ATTEMPTS = 20;

export function generateTicketCode(barcodes: Iterable<string> = []): string {
  const usedCodes = new Set(barcodes);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const randomBytes = new Uint8Array(TICKET_CODE_LENGTH);
    globalThis.crypto.getRandomValues(randomBytes);
    const suffix = Array.from(
      randomBytes,
      byte => TICKET_CODE_ALPHABET[byte & 31],
    ).join('');
    const code = `TKT-${suffix}`;
    if (!usedCodes.has(code)) return code;
  }

  throw new Error('Could not generate a unique ticket code');
}

export function allocateTicketCodes(barcodes: Iterable<string>, count: number): string[] {
  const usedCodes = new Set(barcodes);
  const codes: string[] = [];

  while (codes.length < count) {
    const code = generateTicketCode(usedCodes);
    usedCodes.add(code);
    codes.push(code);
  }

  return codes;
}
