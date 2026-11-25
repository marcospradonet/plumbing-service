// User administration (US43).
import { api, closeModal, esc, modal, readForm, state, toast } from '../core.js';

export async function render(el, _params, page) {
  page.actions('<button class="btn btn-primary" id="new-user">+ New user</button>');
  document.getElementById('new-user').onclick = () => edit(null);
  let users = [];
  async function draw() {
    users = await api('/users');
    el.innerHTML = `<section class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th>Technician</th><th>2FA</th><th>Status</th></tr></thead><tbody>
      ${users.map((u) => `<tr class="clickable" data-id="${u.id}"><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(state.meta.roles[u.role])}</td>
        <td>${esc(u.technician_name || '—')}</td><td>${u.totp_enabled ? '<span class="tag ok">On</span>' : '<span class="tag">Off</span>'}</td>
        <td>${u.active ? '<span class="tag ok">Active</span>' : '<span class="tag">Inactive</span>'}</td></tr>`).join('')}
    </tbody></table></div></section>`;
    el.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => edit(users.find((u) => u.id === Number(r.dataset.id))));
  }
  function edit(u) {
    const m = modal({
      title: u ? `Edit ${u.name}` : 'New user',
      body: `<div class="form-grid">
        <label>Name<input name="name" value="${esc(u?.name || '')}"></label>
        <label>E-mail<input name="email" type="email" value="${esc(u?.email || '')}"></label>
        <label>Role<select name="role">${Object.entries(state.meta.roles).map(([k, v]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label data-tech>Technician profile<select name="technician_id"><option value="">—</option>${state.technicians.map((t) => `<option value="${t.id}" ${u?.technician_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label>${u ? 'New password (leave blank to keep)' : 'Password'}<input name="password" type="password" autocomplete="new-password" minlength="8"></label>
        <label class="check"><input type="checkbox" name="active" ${!u || u.active ? 'checked' : ''}> Active</label>
      </div><p class="form-error" role="alert"></p>`,
      actions: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    });
    const sync = () => { m.querySelector('[data-tech]').hidden = m.querySelector('[name=role]').value !== 'technician'; };
    m.querySelector('[name=role]').onchange = sync; sync();
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-save]').onclick = async () => {
      const b = readForm(m);
      if (!b.password) delete b.password;
      try { await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body: b }); closeModal(); toast('User saved.'); draw(); } catch (e) { m.querySelector('.form-error').textContent = e.message; }
    };
  }
  await draw();
}
