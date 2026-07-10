const TICKET_CODE_PATTERN = /^TKT-(\d+)$/;

export function nextTicketCode(barcodes: Iterable<string>): string {
  let max = 0;

  for (const barcode of barcodes) {
    const match = barcode.match(TICKET_CODE_PATTERN);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }

  return formatTicketCode(max + 1);
}

export function allocateTicketCodes(barcodes: Iterable<string>, count: number): string[] {
  const firstNumber = Number.parseInt(nextTicketCode(barcodes).slice(4), 10);
  return Array.from({ length: count }, (_, index) => formatTicketCode(firstNumber + index));
}

function formatTicketCode(value: number): string {
  return `TKT-${String(value).padStart(4, '0')}`;
}
