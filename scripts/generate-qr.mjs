#!/usr/bin/env node
/**
 * Usage: node scripts/generate-qr.mjs [input.csv] [output.html]
 *
 * Reads a barcode,name CSV and writes a printable HTML sheet of QR codes.
 * Default input:  sample-guests.csv
 * Default output: qrcodes.html
 *
 * Open qrcodes.html in a browser and File → Print (set paper size, no margins)
 * to produce a PDF or physical printout of ticket QR codes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const inputFile  = process.argv[2] || path.join(root, 'sample-guests.csv');
const outputFile = process.argv[3] || path.join(root, 'qrcodes.html');

// Parse CSV
const text  = fs.readFileSync(inputFile, 'utf-8');
const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const rows  = lines.slice(1).map(line => {
  const [barcode, ...rest] = line.split(',');
  return { barcode: barcode.trim(), name: rest.join(',').trim() };
}).filter(r => r.barcode);

if (rows.length === 0) {
  console.error('No rows found. Check your CSV format: barcode,name');
  process.exit(1);
}

// Generate QR data URLs
const cards = await Promise.all(rows.map(async ({ barcode, name }) => {
  const dataUrl = await QRCode.toDataURL(barcode, {
    width: 200,
    margin: 1,
    color: { dark: '#161618', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
  return { barcode, name, dataUrl };
}));

// Build HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ticket QR Codes</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    background: #fff;
    padding: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    border: 1px solid #e6e6e2;
    border-radius: 12px;
    padding: 16px 12px 14px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .card img {
    width: 140px;
    height: 140px;
    display: block;
  }
  .card .name {
    margin-top: 10px;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    color: #161618;
    line-height: 1.3;
  }
  .card .code {
    margin-top: 4px;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 10px;
    color: #9a9a96;
    text-align: center;
    letter-spacing: 0.05em;
  }
  @media print {
    body { padding: 8px; }
    .grid { gap: 10px; }
  }
</style>
</head>
<body>
<div class="grid">
${cards.map(({ barcode, name, dataUrl }) => `  <div class="card">
    <img src="${dataUrl}" alt="${barcode}" />
    <div class="name">${escHtml(name)}</div>
    <div class="code">${escHtml(barcode)}</div>
  </div>`).join('\n')}
</div>
</body>
</html>`;

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

fs.writeFileSync(outputFile, html, 'utf-8');
console.log(`✓ Generated ${cards.length} QR codes → ${path.relative(process.cwd(), outputFile)}`);
