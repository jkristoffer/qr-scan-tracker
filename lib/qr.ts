import QRCode from 'qrcode';

export function toQrDataUrl(barcode: string): Promise<string> {
  return QRCode.toDataURL(barcode, {
    width: 200,
    margin: 1,
    color: { dark: '#161618', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}

export async function toQrPngBase64(barcode: string): Promise<string> {
  const buffer = await QRCode.toBuffer(barcode, {
    type: 'png',
    width: 360,
    margin: 1,
    color: { dark: '#161618', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
  return buffer.toString('base64');
}
