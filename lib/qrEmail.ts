import { Resend } from 'resend';
import type { ReactElement } from 'react';
import { QrTicketEmail } from '@/emails/QrTicketEmail';
import { toQrPngBase64 } from '@/lib/qr';
import { Item, ScanSession } from '@/lib/types';

export interface QrEmailContent {
  subject: string;
  react: ReactElement;
  text: string;
  contentId: string;
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
    subject: `Your entry pass for ${eventName}`,
    contentId,
    react: QrTicketEmail({ eventName, registrationAt: session.registration_at, venue: session.venue, guestName: name, barcode, contentId, isVIP: item.isVIP, isStaff: item.isStaff }),
    text: [
      `Your entry pass for ${eventName}`,
      '',
      `Hi ${name},`,
      '',
      'Your entry pass is ready. Present the attached QR code when you arrive at check-in.',
      '',
      `Registration: ${session.registration_at ? new Date(session.registration_at).toLocaleString() : 'Date and time to be announced'}`,
      `Venue: ${session.venue || 'To be announced'}`,
      '',
      `Ticket code: ${barcode}`,
      '',
      'Keep this email easy to access on your phone. Increase your screen brightness if the QR code is difficult to scan.',
      '',
      'This pass is unique to you. Please do not forward or share it with anyone else.',
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
    react: content.react,
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
