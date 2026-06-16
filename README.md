# QR Scan Tracker

Real-time event check-in via QR code scanning. Upload a guest list, generate QR codes, and scan guests in at the door.

## Deploy in 3 steps

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) → New project. Once it's ready, collect these three values from **Project Settings**:

| Value | Where to find it |
|---|---|
| Project URL | Settings → API → Project URL |
| Anon key | Settings → API → Project API keys → `anon public` |
| Database URL | Settings → Database → Connection string → **URI** (use the **Session** mode pooler) |

### 2. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/jkristoffer/qr-scan-tracker&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,DATABASE_URL&envDescription=Find%20these%20in%20your%20Supabase%20project%20settings&envLink=https://supabase.com/dashboard/project/_/settings/api)

Paste the three values when Vercel asks for them.

### 3. Open the app

That's it. The app creates the database tables automatically on first load.

---

## Local development

```bash
git clone https://github.com/jkristoffer/qr-scan-tracker.git
cd qr-scan-tracker
npm install
cp .env.local.example .env.local   # fill in the three values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

- **New event** — tap `+ New event`, enter a name, and optionally upload a CSV guest list (`barcode,name` per line, or just names)
- **Scan** — opens the camera scanner; admitted / already-in / no-match results flood the screen
- **Manage** — add/remove guests, view and print QR codes
