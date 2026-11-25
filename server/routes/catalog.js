// Technicians and hours (US40), services and service area (US41), settings (US42), audit (US44), outbox (US45).
import { Router } from 'express';
import { CATEGORIES, DEFAULT_SETTINGS, PROPERTY_TYPES, readSettings, ROLES, tx } from '../db.js';
import { audit, OFFICE, requireRole, STAFF } from '../auth.js';
import { processOutbox, smsLive } from '../notify.js';
import { STATUS_LABELS } from '../scheduling.js';
import { fail, normalizePhone, route, validZip } from '../util.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export default function catalogRoutes(db) {
  const r = Router();
  const staff = requireRole(...STAFF);
  const managers = requireRole('admin', 'manager');

  // Reference data for the SPA
  r.get('/meta', staff, (_req, res) => res.json({
    categories: CATEGORIES, property_types: PROPERTY_TYPES, roles: ROLES, statuses: STATUS_LABELS, sms_live: smsLive(),
  }));

  // ---- Technicians
  r.get('/technicians', staff, (_req, res) => {
    const techs = db.prepare('SELECT * FROM technicians ORDER BY active DESC, name').all();
    const hours = db.prepare('SELECT * FROM technician_hours ORDER BY weekday, start_time').all();
    res.json(techs.map((t) => ({ ...t, skills: t.skills ? t.skills.split(',') : [], hours: hours.filter((h) => h.technician_id === t.id) })));
  });

  function saveTechnician(req, id) {
    const b = req.body || {};
    if (!b.name?.trim()) fail(400, 'Enter the name.');
    const phone = b.phone ? normalizePhone(b.phone) : null;
    if (b.phone && !phone) fail(400, 'Invalid US phone number.');
    const buffer = Number(b.travel_buffer_min ?? 30);
    if (!(buffer >= 0 && buffer <= 180)) fail(400, 'Travel buffer must be between 0 and 180 minutes.');
    const skills = (Array.isArray(b.skills) ? b.skills : String(b.skills || '').split(',')).map((s) => s.trim()).filter((s) => CATEGORIES[s]);
    const hours = Array.isArray(b.hours) ? b.hours : [];
    for (const h of hours) {
      if (!(h.weekday >= 0 && h.weekday <= 6) || !HHMM.test(h.start_time) || !HHMM.test(h.end_time) || h.start_time >= h.end_time) {
        fail(400, 'Invalid hours: check days and times (HH:MM, start before end).');
      }
    }
    const color = COLOR.test(b.color || '') ? b.color : '#2563eb';
    return tx(db, () => {
      if (id) {
        db.prepare('UPDATE technicians SET name=?, phone=?, license_no=?, skills=?, color=?, travel_buffer_min=?, active=? WHERE id=?')
          .run(b.name.trim(), phone, b.license_no?.trim() || null, skills.join(','), color, buffer, b.active === false ? 0 : 1, id);
      } else {
        id = Number(db.prepare('INSERT INTO technicians (name, phone, license_no, skills, color, travel_buffer_min) VALUES (?,?,?,?,?,?)')
          .run(b.name.trim(), phone, b.license_no?.trim() || null, skills.join(','), color, buffer).lastInsertRowid);
      }
      db.prepare('DELETE FROM technician_hours WHERE technician_id = ?').run(id);
      const ins = db.prepare('INSERT INTO technician_hours (technician_id, weekday, start_time, end_time) VALUES (?,?,?,?)');
      for (const h of hours) ins.run(id, h.weekday, h.start_time, h.end_time);
      audit(db, req, 'save', 'technician', id, b.name);
      return id;
    });
  }
  r.post('/technicians', managers, route((req, res) => res.status(201).json({ id: saveTechnician(req, 0) })));
  r.put('/technicians/:id', managers, route((req, res) => res.json({ id: saveTechnician(req, Number(req.params.id)) })));

  // ---- Services
  r.get('/services', staff, (_req, res) => res.json(db.prepare('SELECT * FROM services ORDER BY active DESC, category, name').all()));
  function saveService(req, id) {
    const b = req.body || {};
    if (!b.name?.trim()) fail(400, 'Enter the service name.');
    if (!CATEGORIES[b.category]) fail(400, 'Invalid category.');
    if (!['flat', 'hourly', 'estimate'].includes(b.price_type)) fail(400, 'Invalid price type.');
    const dur = Number(b.duration_min);
    if (!(dur >= 15 && dur <= 600)) fail(400, 'Duration must be between 15 and 600 minutes.');
    const price = Math.round(Number(b.base_price_cents || 0));
    if (!(price >= 0)) fail(400, 'Invalid price.');
    const vals = [b.name.trim(), b.name_es?.trim() || null, b.name_pt?.trim() || null, b.category, b.description?.trim() || null,
      b.description_es?.trim() || null, b.description_pt?.trim() || null, dur, b.price_type, price, b.online ? 1 : 0, b.active === false ? 0 : 1];
    if (id) db.prepare('UPDATE services SET name=?, name_es=?, name_pt=?, category=?, description=?, description_es=?, description_pt=?, duration_min=?, price_type=?, base_price_cents=?, online=?, active=? WHERE id=?').run(...vals, id);
    else id = Number(db.prepare('INSERT INTO services (name, name_es, name_pt, category, description, description_es, description_pt, duration_min, price_type, base_price_cents, online, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(...vals).lastInsertRowid);
    audit(db, req, 'save', 'service', id, b.name);
    return id;
  }
  r.post('/services', managers, route((req, res) => res.status(201).json({ id: saveService(req, 0) })));
  r.put('/services/:id', managers, route((req, res) => res.json({ id: saveService(req, Number(req.params.id)) })));

  // ---- Service area (ZIP codes)
  r.get('/service-areas', staff, (_req, res) => res.json(db.prepare('SELECT * FROM service_areas ORDER BY zip').all()));
  r.post('/service-areas', managers, route((req, res) => {
    const { zip, city } = req.body || {};
    if (!validZip(zip)) fail(400, 'Enter a 5-digit ZIP code.');
    if (!city?.trim()) fail(400, 'Enter the city.');
    db.prepare('INSERT INTO service_areas (zip, city, active) VALUES (?, ?, 1) ON CONFLICT(zip) DO UPDATE SET city = excluded.city, active = 1').run(zip, city.trim());
    audit(db, req, 'save', 'service_area', Number(zip), city);
    res.status(201).json({ ok: true });
  }));
  r.put('/service-areas/:zip', managers, route((req, res) => {
    db.prepare('UPDATE service_areas SET active = ? WHERE zip = ?').run(req.body?.active ? 1 : 0, req.params.zip);
    audit(db, req, req.body?.active ? 'activate' : 'deactivate', 'service_area', Number(req.params.zip));
    res.json({ ok: true });
  }));

  // ---- Settings
  r.get('/settings', staff, (_req, res) => res.json(readSettings(db)));
  r.put('/settings', managers, route((req, res) => {
    const b = req.body || {};
    const nums = ['min_lead_hours', 'booking_window_days', 'cancel_cutoff_hours', 'slot_step_min', 'arrival_window_min', 'reminder_hours', 'emergency_fee_cents'];
    for (const k of nums) if (k in b && !(Number(b[k]) >= 0 && Number.isFinite(Number(b[k])))) fail(400, `Invalid value for ${k}.`);
    if ('slot_step_min' in b && Number(b.slot_step_min) < 15) fail(400, 'Slot step must be at least 15 minutes.');
    if ('booking_window_days' in b && !(Number(b.booking_window_days) >= 1 && Number(b.booking_window_days) <= 120)) fail(400, 'Booking window must be 1–120 days.');
    for (const k of ['business_phone', 'emergency_phone']) if (k in b && !normalizePhone(b[k])) fail(400, `Invalid phone in ${k}.`);
    if ('closed_days' in b) {
      const days = String(b.closed_days).split(',').map((s) => s.trim()).filter(Boolean);
      if (days.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) fail(400, 'Closed days must be YYYY-MM-DD separated by commas.');
      b.closed_days = days.join(',');
    }
    const up = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    tx(db, () => {
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (k in b) up.run(['business_phone', 'emergency_phone'].includes(k) ? normalizePhone(b[k]) : String(b[k]).trim(), k);
      }
    });
    audit(db, req, 'update', 'settings', null, Object.keys(b).join(', '));
    res.json(readSettings(db));
  }));

  // ---- Audit log
  r.get('/audit', requireRole('admin'), (req, res) => {
    res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(Number(req.query.limit) || 300, 1000)));
  });

  // ---- Notifications outbox
  r.get('/notifications', requireRole(...OFFICE), (req, res) => {
    const where = req.query.status ? 'WHERE n.status = ?' : '';
    const params = req.query.status ? [req.query.status] : [];
    res.json(db.prepare(`SELECT n.*, j.ref, c.name customer_name FROM notifications n
      LEFT JOIN jobs j ON j.id = n.job_id LEFT JOIN customers c ON c.id = n.customer_id ${where} ORDER BY n.id DESC LIMIT 300`).all(...params));
  });
  r.post('/notifications/:id/retry', requireRole(...OFFICE), route(async (req, res) => {
    db.prepare(`UPDATE notifications SET status = 'pending', attempts = 0, next_attempt = NULL WHERE id = ? AND status = 'failed'`).run(req.params.id);
    await processOutbox(db);
    res.json({ ok: true });
  }));

  return r;
}
