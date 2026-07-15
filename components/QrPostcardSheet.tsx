'use client';

import { useEffect, useRef, useState } from 'react';
import type { Item } from '@/lib/types';

const POSTCARD_WIDTH = 1080;
const POSTCARD_HEIGHT = 1350;

interface QrPostcardSheetProps {
  eventName: string;
  item: Item;
  qrDataUrl: string;
  onClose: () => void;
}

interface PostcardAsset {
  blob: Blob;
  url: string;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function fittedFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startingSize: number,
  minimumSize: number,
  weight = 700,
) {
  let size = startingSize;
  while (size > minimumSize) {
    context.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
    if (context.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minimumSize;
}

function clippedText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}…`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load QR code image'));
    image.src = src;
  });
}

async function renderPostcard(eventName: string, item: Item, qrDataUrl: string): Promise<Blob> {
  const qrImage = await loadImage(qrDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = POSTCARD_WIDTH;
  canvas.height = POSTCARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image rendering is unavailable');

  context.fillStyle = '#e9e9e3';
  context.fillRect(0, 0, POSTCARD_WIDTH, POSTCARD_HEIGHT);

  context.save();
  context.shadowColor = 'rgba(22, 22, 24, 0.14)';
  context.shadowBlur = 30;
  context.shadowOffsetY = 12;
  context.fillStyle = '#ffffff';
  roundedRect(context, 50, 40, 980, 1270, 48);
  context.fill();
  context.restore();

  context.save();
  roundedRect(context, 50, 40, 980, 1270, 48);
  context.clip();
  context.fillStyle = '#ffffff';
  context.fillRect(50, 40, 980, 1270);
  context.fillStyle = '#161618';
  context.fillRect(50, 40, 980, 330);
  context.restore();

  context.fillStyle = '#b9b9b3';
  context.font = '700 24px Arial, Helvetica, sans-serif';
  context.textBaseline = 'alphabetic';
  context.fillText('ENTRY PASS', 120, 120);

  const eventFontSize = fittedFontSize(context, eventName, 840, 62, 36);
  context.font = `700 ${eventFontSize}px Arial, Helvetica, sans-serif`;
  context.fillStyle = '#ffffff';
  context.fillText(clippedText(context, eventName, 840), 120, 215);

  context.font = '400 29px Arial, Helvetica, sans-serif';
  context.fillStyle = '#d6d6d0';
  context.fillText('Present this pass when you arrive at check-in.', 120, 300);

  context.fillStyle = '#e9e9e3';
  context.beginPath();
  context.arc(50, 370, 25, 0, Math.PI * 2);
  context.arc(1030, 370, 25, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.setLineDash([12, 14]);
  context.strokeStyle = '#deded8';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(90, 370);
  context.lineTo(990, 370);
  context.stroke();
  context.restore();

  context.fillStyle = '#85857f';
  context.font = '700 21px Arial, Helvetica, sans-serif';
  context.fillText('PREPARED FOR', 120, 455);

  const guestFontSize = fittedFontSize(context, item.name, 840, 54, 34);
  context.font = `700 ${guestFontSize}px Arial, Helvetica, sans-serif`;
  context.fillStyle = '#161618';
  context.fillText(clippedText(context, item.name, 840), 120, 525);

  context.fillStyle = '#fafaf7';
  context.strokeStyle = '#deded8';
  context.lineWidth = 2;
  roundedRect(context, 200, 575, 680, 575, 30);
  context.fill();
  context.stroke();

  context.fillStyle = '#666660';
  context.font = '700 21px Arial, Helvetica, sans-serif';
  context.textAlign = 'center';
  context.fillText('SCAN AT CHECK-IN', POSTCARD_WIDTH / 2, 630);

  context.fillStyle = '#ffffff';
  roundedRect(context, 270, 660, 540, 440, 20);
  context.fill();
  context.imageSmoothingEnabled = false;
  context.drawImage(qrImage, 320, 680, 440, 440);

  context.fillStyle = '#85857f';
  context.font = '700 20px Arial, Helvetica, sans-serif';
  context.fillText('TICKET CODE', POSTCARD_WIDTH / 2, 1212);

  const barcodeFontSize = fittedFontSize(context, item.barcode, 800, 30, 20);
  context.font = `700 ${barcodeFontSize}px "Courier New", Courier, monospace`;
  context.fillStyle = '#29292b';
  context.fillText(clippedText(context, item.barcode, 800), POSTCARD_WIDTH / 2, 1260);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create postcard image'));
    }, 'image/png');
  });
}

function postcardFilename(eventName: string, guestName: string) {
  const stem = `${eventName}-${guestName}-entry-pass`
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `${stem || 'qr-entry-pass'}.png`;
}

export function QrPostcardSheet({ eventName, item, qrDataUrl, onClose }: QrPostcardSheetProps) {
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

    void renderPostcard(eventName, item, qrDataUrl)
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
  }, [eventName, item, qrDataUrl]);

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
