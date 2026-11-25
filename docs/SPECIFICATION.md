# Plumbing Service Scheduling Platform — Specification v1

Scheduling and dispatch platform for a plumbing company headquartered in **Miami, Florida**, serving
**houses and small buildings** (condos, townhouses, small multifamily, small commercial) for both
**residential customers** and **small businesses**.

Architecture follows the reference project `marcospradonet/clinica-fono`: Node.js 22.13+ with Express,
embedded SQLite (`node:sqlite`, no native dependencies), a build-free single-page app (ES modules)
and automated tests with `node:test`.

---

## 1. Goals

| # | Goal |
|---|---|
| G1 | Let customers book a plumber online 24/7, in English, Spanish or Brazilian Portuguese, in under 2 minutes. |
| G2 | Give the office (dispatchers) one board to see, assign and move every job of the day. |
| G3 | Never double-book a technician, never send a technician without the right skill, never book outside the service area. |
| G4 | Keep customers informed by SMS/e-mail (booking, reschedule, cancellation, reminder, "on the way"). |
| G5 | Let technicians run their day from a phone: en route → in progress → completed, with notes and billable items. |

## 2. Market assumptions (Miami-Dade, FL)

- Time zone **America/New_York** (Eastern, with DST). All times are stored as local wall-clock text `YYYY-MM-DDTHH:MM`.
- US formats: `MM/DD/YYYY`, 12-hour clock, currency **USD** stored in cents, phones in E.164 `+1XXXXXXXXXX`.
- Multilingual market: customer preferred language **en / es / pt (pt-BR)** — Miami has large Hispanic and Brazilian communities; all customer messages exist in the three languages.
- Service area defined by **ZIP codes** (seeded with Miami-Dade ZIPs); bookings from other ZIPs are refused online.
- Florida plumbing contractors are licensed (e.g. `CFC1234567`); the technician record stores the license number.
- SMS consent (TCPA): reminders and status texts are only sent when the customer opted in; every SMS ends with "Reply STOP to opt out".
- Hurricane season / holidays: managers can register closed days; online booking skips them.

## 3. Roles and access

| Role | Can do |
|---|---|
| **Admin** | Everything, including users and audit log. |
| **Manager** | Technicians and working hours, services catalog, service area, settings, plus everything a dispatcher does. |
| **Dispatcher** (office) | Schedule board, jobs, customers and properties, time off, notifications outbox. |
| **Technician** | Own schedule and own jobs only; status updates, notes, billable items; own time off. Cannot cancel jobs. |

Login with e-mail + password (scrypt), optional TOTP second factor, HttpOnly session cookie (12 h),
login throttling, CSRF header on every state-changing API call, audit log of sensitive actions.

## 4. Domain model

```
customers 1─* properties 1─* jobs *─1 services
                              │ *─1 technicians 1─* technician_hours
                              │                 1─* time_off
                              1─* job_items
                              1─* notifications
service_areas (zip)   settings (key/value)   users ─ sessions   audit_log
```

- **Customer**: type `residential` | `commercial`, contact name, company (commercial), phone, alt phone, e-mail,
  preferred language, SMS opt-in, notes.
- **Property** (service location): address, unit, city, state, ZIP, type (`single_family`, `condo`, `townhouse`,
  `small_multifamily`, `small_commercial`), number of units, access notes (gate code, parking, shut-off valve location).
- **Service**: name, category (`drain`, `leak`, `water_heater`, `fixture`, `sewer`, `repipe`, `inspection`, `general`),
  duration, pricing (`flat` | `hourly` | `estimate`), base price, available online (yes/no).
- **Technician**: name, phone, license number, skills (categories), color, travel buffer (minutes between jobs), weekly hours.
- **Job**: public reference (`PL-XXXXXX`), customer, property, service, technician (may be empty for an unassigned request),
  start/end, priority (`standard` | `urgent` | `emergency`), status, source (`office` | `online`), problem description,
  internal notes, completion notes, items, timestamps.

### Job status lifecycle

```
requested ─▶ scheduled ─▶ confirmed ─▶ en_route ─▶ in_progress ─▶ completed
     │            │            │           │              └──▶ (undo → en_route)
     └────────────┴────────────┴───────────┴──▶ cancelled
                  └────────────┴───────────┴──▶ no_access (customer not home)
```

- `requested`: online request with no technician available to auto-assign, or office draft. Needs dispatch.
- Moving a job (time or technician) returns it to `scheduled` and resets the reminder.

## 5. Scheduling rules

1. A job occupies the technician from `start` to `end + travel_buffer`. No two active jobs of the same technician may overlap that range.
2. A job cannot overlap the technician's **time off**.
3. The technician must have the **skill** (service category) of the job.
4. Office bookings must fall inside the technician's working hours, **except emergency jobs** (after-hours allowed).
5. Online bookings: inside working hours, at least `min_lead_hours` from now, at most `booking_window_days` ahead,
   never on closed days, ZIP must be in the service area, service must be bookable online, priority is never emergency
   (customers are told to call the emergency line).
6. Slot generation: candidate start times every `slot_step_min` minutes inside each technician's hours; a start is offered
   if **any** qualified technician is free. On booking the system re-checks and assigns the **least-loaded** qualified technician that day.
7. Customers see an **arrival window** (`start` to `start + arrival_window_min`).
8. Customer self-service cancel/reschedule only until `cancel_cutoff_hours` before start; later they must call.
9. Emergency fee (setting) is added to the job estimate when priority is `emergency`.

## 6. Notifications

Outbox table with retry (up to 5 attempts, exponential backoff). Channels: **SMS** (Twilio if `TWILIO_*` env vars are set,
otherwise simulated) and **e-mail** (simulated/logged). Events: booked, rescheduled, cancelled, reminder (configurable hours
before), technician on the way, job completed. Messages in the customer's language (en, es or pt-BR). No message is sent without SMS opt-in
(SMS) or e-mail address (e-mail).

## 7. User stories (backlog)

### EP01 — Online booking (public page `/book`)
| ID | Story | Acceptance |
|---|---|---|
| US01 | As a customer I choose English, Spanish or Portuguese (pt-BR). | Toggle switches all labels; choice saved on the customer record. |
| US02 | As a customer I enter my ZIP and learn if it is served. | Unserved ZIP shows the office phone; served ZIP continues. |
| US03 | As a customer I pick a service and see its price type and starting price. | Only active, online services listed. |
| US04 | As a customer I pick a day and an arrival window. | Only free windows from qualified technicians; respects lead time, window and closed days. |
| US05 | As a customer I give contact, address, property type and describe the problem. | Residential or business (company name required); phone validated (US); SMS consent checkbox. |
| US06 | As a customer I receive a booking reference and confirmation. | Job created as `scheduled` with a technician; SMS/e-mail queued. |
| US07 | As a customer I look up my booking with reference + phone and confirm, reschedule or cancel. | Cutoff enforced; office notified through the job history. |
| US08 | As a customer with an emergency I see the 24/7 phone number. | Emergency is never bookable online. |

### EP02 — Dispatch and schedule (office)
| ID | Story | Acceptance |
|---|---|---|
| US10 | Dispatch board: one column per technician for a day, colored by status. | Time grid, now-line, time off hatched, out-of-hours shaded. |
| US11 | Week view for one technician. | Navigation by week; click a job opens the detail. |
| US12 | Create a job from the board (click an empty time) or from the jobs list. | Customer search, property, service, technician, priority; conflicts refused with a clear message. |
| US13 | Drag a job to another time or technician. | Re-validated; customer notified of reschedule. |
| US14 | Queue of unassigned requests. | Assign technician + time in one step. |
| US15 | Cancel a job with a reason. | Customer notified. |
| US16 | Register time off for a technician and see affected jobs. | Affected jobs listed to reschedule. |

### EP03 — Customers and properties
| ID | Story | Acceptance |
|---|---|---|
| US20 | Search customers by name, company, phone, e-mail or address. | Results while typing. |
| US21 | Residential or commercial customer with several properties. | Small buildings store number of units and access notes. |
| US22 | Customer job history with totals. | Past and upcoming jobs. |

### EP04 — Technician workflow
| ID | Story | Acceptance |
|---|---|---|
| US30 | Technician sees today's jobs with address, access notes and phone. | Mobile-friendly list. |
| US31 | One-tap "On my way", "Start", "Complete", "No access". | "On my way" texts the customer. |
| US32 | Add billable items (parts/labor) and completion notes. | Total computed in USD; locked after completion except for manager. |

### EP05 — Administration
| ID | Story | Acceptance |
|---|---|---|
| US40 | Technicians: skills, license, color, travel buffer, weekly hours. | Hours validated (HH:MM, start before end). |
| US41 | Services catalog and service area ZIPs. | Toggle online availability. |
| US42 | Settings: business name/phones, lead time, window, cutoff, slot step, arrival window, reminder hours, emergency fee, closed days. | Used immediately by booking. |
| US43 | Users with roles and optional 2FA. | Admin cannot remove own admin access. |
| US44 | Audit log. | Login, job changes, settings, users. |
| US45 | Notifications outbox with status and retry. | Failed messages visible. |

### Dashboard
| ID | Story | Acceptance |
|---|---|---|
| US50 | Today at a glance. | Jobs today, unassigned requests, in progress, completed, week revenue, next jobs. |

## 8. Non-functional requirements

- Runs with `npm install && npm start` on Windows, macOS or Linux; no native modules.
- Responsive UI (technicians on phones); keyboard accessible dialogs; ARIA live toasts.
- Security headers, HttpOnly/SameSite cookies, scrypt passwords, parameterized SQL, HTML escaping on every render.
- Public endpoints throttled per IP.
- Production pending: HTTPS via reverse proxy, backups, real e-mail provider, Twilio A2P 10DLC registration,
  online payments/deposits, invoicing/QuickBooks export, recurring maintenance contracts, route optimization.
