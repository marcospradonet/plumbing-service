// Embedded SQLite (node:sqlite) — no native dependencies.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './password.js';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');

export const CATEGORIES = {
  drain: 'Drains & sewer lines', leak: 'Leaks & pipes', water_heater: 'Water heaters', fixture: 'Toilets, faucets & fixtures',
  sewer: 'Sewer camera & main line', repipe: 'Repiping', inspection: 'Inspections & backflow', general: 'General plumbing',
};
export const PROPERTY_TYPES = {
  single_family: 'Single-family house', townhouse: 'Townhouse', condo: 'Condo / apartment unit',
  small_multifamily: 'Small multifamily building', small_commercial: 'Small commercial building',
};
export const ROLES = { admin: 'Administrator', manager: 'Manager', dispatcher: 'Dispatcher', technician: 'Technician' };
export const JOB_STATUSES = ['requested', 'scheduled', 'confirmed', 'en_route', 'in_progress', 'completed', 'cancelled', 'no_access'];

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  license_no TEXT,
  skills TEXT NOT NULL DEFAULT '',            -- comma-separated categories
  color TEXT NOT NULL DEFAULT '#2563eb',
  travel_buffer_min INTEGER NOT NULL DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS technician_hours (
  id INTEGER PRIMARY KEY,
  technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL, end_time TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY,
  technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT,
  created_by INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_es TEXT,
  category TEXT NOT NULL,
  description TEXT,
  duration_min INTEGER NOT NULL DEFAULT 60,
  price_type TEXT NOT NULL DEFAULT 'flat' CHECK (price_type IN ('flat','hourly','estimate')),
  base_price_cents INTEGER NOT NULL DEFAULT 0,
  online INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS service_areas (
  zip TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','dispatcher','technician')),
  technician_id INTEGER REFERENCES technicians(id),
  totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'residential' CHECK (type IN ('residential','commercial')),
  name TEXT NOT NULL,                 -- contact person
  company TEXT,                       -- commercial customers
  phone TEXT NOT NULL,                -- E.164
  alt_phone TEXT,
  email TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','es')),
  sms_opt_in INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'office',
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS ix_customers_name ON customers(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT,
  address1 TEXT NOT NULL,
  unit TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'FL',
  zip TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT 'single_family',
  units_count INTEGER,
  access_notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_properties_customer ON properties(customer_id);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  property_id INTEGER NOT NULL REFERENCES properties(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  technician_id INTEGER REFERENCES technicians(id),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('requested','scheduled','confirmed','en_route','in_progress','completed','cancelled','no_access')),
  priority TEXT NOT NULL DEFAULT 'standard' CHECK (priority IN ('standard','urgent','emergency')),
  source TEXT NOT NULL DEFAULT 'office',
  problem TEXT,
  internal_notes TEXT,
  completion_notes TEXT,
  cancel_reason TEXT,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  confirmed_at TEXT, en_route_at TEXT, started_at TEXT, completed_at TEXT, cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_jobs_tech ON jobs(technician_id, starts_at);
CREATE INDEX IF NOT EXISTS ix_jobs_customer ON jobs(customer_id, starts_at);
CREATE INDEX IF NOT EXISTS ix_jobs_start ON jobs(starts_at);
CREATE TABLE IF NOT EXISTS job_items (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'part' CHECK (kind IN ('part','labor','fee','discount')),
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_job_events ON job_events(job_id, id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms','email')),
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','simulated','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt TEXT,
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_notifications_status ON notifications(status, next_attempt);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER, user_name TEXT,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER,
  detail TEXT, created_at TEXT NOT NULL
);
`;

export const DEFAULT_SETTINGS = {
  business_name: 'Bayside Plumbing Co.',
  business_phone: '+13055550100',
  emergency_phone: '+13055550199',
  business_email: 'office@baysideplumbing.example',
  business_address: '2100 NW 7th St, Miami, FL 33125',
  license_no: 'CFC1430000',
  min_lead_hours: '2',
  booking_window_days: '21',
  cancel_cutoff_hours: '24',
  slot_step_min: '60',
  arrival_window_min: '120',
  reminder_hours: '24',
  emergency_fee_cents: '15000',
  closed_days: '',
  sms_footer: 'Reply STOP to opt out.',
};

export function openDb(file = path.join(DATA_DIR, 'plumbing.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  return db;
}

const txDepth = new WeakMap();
/** Runs fn in a transaction. Re-entrant: nested calls join the outer transaction. */
export function tx(db, fn) {
  const depth = txDepth.get(db) || 0;
  if (depth > 0) {
    txDepth.set(db, depth + 1);
    try { return fn(); } finally { txDepth.set(db, depth); }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth.set(db, 1);
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth.set(db, 0);
  }
}

export function readSettings(db) {
  const s = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) s[r.key] = r.value;
  return s;
}

const MIAMI_DADE_ZIPS = [
  ['33010', 'Hialeah'], ['33012', 'Hialeah'], ['33013', 'Hialeah'], ['33014', 'Miami Lakes'], ['33016', 'Hialeah Gardens'],
  ['33125', 'Miami'], ['33126', 'Miami'], ['33127', 'Miami'], ['33128', 'Miami'], ['33129', 'Miami'], ['33130', 'Miami'],
  ['33131', 'Miami (Brickell)'], ['33132', 'Miami (Downtown)'], ['33133', 'Coconut Grove'], ['33134', 'Coral Gables'],
  ['33135', 'Miami (Little Havana)'], ['33136', 'Miami'], ['33137', 'Miami (Design District)'], ['33138', 'Miami (Upper East Side)'],
  ['33139', 'Miami Beach'], ['33140', 'Miami Beach'], ['33141', 'North Beach'], ['33142', 'Miami'], ['33143', 'South Miami'],
  ['33144', 'Miami'], ['33145', 'Miami'], ['33146', 'Coral Gables'], ['33147', 'Miami'], ['33150', 'Miami'],
  ['33155', 'Miami'], ['33156', 'Pinecrest'], ['33157', 'Palmetto Bay'], ['33161', 'North Miami'], ['33162', 'North Miami Beach'],
  ['33165', 'Westchester'], ['33166', 'Miami Springs'], ['33172', 'Doral'], ['33173', 'Kendall'], ['33174', 'Miami'],
  ['33175', 'Miami'], ['33176', 'Kendall'], ['33178', 'Doral'], ['33183', 'Kendall'], ['33185', 'Miami'], ['33186', 'Kendall'],
];

/** Demo data — only created when the database is empty. */
export function seed(db, now) {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return false;
  tx(db, () => {
    const area = db.prepare('INSERT OR IGNORE INTO service_areas (zip, city) VALUES (?, ?)');
    for (const [z, c] of MIAMI_DADE_ZIPS) area.run(z, c);

    const svc = db.prepare(`INSERT INTO services (name, name_es, category, description, duration_min, price_type, base_price_cents, online)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    svc.run('Drain cleaning', 'Destape de drenajes', 'drain', 'Kitchen, bathroom or laundry drain clog. Snaking included.', 60, 'flat', 17900, 1);
    svc.run('Toilet repair / unclog', 'Reparación de inodoro', 'fixture', 'Running, leaking or clogged toilet.', 60, 'flat', 14900, 1);
    svc.run('Faucet or fixture installation', 'Instalación de grifos o accesorios', 'fixture', 'Customer-supplied or stock fixtures.', 60, 'flat', 15900, 1);
    svc.run('Leak detection & repair', 'Detección y reparación de fugas', 'leak', 'Visible or hidden leaks, slab leak detection.', 90, 'hourly', 12500, 1);
    svc.run('Water heater repair', 'Reparación de calentador de agua', 'water_heater', 'Tank or tankless; diagnostic fee applied to repair.', 90, 'flat', 18900, 1);
    svc.run('Water heater replacement', 'Reemplazo de calentador de agua', 'water_heater', 'Removal, install and permit. Scheduled after estimate.', 240, 'estimate', 0, 0);
    svc.run('Sewer camera inspection', 'Inspección con cámara de alcantarillado', 'sewer', 'Video inspection of the main line with report.', 90, 'flat', 29900, 1);
    svc.run('Backflow test & certification', 'Prueba y certificación de backflow', 'inspection', 'Annual backflow preventer test filed with Miami-Dade WASD.', 60, 'flat', 12900, 1);
    svc.run('Repiping consultation', 'Consulta de cambio de tuberías', 'repipe', 'Free on-site estimate for whole-house or building repipe.', 60, 'estimate', 0, 1);
    svc.run('Emergency service', 'Servicio de emergencia', 'general', 'Burst pipe, sewage backup, no water. Call our 24/7 line.', 90, 'hourly', 19500, 0);

    const tech = db.prepare(`INSERT INTO technicians (name, phone, license_no, skills, color, travel_buffer_min) VALUES (?, ?, ?, ?, ?, ?)`);
    const t1 = tech.run('Carlos Rivera', '+13055550111', 'CFC1430001', 'drain,leak,fixture,sewer,general', '#2563eb', 30).lastInsertRowid;
    const t2 = tech.run('Mike Johnson', '+13055550112', 'CFC1430002', 'water_heater,leak,repipe,inspection,general', '#c2410c', 30).lastInsertRowid;
    const t3 = tech.run('Ana Torres', '+13055550113', 'CFC1430003', 'drain,fixture,leak,inspection,general', '#7c3aed', 20).lastInsertRowid;
    const hours = db.prepare('INSERT INTO technician_hours (technician_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)');
    for (const d of [1, 2, 3, 4, 5]) { hours.run(t1, d, '08:00', '17:00'); hours.run(t2, d, '08:00', '17:00'); }
    for (const d of [2, 3, 4, 5]) hours.run(t3, d, '09:00', '18:00');
    hours.run(t1, 6, '08:00', '13:00');
    hours.run(t3, 6, '08:00', '14:00');

    const user = db.prepare(`INSERT INTO users (name, email, password_hash, role, technician_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const pw = hashPassword('plumbing123');
    user.run('Office Admin', 'admin@plumbing.local', pw, 'admin', null, now);
    user.run('Rachel Green', 'manager@plumbing.local', pw, 'manager', null, now);
    user.run('Daniela Suarez', 'dispatch@plumbing.local', pw, 'dispatcher', null, now);
    user.run('Carlos Rivera', 'carlos@plumbing.local', pw, 'technician', t1, now);
    user.run('Mike Johnson', 'mike@plumbing.local', pw, 'technician', t2, now);
    user.run('Ana Torres', 'ana@plumbing.local', pw, 'technician', t3, now);

    const cust = db.prepare(`INSERT INTO customers (type, name, company, phone, email, language, sms_opt_in, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const prop = db.prepare(`INSERT INTO properties (customer_id, label, address1, unit, city, zip, property_type, units_count, access_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const c1 = cust.run('residential', 'Laura Martinez', null, '+13055550142', 'laura.martinez@example.com', 'es', 1, 'Prefers morning visits.', now).lastInsertRowid;
    prop.run(c1, 'Home', '1420 SW 22nd St', null, 'Miami', '33145', 'single_family', null, 'Dog in the backyard. Main shut-off by the front hose bib.');
    const c2 = cust.run('residential', 'David Cohen', null, '+13055550177', 'dcohen@example.com', 'en', 1, null, now).lastInsertRowid;
    prop.run(c2, 'Condo', '1500 Bay Rd', '1204', 'Miami Beach', '33139', 'condo', null, 'Check in with front desk; service elevator only. Parking on level P2.');
    const c3 = cust.run('commercial', 'Patricia Gomez', 'Sunset Grove Condominium Association', '+13055550188', 'board@sunsetgrove.example', 'en', 1, 'Net 30. Send invoices to the board e-mail.', now).lastInsertRowid;
    prop.run(c3, 'Building A', '7520 SW 57th Ave', null, 'South Miami', '33143', 'small_multifamily', 12, 'Gate code #4521. Water meter room behind unit 1.');
    const c4 = cust.run('commercial', 'Jorge Perez', 'Little Havana Café LLC', '+13055550155', 'jorge@lhcafe.example', 'es', 0, 'Restaurant — avoid lunch hours 11:30–2:00.', now).lastInsertRowid;
    prop.run(c4, 'Restaurant', '1601 SW 8th St', null, 'Miami', '33135', 'small_commercial', 1, 'Grease trap in the back alley.');
  });
  return true;
}
