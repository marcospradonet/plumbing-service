// Services catalog and service area ZIP codes (US41).
import { api, closeModal, esc, modal, money, PRICE_TYPES, readForm, reloadRefs, showError, state, toast } from '../core.js';

export async function render(el, _params, page) {
  page.actions('<button class="btn btn-primary" id="new-svc">+ New service</button>');
  document.getElementById('new-svc').onclick = () => edit(null);

  async function draw() {
    const areas = await api('/service-areas');
    el.innerHTML = `<div class="stack">
    <section class="card"><header><h2>Services</h2></header><div class="table-wrap"><table><thead><tr><th>Service</th><th>Category</th><th class="num">Duration</th><th>Pricing</th><th>Online booking</th><th></th></tr></thead><tbody>
      ${state.services.map((s) => `<tr class="clickable" data-id="${s.id}" style="${s.active ? '' : 'opacity:.55'}">
        <td><strong>${esc(s.name)}</strong>${s.name_es ? `<br><small lang="es">${esc(s.name_es)}</small>` : ''}</td>
        <td>${esc(state.meta.categories?.[s.category] || s.category)}</td><td class="num">${s.duration_min} min</td>
        <td>${esc(PRICE_TYPES[s.price_type])}${s.price_type !== 'estimate' ? ` · ${money(s.base_price_cents)}${s.price_type === 'hourly' ? '/h' : ''}` : ''}</td>
        <td>${s.online ? '<span class="tag ok">Yes</span>' : '<span class="tag">Office only</span>'}</td><td>${s.active ? '' : '<span class="tag">Inactive</span>'}</td></tr>`).join('')}
    </tbody></table></div></section>
    <section class="card"><header><h2>Service area · ${areas.filter((a) => a.active).length} active ZIP codes</h2>
      <form class="row" data-zip-form novalidate><input name="zip" placeholder="ZIP" maxlength="5" inputmode="numeric" style="width:90px" aria-label="ZIP"><input name="city" placeholder="City / neighborhood" style="width:200px" aria-label="City"><button class="btn btn-sm">Add ZIP</button></form></header>
      <div class="card-body chips">${areas.map((a) => `<label class="check" title="${esc(a.city)}"><input type="checkbox" data-zip="${a.zip}" ${a.active ? 'checked' : ''}> <span><strong>${a.zip}</strong> <small>${esc(a.city)}</small></span></label>`).join('')}</div>
    </section></div>`;
    el.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => edit(state.services.find((s) => s.id === Number(r.dataset.id))));
    el.querySelectorAll('[data-zip]').forEach((c) => c.onchange = async () => {
      try { await api(`/service-areas/${c.dataset.zip}`, { method: 'PUT', body: { active: c.checked } }); toast(`ZIP ${c.dataset.zip} ${c.checked ? 'enabled' : 'disabled'}.`); } catch (e) { showError(e); }
    });
    const zf = el.querySelector('[data-zip-form]');
    zf.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/service-areas', { method: 'POST', body: readForm(zf) }); toast('ZIP added.'); draw(); } catch (err) { showError(err); }
    };
  }

  function edit(s) {
    const m = modal({
      title: s ? `Edit ${s.name}` : 'New service', wide: true,
      body: `<div class="form-grid">
        <label>Name (English)<input name="name" value="${esc(s?.name || '')}" required></label>
        <label>Name (Spanish)<input name="name_es" lang="es" value="${esc(s?.name_es || '')}"></label>
        <label>Category / required skill<select name="category">${Object.entries(state.meta.categories || {}).map(([k, v]) => `<option value="${k}" ${s?.category === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Duration (min)<input name="duration_min" type="number" min="15" step="15" value="${s?.duration_min ?? 60}"></label>
        <label>Pricing<select name="price_type">${Object.entries(PRICE_TYPES).map(([k, v]) => `<option value="${k}" ${s?.price_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Price (USD)<input name="price" type="number" min="0" step="0.01" value="${s ? (s.base_price_cents / 100).toFixed(2) : '0.00'}"></label>
        <label class="wide">Description shown to customers<textarea name="description">${esc(s?.description || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="online" ${!s || s.online ? 'checked' : ''}> Bookable online</label>
        ${s ? `<label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active</label>` : ''}
      </div><p class="form-error" role="alert"></p>`,
      actions: '<button class="btn" data-x>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
    });
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('[data-save]').onclick = async () => {
      const b = readForm(m);
      b.base_price_cents = Math.round(Number(b.price || 0) * 100);
      if (!s) b.active = true;
      try {
        await api(s ? `/services/${s.id}` : '/services', { method: s ? 'PUT' : 'POST', body: b });
        closeModal(); toast('Service saved.');
        await reloadRefs(); draw();
      } catch (e) { m.querySelector('.form-error').textContent = e.message; }
    };
  }
  await draw();
}
