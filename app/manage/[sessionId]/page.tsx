'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ManageAccessGate } from '@/components/ManageAccessGate';
import { ManageSecuritySheet } from '@/components/ManageSecuritySheet';
import { GuestEditSheet } from '@/components/GuestEditSheet';
import { QrPostcardSheet } from '@/components/QrPostcardSheet';
import { VipToggle } from '@/components/VipToggle';
import { manageAccessStorageKey } from '@/lib/managePassword';
import { db } from '@/lib/supabase';
import { toQrDataUrl } from '@/lib/qr';
import { generateTicketCode } from '@/lib/ticketCodes';
import { renderTicketPassImage } from '@/lib/ticketPass';
import { createZip } from '@/lib/zip';
import { compareGuestTags, distinctGuestTags, guestTagKey } from '@/lib/guestTags';
import { Item, ManageSession } from '@/lib/types';

interface GuestCard {
  item: Item;
  dataUrl: string;
}

type Tab = 'active' | 'removed';
type TallyFilter = 'total' | 'checked_in' | 'pending';
type GuestSort = 'checked_in' | 'added' | 'tag';
type SortDirection = 'desc' | 'asc';
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

function sortedGuestCards(cards: GuestCard[], sort: GuestSort, direction: SortDirection, pinnedId?: string): GuestCard[] {
  return [...cards].sort((a, b) => {
    if (a.item.id === pinnedId) return -1;
    if (b.item.id === pinnedId) return 1;

    if (sort === 'tag') {
      const tagDifference = compareGuestTags(a.item.tag, b.item.tag, direction);
      if (tagDifference !== 0) return tagDifference;
      return a.item.name.localeCompare(b.item.name);
    }

    const aTimestamp = sort === 'checked_in' ? a.item.scanned_at : a.item.created_at;
    const bTimestamp = sort === 'checked_in' ? b.item.scanned_at : b.item.created_at;
    if (!aTimestamp && !bTimestamp) return a.item.name.localeCompare(b.item.name);
    if (!aTimestamp) return 1;
    if (!bTimestamp) return -1;

    const difference = new Date(aTimestamp).getTime() - new Date(bTimestamp).getTime();
    if (difference !== 0) return direction === 'asc' ? difference : -difference;
    return a.item.name.localeCompare(b.item.name);
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

export default function ManagePage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const router = useRouter();

  const [session, setSession] = useState<ManageSession | null>(null);
  const [cards, setCards] = useState<GuestCard[]>([]);
  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [loadingData, setLoadingData] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addGuestOpen, setAddGuestOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const [tallyFilter, setTallyFilter] = useState<TallyFilter>('total');
  const [guestSort, setGuestSort] = useState<GuestSort>('added');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [tagFilter, setTagFilter] = useState('');
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addTag, setAddTag] = useState('');
  const [addIsVIP, setAddIsVIP] = useState(false);
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
  const [bulkDownloadError, setBulkDownloadError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!tagFilter) return;
    const matchingTag = cards.find(card => guestTagKey(card.item.tag) === guestTagKey(tagFilter))?.item.tag;
    if (!matchingTag) setTagFilter('');
    else if (matchingTag !== tagFilter) setTagFilter(matchingTag);
  }, [cards, tagFilter]);

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
      const item = await db.addItem(sessionId, name, barcode, addEmail.trim() || null, addIsVIP, addTag);
      const dataUrl = await toQrDataUrl(barcode);
      setCards(prev => [...prev, { item, dataUrl }]);
      setAddName('');
      setAddEmail('');
      setAddTag('');
      setAddIsVIP(false);
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
  const selectedTagKey = guestTagKey(tagFilter);
  const totalActive = activeCards.length;
  const checkedIn = cards.filter(c => c.item.scanned).length;
  const unscanned = activeCards.filter(c => !c.item.scanned).length;

  const statusFilteredActive = tallyFilter === 'checked_in'
    ? activeCards.filter(c => c.item.scanned)
    : tallyFilter === 'pending'
    ? activeCards.filter(c => !c.item.scanned)
    : activeCards;
  const filteredActive = selectedTagKey
    ? statusFilteredActive.filter(card => guestTagKey(card.item.tag) === selectedTagKey)
    : statusFilteredActive;
  const filteredRemoved = selectedTagKey
    ? removedCards.filter(card => guestTagKey(card.item.tag) === selectedTagKey)
    : removedCards;

  const displayActive = sortedGuestCards(filteredActive, guestSort, sortDirection, pinnedId);
  const displayRemoved = sortedGuestCards(filteredRemoved, guestSort, sortDirection, pinnedId);

  const handleTallyClick = (f: TallyFilter) => {
    setTallyFilter(prev => (prev === f && f !== 'total') ? 'total' : f);
  };

  const handleGuestSort = (sort: GuestSort) => {
    if (guestSort === sort) {
      setSortDirection(current => current === 'desc' ? 'asc' : 'desc');
      return;
    }
    setGuestSort(sort);
    setSortDirection(sort === 'tag' ? 'asc' : 'desc');
  };

  const handleBulkDownload = async () => {
    if (bulkDownloadProgress !== null || activeCards.length === 0) return;
    setBulkDownloadProgress(0);
    setBulkDownloadError(null);
    try {
      const usedNames = new Map<string, number>();
      const entries: { name: string; data: Blob }[] = [];
      for (const [index, card] of sortedActive(activeCards).entries()) {
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
    } catch {
      setBulkDownloadError('Could not prepare the ticket images. Please try again.');
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
          <button onClick={() => window.print()} style={{ flexShrink: 0, padding: '9px 16px', background: '#161618', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Print
          </button>
        </div>

        {/* Tally row */}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          {([
            { label: 'TOTAL', value: totalActive, filter: 'total' as TallyFilter },
            { label: 'CHECKED IN', value: checkedIn, filter: 'checked_in' as TallyFilter },
            { label: 'PENDING', value: unscanned, filter: 'pending' as TallyFilter },
          ]).map(({ label, value, filter }) => {
            const active = tallyFilter === filter;
            return (
              <div
                key={label}
                onClick={() => handleTallyClick(filter)}
                style={{
                  flex: 1, borderRadius: 10, padding: '9px 10px', cursor: 'pointer',
                  background: active ? '#161618' : '#f4f4f2',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.14em', color: active ? '#9a9a94' : '#9a9a96' }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: active ? '#fff' : '#161618' }}>{value}</div>
              </div>
            );
          })}
        </div>

        {/* List controls */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: '#777773' }}>
            {tab === 'active' ? 'ACTIVE GUESTS' : 'REMOVED GUESTS'}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
            <label htmlFor="guest-tag-filter" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.1em', color: '#777773' }}>TAG</label>
            <select
              id="guest-tag-filter"
              value={tagFilter}
              onChange={event => setTagFilter(event.target.value)}
              style={{ height: 32, maxWidth: 180, borderRadius: 8, border: '1px solid #dcdcd8', background: '#fff', color: '#4a4a46', padding: '0 8px', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', WebkitAppearance: 'menulist', appearance: 'auto' }}
            >
              <option value="">All tags</option>
              {tagOptions.map(tag => <option key={guestTagKey(tag)} value={tag}>{tag}</option>)}
            </select>
            <span style={{ marginRight: 2, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.1em', color: '#777773' }}>SORT</span>
            {([
              { label: 'Checked in', sort: 'checked_in' as GuestSort },
              { label: 'Added', sort: 'added' as GuestSort },
              { label: 'Tag', sort: 'tag' as GuestSort },
            ]).map(({ label, sort }) => {
              const active = guestSort === sort;
              return (
                <button
                  key={sort}
                  type="button"
                  onClick={() => handleGuestSort(sort)}
                  aria-pressed={active}
                  aria-label={`Sort by ${label.toLowerCase()}, ${sort === 'tag'
                    ? active && sortDirection === 'desc' ? 'Z to A' : 'A to Z'
                    : active && sortDirection === 'asc' ? 'oldest first' : 'newest first'}`}
                  style={{
                    height: 32, borderRadius: 8, padding: '0 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                    border: `1px solid ${active ? '#161618' : '#dcdcd8'}`,
                    background: active ? '#161618' : '#fff',
                    color: active ? '#fff' : '#4a4a46',
                  }}
                >
                  {label}{active ? (sortDirection === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              );
            })}
          </div>
        </div>
        {actionMessage && (
          <div role="status" aria-live="polite" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: '#f0f0ed', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#5a5a56' }}>
            {actionMessage}
          </div>
        )}
      </div>

      {/* Active guest list */}
      {tab === 'active' && (
        <div className="no-print" style={{ padding: '10px 12px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayActive.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>
              {tagFilter || tallyFilter !== 'total' ? 'NO MATCHING GUESTS' : 'NO GUESTS YET'}
            </div>
          )}
          {displayActive.map(card => {
            const qrOpen = expandedQr.has(card.item.id);
            const pinned = card.item.id === pinnedId;
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
                  background: pinned ? 'oklch(0.96 0.04 152)' : '#fff',
                  border: card.item.isVIP
                    ? '1px solid #eee4c9'
                    : `1px solid ${pinned ? 'oklch(0.82 0.1 152)' : '#ececea'}`,
                  boxShadow: pinned ? '0 0 0 3px oklch(0.82 0.1 152 / 0.45)' : 'none',
                  borderRadius: 14, padding: '12px 12px 12px 14px',
                  transition: 'background 0.4s, border-color 0.4s, box-shadow 0.4s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => toggleQr(card.item.id)}
                    title={qrOpen ? 'Hide QR' : 'Show QR'}
                    style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, border: '1px solid #e2e2de', background: qrOpen ? '#161618' : '#f4f4f2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: qrOpen ? '#fff' : '#6a6a66', fontSize: 15, transition: 'background 0.15s' }}
                  >
                    ▦
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.item.name}</div>
                      {card.item.isVIP && <span style={{ flexShrink: 0, border: '1px solid #ead8a3', background: '#f8f1dc', color: '#806520', borderRadius: 999, padding: '3px 8px', boxShadow: '0 2px 7px rgba(95, 71, 18, 0.1)', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em' }}>VIP</span>}
                      <GuestTagBadge tag={card.item.tag} />
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#9a9a96', marginTop: 3, letterSpacing: '0.04em' }}>{card.item.barcode}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: card.item.email ? '#6a6a66' : '#b4b4b0', marginTop: 3, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {card.item.email || 'NO EMAIL'}
                    </div>
                    {card.item.scanned && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, background: 'oklch(0.95 0.05 152)', borderRadius: 6, padding: '3px 8px' }}>
                        <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.12em', color: 'oklch(0.45 0.14 152)', fontWeight: 700 }}>
                          CHECKED IN{checkinTime ? ` · ${checkinTime}` : ''}{card.item.scanned_by ? ` · ${card.item.scanned_by}` : ''}
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
                  <button
                    onClick={() => { setActionMessage(null); setActionTarget(card); }}
                    aria-label={`Actions for ${card.item.name}`}
                    style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, border: '1px solid #e2e2de', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6a6a66', fontSize: 18 }}
                  >
                    ⋯
                  </button>
                </div>
                {qrOpen && (
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
        <div className="no-print" style={{ padding: '10px 12px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayRemoved.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>
              {tagFilter ? 'NO MATCHING REMOVED GUESTS' : 'NO REMOVED GUESTS'}
            </div>
          )}
          {displayRemoved.map(card => (
            <div key={card.item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: card.item.id === pinnedId ? 'oklch(0.96 0.04 152)' : '#fff', border: card.item.isVIP ? '1px solid #eee4c9' : `1px solid ${card.item.id === pinnedId ? 'oklch(0.82 0.1 152)' : '#ececea'}`, boxShadow: 'none', borderRadius: 14, padding: '12px 12px 12px 14px', opacity: card.item.id === pinnedId ? 1 : 0.7, transition: 'background 0.4s, border-color 0.4s, box-shadow 0.4s' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#6a6a66' }}>{card.item.name}</div>
                  {card.item.isVIP && <span style={{ flexShrink: 0, border: '1px solid #ead8a3', borderRadius: 999, padding: '3px 8px', background: '#f8f1dc', color: '#806520', fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em' }}>VIP</span>}
                  <GuestTagBadge tag={card.item.tag} />
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#b4b4b0', marginTop: 3, letterSpacing: '0.04em' }}>{card.item.barcode}</div>
              </div>
              <GuestTimeColumn item={card.item} />
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
            </div>
          ))}
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
      {settingsOpen && (
        <ManageSecuritySheet
          session={session}
          guestView={tab}
          activeGuestCount={totalActive}
          removedGuestCount={removedCards.length}
          onGuestViewChange={view => {
            setTab(view);
            setTallyFilter('total');
            setSettingsOpen(false);
          }}
          onSendUnsent={handleSendUnsent}
          sendingUnsent={emailSending.size > 0}
          emailSummary={emailSummary}
          onDownloadPasses={() => void handleBulkDownload()}
          downloadProgress={bulkDownloadProgress}
          downloadError={bulkDownloadError}
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
