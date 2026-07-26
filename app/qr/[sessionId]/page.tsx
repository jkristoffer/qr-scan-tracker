'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';
import { toQrDataUrl } from '@/lib/qr';
import { Item, ScanSession } from '@/lib/types';

interface QRCard {
  item: Item;
  dataUrl: string;
}

export default function QRCodesPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const router = useRouter();

  const [session, setSession] = useState<ScanSession | null>(null);
  const [cards, setCards] = useState<QRCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [sess, items] = await Promise.all([
          db.getSession(sessionId),
          db.getItems(sessionId),
        ]);
        setSession(sess);
        const generated = await Promise.all(
          items.map(async item => ({ item, dataUrl: await toQrDataUrl(item.barcode) }))
        );
        setCards(generated);
      } catch {
        router.push('/');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sessionId, router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#5a5a5e' }}>GENERATING QR CODES…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fbfbfa', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#161618' }}>
      {/* Header — hidden on print */}
      <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fbfbfa', borderBottom: '1px solid #ececea', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          onClick={() => router.push('/')}
          style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #e2e2de', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer', flexShrink: 0 }}
        >
          ‹
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session?.name}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.14em', color: '#9a9a96', marginTop: 2 }}>{cards.length} GUESTS</div>
        </div>
        <button
          onClick={() => window.print()}
          style={{ flexShrink: 0, padding: '9px 18px', background: '#161618', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Helvetica Neue', Helvetica, sans-serif" }}
        >
          Print
        </button>
      </div>

      {/* QR grid */}
      <div style={{ padding: '20px 16px 40px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
        {cards.map(({ item, dataUrl }) => (
          <div
            key={item.id}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', border: item.isVIP ? '2px solid #c6a24a' : '1px solid #e6e6e2', background: '#fff', borderRadius: 14, padding: '14px 10px 12px', pageBreakInside: 'avoid', breakInside: 'avoid' }}
          >
            <div style={{ padding: item.isVIP ? 5 : 0, border: item.isVIP ? '3px solid #c6a24a' : 'none', borderRadius: 10 }}>
              <img src={dataUrl} alt={item.barcode} style={{ width: 130, height: 130, display: 'block' }} />
            </div>
            <div style={{ marginTop: 9, fontSize: 13, fontWeight: 600, textAlign: 'center', lineHeight: 1.3, color: '#161618' }}>{item.name}</div>
            {item.isVIP && <div style={{ marginTop: 4, color: '#755710', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.12em' }}>VIP</div>}
            <div style={{ marginTop: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#9a9a96', textAlign: 'center', letterSpacing: '0.04em' }}>{item.barcode}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
