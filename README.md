# QR Scan Tracker

Real-time event check-in via QR code scanning. Upload a guest list, generate QR codes, and scan guests in at the door.

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/jkristoffer/qr-scan-tracker.git
cd qr-scan-tracker
npm install
```

### 2. Set up Supabase

Create a free project at [supabase.com](https://supabase.com), then run the following SQL in the Supabase SQL editor to create the required tables:

```sql
create table scan_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references scan_sessions(id) on delete cascade,
  barcode text not null,
  name text not null,
  scanned boolean default false,
  scanned_at timestamptz,
  scanned_by text,
  removed boolean default false
);

create table scan_attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references items(id) on delete cascade,
  session_id uuid references scan_sessions(id) on delete cascade,
  gate_name text,
  is_duplicate boolean default false,
  scanned_at timestamptz default now()
);
```

Enable realtime on the `items` table: **Database → Replication → Tables → items → enable**.

### 3. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in your Supabase project URL and anon key (found under **Project Settings → API**):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

- **New event** — tap `+ New event`, enter a name, and optionally upload a CSV guest list (`barcode,name` per line, or just names)
- **Scan** — opens the camera scanner; admitted / already-in / no-match results flood the screen
- **Manage** — add/remove guests, view QR codes, print a QR sheet
