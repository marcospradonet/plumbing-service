// Public online booking (EP01), English / Spanish. Steps: ZIP → service → time → details → confirmation.
// "Manage my booking": reference + phone → confirm, reschedule or cancel (until the cutoff).
import { api, esc, LOGO, money, phoneFmt, readForm, toast } from './core.js';

const T = {
  en: {
    tagline: 'Licensed & insured plumbers · Miami-Dade', emergency: 'Water emergency? Burst pipe or sewage backup? Call 24/7:',
    book: 'Book a visit', manage: 'Manage my booking',
    steps: ['Location', 'Service', 'Time', 'Your details', 'Done'],
    zipTitle: 'Where do you need a plumber?', zipLabel: 'ZIP code of the property', next: 'Continue', back: 'Back',
    zipNo: (p) => `Sorry, we do not serve this ZIP code online yet. Please call ${p}.`, zipYes: (c) => `Great — we serve ${c}.`,
    svcTitle: 'What do you need?', flat: 'Flat rate', hourly: 'per hour', estimate: 'Free estimate', from: 'from',
    timeTitle: 'Pick a day and an arrival window', arrival: 'Technician arrives between', noSlots: 'No online availability in the coming days. Please call us.',
    detailsTitle: 'Your details', residential: 'Home', commercial: 'Business / building',
    company: 'Business or association name', name: 'Your name', phone: 'Mobile phone', email: 'E-mail (for confirmation and invoice)',
    address: 'Street address', unit: 'Apt / unit / suite', city: 'City', propType: 'Property type', units: 'Number of units (buildings)',
    access: 'Access notes (gate code, parking, pets)', problem: 'Describe the problem', problemPh: 'e.g. kitchen sink is clogged and water backs up into the dishwasher',
    urgent: 'This is urgent (active leak, no water) — we will try to prioritize', sms: 'Text me appointment updates (SMS). Msg & data rates may apply. Reply STOP to opt out.',
    confirmBtn: 'Book appointment', summary: 'Summary',
    doneTitle: 'You are booked!', doneRef: 'Your booking reference', doneText: 'We sent a confirmation. Keep your reference to confirm, reschedule or cancel online.',
    another: 'Book another visit',
    manageTitle: 'Find your booking', ref: 'Booking reference (e.g. PL-AB12CD)', find: 'Find booking',
    status: { requested: 'Request received', scheduled: 'Scheduled', confirmed: 'Confirmed', en_route: 'Technician on the way', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', no_access: 'Missed visit' },
    confirmVisit: 'Confirm visit', reschedule: 'Reschedule', cancel: 'Cancel booking', cancelReason: 'Reason (optional)',
    cancelSure: 'Cancel this booking?', cutoff: (h) => `Online changes close ${h} hours before the visit. Please call us for changes.`,
    pickNew: 'Pick a new time', save: 'Save new time', tech: 'Technician',
    license: 'FL License', changed: 'Booking updated.',
  },
  es: {
    tagline: 'Plomeros con licencia y seguro · Miami-Dade', emergency: '¿Emergencia? ¿Tubería rota o aguas negras? Llame 24/7:',
    book: 'Reservar visita', manage: 'Administrar mi cita',
    steps: ['Ubicación', 'Servicio', 'Horario', 'Sus datos', 'Listo'],
    zipTitle: '¿Dónde necesita un plomero?', zipLabel: 'Código postal (ZIP) de la propiedad', next: 'Continuar', back: 'Atrás',
    zipNo: (p) => `Lo sentimos, aún no atendemos este código postal en línea. Llame al ${p}.`, zipYes: (c) => `¡Perfecto! Atendemos ${c}.`,
    svcTitle: '¿Qué necesita?', flat: 'Precio fijo', hourly: 'por hora', estimate: 'Estimado gratis', from: 'desde',
    timeTitle: 'Elija el día y la ventana de llegada', arrival: 'El técnico llega entre', noSlots: 'No hay disponibilidad en línea en los próximos días. Por favor llámenos.',
    detailsTitle: 'Sus datos', residential: 'Casa', commercial: 'Negocio / edificio',
    company: 'Nombre del negocio o asociación', name: 'Su nombre', phone: 'Teléfono celular', email: 'Correo (confirmación y factura)',
    address: 'Dirección', unit: 'Apto / unidad / local', city: 'Ciudad', propType: 'Tipo de propiedad', units: 'Número de unidades (edificios)',
    access: 'Notas de acceso (código de portón, parqueo, mascotas)', problem: 'Describa el problema', problemPh: 'ej. el fregadero está tapado y el agua regresa al lavaplatos',
    urgent: 'Es urgente (fuga activa, sin agua) — intentaremos darle prioridad', sms: 'Envíenme avisos de la cita por mensaje de texto (SMS). Pueden aplicar tarifas. Responda STOP para cancelar.',
    confirmBtn: 'Reservar cita', summary: 'Resumen',
    doneTitle: '¡Su cita está reservada!', doneRef: 'Su número de referencia', doneText: 'Le enviamos una confirmación. Guarde su referencia para confirmar, cambiar o cancelar en línea.',
    another: 'Reservar otra visita',
    manageTitle: 'Buscar su cita', ref: 'Referencia (ej. PL-AB12CD)', find: 'Buscar cita',
    status: { requested: 'Solicitud recibida', scheduled: 'Programada', confirmed: 'Confirmada', en_route: 'Técnico en camino', in_progress: 'En progreso', completed: 'Completada', cancelled: 'Cancelada', no_access: 'Visita perdida' },
    confirmVisit: 'Confirmar visita', reschedule: 'Cambiar horario', cancel: 'Cancelar cita', cancelReason: 'Motivo (opcional)',
    cancelSure: '¿Cancelar esta cita?', cutoff: (h) => `Los cambios en línea cierran ${h} horas antes de la visita. Llámenos para cambios.`,
    pickNew: 'Elija un nuevo horario', save: 'Guardar nuevo horario', tech: 'Técnico',
    license: 'Licencia FL', changed: 'Cita actualizada.',
  },
  pt: {
    tagline: 'Encanadores licenciados e segurados · Miami-Dade', emergency: 'Emergência? Cano estourado ou retorno de esgoto? Ligue 24h:',
    book: 'Agendar visita', manage: 'Gerenciar meu agendamento',
    steps: ['Local', 'Serviço', 'Horário', 'Seus dados', 'Pronto'],
    zipTitle: 'Onde você precisa de um encanador?', zipLabel: 'CEP (ZIP code) do imóvel', next: 'Continuar', back: 'Voltar',
    zipNo: (p) => `Desculpe, ainda não atendemos este CEP pelo site. Ligue para ${p}.`, zipYes: (c) => `Ótimo! Atendemos ${c}.`,
    svcTitle: 'Do que você precisa?', flat: 'Preço fixo', hourly: 'por hora', estimate: 'Orçamento grátis', from: 'a partir de',
    timeTitle: 'Escolha o dia e a janela de chegada', arrival: 'O técnico chega entre', noSlots: 'Não há horários disponíveis pelo site nos próximos dias. Por favor, ligue para nós.',
    detailsTitle: 'Seus dados', residential: 'Residência', commercial: 'Empresa / prédio',
    company: 'Nome da empresa ou do condomínio', name: 'Seu nome', phone: 'Celular (número dos EUA)', email: 'E-mail (para confirmação e fatura)',
    address: 'Endereço', unit: 'Apto / unidade / sala', city: 'Cidade', propType: 'Tipo de imóvel', units: 'Número de unidades (prédios)',
    access: 'Observações de acesso (código do portão, estacionamento, animais)', problem: 'Descreva o problema', problemPh: 'ex.: a pia da cozinha está entupida e a água volta pela máquina de lavar louça',
    urgent: 'É urgente (vazamento ativo, falta de água) — vamos tentar priorizar', sms: 'Quero receber avisos do agendamento por SMS. Podem ser cobradas tarifas da operadora. Responda STOP para cancelar.',
    confirmBtn: 'Confirmar agendamento', summary: 'Resumo',
    doneTitle: 'Agendamento confirmado!', doneRef: 'Seu número de referência', doneText: 'Enviamos uma confirmação. Guarde sua referência para confirmar, remarcar ou cancelar pelo site.',
    another: 'Agendar outra visita',
    manageTitle: 'Encontre seu agendamento', ref: 'Referência (ex.: PL-AB12CD)', find: 'Buscar agendamento',
    status: { requested: 'Solicitação recebida', scheduled: 'Agendado', confirmed: 'Confirmado', en_route: 'Técnico a caminho', in_progress: 'Em andamento', completed: 'Concluído', cancelled: 'Cancelado', no_access: 'Visita perdida' },
    confirmVisit: 'Confirmar visita', reschedule: 'Remarcar', cancel: 'Cancelar agendamento', cancelReason: 'Motivo (opcional)',
    cancelSure: 'Cancelar este agendamento?', cutoff: (h) => `Alterações pelo site são encerradas ${h} horas antes da visita. Ligue para nós para alterar.`,
    pickNew: 'Escolha um novo horário', save: 'Salvar novo horário', tech: 'Técnico',
    license: 'Licença FL', changed: 'Agendamento atualizado.',
  },
};
const PROPS = {
  es: { single_family: 'Casa unifamiliar', townhouse: 'Townhouse', condo: 'Condominio / apartamento', small_multifamily: 'Edificio multifamiliar pequeño', small_commercial: 'Local comercial pequeño' },
  pt: { single_family: 'Casa', townhouse: 'Sobrado (townhouse)', condo: 'Apartamento / condomínio', small_multifamily: 'Prédio residencial pequeno', small_commercial: 'Imóvel comercial pequeno' },
};

const DAY = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
};
const MON = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
};
const parse = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13) || 0, +s.slice(14, 16) || 0);
const t12 = (s) => { const h = +s.slice(11, 13), m = s.slice(14, 16); return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`; };
const plus = (s, min) => { const d = parse(s); d.setMinutes(d.getMinutes() + min); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const st = {
  lang: ['en', 'es', 'pt'].includes(localStorage.getItem('lang')) ? localStorage.getItem('lang')
    : (['es', 'pt'].find((l) => navigator.language?.startsWith(l)) || 'en'),
  tab: 'book', step: 0, info: null, zip: '', city: '', services: [], service: null, slots: [], day: null, slot: null, details: {}, done: null,
  manage: null, managePhone: '',
};
const L = () => T[st.lang];
const root = document.getElementById('book');
const dateLabel = (s) => {
  const d = parse(s);
  if (st.lang === 'es') return `${DAY.es[d.getDay()]} ${d.getDate()} ${MON.es[d.getMonth()]}`;
  if (st.lang === 'pt') return `${DAY.pt[d.getDay()]}, ${d.getDate()} de ${MON.pt[d.getMonth()]}`;
  return `${DAY.en[d.getDay()]}, ${MON.en[d.getMonth()]} ${d.getDate()}`;
};
const windowLabel = (s) => `${t12(s)} – ${t12(plus(s, st.info.arrival_window_min))}`;
const svcName = (s) => (st.lang !== 'en' && (s[`service_name_${st.lang}`] || s[`name_${st.lang}`])) || s.service_name || s.name;
const svcDesc = (s) => (st.lang !== 'en' && s[`description_${st.lang}`]) || s.description || '';
const priceLabel = (s) => s.price_type === 'estimate' ? L().estimate
  : s.price_type === 'hourly' ? `${money(s.base_price_cents)} ${L().hourly}` : `${L().flat} · ${money(s.base_price_cents)}`;

function chrome() {
  document.documentElement.lang = st.lang === 'pt' ? 'pt-BR' : st.lang;
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === st.lang));
  document.getElementById('tagline').textContent = L().tagline;
  const em = st.info.emergency_phone;
  document.getElementById('emergency').innerHTML = `${esc(L().emergency)} <a href="tel:${esc(em)}">${esc(phoneFmt(em))}</a>`;
  document.getElementById('foot').innerHTML = `${esc(st.info.business_name)} · ${esc(L().license)} ${esc(st.info.license_no)} · <a href="tel:${esc(st.info.business_phone)}">${esc(phoneFmt(st.info.business_phone))}</a> · ${esc(st.info.business_email)}`;
  document.title = `${L().book} · ${st.info.business_name}`;
}

function draw() {
  chrome();
  const tabs = `<div class="book-tabs" role="tablist"><button role="tab" data-tab="book" class="${st.tab === 'book' ? 'active' : ''}">${esc(L().book)}</button>
    <button role="tab" data-tab="manage" class="${st.tab === 'manage' ? 'active' : ''}">${esc(L().manage)}</button></div>`;
  root.innerHTML = tabs + (st.tab === 'book' ? bookView() : manageView());
  root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { st.tab = b.dataset.tab; draw(); });
  (st.tab === 'book' ? wireBook : wireManage)();
  root.querySelector('.panel input:not([type=checkbox]):not([type=radio]), .panel textarea')?.focus({ preventScroll: true });
}

const stepsBar = () => `<div class="steps" aria-label="Progress">${L().steps.map((s, i) => `<span class="${i === st.step ? 'on' : i < st.step ? 'done' : ''}">${i + 1}. ${esc(s)}</span>`).join('')}</div>`;

function daysAndTimes(slots, selected) {
  const days = [...new Set(slots.map((s) => s.starts_at.slice(0, 10)))];
  if (!days.length) return `<p class="warn-box">${esc(L().noSlots)} <a href="tel:${esc(st.info.business_phone)}">${esc(phoneFmt(st.info.business_phone))}</a></p>`;
  if (!st.day || !days.includes(st.day)) st.day = days[0];
  return `<div class="days" role="listbox" aria-label="Day">${days.map((d) => { const x = parse(d + 'T00:00'); return `<button type="button" class="day ${d === st.day ? 'active' : ''}" data-day="${d}"><small>${DAY[st.lang][x.getDay()]}</small><strong>${x.getDate()}</strong><small>${MON[st.lang][x.getMonth()]}</small></button>`; }).join('')}</div>
    <p class="muted">${esc(L().arrival)}:</p>
    <div class="times">${slots.filter((s) => s.starts_at.startsWith(st.day)).map((s) => `<button type="button" data-slot="${s.starts_at}" class="${selected === s.starts_at ? 'active' : ''}">${windowLabel(s.starts_at)}</button>`).join('')}</div>`;
}

function bookView() {
  const l = L();
  if (st.step === 0) {
    return `${stepsBar()}<form class="panel" data-zip novalidate><h1>${esc(l.zipTitle)}</h1>
      <label>${esc(l.zipLabel)}<div class="zip-row"><input name="zip" inputmode="numeric" maxlength="5" autocomplete="postal-code" value="${esc(st.zip)}" required><button class="btn btn-primary">${esc(l.next)}</button></div></label>
      <p class="form-error" role="alert"></p></form>`;
  }
  if (st.step === 1) {
    return `${stepsBar()}<div class="panel"><p class="info-box">${esc(l.zipYes(`${st.city} (${st.zip})`))}</p><h1>${esc(l.svcTitle)}</h1>
      <div class="choices">${st.services.map((s) => `<button type="button" class="choice ${st.service?.id === s.id ? 'active' : ''}" data-svc="${s.id}">
        <strong>${esc(svcName(s))}</strong><small>${esc(svcDesc(s))}</small><span class="price">${esc(priceLabel(s))}</span></button>`).join('')}</div>
      <div class="row"><button class="btn" data-back>${esc(l.back)}</button></div></div>`;
  }
  if (st.step === 2) {
    return `${stepsBar()}<div class="panel"><h1>${esc(l.timeTitle)}</h1><p><strong>${esc(svcName(st.service))}</strong> · ${esc(priceLabel(st.service))}</p>
      ${daysAndTimes(st.slots, st.slot)}
      <div class="row"><button class="btn" data-back>${esc(l.back)}</button><button class="btn btn-primary" data-next ${st.slot ? '' : 'disabled'}>${esc(l.next)}</button></div></div>`;
  }
  if (st.step === 3) {
    const d = st.details;
    const types = st.info.property_types;
    return `${stepsBar()}<form class="panel" data-details novalidate><h1>${esc(l.detailsTitle)}</h1>
      <div class="summary"><strong>${esc(svcName(st.service))}</strong> · ${esc(dateLabel(st.slot))}, ${esc(windowLabel(st.slot))}</div>
      <div class="row" role="radiogroup"><label class="check"><input type="radio" name="type" value="residential" ${d.type !== 'commercial' ? 'checked' : ''}> ${esc(l.residential)}</label>
        <label class="check"><input type="radio" name="type" value="commercial" ${d.type === 'commercial' ? 'checked' : ''}> ${esc(l.commercial)}</label></div>
      <div class="form-grid">
        <label class="wide" data-company>${esc(l.company)}<input name="company" value="${esc(d.company || '')}" autocomplete="organization"></label>
        <label>${esc(l.name)}<input name="name" value="${esc(d.name || '')}" autocomplete="name" required></label>
        <label>${esc(l.phone)}<input name="phone" type="tel" value="${esc(d.phone || '')}" placeholder="(305) 555-0123" autocomplete="tel-national" required></label>
        <label class="wide">${esc(l.email)}<input name="email" type="email" value="${esc(d.email || '')}" autocomplete="email"></label>
        <label class="wide">${esc(l.address)}<input name="address1" value="${esc(d.address1 || '')}" autocomplete="address-line1" required></label>
        <label>${esc(l.unit)}<input name="unit" value="${esc(d.unit || '')}" autocomplete="address-line2"></label>
        <label>${esc(l.city)}<input name="city" value="${esc(d.city || st.city.replace(/ \(.*\)$/, ''))}" autocomplete="address-level2" required></label>
        <label>${esc(l.propType)}<select name="property_type">${Object.entries(types).map(([k, v]) => `<option value="${k}" ${d.property_type === k ? 'selected' : ''}>${esc(PROPS[st.lang]?.[k] || v)}</option>`).join('')}</select></label>
        <label data-units>${esc(l.units)}<input name="units_count" type="number" min="1" value="${esc(d.units_count || '')}"></label>
        <label class="wide">${esc(l.access)}<input name="access_notes" value="${esc(d.access_notes || '')}"></label>
        <label class="wide">${esc(l.problem)}<textarea name="problem" placeholder="${esc(l.problemPh)}" required>${esc(d.problem || '')}</textarea></label>
        <label class="check wide"><input type="checkbox" name="urgent" ${d.urgent ? 'checked' : ''}> ${esc(l.urgent)}</label>
        <label class="check wide"><input type="checkbox" name="sms_opt_in" ${d.sms_opt_in !== false ? 'checked' : ''}> ${esc(l.sms)}</label>
      </div>
      <p class="form-error" role="alert"></p>
      <div class="row"><button type="button" class="btn" data-back>${esc(l.back)}</button><button class="btn btn-primary">${esc(l.confirmBtn)}</button></div></form>`;
  }
  const j = st.done;
  return `${stepsBar()}<div class="panel" style="text-align:center"><h1>✅ ${esc(l.doneTitle)}</h1>
    <p>${esc(l.doneRef)}</p><p class="big-ref">${esc(j.ref)}</p>
    <div class="summary" style="text-align:left"><strong>${esc(svcName(j))}</strong><br>${esc(dateLabel(j.starts_at))} · ${esc(l.arrival)} ${esc(windowLabel(j.starts_at))}<br>${esc(j.address)}${j.technician ? `<br>${esc(l.tech)}: ${esc(j.technician)}` : ''}</div>
    <p class="muted">${esc(l.doneText)}</p>
    <div class="row" style="justify-content:center"><button class="btn" data-again>${esc(l.another)}</button><button class="btn" data-goto-manage>${esc(l.manage)}</button></div></div>`;
}

function wireBook() {
  root.querySelector('[data-back]')?.addEventListener('click', () => { st.step--; draw(); });
  const zf = root.querySelector('[data-zip]');
  if (zf) zf.onsubmit = async (e) => {
    e.preventDefault();
    const zip = zf.zip.value.trim();
    try {
      const r = await api(`/public/zip/${encodeURIComponent(zip)}`);
      if (!r.served) { zf.querySelector('.form-error').textContent = L().zipNo(phoneFmt(st.info.business_phone)); return; }
      Object.assign(st, { zip, city: r.city, step: 1 });
      st.details.zip = zip;
      if (!st.services.length) st.services = await api('/public/services');
      draw();
    } catch (err) { zf.querySelector('.form-error').textContent = err.message; }
  };
  root.querySelectorAll('[data-svc]').forEach((b) => b.onclick = async () => {
    st.service = st.services.find((s) => s.id === Number(b.dataset.svc));
    st.slot = null; st.day = null;
    try { st.slots = await api(`/public/slots?service_id=${st.service.id}`); st.step = 2; draw(); } catch (e) { toast(e.message, 'error'); }
  });
  root.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { st.day = b.dataset.day; st.slot = null; draw(); });
  root.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => { st.slot = b.dataset.slot; draw(); root.querySelector('[data-next]')?.focus(); });
  root.querySelector('[data-next]')?.addEventListener('click', () => { st.step = 3; draw(); });
  const df = root.querySelector('[data-details]');
  if (df) {
    const sync = () => {
      const com = df.querySelector('[name=type]:checked').value === 'commercial';
      df.querySelector('[data-company]').hidden = !com;
      df.querySelector('[data-units]').hidden = !['small_multifamily', 'small_commercial'].includes(df.property_type.value);
    };
    df.addEventListener('change', sync); sync();
    df.addEventListener('input', () => { st.details = { ...st.details, ...readForm(df) }; });
    df.onsubmit = async (e) => {
      e.preventDefault();
      const f = readForm(df);
      st.details = { ...st.details, ...f };
      const btn = df.querySelector('.btn-primary');
      btn.disabled = true;
      try {
        st.done = await api('/public/bookings', {
          method: 'POST',
          body: {
            service_id: st.service.id, starts_at: st.slot, problem: f.problem, urgent: f.urgent,
            customer: { type: f.type, name: f.name, company: f.company, phone: f.phone, email: f.email, language: st.lang, sms_opt_in: f.sms_opt_in },
            property: { address1: f.address1, unit: f.unit, city: f.city, zip: st.zip, property_type: f.property_type, units_count: f.units_count || null, access_notes: f.access_notes },
          },
        });
        st.managePhone = f.phone;
        st.step = 4; draw();
      } catch (err) {
        df.querySelector('.form-error').textContent = err.message;
        if (/taken/.test(err.message)) { st.slots = await api(`/public/slots?service_id=${st.service.id}`); }
      } finally { btn.disabled = false; }
    };
  }
  root.querySelector('[data-again]')?.addEventListener('click', () => { Object.assign(st, { step: 0, service: null, slot: null, done: null }); draw(); });
  root.querySelector('[data-goto-manage]')?.addEventListener('click', () => { st.manage = null; st.prefRef = st.done.ref; st.tab = 'manage'; draw(); });
}

function manageView() {
  const l = L();
  const j = st.manage;
  if (!j) {
    return `<form class="panel" data-lookup novalidate><h1>${esc(l.manageTitle)}</h1><div class="form-grid">
      <label>${esc(l.ref)}<input name="ref" value="${esc(st.prefRef || '')}" autocapitalize="characters" required></label>
      <label>${esc(l.phone)}<input name="phone" type="tel" value="${esc(st.managePhone)}" required></label></div>
      <p class="form-error" role="alert"></p><div class="row"><button class="btn btn-primary">${esc(l.find)}</button></div></form>`;
  }
  return `<div class="panel"><h1>${esc(j.ref)} · <span class="tag st st-${esc(j.status)}">${esc(l.status[j.status])}</span></h1>
    <div class="summary"><strong>${esc(svcName(j))}</strong><br>${esc(dateLabel(j.starts_at))} · ${esc(l.arrival)} ${esc(windowLabel(j.starts_at))}<br>${esc(j.address)}${j.technician ? `<br>${esc(l.tech)}: ${esc(j.technician)}` : ''}</div>
    ${j.can_change ? `<div class="row">${j.can_confirm ? `<button class="btn btn-primary" data-confirm>${esc(l.confirmVisit)}</button>` : ''}
      <button class="btn" data-resched>${esc(l.reschedule)}</button><button class="btn btn-danger" data-cancel>${esc(l.cancel)}</button></div>`
    : (['scheduled', 'confirmed', 'requested'].includes(j.status) ? `<p class="warn-box">${esc(l.cutoff(st.info.cancel_cutoff_hours))} <a href="tel:${esc(st.info.business_phone)}">${esc(phoneFmt(st.info.business_phone))}</a></p>` : '')}
    <div data-resched-box></div><div class="row"><button class="btn btn-ghost" data-other>${esc(l.back)}</button></div></div>`;
}

function wireManage() {
  const lf = root.querySelector('[data-lookup]');
  const phone = () => st.managePhone;
  if (lf) lf.onsubmit = async (e) => {
    e.preventDefault();
    const f = readForm(lf);
    try { st.manage = await api('/public/lookup', { method: 'POST', body: f }); st.managePhone = f.phone; draw(); } catch (err) { lf.querySelector('.form-error').textContent = err.message; }
  };
  root.querySelector('[data-other]')?.addEventListener('click', () => { st.manage = null; draw(); });
  root.querySelector('[data-confirm]')?.addEventListener('click', async () => {
    try { st.manage = await api(`/public/bookings/${st.manage.ref}/confirm`, { method: 'POST', body: { phone: phone() } }); toast(L().changed); draw(); } catch (e) { toast(e.message, 'error'); }
  });
  root.querySelector('[data-cancel]')?.addEventListener('click', () => {
    const box = root.querySelector('[data-resched-box]');
    box.innerHTML = `<div class="summary stack"><strong>${esc(L().cancelSure)}</strong><label>${esc(L().cancelReason)}<input name="reason"></label>
      <div class="row"><button class="btn btn-danger" data-do-cancel>${esc(L().cancel)}</button></div></div>`;
    box.querySelector('[data-do-cancel]').onclick = async () => {
      try { st.manage = await api(`/public/bookings/${st.manage.ref}/cancel`, { method: 'POST', body: { phone: phone(), reason: box.querySelector('[name=reason]').value } }); toast(L().changed); draw(); } catch (e) { toast(e.message, 'error'); }
    };
  });
  root.querySelector('[data-resched]')?.addEventListener('click', async () => {
    const box = root.querySelector('[data-resched-box]');
    let slots, chosen = null;
    try { slots = await api(`/public/slots?service_id=${st.manage.service_id}`); } catch (e) { return toast(e.message, 'error'); }
    st.day = null;
    const paint = () => {
      box.innerHTML = `<div class="stack"><h2>${esc(L().pickNew)}</h2>${daysAndTimes(slots, chosen)}<div class="row"><button class="btn btn-primary" data-save ${chosen ? '' : 'disabled'}>${esc(L().save)}</button></div></div>`;
      box.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { st.day = b.dataset.day; chosen = null; paint(); });
      box.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => { chosen = b.dataset.slot; paint(); });
      box.querySelector('[data-save]').onclick = async () => {
        try { st.manage = await api(`/public/bookings/${st.manage.ref}/reschedule`, { method: 'POST', body: { phone: phone(), starts_at: chosen } }); toast(L().changed); draw(); } catch (e) { toast(e.message, 'error'); }
      };
    };
    paint();
  });
}

document.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { st.lang = b.dataset.lang; localStorage.setItem('lang', st.lang); draw(); });
document.getElementById('logo').innerHTML = LOGO;
try {
  st.info = await api('/public/info');
  document.getElementById('biz').textContent = st.info.business_name;
  draw();
} catch (e) {
  root.innerHTML = `<div class="panel"><p class="form-error">${esc(e.message)}</p></div>`;
}
