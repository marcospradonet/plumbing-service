// Public online booking and self-service (EP01). No login; protected by rate limits and ref + phone matching.
import { Router } from 'express';
import { PROPERTY_TYPES, readSettings, tx } from '../db.js';
import { rateLimit } from '../auth.js';
import {
  availableSlots, beforeCutoff, createJob, getJobByRef, leastLoaded, logEvent, moveJob, OPEN_STATUSES, setStatus,
} from '../scheduling.js';
import { fail, normalizePhone, route, validZip } from '../util.js';
import { insertCustomer, insertProperty, validateCustomer, validateProperty } from './customers.js';

export default function publicRoutes(db) {
  const r = Router();
  r.use('/public', rateLimit({ max: 120 }));
  const strict = rateLimit({ max: 15 });

  const area = (zip) => db.prepare('SELECT * FROM service_areas WHERE zip = ? AND active = 1').get(zip);
  const onlineService = (id) => db.prepare('SELECT * FROM services WHERE id = ? AND active = 1 AND online = 1').get(Number(id));

  r.get('/public/info', (_req, res) => {
    const s = readSettings(db);
    res.json({
      business_name: s.business_name, business_phone: s.business_phone, emergency_phone: s.emergency_phone,
      business_email: s.business_email, license_no: s.license_no, arrival_window_min: Number(s.arrival_window_min),
      cancel_cutoff_hours: Number(s.cancel_cutoff_hours), booking_window_days: Number(s.booking_window_days),
      property_types: PROPERTY_TYPES,
    });
  });

  r.get('/public/zip/:zip', route((req, res) => {
    if (!validZip(req.params.zip)) fail(400, 'Enter a 5-digit ZIP code.');
    const a = area(req.params.zip);
    res.json({ served: Boolean(a), city: a?.city || null });
  }));

  r.get('/public/services', (_req, res) => {
    res.json(db.prepare(`SELECT id, name, name_es, category, description, duration_min, price_type, base_price_cents
      FROM services WHERE active = 1 AND online = 1 ORDER BY category, name`).all());
  });

  r.get('/public/slots', route((req, res) => {
    const svc = onlineService(req.query.service_id);
    if (!svc) fail(400, 'Service not available online.');
    const slots = availableSlots(db, svc.id, { enforceLead: true });
    res.json(slots.map((s) => ({ starts_at: s.starts_at, ends_at: s.ends_at })));
  }));

  /** Re-checks the slot at booking time and returns the technician to assign. */
  function pickTechnician(serviceId, startsAt, ignoreJobId = 0, prefer = null) {
    const slot = availableSlots(db, serviceId, { enforceLead: true, ignoreJobId }).find((s) => s.starts_at === startsAt);
    if (!slot) fail(409, 'Sorry, that time was just taken. Please choose another time.');
    if (prefer && slot.technician_ids.includes(prefer)) return prefer;
    return leastLoaded(db, slot.technician_ids, startsAt.slice(0, 10));
  }

  r.post('/public/bookings', strict, route((req, res) => {
    const b = req.body || {};
    const svc = onlineService(b.service_id);
    if (!svc) fail(400, 'Service not available online.');
    const cust = validateCustomer(b.customer || {});
    const prop = validateProperty(b.property || {});
    if (!area(prop.zip)) fail(400, 'Sorry, we do not serve this ZIP code yet. Please call us.');
    if (!String(b.problem || '').trim()) fail(400, 'Please describe the problem.');
    const startsAt = String(b.starts_at || '').slice(0, 16);
    const job = tx(db, () => {
      const technicianId = pickTechnician(svc.id, startsAt);
      let customer = db.prepare('SELECT * FROM customers WHERE phone = ? ORDER BY id LIMIT 1').get(cust.phone);
      let customerId;
      if (customer) {
        customerId = customer.id;
        db.prepare(`UPDATE customers SET language = ?, sms_opt_in = MAX(sms_opt_in, ?), email = COALESCE(email, ?) WHERE id = ?`)
          .run(cust.language, cust.sms_opt_in, cust.email, customerId);
      } else {
        customerId = insertCustomer(db, cust, 'online');
      }
      const existing = db.prepare(`SELECT id FROM properties WHERE customer_id = ? AND zip = ? AND lower(address1) = lower(?)
          AND COALESCE(lower(unit), '') = COALESCE(lower(?), '') AND active = 1`).get(customerId, prop.zip, prop.address1, prop.unit);
      const propertyId = existing?.id ?? insertProperty(db, customerId, prop);
      return createJob(db, {
        customer_id: customerId, property_id: propertyId, service_id: svc.id, technician_id: technicianId,
        starts_at: startsAt, problem: b.problem, priority: b.urgent ? 'urgent' : 'standard',
      }, { source: 'online', actor: 'customer (online)' });
    });
    res.status(201).json(publicView(job));
  }));

  function findOwn(ref, phone) {
    const job = getJobByRef(db, ref);
    const p = normalizePhone(phone);
    if (!job || !p || job.customer_phone !== p) fail(404, 'We could not find a booking with this reference and phone number.');
    return job;
  }
  function publicView(job) {
    const s = readSettings(db);
    return {
      ref: job.ref, status: job.status, starts_at: job.starts_at, ends_at: job.ends_at,
      arrival_window_min: Number(s.arrival_window_min), service_id: job.service_id,
      service_name: job.service_name, service_name_es: job.service_name_es,
      address: `${job.address1}${job.unit ? ' #' + job.unit : ''}, ${job.city}, ${job.state} ${job.zip}`,
      technician: job.technician_name ? job.technician_name.split(' ')[0] : null,
      can_change: OPEN_STATUSES.includes(job.status) && beforeCutoff(db, job),
      can_confirm: job.status === 'scheduled',
      language: job.customer_language,
    };
  }

  r.post('/public/lookup', strict, route((req, res) => res.json(publicView(findOwn(req.body?.ref, req.body?.phone)))));

  r.post('/public/bookings/:ref/confirm', strict, route((req, res) => {
    const job = findOwn(req.params.ref, req.body?.phone);
    if (job.status !== 'scheduled') fail(400, 'This booking cannot be confirmed.');
    res.json(publicView(setStatus(db, job.id, 'confirmed', { actor: 'customer (online)' })));
  }));

  r.post('/public/bookings/:ref/cancel', strict, route((req, res) => {
    const job = findOwn(req.params.ref, req.body?.phone);
    if (!OPEN_STATUSES.includes(job.status) || !beforeCutoff(db, job)) {
      fail(400, `Online changes close ${readSettings(db).cancel_cutoff_hours} hours before the visit. Please call us.`);
    }
    res.json(publicView(setStatus(db, job.id, 'cancelled', { actor: 'customer (online)', reason: String(req.body?.reason || '').trim() || 'Cancelled by customer online' })));
  }));

  r.post('/public/bookings/:ref/reschedule', strict, route((req, res) => {
    const job = findOwn(req.params.ref, req.body?.phone);
    if (!OPEN_STATUSES.includes(job.status) || !beforeCutoff(db, job)) {
      fail(400, `Online changes close ${readSettings(db).cancel_cutoff_hours} hours before the visit. Please call us.`);
    }
    const startsAt = String(req.body?.starts_at || '').slice(0, 16);
    const moved = tx(db, () => {
      const technicianId = pickTechnician(job.service_id, startsAt, job.id, job.technician_id);
      return moveJob(db, job.id, { starts_at: startsAt, technician_id: technicianId }, { actor: 'customer (online)' });
    });
    logEvent(db, job.id, 'self_service', 'Rescheduled by customer online', 'customer (online)');
    res.json(publicView(moved));
  }));

  return r;
}
