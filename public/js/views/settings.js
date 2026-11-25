// Business settings used by online booking, reminders and fees (US42).
import { api, esc, phoneFmt, readForm, state, toast } from '../core.js';

export async function render(el) {
  const s = await api('/settings');
  const f = (name, label, type = 'text', extra = '') => `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(s[name] ?? '')}" ${extra}></label>`;
  el.innerHTML = `<form class="stack" novalidate>
    <fieldset><legend>Business</legend><div class="form-grid">
      ${f('business_name', 'Business name')}
      <label>Office phone<input name="business_phone" type="tel" value="${esc(phoneFmt(s.business_phone))}"></label>
      <label>24/7 emergency phone<input name="emergency_phone" type="tel" value="${esc(phoneFmt(s.emergency_phone))}"></label>
      ${f('business_email', 'Office e-mail', 'email')}
      ${f('license_no', 'Contractor license # (shown to customers)')}
      <label class="wide">Address<input name="business_address" value="${esc(s.business_address)}"></label>
    </div></fieldset>
    <fieldset><legend>Online booking rules</legend><div class="form-grid">
      ${f('min_lead_hours', 'Minimum notice (hours)', 'number', 'min="0"')}
      ${f('booking_window_days', 'Bookable window (days ahead)', 'number', 'min="1" max="120"')}
      ${f('slot_step_min', 'Start times every (min)', 'number', 'min="15" step="15"')}
      ${f('arrival_window_min', 'Arrival window shown to customer (min)', 'number', 'min="0" step="15"')}
      ${f('cancel_cutoff_hours', 'Online cancel/reschedule cutoff (hours before)', 'number', 'min="0"')}
      <label>Emergency / after-hours fee (USD)<input name="emergency_fee" type="number" min="0" step="0.01" value="${(Number(s.emergency_fee_cents) / 100).toFixed(2)}"></label>
      <label class="wide">Closed days (holidays, hurricane closures) — YYYY-MM-DD separated by commas
        <input name="closed_days" value="${esc(s.closed_days)}" placeholder="2026-12-25, 2027-01-01"></label>
    </div></fieldset>
    <fieldset><legend>Customer messages</legend><div class="form-grid">
      ${f('reminder_hours', 'Send reminder (hours before visit)', 'number', 'min="1"')}
      ${f('sms_footer', 'SMS footer (opt-out notice)')}
      <p class="wide info-box">SMS delivery: <strong>${state.meta.sms_live ? 'Twilio (live)' : 'simulated'}</strong>. Set <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code> and <code>TWILIO_FROM</code> to send real texts. Texts are only sent to customers who opted in.</p>
    </div></fieldset>
    <p class="form-error" role="alert"></p>
    <div class="row row-end"><button class="btn btn-primary">Save settings</button></div>
  </form>`;
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = readForm(form);
    b.emergency_fee_cents = Math.round(Number(b.emergency_fee || 0) * 100);
    delete b.emergency_fee;
    form.querySelector('.form-error').textContent = '';
    try { state.settings = await api('/settings', { method: 'PUT', body: b }); toast('Settings saved.'); } catch (err) { form.querySelector('.form-error').textContent = err.message; }
  };
}
