import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { sendQrEmail } from '@/lib/qrEmail';
import { Item } from '@/lib/types';

export const runtime = 'nodejs';

type SendStatus = {
  itemId: string;
  reason?: string;
};

type SendResponse = {
  sent: SendStatus[];
  skipped: SendStatus[];
  failed: SendStatus[];
  updatedItems: Item[];
};

function compactError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'QR email send failed';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json().catch(() => null);
    const rawItemIds: string[] = Array.isArray(body?.itemIds)
      ? body.itemIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    const itemIds = [...new Set(rawItemIds)];
    const force = body?.force === true;

    if (itemIds.length === 0) {
      return NextResponse.json({ error: 'itemIds is required' }, { status: 400 });
    }
    if (itemIds.length > 20) {
      return NextResponse.json({ error: 'Send at most 20 itemIds per request' }, { status: 400 });
    }

    const session = await db.getSession(sessionId);
    const items = await db.getItemsByIds(sessionId, itemIds) as Item[];
    const byId = new Map(items.map(item => [item.id, item]));
    const response: SendResponse = { sent: [], skipped: [], failed: [], updatedItems: [] };

    for (const itemId of itemIds) {
      const item = byId.get(itemId);
      if (!item) {
        response.skipped.push({ itemId, reason: 'not_found' });
        continue;
      }
      if (item.removed) {
        response.skipped.push({ itemId, reason: 'removed' });
        continue;
      }
      if (!item.email) {
        response.skipped.push({ itemId, reason: 'missing_email' });
        continue;
      }
      if (item.qr_email_sent_at && !force) {
        response.skipped.push({ itemId, reason: 'already_sent' });
        continue;
      }

      try {
        const resendId = await sendQrEmail(session, item);
        const updated = await db.updateQrEmailStatus(item.id, {
          sentAt: new Date().toISOString(),
          resendId,
          lastError: null,
        }) as Item;
        response.sent.push({ itemId });
        response.updatedItems.push(updated);
      } catch (error) {
        const message = compactError(error);
        response.failed.push({ itemId, reason: message });
        try {
          const updated = await db.updateQrEmailStatus(item.id, { lastError: message }) as Item;
          response.updatedItems.push(updated);
        } catch {
          /* Keep the send failure as the primary response. */
        }
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('QR email error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'QR email failed' },
      { status: 500 }
    );
  }
}
