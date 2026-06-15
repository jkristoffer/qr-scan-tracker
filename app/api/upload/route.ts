import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const sessionName = formData.get('sessionName') as string;
    const csvFile = formData.get('csvFile') as File;

    if (!sessionName || !csvFile) {
      return NextResponse.json(
        { error: 'Missing session name or CSV file' },
        { status: 400 }
      );
    }

    // Read and parse CSV
    const text = await csvFile.text();
    const lines = text.split('\n').filter((line) => line.trim());

    // Skip header row, expect format: barcode,name
    const items = lines.slice(1).map((line) => {
      const parts = line.split(',');
      const barcode = parts[0]?.trim();
      const name = parts[1]?.trim();

      if (!barcode || !name) {
        throw new Error(`Invalid CSV format at line: ${line}`);
      }

      return { barcode, name };
    });

    // Create session
    const session = await db.createSession(sessionName);

    // Create items in batches (Supabase has a limit)
    const BATCH_SIZE = 100;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      await db.createItems(batch, session.id);
    }

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      itemCount: items.length,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Upload failed',
      },
      { status: 500 }
    );
  }
}
