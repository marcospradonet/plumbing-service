// Dispatch board (US10–US13): day view with one column per technician, week view per technician,
// drag & drop to move/reassign, click an empty time to create a job.
import {
  addDays, api, customerLabel, DAYS, esc, fmtDate, fmtDateTime, hour12, isOffice, MONTHS, parse, showError, state, STATUS,
  time12, toast,
} from '../core.js';
import { newJob, openJob } from '../jobdialogs.js';

const PX_PER_MIN = 1;
const minutesOf = (s) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
const minOfHM = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export async function render(el, params, page) {
  const office = isOffice();
  const v = {
    mode: office ? 'day' : 'week',
    date: params[0] ? parse(params[0] + 'T00:00') : new Date(),
    tech: office ? (state.technicians.find((t) => t.active)?.id || null) : state.user.technician_id,
  };
  const activeTechs = () => state.technicians.filter((t) => t.active);

  page.actions(office ? '<button class="btn btn-primary" id="new-job">+ New job</button>' : '');
  document.getElementById('new-job')?.addEventListener('click', () => newJob({}, load));

  el.innerHTML = `
    <div class="board-bar">
      <div class="btn-group"><button class="btn" data-nav="-1" aria-label="Previous">‹</button><button class="btn" data-nav="0">Today</button><button class="btn" data-nav="1" aria-label="Next">›</button></div>
      <span class="period" aria-live="polite"></span>
      ${office ? `<div class="btn-group" role="group" aria-label="View"><button class="btn" data-mode="day">Day · all technicians</button><button class="btn" data-mode="week">Week · one technician</button></div>
        <select data-tech aria-label="Technician"></select>` : ''}
      <input type="date" data-date aria-label="Go to date" style="width:auto">
      <div class="legend">${['scheduled', 'confirmed', 'en_route', 'in_progress', 'completed', 'no_access'].map((s) => `<span class="tag st st-${s}">${STATUS[s]}</span>`).join('')}</div>
    </div>
    <div class="cal" data-cal></div>`;

  const cal = el.querySelector('[data-cal]');
  const techSel = el.querySelector('[data-tech]');
  if (techSel) {
    techSel.innerHTML = activeTechs().map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    techSel.onchange = () => { v.tech = Number(techSel.value); load(); };
  }
  el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { v.mode = b.dataset.mode; load(); });
  el.querySelectorAll('[data-nav]').forEach((b) => b.onclick = () => {
    const n = Number(b.dataset.nav);
    v.date = n === 0 ? new Date() : addDays(v.date, n * (v.mode === 'day' ? 1 : 7));
    load();
  });
  el.querySelector('[data-date]').onchange = (e) => { if (e.target.value) { v.date = parse(e.target.value + 'T00:00'); load(); } };

  function columns() {
    if (v.mode === 'day') {
      const d = fmtDate(v.date);
      return activeTechs().map((t) => ({ key: `${t.id}|${d}`, tech: t, date: d, title: t.name, sub: t.skills.length + ' skills' }));
    }
    const monday = addDays(v.date, -((v.date.getDay() + 6) % 7));
    const tech = state.technicians.find((t) => t.id === v.tech);
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      return { key: `${v.tech}|${fmtDate(d)}`, tech, date: fmtDate(d), title: `${DAYS[d.getDay()]} ${d.getDate()}`, sub: MONTHS[d.getMonth()] };
    });
  }

  async function load() {
    el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === v.mode));
    if (techSel) { techSel.hidden = v.mode === 'day'; techSel.value = String(v.tech); }
    const cols = columns();
    if (!cols.length || !cols[0].tech) { cal.innerHTML = '<div class="empty-big"><h2>No active technicians</h2></div>'; return; }
    const from = cols[0].date + 'T00:00';
    const to = fmtDate(addDays(parse(cols[cols.length - 1].date + 'T00:00'), 1)) + 'T00:00';
    el.querySelector('.period').textContent = v.mode === 'day'
      ? parse(from).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : `${cols[0].tech.name} · week of ${MONTHS[parse(from).getMonth()]} ${parse(from).getDate()}`;
    history.replaceState(null, '', `#/schedule/${fmtDate(v.date)}`);
    try {
      const techQ = v.mode === 'week' ? `&technician_id=${v.tech}` : '';
      const [jobs, off] = await Promise.all([
        api(`/jobs?from=${from}&to=${to}${techQ}`),
        api(`/time-off?from=${from}&to=${to}${techQ}`),
      ]);
      draw(cols, jobs.filter((j) => j.technician_id), off);
    } catch (e) { showError(e); }
  }

  function draw(cols, jobs, off) {
    // Visible hours: 7 AM–7 PM, widened to fit any job or working block outside it
    let startH = 7, endH = 19;
    for (const j of jobs) { startH = Math.min(startH, Math.floor(minutesOf(j.starts_at) / 60)); endH = Math.max(endH, Math.ceil(minutesOf(j.ends_at) / 60)); }
    for (const c of cols) for (const h of c.tech.hours) { startH = Math.min(startH, Number(h.start_time.slice(0, 2))); endH = Math.max(endH, Math.ceil(minOfHM(h.end_time) / 60)); }
    endH = Math.min(24, Math.max(endH, startH + 1));
    const base = startH * 60;
    const height = (endH - startH) * 60 * PX_PER_MIN;
    const today = fmtDate(new Date());
    const nowMin = minutesOf(fmtDateTime(new Date()));

    const colHtml = cols.map((c) => {
      const weekday = parse(c.date + 'T00:00').getDay();
      const blocks = c.tech.hours.filter((h) => h.weekday === weekday).map((h) => [minOfHM(h.start_time), minOfHM(h.end_time)]).sort((a, b) => a[0] - b[0]);
      // shade the gaps outside working hours
      const shades = [];
      let cursor = base;
      for (const [s, e] of blocks) { if (s > cursor) shades.push([cursor, s]); cursor = Math.max(cursor, e); }
      if (cursor < endH * 60) shades.push([cursor, endH * 60]);
      const offs = off.filter((o) => o.technician_id === c.tech.id && o.starts_at < c.date + 'T24:00' && o.ends_at > c.date + 'T00:00').map((o) => {
        const s = Math.max(base, o.starts_at.slice(0, 10) < c.date ? base : minutesOf(o.starts_at));
        const e = Math.min(endH * 60, o.ends_at.slice(0, 10) > c.date ? endH * 60 : minutesOf(o.ends_at));
        return `<div class="time-off" style="top:${(s - base) * PX_PER_MIN}px;height:${Math.max(18, (e - s) * PX_PER_MIN)}px">Off · ${esc(o.reason || '')}</div>`;
      }).join('');
      const evs = jobs.filter((j) => j.technician_id === c.tech.id && j.starts_at.slice(0, 10) === c.date).map((j) => {
        const s = minutesOf(j.starts_at), e = minutesOf(j.ends_at);
        const buf = c.tech.travel_buffer_min || 0;
        const movable = office && ['scheduled', 'confirmed'].includes(j.status);
        return `<div class="event st st-${j.status} ${j.priority === 'emergency' ? 'emergency' : ''}" data-job="${j.id}" ${movable ? 'draggable="true"' : ''}
            style="top:${(s - base) * PX_PER_MIN}px;height:${Math.max(22, (e - s) * PX_PER_MIN)}px"
            title="${esc(`${j.ref} · ${customerLabel(j)} · ${j.service_name} · ${STATUS[j.status]}`)}">
            ${j.priority !== 'standard' ? `<span class="flag">${j.priority === 'emergency' ? '🚨' : '⚡'}</span>` : ''}
            <strong>${time12(j.starts_at)} ${esc(j.customer_company || j.customer_name)}</strong>
            <span>${esc(j.service_name)}</span><span>${esc(j.city)} ${esc(j.zip)}</span>
          </div>${buf ? `<div style="position:absolute;left:8px;right:8px;top:${(e - base) * PX_PER_MIN}px;height:${buf * PX_PER_MIN}px;border-left:2px dotted var(--border-strong);pointer-events:none" aria-hidden="true"></div>` : ''}`;
      }).join('');
      const nowLine = c.date === today && nowMin >= base && nowMin <= endH * 60 ? `<div class="now-line" style="top:${(nowMin - base) * PX_PER_MIN}px"></div>` : '';
      return `<div class="cal-col" data-col="${c.key}" style="height:${height}px">
        ${shades.map(([s, e]) => `<div class="off-hours" style="top:${(s - base) * PX_PER_MIN}px;height:${(e - s) * PX_PER_MIN}px"></div>`).join('')}
        ${offs}${evs}${nowLine}</div>`;
    }).join('');

    cal.innerHTML = `<div class="cal-grid" style="grid-template-columns:64px repeat(${cols.length}, minmax(${v.mode === 'day' ? 170 : 120}px, 1fr))">
      <div class="cal-corner"></div>
      ${cols.map((c) => `<div class="cal-head ${c.date === today && v.mode === 'week' ? 'today' : ''}">${v.mode === 'day' ? `<span class="swatch" style="background:${esc(c.tech.color)}"></span>` : ''}${esc(c.title)}<small>${esc(c.sub)}</small></div>`).join('')}
      <div class="cal-hours">${Array.from({ length: endH - startH }, (_, i) => `<div class="cal-hour">${i ? hour12(startH + i) : ''}</div>`).join('')}</div>
      ${colHtml}
    </div>`;
    // scroll to ~1h before now / start
    cal.scrollTop = Math.max(0, ((cols.some((c) => c.date === today) ? nowMin : 8 * 60) - base - 60) * PX_PER_MIN);

    const timeAt = (col, clientY) => {
      const r = col.getBoundingClientRect();
      const min = base + Math.round((clientY - r.top) / PX_PER_MIN / 15) * 15;
      return hm(Math.max(base, Math.min(min, endH * 60 - 15)));
    };

    cal.onclick = (e) => {
      const ev = e.target.closest('[data-job]');
      if (ev) return openJob(Number(ev.dataset.job), load);
      const col = e.target.closest('[data-col]');
      if (!col || !office) return;
      const [tech, date] = col.dataset.col.split('|');
      newJob({ starts_at: `${date}T${timeAt(col, e.clientY)}`, technician_id: Number(tech) }, load);
    };

    if (!office) return;
    let dragging = null;
    cal.querySelectorAll('[draggable=true]').forEach((ev) => {
      ev.addEventListener('dragstart', (e) => {
        const r = ev.getBoundingClientRect();
        dragging = { id: Number(ev.dataset.job), offset: e.clientY - r.top };
        ev.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ev.dataset.job);
      });
      ev.addEventListener('dragend', () => { ev.classList.remove('dragging'); cal.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target')); });
    });
    cal.querySelectorAll('[data-col]').forEach((col) => {
      col.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); col.classList.add('drop-target'); } });
      col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drop-target');
        if (!dragging) return;
        const [tech, date] = col.dataset.col.split('|');
        const starts_at = `${date}T${timeAt(col, e.clientY - dragging.offset)}`;
        const id = dragging.id;
        dragging = null;
        try {
          const j = await api(`/jobs/${id}`, { method: 'PUT', body: { technician_id: Number(tech), starts_at } });
          toast(`${j.ref} moved to ${time12(j.starts_at)} · ${j.technician_name}. Customer notified.`);
        } catch (err) { showError(err); }
        load();
      });
    });
  }

  await load();
  const timer = setInterval(load, 60_000);
  return () => clearInterval(timer);
}
