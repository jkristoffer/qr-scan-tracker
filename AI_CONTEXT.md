## CONTEXT_VERSION
1

## PROJECT
QR Scan Tracker is a lightweight Next.js event check-in app for creating scan sessions, importing guest/item lists, generating QR codes, scanning tickets from mobile browsers, and sharing check-in state in real time through Supabase.

## TECH_STACK_INTENT
- **Prefer:** Next.js App Router pages and route handlers, React 19 client components, TypeScript, Supabase client helpers, Postgres-backed Supabase tables, Zustand for scan UI state, `qrcode` for QR data URLs/PNG buffers, Resend for QR email delivery, and existing inline component styling.
- **Avoid:** Adding new UI frameworks, global state libraries, database clients, scanner libraries, or styling systems without explicit approval.
- **Why:** The repo is intentionally compact: most runtime behavior is expressed in a small set of pages/components plus shared helpers in `lib/` and `store/`.

### Exceptions
- `lib/migrate.ts` uses the `postgres` package directly for lightweight table creation/alteration when `DATABASE_URL` is present.
- `scripts/generate-qr.mjs` is a standalone Node script for printable QR HTML and should stay runnable outside the Next.js runtime.

## NON-GOALS
- Offline synchronization.
- Complex inventory management.
- Purchase orders.
- Asset depreciation.
- ERP integration.
- Broad auth, permissions, or organization-management work unless the product scope is clarified first.

## INVARIANTS
- Keep the public route shape stable unless the user asks for a route migration:
  - `/` is the dashboard/event list and creation flow.
  - `/scan/[sessionId]` is the mobile scanner experience.
  - `/manage/[sessionId]` is the session management, guest list, presence, remove/restore, and print-oriented view.
  - `/qr/[sessionId]` is a printable QR code grid for a session.
- Keep Supabase table access centralized through `lib/supabase.ts` unless a change has a clear reason to create a new boundary.
- Preserve real-time item updates through Supabase realtime subscriptions for the `items` table.
- Treat the per-event Manage PIN as a lightweight client-side gate, not a server-enforced authorization boundary; do not claim that it secures direct Supabase access.
- Preserve duplicate-scan protection: scanning updates only unscanned items and treats already-scanned or racing updates as duplicates.
- Do not read, log, or echo local secret values such as Supabase keys or `DATABASE_URL`.
- Leave generated/sample data files alone unless the task explicitly covers them.

## CONSTRAINTS
- **Runtime:** Next.js 16 / React 19 app intended for Vercel deployment, backed by Supabase/Postgres. Local development uses `npm install` and `npm run dev`.
- **Version locks:** `package-lock.json` is present; use npm and preserve the existing dependency set unless a dependency change is approved.
- **External APIs:** Supabase project URL, Supabase anon key, and Postgres `DATABASE_URL` are required for full runtime behavior. Resend email delivery requires `RESEND_API_KEY` and `QR_EMAIL_FROM`; `QR_EMAIL_REPLY_TO` is optional. Browser scanning requires camera access through `navigator.mediaDevices.getUserMedia`.

## ARCH_INTENT
- **Boundaries:**
  - `app/page.tsx` renders `components/Dashboard.tsx` for event/session creation, active/archive lists, gate-name storage, CSV/TXT import, repeatable manual guest entry, and required 4-digit Manage PIN setup. Creation accepts up to 500 combined guests, preserves uploaded barcodes, and assigns manual guests sequential `TKT-####` barcodes after the highest imported ticket code. Upload parsing still slices files to the first 500 non-empty lines.
  - `app/scan/[sessionId]/page.tsx` owns the scanner route orchestration: session/item load, realtime item subscription, presence join, progress/list panels, last-scan state updates, and scan result feedback.
  - `app/manage/[sessionId]/page.tsx` owns the session-scoped Manage PIN gate and management workflows: active/removed item views, add/remove/restore, QR card generation, scanner presence display, tally filters, print actions, QR email send/resend controls, PIN changes, and explicit locking. Guest and presence data load only after the client-side gate unlocks.
  - `app/qr/[sessionId]/page.tsx` owns the dedicated printable QR grid for active session items.
  - `app/api/export/[sessionId]/route.ts` exports active items for a session as CSV.
  - `app/api/qr-email/[sessionId]/route.ts` sends QR emails for up to 20 item IDs per request, skips removed/missing/already-sent items unless forced, and writes send status back to `items`.
  - `components/Scanner.tsx` owns browser camera capture and `jsQR` decoding, then delegates item lookup, scan mutation, and scan-attempt logging to `lib/supabase.ts`.
  - `lib/supabase.ts` owns Supabase client creation and data operations for scan sessions, items, QR email status, scan attempts, realtime item subscriptions, and presence helpers.
  - `emails/QrTicketEmail.tsx` owns the React Email entry-pass template; `lib/qrEmail.ts` assembles its subject/text content and sends inline CID QR PNG attachments through Resend.
  - `lib/migrate.ts` defines lightweight inline migrations for `scan_sessions`, `items`, QR email fields, `removed`, and `scan_attempts` when `DATABASE_URL` is configured.
  - `supabase/migrations/*` contains SQL migration history for `scan_sessions`, `items`, QR email fields, `removed`, and `scan_attempts`.
  - `store/useScanStore.ts` owns client-side item lists, filtered item lists, progress, search query, and last-scan state.
  - `lib/qr.ts` generates in-app QR data URLs; `scripts/generate-qr.mjs` generates standalone printable HTML from CSV input.
  - `lib/ticketCodes.ts` owns sequential `TKT-####` allocation shared by event creation and the Manage screen.
  - `lib/managePassword.ts` owns 4-digit PIN validation plus versioned PBKDF2 hashing and verification through Web Crypto; only encoded verifiers are persisted.
- **Patterns:**
  - Prefer extending existing `db` helper methods over scattering Supabase calls through pages.
  - Prefer updating the narrow route/component that owns a workflow instead of introducing cross-cutting abstractions.
  - Preserve the existing mobile-first, inline-style UI approach unless a task explicitly asks for design-system work.

## AI_RULES
- Minimal diffs.
- Ask before adding dependencies.
- Do not refactor unrelated code.
- Follow existing patterns.
- Prefer existing inline styles/components and Supabase helper patterns.
- Do not create or modify `AI_STATE.md` during context initialization.
- Do not stage unrelated files or generated artifacts.
- Do not read or echo local secrets.

## EXTENSIONS
<!-- Project-specific additions; informational unless referenced -->
- README deployment intent: create a Supabase project, deploy to Vercel with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `DATABASE_URL`, then let the app create tables automatically on first load.
- CSV import shape is `barcode,name,email`; legacy `barcode,name` and single-value rows are still accepted. CSV export shape is `barcode,name,email,scanned,scanned_at,scanned_by`.
- New events may combine uploaded and manual guests up to 500 total, or be created empty. A completely blank manual row is ignored; populated manual rows require a name and accept an optional valid email.
- New events require a 4-digit Manage PIN. Legacy sessions keep a null `manage_password_hash` until the first Manage visitor atomically claims them by setting a PIN. Successful access is remembered per event in `sessionStorage` until the tab closes or the user locks Manage.
- Gate/scanner identity is currently lightweight client state stored in `localStorage` as `gate_name`.
- Session archiving is represented by the `scan_sessions.archived` boolean.
- Item removal is soft-delete style through `items.removed`; removed items remain available to management views.
- QR email status is stored on `items.email`, `items.qr_email_sent_at`, `items.qr_email_resend_id`, and `items.qr_email_last_error`.

## UNANSWERED
<!-- Ambiguities that would benefit from human clarification -->
- What is the intended auth and access model for creating, scanning, managing, exporting, and archiving sessions?
- What RLS policy posture is intended for Supabase tables in production?
- Should production schema authority live in Supabase migrations, `lib/migrate.ts`, or both?
- Is the dashboard's current 500-row CSV/TXT import cap the intended product limit or just a temporary safeguard?
- Is `qrcodes.html` a generated artifact that should remain ignored/untracked, or a durable sample output if it appears in the repo?
- Should scan attempts be queryable in the UI, exported, or retained only as internal audit data?
