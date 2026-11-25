// Login, session, second factor and user administration (US43).
import { Router } from 'express';
import { ROLES } from '../db.js';
import { audit, createSession, endSession, requireRole } from '../auth.js';
import { checkPassword, checkTotp, hashPassword, newTotpSecret } from '../password.js';
import { fail, nowStr, route, validEmail } from '../util.js';

const attempts = new Map(); // simple brute-force throttle per e-mail

export default function userRoutes(db) {
  const r = Router();

  r.post('/auth/login', route((req, res) => {
    const { email, password, code } = req.body || {};
    const key = String(email || '').toLowerCase().trim();
    const a = attempts.get(key) || { n: 0, until: 0 };
    if (a.until > Date.now()) fail(429, 'Too many attempts. Please wait a few minutes.');
    const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(key);
    if (!u || !checkPassword(password || '', u.password_hash)) {
      a.n++; if (a.n >= 5) { a.until = Date.now() + 5 * 60_000; a.n = 0; }
      attempts.set(key, a);
      fail(401, 'Incorrect e-mail or password.');
    }
    if (u.totp_enabled) {
      if (!code) return res.json({ needs2fa: true });
      if (!checkTotp(u.totp_secret, code)) fail(401, 'Invalid verification code.');
    }
    attempts.delete(key);
    createSession(db, res, u.id);
    req.user = u;
    audit(db, req, 'login', 'user', u.id);
    res.json({ ok: true });
  }));

  r.post('/auth/logout', (req, res) => { endSession(db, req, res); res.json({ ok: true }); });

  r.get('/auth/me', requireRole(), (req, res) => {
    const tech = req.user.technician_id ? db.prepare('SELECT id, name, license_no FROM technicians WHERE id = ?').get(req.user.technician_id) : null;
    res.json({ ...req.user, role_name: ROLES[req.user.role], technician: tech });
  });

  r.post('/auth/password', requireRole(), route((req, res) => {
    const { current, next: nw } = req.body || {};
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!checkPassword(current || '', u.password_hash)) fail(400, 'Current password is incorrect.');
    if (!nw || nw.length < 8) fail(400, 'The new password must have at least 8 characters.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(nw), req.user.id);
    audit(db, req, 'change_password', 'user', req.user.id);
    res.json({ ok: true });
  }));

  r.post('/auth/2fa/start', requireRole(), (req, res) => {
    const secret = newTotpSecret();
    db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, req.user.id);
    res.json({ secret, uri: `otpauth://totp/PlumbingService:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=PlumbingService` });
  });
  r.post('/auth/2fa/enable', requireRole(), route((req, res) => {
    const u = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(req.user.id);
    if (!u.totp_secret || !checkTotp(u.totp_secret, req.body?.code)) fail(400, 'Invalid code.');
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user.id);
    audit(db, req, 'enable_2fa', 'user', req.user.id);
    res.json({ ok: true });
  }));
  r.post('/auth/2fa/disable', requireRole(), (req, res) => {
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.user.id);
    audit(db, req, 'disable_2fa', 'user', req.user.id);
    res.json({ ok: true });
  });

  // ---- User administration
  r.get('/users', requireRole('admin'), (_req, res) => {
    res.json(db.prepare(`SELECT u.id, u.name, u.email, u.role, u.technician_id, u.active, u.totp_enabled, t.name technician_name
      FROM users u LEFT JOIN technicians t ON t.id = u.technician_id ORDER BY u.name`).all());
  });

  function validate(b, isNew) {
    if (!b.name?.trim()) fail(400, 'Enter the name.');
    if (!validEmail(b.email)) fail(400, 'Invalid e-mail.');
    if (!ROLES[b.role]) fail(400, 'Invalid role.');
    if (b.role === 'technician' && !b.technician_id) fail(400, 'Link the technician user to a technician profile.');
    if (isNew && (!b.password || b.password.length < 8)) fail(400, 'The password must have at least 8 characters.');
  }

  r.post('/users', requireRole('admin'), route((req, res) => {
    const b = req.body || {};
    validate(b, true);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email.trim())) fail(409, 'A user with this e-mail already exists.');
    const id = Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, technician_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(b.name.trim(), b.email.trim().toLowerCase(), hashPassword(b.password), b.role, b.role === 'technician' ? Number(b.technician_id) : null, nowStr()).lastInsertRowid);
    audit(db, req, 'create', 'user', id, `${b.email} (${b.role})`);
    res.status(201).json({ id });
  }));

  r.put('/users/:id', requireRole('admin'), route((req, res) => {
    const b = req.body || {};
    validate(b, false);
    const id = Number(req.params.id);
    if (id === req.user.id && (b.role !== 'admin' || !b.active)) fail(400, 'You cannot remove your own administrator access.');
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, technician_id = ?, active = ? WHERE id = ?')
      .run(b.name.trim(), b.email.trim().toLowerCase(), b.role, b.role === 'technician' ? Number(b.technician_id) : null, b.active ? 1 : 0, id);
    if (b.password) {
      if (b.password.length < 8) fail(400, 'The password must have at least 8 characters.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), id);
    }
    if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(db, req, 'update', 'user', id, `${b.email} (${b.role}, ${b.active ? 'active' : 'inactive'})`);
    res.json({ ok: true });
  }));

  return r;
}
