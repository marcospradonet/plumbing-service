// Customer notifications outbox (US45).
import { api, dateTimeUS, esc, showError, state, toast } from '../core.js';
import { openJob } from '../jobdialogs.js';

const ST = { pending: '', sent: 'ok', simulated: 'ok', failed: 'danger' };

export async function render(el) {
  el.innerHTML = `<div class="stack">
    <p class="info-box">SMS: <strong>${state.meta.sms_live ? 'sent through Twilio' : 'simulated (no Twilio credentials)'}</strong>. E-mail is simulated in this version. Messages are queued on booking, reschedule, cancellation, reminder, "on the way" and completion.</p>
    <section class="card"><header><select data-status style="width:auto" aria-label="Filter by status"><option value="">All</option><option value="pending">Pending</option><option value="sent">Sent</option><option value="simulated">Simulated</option><option value="failed">Failed</option></select></header>
    <div class="table-wrap"><table><thead><tr><th>Created</th><th>Job</th><th>Channel</th><th>To</th><th>Message</th><th>Status</th></tr></thead><tbody data-rows></tbody></table></div></section></div>`;
  const sel = el.querySelector('[data-status]');
  sel.onchange = load;
  async function load() {
    const rows = await api('/notifications' + (sel.value ? `?status=${sel.value}` : ''));
    el.querySelector('[data-rows]').innerHTML = rows.map((n) => `<tr>
      <td>${esc(dateTimeUS(n.created_at))}</td>
      <td>${n.job_id ? `<a href="#" data-job="${n.job_id}"><code>${esc(n.ref)}</code></a>` : ''}<br><small>${esc(n.customer_name || '')}</small></td>
      <td>${n.channel.toUpperCase()}<br><small>${esc(n.kind)}</small></td><td>${esc(n.recipient)}</td>
      <td style="max-width:420px">${n.subject ? `<strong>${esc(n.subject)}</strong><br>` : ''}${esc(n.body)}</td>
      <td><span class="tag ${ST[n.status]}">${esc(n.status)}</span>${n.error ? `<br><small>${esc(n.error)}</small>` : ''}
        ${n.status === 'failed' ? `<br><button class="btn btn-sm" data-retry="${n.id}">Retry</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No messages.</td></tr>';
    el.querySelectorAll('[data-job]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openJob(Number(a.dataset.job), load); });
    el.querySelectorAll('[data-retry]').forEach((b) => b.onclick = async () => {
      try { await api(`/notifications/${b.dataset.retry}/retry`, { method: 'POST' }); toast('Retry queued.'); load(); } catch (e) { showError(e); }
    });
  }
  await load();
}
