'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';
import { useScanStore } from '@/store/useScanStore';
import { Scanner } from '@/components/Scanner';
import { ProgressCard } from '@/components/ProgressCard';
import { ItemList } from '@/components/ItemList';
import { ResultFlood, ScanResultFlood } from '@/components/ResultFlood';
import { CheckInSource, ScanResult } from '@/lib/types';
import { admitKnownItem, flushAdmissions } from '@/lib/admission';
import { offlineScanner, type PreparedScanner } from '@/lib/offlineScanner';
import { PeerSync, type PeerSignalState, type PeerState } from '@/lib/peerSync';
import { QrOfflineSyncSheet } from '@/components/QrOfflineSyncSheet';

type UndoCandidate = { itemId: string; name: string; barcode: string; scannedAt: string; source: CheckInSource };

function beep(type: 'admit' | 'already' | 'nomatch') {
  try {
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    const tone = (freq: number, t0: number, dur: number, kind: OscillatorType, gain: number) => {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.type = kind; o.frequency.value = freq; o.connect(g); g.connect(ac.destination);
      const t = ac.currentTime + t0;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.03);
    };
    if (type === 'admit')   { tone(880, 0, 0.12, 'sine', 0.28); tone(1320, 0.1, 0.16, 'sine', 0.24); }
    if (type === 'already') { tone(523, 0, 0.2, 'sine', 0.22); }
    if (type === 'nomatch') { tone(150, 0, 0.34, 'square', 0.18); }
  } catch {}
}

function buzz(type: 'admit' | 'already' | 'nomatch') {
  if (!navigator.vibrate) return;
  navigator.vibrate(type === 'admit' ? [35] : type === 'already' ? [25, 40, 25] : [120, 40, 120]);
}

export default function ScannerPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const router = useRouter();

  const { setItems, updateItem, progress, setLastScan } = useScanStore();

  const [loading, setLoading] = useState(true);
  const [sessionName, setSessionName] = useState('');
  const [gateName, setGateName] = useState('This gate');
  const [isConnected, setIsConnected] = useState(false);
  const [flood, setFlood] = useState<ScanResultFlood | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [listFull, setListFull] = useState(false);
  const floodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoCandidate, setUndoCandidate] = useState<UndoCandidate | null>(null);
  const [undoRunning, setUndoRunning] = useState(false);
  const [undoMessage, setUndoMessage] = useState('');
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [failedItemId, setFailedItemId] = useState<string | null>(null);
  const admissionOwnerRef = useRef<'camera' | 'manual' | null>(null);
  const [admissionBusy, setAdmissionBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedScanner | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [conflicts, setConflicts] = useState<Awaited<ReturnType<typeof offlineScanner.conflicts>>>([]);
  const [offlineMessage, setOfflineMessage] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [offlineSettingsOpen, setOfflineSettingsOpen] = useState(false);
  const [qrSyncOpen, setQrSyncOpen] = useState(false);
  const peerSyncRef = useRef<PeerSync | null>(null);
  const [peerState, setPeerState] = useState<PeerState>('idle');
  const [peerSignalState, setPeerSignalState] = useState<PeerSignalState>('idle');
  const [pairingCode, setPairingCode] = useState('');
  const [peerCode, setPeerCode] = useState('');
  const [pairingMessage, setPairingMessage] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem('gate_name');
    if (name) setGateName(name);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const session = await db.getSession(sessionId);
        setSessionName(session.name);
        const items = await db.getItems(sessionId);
        setItems(items);
      } catch {
        const snapshot = await offlineScanner.get(sessionId);
        if (!snapshot) { router.push('/'); return; }
        setSessionName(snapshot.session.name);
        setItems(snapshot.items as any);
      } finally {
        const snapshot = await offlineScanner.get(sessionId); setPrepared(snapshot);
        setPendingSync((await offlineScanner.pending(sessionId)).length);
        setLoading(false);
      }
    };
    load();
  }, [sessionId, router, setItems]);

  const refreshOfflineStatus = useCallback(async () => {
    setPrepared(await offlineScanner.get(sessionId));
    setPendingSync((await offlineScanner.pending(sessionId)).length);
    setConflicts(await offlineScanner.conflicts(sessionId));
  }, [sessionId]);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    const results = await flushAdmissions(sessionId);
    for (const entry of results) if (entry.item) updateItem(entry.item);
    await refreshOfflineStatus();
  }, [refreshOfflineStatus, sessionId, updateItem]);

  useEffect(() => {
    const onOnline = () => { void sync(); };
    window.addEventListener('online', onOnline); void sync();
    return () => window.removeEventListener('online', onOnline);
  }, [sync]);

  useEffect(() => {
    const peer = new PeerSync(sessionId, {
      onState: setPeerState,
      onSignalState: setPeerSignalState,
      onAdmission: entry => {
        void (async () => {
          const applied = await offlineScanner.applyPeerAdmission(entry);
          if (applied !== 'applied') return;
          const snapshot = await offlineScanner.get(sessionId);
          const item = snapshot?.items.find(candidate => candidate.id === entry.itemId);
          if (item) updateItem(item as any);
          await refreshOfflineStatus();
          if (navigator.onLine) await sync();
        })();
      },
    });
    peerSyncRef.current = peer;
    return () => { peer.close(); if (peerSyncRef.current === peer) peerSyncRef.current = null; };
  }, [refreshOfflineStatus, sessionId, sync, updateItem]);

  useEffect(() => {
    const channel = db.subscribeToItems(sessionId, payload => {
      if (payload.eventType === 'UPDATE') updateItem(payload.new as any);
    });
    channel.subscribe((status: string) => setIsConnected(status === 'SUBSCRIBED'));
    return () => { channel.unsubscribe(); };
  }, [sessionId, updateItem]);

  useEffect(() => {
    if (!gateName || gateName === 'This gate') return;
    const channel = db.joinPresence(sessionId, gateName);
    return () => { channel.unsubscribe(); };
  }, [sessionId, gateName]);

  const showFlood = useCallback((result: ScanResultFlood) => {
    if (floodTimer.current) clearTimeout(floodTimer.current);
    setFlood(result);
    floodTimer.current = setTimeout(() => setFlood(null), result.type === 'admit' ? 1500 : 2000);
  }, []);

  const clearUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoCandidate(null);
    setUndoMessage('');
  }, []);

  const handleCameraScanStart = useCallback((barcode: string) => {
    if (admissionOwnerRef.current) return false;
    clearUndo();
    admissionOwnerRef.current = 'camera';
    setAdmissionBusy(true);
    return true;
  }, [clearUndo]);

  const startUndoWindow = useCallback((candidate: UndoCandidate) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoCandidate(candidate);
    setUndoMessage('');
    // The action appears after the 1.5 second result flood, then remains for 8 seconds.
    undoTimer.current = setTimeout(() => setUndoCandidate(null), 9500);
  }, []);

  useEffect(() => () => {
    if (floodTimer.current) clearTimeout(floodTimer.current);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const handleScanComplete = useCallback((result: ScanResult, source: CheckInSource = 'camera') => {
    if (source === 'camera' && admissionOwnerRef.current === 'camera') {
      admissionOwnerRef.current = null;
      setAdmissionBusy(false);
    }
    setLastScan({ barcode: result.item?.barcode || '', result: result.type, message: result.message, timestamp: Date.now() });
    if (result.item) updateItem(result.item);
    if (result.success && result.item?.scanned_at) {
      startUndoWindow({ itemId: result.item.id, name: result.item.name, barcode: result.item.barcode, scannedAt: result.item.scanned_at, source });
    }

    const type = result.type === 'success' ? 'admit' : result.type === 'duplicate' ? 'already' : 'nomatch';
    beep(type); buzz(type);
    showFlood({
      type,
      name: result.type === 'success'
        ? (result.item?.name ?? '')
        : result.type === 'duplicate'
          ? (result.item?.name ?? 'Already checked in')
          : 'Ticket not recognised',
      sub: result.type === 'success'
        ? (result.syncState === 'pending' ? `PENDING SYNC · ${result.item?.barcode ?? ''}` : (result.item?.barcode ?? ''))
        : result.type === 'duplicate'
          ? 'Entered earlier · This gate'
          : 'Code ' + (result.item?.barcode ?? '—'),
      isVIP: result.item?.isVIP,
      isStaff: result.item?.isStaff,
    });
  }, [setLastScan, updateItem, showFlood, startUndoWindow]);

  const handleUndo = async () => {
    if (!undoCandidate || undoRunning) return;
    const candidate = undoCandidate;
    setUndoRunning(true);
    try {
      if (!navigator.onLine) {
        const cancelled = await offlineScanner.undoPending(sessionId, candidate.itemId);
        if (cancelled) {
          const snapshot = await offlineScanner.get(sessionId);
          const item = snapshot?.items.find(entry => entry.id === candidate.itemId);
          if (item) updateItem(item as any);
          await refreshOfflineStatus();
          setUndoMessage(`${candidate.name} provisional check-in cancelled`);
          if (undoTimer.current) clearTimeout(undoTimer.current);
          setUndoCandidate(null);
          return;
        }
        setUndoMessage('Reconnect to undo a synced admission.');
        return;
      }
      const result = await db.undoItemCheckIn(sessionId, candidate.itemId, candidate.scannedAt, gateName, candidate.source);
      if (result.status === 'undone' && result.item) {
        updateItem(result.item);
        setUndoMessage(`${candidate.name} check-in undone`);
      } else {
        setUndoMessage(result.status === 'stale' ? 'Could not undo: check-in changed elsewhere' : 'Could not undo: guest not found');
      }
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoCandidate(null);
      setTimeout(() => setUndoMessage(''), 3500);
    } catch {
      setUndoMessage('Could not undo check-in. Try again.');
    } finally {
      setUndoRunning(false);
    }
  };

  const admit = useCallback(async (barcode: string, source: 'camera' | 'manual') => {
    const snapshot = await offlineScanner.get(sessionId);
    let item = snapshot?.items.find(candidate => candidate.barcode === barcode) as any;
    if (!item && navigator.onLine) item = await db.getItemByBarcode(sessionId, barcode);
    if (!item) return { success: false, message: snapshot ? 'Not found' : 'Reconnect and prepare this event before offline scanning.', type: 'not_found' as const };
    const result = await admitKnownItem(item, { sessionId, gateName, source }, attempt => peerSyncRef.current?.sendAdmission(attempt));
    await refreshOfflineStatus();
    return result;
  }, [gateName, refreshOfflineStatus, sessionId]);

  const handleManualCheckIn = useCallback(async (item: any) => {
    if (admissionOwnerRef.current) return;
    admissionOwnerRef.current = 'manual';
    setAdmissionBusy(true);
    clearUndo();
    setFailedItemId(null);
    setPendingItemId(item.id);

    try {
      const result = await admit(item.barcode, 'manual');
      handleScanComplete(result, 'manual');
    } catch {
      setFailedItemId(item.id);
    } finally {
      if (admissionOwnerRef.current === 'manual') {
        admissionOwnerRef.current = null;
        setAdmissionBusy(false);
      }
      setPendingItemId(null);
    }
  }, [admit, clearUndo, handleScanComplete]);

  const handlePrepare = async () => {
    if (!navigator.onLine) { setOfflineMessage('Reconnect before preparing this scanner.'); return; }
    setPreparing(true); setOfflineMessage('Saving this event to this device…');
    try {
      const [session, items] = await Promise.all([db.getSession(sessionId), db.getItems(sessionId)]);
      const snapshot = await offlineScanner.prepare(session, items);
      setPrepared(snapshot); setOfflineMessage(`Offline ready · Guest list saved at ${new Date(snapshot.preparedAt).toLocaleTimeString()}`);
      if ('serviceWorker' in navigator) await navigator.serviceWorker.ready;
    } catch { setOfflineMessage('Could not prepare offline data. Check your connection.'); }
    finally { setPreparing(false); }
  };

  const handleClearOffline = async () => {
    try { await offlineScanner.clear(sessionId); await refreshOfflineStatus(); setOfflineMessage('Offline data cleared.'); }
    catch (error: any) { setOfflineMessage(error.message || 'Sync pending admissions before clearing.'); }
  };

  const beginPairing = async () => {
    setPairingBusy(true); setPairingMessage('');
    try { setPairingCode(await peerSyncRef.current!.createOffer()); setPeerCode(''); setPairingMessage('Give this code to the other gate, then paste its reply below.'); }
    catch (error: any) { setPairingMessage(error.message || 'Could not start pairing.'); }
    finally { setPairingBusy(false); }
  };
  const joinNearbyGates = () => {
    if (!navigator.onLine) {
      setPairingMessage('Reconnect to the internet to discover nearby gates. A direct connection can continue after pairing.');
      return;
    }
    peerSyncRef.current?.startAutoPairing();
    setPairingMessage('');
  };
  const stopNearbyGates = () => {
    peerSyncRef.current?.cancelAutoPairing();
    setPairingMessage('Nearby-gate search stopped.');
  };
  const replyToPairing = async () => {
    setPairingBusy(true); setPairingMessage('');
    try { setPairingCode(await peerSyncRef.current!.acceptOffer(peerCode)); setPeerCode(''); setPairingMessage('Return this reply code to the gate that started pairing.'); }
    catch (error: any) { setPairingMessage(error.message || 'Could not read that pairing code.'); }
    finally { setPairingBusy(false); }
  };
  const completePairing = async () => {
    setPairingBusy(true); setPairingMessage('');
    try { await peerSyncRef.current!.acceptAnswer(peerCode); setPeerCode(''); setPairingMessage('Connecting to the nearby gate…'); }
    catch (error: any) { setPairingMessage(error.message || 'Could not complete pairing.'); }
    finally { setPairingBusy(false); }
  };
  const copyPairingCode = async () => {
    try { await navigator.clipboard.writeText(pairingCode); setPairingMessage('Pairing code copied.'); }
    catch { setPairingMessage('Copy the code manually.'); }
  };
  const handleQrImported = useCallback(async () => {
    const snapshot = await offlineScanner.get(sessionId);
    if (snapshot) setItems(snapshot.items as any);
    await refreshOfflineStatus();
  }, [refreshOfflineStatus, sessionId, setItems]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#5a5a5e' }}>LOADING…</div>
      </div>
    );
  }

  const showPanel = panelOpen || listFull;

  return (
    <div style={{ minHeight: '100vh', background: '#fbfbfa', display: 'flex', justifyContent: 'center', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 1280, height: '100vh', background: '#fbfbfa', color: '#161618', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 14px', borderBottom: '1px solid #ececea', flexShrink: 0 }}>
          <div
            onClick={() => router.push('/')}
            style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid #e2e2de', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer', flexShrink: 0 }}
          >
            ‹
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sessionName}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '0.1em', color: '#9a9a96', marginTop: 2 }}>{gateName}</div>
          </div>
          <button
            type="button"
            onClick={() => setOfflineSettingsOpen(true)}
            aria-label="Open offline scanner settings"
            style={{ border: '1px solid #e2e2de', borderRadius: 9, width: 36, height: 36, background: '#fff', color: '#555', fontSize: 18, cursor: 'pointer', flexShrink: 0 }}
          >
            ⋯
          </button>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#161618', border: '1px solid #e2e2de', borderRadius: 999, padding: '5px 10px', flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isConnected ? 'oklch(0.74 0.17 152)' : '#c2c2be', animation: isConnected ? 'liveDot 1.4s ease-in-out infinite' : 'none' }} />
            LIVE
          </div>
        </div>

        {/* QR sync needs exclusive camera access, so the ticket scanner is paused while it is open. */}
        {!qrSyncOpen && <Scanner sessionId={sessionId} onScanComplete={handleScanComplete} onScanStart={handleCameraScanStart} onBarcode={(barcode) => admit(barcode, 'camera')} hidden={listFull} />}

        {!flood && (undoCandidate || undoMessage) && (
          <div role="status" aria-live="polite" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: undoMessage ? '#f4f4f2' : 'oklch(0.96 0.04 152)', borderBottom: '1px solid #e2e2de' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {undoMessage || `${undoCandidate?.name} checked in`}
            </div>
            {undoCandidate && (
              <button type="button" onClick={handleUndo} disabled={undoRunning} aria-label={`Undo check-in for ${undoCandidate.name}`} style={{ border: '1px solid #cfcfca', borderRadius: 8, background: '#fff', padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: undoRunning ? 'default' : 'pointer' }}>
                {undoRunning ? 'Undoing…' : 'Undo'}
              </button>
            )}
          </div>
        )}

        {/* Pull tab */}
        {listFull ? (
          /* In list-full mode: single back-to-camera button */
          <div
            onClick={() => setListFull(false)}
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', background: '#fbfbfa', borderTop: '1px solid #ececea', borderBottom: '1px solid #ececea', cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontSize: 12, color: '#b4b4b0' }}>▲</span>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: '#9a9a96' }}>BACK TO CAMERA</div>
          </div>
        ) : (
          /* Normal mode: hide/show list toggle + expand list button */
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 4px', background: '#fbfbfa', borderTop: '1px solid #ececea' }}>
            <div
              onClick={() => setPanelOpen(o => !o)}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer', userSelect: 'none' }}
            >
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: '#9a9a96' }}>
                {panelOpen ? 'HIDE LIST' : `${progress.scanned}/${progress.total} · SHOW LIST`}
              </div>
              <span style={{ fontSize: 12, color: '#b4b4b0', display: 'inline-block', transform: panelOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
            </div>
            <div style={{ width: 1, height: 20, background: '#e2e2de', flexShrink: 0 }} />
            <div
              onClick={() => { setListFull(true); setPanelOpen(true); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
            >
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: '#9a9a96' }}>LIST</div>
              <span style={{ fontSize: 11, color: '#b4b4b0' }}>⤢</span>
            </div>
          </div>
        )}

        {/* Collapsible panel */}
        {showPanel && (
          <>
            <ProgressCard progress={progress} isConnected={isConnected} />
            <ItemList
              onManualCheckIn={handleManualCheckIn}
              pendingItemId={pendingItemId}
              failedItemId={failedItemId}
              admissionBusy={admissionBusy}
            />
          </>
        )}

        {/* Result flood overlay */}
        {flood && (
          <ResultFlood
            result={flood}
            onDismiss={() => { if (floodTimer.current) clearTimeout(floodTimer.current); setFlood(null); }}
          />
        )}

        {offlineSettingsOpen && (
          <div onClick={() => setOfflineSettingsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Offline scanner settings"
              onClick={event => event.stopPropagation()}
              style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 30px', maxHeight: '70vh', overflowY: 'auto' }}
            >
              <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 20px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ fontSize: 20, margin: 0 }}>Offline scanner</h2>
                  <div style={{ marginTop: 4, color: navigator.onLine ? '#287a49' : '#9a6a18', fontSize: 12.5 }}>{navigator.onLine ? 'Connected' : 'Offline'} · {pendingSync} queued</div>
                </div>
                <button type="button" onClick={() => setOfflineSettingsOpen(false)} aria-label="Close offline scanner settings" style={{ width: 32, height: 32, border: '1px solid #e2e2de', borderRadius: 9, background: '#fff', fontSize: 18, cursor: 'pointer' }}>×</button>
              </div>

              <div style={{ border: `1px solid ${prepared ? '#b9dbc6' : '#e2e2de'}`, borderRadius: 12, background: prepared ? 'oklch(0.975 0.025 152)' : '#fff', padding: 13, marginTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{prepared ? 'Offline ready' : 'Prepare this device'}</div>
                  {prepared && <div style={{ color: '#287a49', fontSize: 12, fontWeight: 800 }}>✓ SAVED</div>}
                </div>
                <div style={{ marginTop: 4, color: '#777773', fontSize: 12.5, lineHeight: 1.45 }}>Downloads this event&apos;s guest list so this scanner can continue checking in guests without a connection.</div>
                <button type="button" onClick={handlePrepare} disabled={preparing} style={{ width: '100%', height: 42, marginTop: 11, border: 'none', borderRadius: 9, background: preparing ? '#d8d8d4' : prepared ? '#287a49' : '#161618', color: preparing ? '#6a6a66' : '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: preparing ? 'default' : 'pointer' }}>{preparing ? 'Saving offline guest list…' : prepared ? 'Offline ready ✓ · Refresh list' : 'Prepare for offline'}</button>
                {prepared && <div style={{ color: '#287a49', marginTop: 9, fontSize: 12, fontWeight: 600 }}>Saved {new Date(prepared.preparedAt).toLocaleString()} · this device can scan without internet</div>}
                {offlineMessage && <div role="status" aria-live="polite" style={{ color: prepared ? '#287a49' : '#555', marginTop: 9, fontSize: 12, fontWeight: prepared ? 600 : 400 }}>{offlineMessage}</div>}
              </div>

              {prepared && <div style={{ border: '1px solid #b9cfe8', borderRadius: 12, background: 'oklch(0.975 0.018 245)', padding: 13, marginTop: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Sync with QR</div>
                  <div style={{ color: '#356a9a', fontSize: 12, fontWeight: 800 }}>FULLY OFFLINE</div>
                </div>
                <div style={{ marginTop: 4, color: '#777773', fontSize: 12.5, lineHeight: 1.45 }}>Exchange queued check-ins with another prepared scanner. No internet, Wi-Fi, or hotspot is required.</div>
                <button type="button" onClick={() => { setOfflineSettingsOpen(false); setQrSyncOpen(true); }} style={{ width: '100%', height: 42, marginTop: 11, border: 'none', borderRadius: 9, background: '#356a9a', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Open QR sync</button>
              </div>}

              {prepared && <div style={{ border: '1px solid #e2e2de', borderRadius: 12, background: '#fff', padding: 13, marginTop: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Nearby gates</div>
                  <div style={{ color: peerState === 'connected' ? '#287a49' : '#777773', fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>{peerState}</div>
                </div>
                <div style={{ marginTop: 4, color: '#777773', fontSize: 12.5, lineHeight: 1.45 }}>Join another prepared scanner on this event to share check-ins directly. Server reconciliation remains final.</div>
                {peerState !== 'connected' && <>
                  <button type="button" onClick={joinNearbyGates} disabled={pairingBusy || peerState === 'pairing'} style={{ width: '100%', height: 42, marginTop: 11, border: 'none', borderRadius: 9, background: peerState === 'pairing' ? '#d8d8d4' : '#161618', color: peerState === 'pairing' ? '#6a6a66' : '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: pairingBusy || peerState === 'pairing' ? 'default' : 'pointer' }}>{peerState === 'pairing' ? peerSignalState === 'ready' ? 'Waiting for another scanner…' : peerSignalState === 'retrying' ? 'Reconnecting to gate network…' : 'Connecting to gate network…' : peerState === 'failed' ? 'Try nearby gates again' : 'Join nearby gates'}</button>
                  {peerState === 'pairing' && <div role="status" aria-live="polite" style={{ marginTop: 10, borderRadius: 9, background: peerSignalState === 'retrying' ? 'oklch(0.96 0.04 80)' : '#f0f0ed', padding: '10px 11px', fontSize: 12, lineHeight: 1.4, color: peerSignalState === 'retrying' ? '#6a5415' : '#555' }}><strong style={{ color: peerSignalState === 'retrying' ? '#6a5415' : '#161618' }}>{peerSignalState === 'ready' ? 'Gate network connected.' : peerSignalState === 'retrying' ? 'Gate network interrupted; retrying automatically.' : 'Connecting to the gate network.'}</strong> {peerSignalState === 'ready' ? 'Open Nearby gates on another prepared scanner for automatic pairing.' : 'Keep this scanner online while discovery starts.'}<button type="button" onClick={stopNearbyGates} style={{ display: 'block', marginTop: 8, border: 0, background: 'transparent', color: '#555', fontSize: 12, fontWeight: 700, padding: 0, textDecoration: 'underline', cursor: 'pointer' }}>Stop searching</button></div>}
                  {peerState === 'failed' && <div role="alert" style={{ marginTop: 10, borderRadius: 9, background: 'oklch(0.96 0.04 80)', padding: '10px 11px', fontSize: 12, lineHeight: 1.4, color: '#6a5415' }}><strong>The direct peer connection ended.</strong> Try nearby gates again or use manual pairing.</div>}
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#555' }}>Pair manually instead</summary>
                    <button type="button" onClick={beginPairing} disabled={pairingBusy} style={{ width: '100%', height: 38, marginTop: 10, border: '1px solid #d7d7d3', borderRadius: 8, background: '#fff', color: '#161618', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: pairingBusy ? 'default' : 'pointer' }}>{pairingBusy ? 'Working…' : 'Create pairing code'}</button>
                  <div style={{ marginTop: 11, fontSize: 12, fontWeight: 700 }}>Pairing code from another gate</div>
                  <textarea value={peerCode} onChange={event => setPeerCode(event.target.value)} placeholder="Paste an offer or reply code" rows={3} style={{ width: '100%', marginTop: 6, border: '1px solid #d7d7d3', borderRadius: 8, padding: 8, boxSizing: 'border-box', resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
                    <button type="button" onClick={replyToPairing} disabled={pairingBusy || !peerCode.trim()} style={{ flex: 1, height: 38, border: '1px solid #d7d7d3', borderRadius: 8, background: '#fff', color: '#161618', fontSize: 12, fontWeight: 700, cursor: pairingBusy || !peerCode.trim() ? 'default' : 'pointer' }}>Reply to offer</button>
                    <button type="button" onClick={completePairing} disabled={pairingBusy || !peerCode.trim()} style={{ flex: 1, height: 38, border: '1px solid #d7d7d3', borderRadius: 8, background: '#fff', color: '#161618', fontSize: 12, fontWeight: 700, cursor: pairingBusy || !peerCode.trim() ? 'default' : 'pointer' }}>Finish pairing</button>
                  </div>
                  </details>
                </>}
                {pairingCode && <div style={{ marginTop: 11 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Your pairing code</div>
                  <textarea readOnly value={pairingCode} rows={4} style={{ width: '100%', marginTop: 6, border: '1px solid #d7d7d3', borderRadius: 8, padding: 8, boxSizing: 'border-box', resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, background: '#f7f7f5' }} />
                  <button type="button" onClick={copyPairingCode} style={{ width: '100%', height: 38, marginTop: 7, border: '1px solid #d7d7d3', borderRadius: 8, background: '#fff', color: '#161618', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Copy pairing code</button>
                </div>}
                {pairingMessage && <div role="status" style={{ color: '#555', marginTop: 9, fontSize: 12, lineHeight: 1.4 }}>{pairingMessage}</div>}
              </div>}

              {prepared && <div style={{ border: '1px solid #e2e2de', borderRadius: 12, background: '#fff', padding: 13, marginTop: 9 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Clear offline data</div>
                <div style={{ marginTop: 4, color: '#777773', fontSize: 12.5, lineHeight: 1.45 }}>Removes this device&apos;s saved guest list after all queued admissions have synced.</div>
                <button type="button" onClick={handleClearOffline} disabled={pendingSync > 0} style={{ width: '100%', height: 42, marginTop: 11, border: '1px solid #d7d7d3', borderRadius: 9, background: '#fff', color: pendingSync > 0 ? '#a0a09b' : '#161618', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: pendingSync > 0 ? 'default' : 'pointer' }}>Clear offline data</button>
              </div>}

              {conflicts.map(conflict => <div key={conflict.attemptId} role="status" style={{ color: '#8a3b26', fontSize: 12, lineHeight: 1.45, marginTop: 12 }}>Conflict: {new Date(conflict.capturedAt).toLocaleString()} at {conflict.gateName} lost to {new Date(conflict.winnerCapturedAt).toLocaleString()} at {conflict.winnerGateName}.</div>)}
            </section>
          </div>
        )}
        {qrSyncOpen && <QrOfflineSyncSheet sessionId={sessionId} onImported={handleQrImported} onClose={() => setQrSyncOpen(false)} />}
      </div>
    </div>
  );
}
