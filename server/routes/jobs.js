// Jobs, dispatch, technician workflow, availability, time off and dashboard (EP02, EP04, US50).
import { Router } from 'express';
import { assertJobAccess, audit, OFFICE, requireRole, STAFF } from '../auth.js';
import {
  addItem, availableSlots, createJob, createTimeOff, getJob, JOB_SELECT, jobItems, moveJob, setStatus,
} from '../scheduling.js';
import { addMinutes, clock, fail, fmtDate, nowStr, route } from '../util.js';

export default function jobRoutes(db) {
  const r = Router();
  const staff = requireRole(...STAFF);
  const office = requireRole(...OFFICE);

  const detail = (id) => {
    const job = getJob(db, id);
    if (!job) fail(404, 'Job not found.');
    const events = db.prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY id').all(id);
    const notifications = db.prepare('SELECT id, channel, recipient, kind, status, created_at FROM notifications WHERE job_id = ? ORDER BY id').all(id);
    return { ...job, ...jobItems(db, id), events, notifications };
  };

  // ---- List / board
  r.get('/jobs', staff, route((req, res) => {
    const where = [], params = [];
    const { from, to, status, q } = req.query;
    if (from) { where.push('j.ends_at > ?'); params.push(from); }
    if (to) { where.push('j.starts_at < ?'); params.push(to); }
    let tech = req.query.technician_id ? Number(req.query.technician_id) : null;
    if (req.user.role === 'technician') tech = req.user.technician_id;
    if (tech) { where.push('j.technician_id = ?'); params.push(tech); }
    if (req.query.unassigned === '1') where.push('j.technician_id IS NULL');
    if (status) {
      const list = String(status).split(',');
      where.push(`j.status IN (${list.map(() => '?').join(',')})`); params.push(...list);
    } else if (req.query.include_cancelled !== '1') where.push(`j.status <> 'cancelled'`);
    if (req.query.customer_id) { where.push('j.customer_id = ?'); params.push(Number(req.query.customer_id)); }
    if (q) {
      where.push('(j.ref LIKE ? OR c.name LIKE ? OR c.company LIKE ? OR p.address1 LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = db.prepare(`${JOB_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY j.starts_at LIMIT 1000`).all(...params);
    res.json(rows);
  }));

  r.get('/jobs/:id', staff, route((req, res) => {
    const d = detail(Number(req.params.id));
    assertJobAccess(req, d);
    res.json(d);
  }));

  // ---- Create / move (office)
  r.post('/jobs', office, route((req, res) => {
    const job = createJob(db, req.body || {}, { source: 'office', actor: req.user.name, notify: req.body?.notify !== false });
    audit(db, req, 'create', 'job', job.id, `${job.ref} ${job.starts_at}`);
    res.status(201).json(job);
  }));

  r.put('/jobs/:id', office, route((req, res) => {
    const job = moveJob(db, Number(req.params.id), req.body || {}, { actor: req.user.name, notify: req.body?.notify !== false });
    audit(db, req, 'move', 'job', job.id, `${job.ref} ${job.starts_at} ${job.technician_name || 'unassigned'}`);
    res.json(job);
  }));

  // ---- Status (office and assigned technician)
  r.post('/jobs/:id/status', staff, route((req, res) => {
    const id = Number(req.params.id);
    const current = getJob(db, id);
    if (!current) fail(404, 'Job not found.');
    assertJobAccess(req, current);
    const { status, reason, completion_notes } = req.body || {};
    if (req.user.role === 'technician') {
      if (!['en_route', 'in_progress', 'completed', 'no_access', 'confirmed'].includes(status)) fail(403, 'Cancellations are handled by the office.');
    }
    if (current.status === 'completed' && !['admin', 'manager'].includes(req.user.role)) fail(403, 'Only a manager can reopen a completed job.');
    const job = setStatus(db, id, status, { actor: req.user.name, reason, completion_notes, notify: req.body?.notify !== false });
    audit(db, req, `status:${status}`, 'job', id, job.ref);
    res.json(job);
  }));

  r.put('/jobs/:id/notes', staff, route((req, res) => {
    const job = getJob(db, Number(req.params.id));
    if (!job) fail(404, 'Job not found.');
    assertJobAccess(req, job);
    const b = req.body || {};
    db.prepare('UPDATE jobs SET internal_notes = COALESCE(?, internal_notes), completion_notes = COALESCE(?, completion_notes) WHERE id = ?')
      .run(b.internal_notes ?? null, b.completion_notes ?? null, job.id);
    res.json({ ok: true });
  }));

  // ---- Billable items
  const editableItems = (req, job) => {
    assertJobAccess(req, job);
    if (['completed', 'cancelled'].includes(job.status) && !['admin', 'manager'].includes(req.user.role)) {
      fail(403, 'Items are locked after completion. Ask a manager.');
    }
  };
  r.post('/jobs/:id/items', staff, route((req, res) => {
    const job = getJob(db, Number(req.params.id));
    if (!job) fail(404, 'Job not found.');
    editableItems(req, job);
    addItem(db, job.id, req.body || {});
    res.status(201).json(jobItems(db, job.id));
  }));
  r.delete('/jobs/:id/items/:itemId', staff, route((req, res) => {
    const job = getJob(db, Number(req.params.id));
    if (!job) fail(404, 'Job not found.');
    editableItems(req, job);
    db.prepare('DELETE FROM job_items WHERE id = ? AND job_id = ?').run(req.params.itemId, job.id);
    res.json(jobItems(db, job.id));
  }));

  // ---- Availability (office view of free slots)
  r.get('/availability', office, route((req, res) => {
    const serviceId = Number(req.query.service_id);
    if (!serviceId) fail(400, 'Select the service.');
    res.json(availableSlots(db, serviceId, {
      days: Math.min(Number(req.query.days) || 7, 60), from: req.query.from, technicianId: req.query.technician_id,
      ignoreJobId: Number(req.query.ignore_job_id) || 0, enforceLead: false, limit: 300,
    }));
  }));

  // ---- Time off (US16)
  r.get('/time-off', staff, route((req, res) => {
    const { from = '0000', to = '9999' } = req.query;
    const params = [to, from];
    let sql = `SELECT o.*, t.name technician_name FROM time_off o JOIN technicians t ON t.id = o.technician_id WHERE o.starts_at < ? AND o.ends_at > ?`;
    const tech = req.user.role === 'technician' ? req.user.technician_id : Number(req.query.technician_id || 0);
    if (tech) { sql += ' AND o.technician_id = ?'; params.push(tech); }
    res.json(db.prepare(sql + ' ORDER BY o.starts_at').all(...params));
  }));
  r.post('/time-off', staff, route((req, res) => {
    const b = { ...req.body };
    if (req.user.role === 'technician') b.technician_id = req.user.technician_id;
    const out = createTimeOff(db, b, req.user.id);
    audit(db, req, 'create', 'time_off', Number(b.technician_id), `${b.starts_at} – ${b.ends_at} ${b.reason || ''}`);
    res.status(201).json(out);
  }));
  r.delete('/time-off/:id', staff, route((req, res) => {
    const o = db.prepare('SELECT * FROM time_off WHERE id = ?').get(req.params.id);
    if (!o) fail(404, 'Time off not found.');
    if (req.user.role === 'technician' && o.technician_id !== req.user.technician_id) fail(403, 'Time off of another technician.');
    db.prepare('DELETE FROM time_off WHERE id = ?').run(o.id);
    audit(db, req, 'delete', 'time_off', o.id);
    res.json({ ok: true });
  }));

  // ---- Dashboard (US50)
  r.get('/dashboard', staff, (req, res) => {
    const today = fmtDate(clock.now());
    const techFilter = req.user.role === 'technician' ? 'AND j.technician_id = ' + Number(req.user.technician_id) : '';
    const count = (cond, ...p) => db.prepare(`SELECT COUNT(*) n FROM jobs j WHERE ${cond} ${techFilter}`).get(...p).n;
    const d = new Date(clock.now()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const weekStart = fmtDate(d) + 'T00:00';
    const weekJobs = db.prepare(`SELECT j.id FROM jobs j WHERE j.status = 'completed' AND j.completed_at >= ? ${techFilter}`).all(weekStart);
    res.json({
      today: count(`substr(j.starts_at,1,10) = ? AND j.status NOT IN ('cancelled','requested')`, today),
      unassigned: count(`j.status = 'requested'`),
      in_progress: count(`j.status IN ('en_route','in_progress')`),
      completed_today: count(`j.status = 'completed' AND substr(j.completed_at,1,10) = ?`, today),
      week_revenue_cents: weekJobs.reduce((s, j) => s + jobItems(db, j.id).total_cents, 0),
      emergencies_open: count(`j.priority = 'emergency' AND j.status IN ('requested','scheduled','confirmed','en_route','in_progress')`),
      upcoming: db.prepare(`${JOB_SELECT} WHERE j.status IN ('scheduled','confirmed','en_route','in_progress') AND j.ends_at >= ? AND j.starts_at < ? ${techFilter}
        ORDER BY j.starts_at LIMIT 12`).all(nowStr(), addMinutes(today + 'T00:00', 2 * 1440)),
      requests: req.user.role === 'technician' ? [] : db.prepare(`${JOB_SELECT} WHERE j.status = 'requested' ORDER BY j.priority = 'emergency' DESC, j.starts_at LIMIT 10`).all(),
    });
  });

  return r;
}
