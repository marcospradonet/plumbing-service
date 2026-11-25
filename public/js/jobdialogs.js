// Job dialogs shared by the schedule, jobs list, dashboard and customer pages:
// detail (status workflow, items, history), create and reschedule/assign (with free-slot finder).
import {
  addMin, address, api, can, langTag, fmtDateTime, closeModal, confirmDialog, customerLabel, customerSearch, dateShort, dateTimeUS, esc, isOffice,
  mapsLink, minutesBetween, modal, money, prioTag, readForm, serviceOptions, showError, state, statusTag, techOptions, telLink,
  time12, toast,
} from './core.js';

const KIND = { part: 'Part', labor: 'Labor', fee: 'Fee', discount: 'Discount' };

/** Status buttons available for the current user. */
function statusActions(job) {
  const tech = can('technician');
  const mgr = can('admin', 'manager');
  const a = [];
  const s = job.status;
  if (s === 'scheduled') a.push(['confirmed', 'Mark confirmed', '']);
  if (['scheduled', 'confirmed'].includes(s) && job.technician_id) a.push(['en_route', 'On my way', 'btn-primary']);
  if (['scheduled', 'confirmed', 'en_route'].includes(s) && job.technician_id) a.push(['in_progress', 'Start job', s === 'en_route' ? 'btn-primary' : '']);
  if (s === 'in_progress') a.push(['completed', 'Complete job', 'btn-primary']);
  if (['scheduled', 'confirmed', 'en_route'].includes(s)) a.push(['no_access', 'No access', '']);
  if (s === 'in_progress') a.push(['en_route', 'Undo start', 'btn-ghost']);
  if (s === 'no_access') a.push(['confirmed', 'Reopen', '']);
  if (s === 'completed' && mgr) a.push(['in_progress', 'Reopen', 'btn-ghost']);
  if (!tech && ['requested', 'scheduled', 'confirmed', 'en_route'].includes(s)) a.push(['cancelled', 'Cancel job', 'btn-danger']);
  return a;
}

export async function openJob(id, onChange = () => {}) {
  let job;
  try { job = await api(`/jobs/${id}`); } catch (e) { return showError(e); }
  const locked = ['completed', 'cancelled'].includes(job.status) && !can('admin', 'manager');
  const arrival = Number(state.settings.arrival_window_min || 120);
  const m = modal({
    title: `Job ${job.ref}`, wide: true,
    body: `
      <div class="row">${statusTag(job.status)} ${prioTag(job.priority)} <span class="tag">${job.source === 'online' ? 'Booked online' : 'Office'}</span></div>
      <div class="grid-2">
        <dl class="data">
          <dt>Customer</dt><dd>${isOffice() ? `<a href="#/customers/${job.customer_id}" data-close-link>${esc(customerLabel(job))}</a>` : esc(customerLabel(job))}
            <span class="tag">${job.customer_type === 'commercial' ? 'Business' : 'Residential'}</span> ${langTag(job.customer_language)}</dd>
          <dt>Phone</dt><dd>${telLink(job.customer_phone)}</dd>
          <dt>Address</dt><dd><a href="${esc(mapsLink(job))}" target="_blank" rel="noopener">${esc(address(job))}</a>
            <br><small>${esc(state.meta.property_types?.[job.property_type] || job.property_type)}${job.units_count ? ` · ${job.units_count} units` : ''}</small></dd>
          ${job.access_notes ? `<dt>Access</dt><dd>${esc(job.access_notes)}</dd>` : ''}
        </dl>
        <dl class="data">
          <dt>Service</dt><dd>${esc(job.service_name)}</dd>
          <dt>When</dt><dd>${esc(dateShort(job.starts_at))}, ${time12(job.starts_at)} – ${time12(job.ends_at)}
            <br><small>Customer arrival window ${time12(job.starts_at)}–${time12(addMin(job.starts_at, arrival))}</small></dd>
          <dt>Technician</dt><dd>${job.technician_name ? `<span class="swatch" style="background:${esc(job.technician_color)}"></span>${esc(job.technician_name)}` : '<span class="tag warn">Unassigned</span>'}</dd>
          ${job.cancel_reason ? `<dt>Cancelled</dt><dd>${esc(job.cancel_reason)}</dd>` : ''}
        </dl>
      </div>
      <dl class="data"><dt>Problem</dt><dd>${esc(job.problem || '—')}</dd></dl>
      <div class="grid-2">
        <label>Internal notes (office & technician)<textarea name="internal_notes" ${locked ? 'disabled' : ''}>${esc(job.internal_notes || '')}</textarea></label>
        <label>Completion notes (work performed)<textarea name="completion_notes" ${locked ? 'disabled' : ''}>${esc(job.completion_notes || '')}</textarea></label>
      </div>
      ${locked ? '' : '<div class="row row-end no-print"><button class="btn btn-sm" data-save-notes>Save notes</button></div>'}
      <fieldset><legend>Billable items</legend>
        <div class="table-wrap"><table><thead><tr><th>Type</th><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th><th class="no-print"></th></tr></thead>
        <tbody data-items></tbody><tfoot><tr><th colspan="4">Total</th><th class="num" data-total></th><th class="no-print"></th></tr></tfoot></table></div>
        ${locked ? '' : `<div class="form-grid no-print" data-item-form style="margin-top:10px;grid-template-columns:110px 1fr 80px 110px auto">
          <select name="kind" aria-label="Type">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <input name="description" placeholder="e.g. 1/2&quot; PEX, 10 ft" aria-label="Description">
          <input name="quantity" type="number" min="0.25" step="0.25" value="1" aria-label="Quantity">
          <input name="unit" type="number" min="0" step="0.01" placeholder="$ unit" aria-label="Unit price in dollars">
          <button class="btn" data-add-item>Add</button></div>`}
      </fieldset>
      <details><summary>History (${job.events.length}) and messages (${job.notifications.length})</summary>
        <div class="grid-2" style="margin-top:10px">
          <ul class="timeline">${job.events.map((e) => `<li><strong>${esc(e.kind)}</strong> · ${esc(e.detail || '')}<br>${esc(dateTimeUS(e.created_at))} · ${esc(e.actor)}</li>`).join('')}</ul>
          <ul class="timeline">${job.notifications.map((n) => `<li><strong>${esc(n.kind)}</strong> · ${esc(n.channel.toUpperCase())} → ${esc(n.recipient)} · ${esc(n.status)}<br>${esc(dateTimeUS(n.created_at))}</li>`).join('') || '<li>No messages</li>'}</ul>
        </div>
      </details>`,
    actions: `<button class="btn btn-ghost left" data-print>Print work order</button>
      ${isOffice() && ['requested', 'scheduled', 'confirmed'].includes(job.status) ? `<button class="btn" data-move>${job.technician_id ? 'Reschedule / reassign' : 'Assign & schedule'}</button>` : ''}
      ${statusActions(job).map(([s, label, cls]) => `<button class="btn ${cls}" data-status="${s}">${esc(label)}</button>`).join('')}`,
  });

  const renderItems = (data) => {
    m.querySelector('[data-items]').innerHTML = data.items.map((i) => `<tr><td>${KIND[i.kind]}</td><td>${esc(i.description)}</td>
      <td class="num">${i.quantity}</td><td class="num">${money(i.unit_cents)}</td><td class="num">${money(i.total_cents)}</td>
      <td class="no-print">${locked ? '' : `<button class="icon-btn" data-del="${i.id}" aria-label="Remove item">✕</button>`}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">No items yet</td></tr>';
    m.querySelector('[data-total]').textContent = money(data.total_cents);
  };
  renderItems(job);

  m.querySelector('[data-close-link]')?.addEventListener('click', closeModal);
  m.querySelector('[data-print]').onclick = () => window.print();
  m.querySelector('[data-save-notes]')?.addEventListener('click', async () => {
    try {
      await api(`/jobs/${id}/notes`, { method: 'PUT', body: { internal_notes: m.querySelector('[name=internal_notes]').value, completion_notes: m.querySelector('[name=completion_notes]').value } });
      toast('Notes saved.');
    } catch (e) { showError(e); }
  });
  m.querySelector('[data-add-item]')?.addEventListener('click', async () => {
    const f = readForm(m.querySelector('[data-item-form]'));
    try {
      renderItems(await api(`/jobs/${id}/items`, { method: 'POST', body: { kind: f.kind, description: f.description, quantity: Number(f.quantity), unit_cents: Math.round(Number(f.unit || 0) * 100) } }));
      m.querySelector('[data-item-form] [name=description]').value = '';
      m.querySelector('[data-item-form] [name=unit]').value = '';
      onChange();
    } catch (e) { showError(e); }
  });
  m.querySelector('[data-items]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    try { renderItems(await api(`/jobs/${id}/items/${b.dataset.del}`, { method: 'DELETE' })); onChange(); } catch (err) { showError(err); }
  });
  m.querySelector('[data-move]')?.addEventListener('click', () => editJob(job, () => { onChange(); openJob(id, onChange); }));
  m.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
    const status = b.dataset.status;
    const body = { status };
    if (status === 'cancelled') {
      const reason = await askText('Cancel job', 'Reason for cancellation (sent to history; the customer is notified)', 'Cancel job');
      if (reason === null) return openJob(id, onChange);
      body.reason = reason;
    }
    if (status === 'completed') {
      body.completion_notes = m.querySelector('[name=completion_notes]').value;
      if (!body.completion_notes.trim() && !(await confirmDialog('Complete without completion notes?', 'Complete'))) return openJob(id, onChange);
    }
    try {
      await api(`/jobs/${id}/status`, { method: 'POST', body });
      toast(status === 'en_route' ? 'Customer notified that you are on the way.' : 'Job updated.');
      onChange();
      openJob(id, onChange);
    } catch (e) { showError(e); }
  });
}

function askText(title, label, okLabel) {
  return new Promise((resolve) => {
    const m = modal({
      title, body: `<label>${esc(label)}<textarea name="t" required></textarea></label><p class="form-error"></p>`,
      actions: `<button class="btn" data-no>Back</button><button class="btn btn-danger" data-yes>${esc(okLabel)}</button>`,
    });
    m.querySelector('[data-no]').onclick = () => { closeModal(); resolve(null); };
    m.querySelector('[data-yes]').onclick = () => {
      const v = m.querySelector('textarea').value.trim();
      if (!v) { m.querySelector('.form-error').textContent = 'Please enter a reason.'; return; }
      closeModal(); resolve(v);
    };
  });
}

/** Free-slot finder: fills date/time and technician fields from /availability. */
function wireSlotFinder(m, ignoreJobId = 0) {
  const btn = m.querySelector('[data-find]');
  const out = m.querySelector('[data-slots]');
  btn.onclick = async () => {
    const f = readForm(m);
    if (!f.service_id) return showError(new Error('Select the service first.'));
    const qs = new URLSearchParams({ service_id: f.service_id, from: f.date || '', days: 7, ignore_job_id: ignoreJobId });
    if (f.technician_id) qs.set('technician_id', f.technician_id);
    try {
      const slots = await api('/availability?' + qs);
      const now = fmtDateTime(new Date());
      const list = slots.filter((s) => s.starts_at > now).slice(0, 60);
      out.innerHTML = list.length ? list.map((s) => `<button type="button" data-s="${s.starts_at}" data-t="${s.technician_ids.join(',')}">${esc(dateShort(s.starts_at))} ${time12(s.starts_at)}</button>`).join('')
        : '<span class="muted">No free slots in the next 7 days for this selection.</span>';
      out.hidden = false;
    } catch (e) { showError(e); }
  };
  out.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    out.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    m.querySelector('[name=date]').value = b.dataset.s.slice(0, 10);
    m.querySelector('[name=time]').value = b.dataset.s.slice(11, 16);
    const sel = m.querySelector('[name=technician_id]');
    const techs = b.dataset.t.split(',').map(Number);
    if (!techs.includes(Number(sel.value))) sel.value = String(techs[0]);
  });
}

function refilterTechs(m) {
  const svc = state.services.find((s) => s.id === Number(m.querySelector('[name=service_id]').value));
  const sel = m.querySelector('[name=technician_id]');
  const cur = sel.value;
  sel.innerHTML = techOptions(cur, { none: true, category: svc?.category });
  if (![...sel.options].some((o) => o.value === cur)) sel.value = '';
}

const scheduleFields = (job = {}) => `
  <label>Service<select name="service_id" required>${serviceOptions(job.service_id)}</select></label>
  <label>Priority<select name="priority">
    ${['standard', 'urgent', 'emergency'].map((p) => `<option value="${p}" ${job.priority === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}${p === 'emergency' ? ' (after-hours allowed, fee applies)' : ''}</option>`).join('')}
  </select></label>
  <label>Technician<select name="technician_id">${techOptions(job.technician_id, { none: true })}</select></label>
  <label>Date<input type="date" name="date" value="${esc(job.starts_at?.slice(0, 10) || '')}" required></label>
  <label>Start time<input type="time" name="time" step="900" value="${esc(job.starts_at?.slice(11, 16) || '')}" required></label>
  <label>Duration (min)<input type="number" name="duration" min="15" step="15" value="${job.starts_at && job.ends_at ? minutesBetween(job.starts_at, job.ends_at) : ''}" placeholder="Service default"></label>
  <div class="wide row"><button type="button" class="btn btn-sm" data-find>Find free slots</button><small>Respects skills, working hours, travel buffer and time off.</small></div>
  <div class="wide slots" data-slots hidden></div>`;

function timesFrom(f) {
  const starts_at = `${f.date}T${f.time}`;
  return { starts_at, ends_at: f.duration ? addMin(starts_at, Number(f.duration)) : undefined };
}

export function newJob({ starts_at, technician_id, customer } = {}, onSaved = () => {}) {
  let properties = [];
  const m = modal({
    title: 'New job', wide: true,
    body: `<div class="form-grid">
      <div class="wide"><label>Customer</label><div data-customer></div><small>Not found? <a href="#/customers/new" data-new-customer>Create a customer</a></small></div>
      <label class="wide">Service address<select name="property_id" required><option value="">Select a customer first</option></select></label>
      ${scheduleFields({ starts_at, technician_id })}
      <label class="wide">Problem description<textarea name="problem" placeholder="What is happening? Where in the property?"></textarea></label>
      <label class="wide">Internal notes<textarea name="internal_notes"></textarea></label>
      <label class="check wide"><input type="checkbox" name="notify" checked> Send confirmation to the customer (SMS if opted in, e-mail)</label>
    </div><p class="form-error" role="alert"></p>`,
    actions: '<button class="btn" data-close2>Cancel</button><button class="btn btn-primary" data-save>Create job</button>',
  });
  let customerId = customer?.id || null;
  const loadProps = async (id) => {
    const c = await api(`/customers/${id}`);
    properties = c.properties.filter((p) => p.active);
    m.querySelector('[name=property_id]').innerHTML = properties.map((p) => `<option value="${p.id}">${esc((p.label ? p.label + ' — ' : '') + address(p))}${p.in_service_area ? '' : ' (outside service area)'}</option>`).join('');
  };
  customerSearch(m.querySelector('[data-customer]'), ({ id }) => { customerId = id; loadProps(id).catch(showError); }, customer?.name);
  if (customerId) loadProps(customerId).catch(showError);
  m.querySelector('[data-new-customer]').onclick = closeModal;
  m.querySelector('[data-close2]').onclick = closeModal;
  m.querySelector('[name=service_id]').onchange = () => refilterTechs(m);
  refilterTechs(m);
  if (technician_id) m.querySelector('[name=technician_id]').value = String(technician_id);
  wireSlotFinder(m);
  m.querySelector('[data-save]').onclick = async () => {
    const f = readForm(m);
    const err = m.querySelector('.form-error');
    if (!customerId) { err.textContent = 'Select the customer.'; return; }
    if (!f.date || !f.time) { err.textContent = 'Enter date and start time.'; return; }
    try {
      const job = await api('/jobs', {
        method: 'POST',
        body: { customer_id: customerId, property_id: Number(f.property_id), service_id: Number(f.service_id), technician_id: f.technician_id ? Number(f.technician_id) : null, priority: f.priority, ...timesFrom(f), problem: f.problem, internal_notes: f.internal_notes, notify: f.notify },
      });
      closeModal();
      toast(`Job ${job.ref} created${job.technician_id ? '' : ' as an unassigned request'}.`);
      onSaved(job);
    } catch (e) { err.textContent = e.message; }
  };
}

export function editJob(job, onSaved = () => {}) {
  const m = modal({
    title: `${job.technician_id ? 'Reschedule' : 'Assign'} ${job.ref}`, wide: true,
    body: `<p><strong>${esc(customerLabel(job))}</strong> · ${esc(address(job))}</p>
      <div class="form-grid">${scheduleFields(job)}
      <label class="check wide"><input type="checkbox" name="notify" checked> Notify the customer of the change</label></div>
      <p class="form-error" role="alert"></p>`,
    actions: '<button class="btn" data-close2>Back</button><button class="btn btn-primary" data-save>Save</button>',
  });
  m.querySelector('[data-close2]').onclick = closeModal;
  m.querySelector('[name=service_id]').onchange = () => { refilterTechs(m); m.querySelector('[name=duration]').value = ''; };
  refilterTechs(m);
  m.querySelector('[name=technician_id]').value = job.technician_id ? String(job.technician_id) : '';
  wireSlotFinder(m, job.id);
  m.querySelector('[data-save]').onclick = async () => {
    const f = readForm(m);
    try {
      const t = timesFrom(f);
      if (!t.ends_at && Number(f.service_id) === job.service_id) t.ends_at = addMin(t.starts_at, minutesBetween(job.starts_at, job.ends_at));
      const saved = await api(`/jobs/${job.id}`, {
        method: 'PUT',
        body: { service_id: Number(f.service_id), technician_id: f.technician_id ? Number(f.technician_id) : null, priority: f.priority, ...t, notify: f.notify },
      });
      closeModal();
      toast(`Job ${saved.ref} saved.`);
      onSaved(saved);
    } catch (e) { m.querySelector('.form-error').textContent = e.message; }
  };
}
