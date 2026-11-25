// Audit log (US44).
import { api, dateTimeUS, esc } from '../core.js';

export async function render(el) {
  const rows = await api('/audit');
  el.innerHTML = `<section class="card"><div class="table-wrap"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(dateTimeUS(r.created_at))}</td><td>${esc(r.user_name)}</td><td><code>${esc(r.action)}</code></td>
      <td>${esc(r.entity)}${r.entity_id ? ' #' + r.entity_id : ''}</td><td>${esc(r.detail || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No entries.</td></tr>'}
  </tbody></table></div></section>`;
}
