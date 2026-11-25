// Dashboard (US50) — and the technician's "my day" list (US30).
import { address, api, can, customerLabel, dateShort, esc, isOffice, money, prioTag, statusTag, telLink, time12 } from '../core.js';
import { newJob, openJob } from '../jobdialogs.js';

const line = (j) => `<div class="job-line" data-job="${j.id}" role="button" tabindex="0">
  <div class="when">${time12(j.starts_at)}<small>${esc(dateShort(j.starts_at))}</small></div>
  <div class="what"><div><strong>${esc(customerLabel(j))}</strong> ${prioTag(j.priority)}</div>
    <div class="muted">${esc(j.service_name)} · ${esc(address(j))}</div>
    ${can('technician') && j.access_notes ? `<div class="muted">Access: ${esc(j.access_notes)}</div>` : ''}
    ${can('technician') ? `<div>${telLink(j.customer_phone)}</div>` : `<div class="muted">${esc(j.technician_name || 'Unassigned')}</div>`}</div>
  <div>${statusTag(j.status)}</div></div>`;

export async function render(el, _params, page) {
  page.title(can('technician') ? 'My day' : 'Dashboard');
  if (isOffice()) {
    page.actions('<a class="btn" href="/book" target="_blank" rel="noopener">Online booking page ↗</a><button class="btn btn-primary" id="new-job">+ New job</button>');
    document.getElementById('new-job').onclick = () => newJob({}, load);
  }
  async function load() {
    const d = await api('/dashboard');
    el.innerHTML = `<div class="stack">
      <div class="metrics">
        <div class="metric"><small>Jobs today</small><strong>${d.today}</strong></div>
        ${isOffice() ? `<a class="metric" href="#/jobs/requested" style="color:inherit;text-decoration:none"><small>Unassigned requests</small><strong style="color:${d.unassigned ? 'var(--warn)' : 'inherit'}">${d.unassigned}</strong></a>` : ''}
        <div class="metric"><small>On the way / in progress</small><strong>${d.in_progress}</strong></div>
        <div class="metric"><small>Completed today</small><strong>${d.completed_today}</strong></div>
        <div class="metric"><small>Billed this week (completed)</small><strong>${money(d.week_revenue_cents)}</strong></div>
        ${d.emergencies_open ? `<div class="metric" style="border-color:var(--danger)"><small>Open emergencies</small><strong style="color:var(--danger)">${d.emergencies_open}</strong></div>` : ''}
      </div>
      <div class="grid-2">
        <section class="card"><header><h2>${can('technician') ? 'My next jobs' : 'Next jobs (today and tomorrow)'}</h2><a href="#/schedule">Schedule →</a></header>
          <div>${d.upcoming.map(line).join('') || '<p class="empty">Nothing scheduled.</p>'}</div></section>
        ${isOffice() ? `<section class="card"><header><h2>Requests waiting for dispatch</h2><a href="#/jobs/requested">All →</a></header>
          <div>${d.requests.map(line).join('') || '<p class="empty">No pending requests.</p>'}</div></section>` : ''}
      </div></div>`;
    el.querySelectorAll('[data-job]').forEach((x) => {
      x.onclick = () => openJob(Number(x.dataset.job), load);
      x.onkeydown = (e) => { if (e.key === 'Enter') x.click(); };
    });
  }
  await load();
  const t = setInterval(() => load().catch(() => {}), 60_000);
  return () => clearInterval(t);
}
