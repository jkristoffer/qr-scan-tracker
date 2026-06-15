Product Requirements Document (PRD)

Project Name

QR Scan Tracker

Objective

Provide a lightweight web application that allows multiple users to scan QR codes or barcodes from mobile devices and maintain a shared real-time view of scan status.

The system should prevent duplicate scans, provide visibility into progress, and require minimal setup.

⸻

Problem Statement

Current workflows rely on spreadsheets, paper checklists, or manual tracking during:

* Inventory stock takes
* Warehouse receiving
* Equipment delivery verification
* Event attendance
* Installation checklists

These methods are slow, error-prone, and difficult to coordinate across multiple users.

⸻

Goals

Primary Goals

* Scan QR codes and barcodes using mobile devices
* Mark items as scanned
* Share scan status instantly across all devices
* Prevent duplicate scans
* Support multiple simultaneous users

Non-Goals (MVP)

* Offline synchronization
* Complex inventory management
* Purchase orders
* Asset depreciation
* ERP integration

⸻

User Roles

Scanner

Can:

* Open scanner page
* Scan QR/barcode
* View scan result
* View progress

Administrator

Can:

* Create scan sessions
* Upload barcode list
* Reset scan status
* View reports
* Export results

⸻

User Stories

Scan Item

As a scanner,

I want to scan a barcode,

so that the item is immediately marked as scanned.

⸻

Prevent Duplicates

As a scanner,

I want to know if an item has already been scanned,

so that duplicate processing is avoided.

⸻

Real-Time Visibility

As a team member,

I want to see updated scan progress,

so that everyone shares the same state.

⸻

Upload Items

As an administrator,

I want to upload a CSV file containing barcodes,

so that I can initialize a scanning session quickly.

⸻

Functional Requirements

FR-1 Barcode Import

Administrator can upload CSV:

barcode,name
ABC001,Projector A
ABC002,Projector B
ABC003,Projector C

System imports records.

⸻

FR-2 Scan Item

User scans barcode.

System:

1. Looks up barcode
2. Checks status
3. Marks scanned if not scanned
4. Records timestamp
5. Records user

⸻

FR-3 Duplicate Detection

If barcode already scanned:

Display:

Already Scanned
Scanned By: John
Scanned At: 2026-06-15 10:30

⸻

FR-4 Unknown Barcode

If barcode not found:

Display:

Barcode Not Found

⸻

FR-5 Real-Time Updates

When any user scans:

* Progress updates immediately
* Scan count updates immediately
* Other connected devices see changes

⸻

FR-6 Dashboard

Display:

Total Items: 500
Scanned: 342
Remaining: 158
Completion: 68.4%

⸻

FR-7 Search

Search by:

* Barcode
* Item Name

⸻

FR-8 Export

Export results:

barcode,name,scanned,scanned_at,scanned_by

⸻

User Interface

Mobile Scanner Screen

--------------------
Scan Barcode
--------------------
[ Camera Preview ]
Last Scan:
ABC001
✓ Scanned Successfully
Progress:
342 / 500

⸻

Dashboard

--------------------
Inventory Session
--------------------
Scanned: 342
Remaining: 158
[Search]
ABC001 ✓
ABC002 ✓
ABC003 Pending

⸻

Technical Architecture

Frontend

* Next.js
* TypeScript
* Tailwind
* html5-qrcode

Hosted on:

* Vercel

⸻

Backend

* Supabase

Services used:

* PostgreSQL
* Realtime
* Authentication

⸻

Database Schema

scan_sessions

Column	Type
id	uuid
name	text
created_at	timestamp

items

Column	Type
id	uuid
session_id	uuid
barcode	text
name	text
scanned	boolean
scanned_at	timestamp
scanned_by	text

⸻

Duplicate Scan Protection

Scan operation must be atomic.

Example:

UPDATE items
SET scanned = true
WHERE barcode = ?
AND scanned = false;

If affected rows = 0

Return:

Already Scanned

⸻

Success Metrics

MVP

* Scan latency < 1 second
* Support 10 concurrent users
* Support 10,000 barcodes per session
* Zero duplicate successful scans

Adoption

* 100% replacement of manual spreadsheet tracking
* Less than 5 minutes to create a new scan session

⸻

Future Enhancements

Phase 2

* Offline scanning
* Batch scan mode
* Scan history timeline
* User accounts and permissions
* Multiple active sessions

Phase 3

* Asset management integration
* QR label generation
* Photo attachments
* Audit logs
* Public API

This scope is small enough that a single developer could likely deliver the MVP in 1–2 days using Next.js, Vercel, and Supabase.