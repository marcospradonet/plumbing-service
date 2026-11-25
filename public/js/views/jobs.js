// Jobs list with filters and the unassigned requests queue (US14).
import {
  addDays, api, customerLabel, dateShort, esc, fmtDate, isOffice, prioTag, readForm, state, STATUS, statusTag, time12,
} from '../core.js';
import { newJob, openJob } from '../jobdialogs.js';

export async function render(el, params, page) {
  const queue = params[0] === 'requested';
  page.title(queue ? 'Unassigned requests' : 'Jobs');
  if (isOffice()) {
    page.actions(`<a class="btn" href="#/jobs${queue ? '' : '/requested'}">${queue ? 'All jobs' : 'Unassigned requests'}</a><button class="btn btn-primary" id="new-job">+ New job</button>`);
    document.getElementById('new-job').onclick = () => newJob({}, load);
  }
  const today = fmtDate(new Date());
  el.innerHTML = `<section class="card">
    <header class="row" data-filters ${queue ? 'hidden' : ''}>
      <input name="q" type="search" placeholder="Ref, customer or address" style="max-width:240px" aria-label="Search">
      <label>From<input name="from" type="date" value="${fmtDate(addDays(new Date(), -7))}"></label>
      <label>To<input name="to" type="date" value="${fmtDate(addDays(new Date(), 14))}"></label>
      <label>Status<select name="status"><option value="">All (except cancelled)</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      ${isOffice() ? `<label>Technician<select name="technician_id"><option value="">All</option>${state.technicians.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>` : ''}
    </header>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Ref</th><th>Customer</th><th>Service</th><th>Address</th><th>Technician</th><th>Status</th></tr></thead><tbody data-rows></tbody></table></div>
  </section>`;
  const filters = el.querySelector('[data-filters]');
  let timer;
  filters.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });

  async function load() {
    const f = readForm(filters);
    const qs = new URLSearchParams();
    if (queue) qs.set('status', 'requested');
    else {
      if (f.from) qs.set('from', f.from + 'T00:00');
      if (f.to) qs.set('to', f.to + 'T23:59');
      if (f.status) qs.set('status', f.status);
      if (f.technician_id) qs.set('technician_id', f.technician_id);
      if (f.q) qs.set('q', f.q);
    }
    const jobs = await api('/jobs?' + qs);
    el.querySelector('[data-rows]').innerHTML = jobs.map((j) => `<tr class="clickable" data-job="${j.id}" tabindex="0">
      <td>${esc(dateShort(j.starts_at))}<br><small>${time12(j.starts_at)}${j.starts_at.slice(0, 10) === today ? ' · today' : ''}</small></td>
      <td><code>${esc(j.ref)}</code><br>${prioTag(j.priority)}</td>
      <td>${esc(customerLabel(j))}<br><small>${j.source === 'online' ? 'Online booking' : 'Office'}</small></td>
      <td>${esc(j.service_name)}</td>
      <td>${esc(j.address1)}${j.unit ? ' #' + esc(j.unit) : ''}<br><small>${esc(j.city)} ${esc(j.zip)}</small></td>
      <td>${j.technician_name ? `<span class="swatch" style="background:${esc(j.technician_color)}"></span>${esc(j.technician_name)}` : '<span class="tag warn">Unassigned</span>'}</td>
      <td>${statusTag(j.status)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">${queue ? 'No requests waiting.' : 'No jobs for these filters.'}</td></tr>`;
    el.querySelectorAll('[data-job]').forEach((r) => {
      r.onclick = () => openJob(Number(r.dataset.job), load);
      r.onkeydown = (e) => { if (e.key === 'Enter') r.click(); };
    });
  }
  await load();
}
