'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';
import { ScanSession } from '@/lib/types';

interface EventProgress { total: number; scanned: number; }

export function Dashboard() {
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [progress, setProgress] = useState<Record<string, EventProgress>>({});
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [uploadLabel, setUploadLabel] = useState<{ title: string; sub: string }>({ title: 'Upload guest list', sub: 'CSV or TXT, one name per line' });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [gateName, setGateName] = useState('');
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem('gate_name');
    setGateName(stored ?? 'Main Gate');
  }, []);

  const handleGateNameChange = (val: string) => {
    setGateName(val);
    localStorage.setItem('gate_name', val);
  };

  useEffect(() => {
    db.listSessions().then(async (list) => {
      setSessions(list);
      const prog = await db.getSessionsProgress(list.map(s => s.id));
      setProgress(prog);
    }).catch(console.error);
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsvFile(f);
    f.text().then(t => {
      const count = t.split(/\r?\n/).map(x => x.trim()).filter(Boolean).length;
      setUploadLabel({ title: `${count} guests loaded`, sub: 'Tap to replace · CSV or TXT' });
      if (!newName) setNewName(f.name.replace(/\.[^.]+$/, ''));
    });
  };

  const handleCreate = async () => {
    const name = newName.trim() || 'Untitled Event';
    setCreating(true);
    try {
      const session = await db.createSession(name);
      if (csvFile) {
        const text = await csvFile.text();
        const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        const items = lines.slice(0, 500).map(ln => {
          const [barcode, itemName] = ln.split(',').map(s => s.trim());
          return { barcode: barcode || ln, name: itemName || barcode || ln };
        });
        await db.createItems(items, session.id);
      }
      router.push(`/scan/${session.id}`);
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const isLive = (s: ScanSession) => {
    const age = Date.now() - new Date(s.created_at).getTime();
    return age < 1000 * 60 * 60 * 24; // created within 24h = live
  };

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', justifyContent: 'center', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, minHeight: '100vh', background: '#fbfbfa', color: '#161618', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '26px 22px 18px', borderBottom: '1px solid #ececea', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 16, height: 16, background: '#161618' }} />
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '0.34em' }}>GATE</div>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.22em', color: '#9a9a96', marginTop: 9 }}>
            DOOR SCANNER · CHECK-IN
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.18em', color: '#b4b4b0', flexShrink: 0 }}>GATE</div>
            <input
              value={gateName}
              onChange={e => handleGateNameChange(e.target.value)}
              placeholder="Main Gate"
              style={{ flex: 1, border: '1px solid #dcdcd8', background: '#fff', borderRadius: 9, padding: '8px 11px', fontSize: 14, fontFamily: "'Helvetica Neue', Helvetica, sans-serif", outline: 'none', color: '#161618' }}
              onFocus={e => (e.target.style.borderColor = '#161618')}
              onBlur={e => (e.target.style.borderColor = '#dcdcd8')}
            />
          </div>
        </div>

        {/* Event list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 120px' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#9a9a96', padding: '0 6px 12px' }}>
            YOUR EVENTS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sessions.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>
                NO EVENTS YET
              </div>
            )}
            {sessions.map(s => {
              const prog = progress[s.id] || { total: 0, scanned: 0 };
              const pct = prog.total > 0 ? Math.round((prog.scanned / prog.total) * 100) : 0;
              const live = isLive(s);
              return (
                <div
                  key={s.id}
                  onClick={() => router.push(`/scan/${s.id}`)}
                  style={{ border: '1px solid #e6e6e2', background: '#ffffff', borderRadius: 18, padding: '18px 18px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#161618')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#e6e6e2')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${live ? '#161618' : '#dadad6'}`, background: live ? '#161618' : 'transparent', color: live ? '#fff' : '#8a8a86', borderRadius: 999, padding: '5px 11px 5px 10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '0.16em' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: live ? 'oklch(0.78 0.18 152)' : '#c2c2be', animation: live ? 'liveDot 1.4s ease-in-out infinite' : 'none' }} />
                      {live ? 'LIVE' : 'UPCOMING'}
                    </div>
                    <div style={{ fontSize: 26, color: '#c8c8c4', lineHeight: 1, marginTop: -3 }}>›</div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', margin: '13px 0 7px' }}>{s.name}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: '#8c8c88', letterSpacing: '0.01em' }}>
                    {new Date(s.created_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 15 }}>
                    <div style={{ flex: 1, height: 6, background: '#eeeeea', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: '#161618', borderRadius: 999 }} />
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: '#161618', whiteSpace: 'nowrap' }}>
                      {prog.scanned}<span style={{ color: '#b6b6b2' }}>/{prog.total}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Floating new event button */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, background: 'linear-gradient(to top, #fbfbfa 62%, rgba(251,251,250,0))' }}>
          <div
            onClick={() => setShowNew(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#161618', color: '#fff', borderRadius: 14, height: 56, cursor: 'pointer', fontSize: 16, fontWeight: 600 }}
          >
            <span style={{ fontSize: 22, lineHeight: 0, marginTop: -2 }}>+</span> New event
          </div>
        </div>

        {/* New event bottom sheet */}
        {showNew && (
          <div
            onClick={() => setShowNew(false)}
            style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(20,20,22,0.42)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '22px 20px 26px', animation: 'sheetUp 0.34s cubic-bezier(0.16,1,0.3,1)' }}
            >
              <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 18px' }} />
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>New event</div>

              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', color: '#9a9a96', margin: '18px 0 8px' }}>EVENT NAME</div>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Foundations of Modern Pedagogy"
                style={{ width: '100%', border: '1px solid #dcdcd8', background: '#fff', borderRadius: 12, padding: '15px 14px', fontSize: 16, fontFamily: "'Helvetica Neue', Helvetica, sans-serif", outline: 'none' }}
                onFocus={e => (e.target.style.borderColor = '#161618')}
                onBlur={e => (e.target.style.borderColor = '#dcdcd8')}
              />

              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', color: '#9a9a96', margin: '18px 0 8px' }}>GUEST LIST</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px dashed #c8c8c4', background: '#fff', borderRadius: 12, padding: '15px 14px', cursor: 'pointer' }}>
                <div style={{ width: 40, height: 40, borderRadius: 9, background: '#f1f1ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19 }}>⤓</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{uploadLabel.title}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#9a9a96', marginTop: 3 }}>{uploadLabel.sub}</div>
                </div>
                <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: 'none' }} />
              </label>

              <div
                onClick={creating ? undefined : handleCreate}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: creating ? '#9a9a96' : '#161618', color: '#fff', borderRadius: 14, height: 56, cursor: creating ? 'default' : 'pointer', fontSize: 16, fontWeight: 600, marginTop: 20 }}
              >
                {creating ? 'Creating…' : 'Create & open scanner'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
