// My account: password and optional two-factor authentication.
import { api, esc, readForm, state, toast } from '../core.js';

export async function render(el) {
  const u = state.user;
  el.innerHTML = `<div class="grid-2">
    <section class="card"><header><h2>${esc(u.name)}</h2></header><div class="card-body"><dl class="data">
      <dt>E-mail</dt><dd>${esc(u.email)}</dd><dt>Role</dt><dd>${esc(u.role_name)}</dd>
      ${u.technician ? `<dt>License</dt><dd>${esc(u.technician.license_no || '—')}</dd>` : ''}</dl></div></section>
    <section class="card"><header><h2>Change password</h2></header><form class="card-body stack" data-pw novalidate>
      <label>Current password<input name="current" type="password" autocomplete="current-password"></label>
      <label>New password (min. 8 characters)<input name="next" type="password" autocomplete="new-password"></label>
      <p class="form-error" role="alert"></p><div class="row row-end"><button class="btn btn-primary">Change password</button></div></form></section>
    <section class="card"><header><h2>Two-factor authentication</h2></header><div class="card-body stack" data-2fa></div></section>
  </div>`;
  const pw = el.querySelector('[data-pw]');
  pw.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/auth/password', { method: 'POST', body: readForm(pw) }); pw.reset(); toast('Password changed.'); } catch (err) { pw.querySelector('.form-error').textContent = err.message; }
  };
  const box = el.querySelector('[data-2fa]');
  const draw = () => {
    if (state.user.totp_enabled) {
      box.innerHTML = '<p><span class="tag ok">Enabled</span> A code from your authenticator app is required at sign-in.</p><div><button class="btn btn-danger" data-off>Disable</button></div>';
      box.querySelector('[data-off]').onclick = async () => { await api('/auth/2fa/disable', { method: 'POST' }); state.user.totp_enabled = 0; toast('Two-factor disabled.'); draw(); };
    } else {
      box.innerHTML = '<p>Protect your account with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</p><div><button class="btn" data-start>Set up</button></div>';
      box.querySelector('[data-start]').onclick = async () => {
        const r = await api('/auth/2fa/start', { method: 'POST' });
        box.innerHTML = `<p>Add this key to your app (manual entry, time-based):</p><p><code style="font-size:15px;letter-spacing:1px">${esc(r.secret)}</code></p>
          <label>Enter the 6-digit code to confirm<input name="code" inputmode="numeric" maxlength="6"></label><p class="form-error"></p>
          <div><button class="btn btn-primary" data-enable>Enable</button></div>`;
        box.querySelector('[data-enable]').onclick = async () => {
          try { await api('/auth/2fa/enable', { method: 'POST', body: { code: box.querySelector('[name=code]').value } }); state.user.totp_enabled = 1; toast('Two-factor enabled.'); draw(); } catch (e) { box.querySelector('.form-error').textContent = e.message; }
        };
      };
    }
  };
  draw();
}
