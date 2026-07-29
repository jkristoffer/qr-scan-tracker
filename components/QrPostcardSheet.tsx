'use client';

import { useEffect, useRef, useState } from 'react';
import { renderTicketPassImage } from '@/lib/ticketPass';
import type { Item } from '@/lib/types';

interface QrPostcardSheetProps {
  eventName: string;
  eventTagline: string | null;
  eventDate: string | null;
  eventTiming: string | null;
  registrationStart: string | null;
  venue: string | null;
  venueField2: string | null;
  item: Item;
  qrDataUrl: string;
  onClose: () => void;
}

interface PostcardAsset {
  blob: Blob;
  url: string;
}

function postcardFilename(eventName: string, guestName: string) {
  const stem = `${eventName}-${guestName}-entry-pass`
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `${stem || 'qr-entry-pass'}.png`;
}

export function QrPostcardSheet({ eventName, eventTagline, eventDate, eventTiming, registrationStart, venue, venueField2, item, qrDataUrl, onClose }: QrPostcardSheetProps) {
  const [asset, setAsset] = useState<PostcardAsset | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sharing, setSharing] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setAsset(null);
    setError('');
    setMessage('');

    void renderTicketPassImage(eventName, eventTagline, eventDate, eventTiming, registrationStart, venue, venueField2, item, qrDataUrl, 'image/png')
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setAsset({ blob, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setError('Could not prepare this pass. Close it and try again.');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [eventName, eventTagline, eventDate, eventTiming, registrationStart, venue, venueField2, item, qrDataUrl]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  const saveImage = () => {
    if (!asset) return;
    const link = document.createElement('a');
    link.href = asset.url;
    link.download = postcardFilename(eventName, item.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setMessage('Pass saved as a PNG image.');
  };

  const shareImage = async () => {
    if (!asset || sharing) return;
    const file = new File([asset.blob], postcardFilename(eventName, item.name), { type: 'image/png' });
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
      saveImage();
      setMessage('Image sharing is not available in this browser, so the pass was saved instead.');
      return;
    }

    setSharing(true);
    setMessage('');
    try {
      await navigator.share({
        files: [file],
        title: `${eventName} entry pass`,
        text: `Entry pass for ${item.name}`,
      });
      setMessage('Pass shared.');
    } catch (shareError) {
      if (!(shareError instanceof DOMException && shareError.name === 'AbortError')) {
        setMessage('Could not open the share sheet. Save the image and share it from your photos or files.');
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Entry pass for ${item.name}`}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,16,18,0.92)', display: 'flex', justifyContent: 'center', overflowY: 'auto' }}
    >
      <div
        onClick={event => event.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, minHeight: '100dvh', padding: '18px 16px 28px', display: 'flex', flexDirection: 'column', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#fff' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
            <div style={{ marginTop: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: '#a9a9a4' }}>INDIVIDUAL ENTRY PASS</div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close entry pass"
            style={{ width: 42, height: 42, flexShrink: 0, border: '1px solid #3e3e40', borderRadius: 12, background: '#232325', color: '#fff', fontSize: 22, lineHeight: 1, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {!asset && !error && (
            <div role="status" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: '#a9a9a4' }}>PREPARING PASS…</div>
          )}
          {error && <div role="alert" style={{ maxWidth: 320, textAlign: 'center', fontSize: 14, lineHeight: 1.5, color: '#f0b8b2' }}>{error}</div>}
          {asset && (
            <img
              src={asset.url}
              alt={`Postcard entry pass for ${item.name} at ${eventName}`}
              style={{ display: 'block', width: '100%', maxWidth: 440, maxHeight: 'calc(100dvh - 210px)', objectFit: 'contain', borderRadius: 18 }}
            />
          )}
        </div>

        <div style={{ paddingTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              type="button"
              onClick={saveImage}
              disabled={!asset || sharing}
              style={{ height: 50, borderRadius: 12, border: '1px solid #4a4a4c', background: '#252527', color: asset && !sharing ? '#fff' : '#737376', fontSize: 14, fontWeight: 700, cursor: asset && !sharing ? 'pointer' : 'default' }}
            >
              Save image
            </button>
            <button
              type="button"
              onClick={shareImage}
              disabled={!asset || sharing}
              style={{ height: 50, borderRadius: 12, border: 'none', background: asset && !sharing ? '#fff' : '#4a4a4c', color: asset && !sharing ? '#161618' : '#8a8a8c', fontSize: 14, fontWeight: 700, cursor: asset && !sharing ? 'pointer' : 'default' }}
            >
              {sharing ? 'Sharing…' : 'Share pass'}
            </button>
          </div>
          <div role="status" aria-live="polite" style={{ minHeight: 32, paddingTop: 9, textAlign: 'center', fontSize: 11, lineHeight: 1.4, color: '#a9a9a4' }}>
            {message || 'Saved as a high-resolution PNG. Sharing uses your device share sheet.'}
          </div>
        </div>
      </div>
    </div>
  );
}
