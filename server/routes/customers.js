// Customers and service addresses (EP03).
import { Router } from 'express';
import { PROPERTY_TYPES, tx } from '../db.js';
import { audit, OFFICE, requireRole, STAFF } from '../auth.js';
import { jobItems } from '../scheduling.js';
import { digits, fail, normalizePhone, nowStr, route, validEmail, validZip } from '../util.js';

export function validateCustomer(b) {
  const type = b.type === 'commercial' ? 'commercial' : 'residential';
  if (!b.name?.trim()) fail(400, 'Enter the contact name.');
  if (type === 'commercial' && !b.company?.trim()) fail(400, 'Enter the business name.');
  const phone = normalizePhone(b.phone);
  if (!phone) fail(400, 'Enter a valid US phone number (10 digits).');
  const alt = b.alt_phone ? normalizePhone(b.alt_phone) : null;
  if (b.alt_phone && !alt) fail(400, 'Invalid alternate phone.');
  if (b.email && !validEmail(b.email)) fail(400, 'Invalid e-mail.');
  return {
    type, name: b.name.trim(), company: type === 'commercial' ? b.company.trim() : null, phone, alt_phone: alt,
    email: b.email?.trim().toLowerCase() || null, language: ['es', 'pt'].includes(b.language) ? b.language : 'en',
    sms_opt_in: b.sms_opt_in ? 1 : 0, notes: b.notes?.trim() || null,
  };
}

export function validateProperty(b) {
  if (!b.address1?.trim()) fail(400, 'Enter the street address.');
  if (!b.city?.trim()) fail(400, 'Enter the city.');
  if (!validZip(b.zip)) fail(400, 'Enter a 5-digit ZIP code.');
  const type = PROPERTY_TYPES[b.property_type] ? b.property_type : 'single_family';
  const units = b.units_count ? Number(b.units_count) : null;
  if (units !== null && !(Number.isInteger(units) && units >= 1 && units <= 500)) fail(400, 'Invalid number of units.');
  return {
    label: b.label?.trim() || null, address1: b.address1.trim(), unit: b.unit?.trim() || null, city: b.city.trim(),
    state: (b.state || 'FL').trim().toUpperCase().slice(0, 2), zip: b.zip, property_type: type, units_count: units,
    access_notes: b.access_notes?.trim() || null,
  };
}

export function insertCustomer(db, c, source = 'office') {
  return Number(db.prepare(`INSERT INTO customers (type, name, company, phone, alt_phone, email, language, sms_opt_in, notes, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.type, c.name, c.company, c.phone, c.alt_phone, c.email, c.language,
    c.sms_opt_in, c.notes, source, nowStr()).lastInsertRowid);
}
export function insertProperty(db, customerId, p) {
  return Number(db.prepare(`INSERT INTO properties (customer_id, label, address1, unit, city, state, zip, property_type, units_count, access_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(customerId, p.label, p.address1, p.unit, p.city, p.state, p.zip, p.property_type,
    p.units_count, p.access_notes).lastInsertRowid);
}

export default function customerRoutes(db) {
  const r = Router();
  const staff = requireRole(...STAFF);
  const office = requireRole(...OFFICE);
  const inArea = db.prepare('SELECT 1 FROM service_areas WHERE zip = ? AND active = 1');

  r.get('/customers', office, (req, res) => {
    const q = String(req.query.q || '').trim();
    let where = '', params = [];
    if (q) {
      const like = `%${q}%`;
      const d = digits(q);
      where = `WHERE c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ?
        OR EXISTS (SELECT 1 FROM properties p WHERE p.customer_id = c.id AND (p.address1 LIKE ? OR p.zip = ?))
        ${d.length >= 3 ? 'OR c.phone LIKE ? OR c.alt_phone LIKE ?' : ''}`;
      params = [like, like, like, like, q];
      if (d.length >= 3) params.push(`%${d}%`, `%${d}%`);
    }
    res.json(db.prepare(`SELECT c.*,
        (SELECT COUNT(*) FROM properties p WHERE p.customer_id = c.id AND p.active = 1) properties_count,
        (SELECT MAX(starts_at) FROM jobs j WHERE j.customer_id = c.id AND j.status <> 'cancelled') last_job
      FROM customers c ${where} ORDER BY COALESCE(c.company, c.name) COLLATE NOCASE LIMIT 200`).all(...params));
  });

  r.get('/customers/:id', staff, route((req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) fail(404, 'Customer not found.');
    if (req.user.role === 'technician' && !db.prepare('SELECT 1 FROM jobs WHERE customer_id = ? AND technician_id = ?').get(c.id, req.user.technician_id)) {
      fail(403, 'You have no jobs with this customer.');
    }
    const properties = db.prepare('SELECT * FROM properties WHERE customer_id = ? ORDER BY active DESC, id').all(c.id)
      .map((p) => ({ ...p, in_service_area: Boolean(inArea.get(p.zip)) }));
    const jobs = db.prepare(`SELECT j.id, j.ref, j.starts_at, j.status, j.priority, s.name service_name, t.name technician_name,
        p.address1, p.unit FROM jobs j JOIN services s ON s.id = j.service_id LEFT JOIN technicians t ON t.id = j.technician_id
        JOIN properties p ON p.id = j.property_id WHERE j.customer_id = ? ORDER BY j.starts_at DESC`).all(c.id)
      .map((j) => ({ ...j, total_cents: jobItems(db, j.id).total_cents }));
    const billed = jobs.filter((j) => j.status === 'completed').reduce((s, j) => s + j.total_cents, 0);
    res.json({ ...c, properties, jobs, billed_cents: billed });
  }));

  r.post('/customers', office, route((req, res) => {
    const b = req.body || {};
    const c = validateCustomer(b);
    const props = (Array.isArray(b.properties) ? b.properties : []).map(validateProperty);
    if (!props.length) fail(400, 'Add at least one service address.');
    const dup = db.prepare('SELECT id, name FROM customers WHERE phone = ?').get(c.phone);
    if (dup && !b.allow_duplicate) fail(409, `A customer with this phone already exists: ${dup.name} (#${dup.id}).`);
    const id = tx(db, () => {
      const cid = insertCustomer(db, c);
      for (const p of props) insertProperty(db, cid, p);
      return cid;
    });
    audit(db, req, 'create', 'customer', id, c.company || c.name);
    res.status(201).json({ id });
  }));

  r.put('/customers/:id', office, route((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) fail(404, 'Customer not found.');
    const c = validateCustomer(req.body || {});
    db.prepare(`UPDATE customers SET type=?, name=?, company=?, phone=?, alt_phone=?, email=?, language=?, sms_opt_in=?, notes=?, updated_at=? WHERE id=?`)
      .run(c.type, c.name, c.company, c.phone, c.alt_phone, c.email, c.language, c.sms_opt_in, c.notes, nowStr(), id);
    audit(db, req, 'update', 'customer', id, c.company || c.name);
    res.json({ ok: true });
  }));

  r.post('/customers/:id/properties', office, route((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) fail(404, 'Customer not found.');
    const pid = insertProperty(db, id, validateProperty(req.body || {}));
    audit(db, req, 'create', 'property', pid);
    res.status(201).json({ id: pid });
  }));

  r.put('/properties/:id', office, route((req, res) => {
    const p = validateProperty(req.body || {});
    const out = db.prepare(`UPDATE properties SET label=?, address1=?, unit=?, city=?, state=?, zip=?, property_type=?, units_count=?, access_notes=?, active=? WHERE id=?`)
      .run(p.label, p.address1, p.unit, p.city, p.state, p.zip, p.property_type, p.units_count, p.access_notes, req.body?.active === false ? 0 : 1, req.params.id);
    if (!out.changes) fail(404, 'Address not found.');
    audit(db, req, 'update', 'property', Number(req.params.id));
    res.json({ ok: true });
  }));

  return r;
}
