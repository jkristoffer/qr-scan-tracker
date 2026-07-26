'use client';

import { useScanStore } from '@/store/useScanStore';
import type { Item } from '@/lib/types';

function initials(name: string) {
  return name.split(' ').map(x => x[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

interface ItemListProps {
  onManualCheckIn: (item: Item) => void;
  pendingItemId: string | null;
  failedItemId: string | null;
  admissionBusy: boolean;
}

export function ItemList({ onManualCheckIn, pendingItemId, failedItemId, admissionBusy }: ItemListProps) {
  const { filteredItems, searchQuery, setSearchQuery, lastScan } = useScanStore();

  const lastBarcode = lastScan?.result === 'success' ? lastScan.barcode : null;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 24px' }}>
      {/* Search */}
      <div style={{ padding: '8px 4px 10px' }}>
        <input
          type="text"
          aria-label="Search guests"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search guests…"
          style={{ width: '100%', border: '1px solid #e6e6e2', background: '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontFamily: "'Helvetica Neue', Helvetica, sans-serif", outline: 'none', color: '#161618' }}
          onFocus={e => (e.target.style.borderColor = '#161618')}
          onBlur={e => (e.target.style.borderColor = '#e6e6e2')}
        />
      </div>

      {filteredItems.length === 0 && (
        <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.12em', color: '#b4b4b0' }}>
          {searchQuery ? 'NO MATCHES' : 'NO GUESTS'}
        </div>
      )}

      {filteredItems.map(item => {
        const isIn = item.scanned;
        const isFlash = item.barcode === lastBarcode;
        const isPending = item.id === pendingItemId;
        const hasFailed = item.id === failedItemId;
        return (
          <div
            key={item.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 13,
              padding: '16px 16px',
              background: isFlash ? 'color-mix(in oklch, oklch(0.74 0.17 152) 14%, white)' : '#ffffff',
              border: `1px solid ${isFlash ? 'oklch(0.74 0.17 152)' : '#ededea'}`,
              borderRadius: 14, marginBottom: 8,
              transition: 'background 0.4s, border-color 0.4s',
            }}
          >
            {/* Avatar */}
            <div style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              background: isIn ? '#161618' : '#ffffff',
              color: isIn ? '#ffffff' : '#161618',
              border: `1px solid ${isIn ? '#161618' : '#dadad6'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700,
            }}>
              {initials(item.name)}
            </div>

            {/* Name + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.name}
                </div>
                {item.isVIP && <span style={{ flexShrink: 0, border: '1px solid #b68b2f', background: '#fff8df', color: '#755710', borderRadius: 999, padding: '2px 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fontWeight: 700, letterSpacing: '0.1em' }}>VIP</span>}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#9a9a96', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isIn
                  ? `This gate · ${item.scanned_at ? new Date(item.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`
                  : item.barcode}
              </div>
              {hasFailed && !isIn && (
                <div role="alert" style={{ marginTop: 5, color: '#a1261f', fontSize: 12, fontWeight: 600 }}>
                  Couldn’t check in. Try again.
                </div>
              )}
            </div>

            {isIn ? (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#161618', color: '#ffffff', border: '1px solid #161618',
                borderRadius: 999, padding: '6px 12px',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                flexShrink: 0,
              }}>
                IN ✓
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onManualCheckIn(item)}
                disabled={admissionBusy}
                aria-busy={isPending}
                aria-label={`Check in ${item.name}`}
                style={{
                  minHeight: 44, minWidth: 92, padding: '8px 12px', flexShrink: 0,
                  border: `1px solid ${hasFailed && !admissionBusy ? '#a1261f' : admissionBusy ? '#cfcfca' : '#161618'}`,
                  borderRadius: 10, background: admissionBusy ? '#ededeb' : '#fff',
                  color: isPending || admissionBusy ? '#6f6f6b' : '#161618', cursor: admissionBusy ? 'default' : 'pointer',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                }}
              >
                {isPending ? 'CHECKING…' : 'CHECK IN'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
