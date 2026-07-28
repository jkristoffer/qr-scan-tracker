import assert from 'node:assert/strict';
import {
  UNTAGGED_TAG_KEY,
  createDefaultManageFilterState,
  filterManageItems,
  getManageFacetCounts,
  matchesManageFilters,
  tagFilterKey,
} from '../lib/manageFilters';
import { Item } from '../lib/types';

const item = (overrides: Partial<Item>): Item => ({
  id: overrides.id || 'id',
  session_id: 'session',
  barcode: 'barcode',
  name: overrides.name || 'Guest',
  email: null,
  tag: null,
  isVIP: false,
  isStaff: false,
  created_at: '2026-07-01T00:00:00.000Z',
  scanned: false,
  scanned_at: null,
  scanned_by: null,
  removed: false,
  qr_email_sent_at: null,
  qr_email_resend_id: null,
  qr_email_last_error: null,
  ...overrides,
});

const guests = [
  item({ id: 'vip', name: 'VIP', isVIP: true, tag: 'Sponsor', scanned: true, scanned_at: '2026-07-03T00:00:00.000Z' }),
  item({ id: 'staff', name: 'Staff', isStaff: true, tag: 'Crew' }),
  item({ id: 'both', name: 'Both', isVIP: true, isStaff: true, tag: 'Sponsor' }),
  item({ id: 'guest', name: 'Guest', tag: null }),
];

const state = createDefaultManageFilterState();
state.types = ['vip', 'staff'];
state.tags = ['sponsor'];
assert.deepEqual(filterManageItems(guests, state).map(guest => guest.id), ['vip', 'both']);

state.types = ['guest'];
state.tags = [];
assert.equal(matchesManageFilters(guests[3], state), true);
assert.equal(matchesManageFilters(guests[0], state), false);

state.types = [];
state.statuses = ['pending'];
assert.deepEqual(filterManageItems(guests, state).map(guest => guest.id), ['staff', 'both', 'guest']);

state.statuses = [];
state.tags = [UNTAGGED_TAG_KEY];
assert.deepEqual(filterManageItems(guests, state).map(guest => guest.id), ['guest']);
assert.equal(tagFilterKey('  '), UNTAGGED_TAG_KEY);

const counts = getManageFacetCounts(guests);
assert.deepEqual(counts, {
  total: 4,
  checkedIn: 1,
  pending: 3,
  vip: 2,
  staff: 2,
  guest: 1,
  tags: [
    { key: 'crew', label: 'Crew', count: 1 },
    { key: 'sponsor', label: 'Sponsor', count: 2 },
  ],
  untagged: 1,
});

console.log('PASS: Manage filters combine status/type/tag facets, classify overlaps, support Untagged, and count Active facets.');
