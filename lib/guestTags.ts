export function normalizeGuestTag(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function guestTagKey(value: string | null | undefined): string {
  return normalizeGuestTag(value)?.toLowerCase() || '';
}

export function distinctGuestTags(values: Array<string | null | undefined>): string[] {
  const tags = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeGuestTag(value);
    if (!normalized) continue;
    const key = guestTagKey(normalized);
    if (!tags.has(key)) tags.set(key, normalized);
  }
  return [...tags.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function compareGuestTags(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: 'asc' | 'desc'
): number {
  const aTag = normalizeGuestTag(a);
  const bTag = normalizeGuestTag(b);
  if (!aTag && !bTag) return 0;
  if (!aTag) return 1;
  if (!bTag) return -1;
  const difference = aTag.localeCompare(bTag, undefined, { sensitivity: 'base' });
  return direction === 'asc' ? difference : -difference;
}
