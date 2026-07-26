import type { Item } from '@/lib/types';

const WIDTH = 1080;
const HEIGHT = 1350;
const IVORY = '#f6f1e4';
const DEEP_GREEN = '#173f32';
const MID_GREEN = '#50705b';
const GOLD = '#a46f3d';
const MUTED = '#776f61';

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

function fittedTitle(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): { lines: string[]; size: number } {
  const words = text.trim().split(/\s+/);
  for (let size = 58; size >= 34; size -= 2) {
    context.font = `700 ${size}px Arial, Helvetica, sans-serif`;
    if (context.measureText(text).width <= maxWidth) return { lines: [text], size };
    for (let split = 1; split < words.length; split += 1) {
      const lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
      if (lines.every(line => context.measureText(line).width <= maxWidth)) return { lines, size };
    }
  }
  context.font = '700 34px Arial, Helvetica, sans-serif';
  const midpoint = Math.max(1, Math.ceil(words.length / 2));
  return {
    lines: [
      clippedText(context, words.slice(0, midpoint).join(' '), maxWidth),
      clippedText(context, words.slice(midpoint).join(' '), maxWidth),
    ],
    size: 34,
  };
}

function drawEventDetail(
  context: CanvasRenderingContext2D,
  label: string,
  primary: string,
  secondary: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  context.textAlign = 'left';
  context.fillStyle = GOLD;
  context.font = '700 18px Arial, Helvetica, sans-serif';
  context.fillText(label, x, y);
  context.fillStyle = DEEP_GREEN;
  const primarySize = fittedFontSize(context, primary, maxWidth, 26, 18);
  context.font = `700 ${primarySize}px Arial, Helvetica, sans-serif`;
  context.fillText(clippedText(context, primary, maxWidth), x, y + 52);
  context.fillStyle = MUTED;
  context.font = '400 20px Arial, Helvetica, sans-serif';
  context.fillText(clippedText(context, secondary, maxWidth), x, y + 98);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ticket image asset: ${src}`));
    image.src = src;
  });
}

/** Renders the same printable entry-pass template used for an individual guest. */
export async function renderTicketPassImage(
  eventName: string,
  item: Item,
  qrDataUrl: string,
  format: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<Blob> {
  const [qrImage, logoImage, botanicalImage] = await Promise.all([
    loadImage(qrDataUrl),
    loadImage('/asez-wao-logo.svg'),
    loadImage('/botanical-ornament.png'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image rendering is unavailable');

  context.fillStyle = '#e8e1d2';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.save();
  context.shadowColor = 'rgba(40, 48, 38, 0.15)';
  context.shadowBlur = 28;
  context.shadowOffsetY = 12;
  context.fillStyle = IVORY;
  roundedRect(context, 45, 35, 990, 1280, 40);
  context.fill();
  context.restore();

  context.save();
  roundedRect(context, 45, 35, 990, 1280, 40);
  context.clip();
  context.fillStyle = IVORY;
  context.fillRect(45, 35, 990, 1280);
  context.fillStyle = DEEP_GREEN;
  context.fillRect(45, 35, 990, 250);
  context.globalAlpha = 0.28;
  context.drawImage(botanicalImage, 625, 62, 340, 92);
  context.globalAlpha = 1;
  context.restore();

  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.fillStyle = '#d8c697';
  context.font = '700 18px Arial, Helvetica, sans-serif';
  context.fillText('ENTRY PASS', 110, 92);

  const title = fittedTitle(context, eventName, 820);
  context.font = `700 ${title.size}px Arial, Helvetica, sans-serif`;
  context.fillStyle = '#fffdf6';
  title.lines.forEach((line, index) => context.fillText(line, 110, 154 + index * (title.size + 7)));

  context.fillStyle = '#d8c697';
  context.font = 'italic 23px Arial, Helvetica, sans-serif';
  context.fillText('Music for a Sustainable Future', 110, 256);

  context.fillStyle = GOLD;
  context.fillRect(110, 315, 52, 3);
  context.fillStyle = MID_GREEN;
  context.font = '700 17px Arial, Helvetica, sans-serif';
  context.fillText('PREPARED FOR', 110, 355);
  const guestFontSize = fittedFontSize(context, item.name, 860, 48, 32);
  context.font = `700 ${guestFontSize}px Arial, Helvetica, sans-serif`;
  context.fillStyle = DEEP_GREEN;
  context.fillText(clippedText(context, item.name, 860), 110, 408);

  context.fillStyle = '#fffdf7';
  context.strokeStyle = '#d9cfbb';
  context.lineWidth = 2;
  roundedRect(context, 80, 440, 920, 660, 28);
  context.fill();
  context.stroke();
  context.fillStyle = '#ffffff';
  roundedRect(context, 215, 455, 650, 630, 20);
  context.fill();
  if (item.isVIP) {
    context.strokeStyle = GOLD;
    context.lineWidth = 8;
    context.stroke();
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(qrImage, 230, 460, 620, 620);

  context.strokeStyle = '#d8cdb8';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(110, 1108);
  context.lineTo(970, 1108);
  context.stroke();
  drawEventDetail(context, 'WHEN', 'Sunday, 2 August 2026', '4:00 PM–6:00 PM  ·  Registration 3:15 PM', 110, 1128, 405);
  drawEventDetail(context, 'WHERE', 'National Museum of Singapore', 'Gallery Theatre', 550, 1128, 420);

  context.drawImage(logoImage, 455, 1248, 170, 40);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not create ticket image')),
      format,
      format === 'image/jpeg' ? 0.92 : undefined,
    );
  });
}
