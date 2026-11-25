// Customers (residential and business) and their service addresses (EP03).
import {
  address, api, closeModal, LANGUAGES, langTag, dateShort, esc, modal, money, phoneFmt, readForm, state, statusTag, telLink, time12, toast,
} from '../core.js';
import { newJob, openJob } from '../jobdialogs.js';

const propertyTypeOptions = (sel) => Object.entries(state.meta.property_types || {})
  .map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(v)}</option>`).join('');

const customerFields = (c = {}) => `
  <div class="wide row" role="radiogroup" aria-label="Customer type">
    <label class="check"><input type="radio" name="type" value="residential" ${c.type !== 'commercial' ? 'checked' : ''}> Residential (homeowner / tenant)</label>
    <label class="check"><input type="radio" name="type" value="commercial" ${c.type === 'commercial' ? 'checked' : ''}> Business / HOA / property manager</label>
  </div>
  <label data-company>Business name<input name="company" value="${esc(c.company || '')}"></label>
  <label>Contact name<input name="name" value="${esc(c.name || '')}" required></label>
  <label>Mobile phone<input name="phone" type="tel" value="${esc(phoneFmt(c.phone))}" placeholder="(305) 555-0123" required></label>
  <label>Alternate phone<input name="alt_phone" type="tel" value="${esc(phoneFmt(c.alt_phone))}"></label>
  <label>E-mail<input name="email" type="email" value="${esc(c.email || '')}"></label>
  <label>Language<select name="language">${Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}" ${c.language === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  <label class="check wide"><input type="checkbox" name="sms_opt_in" ${c.sms_opt_in ? 'checked' : ''}> Customer agreed to receive appointment text messages (SMS)</label>
  <label class="wide">Notes (billing terms, preferences)<textarea name="notes">${esc(c.notes || '')}</textarea></label>`;

const propertyFields = (p = {}) => `
  <label>Label<input name="label" value="${esc(p.label || '')}" placeholder="Home, Building A, Store…"></label>
  <label>Property type<select name="property_type">${propertyTypeOptions(p.property_type)}</select></label>
  <label class="wide">Street address<input name="address1" value="${esc(p.address1 || '')}" required></label>
  <label>Unit / suite<input name="unit" value="${esc(p.unit || '')}"></label>
  <label>City<input name="city" value="${esc(p.city || 'Miami')}" required></label>
  <label>ZIP<input name="zip" inputmode="numeric" maxlength="5" value="${esc(p.zip || '')}" required></label>
  <label>Number of units<input name="units_count" type="number" min="1" value="${esc(p.units_count || '')}" placeholder="Buildings only"></label>
  <label class="wide">Access notes<textarea name="access_notes" placeholder="Gate code, parking, pets, shut-off valve location…">${esc(p.access_notes || '')}</textarea></label>`;

function toggleCompany(root) {
  const sync = () => { root.querySelector('[data-company]').hidden = root.querySelector('[name=type]:checked').value !== 'commercial'; };
  root.querySelectorAll('[name=type]').forEach((r) => r.onchange = sync);
  sync();
}

export async function render(el, params, page) {
  if (params[0] === 'new') return renderNew(el, page);
  if (params[0]) return renderDetail(el, Number(params[0]), page);
  page.actions('<a class="btn btn-primary" href="#/customers/new">+ New customer</a>');
  el.innerHTML = `<section class="card"><header><input type="search" data-q placeholder="Search by name, business, phone, e-mail, address or ZIP" style="max-width:420px" aria-label="Search customers"></header>
    <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Type</th><th>Phone</th><th>E-mail</th><th class="num">Addresses</th><th>Last job</th></tr></thead><tbody data-rows></tbody></table></div></section>`;
  const q = el.querySelector('[data-q]');
  let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  async function load() {
    const list = await api('/customers?q=' + encodeURIComponent(q.value.trim()));
    el.querySelector('[data-rows]').innerHTML = list.map((c) => `<tr class="clickable" data-id="${c.id}" tabindex="0">
      <td><strong>${esc(c.company || c.name)}</strong>${c.company ? `<br><small>${esc(c.name)}</small>` : ''}</td>
      <td><span class="tag">${c.type === 'commercial' ? 'Business' : 'Residential'}</span> ${langTag(c.language)}</td>
      <td>${esc(phoneFmt(c.phone))}</td><td>${esc(c.email || '')}</td><td class="num">${c.properties_count}</td>
      <td>${c.last_job ? esc(dateShort(c.last_job)) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No customers found.</td></tr>';
    el.querySelectorAll('[data-id]').forEach((r) => {
      r.onclick = () => { location.hash = `#/customers/${r.dataset.id}`; };
      r.onkeydown = (e) => { if (e.key === 'Enter') r.click(); };
    });
  }
  await load();
}

function renderNew(el, page) {
  page.title('New customer');
  el.innerHTML = `<form class="card" novalidate><div class="card-body stack">
    <fieldset><legend>Customer</legend><div class="form-grid">${customerFields()}</div></fieldset>
    <fieldset><legend>Service address</legend><div class="form-grid" data-prop>${propertyFields()}</div></fieldset>
    <p class="form-error" role="alert"></p>
    <div class="row row-end"><a class="btn" href="#/customers">Cancel</a><button class="btn btn-primary">Save customer</button></div></div></form>`;
  const form = el.querySelector('form');
  toggleCompany(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const prop = readForm(form.querySelector('[data-prop]'));
    const c = readForm(form);
    for (const k of Object.keys(prop)) delete c[k];
    try {
      const r = await api('/customers', { method: 'POST', body: { ...c, properties: [prop] } });
      toast('Customer saved.');
      location.hash = `#/customers/${r.id}`;
    } catch (err) { form.querySelector('.form-error').textContent = err.message; }
  };
}

async function renderDetail(el, id, page) {
  const c = await api(`/customers/${id}`);
  page.title(c.company || c.name);
  const reload = () => renderDetail(el, id, page);
  page.actions('<a class="btn" href="#/customers">All customers</a><button class="btn btn-primary" id="new-job">+ New job</button>');
  document.getElementById('new-job').onclick = () => newJob({ customer: { id: c.id, name: c.company || c.name } }, reload);
  el.innerHTML = `<div class="grid-2">
    <section class="card"><header><h2>Customer</h2><button class="btn btn-sm" data-edit>Edit</button></header><div class="card-body">
      <dl class="data">
        <dt>Type</dt><dd>${c.type === 'commercial' ? 'Business' : 'Residential'}</dd>
        ${c.company ? `<dt>Business</dt><dd>${esc(c.company)}</dd>` : ''}
        <dt>Contact</dt><dd>${esc(c.name)}</dd>
        <dt>Phone</dt><dd>${telLink(c.phone)}${c.alt_phone ? ' · ' + telLink(c.alt_phone) : ''}</dd>
        <dt>E-mail</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd>
        <dt>Language</dt><dd>${LANGUAGES[c.language] || 'English'}</dd>
        <dt>Text messages</dt><dd>${c.sms_opt_in ? '<span class="tag ok">Opted in</span>' : '<span class="tag">Not opted in</span>'}</dd>
        <dt>Billed (completed)</dt><dd>${money(c.billed_cents)}</dd>
        ${c.notes ? `<dt>Notes</dt><dd>${esc(c.notes)}</dd>` : ''}
        <dt>Source</dt><dd>${c.source === 'online' ? 'Online booking' : 'Office'}</dd>
      </dl></div></section>
    <section class="card"><header><h2>Service addresses</h2><button class="btn btn-sm" data-add-prop>+ Add address</button></header>
      <div>${c.properties.map((p) => `<div class="job-line" data-prop="${p.id}" role="button" tabindex="0" style="${p.active ? '' : 'opacity:.55'}">
        <div class="what"><div><strong>${esc(p.label || address(p))}</strong> ${p.in_service_area ? '' : '<span class="tag warn">Outside service area</span>'} ${p.active ? '' : '<span class="tag">Inactive</span>'}</div>
        <div class="muted">${esc(address(p))} · ${esc(state.meta.property_types?.[p.property_type] || '')}${p.units_count ? ` · ${p.units_count} units` : ''}</div>
        ${p.access_notes ? `<div class="muted">${esc(p.access_notes)}</div>` : ''}</div></div>`).join('')}</div></section>
  </div>
  <section class="card" style="margin-top:16px"><header><h2>Jobs (${c.jobs.length})</h2></header>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Ref</th><th>Service</th><th>Address</th><th>Technician</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
    ${c.jobs.map((j) => `<tr class="clickable" data-job="${j.id}"><td>${esc(dateShort(j.starts_at))} ${time12(j.starts_at)}</td><td><code>${esc(j.ref)}</code></td>
      <td>${esc(j.service_name)}</td><td>${esc(j.address1)}${j.unit ? ' #' + esc(j.unit) : ''}</td><td>${esc(j.technician_name || '—')}</td><td>${statusTag(j.status)}</td>
      <td class="num">${money(j.total_cents)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No jobs yet.</td></tr>'}
    </tbody></table></div></section>`;

  el.querySelectorAll('[data-job]').forEach((r) => r.onclick = () => openJob(Number(r.dataset.job), reload));
  el.querySelector('[data-edit]').onclick = () => {
    const m = modal({
      title: 'Edit customer', wide: true, body: `<div class="form-grid">${customerFields(c)}</div><p class="form-error" role="alert"></p>`,
      actions: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    });
    toggleCompany(m);
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-save]').onclick = async () => {
      try { await api(`/customers/${id}`, { method: 'PUT', body: readForm(m) }); closeModal(); toast('Customer saved.'); reload(); } catch (e) { m.querySelector('.form-error').textContent = e.message; }
    };
  };
  const propDialog = (p) => {
    const m = modal({
      title: p ? 'Edit address' : 'New address', wide: true,
      body: `<div class="form-grid">${propertyFields(p)}${p ? `<label class="check wide"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Active</label>` : ''}</div><p class="form-error" role="alert"></p>`,
      actions: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    });
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-save]').onclick = async () => {
      const body = readForm(m);
      try {
        if (p) await api(`/properties/${p.id}`, { method: 'PUT', body });
        else await api(`/customers/${id}/properties`, { method: 'POST', body });
        closeModal(); toast('Address saved.'); reload();
      } catch (e) { m.querySelector('.form-error').textContent = e.message; }
    };
  };
  el.querySelector('[data-add-prop]').onclick = () => propDialog(null);
  el.querySelectorAll('[data-prop]').forEach((x) => x.onclick = () => propDialog(c.properties.find((p) => p.id === Number(x.dataset.prop))));
}
