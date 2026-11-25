// Scheduling rules: availability, conflicts, skills, job lifecycle and time off.
// Used by the office API, the technician API and the public online booking.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readSettings, tx } from './db.js';
import {
  addMinutes, clock, fail, fmtDate, hhmm, minutesBetween, minutesOfDay, nowStr, parseDateTime,
} from './util.js';

/** Domain events: 'job:changed' ({db, job, kind, previous, notify}). kind: booked | rescheduled | cancelled | en_route | completed */
export const events = new EventEmitter();

/** Statuses that occupy a technician's time. */
const BUSY_SQL = `status NOT IN ('cancelled','requested')`;
export const OPEN_STATUSES = ['requested', 'scheduled', 'confirmed'];

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

export const JOB_SELECT = `
  SELECT j.*, c.name customer_name, c.company customer_company, c.type customer_type, c.phone customer_phone,
    c.email customer_email, c.language customer_language, c.sms_opt_in,
    p.address1, p.unit, p.city, p.state, p.zip, p.property_type, p.units_count, p.access_notes,
    s.name service_name, s.name_es service_name_es, s.category service_category, s.price_type, s.base_price_cents,
    t.name technician_name, t.color technician_color, t.phone technician_phone
  FROM jobs j
  JOIN customers c ON c.id = j.customer_id
  JOIN properties p ON p.id = j.property_id
  JOIN services s ON s.id = j.service_id
  LEFT JOIN technicians t ON t.id = j.technician_id`;

export function getJob(db, id) {
  return db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id);
}
export function getJobByRef(db, ref) {
  return db.prepare(`${JOB_SELECT} WHERE j.ref = ?`).get(String(ref || '').trim().toUpperCase());
}

export function logEvent(db, jobId, kind, detail, actor = 'system') {
  db.prepare('INSERT INTO job_events (job_id, kind, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(jobId, kind, detail ? String(detail).slice(0, 500) : null, actor, nowStr());
}

const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRef(db) {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    const ref = 'PL-' + [...bytes].map((b) => REF_CHARS[b % REF_CHARS.length]).join('');
    if (!db.prepare('SELECT 1 FROM jobs WHERE ref = ?').get(ref)) return ref;
  }
}

const skillsOf = (tech) => String(tech.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
export const hasSkill = (tech, category) => category === 'general' ? true : skillsOf(tech).includes(category);

function closedDays(settings) {
  return new Set(String(settings.closed_days || '').split(',').map((s) => s.trim()).filter(Boolean));
}

/** True when [startsAt, endsAt] falls inside one of the technician's working blocks that day. */
export function withinHours(db, technicianId, startsAt, endsAt) {
  if (startsAt.slice(0, 10) !== endsAt.slice(0, 10)) return false;
  const weekday = parseDateTime(startsAt).getDay();
  const s = minutesOfDay(startsAt.slice(11, 16));
  const e = minutesOfDay(endsAt.slice(11, 16));
  return db.prepare('SELECT start_time, end_time FROM technician_hours WHERE technician_id = ? AND weekday = ?')
    .all(technicianId, weekday)
    .some((h) => minutesOfDay(h.start_time) <= s && e <= minutesOfDay(h.end_time));
}

/** Returns a conflict message or null. Checks other jobs (with travel buffer) and time off. */
export function findConflict(db, { technician_id, starts_at, ends_at, ignoreId = 0 }) {
  if (!(starts_at < ends_at)) return 'Invalid time: the end must be after the start.';
  const tech = db.prepare('SELECT * FROM technicians WHERE id = ?').get(technician_id);
  if (!tech) return 'Technician not found.';
  const buf = tech.travel_buffer_min || 0;
  const busy = db.prepare(`SELECT j.id, j.ref, j.starts_at, j.ends_at, c.name FROM jobs j JOIN customers c ON c.id = j.customer_id
    WHERE j.technician_id = ? AND j.id <> ? AND j.${BUSY_SQL} AND j.starts_at < ? AND j.ends_at > ?`)
    .all(technician_id, ignoreId, addMinutes(ends_at, buf), addMinutes(starts_at, -buf));
  const hit = busy.find((b) => overlaps(starts_at, addMinutes(ends_at, buf), b.starts_at, addMinutes(b.ends_at, buf)));
  if (hit) return `Conflict: ${tech.name} already has job ${hit.ref} (${hit.name}) at that time, including ${buf} min travel time.`;
  const off = db.prepare('SELECT reason FROM time_off WHERE technician_id = ? AND starts_at < ? AND ends_at > ? LIMIT 1')
    .get(technician_id, ends_at, starts_at);
  if (off) return `Conflict: ${tech.name} is off at that time (${off.reason || 'time off'}).`;
  return null;
}

/**
 * Bookable start times for a service across qualified technicians.
 * Returns [{starts_at, ends_at, technician_ids: [...]}] sorted by time.
 * Options: days (window length), from (YYYY-MM-DD), technicianId (restrict), ignoreJobId (when rescheduling),
 * enforceLead (customer-facing rules: lead time and closed days).
 */
export function availableSlots(db, serviceId, { days, from, technicianId, ignoreJobId = 0, enforceLead = true, limit = 500 } = {}) {
  const settings = readSettings(db);
  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(serviceId);
  if (!service) return [];
  let techs = db.prepare('SELECT * FROM technicians WHERE active = 1').all().filter((t) => hasSkill(t, service.category));
  if (technicianId) techs = techs.filter((t) => t.id === Number(technicianId));
  if (!techs.length) return [];

  const nDays = days ?? Number(settings.booking_window_days || 21);
  const step = Math.max(15, Number(settings.slot_step_min || 60));
  const minStart = enforceLead ? addMinutes(nowStr(), Number(settings.min_lead_hours || 0) * 60) : nowStr();
  const closed = enforceLead ? closedDays(settings) : new Set();
  const firstDay = from ? parseDateTime(from) : clock.now();
  const rangeFrom = fmtDate(firstDay) + 'T00:00';
  const rangeTo = addMinutes(rangeFrom, nDays * 1440);

  const hours = db.prepare('SELECT * FROM technician_hours ORDER BY weekday, start_time').all();
  const busyJobs = db.prepare(`SELECT technician_id, starts_at, ends_at FROM jobs
    WHERE technician_id IS NOT NULL AND id <> ? AND ${BUSY_SQL} AND starts_at < ? AND ends_at > ?`)
    .all(ignoreJobId, addMinutes(rangeTo, 240), addMinutes(rangeFrom, -240));
  const offs = db.prepare('SELECT technician_id, starts_at, ends_at FROM time_off WHERE starts_at < ? AND ends_at > ?').all(rangeTo, rangeFrom);

  const byStart = new Map();
  for (let i = 0; i < nDays; i++) {
    const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + i);
    const date = fmtDate(day);
    if (closed.has(date)) continue;
    for (const tech of techs) {
      const buf = tech.travel_buffer_min || 0;
      const mine = busyJobs.filter((b) => b.technician_id === tech.id);
      const myOff = offs.filter((o) => o.technician_id === tech.id);
      for (const h of hours.filter((x) => x.technician_id === tech.id && x.weekday === day.getDay())) {
        const end = minutesOfDay(h.end_time);
        for (let t = minutesOfDay(h.start_time); t + service.duration_min <= end; t += step) {
          const s = `${date}T${hhmm(t)}`;
          const e = `${date}T${hhmm(t + service.duration_min)}`;
          if (s < minStart) continue;
          if (mine.some((b) => overlaps(s, addMinutes(e, buf), b.starts_at, addMinutes(b.ends_at, buf)))) continue;
          if (myOff.some((o) => overlaps(s, e, o.starts_at, o.ends_at))) continue;
          const slot = byStart.get(s) || { starts_at: s, ends_at: e, technician_ids: [] };
          slot.technician_ids.push(tech.id);
          byStart.set(s, slot);
        }
      }
    }
  }
  return [...byStart.values()].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)).slice(0, limit);
}

/** Among candidate technicians, the one with fewest busy minutes that day (ties: lowest id). */
export function leastLoaded(db, technicianIds, date) {
  const load = (id) => db.prepare(`SELECT COALESCE(SUM((julianday(ends_at) - julianday(starts_at)) * 1440), 0) m FROM jobs
    WHERE technician_id = ? AND ${BUSY_SQL} AND substr(starts_at, 1, 10) = ?`).get(id, date).m;
  return [...technicianIds].sort((a, b) => load(a) - load(b) || a - b)[0];
}

function validatePlacement(db, { technician_id, starts_at, ends_at, priority, service, ignoreId = 0, enforceHours = true }) {
  const tech = db.prepare('SELECT * FROM technicians WHERE id = ?').get(technician_id);
  if (!tech) fail(400, 'Technician not found.');
  if (!tech.active) fail(400, `${tech.name} is inactive.`);
  if (!hasSkill(tech, service.category)) fail(409, `${tech.name} is not qualified for "${service.name}".`);
  if (enforceHours && priority !== 'emergency' && !withinHours(db, tech.id, starts_at, ends_at)) {
    fail(409, `Outside ${tech.name}'s working hours. Mark the job as emergency to book after hours.`);
  }
  const conflict = findConflict(db, { technician_id, starts_at, ends_at, ignoreId });
  if (conflict) fail(409, conflict);
}

const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function createJob(db, data, { source = 'office', actor = 'system', notify = true, enforceHours = true } = {}) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(data.customer_id);
  if (!customer) fail(400, 'Customer not found.');
  const property = db.prepare('SELECT * FROM properties WHERE id = ? AND customer_id = ?').get(data.property_id, customer.id);
  if (!property) fail(400, 'Select a service address of this customer.');
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(data.service_id);
  if (!service) fail(400, 'Service not found.');
  const starts_at = String(data.starts_at || '').slice(0, 16);
  if (!DT.test(starts_at)) fail(400, 'Enter a valid date and time.');
  const ends_at = data.ends_at ? String(data.ends_at).slice(0, 16) : addMinutes(starts_at, service.duration_min);
  if (!DT.test(ends_at) || !(starts_at < ends_at)) fail(400, 'The end must be after the start.');
  const priority = ['standard', 'urgent', 'emergency'].includes(data.priority) ? data.priority : 'standard';
  const technician_id = data.technician_id ? Number(data.technician_id) : null;
  const settings = readSettings(db);

  const id = tx(db, () => {
    if (technician_id) validatePlacement(db, { technician_id, starts_at, ends_at, priority, service, enforceHours });
    const jobId = Number(db.prepare(`INSERT INTO jobs (ref, customer_id, property_id, service_id, technician_id, starts_at, ends_at,
        status, priority, source, problem, internal_notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(newRef(db), customer.id, property.id, service.id, technician_id, starts_at, ends_at,
        technician_id ? 'scheduled' : 'requested', priority, source, data.problem?.trim() || null,
        data.internal_notes?.trim() || null, nowStr()).lastInsertRowid);
    if (service.price_type === 'flat' && service.base_price_cents > 0) {
      addItem(db, jobId, { kind: 'labor', description: service.name, quantity: 1, unit_cents: service.base_price_cents });
    }
    if (priority === 'emergency' && Number(settings.emergency_fee_cents) > 0) {
      addItem(db, jobId, { kind: 'fee', description: 'Emergency / after-hours fee', quantity: 1, unit_cents: Number(settings.emergency_fee_cents) });
    }
    logEvent(db, jobId, 'created', `${source} · ${technician_id ? 'scheduled' : 'unassigned request'}`, actor);
    return jobId;
  });
  const job = getJob(db, id);
  events.emit('job:changed', { db, job, kind: 'booked', notify });
  return job;
}

/** Reschedule and/or reassign a job (also used to dispatch an unassigned request). */
export function moveJob(db, id, data, { actor = 'system', notify = true, enforceHours = true } = {}) {
  const current = getJob(db, id);
  if (!current) fail(404, 'Job not found.');
  if (!OPEN_STATUSES.includes(current.status)) fail(400, 'Only requested, scheduled or confirmed jobs can be moved.');
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(data.service_id ?? current.service_id);
  if (!service) fail(400, 'Service not found.');
  const technician_id = data.technician_id !== undefined ? (data.technician_id ? Number(data.technician_id) : null) : current.technician_id;
  const starts_at = String(data.starts_at ?? current.starts_at).slice(0, 16);
  if (!DT.test(starts_at)) fail(400, 'Enter a valid date and time.');
  const duration = data.service_id && data.service_id !== current.service_id
    ? service.duration_min : minutesBetween(current.starts_at, current.ends_at);
  const ends_at = data.ends_at ? String(data.ends_at).slice(0, 16) : addMinutes(starts_at, duration);
  const priority = ['standard', 'urgent', 'emergency'].includes(data.priority) ? data.priority : current.priority;

  tx(db, () => {
    if (technician_id) validatePlacement(db, { technician_id, starts_at, ends_at, priority, service, ignoreId: id, enforceHours });
    const status = technician_id ? (current.status === 'requested' ? 'scheduled' : (current.starts_at !== starts_at ? 'scheduled' : current.status)) : 'requested';
    db.prepare(`UPDATE jobs SET technician_id = ?, service_id = ?, starts_at = ?, ends_at = ?, priority = ?, status = ?,
        reminder_sent = CASE WHEN ? <> starts_at THEN 0 ELSE reminder_sent END,
        problem = COALESCE(?, problem), internal_notes = COALESCE(?, internal_notes) WHERE id = ?`)
      .run(technician_id, service.id, starts_at, ends_at, priority, status, starts_at,
        data.problem ?? null, data.internal_notes ?? null, id);
    const changes = [];
    if (current.starts_at !== starts_at) changes.push(`time ${current.starts_at} → ${starts_at}`);
    if (current.technician_id !== technician_id) changes.push(`technician ${current.technician_name || 'none'} → ${technician_id ? db.prepare('SELECT name FROM technicians WHERE id = ?').get(technician_id).name : 'none'}`);
    if (changes.length) logEvent(db, id, 'moved', changes.join('; '), actor);
  });
  const job = getJob(db, id);
  if (current.status === 'requested' && job.status === 'scheduled') {
    events.emit('job:changed', { db, job, kind: 'booked', previous: current, notify });
  } else if (job.starts_at !== current.starts_at) {
    events.emit('job:changed', { db, job, kind: 'rescheduled', previous: current, notify });
  }
  return job;
}

const TRANSITIONS = {
  requested: ['cancelled'],
  scheduled: ['confirmed', 'en_route', 'in_progress', 'no_access', 'cancelled'],
  confirmed: ['scheduled', 'en_route', 'in_progress', 'no_access', 'cancelled'],
  en_route: ['confirmed', 'in_progress', 'no_access', 'cancelled'],
  in_progress: ['en_route', 'completed'],
  completed: ['in_progress'],
  no_access: ['confirmed'],
  cancelled: [],
};
const STAMP = { confirmed: 'confirmed_at', en_route: 'en_route_at', in_progress: 'started_at', completed: 'completed_at', cancelled: 'cancelled_at' };
export const STATUS_LABELS = {
  requested: 'Requested', scheduled: 'Scheduled', confirmed: 'Confirmed', en_route: 'On the way', in_progress: 'In progress',
  completed: 'Completed', cancelled: 'Cancelled', no_access: 'No access',
};

export function setStatus(db, id, status, { actor = 'system', notify = true, reason, completion_notes } = {}) {
  const current = getJob(db, id);
  if (!current) fail(404, 'Job not found.');
  if (current.status === status) return current;
  if (!TRANSITIONS[current.status]?.includes(status)) {
    fail(400, `A job that is "${STATUS_LABELS[current.status]}" cannot become "${STATUS_LABELS[status] || status}".`);
  }
  if (['en_route', 'in_progress'].includes(status) && !current.technician_id) fail(400, 'Assign a technician first.');
  if (status === 'cancelled' && !String(reason || '').trim()) fail(400, 'Enter the cancellation reason.');
  const stamp = STAMP[status];
  db.prepare(`UPDATE jobs SET status = ?${stamp ? `, ${stamp} = ?` : ''},
      cancel_reason = COALESCE(?, cancel_reason), completion_notes = COALESCE(?, completion_notes) WHERE id = ?`)
    .run(...[status, ...(stamp ? [nowStr()] : []), status === 'cancelled' ? reason.trim() : null, completion_notes?.trim() || null, id]);
  logEvent(db, id, 'status', `${STATUS_LABELS[current.status]} → ${STATUS_LABELS[status]}${reason ? ` (${reason})` : ''}`, actor);
  const job = getJob(db, id);
  if (['cancelled', 'en_route', 'completed'].includes(status)) {
    events.emit('job:changed', { db, job, kind: status, previous: current, notify });
  }
  return job;
}

/** Customer self-service is allowed only until the cancellation cutoff. */
export function beforeCutoff(db, job) {
  const hours = Number(readSettings(db).cancel_cutoff_hours || 24);
  return job.starts_at >= addMinutes(nowStr(), hours * 60);
}

// ---- Billable items
export function addItem(db, jobId, { kind = 'part', description, quantity = 1, unit_cents = 0 }) {
  if (!['part', 'labor', 'fee', 'discount'].includes(kind)) fail(400, 'Invalid item type.');
  if (!String(description || '').trim()) fail(400, 'Enter the item description.');
  const q = Number(quantity), u = Math.round(Number(unit_cents));
  if (!(q > 0 && q <= 10000)) fail(400, 'Invalid quantity.');
  if (!Number.isFinite(u) || u < 0 || u > 100_000_00) fail(400, 'Invalid price.');
  return Number(db.prepare('INSERT INTO job_items (job_id, kind, description, quantity, unit_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(jobId, kind, String(description).trim(), q, u, nowStr()).lastInsertRowid);
}
export function jobItems(db, jobId) {
  const items = db.prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY id').all(jobId)
    .map((i) => ({ ...i, total_cents: Math.round(i.quantity * i.unit_cents) * (i.kind === 'discount' ? -1 : 1) }));
  return { items, total_cents: items.reduce((s, i) => s + i.total_cents, 0) };
}

// ---- Time off
export function createTimeOff(db, { technician_id, starts_at, ends_at, reason }, userId) {
  if (!technician_id || !DT.test(String(starts_at || '').slice(0, 16)) || !DT.test(String(ends_at || '').slice(0, 16)) || !(starts_at < ends_at)) {
    fail(400, 'Enter technician, start and end (end after start).');
  }
  const s = starts_at.slice(0, 16), e = ends_at.slice(0, 16);
  const id = Number(db.prepare('INSERT INTO time_off (technician_id, starts_at, ends_at, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(technician_id, s, e, reason?.trim() || null, userId ?? null, nowStr()).lastInsertRowid);
  const affected = db.prepare(`SELECT j.id, j.ref, j.starts_at, j.ends_at, j.status, c.name customer_name FROM jobs j
      JOIN customers c ON c.id = j.customer_id
      WHERE j.technician_id = ? AND j.status IN ('scheduled','confirmed') AND j.starts_at < ? AND ? < j.ends_at ORDER BY j.starts_at`)
    .all(technician_id, e, s);
  return { id, affected };
}
