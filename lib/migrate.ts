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
        created_at timestamptz default now()
      )
    `;
    await sql`
      create table if not exists items (
        id uuid primary key default gen_random_uuid(),
        session_id uuid references scan_sessions(id) on delete cascade,
        barcode text not null,
        name text not null,
        scanned boolean default false,
        scanned_at timestamptz,
        scanned_by text,
        removed boolean default false
      )
    `;
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
