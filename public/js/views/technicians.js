// Technicians: skills, license, color, travel buffer and weekly hours (US40).
import { api, closeModal, DAYS, DAYS_LONG, esc, modal, phoneFmt, readForm, reloadRefs, state, toast } from '../core.js';

export async function render(el, _params, page) {
  page.actions('<button class="btn btn-primary" id="new-tech">+ New technician</button>');
  document.getElementById('new-tech').onclick = () => edit(null);

  function draw() {
    el.innerHTML = `<section class="card"><div class="table-wrap"><table><thead><tr><th>Technician</th><th>License</th><th>Skills</th><th>Weekly hours</th><th>Travel buffer</th><th></th></tr></thead><tbody>
      ${state.technicians.map((t) => `<tr class="clickable" data-id="${t.id}" style="${t.active ? '' : 'opacity:.55'}">
        <td><span class="swatch" style="background:${esc(t.color)}"></span><strong>${esc(t.name)}</strong><br><small>${esc(phoneFmt(t.phone))}</small></td>
        <td>${esc(t.license_no || '—')}</td>
        <td>${t.skills.map((s) => `<span class="tag">${esc(state.meta.categories?.[s] || s)}</span>`).join(' ')}</td>
        <td><small>${[1, 2, 3, 4, 5, 6, 0].map((d) => { const hs = t.hours.filter((h) => h.weekday === d); return hs.length ? `${DAYS[d]} ${hs.map((h) => `${h.start_time}–${h.end_time}`).join(', ')}` : ''; }).filter(Boolean).join('<br>') || '—'}</small></td>
        <td>${t.travel_buffer_min} min</td><td>${t.active ? '' : '<span class="tag">Inactive</span>'}</td></tr>`).join('')}
      </tbody></table></div></section>`;
    el.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => edit(state.technicians.find((t) => t.id === Number(r.dataset.id))));
  }

  function hourRow(h = { weekday: 1, start_time: '08:00', end_time: '17:00' }) {
    return `<div class="row" data-hour>
      <select name="weekday" style="width:140px" aria-label="Day">${DAYS_LONG.map((d, i) => `<option value="${i}" ${h.weekday === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <input type="time" name="start_time" value="${h.start_time}" style="width:130px" aria-label="Start">
      <input type="time" name="end_time" value="${h.end_time}" style="width:130px" aria-label="End">
      <button type="button" class="icon-btn" data-rm aria-label="Remove block">✕</button></div>`;
  }

  function edit(t) {
    const m = modal({
      title: t ? `Edit ${t.name}` : 'New technician', wide: true,
      body: `<div class="form-grid" data-main>
        <label>Name<input name="name" value="${esc(t?.name || '')}" required></label>
        <label>Mobile phone<input name="phone" type="tel" value="${esc(phoneFmt(t?.phone))}"></label>
        <label>FL plumbing license #<input name="license_no" value="${esc(t?.license_no || '')}" placeholder="CFC…"></label>
        <label>Calendar color<input name="color" type="color" value="${esc(t?.color || '#2563eb')}"></label>
        <label>Travel buffer between jobs (min)<input name="travel_buffer_min" type="number" min="0" max="180" step="5" value="${t?.travel_buffer_min ?? 30}"></label>
        ${t ? `<label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Active</label>` : ''}
      </div>
      <fieldset><legend>Skills (service categories this technician can do)</legend><div class="chips">
        ${Object.entries(state.meta.categories || {}).map(([k, v]) => `<label class="check"><input type="checkbox" data-skill="${k}" ${t?.skills.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}
      </div></fieldset>
      <fieldset><legend>Weekly working hours</legend><div class="stack" data-hours style="gap:8px">${(t?.hours.length ? t.hours : [1, 2, 3, 4, 5].map((d) => ({ weekday: d, start_time: '08:00', end_time: '17:00' }))).map(hourRow).join('')}</div>
        <button type="button" class="btn btn-sm" data-add-hour style="margin-top:8px">+ Add block</button></fieldset>
      <p class="form-error" role="alert"></p>`,
      actions: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    });
    const hours = m.querySelector('[data-hours]');
    m.querySelector('[data-add-hour]').onclick = () => hours.insertAdjacentHTML('beforeend', hourRow());
    hours.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('[data-hour]').remove(); });
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-save]').onclick = async () => {
      const body = readForm(m.querySelector('[data-main]'));
      if (!t) body.active = true;
      body.skills = [...m.querySelectorAll('[data-skill]:checked')].map((c) => c.dataset.skill);
      body.hours = [...hours.querySelectorAll('[data-hour]')].map((r) => { const h = readForm(r); return { ...h, weekday: Number(h.weekday) }; });
      body.travel_buffer_min = Number(body.travel_buffer_min);
      try {
        await api(t ? `/technicians/${t.id}` : '/technicians', { method: t ? 'PUT' : 'POST', body });
        closeModal(); toast('Technician saved.');
        await reloadRefs(); draw();
      } catch (e) { m.querySelector('.form-error').textContent = e.message; }
    };
  }
  draw();
}
