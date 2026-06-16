'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';
import { useScanStore } from '@/store/useScanStore';
import { Scanner } from '@/components/Scanner';
import { ProgressCard } from '@/components/ProgressCard';
import { ItemList } from '@/components/ItemList';
import { ResultFlood, ScanResultFlood } from '@/components/ResultFlood';
import { ScanResult } from '@/lib/types';

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
  const [panelOpen, setPanelOpen] = useState(true);
  const [listFull, setListFull] = useState(false);
  const floodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        router.push('/');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sessionId, router, setItems]);

  useEffect(() => {
    const channel = db.subscribeToItems(sessionId, payload => {
      if (payload.eventType === 'UPDATE') updateItem(payload.new as any);
    });
    channel.subscribe((status: string) => setIsConnected(status === 'SUBSCRIBED'));
    return () => { channel.unsubscribe(); };
  }, [sessionId, updateItem]);

  const showFlood = useCallback((result: ScanResultFlood) => {
    if (floodTimer.current) clearTimeout(floodTimer.current);
    setFlood(result);
    floodTimer.current = setTimeout(() => setFlood(null), result.type === 'admit' ? 1500 : 2000);
  }, []);

  const handleScanComplete = useCallback((result: ScanResult) => {
    setLastScan({ barcode: result.item?.barcode || '', result: result.type, message: result.message, timestamp: Date.now() });
    if (result.success && result.item) updateItem(result.item);

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
        ? (result.item?.barcode ?? '')
        : result.type === 'duplicate'
          ? 'Entered earlier · This gate'
          : 'Code ' + (result.item?.barcode ?? '—'),
    });
  }, [setLastScan, updateItem, showFlood]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#5a5a5e' }}>LOADING…</div>
      </div>
    );
  }

  const showPanel = panelOpen || listFull;

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', justifyContent: 'center', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, height: '100vh', background: '#fbfbfa', color: '#161618', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#161618', border: '1px solid #e2e2de', borderRadius: 999, padding: '5px 10px', flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isConnected ? 'oklch(0.74 0.17 152)' : '#c2c2be', animation: isConnected ? 'liveDot 1.4s ease-in-out infinite' : 'none' }} />
            LIVE
          </div>
        </div>

        {/* Camera hero — hidden when list is fullscreen */}
        <div style={{ display: listFull ? 'none' : 'contents' }}>
          <Scanner sessionId={sessionId} onScanComplete={handleScanComplete} />
        </div>

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
            <ItemList />
          </>
        )}

        {/* Result flood overlay */}
        {flood && (
          <ResultFlood
            result={flood}
            onDismiss={() => { if (floodTimer.current) clearTimeout(floodTimer.current); setFlood(null); }}
          />
        )}
      </div>
    </div>
  );
}
