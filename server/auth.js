// Session authentication (HttpOnly cookie), roles and audit log.
import crypto from 'node:crypto';
import { fail, nowStr } from './util.js';

const DURATION_MS = 12 * 60 * 60 * 1000;
export const COOKIE = 'sid';

function readCookies(req) {
  const out = {};
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}

export function createSession(db, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + DURATION_MS);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURATION_MS / 1000}${secure}`);
}

export function endSession(db, req, res) {
  const token = readCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** Middleware: loads req.user from the session cookie. */
export const loadUser = (db) => (req, _res, next) => {
  const token = readCookies(req)[COOKIE];
  if (token) {
    const u = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.technician_id, u.totp_enabled
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(token, Date.now());
    if (u) req.user = u;
  }
  next();
};

/** Middleware: requires login and, optionally, one of the given roles. */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(Object.assign(new Error('Your session expired. Please sign in again.'), { status: 401 }));
  if (roles.length && !roles.includes(req.user.role)) {
    return next(Object.assign(new Error('Your role does not have access to this feature.'), { status: 403 }));
  }
  next();
};

export const OFFICE = ['admin', 'manager', 'dispatcher'];
export const STAFF = ['admin', 'manager', 'dispatcher', 'technician'];

export function audit(db, req, action, entity, entityId = null, detail = null) {
  db.prepare(`INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.user?.id ?? null, req.user?.name ?? 'system', action, entity, entityId,
    detail ? String(detail).slice(0, 500) : null, nowStr());
}

/** Technicians may only act on jobs assigned to them. */
export function assertJobAccess(req, job) {
  if (req.user.role === 'technician' && job.technician_id !== req.user.technician_id) fail(403, 'This job is assigned to another technician.');
}

/** Simple fixed-window rate limiter keyed by IP (public endpoints). */
export function rateLimit({ windowMs = 60_000, max = 60 } = {}) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return next(Object.assign(new Error('Too many requests. Please wait a minute.'), { status: 429 }));
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
