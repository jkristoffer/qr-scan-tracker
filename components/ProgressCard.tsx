'use client';

import { Progress } from '@/lib/types';

interface ProgressCardProps {
  progress: Progress;
  isConnected: boolean;
}

export function ProgressCard({ progress, isConnected }: ProgressCardProps) {
  const pct = Math.round(progress.percentage);

  return (
    <div style={{ flexShrink: 0, padding: '16px 18px 14px', borderBottom: '1px solid #ececea', background: '#fbfbfa' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 0.9 }}>{progress.scanned}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#c2c2be', letterSpacing: '-0.02em' }}>/ {progress.total}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: '#9a9a96', marginLeft: 8, paddingBottom: 5 }}>CHECKED IN</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, paddingBottom: 4 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: '#161618' }}>{pct}%</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isConnected ? 'oklch(0.74 0.17 152)' : '#c2c2be', animation: isConnected ? 'liveDot 1.4s ease-in-out infinite' : 'none' }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.14em', color: '#b4b4b0' }}>{isConnected ? 'LIVE' : 'OFFLINE'}</span>
          </div>
        </div>
      </div>

      <div style={{ height: 8, background: '#ededea', borderRadius: 999, overflow: 'hidden', marginTop: 12 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#161618', borderRadius: 999, transition: 'width 0.4s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#8c8c88', marginTop: 11 }}>
        {Math.max(0, progress.total - progress.scanned)} still expected
      </div>
    </div>
  );
}
