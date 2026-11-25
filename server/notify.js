// Customer notifications: bilingual templates, outbox with retries, Twilio SMS (optional) and reminders.
import { readSettings } from './db.js';
import { events, getJob, logEvent } from './scheduling.js';
import { addMinutes, describeDate, fmtPhone, nowStr, time12 } from './util.js';

export const smsLive = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

function window(job, settings) {
  const end = addMinutes(job.starts_at, Number(settings.arrival_window_min || 120));
  return `${time12(job.starts_at)}–${time12(end)}`;
}

/** Builds {subject, text} for a job event in the customer's language. */
export function render(kind, job, settings) {
  const lang = ['es', 'pt'].includes(job.customer_language) ? job.customer_language : 'en';
  const biz = settings.business_name;
  const service = (lang === 'es' && job.service_name_es) || (lang === 'pt' && job.service_name_pt) || job.service_name;
  const day = describeDate(job.starts_at, lang);
  const when = `${day}, ${window(job, settings)}`;
  const addr = `${job.address1}${job.unit ? ' #' + job.unit : ''}, ${job.city}`;
  const phone = fmtPhone(settings.business_phone);
  const ref = job.ref;
  const tech = job.technician_name;
  const T = {
    en: {
      booked: [`Appointment booked ${ref}`, `${biz}: your ${service} appointment is set for ${when} (arrival window) at ${addr}. Ref ${ref}. Changes: ${phone}.`],
      rescheduled: [`Appointment rescheduled ${ref}`, `${biz}: appointment ${ref} was moved to ${when}. Questions: ${phone}.`],
      cancelled: [`Appointment cancelled ${ref}`, `${biz}: appointment ${ref} on ${day} was cancelled. To rebook: ${phone}.`],
      reminder: [`Reminder ${ref}`, `${biz}: reminder of your ${service} visit ${when} at ${addr}. Confirm or change with ref ${ref} on our website or call ${phone}.`],
      en_route: [`Technician on the way ${ref}`, `${biz}: ${tech} is on the way to ${addr}.`],
      completed: [`Service completed ${ref}`, `${biz}: thank you! Job ${ref} is complete. Your invoice will follow by e-mail.`],
    },
    es: {
      booked: [`Cita confirmada ${ref}`, `${biz}: su cita de ${service} está programada para ${when} (llegada) en ${addr}. Ref ${ref}. Para cambios: ${phone}.`],
      rescheduled: [`Cita reprogramada ${ref}`, `${biz}: su cita ${ref} fue reprogramada para ${when}. Preguntas: ${phone}.`],
      cancelled: [`Cita cancelada ${ref}`, `${biz}: su cita ${ref} del ${day} fue cancelada. Para reprogramar: ${phone}.`],
      reminder: [`Recordatorio ${ref}`, `${biz}: recordatorio de su cita de ${service} ${when} en ${addr}. Confirme o cambie con su ref ${ref} en nuestra web o al ${phone}.`],
      en_route: [`Técnico en camino ${ref}`, `${biz}: ${tech} va en camino a ${addr}.`],
      completed: [`Servicio completado ${ref}`, `${biz}: gracias, su servicio ${ref} fue completado. Le enviaremos la factura por correo.`],
    },
    pt: {
      booked: [`Agendamento confirmado ${ref}`, `${biz}: seu atendimento de ${service} está agendado para ${when} (janela de chegada) em ${addr}. Ref ${ref}. Alterações: ${phone}.`],
      rescheduled: [`Agendamento remarcado ${ref}`, `${biz}: o agendamento ${ref} foi remarcado para ${when}. Dúvidas: ${phone}.`],
      cancelled: [`Agendamento cancelado ${ref}`, `${biz}: o agendamento ${ref} de ${day} foi cancelado. Para remarcar: ${phone}.`],
      reminder: [`Lembrete ${ref}`, `${biz}: lembrete do seu atendimento de ${service} ${when} em ${addr}. Confirme ou altere com a ref ${ref} no nosso site ou pelo ${phone}.`],
      en_route: [`Técnico a caminho ${ref}`, `${biz}: ${tech} está a caminho de ${addr}.`],
      completed: [`Serviço concluído ${ref}`, `${biz}: obrigado! O serviço ${ref} foi concluído. A fatura será enviada por e-mail.`],
    },
  };
  const [subject, text] = T[lang][kind];
  return { subject, text };
}

/** Queues SMS (when opted in) and e-mail (when present). Returns number queued. */
export function queueForJob(db, job, kind) {
  const settings = readSettings(db);
  const { subject, text } = render(kind, job, settings);
  const ins = db.prepare(`INSERT INTO notifications (job_id, customer_id, channel, recipient, kind, subject, body, next_attempt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  if (job.sms_opt_in && job.customer_phone) {
    ins.run(job.id, job.customer_id, 'sms', job.customer_phone, kind, null, `${text} ${settings.sms_footer || ''}`.trim(), nowStr(), nowStr()); n++;
  }
  if (job.customer_email) {
    ins.run(job.id, job.customer_id, 'email', job.customer_email, kind, subject, text, nowStr(), nowStr()); n++;
  }
  if (n) logEvent(db, job.id, 'notified', `${kind}: ${n} message(s) queued`);
  return n;
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Twilio HTTP ${r.status}`);
  return j.sid;
}

/** Processes due messages. SMS goes to Twilio when configured; otherwise (and for e-mail) it is simulated. */
export async function processOutbox(db) {
  const due = db.prepare(`SELECT * FROM notifications WHERE status = 'pending' AND (next_attempt IS NULL OR next_attempt <= ?) ORDER BY id LIMIT 20`).all(nowStr());
  for (const m of due) {
    try {
      let providerId = null, status = 'simulated';
      if (m.channel === 'sms' && smsLive()) { providerId = await sendSms(m.recipient, m.body); status = 'sent'; }
      db.prepare('UPDATE notifications SET status = ?, attempts = attempts + 1, provider_id = ?, sent_at = ?, error = NULL WHERE id = ?')
        .run(status, providerId, nowStr(), m.id);
    } catch (e) {
      const attempts = m.attempts + 1;
      const failed = attempts >= 5;
      db.prepare('UPDATE notifications SET status = ?, attempts = ?, next_attempt = ?, error = ? WHERE id = ?')
        .run(failed ? 'failed' : 'pending', attempts, addMinutes(nowStr(), 2 ** attempts), String(e.message).slice(0, 300), m.id);
    }
  }
  return due.length;
}

/** Queues reminders for scheduled/confirmed jobs starting within reminder_hours. */
export function queueReminders(db) {
  const hours = Number(readSettings(db).reminder_hours || 24);
  const now = nowStr();
  const due = db.prepare(`SELECT id FROM jobs WHERE status IN ('scheduled','confirmed') AND reminder_sent = 0
      AND starts_at > ? AND starts_at <= ?`).all(now, addMinutes(now, hours * 60));
  for (const { id } of due) {
    db.prepare('UPDATE jobs SET reminder_sent = 1 WHERE id = ?').run(id);
    queueForJob(db, getJob(db, id), 'reminder');
  }
  return due.length;
}

let wired = false;
export function wireNotifications() {
  if (wired) return;
  wired = true;
  events.on('job:changed', ({ db, job, kind, notify }) => {
    if (notify === false) return;
    if (kind === 'booked' && job.status === 'requested') return; // nothing to tell until dispatched
    queueForJob(db, job, kind);
  });
}

export function startScheduler(db) {
  const tick = async () => {
    try { queueReminders(db); await processOutbox(db); } catch (e) { console.error('scheduler:', e); }
  };
  tick();
  return setInterval(tick, 30_000);
}
