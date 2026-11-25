// Express application (separate from index.js so tests can mount it).
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth.js';
import { wireNotifications } from './notify.js';
import catalogRoutes from './routes/catalog.js';
import customerRoutes from './routes/customers.js';
import jobRoutes from './routes/jobs.js';
import publicRoutes from './routes/public.js';
import userRoutes from './routes/users.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(db) {
  wireNotifications();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '200kb' }));

  const api = express.Router();
  api.use(loadUser(db));
  // Simple CSRF protection: state-changing requests must carry the SPA header
  api.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'fetch') {
      return res.status(403).json({ error: 'Request refused.' });
    }
    next();
  });
  api.use(publicRoutes(db));
  api.use(userRoutes(db));
  api.use(catalogRoutes(db));
  api.use(customerRoutes(db));
  api.use(jobRoutes(db));
  api.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use('/api', api);

  app.use(express.static(PUBLIC_DIR));
  app.get(['/book', '/book/*'], (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'book.html')));
  app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal error. Please try again.' : err.message });
  });
  return app;
}
