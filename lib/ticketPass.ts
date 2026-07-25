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
    context.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    if (context.measureText(text).width <= maxWidth) return { lines: [text], size };
    for (let split = 1; split < words.length; split += 1) {
      const lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
      if (lines.every(line => context.measureText(line).width <= maxWidth)) return { lines, size };
    }
  }
  context.font = '700 34px Georgia, "Times New Roman", serif';
  const midpoint = Math.max(1, Math.ceil(words.length / 2));
  return {
    lines: [
      clippedText(context, words.slice(0, midpoint).join(' '), maxWidth),
      clippedText(context, words.slice(midpoint).join(' '), maxWidth),
    ],
    size: 34,
  };
}

function drawLeafSprig(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  rotation: number,
  color: string,
) {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(scale, scale);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, 0);
  context.quadraticCurveTo(50, -14, 112, -92);
  context.stroke();
  for (let index = 0; index < 5; index += 1) {
    const leafX = 24 + index * 18;
    const leafY = -18 - index * 15;
    context.save();
    context.translate(leafX, leafY);
    context.rotate(index % 2 === 0 ? -0.55 : 0.65);
    context.beginPath();
    context.ellipse(0, 0, 9, 22, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  context.restore();
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
  context.font = `700 ${primarySize}px Georgia, "Times New Roman", serif`;
  context.fillText(clippedText(context, primary, maxWidth), x, y + 43);
  context.fillStyle = MUTED;
  context.font = '400 20px Arial, Helvetica, sans-serif';
  context.fillText(clippedText(context, secondary, maxWidth), x, y + 78);
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
  const [qrImage, logoImage] = await Promise.all([
    loadImage(qrDataUrl),
    loadImage('/asez-wao-logo.svg'),
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
  context.fillRect(45, 35, 990, 320);
  context.globalAlpha = 0.22;
  drawLeafSprig(context, 905, 300, 1.35, Math.PI, '#d8c697');
  drawLeafSprig(context, 970, 175, 1.05, 2.35, '#d8c697');
  context.globalAlpha = 1;
  context.restore();

  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.fillStyle = '#fffdf6';
  roundedRect(context, 105, 67, 250, 66, 14);
  context.fill();
  context.drawImage(logoImage, 125, 76, 210, 49);
  context.fillStyle = '#d8c697';
  context.font = '700 16px Arial, Helvetica, sans-serif';
  context.fillText('ENTRY PASS', 380, 108);

  const title = fittedTitle(context, eventName, 760);
  context.font = `700 ${title.size}px Georgia, "Times New Roman", serif`;
  context.fillStyle = '#fffdf6';
  title.lines.forEach((line, index) => context.fillText(line, 110, 175 + index * (title.size + 8)));

  context.fillStyle = '#d8c697';
  context.font = 'italic 25px Georgia, "Times New Roman", serif';
  context.fillText('Music for a Sustainable Future', 110, 294);

  context.fillStyle = GOLD;
  context.fillRect(110, 385, 52, 3);
  context.fillStyle = MID_GREEN;
  context.font = '700 17px Arial, Helvetica, sans-serif';
  context.fillText('PREPARED FOR', 110, 430);
  const guestFontSize = fittedFontSize(context, item.name, 860, 48, 32);
  context.font = `700 ${guestFontSize}px Georgia, "Times New Roman", serif`;
  context.fillStyle = DEEP_GREEN;
  context.fillText(clippedText(context, item.name, 860), 110, 490);

  context.fillStyle = '#fffdf7';
  context.strokeStyle = '#d9cfbb';
  context.lineWidth = 2;
  roundedRect(context, 280, 525, 520, 490, 26);
  context.fill();
  context.stroke();
  context.textAlign = 'center';
  context.fillStyle = MID_GREEN;
  context.font = '700 18px Arial, Helvetica, sans-serif';
  context.fillText('SCAN AT CHECK-IN', WIDTH / 2, 573);
  context.fillStyle = '#ffffff';
  roundedRect(context, 337, 602, 406, 370, 18);
  context.fill();
  context.imageSmoothingEnabled = false;
  context.drawImage(qrImage, 355, 607, 370, 370);

  context.strokeStyle = '#d8cdb8';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(110, 1065);
  context.lineTo(970, 1065);
  context.stroke();
  context.save();
  context.globalAlpha = 0.12;
  drawLeafSprig(context, 1020, 1235, 0.62, Math.PI, MID_GREEN);
  drawLeafSprig(context, 78, 1160, 0.48, 0.18, GOLD);
  context.restore();
  drawEventDetail(context, 'WHEN', 'Sunday, 2 August 2026', '4:00 PM–6:00 PM  ·  Registration 3:15 PM', 110, 1105, 405);
  drawEventDetail(context, 'WHERE', 'National Museum of Singapore', 'Gallery Theatre', 550, 1105, 420);

  context.fillStyle = DEEP_GREEN;
  context.fillRect(45, 1245, 990, 70);
  context.textAlign = 'left';
  context.fillStyle = '#d8c697';
  context.font = '700 16px Arial, Helvetica, sans-serif';
  context.fillText('TICKET CODE', 110, 1288);
  const barcodeFontSize = fittedFontSize(context, item.barcode, 530, 24, 18);
  context.textAlign = 'right';
  context.font = `700 ${barcodeFontSize}px "Courier New", Courier, monospace`;
  context.fillStyle = '#fffdf6';
  context.fillText(clippedText(context, item.barcode, 530), 970, 1289);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not create ticket image')),
      format,
      format === 'image/jpeg' ? 0.92 : undefined,
    );
  });
}
