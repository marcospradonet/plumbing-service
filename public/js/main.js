// Application shell: login, role-based menu and hash routing.
import { api, esc, LOGO, readForm, reloadRefs, showError, state } from './core.js';

const OFFICE = ['admin', 'manager', 'dispatcher'];
const ALL = [...OFFICE, 'technician'];
const ROUTES = [
  { route: '', title: 'Dashboard', icon: '◧', module: 'dashboard', roles: ALL },
  { route: 'schedule', title: 'Schedule', icon: '▦', module: 'schedule', roles: ALL },
  { route: 'jobs', title: 'Jobs', icon: '☰', module: 'jobs', roles: ALL, counter: true },
  { route: 'customers', title: 'Customers', icon: '⌂', module: 'customers', roles: OFFICE },
  { route: 'time-off', title: 'Time off', icon: '⊘', module: 'timeoff', roles: ALL },
  { route: 'notifications', title: 'Notifications', icon: '✉', module: 'notifications', roles: OFFICE },
  { sep: 'Setup', roles: ['admin', 'manager'] },
  { route: 'technicians', title: 'Technicians', icon: '⚒', module: 'technicians', roles: ['admin', 'manager'] },
  { route: 'services', title: 'Services & area', icon: '◇', module: 'services', roles: ['admin', 'manager'] },
  { route: 'settings', title: 'Settings', icon: '⚙', module: 'settings', roles: ['admin', 'manager'] },
  { route: 'users', title: 'Users', icon: '⚿', module: 'users', roles: ['admin'] },
  { route: 'audit', title: 'Audit log', icon: '≡', module: 'audit', roles: ['admin'] },
  { route: 'account', module: 'account', roles: ALL, hidden: true },
];

const app = document.getElementById('app');
let cleanup = null;
let counterTimer = null;

function loginScreen() {
  clearInterval(counterTimer);
  document.title = 'Sign in · Plumbing Service';
  app.innerHTML = `<main class="login">
    <form class="login-card" novalidate>
      <div class="brand"><span class="logo">${LOGO}</span><div><strong>Plumbing Service</strong><small>Scheduling & dispatch</small></div></div>
      <h1>Sign in</h1>
      <label>E-mail<input name="email" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <label class="field-2fa" hidden>Authenticator app code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary btn-block">Sign in</button>
      <a href="/book" class="hint">Customer? Book a plumber online →</a>
      <details class="hint"><summary>Demo users</summary>
        <p>Password for all: <code>plumbing123</code></p>
        <ul><li><code>dispatch@plumbing.local</code> — Dispatcher</li><li><code>carlos@plumbing.local</code> — Technician</li>
        <li><code>manager@plumbing.local</code> — Manager</li><li><code>admin@plumbing.local</code> — Admin</li></ul>
      </details>
    </form></main>`;
  const f = app.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    f.querySelector('.form-error').textContent = '';
    try {
      const r = await api('/auth/login', { method: 'POST', body: readForm(f) });
      if (r.needs2fa) { f.querySelector('.field-2fa').hidden = false; f.querySelector('[name=code]').focus(); return; }
      await init();
      location.hash = '#/';
    } catch (err) {
      f.querySelector('.form-error').textContent = err.message;
    } finally { btn.disabled = false; }
  };
}

function shell() {
  const u = state.user;
  const items = ROUTES.filter((r) => !r.hidden && r.roles.includes(u.role));
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><span class="logo">${LOGO}</span><div><strong>${esc(state.settings.business_name || 'Plumbing Service')}</strong><small>Miami, FL · Dispatch</small></div></div>
      <nav aria-label="Main">${items.map((r) => r.sep ? `<div class="sep">${esc(r.sep)}</div>`
        : `<a href="#/${r.route}" data-route="${r.route}"><span class="ic" aria-hidden="true">${r.icon}</span>${esc(r.title)}${r.counter ? '<span class="badge-count" hidden></span>' : ''}</a>`).join('')}</nav>
      <div class="me">
        <a href="#/account" class="me-info"><span class="avatar" aria-hidden="true">${esc(u.name.split(' ').map((x) => x[0]).slice(0, 2).join(''))}</span>
          <span><strong>${esc(u.name)}</strong><small>${esc(u.role_name)}</small></span></a>
        <button class="btn btn-ghost btn-sm" id="logout">Sign out</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar"><button class="icon-btn mobile-menu" aria-label="Open menu" id="open-menu">☰</button><h1 id="page-title"></h1><div id="top-actions"></div></header>
      <main id="content" tabindex="-1"></main>
    </div>
  </div>`;
  app.querySelector('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); state.user = null; location.hash = '#/login'; };
  app.querySelector('#open-menu').onclick = () => app.querySelector('#sidebar').classList.toggle('open');
  app.querySelector('nav').onclick = () => app.querySelector('#sidebar').classList.remove('open');
  if (OFFICE.includes(u.role)) {
    const refresh = async () => {
      try {
        const list = await api('/jobs?status=requested');
        const el = app.querySelector('.badge-count');
        if (el) { el.textContent = list.length || ''; el.hidden = !list.length; el.title = `${list.length} unassigned request(s)`; }
      } catch { /* */ }
    };
    refresh();
    clearInterval(counterTimer);
    counterTimer = setInterval(refresh, 20000);
  }
}

async function navigate() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!state.user) {
    if (hash !== 'login') { location.hash = '#/login'; return; }
    return loginScreen();
  }
  if (hash === 'login') { location.hash = '#/'; return; }
  if (!app.querySelector('.shell')) shell();
  const [route, ...params] = hash.split('/');
  const def = ROUTES.find((r) => r.route === route);
  const content = document.getElementById('content');
  cleanup?.(); cleanup = null;
  app.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  document.getElementById('top-actions').innerHTML = '';
  if (!def || !def.roles.includes(state.user.role)) {
    content.innerHTML = '<div class="empty-big"><h2>No access</h2><p>Your role does not have access to this page.</p></div>';
    return;
  }
  const setTitle = (t) => { document.getElementById('page-title').textContent = t; document.title = `${t} · Plumbing Service`; };
  setTitle(def.title || 'My account');
  content.innerHTML = '<div class="loading" aria-busy="true">Loading…</div>';
  try {
    const mod = await import(`./views/${def.module}.js`);
    cleanup = await mod.render(content, params.map(decodeURIComponent), {
      title: setTitle,
      actions: (html) => { const a = document.getElementById('top-actions'); a.innerHTML = html; return a; },
    }) || null;
    content.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    content.innerHTML = `<div class="empty-big"><h2>Could not load this page</h2><p>${esc(e.message)}</p></div>`;
  }
}

async function init() {
  try {
    state.user = await api('/auth/me');
    [state.settings, state.meta] = await Promise.all([api('/settings'), api('/meta')]);
    await reloadRefs();
  } catch {
    state.user = null;
  }
}

window.addEventListener('hashchange', navigate);
window.addEventListener('unhandledrejection', (e) => showError(e.reason));
await init();
navigate();
