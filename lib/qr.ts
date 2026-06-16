import QRCode from 'qrcode';

export function toQrDataUrl(barcode: string): Promise<string> {
  return QRCode.toDataURL(barcode, {
    width: 200,
    margin: 1,
    color: { dark: '#161618', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}
