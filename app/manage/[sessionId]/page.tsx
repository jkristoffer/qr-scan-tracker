'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ManageAccessGate } from '@/components/ManageAccessGate';
import { ManageSecuritySheet } from '@/components/ManageSecuritySheet';
import { ManageFiltersSheet } from '@/components/ManageFiltersSheet';
import { GuestEditSheet } from '@/components/GuestEditSheet';
import { QrPostcardSheet } from '@/components/QrPostcardSheet';
import { VipToggle } from '@/components/VipToggle';
import { StaffToggle } from '@/components/StaffToggle';
import { manageAccessStorageKey } from '@/lib/managePassword';
import { db } from '@/lib/supabase';
import { toQrDataUrl } from '@/lib/qr';
import { generateTicketCode } from '@/lib/ticketCodes';
import { renderTicketPassImage } from '@/lib/ticketPass';
import { createZip } from '@/lib/zip';
import { distinctGuestTags, guestTagKey } from '@/lib/guestTags';
import {
  compareManageItems,
  countManageFilterSelections,
  createDefaultManageFilterState,
  filterManageItems,
  getManageFacetCounts,
  ManageFilterState,
  tagFilterKey,
  UNTAGGED_TAG_KEY,
} from '@/lib/manageFilters';
import { Item, ManageSession } from '@/lib/types';

interface GuestCard {
  item: Item;
  dataUrl: string;
}

type Tab = 'active' | 'removed';
type AccessState = 'checking' | 'locked' | 'unlocked';

function ticketImageFilename(item: Item, usedNames: Map<string, number>) {
  const safePart = (value: string) => value.trim().normalize('NFKD').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'guest';
  const base = `${safePart(item.name)}${item.email ? `_${safePart(item.email)}` : ''}`;
  const count = (usedNames.get(base) || 0) + 1;
  usedNames.set(base, count);
  return `${base}${count === 1 ? '' : `_${count}`}.jpg`;
}

function sortedActive(cards: GuestCard[], pinnedId?: string): GuestCard[] {
  return [...cards].sort((a, b) => {
    if (a.item.id === pinnedId) return -1;
    if (b.item.id === pinnedId) return 1;
    if (a.item.scanned !== b.item.scanned) return a.item.scanned ? 1 : -1;
    return a.item.name.localeCompare(b.item.name);
  });
}

function sortedGuestCards(cards: GuestCard[], filterState: ManageFilterState, pinnedId?: string): GuestCard[] {
  return [...cards].sort((a, b) => {
    if (a.item.id === pinnedId) return -1;
    if (b.item.id === pinnedId) return 1;
    return compareManageItems(a.item, b.item, filterState);
  });
}

function GuestTagBadge({ tag }: { tag: string | null }) {
  if (!tag) return null;
  return (
    <span
      title={tag}
      style={{ flexShrink: 1, minWidth: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid #d8d8d4', background: '#f4f4f2', color: '#5a5a56', borderRadius: 999, padding: '3px 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em' }}
    >
      {tag}
    </span>
  );
}

function GuestStatusBadge({ scanned }: { scanned: boolean }) {
  return (
    <span style={{ flexShrink: 0, border: `1px solid ${scanned ? '#cfe5d3' : '#e2e2de'}`, background: scanned ? '#eff8f1' : '#f4f4f2', color: scanned ? '#3d7350' : '#777773', borderRadius: 999, padding: '3px 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em' }}>
      {scanned ? 'CHECKED IN' : 'PENDING'}
    </span>
  );
}

function GuestSelectionButton({ name, selected, onToggle }: { name: string; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${selected ? 'Deselect' : 'Select'} ${name}`}
      aria-pressed={selected}
      style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, border: `1px solid ${selected ? '#161618' : '#d7d7d3'}`, background: selected ? '#161618' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 17, fontWeight: 800 }}
    >
      {selected ? '✓' : ''}
    </button>
  );
}

function GuestTimeColumn({ item }: { item: Item }) {
  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return null;
    return {
      date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    };
  };
  const added = formatTimestamp(item.created_at);
  const checkedIn = formatTimestamp(item.scanned_at);

  return (
    <div style={{ flexShrink: 0, width: 132, alignSelf: 'stretch', borderLeft: '1px solid #ececea', paddingLeft: 13, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 9 }}>
      {([
        { label: 'ADDED', value: added },
        { label: 'CHECKED IN', value: checkedIn },
      ]).map(({ label, value }) => (
        <div key={label}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: '#9a9a96' }}>{label}</div>
          <div style={{ marginTop: 2, fontSize: 13, fontWeight: 700, color: value ? '#333330' : '#b4b4b0', whiteSpace: 'nowrap' }}>
            {value ? value.time : '—'}
          </div>
          {value && <div style={{ marginTop: 1, fontSize: 10, color: '#777773' }}>{value.date}</div>}
        </div>
      ))}
    </div>
  );
}

type CountTone = 'vip' | 'staff' | 'guest' | 'tag';

function CountCard({ label, value, tone, active, onClick }: { label: string; value: number; tone: CountTone; active: boolean; onClick: () => void }) {
  const palette = {
    vip: { background: '#fbf7ea', border: '#ead8a3', label: '#806520' },
    staff: { background: '#eff6ff', border: '#c9ddf5', label: '#285ea8' },
    guest: { background: '#eff8f1', border: '#cfe5d3', label: '#3d7350' },
    tag: { background: '#f5f5f3', border: '#deded9', label: '#777773' },
  }[tone];

  return (
    <button type="button" onClick={onClick} aria-pressed={active} style={{ display: 'inline-flex', alignItems: 'center', gap: tone === 'tag' ? 6 : 8, flex: '0 0 auto', borderRadius: 999, padding: tone === 'tag' ? '5px 8px' : '6px 10px', background: active ? '#161618' : palette.background, border: `1px solid ${active ? '#161618' : palette.border}`, color: '#161618', cursor: 'pointer', fontFamily: 'inherit' }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: tone === 'tag' ? 8 : 8.5, fontWeight: 700, letterSpacing: '0.1em', color: active ? '#fff' : palette.label, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: tone === 'tag' ? 105 : 150 }}>{label}</span>
      <span style={{ fontSize: tone === 'tag' ? 14 : 16, lineHeight: 1, fontWeight: 800, color: active ? '#fff' : '#30302d' }}>{value}</span>
    </button>
  );
}

export default function ManagePage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const router = useRouter();

  const [session, setSession] = useState<ManageSession | null>(null);
  const [cards, setCards] = useState<GuestCard[]>([]);
  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [loadingData, setLoadingData] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addGuestOpen, setAddGuestOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const [filterState, setFilterState] = useState<ManageFilterState>(() => createDefaultManageFilterState());
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addTag, setAddTag] = useState('');
  const [addIsVIP, setAddIsVIP] = useState(false);
  const [addIsStaff, setAddIsStaff] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<GuestCard | null>(null);
  const [actionTarget, setActionTarget] = useState<GuestCard | null>(null);
  const [undoTarget, setUndoTarget] = useState<GuestCard | null>(null);
  const [editTarget, setEditTarget] = useState<GuestCard | null>(null);
  const [postcardTarget, setPostcardTarget] = useState<GuestCard | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | undefined>(undefined);
  const [expandedQr, setExpandedQr] = useState<Set<string>>(new Set());
  const [activeScanners, setActiveScanners] = useState<string[]>([]);
  const [emailSending, setEmailSending] = useState<Set<string>>(new Set());
  const [emailSummary, setEmailSummary] = useState<string | null>(null);
  const [bulkDownloadProgress, setBulkDownloadProgress] = useState<number | null>(null);
  const [bulkDownloadTotal, setBulkDownloadTotal] = useState(0);
  const [bulkDownloadError, setBulkDownloadError] = useState<string | null>(null);
  const [bulkTagMode, setBulkTagMode] = useState(false);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState('');
  const [bulkTagSaving, setBulkTagSaving] = useState(false);
  const [bulkTagError, setBulkTagError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const toggleQr = (id: string) =>
    setExpandedQr(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const inputRef = useRef<HTMLInputElement>(null);
  const pinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (accessState !== 'unlocked') return;
    const channel = db.watchPresence(sessionId, setActiveScanners);
    return () => { channel.unsubscribe(); };
  }, [accessState, sessionId]);

  useEffect(() => {
    if (accessState !== 'unlocked') return;
    const channel = db.subscribeToItems(sessionId, payload => {
      if (payload.eventType !== 'UPDATE') return;
      const item = payload.new as Item;
      setCards(prev => {
        const existing = prev.find(card => card.item.id === item.id);
        if (!existing) {
          void toQrDataUrl(item.barcode).then(dataUrl => {
            setCards(current => current.some(card => card.item.id === item.id) ? current : [...current, { item, dataUrl }]);
          });
          return prev;
        }
        if (existing.item.barcode !== item.barcode) {
          const expectedBarcode = item.barcode;
          void toQrDataUrl(expectedBarcode).then(dataUrl => {
            setCards(current => current.map(card =>
              card.item.id === item.id && card.item.barcode === expectedBarcode
                ? { ...card, dataUrl }
              : card
            ));
          }).catch(() => undefined);
        }
        return prev.map(card => card.item.id === item.id ? { ...card, item } : card);
      });
    });
    return () => { channel.unsubscribe(); };
  }, [accessState, sessionId]);

  useEffect(() => {
    let cancelled = false;
    const checkAccess = async () => {
      try {
        const manageSession = await db.getManageSession(sessionId);
        if (cancelled) return;
        setSession(manageSession);
        const storedAccess = sessionStorage.getItem(manageAccessStorageKey(sessionId));
        const unlocked = Boolean(manageSession.manage_password_hash && storedAccess === manageSession.manage_password_hash);
        if (unlocked) setLoadingData(true);
        setAccessState(unlocked ? 'unlocked' : 'locked');
      } catch {
        router.push('/');
      }
    };
    checkAccess();
    return () => { cancelled = true; };
  }, [sessionId, router]);

  useEffect(() => {
    if (accessState !== 'unlocked') return;
    let cancelled = false;
    const loadItems = async () => {
      setLoadingData(true);
      try {
        const items = await db.getAllItems(sessionId);
        const generated = await Promise.all(items.map(async item => ({ item, dataUrl: await toQrDataUrl(item.barcode) })));
        if (!cancelled) setCards(generated);
      } catch {
        if (!cancelled) router.push('/');
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    };
    loadItems();
    return () => { cancelled = true; };
  }, [accessState, sessionId, router]);

  const pinTemporarily = useCallback((id: string) => {
    setPinnedId(id);
    if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    pinTimerRef.current = setTimeout(() => setPinnedId(undefined), 3000);
  }, []);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const barcode = generateTicketCode(cards.map(c => c.item.barcode));
      const item = await db.addItem(sessionId, name, barcode, addEmail.trim() || null, addIsVIP, addTag, addIsStaff);
      const dataUrl = await toQrDataUrl(barcode);
      setCards(prev => [...prev, { item, dataUrl }]);
      setAddName('');
      setAddEmail('');
      setAddTag('');
      setAddIsVIP(false);
      setAddIsStaff(false);
      setAddGuestOpen(false);
      setTab('active');
      pinTemporarily(item.id);
    } catch {
      setAddError('Could not add this guest. Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const replaceUpdatedItems = (items: Item[]) => {
    if (items.length === 0) return;
    const byId = new Map(items.map(item => [item.id, item]));
    setCards(prev => prev.map(card => byId.has(card.item.id) ? { ...card, item: byId.get(card.item.id)! } : card));
  };

  const sendQrEmails = async (itemIds: string[], force = false) => {
    if (itemIds.length === 0) return { sent: 0, skipped: 0, failed: 0 };
    setEmailSending(prev => new Set([...prev, ...itemIds]));
    try {
      const res = await fetch(`/api/qr-email/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Email send failed');
      replaceUpdatedItems(data.updatedItems || []);
      return {
        sent: data.sent?.length || 0,
        skipped: data.skipped?.length || 0,
        failed: data.failed?.length || 0,
      };
    } finally {
      setEmailSending(prev => {
        const next = new Set(prev);
        itemIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const handleSendOne = async (card: GuestCard) => {
    setEmailSummary(null);
    try {
      const result = await sendQrEmails([card.item.id], Boolean(card.item.qr_email_sent_at));
      setEmailSummary(`Email: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (error) {
      setEmailSummary(error instanceof Error ? error.message : 'Email send failed');
    }
  };

  const handleSendUnsent = async () => {
    const ids = activeCards
      .filter(card => card.item.email && !card.item.qr_email_sent_at)
      .map(card => card.item.id);
    if (ids.length === 0) {
      setEmailSummary('No unsent guests with email addresses.');
      return;
    }

    setEmailSummary(`Sending ${ids.length} email${ids.length === 1 ? '' : 's'}...`);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (let i = 0; i < ids.length; i += 20) {
        const result = await sendQrEmails(ids.slice(i, i + 20), false);
        sent += result.sent;
        skipped += result.skipped;
        failed += result.failed;
      }
      setEmailSummary(`Email: ${sent} sent, ${skipped} skipped, ${failed} failed`);
    } catch (error) {
      setEmailSummary(error instanceof Error ? error.message : 'Bulk email send failed');
    }
  };

  const handleRemove = async () => {
    if (!removeTarget || acting) return;
    setActing(true);
    try {
      const updated = await db.removeItem(removeTarget.item.id);
      setCards(prev => prev.map(c => c.item.id === updated.id ? { ...c, item: updated } : c));
      setRemoveTarget(null);
    } finally {
      setActing(false);
    }
  };

  const handleRestore = async (card: GuestCard) => {
    try {
      const updated = await db.restoreItem(card.item.id);
      setCards(prev => prev.map(c => c.item.id === updated.id ? { ...c, item: updated } : c));
      setTab('active');
      pinTemporarily(updated.id);
    } catch {
      /* ignore */
    }
  };

  const handleEditSaved = (item: Item, dataUrl?: string) => {
    const ticketDetailsChanged = Boolean(editTarget && (
      editTarget.item.name !== item.name
      || editTarget.item.email !== item.email
      || editTarget.item.isVIP !== item.isVIP
      || editTarget.item.isStaff !== item.isStaff
    ));
    setCards(prev => prev.map(card => card.item.id === item.id ? { ...card, item, dataUrl: dataUrl || card.dataUrl } : card));
    setEditTarget(null);
    pinTemporarily(item.id);
    setActionMessage(ticketDetailsChanged
      ? `${item.name} updated. Corrected pass is ready to send or print.`
      : `${item.name} tag updated.`);
  };

  const handleUndo = async () => {
    if (!undoTarget?.item.scanned_at || acting) return;
    const target = undoTarget;
    setActing(true);
    setActionMessage(null);
    try {
      const result = await db.undoItemCheckIn(sessionId, target.item.id, target.item.scanned_at!, 'Manage', 'manage');
      if (result.status === 'undone' && result.item) {
        setCards(prev => prev.map(card => card.item.id === result.item!.id ? { ...card, item: result.item! } : card));
        pinTemporarily(result.item.id);
        setActionMessage(`${target.item.name} check-in undone.`);
      } else {
        setActionMessage(result.status === 'stale'
          ? 'Check-in changed elsewhere. Refresh before trying again.'
          : 'Guest no longer exists.');
      }
      setUndoTarget(null);
    } catch {
      setActionMessage('Could not undo check-in. Try again.');
    } finally {
      setActing(false);
    }
  };

  const handleLock = () => {
    sessionStorage.removeItem(manageAccessStorageKey(sessionId));
    setSettingsOpen(false);
    setCards([]);
    setActiveScanners([]);
    setAccessState('locked');
  };

  const handleArchive = async () => {
    if (!session || archiving) return;
    setArchiving(true);
    try {
      await db.archiveSession(session.id);
      router.push('/');
    } finally {
      setArchiving(false);
    }
  };

  const handleUnlock = () => {
    setLoadingData(true);
    setAccessState('unlocked');
  };

  if (accessState === 'checking' || (accessState === 'unlocked' && loadingData)) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#5a5a5e' }}>LOADING…</div>
      </div>
    );
  }

  if (!session) return null;

  if (accessState === 'locked') {
    return (
      <ManageAccessGate
        session={session}
        onSessionChange={setSession}
        onUnlock={handleUnlock}
      />
    );
  }

  const activeCards = cards.filter(c => !c.item.removed);
  const removedCards = cards.filter(c => c.item.removed);
  const tagOptions = distinctGuestTags(cards.map(card => card.item.tag));
  const activeFacetCounts = getManageFacetCounts(activeCards.map(card => card.item));
  const allTagKeys = new Set(tagOptions.map(tag => tagFilterKey(tag)));
  const filterTagOptions = [
    ...tagOptions.map(tag => ({
      key: tagFilterKey(tag),
      label: tag,
      count: activeFacetCounts.tags.find(option => option.key === tagFilterKey(tag))?.count || 0,
    })),
    ...filterState.tags
      .filter(key => key !== '__untagged__' && !allTagKeys.has(key))
      .map(key => ({ key, label: key, count: 0 })),
  ];
  const filteredActive = filterManageItems(activeCards.map(card => card.item), filterState);
  const filteredRemoved = filterManageItems(removedCards.map(card => card.item), filterState);
  const activeCardById = new Map(activeCards.map(card => [card.item.id, card]));
  const removedCardById = new Map(removedCards.map(card => [card.item.id, card]));
  const displayActive = sortedGuestCards(filteredActive.map(item => activeCardById.get(item.id)!), filterState, pinnedId);
  const displayRemoved = sortedGuestCards(filteredRemoved.map(item => removedCardById.get(item.id)!), filterState, pinnedId);
  const visibleCards = tab === 'active' ? displayActive : displayRemoved;
  const visibleGuestIds = new Set(visibleCards.map(card => card.item.id));
  const selectedVisibleIds = [...selectedGuestIds].filter(id => visibleGuestIds.has(id));
  const allVisibleSelected = visibleCards.length > 0 && selectedVisibleIds.length === visibleCards.length;

  const toggleFacet = (dimension: 'statuses' | 'types' | 'tags', value: string) => {
    setFilterState(current => {
      const values = current[dimension] as string[];
      const nextValues = values.includes(value) ? values.filter(item => item !== value) : [...values, value];
      return { ...current, [dimension]: nextValues } as ManageFilterState;
    });
    setSelectedGuestIds(new Set());
  };

  const applyFilterState = (nextState: ManageFilterState) => {
    setFilterState({ statuses: [...nextState.statuses], types: [...nextState.types], tags: [...nextState.tags], sort: nextState.sort, direction: nextState.direction });
    setSelectedGuestIds(new Set());
    setBulkTagMode(false);
    setFiltersOpen(false);
  };

  const activeFilterCount = countManageFilterSelections(filterState);
  const sortLabel = filterState.sort === 'checked_in' ? 'Checked in' : filterState.sort === 'tag' ? 'Tag' : 'Added';

  const toggleGuestSelection = (id: string) => {
    setSelectedGuestIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkTagError(null);
  };

  const closeBulkTagMode = () => {
    if (bulkTagSaving) return;
    setBulkTagMode(false);
    setSelectedGuestIds(new Set());
    setBulkTag('');
    setBulkTagError(null);
  };

  const toggleSelectAllVisible = () => {
    setSelectedGuestIds(allVisibleSelected ? new Set() : new Set(visibleCards.map(card => card.item.id)));
    setBulkTagError(null);
  };

  const handleBulkTagUpdate = async (nextTag: string | null) => {
    if (selectedVisibleIds.length === 0 || bulkTagSaving) return;
    const normalizedTag = nextTag?.trim() || null;
    if (nextTag !== null && !normalizedTag) return;
    setBulkTagSaving(true);
    setBulkTagError(null);
    try {
      const updated = await db.updateItemsTag(sessionId, selectedVisibleIds, normalizedTag);
      replaceUpdatedItems(updated);
      setActionMessage(`${updated.length} guest${updated.length === 1 ? '' : 's'} ${normalizedTag ? `tagged “${normalizedTag}”.` : 'had their tag cleared.'}`);
      setBulkTagMode(false);
      setSelectedGuestIds(new Set());
      setBulkTag('');
    } catch {
      setBulkTagError('Could not update the selected guests. Please try again.');
    } finally {
      setBulkTagSaving(false);
    }
  };

  const handleBulkDownload = async (cardsToDownload: GuestCard[]) => {
    if (bulkDownloadProgress !== null || cardsToDownload.length === 0) return;
    setBulkDownloadProgress(0);
    setBulkDownloadTotal(cardsToDownload.length);
    setBulkDownloadError(null);
    setActionMessage('Pass downloads include only guests shown by the current view and filters.');
    try {
      const usedNames = new Map<string, number>();
      const entries: { name: string; data: Blob }[] = [];
      for (const [index, card] of cardsToDownload.entries()) {
        const data = await renderTicketPassImage(session.name, card.item, card.dataUrl);
        entries.push({ name: ticketImageFilename(card.item, usedNames), data });
        setBulkDownloadProgress(index + 1);
      }
      const zip = await createZip(entries);
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ticket-passes.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setActionMessage(`Downloaded ${cardsToDownload.length} pass${cardsToDownload.length === 1 ? '' : 'es'}. Only guests in the current view and filters were included.`);
    } catch {
      setBulkDownloadError('Could not prepare the ticket images. Please try again.');
      setActionMessage(null);
    } finally {
      setBulkDownloadProgress(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fbfbfa', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#161618' }}>

      {/* Header */}
      <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fbfbfa', borderBottom: '1px solid #ececea', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={() => router.push('/')} style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #e2e2de', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer', flexShrink: 0 }}>‹</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session?.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {activeScanners.length === 0 ? (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: '#c2c2be' }}>NO SCANNERS ACTIVE</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'oklch(0.74 0.17 152)', animation: 'liveDot 1.4s ease-in-out infinite', flexShrink: 0 }} />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: '#6a6a66', fontWeight: 700 }}>{activeScanners.length} ONLINE</span>
                  </div>
                  {activeScanners.map(name => (
                    <div key={name} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em', color: '#fff', background: '#161618', borderRadius: 999, padding: '2px 8px' }}>{name}</div>
                  ))}
                </>
              )}
            </div>
          </div>
          <button onClick={() => setSettingsOpen(true)} aria-label="Event settings" style={{ flexShrink: 0, width: 38, height: 38, border: '1px solid #e2e2de', background: '#fff', color: '#161618', borderRadius: 10, fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            ⋯
          </button>
          <button
            type="button"
            onClick={() => { setAddError(null); setAddGuestOpen(true); }}
            style={{ flexShrink: 0, padding: '9px 13px', background: '#fff', color: '#161618', border: '1px solid #dcdcd8', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Guest
          </button>
          <button
            type="button"
            onClick={() => void handleBulkDownload(visibleCards)}
            disabled={bulkDownloadProgress !== null || visibleCards.length === 0}
            style={{ flexShrink: 0, padding: '9px 16px', background: bulkDownloadProgress !== null || visibleCards.length === 0 ? '#d8d8d4' : '#161618', color: bulkDownloadProgress !== null || visibleCards.length === 0 ? '#8a8a86' : '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: bulkDownloadProgress !== null || visibleCards.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}
          >
            {bulkDownloadProgress !== null
              ? `Preparing ${bulkDownloadProgress}/${bulkDownloadTotal}`
              : visibleCards.length === 1 ? 'Download pass' : 'Download passes'}
          </button>
        </div>

        {/* Guest facets */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <CountCard label="VIP" value={activeFacetCounts.vip} tone="vip" active={filterState.types.includes('vip')} onClick={() => toggleFacet('types', 'vip')} />
          <CountCard label="STAFF" value={activeFacetCounts.staff} tone="staff" active={filterState.types.includes('staff')} onClick={() => toggleFacet('types', 'staff')} />
          <CountCard label="GUESTS" value={activeFacetCounts.guest} tone="guest" active={filterState.types.includes('guest')} onClick={() => toggleFacet('types', 'guest')} />
        </div>
        {filterTagOptions.length > 0 || activeFacetCounts.untagged > 0 ? (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #d8d8d4' }}>
            <div style={{ marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: '#9a9a96' }}>
              TAGS
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', paddingBottom: 3, scrollbarWidth: 'none' }}>
              {filterTagOptions.map(tag => (
                <CountCard
                  key={tag.key}
                  label={tag.label}
                  value={tag.count}
                  tone="tag"
                  active={filterState.tags.includes(tag.key)}
                  onClick={() => toggleFacet('tags', tag.key)}
                />
              ))}
              <CountCard label="UNTAGGED" value={activeFacetCounts.untagged} tone="tag" active={filterState.tags.includes(UNTAGGED_TAG_KEY)} onClick={() => toggleFacet('tags', UNTAGGED_TAG_KEY)} />
            </div>
          </div>
        ) : null}

        {/* List controls */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {tab === 'removed' && (
            <div style={{ display: 'flex', alignItems: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: '#777773' }}>
              REMOVED GUESTS
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                if (bulkTagMode) closeBulkTagMode();
                else {
                  setBulkTagMode(true);
                  setSelectedGuestIds(new Set());
                  setBulkTagError(null);
                }
              }}
              disabled={bulkTagSaving}
              aria-pressed={bulkTagMode}
              style={{ height: 32, borderRadius: 8, padding: '0 10px', border: `1px solid ${bulkTagMode ? '#161618' : '#dcdcd8'}`, background: bulkTagMode ? '#161618' : '#fff', color: bulkTagMode ? '#fff' : '#4a4a46', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: bulkTagSaving ? 'default' : 'pointer' }}
            >
              {bulkTagMode ? 'Cancel bulk edit' : 'Bulk edit tags'}
            </button>
            <button type="button" onClick={() => setFiltersOpen(true)} aria-label={`Open filters and sort, ${activeFilterCount} filters active`} style={{ height: 32, borderRadius: 8, padding: '0 11px', border: `1px solid ${activeFilterCount > 0 ? '#161618' : '#dcdcd8'}`, background: activeFilterCount > 0 ? '#161618' : '#fff', color: activeFilterCount > 0 ? '#fff' : '#4a4a46', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </button>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.1em', color: '#777773' }}>SORTED BY {sortLabel.toUpperCase()} {filterState.direction === 'desc' ? '↓' : '↑'}</span>
          </div>
        </div>
        {actionMessage && (
          <div role="alert" aria-live="polite" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: '#f0f0ed', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#5a5a56' }}>
            {actionMessage}
          </div>
        )}
        {bulkDownloadError && (
          <div role="alert" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'oklch(0.96 0.06 32)', fontSize: 11.5, color: '#b42318' }}>
            {bulkDownloadError}
          </div>
        )}
      </div>

      {/* Active guest list */}
      {tab === 'active' && (
        <div className="no-print" style={{ padding: bulkTagMode ? '10px 12px 230px' : '10px 12px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayActive.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>
              {activeFilterCount > 0 ? 'NO MATCHING GUESTS' : 'NO GUESTS YET'}
            </div>
          )}
          {displayActive.map(card => {
            const qrOpen = expandedQr.has(card.item.id);
            const pinned = card.item.id === pinnedId;
            const selected = selectedGuestIds.has(card.item.id);
            const checkinTime = card.item.scanned_at
              ? new Date(card.item.scanned_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
              : null;
            const emailSentTime = card.item.qr_email_sent_at
              ? new Date(card.item.qr_email_sent_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              : null;
            return (
              <div
                key={card.item.id}
                style={{
                  background: selected ? '#f0f0ed' : pinned ? 'oklch(0.96 0.04 152)' : '#fff',
                  border: card.item.isVIP
                    ? '1px solid #eee4c9'
                    : `1px solid ${selected ? '#161618' : pinned ? 'oklch(0.82 0.1 152)' : '#ececea'}`,
                  boxShadow: selected ? '0 0 0 2px rgba(22,22,24,0.08)' : pinned ? '0 0 0 3px oklch(0.82 0.1 152 / 0.45)' : 'none',
                  borderRadius: 14, padding: '12px 12px 12px 14px',
                  transition: 'background 0.4s, border-color 0.4s, box-shadow 0.4s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {bulkTagMode ? (
                    <GuestSelectionButton name={card.item.name} selected={selected} onToggle={() => toggleGuestSelection(card.item.id)} />
                  ) : (
                    <button
                      onClick={() => toggleQr(card.item.id)}
                      title={qrOpen ? 'Hide QR' : 'Show QR'}
                      style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, border: '1px solid #e2e2de', background: qrOpen ? '#161618' : '#f4f4f2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: qrOpen ? '#fff' : '#6a6a66', fontSize: 15, transition: 'background 0.15s' }}
                    >
                      ▦
                    </button>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.item.name}</div>
                      <GuestStatusBadge scanned={card.item.scanned} />
                      {card.item.isVIP && <span style={{ flexShrink: 0, border: '1px solid #ead8a3', background: '#f8f1dc', color: '#806520', borderRadius: 999, padding: '3px 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em' }}>VIP</span>}
                      {card.item.isStaff && <span style={{ flexShrink: 0, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '3px 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em' }}>STAFF</span>}
                      {!card.item.isVIP && !card.item.isStaff && <span style={{ flexShrink: 0, border: '1px solid #cfe5d3', background: '#eff8f1', color: '#3d7350', borderRadius: 999, padding: '3px 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em' }}>GUEST</span>}
                      <GuestTagBadge tag={card.item.tag} />
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#9a9a96', marginTop: 3, letterSpacing: '0.04em' }}>{card.item.barcode}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: card.item.email ? '#6a6a66' : '#b4b4b0', marginTop: 3, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {card.item.email || 'NO EMAIL'}
                    </div>
                    {card.item.scanned && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, background: 'oklch(0.95 0.05 152)', borderRadius: 6, padding: '3px 8px' }}>
                        <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.12em', color: 'oklch(0.45 0.14 152)', fontWeight: 700 }}>
                          CHECKED AT{checkinTime ? ` · ${checkinTime}` : ''}{card.item.scanned_by ? ` · ${card.item.scanned_by}` : ''}
                        </span>
                      </div>
                    )}
                    {(emailSentTime || card.item.qr_email_last_error) && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, background: card.item.qr_email_last_error ? 'oklch(0.96 0.06 32)' : '#f0f0ed', borderRadius: 6, padding: '3px 8px', maxWidth: '100%' }}>
                        <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em', color: card.item.qr_email_last_error ? 'oklch(0.48 0.16 32)' : '#6a6a66', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {card.item.qr_email_last_error ? `EMAIL ERROR: ${card.item.qr_email_last_error}` : `EMAIL SENT ${emailSentTime}`}
                        </span>
                      </div>
                    )}
                  </div>
                  <GuestTimeColumn item={card.item} />
                  {!bulkTagMode && (
                    <button
                      onClick={() => { setActionMessage(null); setActionTarget(card); }}
                      aria-label={`Actions for ${card.item.name}`}
                      style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, border: '1px solid #e2e2de', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6a6a66', fontSize: 18 }}
                    >
                      ⋯
                    </button>
                  )}
                </div>
                {qrOpen && !bulkTagMode && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 12 }}>
                    <div style={{ padding: 5, borderRadius: 12, background: '#fff' }}>
                      <img src={card.dataUrl} alt={card.item.barcode} style={{ display: 'block', width: 120, height: 120, borderRadius: 8 }} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPostcardTarget(card)}
                      style={{ minHeight: 40, padding: '8px 14px', borderRadius: 9, border: '1px solid #e2e2de', background: '#fff', color: '#161618', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      View, save or share pass
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Removed guest list */}
      {tab === 'removed' && (
        <div className="no-print" style={{ padding: bulkTagMode ? '10px 12px 230px' : '10px 12px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayRemoved.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>
              {activeFilterCount > 0 ? 'NO MATCHING REMOVED GUESTS' : 'NO REMOVED GUESTS'}
            </div>
          )}
          {displayRemoved.map(card => (
            <div key={card.item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: selectedGuestIds.has(card.item.id) ? '#f0f0ed' : card.item.id === pinnedId ? 'oklch(0.96 0.04 152)' : '#fff', border: card.item.isVIP ? '1px solid #eee4c9' : `1px solid ${selectedGuestIds.has(card.item.id) ? '#161618' : card.item.id === pinnedId ? 'oklch(0.82 0.1 152)' : '#ececea'}`, boxShadow: selectedGuestIds.has(card.item.id) ? '0 0 0 2px rgba(22,22,24,0.08)' : 'none', borderRadius: 14, padding: '12px 12px 12px 14px', opacity: card.item.id === pinnedId || selectedGuestIds.has(card.item.id) ? 1 : 0.7, transition: 'background 0.4s, border-color 0.4s, box-shadow 0.4s' }}>
              {bulkTagMode && (
                <GuestSelectionButton name={card.item.name} selected={selectedGuestIds.has(card.item.id)} onToggle={() => toggleGuestSelection(card.item.id)} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#6a6a66' }}>{card.item.name}</div>
                  <GuestStatusBadge scanned={card.item.scanned} />
                  {card.item.isVIP && <span style={{ flexShrink: 0, border: '1px solid #ead8a3', borderRadius: 999, padding: '3px 8px', background: '#f8f1dc', color: '#806520', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em' }}>VIP</span>}
                  {card.item.isStaff && <span style={{ flexShrink: 0, border: '1px solid #bfdbfe', borderRadius: 999, padding: '3px 8px', background: '#eff6ff', color: '#1d4ed8', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em' }}>STAFF</span>}
                  {!card.item.isVIP && !card.item.isStaff && <span style={{ flexShrink: 0, border: '1px solid #cfe5d3', borderRadius: 999, padding: '3px 8px', background: '#eff8f1', color: '#3d7350', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em' }}>GUEST</span>}
                  <GuestTagBadge tag={card.item.tag} />
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#b4b4b0', marginTop: 3, letterSpacing: '0.04em' }}>{card.item.barcode}</div>
              </div>
              <GuestTimeColumn item={card.item} />
              {!bulkTagMode && (
                <>
                  <button
                    onClick={() => handleRestore(card)}
                    style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 8, border: '1px solid #e2e2de', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#161618', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => { setActionMessage(null); setActionTarget(card); }}
                    aria-label={`Actions for ${card.item.name}`}
                    style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, border: '1px solid #e2e2de', background: '#fff', fontSize: 18, cursor: 'pointer', color: '#6a6a66' }}
                  >
                    ⋯
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {bulkTagMode && (
        <div className="no-print" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 45, padding: '10px 12px 14px', pointerEvents: 'none' }}>
          <div role="region" aria-label="Bulk edit guest tags" style={{ width: '100%', maxWidth: 560, margin: '0 auto', border: '1px solid #d7d7d3', borderRadius: 16, background: '#fbfbfa', boxShadow: '0 -10px 32px rgba(20,20,22,0.14)', padding: 14, pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Set guest tags</div>
                <div style={{ marginTop: 2, fontSize: 11.5, color: '#777773' }}>{selectedVisibleIds.length} selected · {visibleCards.length} currently filtered</div>
              </div>
              <button type="button" onClick={toggleSelectAllVisible} disabled={visibleCards.length === 0 || bulkTagSaving} style={{ height: 34, border: '1px solid #d7d7d3', borderRadius: 8, background: '#fff', padding: '0 10px', fontSize: 11.5, fontWeight: 700, cursor: visibleCards.length === 0 || bulkTagSaving ? 'default' : 'pointer', color: visibleCards.length === 0 ? '#aaa' : '#161618' }}>
                {allVisibleSelected ? 'Clear selection' : 'Select filtered'}
              </button>
              <button type="button" onClick={closeBulkTagMode} disabled={bulkTagSaving} aria-label="Close bulk tag editor" style={{ width: 34, height: 34, border: '1px solid #d7d7d3', borderRadius: 8, background: '#fff', fontSize: 18, cursor: bulkTagSaving ? 'default' : 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <input
                value={bulkTag}
                onChange={event => { setBulkTag(event.target.value); setBulkTagError(null); }}
                placeholder="Tag selected guests"
                list="bulk-tag-suggestions"
                disabled={bulkTagSaving}
                style={{ flex: '1 1 190px', minWidth: 0, height: 42, border: '1px solid #d7d7d3', borderRadius: 9, background: '#fff', padding: '0 11px', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
              />
              <datalist id="bulk-tag-suggestions">
                {tagOptions.map(tag => <option key={guestTagKey(tag)} value={tag} />)}
              </datalist>
              <button type="button" onClick={() => void handleBulkTagUpdate(bulkTag)} disabled={selectedVisibleIds.length === 0 || !bulkTag.trim() || bulkTagSaving} style={{ height: 42, border: 'none', borderRadius: 9, background: selectedVisibleIds.length === 0 || !bulkTag.trim() || bulkTagSaving ? '#d8d8d4' : '#161618', color: selectedVisibleIds.length === 0 || !bulkTag.trim() || bulkTagSaving ? '#8a8a86' : '#fff', padding: '0 14px', fontSize: 12.5, fontWeight: 800, cursor: selectedVisibleIds.length === 0 || !bulkTag.trim() || bulkTagSaving ? 'default' : 'pointer' }}>
                {bulkTagSaving ? 'Saving…' : 'Apply tag'}
              </button>
              <button type="button" onClick={() => void handleBulkTagUpdate(null)} disabled={selectedVisibleIds.length === 0 || bulkTagSaving} style={{ height: 42, border: '1px solid #d7d7d3', borderRadius: 9, background: '#fff', color: selectedVisibleIds.length === 0 || bulkTagSaving ? '#aaa' : '#161618', padding: '0 12px', fontSize: 12.5, fontWeight: 700, cursor: selectedVisibleIds.length === 0 || bulkTagSaving ? 'default' : 'pointer' }}>
                Clear tags
              </button>
            </div>
            {bulkTagError && <div role="alert" style={{ marginTop: 9, fontSize: 12, color: '#b42318' }}>{bulkTagError}</div>}
          </div>
        </div>
      )}

      {/* Print-only QR grid (active guests only) */}
      <div className="print-only" style={{ display: 'none', padding: 16 }}>
        <div style={{ marginBottom: 16, fontSize: 18, fontWeight: 700 }}>{session?.name}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
          {sortedActive(activeCards).map(({ item, dataUrl }) => (
            <div key={item.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', border: item.isVIP ? '2px solid #eee4c9' : '1px solid #e6e6e2', background: item.isVIP ? 'linear-gradient(135deg, #fffef9 0%, #fff1bd 55%, #ebcf7a 100%)' : '#fff', boxShadow: item.isVIP ? '0 7px 18px rgba(128, 96, 30, 0.14)' : 'none', borderRadius: 14, padding: '14px 10px 12px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <div style={{ padding: 5, borderRadius: 10, background: '#fff' }}>
                <img src={dataUrl} alt={item.barcode} style={{ display: 'block', width: 130, height: 130 }} />
              </div>
              <div style={{ marginTop: 9, fontSize: 13, fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>{item.name}</div>
              {item.isVIP && <div style={{ marginTop: 5, border: '1px solid #ead8a3', borderRadius: 999, padding: '3px 8px', background: '#f8f1dc', color: '#806520', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 800, letterSpacing: '0.14em' }}>VIP</div>}
              {item.isStaff && <div style={{ marginTop: 5, border: '1px solid #bfdbfe', borderRadius: 999, padding: '3px 8px', background: '#eff6ff', color: '#1d4ed8', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 800, letterSpacing: '0.14em' }}>STAFF</div>}
              <div style={{ marginTop: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#9a9a96', textAlign: 'center' }}>{item.barcode}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Remove confirmation sheet */}
      {actionTarget && (
        <div onClick={() => setActionTarget(null)} style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={event => event.stopPropagation()} role="dialog" aria-label={`Actions for ${actionTarget.item.name}`} style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '22px 20px 30px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}>
            <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 18px' }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{actionTarget.item.name}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#9a9a96', marginBottom: 16 }}>{actionTarget.item.barcode}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {!actionTarget.item.removed && (
                <button onClick={() => { setPostcardTarget(actionTarget); setActionTarget(null); }} style={{ height: 46, borderRadius: 10, border: 'none', background: '#161618', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>View, save or share pass</button>
              )}
              <button onClick={() => { setEditTarget(actionTarget); setActionTarget(null); }} style={{ height: 46, borderRadius: 10, border: '1px solid #e2e2de', background: '#fff', color: '#161618', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Edit guest</button>
              {actionTarget.item.email && !actionTarget.item.removed && (
                <button onClick={() => { const target = actionTarget; setActionTarget(null); void handleSendOne(target); }} disabled={emailSending.has(actionTarget.item.id)} style={{ height: 46, borderRadius: 10, border: '1px solid #e2e2de', background: '#fff', color: '#161618', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  {actionTarget.item.qr_email_sent_at ? 'Resend QR email' : 'Send QR email'}
                </button>
              )}
              {actionTarget.item.scanned && (
                <button onClick={() => { setUndoTarget(actionTarget); setActionTarget(null); }} style={{ height: 46, borderRadius: 10, border: '1px solid #e2e2de', background: '#fff', color: '#161618', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Undo check-in</button>
              )}
              {!actionTarget.item.removed && (
                <button onClick={() => { setRemoveTarget(actionTarget); setActionTarget(null); }} style={{ height: 46, borderRadius: 10, border: 'none', background: '#161618', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Remove guest</button>
              )}
              <button onClick={() => setActionTarget(null)} style={{ height: 46, borderRadius: 10, border: 'none', background: 'transparent', color: '#6a6a66', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {undoTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div role="alertdialog" aria-label={`Undo check-in for ${undoTarget.item.name}`} style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 32px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Undo check-in?</div>
            <div style={{ fontSize: 14, color: '#5a5a5e', marginBottom: 18, lineHeight: 1.5 }}>
              <strong>{undoTarget.item.name}</strong> will return to pending. {undoTarget.item.removed ? 'They will remain in Removed.' : 'Their QR can be checked in again.'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setUndoTarget(null)} disabled={acting} style={{ flex: 1, height: 50, borderRadius: 12, border: '1px solid #e2e2de', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleUndo} disabled={acting} style={{ flex: 1, height: 50, borderRadius: 12, border: 'none', background: '#161618', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{acting ? 'Undoing…' : 'Undo check-in'}</button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <GuestEditSheet
          sessionId={sessionId}
          item={editTarget.item}
          tagSuggestions={tagOptions}
          onClose={() => setEditTarget(null)}
          onSaved={handleEditSaved}
        />
      )}

      {postcardTarget && (
        <QrPostcardSheet
          eventName={session.name}
          item={postcardTarget.item}
          qrDataUrl={postcardTarget.dataUrl}
          onClose={() => setPostcardTarget(null)}
        />
      )}

      {removeTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 32px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}>
            <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 20px' }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Remove guest?</div>
            {removeTarget.item.scanned ? (
              <div style={{ background: 'oklch(0.96 0.06 75)', border: '1px solid oklch(0.88 0.1 75)', borderRadius: 10, padding: '12px 14px', marginBottom: 18, fontSize: 14, color: 'oklch(0.45 0.15 70)', lineHeight: 1.5 }}>
                <strong>{removeTarget.item.name}</strong> has already been checked in. Their QR code will be blocked at the scanner, but their check-in will still count in the tally. You can restore them anytime.
              </div>
            ) : (
              <div style={{ fontSize: 14, color: '#5a5a5e', marginBottom: 18, lineHeight: 1.5 }}>
                <strong>{removeTarget.item.name}</strong> will be moved to the Removed tab. Their QR code will be blocked at the scanner. You can restore them anytime.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setRemoveTarget(null)} style={{ flex: 1, height: 50, borderRadius: 12, border: '1px solid #e2e2de', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handleRemove} disabled={acting} style={{ flex: 1, height: 50, borderRadius: 12, border: 'none', background: '#161618', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {acting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
      {addGuestOpen && (
        <div
          className="no-print"
          onClick={() => { if (!adding) setAddGuestOpen(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Add guest"
            onClick={event => event.stopPropagation()}
            onSubmit={event => { event.preventDefault(); void handleAdd(); }}
            style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 30px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}
          >
            <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 20px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 20, margin: 0 }}>Add guest</h2>
                <div style={{ marginTop: 4, fontSize: 12.5, color: '#777773' }}>Create a new QR ticket for this event.</div>
              </div>
              <button type="button" onClick={() => setAddGuestOpen(false)} disabled={adding} aria-label="Close add guest" style={{ width: 32, height: 32, border: '1px solid #e2e2de', borderRadius: 9, background: '#fff', fontSize: 18, cursor: adding ? 'default' : 'pointer' }}>×</button>
            </div>
            <label htmlFor="add-guest-name" style={{ display: 'block', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: '#777773' }}>NAME</label>
            <input
              id="add-guest-name"
              ref={inputRef}
              autoFocus
              value={addName}
              onChange={event => { setAddName(event.target.value); setAddError(null); }}
              placeholder="Guest name"
              disabled={adding}
              style={{ width: '100%', border: '1px solid #dcdcd8', background: '#fff', borderRadius: 10, padding: '12px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
            />
            <label htmlFor="add-guest-email" style={{ display: 'block', margin: '14px 0 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: '#777773' }}>EMAIL</label>
            <input
              id="add-guest-email"
              value={addEmail}
              onChange={event => { setAddEmail(event.target.value); setAddError(null); }}
              placeholder="Email optional"
              type="email"
              disabled={adding}
              style={{ width: '100%', border: '1px solid #dcdcd8', background: '#fff', borderRadius: 10, padding: '12px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
            />
            <label htmlFor="add-guest-tag" style={{ display: 'block', margin: '14px 0 6px', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: '#777773' }}>TAG</label>
            <input
              id="add-guest-tag"
              value={addTag}
              onChange={event => { setAddTag(event.target.value); setAddError(null); }}
              placeholder="Tag optional"
              list="add-guest-tag-suggestions"
              disabled={adding}
              style={{ width: '100%', border: '1px solid #dcdcd8', background: '#fff', borderRadius: 10, padding: '12px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
            />
            <datalist id="add-guest-tag-suggestions">
              {tagOptions.map(tag => <option key={guestTagKey(tag)} value={tag} />)}
            </datalist>
            <div style={{ marginTop: 14 }}>
              <VipToggle checked={addIsVIP} onChange={setAddIsVIP} disabled={adding} />
              <div style={{ marginTop: 8 }}><StaffToggle checked={addIsStaff} onChange={setAddIsStaff} disabled={adding} /></div>
            </div>
            {addError && <div role="alert" style={{ marginTop: 10, fontSize: 12.5, color: '#b42318' }}>{addError}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setAddGuestOpen(false)} disabled={adding} style={{ flex: 1, height: 48, borderRadius: 10, border: '1px solid #d7d7d3', background: '#fff', color: '#161618', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: adding ? 'default' : 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={!addName.trim() || adding} style={{ flex: 1, height: 48, borderRadius: 10, border: 'none', background: !addName.trim() || adding ? '#d8d8d4' : '#161618', color: !addName.trim() || adding ? '#8a8a86' : '#fff', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: !addName.trim() || adding ? 'default' : 'pointer' }}>
                {adding ? 'Adding…' : 'Add guest'}
              </button>
            </div>
          </form>
        </div>
      )}
      {filtersOpen && (
        <ManageFiltersSheet
          appliedState={filterState}
          tagOptions={filterTagOptions}
          untaggedCount={activeFacetCounts.untagged}
          onApply={applyFilterState}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      {settingsOpen && (
        <ManageSecuritySheet
          session={session}
          guestView={tab}
          activeGuestCount={activeFacetCounts.total}
          removedGuestCount={removedCards.length}
          onGuestViewChange={view => {
            setTab(view);
            setBulkTagMode(false);
            setSelectedGuestIds(new Set());
            setBulkTag('');
            setBulkTagError(null);
            setSettingsOpen(false);
          }}
          onSendUnsent={handleSendUnsent}
          sendingUnsent={emailSending.size > 0}
          emailSummary={emailSummary}
          onArchive={() => void handleArchive()}
          archiving={archiving}
          onClose={() => setSettingsOpen(false)}
          onLock={handleLock}
          onSessionChange={setSession}
        />
      )}
    </div>
  );
}
