// Front-end helpers: API, HTML escaping, dialogs, toasts and US formatting.

export const state = { user: null, settings: {}, meta: {}, technicians: [], services: [] };

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch('/api' + path, opts);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/auth/login') { state.user = null; location.hash = '#/login'; }
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const can = (...roles) => roles.includes(state.user?.role);
export const isOffice = () => can('admin', 'manager', 'dispatcher');

// ---- Dates ("YYYY-MM-DDTHH:MM", business local time)
const p2 = (n) => String(n).padStart(2, '0');
export const fmtDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const fmtDateTime = (d) => `${fmtDate(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const parse = (s) => { const [a, b = '00:00'] = s.split('T'); const [y, m, d] = a.split('-').map(Number); const [h, mi] = b.split(':').map(Number); return new Date(y, m - 1, d, h, mi || 0); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMin = (s, n) => { const d = parse(s); d.setMinutes(d.getMinutes() + n); return fmtDateTime(d); };
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const time12 = (s) => { if (!s) return ''; const [h, m] = s.slice(11, 16).split(':').map(Number); return `${((h + 11) % 12) + 1}:${p2(m)} ${h < 12 ? 'AM' : 'PM'}`; };
export const hour12 = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
export const dateUS = (s) => s ? `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}` : '';
export const dateShort = (s) => { if (!s) return ''; const d = parse(s); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
export const dateTimeUS = (s) => s ? `${dateUS(s)} ${time12(s)}` : '';
export const minutesBetween = (a, b) => Math.round((parse(b) - parse(a)) / 60000);

export const money = (cents) => (Number(cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const phoneFmt = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || ''); };
export const telLink = (p) => p ? `<a href="tel:${esc(p)}">${esc(phoneFmt(p))}</a>` : '';
export const address = (j) => `${j.address1}${j.unit ? ' #' + j.unit : ''}, ${j.city}${j.zip ? ', FL ' + j.zip : ''}`;
export const mapsLink = (j) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address(j))}`;
export const customerLabel = (j) => j.customer_company ? `${j.customer_company} (${j.customer_name})` : j.customer_name;

export const STATUS = {
  requested: 'Requested', scheduled: 'Scheduled', confirmed: 'Confirmed', en_route: 'On the way',
  in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', no_access: 'No access',
};
export const statusTag = (s) => `<span class="tag st st-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
export const prioTag = (p) => p === 'standard' ? '' : `<span class="tag prio-${esc(p)}">${p === 'emergency' ? 'Emergency' : 'Urgent'}</span>`;
export const PRICE_TYPES = { flat: 'Flat rate', hourly: 'Per hour', estimate: 'Free estimate' };

// ---- Toasts
export function toast(text, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = text;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.classList.add('leaving'), 3800);
  setTimeout(() => el.remove(), 4200);
}
export const showError = (e) => toast(e.message || String(e), 'error');

// ---- Modal
export function modal({ title, body, actions = '', wide = false, onOpen }) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></header>
    <div class="modal-body">${body}</div>
    ${actions ? `<footer>${actions}</footer>` : ''}
  </div>`;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) closeModal(); });
  bg.querySelector('[data-close]').onclick = closeModal;
  document.body.append(bg);
  const m = bg.querySelector('.modal');
  onOpen?.(m);
  m.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea')?.focus();
  return m;
}
export function closeModal() { document.querySelector('.modal-bg')?.remove(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

export function confirmDialog(text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = modal({
      title: 'Please confirm', body: `<p>${esc(text)}</p>`,
      actions: `<button class="btn" data-no>Back</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(okLabel)}</button>`,
    });
    m.querySelector('[data-no]').onclick = () => { closeModal(); resolve(false); };
    m.querySelector('[data-yes]').onclick = () => { closeModal(); resolve(true); };
  });
}

/** Reads [name] fields of a container into an object. */
export function readForm(el) {
  const o = {};
  el.querySelectorAll('[name]').forEach((i) => {
    if (i.type === 'checkbox') o[i.name] = i.checked;
    else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
    else o[i.name] = i.value;
  });
  return o;
}

export const techOptions = (sel, { all = false, none = false, activeOnly = true, category } = {}) =>
  (all ? '<option value="">All technicians</option>' : '') + (none ? '<option value="">— Unassigned —</option>' : '') +
  state.technicians.filter((t) => (!activeOnly || t.active) && (!category || category === 'general' || t.skills.includes(category)))
    .map((t) => `<option value="${t.id}" ${Number(sel) === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

export const serviceOptions = (sel) => state.services.filter((s) => s.active || s.id === Number(sel))
  .map((s) => `<option value="${s.id}" ${Number(sel) === s.id ? 'selected' : ''}>${esc(s.name)} · ${s.duration_min} min</option>`).join('');

export async function reloadRefs() {
  [state.technicians, state.services] = await Promise.all([api('/technicians'), api('/services')]);
}

/** Customer search field with suggestions; calls onPick({id, name}). */
export function customerSearch(container, onPick, initial) {
  container.innerHTML = `<div class="search-box">
    <input type="search" placeholder="Name, business, phone, e-mail or address" autocomplete="off" aria-label="Search customer" value="${esc(initial || '')}">
    <ul class="suggestions" hidden></ul></div>`;
  const inp = container.querySelector('input');
  const ul = container.querySelector('ul');
  let t;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = inp.value.trim();
      if (q.length < 2) { ul.hidden = true; return; }
      const list = await api('/customers?q=' + encodeURIComponent(q)).catch(() => []);
      ul.innerHTML = list.length ? list.slice(0, 8).map((c) => `<li><button type="button" data-id="${c.id}" data-name="${esc(c.company || c.name)}">
        <strong>${esc(c.company || c.name)}</strong><small>${c.company ? esc(c.name) + ' · ' : ''}${esc(phoneFmt(c.phone))}</small></button></li>`).join('')
        : '<li class="empty">No customers found</li>';
      ul.hidden = false;
    }, 200);
  });
  ul.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    inp.value = b.dataset.name;
    ul.hidden = true;
    onPick({ id: Number(b.dataset.id), name: b.dataset.name });
  });
}

export const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h7a3 3 0 0 1 3 3v2"/><path d="M4 4v6"/><path d="M14 12h2a3 3 0 0 1 3 3v1"/><path d="M19 16c0 1.7-1.3 3-3 3"/><path d="M19 16c.9 1.2 1.5 2.3 1.5 3.2a1.5 1.5 0 0 1-3 0c0-.9.6-2 1.5-3.2z" fill="#7dd3fc" stroke="#7dd3fc"/></svg>`;
