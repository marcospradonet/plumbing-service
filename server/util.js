// General utilities: clock, local date-times, validation and HTTP errors.
// Date-times are stored as local wall-clock text "YYYY-MM-DDTHH:MM" in the business time zone
// (America/New_York by default — see index.js, which sets process.env.TZ).

let fixedNow = null;
export const clock = {
  now: () => (fixedNow ? new Date(fixedNow) : new Date()),
  fix: (d) => { fixedNow = d ? new Date(d) : null; },
};

const p2 = (n) => String(n).padStart(2, '0');

export function fmtDateTime(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function fmtDate(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
export function parseDateTime(s) {
  const [date, time = '00:00'] = String(s).split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm || 0, 0, 0);
}
export function addMinutes(s, min) {
  const d = parseDateTime(s);
  d.setMinutes(d.getMinutes() + min);
  return fmtDateTime(d);
}
export function nowStr() {
  return fmtDateTime(clock.now());
}
export function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function hhmm(min) {
  return `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;
}
export function minutesBetween(a, b) {
  return Math.round((parseDateTime(b) - parseDateTime(a)) / 60000);
}

const DAYS = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] };
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};
/** "9:30 AM" */
export function time12(s) {
  const [h, m] = s.slice(11, 16).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${p2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
/** "Tue, Nov 25" / "mar 25 nov" */
export function describeDate(s, lang = 'en') {
  const d = parseDateTime(s);
  return lang === 'es'
    ? `${DAYS.es[d.getDay()]} ${d.getDate()} ${MONTHS.es[d.getMonth()]}`
    : `${DAYS.en[d.getDay()]}, ${MONTHS.en[d.getMonth()]} ${d.getDate()}`;
}

export function digits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

/** Normalizes a US phone to E.164 (+1XXXXXXXXXX). Returns null when invalid. */
export function normalizePhone(p) {
  let d = digits(p);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10 || /^[01]/.test(d)) return null;
  return '+1' + d;
}
export function fmtPhone(e164) {
  const d = digits(e164).slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(e164 ?? '');
}
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
export const validZip = (z) => /^\d{5}$/.test(String(z || ''));

export function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, msg) => { throw new HttpError(status, msg); };

/** Wraps Express handlers so thrown/async errors reach the error middleware. */
export const route = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
