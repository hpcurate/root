/* qurOS — shared helpers and settings.
   Plain scripts, loaded in order (util → db → speech → ui → rec → dump → day →
   gym → map → send → settings → app), everything on window.Q. No modules, so
   the app also opens from file:// and the tests can eval each file. */
window.Q = window.Q || {};
(() => {
const Q = window.Q;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const nowHm = () => hm(Date.now());

/* The day a moment belongs to. Before the rollover hour it is still
   yesterday, so a 01:30 evening dump files under the evening it ends. */
const dayOf = (ms = Date.now()) => isoDate(new Date(ms - Q.settings.get().rollover * 3600e3));
const today = () => dayOf();
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); };
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOW_L = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateObj = date => new Date(date + 'T12:00:00');
const fmtDay = date => { const d = dateObj(date); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
const fmtDayLong = date => { const d = dateObj(date); return `${DOW_L[d.getDay()]} ${d.getDate()} ${MON_L[d.getMonth()]} ${d.getFullYear()}`; };
/* Monday-first ISO week, as 'YYYY-Www' */
function weekKey(date) {
  const [y, m, dd] = date.split('-').map(Number), d = new Date(Date.UTC(y, m - 1, dd));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const wk = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(wk)}`;
}
function weekDays(date) {
  const d = dateObj(date), back = (d.getDay() + 6) % 7, mon = addDays(date, -back);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}
const words = s => (String(s || '').match(/\S+/g) || []).length;
const fmtNum = n => n.toLocaleString('en-GB');
function dur(secs) {
  secs = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
const durWords = secs => { const m = Math.round((secs || 0) / 60); return m < 1 ? '<1 min' : m < 60 ? m + ' min' : `${Math.floor(m / 60)}h${pad(m % 60)}`; };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const slug = s => norm(s).replace(/\s/g, '-').slice(0, 60) || 'x';
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const minutesOf = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
/* hours slept from last night's bed time to this morning's wake time; a bed
   time before noon is read as after midnight */
function slept(bed, wake) {
  let b = minutesOf(bed), w = minutesOf(wake);
  if (b == null || w == null) return null;
  if (b < 12 * 60) b += 1440;
  w += 1440;
  const m = w - b;
  return m > 0 && m < 20 * 60 ? m : null;
}
const fmtMins = m => `${Math.floor(m / 60)}h${pad(m % 60)}`;

/* ── icons ─────────────────────────────────────────────────────────────────
   Stroke icons on a 24 grid; currentColor so they follow the text. */
const P = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V4H4v12h4"/>',
  down: '<path d="M12 3v12M7 10l5 5 5-5M5 20h14"/>',
  up: '<path d="M12 21V9M7 14l5-5 5 5M5 4h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2M21 12h0"/>',
  day: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  map: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  send: '<path d="M4 20L20 4M9 4h11v11"/>',
  dumbbell: '<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

/* ── settings ──────────────────────────────────────────────────────────────
   Small and read synchronously, so they live in localStorage (the records
   are in IndexedDB, see db.js). Every key here is a contract: a backup file
   carries them and an older backup must still load. */
const SKEY = 'qos_settings_v1';
const ex = (name, sets, lo, hi, unit = 'reps') => ({ id: slug(name), name, sets, lo, hi, unit });
const DEFAULTS = {
  v: 1,
  lang: '',                   // '' = the device's language
  langs: ['en-GB', 'fr-FR'],  // the quick switch in the recorder
  mic: '',                    // the mic to listen through (a device id); '' = the phone's own (2.0.1)
  micName: '',                // its name, to find it again if its id changes
  lockOnStart: true,          // a voice dump starts locked
  relockAfter: 15,            // seconds unlocked and idle while listening; 0 = never
  dimAfter: 20,               // seconds locked and untouched before the screen dims; 0 = never
  liveText: true,             // show the words on the locked screen
  paraGap: 8,                 // seconds of silence that start a new paragraph
  commands: true,             // "new paragraph" / "new line"
  rollover: 4,                // hour a day ends; 0 = midnight
  wakeTarget: '06:00',
  bedTarget: '',
  accent: '#A78BFA',
  chain: [
    { id: 'wake', name: 'wake', full: 'up at the wake target', min: 'out of bed', wake: true },
    { id: 'walk', name: 'Kamo walk', full: 'full walk + talk to qurOS', min: 'short walk', talk: true },
    { id: 'gym', name: 'gym', full: 'full A/B session', min: 'bike 10 min + 1 exercise', gym: true },
    { id: 'shower', name: 'shower chain', full: 'the whole hygiene chain', min: 'shower', hyg: true },
    { id: 'cap', name: 'first CAP pomodoro', full: '1+ pomodoros', min: '1 pomodoro', focus: 'CAP' },
  ],
  hygiene: [
    { id: 'shower', name: 'shower' }, { id: 'face', name: 'face wash' }, { id: 'teeth', name: 'teeth' },
    { id: 'floss', name: 'floss' }, { id: 'tongue', name: 'tongue clean' }, { id: 'shave', name: 'shave' },
  ],
  areas: ['CAP', 'music', 'admin', 'other'],
  prep: [{ id: 'door', name: 'walk things by the door' }, { id: 'bag', name: 'gym bag ready' }],
  slots: ['breakfast', 'lunch', 'dinner', 'snack'],
  scales: ['mood', 'energy'],
  gymTarget: [3, 4],
  rest: 90,
  unit: 'kg',
  gymAwake: true,
  program: {
    warm: '5 min bike or rower',
    min: 'bike 10 min + 1 exercise',
    A: [ex('Leg press or goblet squat', 3, 8, 12), ex('Chest press or bench', 3, 8, 12), ex('Lat pulldown', 3, 8, 12),
      ex('Dumbbell Romanian deadlift', 3, 10, 10), ex('Plank', 3, 30, 45, 's')],
    B: [ex('Lunges or hip thrust', 3, 8, 12), ex('Shoulder press', 3, 8, 12), ex('Seated row', 3, 8, 12),
      ex('Leg curl', 3, 10, 12), ex('Hanging knee raise or cable crunch', 3, 10, 15)],
  },
  prompt: [
    'This is an export from qurOS, the app I capture my days and brain-dumps with. Please process it into my knowledge base:',
    '1. Dumps are raw speech-to-text: expect mis-heard words and no punctuation. Read for meaning, fix obvious mis-hearings, and ask me when a key word is unclear.',
    '2. File what I said under the topic each dump names. Say where it adds to or contradicts what you already know about me.',
    '3. Day logs are facts, not grades — use them for patterns over time, never to score a day.',
    '4. Update the life-dump map: what is covered now, what is still open.',
    '5. End with tomorrow\'s starting point: one small next action.',
  ].join('\n'),
};
const clone = o => JSON.parse(JSON.stringify(o));
let cur = null;
const listeners = new Set();
function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SKEY) || '{}') || {}; } catch {}
  /* shallow merge: a list someone edited replaces the default list whole */
  cur = Object.assign(clone(DEFAULTS), saved);
  if (!cur.program || !Array.isArray(cur.program.A) || !Array.isArray(cur.program.B)) cur.program = clone(DEFAULTS.program);
  return cur;
}
Q.settings = {
  DEFAULTS,
  get: () => cur || load(),
  set(patch) {
    Object.assign(Q.settings.get(), patch);
    try { localStorage.setItem(SKEY, JSON.stringify(cur)); } catch {}
    listeners.forEach(f => { try { f(patch); } catch (e) { console.error(e); } });
  },
  replace(obj) { cur = Object.assign(clone(DEFAULTS), obj || {}); Q.settings.set({}); },
  reset(key) { Q.settings.set({ [key]: clone(DEFAULTS[key]) }); },
  on: f => listeners.add(f),
  KEY: SKEY,
};

Q.u = { $, $$, esc, uid, pad, isoDate, hm, nowHm, dayOf, today, addDays, fmtDay, fmtDayLong, weekKey, weekDays,
  words, fmtNum, dur, durWords, norm, slug, vibrate, clamp, minutesOf, slept, fmtMins, icon, clone, DOW, MON };
})();
