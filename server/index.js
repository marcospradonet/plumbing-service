// Entry point: time zone, database, demo data, scheduler and HTTP server.
process.env.TZ = process.env.BUSINESS_TZ || 'America/New_York';

const { openDb, seed } = await import('./db.js');
const { createApp } = await import('./app.js');
const { createJob, setStatus } = await import('./scheduling.js');
const { startScheduler, smsLive } = await import('./notify.js');
const { clock, fmtDate, nowStr } = await import('./util.js');

const db = openDb();

if (seed(db, nowStr())) {
  // A few demo jobs for today and the next business days
  const base = clock.now();
  const day = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); while (d.getDay() === 0) d.setDate(d.getDate() + 1); return fmtDate(d); };
  const demo = [
    // customer, property, service, technician, day offset, time, priority, problem
    [1, 1, 1, 1, 0, '09:00', 'standard', 'Kitchen sink drains very slowly.'],
    [3, 3, 8, 2, 0, '10:00', 'standard', 'Annual backflow test for the building.'],
    [2, 2, 4, 3, 1, '11:00', 'urgent', 'Water stain on the ceiling below the master bathroom.'],
    [4, 4, 1, 1, 1, '15:00', 'standard', 'Floor drain backing up in the kitchen.'],
    [1, 1, 5, 2, 2, '08:00', 'standard', 'No hot water since yesterday.'],
    [3, 3, 7, 1, 3, '13:00', 'standard', 'Recurring clogs on the ground floor units.'],
  ];
  for (const [customer_id, property_id, service_id, technician_id, n, t, priority, problem] of demo) {
    try {
      createJob(db, { customer_id, property_id, service_id, technician_id, starts_at: `${day(n)}T${t}`, priority, problem },
        { notify: false, enforceHours: false, actor: 'demo' });
    } catch { /* ignore conflicts */ }
  }
  try { setStatus(db, 1, 'confirmed', { notify: false, actor: 'demo' }); } catch { /* */ }
  try {
    createJob(db, { customer_id: 2, property_id: 2, service_id: 9, starts_at: `${day(2)}T14:00`, problem: 'Considering repiping the condo (galvanized pipes).' },
      { notify: false, source: 'online', actor: 'demo' });
  } catch { /* */ }
  console.log('Database created with demo data. Password for all users: plumbing123');
}

const app = createApp(db);
startScheduler(db);
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Plumbing Service running at http://localhost:${port}  (online booking: /book)`);
  console.log(`Time zone: ${process.env.TZ}. SMS: ${smsLive() ? 'Twilio (live)' : 'simulated — see Notifications'}`);
});
