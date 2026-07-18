import type { Item } from '@/lib/types';

const WIDTH = 1080;
const HEIGHT = 1350;

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function fittedFontSize(context: CanvasRenderingContext2D, text: string, maxWidth: number, startingSize: number, minimumSize: number, weight = 700) {
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
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
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

/** Renders the same printable entry-pass template used for an individual guest. */
export async function renderTicketPassImage(eventName: string, item: Item, qrDataUrl: string): Promise<Blob> {
  const qrImage = await loadImage(qrDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image rendering is unavailable');

  context.fillStyle = '#e9e9e3';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.save();
  context.shadowColor = 'rgba(22, 22, 24, 0.14)'; context.shadowBlur = 30; context.shadowOffsetY = 12;
  context.fillStyle = '#ffffff'; roundedRect(context, 50, 40, 980, 1270, 48); context.fill(); context.restore();
  context.save(); roundedRect(context, 50, 40, 980, 1270, 48); context.clip();
  context.fillStyle = '#ffffff'; context.fillRect(50, 40, 980, 1270);
  context.fillStyle = '#161618'; context.fillRect(50, 40, 980, 330); context.restore();

  context.fillStyle = '#b9b9b3'; context.font = '700 24px Arial, Helvetica, sans-serif'; context.textBaseline = 'alphabetic'; context.fillText('ENTRY PASS', 120, 120);
  const eventFontSize = fittedFontSize(context, eventName, 840, 62, 36);
  context.font = `700 ${eventFontSize}px Arial, Helvetica, sans-serif`; context.fillStyle = '#ffffff'; context.fillText(clippedText(context, eventName, 840), 120, 215);
  context.font = '400 29px Arial, Helvetica, sans-serif'; context.fillStyle = '#d6d6d0'; context.fillText('Present this pass when you arrive at check-in.', 120, 300);
  context.fillStyle = '#e9e9e3'; context.beginPath(); context.arc(50, 370, 25, 0, Math.PI * 2); context.arc(1030, 370, 25, 0, Math.PI * 2); context.fill();
  context.save(); context.setLineDash([12, 14]); context.strokeStyle = '#deded8'; context.lineWidth = 2; context.beginPath(); context.moveTo(90, 370); context.lineTo(990, 370); context.stroke(); context.restore();
  context.fillStyle = '#85857f'; context.font = '700 21px Arial, Helvetica, sans-serif'; context.fillText('PREPARED FOR', 120, 455);
  const guestFontSize = fittedFontSize(context, item.name, 840, 54, 34);
  context.font = `700 ${guestFontSize}px Arial, Helvetica, sans-serif`; context.fillStyle = '#161618'; context.fillText(clippedText(context, item.name, 840), 120, 525);
  context.fillStyle = '#fafaf7'; context.strokeStyle = '#deded8'; context.lineWidth = 2; roundedRect(context, 200, 575, 680, 575, 30); context.fill(); context.stroke();
  context.fillStyle = '#666660'; context.font = '700 21px Arial, Helvetica, sans-serif'; context.textAlign = 'center'; context.fillText('SCAN AT CHECK-IN', WIDTH / 2, 630);
  context.fillStyle = '#ffffff'; roundedRect(context, 270, 660, 540, 440, 20); context.fill(); context.imageSmoothingEnabled = false; context.drawImage(qrImage, 320, 680, 440, 440);
  context.fillStyle = '#85857f'; context.font = '700 20px Arial, Helvetica, sans-serif'; context.fillText('TICKET CODE', WIDTH / 2, 1212);
  const barcodeFontSize = fittedFontSize(context, item.barcode, 800, 30, 20);
  context.font = `700 ${barcodeFontSize}px "Courier New", Courier, monospace`; context.fillStyle = '#29292b'; context.fillText(clippedText(context, item.barcode, 800), WIDTH / 2, 1260);

  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create ticket image')), 'image/jpeg', 0.92));
}
