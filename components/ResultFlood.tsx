'use client';

export interface ScanResultFlood {
  type: 'admit' | 'already' | 'nomatch';
  name: string;
  sub: string;
  isVIP?: boolean;
  isStaff?: boolean;
}

const ADMIT_COLOR  = 'oklch(0.74 0.17 152)';
const ALREADY_COLOR = 'oklch(0.76 0.15 75)';
const NOMATCH_COLOR = 'oklch(0.62 0.21 26)';

function AdmitGlyph() {
  return (
    <div style={{ position: 'relative', width: 132, height: 132 }}>
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 50, height: 92, borderRight: '18px solid #fff', borderBottom: '18px solid #fff', borderRadius: 3, transform: 'translate(-50%,-58%) rotate(45deg)' }} />
    </div>
  );
}

function AlreadyGlyph() {
  return (
    <div style={{ position: 'relative', width: 132, height: 132 }}>
      <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 20, height: 78, background: '#fff', borderRadius: 10 }} />
      <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', width: 22, height: 22, background: '#fff', borderRadius: '50%' }} />
    </div>
  );
}

function NoMatchGlyph() {
  return (
    <div style={{ position: 'relative', width: 132, height: 132 }}>
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 128, height: 18, background: '#fff', borderRadius: 4, transform: 'translate(-50%,-50%) rotate(45deg)' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 128, height: 18, background: '#fff', borderRadius: 4, transform: 'translate(-50%,-50%) rotate(-45deg)' }} />
    </div>
  );
}

const CONFIG = {
  admit:   { color: ADMIT_COLOR,   word: 'ADMITTED',   Glyph: AdmitGlyph },
  already: { color: ALREADY_COLOR, word: 'ALREADY IN', Glyph: AlreadyGlyph },
  nomatch: { color: NOMATCH_COLOR, word: 'NO MATCH',   Glyph: NoMatchGlyph },
} as const;

interface ResultFloodProps {
  result: ScanResultFlood;
  onDismiss: () => void;
}

export function ResultFlood({ result, onDismiss }: ResultFloodProps) {
  const { color, word, Glyph } = CONFIG[result.type];

  return (
    <div
      onClick={onDismiss}
      style={{ position: 'absolute', inset: 0, zIndex: 60, background: color, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, animation: 'floodPop 0.22s ease-out', cursor: 'pointer' }}
    >
      <div style={{ animation: 'glyphPop 0.34s cubic-bezier(0.16,1.4,0.3,1)' }}>
        <Glyph />
      </div>
      <div style={{ color: '#fff', fontSize: 52, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 22, textAlign: 'center', lineHeight: 0.98 }}>
        {word}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.96)', fontSize: 23, fontWeight: 600, marginTop: 14, textAlign: 'center' }}>
        {result.name}
      </div>
      {result.isVIP && (
        <div style={{ marginTop: 12, border: '2px solid #ffe7a0', background: '#c6a24a', color: '#2d2208', borderRadius: 999, padding: '7px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 800, letterSpacing: '0.16em' }}>
          VIP GUEST
        </div>
      )}
      {result.isStaff && (
        <div style={{ marginTop: 12, border: '2px solid #bfdbfe', background: '#2563eb', color: '#f8fbff', borderRadius: 999, padding: '7px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 800, letterSpacing: '0.16em' }}>
          STAFF GUEST
        </div>
      )}
      <div style={{ fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.82)', fontSize: 12, letterSpacing: '0.08em', marginTop: 9, textAlign: 'center' }}>
        {result.sub}
      </div>
    </div>
  );
}
