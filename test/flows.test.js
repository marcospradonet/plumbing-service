// End-to-end tests of the main flows (node:test, in-memory database, real HTTP).
process.env.TZ = 'America/New_York';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const { openDb, seed } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { createJob } = await import('../server/scheduling.js');
const { processOutbox, queueReminders } = await import('../server/notify.js');
const { clock, nowStr } = await import('../server/util.js');

// Monday, Dec 7 2026, 7:00 AM in Miami
clock.fix(new Date(2026, 11, 7, 7, 0));
const MON = '2026-12-07', TUE = '2026-12-08', WED = '2026-12-09', SUN = '2026-12-13';

let db, server, base;
before(async () => {
  db = openDb(':memory:');
  seed(db, nowStr());
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

/** Tiny client keeping the session cookie. */
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}
async function login(email) {
  const c = client();
  const r = await c('/auth/login', { method: 'POST', body: { email, password: 'plumbing123' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}
const anon = client();

const booking = (over = {}) => ({
  service_id: 1, starts_at: `${TUE}T09:00`, problem: 'Bathroom sink clogged',
  customer: { type: 'residential', name: 'Test Customer', phone: '(305) 555-0199', email: 'test@example.com', language: 'en', sms_opt_in: true },
  property: { address1: '100 Test Ave', city: 'Miami', zip: '33130', property_type: 'single_family' },
  ...over,
});

describe('online booking (EP01)', () => {
  test('ZIP coverage', async () => {
    assert.deepEqual((await anon('/public/zip/33139')).body, { served: true, city: 'Miami Beach' });
    assert.equal((await anon('/public/zip/32801')).body.served, false); // Orlando
    assert.equal((await anon('/public/zip/abc')).status, 400);
  });

  test('only online services are listed, emergency is office-only', async () => {
    const list = (await anon('/public/services')).body;
    assert.ok(list.length > 0);
    assert.ok(!list.some((s) => s.name === 'Emergency service'));
  });

  test('slots respect lead time, hours and closed days', async () => {
    const slots = (await anon('/public/slots?service_id=1')).body;
    assert.ok(slots.length > 0);
    assert.ok(slots.every((s) => s.starts_at >= `${MON}T09:00`), 'min lead of 2 hours from 7:00');
    assert.ok(!slots.some((s) => s.starts_at.startsWith(SUN)), 'nobody works on Sunday');
    assert.ok(!('technician_ids' in slots[0]), 'technicians are not exposed');
  });

  test('book, look up, confirm, reschedule and cancel', async () => {
    const r = await anon('/public/bookings', { method: 'POST', body: booking() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.ref, /^PL-[A-Z0-9]{6}$/);
    assert.equal(r.body.status, 'scheduled');
    assert.ok(r.body.technician, 'a technician is auto-assigned');

    const job = db.prepare('SELECT * FROM jobs WHERE ref = ?').get(r.body.ref);
    assert.equal(job.source, 'online');
    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(job.customer_id);
    assert.equal(cust.phone, '+13055550199');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE job_id = ?').get(job.id).n, 2, 'SMS + e-mail queued');

    assert.equal((await anon('/public/lookup', { method: 'POST', body: { ref: r.body.ref, phone: '3055550000' } })).status, 404, 'phone must match');
    const look = await anon('/public/lookup', { method: 'POST', body: { ref: r.body.ref.toLowerCase(), phone: '305-555-0199' } });
    assert.equal(look.status, 200);
    assert.equal(look.body.can_change, true);

    const conf = await anon(`/public/bookings/${r.body.ref}/confirm`, { method: 'POST', body: { phone: '3055550199' } });
    assert.equal(conf.body.status, 'confirmed');

    const res = await anon(`/public/bookings/${r.body.ref}/reschedule`, { method: 'POST', body: { phone: '3055550199', starts_at: `${WED}T10:00` } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.starts_at, `${WED}T10:00`);
    assert.equal(res.body.status, 'scheduled', 'moving resets confirmation');

    const can = await anon(`/public/bookings/${r.body.ref}/cancel`, { method: 'POST', body: { phone: '3055550199' } });
    assert.equal(can.body.status, 'cancelled');
  });

  test('same phone reuses the customer and address', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM customers').get().n;
    const r = await anon('/public/bookings', { method: 'POST', body: booking({ starts_at: `${TUE}T13:00` }) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n, before);
  });

  test('refuses unserved ZIP, invalid phone, taken or past slots', async () => {
    assert.equal((await anon('/public/bookings', { method: 'POST', body: booking({ property: { ...booking().property, zip: '32801' } }) })).status, 400);
    assert.equal((await anon('/public/bookings', { method: 'POST', body: booking({ customer: { ...booking().customer, phone: '123' } }) })).status, 400);
    assert.equal((await anon('/public/bookings', { method: 'POST', body: booking({ starts_at: `${MON}T08:00` }) })).status, 409, 'inside min lead time');
    assert.equal((await anon('/public/bookings', { method: 'POST', body: booking({ starts_at: `${TUE}T03:00` }) })).status, 409, 'outside hours');
  });

  test('commercial booking requires a business name', async () => {
    const r = await anon('/public/bookings', { method: 'POST', body: booking({ customer: { ...booking().customer, type: 'commercial', phone: '3055550123' } }) });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /business name/i);
  });
});

describe('dispatch rules (EP02)', () => {
  let office;
  before(async () => { office = await login('dispatch@plumbing.local'); });

  test('no double booking, including travel buffer', async () => {
    // Carlos (id 1, 30 min buffer): drain cleaning 60 min at 14:00 on Wednesday
    const a = await office('/jobs', { method: 'POST', body: { customer_id: 2, property_id: 2, service_id: 1, technician_id: 1, starts_at: `${WED}T14:00` } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const overlap = await office('/jobs', { method: 'POST', body: { customer_id: 4, property_id: 4, service_id: 1, technician_id: 1, starts_at: `${WED}T14:30` } });
    assert.equal(overlap.status, 409);
    const buffer = await office('/jobs', { method: 'POST', body: { customer_id: 4, property_id: 4, service_id: 1, technician_id: 1, starts_at: `${WED}T15:15` } });
    assert.equal(buffer.status, 409, 'ends 15:00 + 30 min travel');
    assert.match(buffer.body.error, /travel/);
    const ok = await office('/jobs', { method: 'POST', body: { customer_id: 4, property_id: 4, service_id: 1, technician_id: 1, starts_at: `${WED}T15:30` } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  test('skills are enforced', async () => {
    // Water heater repair (service 5) — Carlos has no water_heater skill
    const r = await office('/jobs', { method: 'POST', body: { customer_id: 1, property_id: 1, service_id: 5, technician_id: 1, starts_at: `${WED}T08:00` } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /not qualified/);
  });

  test('after hours only for emergencies, with fee', async () => {
    const body = { customer_id: 1, property_id: 1, service_id: 10, technician_id: 1, starts_at: `${TUE}T21:00` };
    assert.equal((await office('/jobs', { method: 'POST', body })).status, 409);
    const r = await office('/jobs', { method: 'POST', body: { ...body, priority: 'emergency' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = (await office(`/jobs/${r.body.id}`)).body;
    assert.ok(d.items.some((i) => i.kind === 'fee' && i.unit_cents === 15000));
  });

  test('property must belong to the customer', async () => {
    const r = await office('/jobs', { method: 'POST', body: { customer_id: 1, property_id: 2, service_id: 1, technician_id: 1, starts_at: `${WED}T08:00` } });
    assert.equal(r.status, 400);
  });

  test('unassigned request → assign and schedule notifies the customer', async () => {
    const r = await office('/jobs', { method: 'POST', body: { customer_id: 3, property_id: 3, service_id: 8, starts_at: `${WED}T09:00` } });
    assert.equal(r.body.status, 'requested');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE job_id = ?').get(r.body.id).n, 0);
    const m = await office(`/jobs/${r.body.id}`, { method: 'PUT', body: { technician_id: 3, starts_at: `${WED}T09:00` } });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.equal(m.body.status, 'scheduled');
    assert.ok(db.prepare(`SELECT COUNT(*) n FROM notifications WHERE job_id = ? AND kind = 'booked'`).get(r.body.id).n > 0);
  });

  test('time off blocks booking and lists affected jobs', async () => {
    const r = await office('/time-off', { method: 'POST', body: { technician_id: 1, starts_at: `${WED}T11:00`, ends_at: `${WED}T17:00`, reason: 'Training' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.affected.length, 2, 'the two jobs booked at 14:00 and 15:30');
    const blocked = await office('/jobs', { method: 'POST', body: { customer_id: 1, property_id: 1, service_id: 1, technician_id: 1, starts_at: `${WED}T11:00` } });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /off/);
  });

  test('cancel requires a reason', async () => {
    const j = createJob(db, { customer_id: 1, property_id: 1, service_id: 2, technician_id: 3, starts_at: `${TUE}T15:00` }, { notify: false });
    assert.equal((await office(`/jobs/${j.id}/status`, { method: 'POST', body: { status: 'cancelled' } })).status, 400);
    const ok = await office(`/jobs/${j.id}/status`, { method: 'POST', body: { status: 'cancelled', reason: 'Customer fixed it' } });
    assert.equal(ok.body.status, 'cancelled');
  });
});

describe('technician workflow (EP04) and permissions', () => {
  test('technician sees only own jobs and runs the job', async () => {
    const carlos = await login('carlos@plumbing.local');
    const mine = createJob(db, { customer_id: 1, property_id: 1, service_id: 1, technician_id: 1, starts_at: `${MON}T10:00` }, { notify: false });
    const other = createJob(db, { customer_id: 2, property_id: 2, service_id: 4, technician_id: 2, starts_at: `${MON}T10:00` }, { notify: false });
    const list = (await carlos(`/jobs?from=${MON}T00:00&to=${MON}T23:59`)).body;
    assert.ok(list.every((j) => j.technician_id === 1));
    assert.equal((await carlos(`/jobs/${other.id}`)).status, 403);
    assert.equal((await carlos('/jobs', { method: 'POST', body: {} })).status, 403, 'cannot create jobs');
    assert.equal((await carlos(`/jobs/${mine.id}/status`, { method: 'POST', body: { status: 'cancelled', reason: 'x' } })).status, 403);

    const enroute = await carlos(`/jobs/${mine.id}/status`, { method: 'POST', body: { status: 'en_route' } });
    assert.equal(enroute.body.status, 'en_route');
    assert.ok(db.prepare(`SELECT 1 FROM notifications WHERE job_id = ? AND kind = 'en_route'`).get(mine.id));
    await carlos(`/jobs/${mine.id}/status`, { method: 'POST', body: { status: 'in_progress' } });
    const item = await carlos(`/jobs/${mine.id}/items`, { method: 'POST', body: { kind: 'part', description: 'P-trap 1-1/2"', quantity: 1, unit_cents: 2450 } });
    assert.equal(item.status, 201);
    assert.equal(item.body.total_cents, 17900 + 2450);
    const done = await carlos(`/jobs/${mine.id}/status`, { method: 'POST', body: { status: 'completed', completion_notes: 'Replaced P-trap, snaked line.' } });
    assert.equal(done.body.status, 'completed');
    assert.equal((await carlos(`/jobs/${mine.id}/items`, { method: 'POST', body: { description: 'late', unit_cents: 100 } })).status, 403, 'locked after completion');
    assert.equal((await carlos(`/jobs/${mine.id}/status`, { method: 'POST', body: { status: 'in_progress' } })).status, 403, 'only managers reopen');
  });

  test('invalid status transitions are refused', async () => {
    const mgr = await login('manager@plumbing.local');
    const j = createJob(db, { customer_id: 1, property_id: 1, service_id: 2, technician_id: 3, starts_at: `${TUE}T16:00` }, { notify: false });
    assert.equal((await mgr(`/jobs/${j.id}/status`, { method: 'POST', body: { status: 'completed' } })).status, 400);
  });

  test('role gates on setup and admin pages', async () => {
    const office = await login('dispatch@plumbing.local');
    assert.equal((await office('/users')).status, 403);
    assert.equal((await office('/settings', { method: 'PUT', body: { min_lead_hours: 1 } })).status, 403);
    assert.equal((await anon('/jobs')).status, 401);
    const noCsrf = await fetch(base + '/public/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(noCsrf.status, 403);
  });
});

describe('reminders and outbox', () => {
  test('reminders are queued once within the window and delivered (simulated)', async () => {
    const j = createJob(db, { customer_id: 2, property_id: 2, service_id: 4, technician_id: 2, starts_at: `${MON}T15:00` }, { notify: false });
    const n1 = queueReminders(db);
    assert.ok(n1 >= 1);
    assert.ok(db.prepare(`SELECT 1 FROM notifications WHERE job_id = ? AND kind = 'reminder'`).get(j.id));
    assert.equal(queueReminders(db), 0, 'not queued twice');
    while (await processOutbox(db)) { /* drain the queue, 20 per batch */ }
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM notifications WHERE status = 'pending'`).get().n, 0);
  });

  test('Spanish-speaking customers get Spanish messages', () => {
    const j = createJob(db, { customer_id: 1, property_id: 1, service_id: 3, technician_id: 3, starts_at: `${WED}T11:00` }, { actor: 'test' });
    const sms = db.prepare(`SELECT body FROM notifications WHERE job_id = ? AND channel = 'sms'`).get(j.id);
    assert.match(sms.body, /su cita/);
    assert.match(sms.body, /STOP/);
  });

  test('customers without SMS opt-in get no texts', () => {
    const j = createJob(db, { customer_id: 4, property_id: 4, service_id: 1, technician_id: 3, starts_at: `${WED}T14:00` }, { actor: 'test' });
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM notifications WHERE job_id = ? AND channel = 'sms'`).get(j.id).n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM notifications WHERE job_id = ? AND channel = 'email'`).get(j.id).n, 1);
  });
});
