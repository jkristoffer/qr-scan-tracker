import postgres from 'postgres';

export async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  const sql = postgres(url, { ssl: 'require', max: 1 });
  try {
    await sql`
      create table if not exists scan_sessions (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        created_at timestamptz default now(),
        archived boolean default false,
        manage_password_hash text
      )
    `;
    await sql`
      alter table scan_sessions add column if not exists archived boolean default false
    `;
    await sql`
      alter table scan_sessions add column if not exists manage_password_hash text
    `;
    await sql`
      create table if not exists items (
        id uuid primary key default gen_random_uuid(),
        session_id uuid references scan_sessions(id) on delete cascade,
        barcode text not null,
        name text not null,
        email text,
        scanned boolean default false,
        scanned_at timestamptz,
        scanned_by text,
        removed boolean default false,
        qr_email_sent_at timestamptz,
        qr_email_resend_id text,
        qr_email_last_error text
      )
    `;
    await sql`alter table items add column if not exists email text`;
    await sql`alter table items add column if not exists qr_email_sent_at timestamptz`;
    await sql`alter table items add column if not exists qr_email_resend_id text`;
    await sql`alter table items add column if not exists qr_email_last_error text`;
    await sql`
      create table if not exists scan_attempts (
        id uuid primary key default gen_random_uuid(),
        item_id uuid references items(id) on delete cascade,
        session_id uuid references scan_sessions(id) on delete cascade,
        gate_name text,
        is_duplicate boolean default false,
        scanned_at timestamptz default now()
      )
    `;
    await sql`
      alter publication supabase_realtime add table items
    `.catch(() => {});
  } finally {
    await sql.end();
  }
}
