import { compareGuestTags, guestTagKey, normalizeGuestTag } from '@/lib/guestTags';
import { Item } from '@/lib/types';

export const UNTAGGED_TAG_KEY = '__untagged__';

export type GuestStatusFilter = 'checked_in' | 'pending';
export type GuestTypeFilter = 'vip' | 'staff' | 'guest';
export type GuestSort = 'checked_in' | 'added' | 'tag';
export type SortDirection = 'desc' | 'asc';

export interface ManageFilterState {
  statuses: GuestStatusFilter[];
  types: GuestTypeFilter[];
  tags: string[];
  sort: GuestSort;
  direction: SortDirection;
}

export interface ManageFacetCounts {
  total: number;
  checkedIn: number;
  pending: number;
  vip: number;
  staff: number;
  guest: number;
  tags: Array<{ key: string; label: string; count: number }>;
  untagged: number;
}

export function createDefaultManageFilterState(): ManageFilterState {
  return { statuses: [], types: [], tags: [], sort: 'added', direction: 'desc' };
}

export function cloneManageFilterState(state: ManageFilterState): ManageFilterState {
  return {
    statuses: [...state.statuses],
    types: [...state.types],
    tags: [...state.tags],
    sort: state.sort,
    direction: state.direction,
  };
}

export function hasManageFilters(state: ManageFilterState): boolean {
  return state.statuses.length > 0 || state.types.length > 0 || state.tags.length > 0;
}

export function countManageFilterSelections(state: ManageFilterState): number {
  return state.statuses.length + state.types.length + state.tags.length;
}

export function tagFilterKey(value: string | null | undefined): string {
  return guestTagKey(value) || UNTAGGED_TAG_KEY;
}

export function matchesManageFilters(item: Item, state: ManageFilterState): boolean {
  const statusMatches = state.statuses.length === 0 || state.statuses.some(status =>
    status === 'checked_in' ? item.scanned : !item.scanned
  );
  const typeMatches = state.types.length === 0 || state.types.some(type => {
    if (type === 'vip') return item.isVIP;
    if (type === 'staff') return item.isStaff;
    return !item.isVIP && !item.isStaff;
  });
  const tagMatches = state.tags.length === 0 || state.tags.includes(tagFilterKey(item.tag));
  return statusMatches && typeMatches && tagMatches;
}

export function filterManageItems(items: Item[], state: ManageFilterState): Item[] {
  return items.filter(item => matchesManageFilters(item, state));
}

export function compareManageItems(a: Item, b: Item, state: ManageFilterState): number {
  if (state.sort === 'tag') {
    const difference = compareGuestTags(a.tag, b.tag, state.direction);
    return difference !== 0 ? difference : a.name.localeCompare(b.name);
  }

  const aTimestamp = state.sort === 'checked_in' ? a.scanned_at : a.created_at;
  const bTimestamp = state.sort === 'checked_in' ? b.scanned_at : b.created_at;
  if (!aTimestamp && !bTimestamp) return a.name.localeCompare(b.name);
  if (!aTimestamp) return 1;
  if (!bTimestamp) return -1;

  const difference = new Date(aTimestamp).getTime() - new Date(bTimestamp).getTime();
  if (difference !== 0) return state.direction === 'asc' ? difference : -difference;
  return a.name.localeCompare(b.name);
}

export function getManageFacetCounts(items: Item[]): ManageFacetCounts {
  const tags = new Map<string, { key: string; label: string; count: number }>();
  let checkedIn = 0;
  let vip = 0;
  let staff = 0;
  let guest = 0;
  let untagged = 0;

  for (const item of items) {
    if (item.scanned) checkedIn += 1;
    if (item.isVIP) vip += 1;
    if (item.isStaff) staff += 1;
    if (!item.isVIP && !item.isStaff) guest += 1;

    const normalizedTag = normalizeGuestTag(item.tag);
    if (!normalizedTag) {
      untagged += 1;
      continue;
    }
    const key = tagFilterKey(normalizedTag);
    const existing = tags.get(key);
    if (existing) existing.count += 1;
    else tags.set(key, { key, label: normalizedTag, count: 1 });
  }

  return {
    total: items.length,
    checkedIn,
    pending: items.length - checkedIn,
    vip,
    staff,
    guest,
    tags: [...tags.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
    untagged,
  };
}
