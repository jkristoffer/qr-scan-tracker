import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Get session
    const session = await db.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get all items
    const items = await db.getItems(sessionId);

    const csvField = (v: string) =>
      v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;

    const header = 'barcode,name,scanned,scanned_at,scanned_by\n';
    const rows = items
      .map((item) =>
        [
          csvField(item.barcode),
          csvField(item.name),
          item.scanned ? 'true' : 'false',
          csvField(item.scanned_at || ''),
          csvField(item.scanned_by || ''),
        ].join(',')
      )
      .join('\n');

    const csv = header + rows;

    // Set filename with session name and date
    const filename = `${session.name.replace(/[^a-z0-9]/gi, '_')}_export_${new Date().toISOString().split('T')[0]}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Export failed',
      },
      { status: 500 }
    );
  }
}
