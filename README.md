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
| Resend API key | Resend → API Keys |
| QR email sender | A verified Resend sender, for example `Tickets <tickets@example.com>` |

### 2. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/jkristoffer/qr-scan-tracker&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,DATABASE_URL,RESEND_API_KEY,QR_EMAIL_FROM,QR_EMAIL_REPLY_TO&envDescription=Find%20Supabase%20values%20in%20your%20Supabase%20project%20settings%20and%20email%20values%20in%20Resend&envLink=https://supabase.com/dashboard/project/_/settings/api)

Paste the Supabase and Resend values when Vercel asks for them. `QR_EMAIL_REPLY_TO` is optional.

### 3. Open the app

That's it. The app creates the database tables automatically on first load.

---

## Local development

```bash
git clone https://github.com/jkristoffer/qr-scan-tracker.git
cd qr-scan-tracker
npm install
cp .env.local.example .env.local   # fill in Supabase and Resend values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Live QR email test

The live QR email harness creates temporary Supabase rows, sends through Resend, verifies `qr_email_resend_id` was persisted, and deletes its test session when it finishes. It is not part of `npm test` because it sends real email.

```bash
npm run test:qr-email-live
QR_EMAIL_TEST_TO=you@example.com npm run test:qr-email-live
npm run test:qr-email-live -- --keep
```

By default, test email is sent to Resend's `delivered@resend.dev` sink. Set `QR_EMAIL_TEST_BASE_URL` to point at an already-running Next server; otherwise the script starts a temporary local server.
`QR_EMAIL_FROM` must contain a sender address on a domain verified in Resend; public mailbox domains such as `gmail.com` and placeholders such as `example.com` are rejected before test data is created. For a Resend-only sandbox run, use `QR Scan Tracker <onboarding@resend.dev>` with the default `delivered@resend.dev` recipient. To send to real guests, configure a domain you control in Resend and use an address at that verified domain.

---

## Usage

- **New event** — tap `+ New event`, enter a name and a 4-digit Manage PIN, then optionally upload a CSV/TXT guest list, add guests manually, or combine both (maximum 500 guests). Uploaded barcodes are preserved; manual guests receive sequential `TKT-####` barcodes. Events with no guests are also supported.
- **Guest list files** — CSV rows accept `barcode,name,email`, legacy `barcode,name`, or a single value; use **Clear upload** in the New event sheet to remove a selected file without discarding manual drafts
- **Scan** — opens the camera scanner; admitted / already-in / no-match results flood the screen
- **Manage** — enter the event’s PIN to add/remove guests, view and print QR codes, send QR codes by email with Resend, rename the event, or change the PIN. Open **Event settings** to rename, change the PIN, or lock the page. Access remains unlocked in the current browser tab until it closes or you choose **Lock Manage page**. The first visitor to Manage for an older event without a PIN will be asked to set one.

The Manage PIN is a lightweight client-side gate for casual access, not strong authorization. The app’s existing public Supabase data model remains unchanged, so do not treat the PIN as protection against a determined user with direct API access.
