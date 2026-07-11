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
        item_id uuid not null references items(id) on delete cascade,
        session_id uuid not null references scan_sessions(id) on delete cascade,
        gate_name text not null,
        is_duplicate boolean not null default false,
        event_type text not null default 'check_in',
        source text not null default 'camera',
        scanned_at timestamptz not null default now()
      )
    `;
    await sql`alter table scan_attempts add column if not exists event_type text`;
    await sql`alter table scan_attempts add column if not exists source text`;
    await sql`
      update scan_attempts
      set event_type = case when is_duplicate then 'duplicate' else 'check_in' end
      where event_type is null
    `;
    await sql`update scan_attempts set source = 'camera' where source is null`;
    await sql`
      do $$
      declare
        null_count bigint;
      begin
        select count(*) into null_count
        from scan_attempts
        where item_id is null
           or session_id is null
           or gate_name is null
           or scanned_at is null
           or is_duplicate is null;

        if null_count > 0 then
          raise exception
            'Cannot enforce scan_attempts required fields: % legacy row(s) contain null item_id, session_id, gate_name, scanned_at, or is_duplicate',
            null_count;
        end if;
      end $$
    `;
    await sql`
      alter table scan_attempts
        alter column item_id set not null,
        alter column session_id set not null,
        alter column gate_name set not null,
        alter column scanned_at set default now(),
        alter column scanned_at set not null,
        alter column is_duplicate set default false,
        alter column is_duplicate set not null,
        alter column event_type set default 'check_in',
        alter column event_type set not null,
        alter column source set default 'camera',
        alter column source set not null
    `;
    await sql`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where conrelid = 'scan_attempts'::regclass
            and conname = 'scan_attempts_event_type_check'
        ) then
          alter table scan_attempts
            add constraint scan_attempts_event_type_check
            check (event_type in ('check_in', 'duplicate', 'undo_check_in'));
        end if;

        if not exists (
          select 1 from pg_constraint
          where conrelid = 'scan_attempts'::regclass
            and conname = 'scan_attempts_source_check'
        ) then
          alter table scan_attempts
            add constraint scan_attempts_source_check
            check (source in ('camera', 'manual', 'manage'));
        end if;
      end $$
    `;
    await sql`
      create or replace function undo_item_check_in(
        p_session_id uuid,
        p_item_id uuid,
        p_expected_scanned_at timestamptz,
        p_actor_label text,
        p_source text
      ) returns jsonb
      language plpgsql
      as $$
      declare
        v_item items%rowtype;
      begin
        if p_source is null or p_source not in ('camera', 'manual', 'manage') then
          raise exception 'Invalid check-in source: %', p_source
            using errcode = '22023';
        end if;

        select * into v_item
        from items
        where id = p_item_id and session_id = p_session_id
        for update;

        if not found then
          return jsonb_build_object('status', 'not_found', 'item', null);
        end if;

        if not v_item.scanned or v_item.scanned_at is distinct from p_expected_scanned_at then
          return jsonb_build_object('status', 'stale', 'item', to_jsonb(v_item));
        end if;

        update items
        set scanned = false,
            scanned_at = null,
            scanned_by = null
        where id = p_item_id and session_id = p_session_id
        returning * into v_item;

        insert into scan_attempts (
          item_id, session_id, gate_name, is_duplicate, event_type, source
        ) values (
          p_item_id, p_session_id, coalesce(nullif(trim(p_actor_label), ''), 'Manage'),
          false, 'undo_check_in', p_source
        );

        return jsonb_build_object('status', 'undone', 'item', to_jsonb(v_item));
      end;
      $$
    `;
    await sql`
      alter publication supabase_realtime add table items
    `.catch(() => {});
  } finally {
    await sql.end();
  }
}
