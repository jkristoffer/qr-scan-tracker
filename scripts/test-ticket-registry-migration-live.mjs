#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const REQUIRED_ENV = ['DATABASE_URL'];
const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260711000002_add_ticket_code_registry.sql'
);

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function schemaName(label) {
  return `ticket_registry_${label}_${randomUUID().replaceAll('-', '')}`;
}

function assertSchema(schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Unsafe generated schema: ${schema}`);
}

async function setSearchPath(sql, schema) {
  assertSchema(schema);
  await sql`select set_config('search_path', ${`"${schema}", public`}, false)`;
}

async function createSchema(sql, schema) {
  assertSchema(schema);
  await sql.unsafe(`create schema "${schema}"`);
}

async function dropSchema(sql, schema) {
  assertSchema(schema);
  await sql.unsafe(`drop schema if exists "${schema}" cascade`);
}

async function seedPreRegistryBase(databaseUrl, schema, duplicate = false) {
  const sql = postgres(databaseUrl, { ssl: 'require', max: 1 });
  const sessionId = randomUUID();
  try {
    await setSearchPath(sql, schema);
    await sql`
      create table scan_sessions (
        id uuid primary key,
        name text not null,
        created_at timestamptz default now()
      )
    `;
    await sql`
      create table items (
        id uuid primary key,
        session_id uuid not null references scan_sessions(id) on delete cascade,
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
    await sql`insert into scan_sessions (id, name) values (${sessionId}, 'Migration Harness')`;
    const codes = duplicate
      ? ['DUPLICATE', 'DUPLICATE']
      : ['TKT-9999', 'TKT-10000', 'TKT-2147483648'];
    for (let index = 0; index < codes.length; index += 1) {
      await sql`
        insert into items (id, session_id, barcode, name)
        values (${randomUUID()}, ${sessionId}, ${codes[index]}, ${`Guest ${index + 1}`})
      `;
    }
    return sessionId;
  } finally {
    await sql.end();
  }
}

async function runOrderedMigration(databaseUrl, schema, migrationSql) {
  const sql = postgres(databaseUrl, { ssl: 'require', max: 1 });
  try {
    await setSearchPath(sql, schema);
    await sql.unsafe(migrationSql);
  } finally {
    await sql.end();
  }
}

async function expectDuplicateDiagnostic(label, action) {
  let error = null;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  assert(error, `${label} unexpectedly accepted duplicate legacy ticket codes`);
  assert(
    error.message.includes('duplicate items(session_id, barcode)'),
    `${label} returned an unclear duplicate diagnostic: ${error.message}`
  );
}

function normalizeDefinition(definition, schema) {
  return definition
    .replaceAll(`"${schema}".`, '<schema>.')
    .replaceAll(`${schema}.`, '<schema>.')
    .replace(/\s+/g, ' ')
    .trim();
}

async function inspectContract(databaseUrl, schema) {
  const sql = postgres(databaseUrl, { ssl: 'require', max: 1 });
  try {
    await setSearchPath(sql, schema);
    const columns = await sql`
      select column_name, data_type, is_nullable,
             case when column_default is null then null else regexp_replace(column_default, '\\s+', ' ', 'g') end as column_default
      from information_schema.columns
      where table_schema = ${schema} and table_name = 'ticket_code_registry'
      order by ordinal_position
    `;
    const constraints = await sql`
      select constraints.constraint_name, constraints.constraint_type,
             keys.column_name, keys.ordinal_position
      from information_schema.table_constraints constraints
      left join information_schema.key_column_usage keys
        on keys.constraint_schema = constraints.constraint_schema
       and keys.constraint_name = constraints.constraint_name
       and keys.table_schema = constraints.table_schema
       and keys.table_name = constraints.table_name
      where constraints.table_schema = ${schema}
        and constraints.table_name = 'ticket_code_registry'
      order by constraints.constraint_name, keys.ordinal_position
    `;
    const indexes = await sql`
      select indexname, indexdef
      from pg_indexes
      where schemaname = ${schema}
        and indexname in (
          'idx_items_session_barcode_unique',
          'idx_ticket_code_registry_active_item',
          'ticket_code_registry_pkey'
        )
      order by indexname
    `;
    const triggers = await sql`
      select trigger_name, event_manipulation, action_timing
      from information_schema.triggers
      where trigger_schema = ${schema} and event_object_table = 'items'
      order by trigger_name, event_manipulation
    `;
    const functions = await sql`
      select procedures.proname as function_name,
             pg_get_function_identity_arguments(procedures.oid) as arguments,
             pg_get_function_result(procedures.oid) as result,
             pg_get_functiondef(procedures.oid) as definition
      from pg_proc procedures
      join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
      where namespaces.nspname = ${schema}
        and procedures.proname in (
          'reserve_item_ticket_code',
          'replace_item_ticket_code',
          'suggest_next_ticket_code'
        )
      order by procedures.proname
    `;

    return {
      columns: columns.map((row) => ({ ...row })),
      constraints: constraints.map((row) => ({ ...row })),
      indexes: indexes.map((row) => ({
        indexname: row.indexname,
        indexdef: normalizeDefinition(row.indexdef, schema),
      })),
      triggers: triggers.map((row) => ({ ...row })),
      functions: functions.map((row) => ({
        function_name: row.function_name,
        arguments: row.arguments,
        result: row.result,
        definition: normalizeDefinition(row.definition, schema).toLowerCase(),
      })),
    };
  } finally {
    await sql.end();
  }
}

function assertRequiredContract(contract, label) {
  assert(contract.columns.length === 5, `${label} registry does not expose all five required columns`);
  const primaryKey = contract.constraints
    .filter((row) => row.constraint_type === 'PRIMARY KEY')
    .map((row) => row.column_name);
  assert(
    JSON.stringify(primaryKey) === JSON.stringify(['session_id', 'code']),
    `${label} registry primary key is not (session_id, code)`
  );
  assert(contract.indexes.length === 3, `${label} is missing a required registry/items index`);
  const activeIndex = contract.indexes.find(
    (index) => index.indexname === 'idx_ticket_code_registry_active_item'
  );
  assert(
    activeIndex?.indexdef.includes('retired_at IS NULL'),
    `${label} active-item index is not partial on retired_at IS NULL`
  );
  assert(contract.triggers.length === 2, `${label} reservation trigger does not cover INSERT and UPDATE`);
  assert(contract.functions.length === 3, `${label} is missing a required ticket-code function`);
}

async function verifyBehavior(databaseUrl, schema, sessionId) {
  const sql = postgres(databaseUrl, { ssl: 'require', max: 1 });
  try {
    await setSearchPath(sql, schema);
    const [{ count: backfilled }] = await sql`
      select count(*)::integer as count
      from ticket_code_registry
      where session_id = ${sessionId} and retired_at is null
    `;
    assert(backfilled === 3, `Expected three backfilled reservations, received ${backfilled}`);

    const [{ suggestion }] = await sql`
      select suggest_next_ticket_code(${sessionId}::uuid) as suggestion
    `;
    assert(
      suggestion === 'TKT-2147483649',
      `Expected TKT-2147483649 beyond int32, received ${suggestion}`
    );

    const itemId = randomUUID();
    await sql`
      insert into items (id, session_id, barcode, name)
      values (${itemId}, ${sessionId}, '  Mixed-Case-Code  ', 'Trigger Guest')
    `;
    const [item] = await sql`select barcode from items where id = ${itemId}`;
    const [reservation] = await sql`
      select code, retired_at
      from ticket_code_registry
      where session_id = ${sessionId} and item_id = ${itemId}
    `;
    assert(item.barcode === 'Mixed-Case-Code', 'Insert trigger did not trim while preserving case');
    assert(
      reservation?.code === 'Mixed-Case-Code' && reservation.retired_at === null,
      'Insert trigger did not create an active reservation'
    );
  } finally {
    await sql.end();
  }
}

async function main() {
  loadEnvLocal();
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  const databaseUrl = process.env.DATABASE_URL;
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  const schemas = {
    ordered: schemaName('ordered'),
    orderedDuplicate: schemaName('ordered_duplicate'),
    runtime: schemaName('runtime'),
    runtimeDuplicate: schemaName('runtime_duplicate'),
  };
  const admin = postgres(databaseUrl, { ssl: 'require', max: 1 });

  try {
    for (const schema of Object.values(schemas)) await createSchema(admin, schema);

    const orderedSession = await seedPreRegistryBase(databaseUrl, schemas.ordered);
    await runOrderedMigration(databaseUrl, schemas.ordered, migrationSql);
    await runOrderedMigration(databaseUrl, schemas.ordered, migrationSql);
    const orderedContract = await inspectContract(databaseUrl, schemas.ordered);
    assertRequiredContract(orderedContract, 'Ordered migration');
    await verifyBehavior(databaseUrl, schemas.ordered, orderedSession);

    const { migrate } = await import('../lib/migrate.ts');
    const runtimeSession = await seedPreRegistryBase(databaseUrl, schemas.runtime);
    await migrate({ schema: schemas.runtime });
    await migrate({ schema: schemas.runtime });
    const runtimeContract = await inspectContract(databaseUrl, schemas.runtime);
    assertRequiredContract(runtimeContract, 'Runtime migrate');
    await verifyBehavior(databaseUrl, schemas.runtime, runtimeSession);

    assert(
      JSON.stringify(runtimeContract) === JSON.stringify(orderedContract),
      'Ordered migration and runtime migrate expose different ticket-registry catalog contracts'
    );

    await seedPreRegistryBase(databaseUrl, schemas.orderedDuplicate, true);
    await expectDuplicateDiagnostic('Ordered migration', () =>
      runOrderedMigration(databaseUrl, schemas.orderedDuplicate, migrationSql)
    );

    await seedPreRegistryBase(databaseUrl, schemas.runtimeDuplicate, true);
    await expectDuplicateDiagnostic('Runtime migrate', () => migrate({ schema: schemas.runtimeDuplicate }));

    console.log('PASS: ordered and runtime ticket-registry migrations are equivalent and idempotent.');
  } finally {
    for (const schema of Object.values(schemas).reverse()) {
      try {
        await dropSchema(admin, schema);
      } catch (error) {
        console.error(`Cleanup failed for disposable schema ${schema}: ${error.message}`);
      }
    }
    await admin.end();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
