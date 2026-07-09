import { Resend } from 'resend';
import { toQrPngBase64 } from '@/lib/qr';
import { Item, ScanSession } from '@/lib/types';

export interface QrEmailContent {
  subject: string;
  html: string;
  text: string;
  contentId: string;
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeCid(value: string): string {
  return `qr-${value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'ticket'}`;
}

export function renderQrEmail(session: ScanSession, item: Item): QrEmailContent {
  const eventName = session.name;
  const name = item.name;
  const barcode = item.barcode;
  const contentId = safeCid(item.id);

  return {
    subject: `Your QR code for ${eventName}`,
    contentId,
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#f6f6f3;font-family:Helvetica,Arial,sans-serif;color:#161618;">
    <div style="max-width:520px;margin:0 auto;padding:28px 18px;">
      <div style="background:#ffffff;border:1px solid #e6e6e2;border-radius:14px;padding:24px;text-align:center;">
        <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8c8c88;">${escHtml(eventName)}</div>
        <h1 style="margin:12px 0 6px;font-size:24px;line-height:1.2;">${escHtml(name)}</h1>
        <p style="margin:0 0 20px;color:#666662;font-size:14px;line-height:1.5;">Show this QR code at check-in.</p>
        <img src="cid:${contentId}" alt="QR code for ${escHtml(barcode)}" width="240" height="240" style="display:block;margin:0 auto 16px;border:1px solid #ececea;border-radius:10px;" />
        <div style="font-family:'Courier New',monospace;font-size:13px;letter-spacing:0.08em;color:#6a6a66;">${escHtml(barcode)}</div>
      </div>
    </div>
  </body>
</html>`,
    text: [
      `Your QR code for ${eventName}`,
      '',
      `Name: ${name}`,
      `Code: ${barcode}`,
      '',
      'Show the attached QR code at check-in.',
    ].join('\n'),
  };
}

export async function sendQrEmail(session: ScanSession, item: Item): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.QR_EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error('QR email is not configured');
  }
  if (!item.email) {
    throw new Error('Guest has no email address');
  }

  const content = renderQrEmail(session, item);
  const qrPng = await toQrPngBase64(item.barcode);
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: [item.email],
    replyTo: process.env.QR_EMAIL_REPLY_TO || undefined,
    subject: content.subject,
    html: content.html,
    text: content.text,
    attachments: [
      {
        filename: `${item.barcode}.png`,
        content: qrPng,
        contentId: content.contentId,
      },
    ],
  });

  if (error) {
    throw new Error(error.message || 'Resend send failed');
  }
  if (!data?.id) {
    throw new Error('Resend did not return an email id');
  }
  return data.id;
}
