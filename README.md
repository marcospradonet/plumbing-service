# Plumbing Service — scheduling & dispatch (v0.1)

Scheduling platform for a plumbing company based in **Miami, Florida** that serves **houses and small buildings**
for **residential customers and small businesses**. Customers book online in English, Spanish or Brazilian Portuguese; the office
dispatches jobs on a board; technicians run their day from a phone.

Built on the same architecture as `marcospradonet/clinica-fono`: Node.js + Express, embedded SQLite
(`node:sqlite`, no native modules), build-free SPA (ES modules) and `node:test`.
Full specification and backlog: [docs/SPECIFICATION.md](docs/SPECIFICATION.md).

## Run

Requires Node.js 22.13+.

On Windows, double-click `start.cmd` (or run `.\start.cmd`): it installs dependencies the first time and starts the server.

Manually:

```powershell
npm install
npm start          # http://localhost:3000  — online booking at http://localhost:3000/book
npm test           # automated tests of the main flows
```

The first run creates `data/plumbing.db` with demo data (technicians, services, Miami-Dade ZIP codes, customers and jobs).
Password for every demo user: `plumbing123`. Delete the `data/` folder to start over.

| User | Role |
|---|---|
| `dispatch@plumbing.local` | Dispatcher (office) |
| `carlos@plumbing.local` / `mike@plumbing.local` / `ana@plumbing.local` | Technician |
| `manager@plumbing.local` | Manager |
| `admin@plumbing.local` | Administrator |

## Features

| Area | What it does |
|---|---|
| **Online booking** (`/book`) | English / Español / Português (pt-BR); ZIP coverage check; service catalog with flat/hourly/estimate pricing; free arrival windows from qualified technicians; residential or business customer, property type, units, access notes; SMS consent; booking reference. |
| **Self-service** | Reference + phone → confirm, reschedule or cancel until the cutoff (default 24 h). Emergency line always visible. |
| **Dispatch board** | Day view with a column per technician, week view per technician, off-hours and time off shaded, now-line, travel buffer drawn after each job, drag & drop to move/reassign, click an empty slot to create a job. |
| **Rules** | No overlaps (with each technician's travel buffer), skills per service category, working hours (emergency jobs may go after hours with a fee), time off, min notice, booking window, closed days, least-loaded technician auto-assignment. |
| **Jobs** | Unassigned request queue, filters, detail with map link, access notes, internal/completion notes, billable items (parts, labor, fees, discounts) in USD, history and messages, printable work order. |
| **Technician** | "My day", one-tap *On my way* (texts the customer), *Start*, *Complete*, *No access*; items locked after completion (manager can reopen). |
| **Customers** | Residential or business (HOA, property managers, restaurants…), several service addresses, job history and billed total. |
| **Notifications** | SMS/e-mail in the customer's language (en/es/pt) on booking, reschedule, cancellation, reminder (default 24 h before), on the way and completion. Outbox with retries. |
| **Setup** | Technicians (license #, skills, color, buffer, weekly hours), services, service-area ZIPs, business settings, users with roles and optional TOTP 2FA, audit log. |

Times are stored as local wall-clock text in `America/New_York` (override with `BUSINESS_TZ`).

## SMS (Twilio)

Without credentials SMS is **simulated** (see *Notifications*). To send real texts set:

| Variable | Use |
|---|---|
| `TWILIO_ACCOUNT_SID` | Account SID |
| `TWILIO_AUTH_TOKEN` | Auth token |
| `TWILIO_FROM` | Sending number (E.164), registered for A2P 10DLC |

Texts go only to customers who opted in and end with the opt-out notice (TCPA).

## Structure

```
server/
  index.js         time zone, demo data, scheduler, HTTP server
  app.js           Express, security headers, CSRF header check, routes
  db.js            SQLite schema, default settings, seed data
  scheduling.js    availability, conflicts, skills, job lifecycle, time off, items
  notify.js        bilingual templates, outbox, Twilio, reminders
  auth.js          sessions, roles, audit, rate limit
  password.js      scrypt and TOTP
  routes/          public booking, users, catalog/settings, customers, jobs
public/
  index.html       staff app (SPA)      book.html   public booking page
  js/views/        one module per screen
test/              node:test end-to-end flows
docs/              specification and backlog
```

## Before production

HTTPS behind a reverse proxy, encrypted backups, real e-mail provider, Twilio A2P 10DLC registration, online deposits/payments,
invoicing (QuickBooks export), recurring maintenance contracts (e.g. annual backflow tests), route optimization and
Google Calendar sync for technicians.
