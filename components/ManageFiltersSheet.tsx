'use client';

import { useState } from 'react';
import {
  cloneManageFilterState,
  createDefaultManageFilterState,
  GuestSort,
  GuestStatusFilter,
  GuestTypeFilter,
  ManageFilterState,
  SortDirection,
  UNTAGGED_TAG_KEY,
} from '@/lib/manageFilters';

interface TagOption {
  key: string;
  label: string;
  count: number;
}

interface ManageFiltersSheetProps {
  appliedState: ManageFilterState;
  tagOptions: TagOption[];
  untaggedCount: number;
  onApply: (state: ManageFilterState) => void;
  onClose: () => void;
}

const statusOptions: Array<{ value: GuestStatusFilter; label: string }> = [
  { value: 'checked_in', label: 'Checked in' },
  { value: 'pending', label: 'Pending' },
];

const typeOptions: Array<{ value: GuestTypeFilter; label: string }> = [
  { value: 'vip', label: 'VIP' },
  { value: 'staff', label: 'Staff' },
  { value: 'guest', label: 'Guest' },
];

const sortOptions: Array<{ value: GuestSort; label: string }> = [
  { value: 'added', label: 'Added' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'tag', label: 'Tag' },
];

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter(current => current !== value) : [...values, value];
}

function OptionButton({
  checked,
  label,
  count,
  onClick,
}: {
  checked: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44,
        border: `1px solid ${checked ? '#161618' : '#dcdcd8'}`, borderRadius: 10,
        padding: '8px 11px', background: checked ? '#f0f0ed' : '#fff', color: '#161618',
        fontFamily: 'inherit', fontSize: 13.5, fontWeight: checked ? 750 : 600, cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 6, border: `1px solid ${checked ? '#161618' : '#c8c8c4'}`, background: checked ? '#161618' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
        {checked ? '✓' : ''}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {typeof count === 'number' && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#8a8a86' }}>{count}</span>}
    </button>
  );
}

export function ManageFiltersSheet({ appliedState, tagOptions, untaggedCount, onApply, onClose }: ManageFiltersSheetProps) {
  const [draft, setDraft] = useState(() => cloneManageFilterState(appliedState));

  const updateDraft = (change: (state: ManageFilterState) => ManageFilterState) => {
    setDraft(current => change(cloneManageFilterState(current)));
  };

  const reset = () => setDraft(createDefaultManageFilterState());

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-filters-title"
        onClick={event => event.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto', background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 30px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}
      >
        <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 20px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 id="manage-filters-title" style={{ fontSize: 20, margin: 0 }}>Filter and sort guests</h2>
            <div style={{ marginTop: 4, fontSize: 12.5, color: '#777773' }}>Choose several options within each section.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close filters" style={{ width: 32, height: 32, border: '1px solid #e2e2de', borderRadius: 9, background: '#fff', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '0.14em', color: '#9a9a96', marginBottom: 8 }}>STATUS</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {statusOptions.map(option => (
              <OptionButton
                key={option.value}
                label={option.label}
                checked={draft.statuses.includes(option.value)}
                onClick={() => updateDraft(current => ({ ...current, statuses: toggleValue(current.statuses, option.value) }))}
              />
            ))}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '0.14em', color: '#9a9a96', marginBottom: 8 }}>GUEST TYPE</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {typeOptions.map(option => (
              <OptionButton
                key={option.value}
                label={option.label}
                checked={draft.types.includes(option.value)}
                onClick={() => updateDraft(current => ({ ...current, types: toggleValue(current.types, option.value) }))}
              />
            ))}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '0.14em', color: '#9a9a96', marginBottom: 8 }}>TAG</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {tagOptions.map(option => (
              <OptionButton
                key={option.key}
                label={option.label}
                count={option.count}
                checked={draft.tags.includes(option.key)}
                onClick={() => updateDraft(current => ({ ...current, tags: toggleValue(current.tags, option.key) }))}
              />
            ))}
            <OptionButton
              label="Untagged"
              count={untaggedCount}
              checked={draft.tags.includes(UNTAGGED_TAG_KEY)}
              onClick={() => updateDraft(current => ({ ...current, tags: toggleValue(current.tags, UNTAGGED_TAG_KEY) }))}
            />
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '0.14em', color: '#9a9a96', marginBottom: 8 }}>SORT BY</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {sortOptions.map(option => {
              const checked = draft.sort === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => updateDraft(current => ({ ...current, sort: option.value, direction: option.value === 'tag' ? 'asc' : current.direction }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, border: `1px solid ${checked ? '#161618' : '#dcdcd8'}`, borderRadius: 10, padding: '8px 11px', background: checked ? '#f0f0ed' : '#fff', color: '#161618', fontFamily: 'inherit', fontSize: 13.5, fontWeight: checked ? 750 : 600, cursor: 'pointer', textAlign: 'left' }}
                >
                  <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: '50%', border: `1px solid ${checked ? '#161618' : '#c8c8c4'}`, background: checked ? '#161618' : '#fff', boxShadow: checked ? 'inset 0 0 0 5px #fff' : 'none', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{option.label}</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {(['desc', 'asc'] as SortDirection[]).map(direction => {
              const active = draft.direction === direction;
              const label = draft.sort === 'tag' ? (direction === 'asc' ? 'A to Z' : 'Z to A') : (direction === 'asc' ? 'Oldest first' : 'Newest first');
              return (
                <button key={direction} type="button" aria-pressed={active} onClick={() => updateDraft(current => ({ ...current, direction }))} style={{ flex: 1, height: 40, border: `1px solid ${active ? '#161618' : '#dcdcd8'}`, borderRadius: 9, background: active ? '#161618' : '#fff', color: active ? '#fff' : '#4a4a46', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
              );
            })}
          </div>
        </div>

        <div style={{ position: 'sticky', bottom: -30, display: 'flex', gap: 8, margin: '24px -20px -30px', padding: '12px 20px calc(12px + env(safe-area-inset-bottom))', background: '#fbfbfa', borderTop: '1px solid #e6e6e2', boxShadow: '0 -8px 18px rgba(20,20,22,0.06)', zIndex: 2 }}>
          <button type="button" onClick={reset} style={{ flex: 1, height: 46, border: '1px solid #d7d7d3', borderRadius: 10, background: '#fff', color: '#161618', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Reset</button>
          <button type="button" onClick={() => onApply(draft)} style={{ flex: 1, height: 46, border: 'none', borderRadius: 10, background: '#161618', color: '#fff', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Apply</button>
        </div>
      </section>
    </div>
  );
}
