import postgres from 'postgres';

export interface MigrateOptions {
  schema?: string;
}

export async function migrate(options: MigrateOptions = {}) {
  const schema = options.schema;
  if (schema && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid migration schema identifier: ${schema}`);
  }

  const url = process.env.DATABASE_URL;
  if (!url) return;

  const sql = postgres(url, { ssl: 'require', max: 1 });
  try {
    if (schema) {
      await sql`select set_config('search_path', ${`"${schema}", public`}, false)`;
    }
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
      create table if not exists ticket_code_registry (
        session_id uuid not null references scan_sessions(id) on delete cascade,
        code text not null,
        item_id uuid not null,
        created_at timestamptz not null default now(),
        retired_at timestamptz,
        primary key (session_id, code)
      )
    `;
    await sql`
      do $$
      declare
        duplicate_summary text;
      begin
        select string_agg(format('%s/%s (%s rows)', session_id, barcode, duplicate_count), ', ')
        into duplicate_summary
        from (
          select session_id, barcode, count(*) as duplicate_count
          from items
          group by session_id, barcode
          having count(*) > 1
          order by session_id, barcode
          limit 10
        ) duplicates;

        if duplicate_summary is not null then
          raise exception 'Cannot install ticket code registry: duplicate items(session_id, barcode): %', duplicate_summary;
        end if;
      end $$
    `;
    await sql`
      insert into ticket_code_registry (session_id, code, item_id)
      select session_id, barcode, id
      from items
      on conflict (session_id, code) do nothing
    `;
    await sql`
      do $$
      declare
        missing_count bigint;
      begin
        select count(*) into missing_count
        from items item
        left join ticket_code_registry registry
          on registry.session_id = item.session_id
         and registry.code = item.barcode
         and registry.item_id = item.id
         and registry.retired_at is null
        where registry.session_id is null;

        if missing_count > 0 then
          raise exception 'Cannot install ticket code registry: % item(s) lack a matching active registry reservation', missing_count;
        end if;
      end $$
    `;
    await sql`
      create unique index if not exists idx_items_session_barcode_unique
      on items(session_id, barcode)
    `;
    await sql`
      create unique index if not exists idx_ticket_code_registry_active_item
      on ticket_code_registry(session_id, item_id)
      where retired_at is null
    `;
    await sql`
      create or replace function reserve_item_ticket_code()
      returns trigger
      language plpgsql
      as $$
      declare
        normalized_code text;
      begin
        normalized_code := btrim(new.barcode);
        if normalized_code is null or normalized_code = '' then
          raise exception 'Ticket code cannot be empty' using errcode = '22023';
        end if;
        new.barcode := normalized_code;

        if tg_op = 'INSERT' then
          insert into ticket_code_registry (session_id, code, item_id)
          values (new.session_id, new.barcode, new.id);
        elsif new.barcode is distinct from old.barcode then
          update ticket_code_registry
          set retired_at = now()
          where session_id = old.session_id
            and code = old.barcode
            and item_id = old.id
            and retired_at is null;

          if not found then
            raise exception 'Active ticket code reservation is missing for item %', old.id
              using errcode = '23514';
          end if;

          insert into ticket_code_registry (session_id, code, item_id)
          values (new.session_id, new.barcode, new.id);

          new.qr_email_sent_at := null;
          new.qr_email_resend_id := null;
          new.qr_email_last_error := null;
        end if;

        return new;
      end;
      $$
    `;
    await sql`drop trigger if exists reserve_item_ticket_code_trigger on items`;
    await sql`
      create trigger reserve_item_ticket_code_trigger
      before insert or update of barcode on items
      for each row execute function reserve_item_ticket_code()
    `;
    await sql`
      create or replace function replace_item_ticket_code(
        p_session_id uuid,
        p_item_id uuid,
        p_expected_code text,
        p_new_code text
      ) returns jsonb
      language plpgsql
      as $$
      declare
        current_item items%rowtype;
        updated_item items%rowtype;
        normalized_code text;
      begin
        normalized_code := btrim(p_new_code);
        if normalized_code is null or normalized_code = '' then
          raise exception 'Ticket code cannot be empty' using errcode = '22023';
        end if;

        select * into current_item
        from items
        where id = p_item_id and session_id = p_session_id
        for update;

        if not found then
          return jsonb_build_object('status', 'not_found', 'item', null);
        end if;

        if current_item.barcode is distinct from p_expected_code then
          return jsonb_build_object('status', 'stale', 'item', to_jsonb(current_item));
        end if;

        begin
          update items
          set barcode = normalized_code
          where id = p_item_id and session_id = p_session_id
          returning * into updated_item;
        exception when unique_violation then
          return jsonb_build_object('status', 'code_unavailable', 'item', to_jsonb(current_item));
        end;

        return jsonb_build_object('status', 'replaced', 'item', to_jsonb(updated_item));
      end;
      $$
    `;
    await sql`
      create or replace function suggest_next_ticket_code(p_session_id uuid)
      returns text
      language sql
      stable
      as $$
        select 'TKT-' || lpad(next_value, greatest(4, length(next_value)), '0')
        from (
          select (coalesce(max(substring(code from 5)::numeric), 0) + 1)::text as next_value
          from ticket_code_registry
          where session_id = p_session_id
            and code ~ '^TKT-[0-9]{4,}$'
        ) next_code
      $$
    `;
    if (!schema) {
      await sql`
        alter publication supabase_realtime add table items
      `.catch(() => {});
    }
  } finally {
    await sql.end();
  }
}
