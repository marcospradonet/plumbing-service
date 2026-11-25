// Technician time off (US16): affected jobs are listed so the office can reschedule them.
import { api, can, confirmDialog, dateTimeUS, esc, fmtDate, readForm, showError, state, toast } from '../core.js';
import { openJob } from '../jobdialogs.js';

export async function render(el) {
  const tech = can('technician');
  el.innerHTML = `<div class="grid-2">
    <section class="card"><header><h2>Add time off</h2></header><form class="card-body stack" novalidate>
      ${tech ? '' : `<label>Technician<select name="technician_id">${state.technicians.filter((t) => t.active).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>`}
      <div class="form-grid"><label>From<input type="datetime-local" name="starts_at" required></label><label>To<input type="datetime-local" name="ends_at" required></label></div>
      <label>Reason<input name="reason" placeholder="Vacation, training, doctor, truck maintenance…"></label>
      <p class="form-error" role="alert"></p>
      <div class="row row-end"><button class="btn btn-primary">Add time off</button></div>
      <div data-affected></div>
    </form></section>
    <section class="card"><header><h2>Upcoming time off</h2></header><div class="table-wrap"><table><thead><tr><th>Technician</th><th>From</th><th>To</th><th>Reason</th><th></th></tr></thead><tbody data-rows></tbody></table></div></section>
  </div>`;
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = readForm(form);
    form.querySelector('.form-error').textContent = '';
    try {
      const r = await api('/time-off', { method: 'POST', body: f });
      toast('Time off added.');
      form.querySelector('[data-affected]').innerHTML = r.affected.length
        ? `<div class="warn-box"><strong>${r.affected.length} job(s) fall in this period and must be rescheduled:</strong>
           <ul>${r.affected.map((j) => `<li><a href="#" data-job="${j.id}">${esc(j.ref)}</a> · ${esc(dateTimeUS(j.starts_at))} · ${esc(j.customer_name)}</li>`).join('')}</ul></div>` : '';
      form.querySelectorAll('[data-job]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); openJob(Number(a.dataset.job), load); });
      load();
    } catch (err) { form.querySelector('.form-error').textContent = err.message; }
  };
  async function load() {
    const list = await api(`/time-off?from=${fmtDate(new Date())}T00:00`);
    el.querySelector('[data-rows]').innerHTML = list.map((o) => `<tr><td>${esc(o.technician_name)}</td><td>${esc(dateTimeUS(o.starts_at))}</td>
      <td>${esc(dateTimeUS(o.ends_at))}</td><td>${esc(o.reason || '')}</td><td><button class="btn btn-sm btn-ghost" data-del="${o.id}">Remove</button></td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">No upcoming time off.</td></tr>';
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog('Remove this time off? The period becomes bookable again.', 'Remove', true))) return;
      try { await api(`/time-off/${b.dataset.del}`, { method: 'DELETE' }); load(); } catch (err) { showError(err); }
    });
  }
  await load();
}
