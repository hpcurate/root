/* ── CAL ──────────────────────────────────────────────────────────────────────
   The day PLAN exported, drawn as a calendar.

   **This is not a calendar client.** It has no Google auth, no calendar API and
   no network of its own — the same line §8 of ROOT.md draws around PLAN is
   drawn around CAL, and a harness check reads this file and fails if a URL
   appears in it. What it shows is what PLAN resolved: the day template with its
   one start time applied, the picked tasks in the slots they were given, each
   row carrying the colour of the project it came from.

   PLAN hands the day over in `write()` at the moment the export succeeds, and
   nothing else writes here. CAL never reaches back into PLAN — a stored day is
   self-contained (its own clock times, its own colours), so a project renamed
   or recoloured next month does not rewrite the days already planned. That is
   deliberate: this is a record of what the day *was* planned as.

   The whole template is stored, not only what the export writes. `mode: blocks`
   sends the assigned slots alone, but the day still has the shape the template
   gives it, and CAL is a view of the day rather than a view of the export. The
   rows the export left out are marked `fixed` (a template event) or `idle` (a
   slot nobody claimed) and each can be switched off in settings.

   Storage: cal_days_v1 — hyphen-free but versioned, and deliberately not
   `plan_`-prefixed: the storage report files it under CAL, and PLAN's own
   clears must not reach it. */
window.CAL = (function () {
'use strict';

const SCOPE = '.ns-cal ';
const $id  = id  => document.querySelector(SCOPE + '#' + id);
const view = document.querySelector('#view-cal .view-body');
const esc  = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const KEY = 'cal_days_v1';

/* ── Content ───────────────────────────────────────────────────────────────── */
let EVENT_COLORS, IDLE_LABEL;
function readConfig() {
  EVENT_COLORS = Config.get('cal.eventColors') || {};
  IDLE_LABEL   = String(Config.get('cal.idleLabel') || 'free');
}
readConfig();

/* A fixed row's colour comes from the calendar it is on, so the routine hours
   read as one band all day. An unknown calendar falls back to the neutral, not
   to the accent — an unmapped event that looked "important" was worse than one
   that looked like nothing. */
const fixedColor = name => EVENT_COLORS[String(name || '')] || EVENT_COLORS['*'] || '#6b6b6b';

/* ── State ─────────────────────────────────────────────────────────────────── */
let DB = { days:{} };
let sel = null;                       // the iso day on screen

function load() {
  try { DB = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { DB = {}; }
  if (!DB || typeof DB !== 'object') DB = {};
  if (!DB.days || typeof DB.days !== 'object') DB.days = {};
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch {} }
load();

const isoRe = /^\d{4}-\d{2}-\d{2}$/;
const allDays = () => Object.keys(DB.days).filter(k => isoRe.test(k)).sort();

/* Days older than the keep window go. The future is never swept: a day planned
   three weeks out is the whole point of the coming-days strip. */
function prune() {
  const keep = Math.max(1, +Prefs.get('calKeep') || 60), today = Shell.today();
  const floor = shift(today, -keep);
  let cut = 0;
  allDays().forEach(k => { if (k < floor) { delete DB.days[k]; cut++; } });
  return cut;
}

// local parts, never an ISO string in UTC — which is yesterday here until 01:00
function shift(iso, n) {
  const p = String(iso).split('-').map(Number);
  const d = new Date(p[0], (p[1] || 1) - 1, (p[2] || 1) + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── What PLAN hands over ──────────────────────────────────────────────────────
   One day, replacing whatever was stored for it — re-exporting a day is how you
   correct it, so the last export wins rather than merging into the old one. */
function write(day) {
  if (!day || !isoRe.test(String(day.day || ''))) return false;
  load();                                   // another tab may have written since
  DB.days[day.day] = {
    day: day.day,
    start: day.start || '',
    template: day.template || '',
    mode: day.mode || 'blocks',
    notes: Array.isArray(day.notes) ? day.notes.slice() : [],
    written: Date.now(),
    events: (Array.isArray(day.events) ? day.events : []).map(e => ({
      from: e.from, to: e.to, over: !!e.over, dur: +e.dur || 0,
      kind: e.kind === 'task' ? 'task' : e.kind === 'idle' ? 'idle' : 'fixed',
      name: e.name == null ? '' : String(e.name),
      slot: e.slot || null, cal: e.cal || null,
      project: e.project || null, projectLabel: e.projectLabel || null,
      section: e.section || null,
      color: e.color || null,
    })),
  };
  prune();
  save();
  sel = day.day;                            // land on what was just planned
  render();
  return true;
}

/* ── The days on offer ─────────────────────────────────────────────────────────
   Today (planned or not) and every planned day within the window ahead, plus
   any planned day still inside the keep window behind. Today is always a chip
   even with nothing on it, or "no calendar yet" would be the only thing an
   unplanned morning ever said. */
function strip() {
  const today = Shell.today();
  const ahead = shift(today, Math.max(1, +Prefs.get('calAhead') || 7));
  const out = allDays().filter(k => k <= ahead);
  if (!out.includes(today)) { out.push(today); out.sort(); }
  return out;
}

function pickDefault() {
  const today = Shell.today(), have = strip();
  if (DB.days[today]) return today;
  const next = have.find(k => k > today && DB.days[k]);
  if (next) return next;
  const past = have.filter(k => k < today && DB.days[k]).pop();
  return past || today;
}

function pick(iso) {
  if (!isoRe.test(String(iso || ''))) return;
  Prefs.tap();
  sel = iso;
  render();
}

/* ── Rendering ─────────────────────────────────────────────────────────────── */
/* CAL is lower case throughout — the one app that is. `Prefs.formatDate()` is
   shared and capitalises, so it is folded here rather than changed there. */
const lower = s => String(s == null ? '' : s).toLowerCase();

function relLabel(iso) {
  const today = Shell.today();
  if (iso === today) return 'today';
  if (iso === shift(today, 1)) return 'tomorrow';
  if (iso === shift(today, -1)) return 'yesterday';
  return null;
}

function visibleEvents(rec) {
  const showFixed = Prefs.get('calShowFixed') !== false;
  const showIdle  = Prefs.get('calShowIdle')  !== false;
  return (rec.events || []).filter(e =>
    e.kind === 'task' || (e.kind === 'fixed' && showFixed) || (e.kind === 'idle' && showIdle));
}

/* ── Left and right, one day at a time ────────────────────────────────────────
   Stepping walks the days that exist — the planned ones plus today — rather
   than the calendar, so "next" never lands on a run of empty days you have to
   click through. An arrow with nowhere to go is darkened and disabled rather
   than removed: a control that vanishes at the edge moves the ones beside it,
   and the day would jump under your thumb. */
function stepsHTML() {
  const days = strip(), i = days.indexOf(sel);
  const prev = i > 0 ? days[i - 1] : null;
  const next = i >= 0 && i < days.length - 1 ? days[i + 1] : null;
  /* The shell's own chevrons from the sprite, not "←" and "→" as text. A glyph
     is at the mercy of whichever font is loaded, sits off the optical centre,
     and ignores the Icon weight dial — the arrows beside the nav have always
     been drawn, and these are the same pair at the same size. */
  const arrow = (day, icon, label) =>
    `<button class="cal-arrow${day ? '' : ' off'}" data-act="pick"${day ? ` data-day="${esc(day)}"` : ''}
             ${day ? '' : 'disabled aria-disabled="true"'} aria-label="${esc(label)}"
      ><svg aria-hidden="true"><use href="#${icon}"/></svg></button>`;
  return arrow(prev, 'ico-chev-l', 'previous day') +
         `<span class="cal-steps-sep" aria-hidden="true"></span>` +
         arrow(next, 'ico-chev-r', 'next day');
}

/* The day's name lives in the title band, beside the wordmark — so the stepper
   below carries no label and the date is where every other app puts its date. */
function paintBand() {
  const el = document.querySelector('#view-cal #cal-band-date');
  if (!el) return;
  const rel = relLabel(sel);
  el.innerHTML = `<span class="cbd-date">${esc(lower(Prefs.formatDate(sel, 'short')))}</span>` +
                 (rel ? `<span class="cbd-rel">${esc(rel)}</span>` : '');
}

/* The stepper is a sibling of #views, not part of the slide — it is fixed, and
   nothing fixed may live inside #track. getElementById, not the scoped helper:
   the element carries .ns-cal itself rather than sitting under it. */
function paintSteps() {
  const el = document.getElementById('cal-steps');
  if (el) el.innerHTML = stepsHTML();
}

/* One row per event, its height the duration — so an hour looks like an hour
   and the day reads as a shape rather than as a list. The height is set from a
   dial rather than a literal, and the box uses the tokens like every other
   surface: a literal radius here would be immune to the theme system. */
function dayHTML() {
  const rec = sel && DB.days[sel];
  if (!rec) {
    const today = Shell.today();
    /* The action is one of this app's own controls, not a full-width form
       button: the empty state is a card like every other card here, and a
       `.btn` stretched across it read as a screen from a different app. */
    return `<div class="cal-empty card">
      <div class="ce-title">${sel === today ? 'nothing planned for today' : 'nothing planned for this day'}</div>
      <div class="ce-note">PLAN writes the day here when you export it — pick the sent tasks,
        give each one a slot, and the day follows.</div>
      <button class="ce-go" data-act="to-plan">open plan<span aria-hidden="true">→</span></button>
    </div>`;
  }
  const evs = visibleEvents(rec);
  const per = Math.max(20, +Prefs.get('calHour') || 56);
  const names = Prefs.get('calCalNames') === true;
  if (!evs.length) {
    return dayHead(rec) + `<div class="cal-empty card"><div class="ce-title">every row is switched off</div>
      <div class="ce-note">the template events and the free slots are both hidden — turn one back on
        under settings → apps → cal.</div></div>`;
  }
  return dayHead(rec) + `<div class="cal-day" style="--cal-hour:${per}px">${evs.map(e => {
    const h = Math.max(18, Math.round((e.dur / 60) * per));
    const color = e.kind === 'task' ? (e.color || '#6b6b6b')
                : e.kind === 'fixed' ? fixedColor(e.cal) : null;
    const meta = e.kind === 'task'
      ? [e.slot, e.projectLabel || e.project, names ? e.cal : null].filter(Boolean).join(' · ')
      : e.kind === 'idle' ? `${e.slot} · ${IDLE_LABEL}`
      : (names && e.cal) ? e.cal : '';
    return `<div class="cal-ev ${e.kind}"${color ? ` style="--ev-color:${esc(color)};--ev-h:${h}px"` : ` style="--ev-h:${h}px"`}>
      <span class="ev-at">${esc(e.from)}<b>${esc(e.to)}${e.over ? ' +1' : ''}</b></span>
      <span class="ev-box">
        <span class="ev-name">${esc(e.name)}</span>
        ${meta ? `<span class="ev-meta">${esc(meta)}</span>` : ''}
      </span>
    </div>`;
  }).join('')}</div>` + notesHTML(rec);
}

/* The day itself is named by the nav above; this is only what it is made of.
   Lower case throughout, and deliberately not `var(--caps)` — see cal.css. */
function dayHead(rec) {
  const tasks = (rec.events || []).filter(e => e.kind === 'task').length;
  return `<div class="cal-head">
    <div class="ch-meta">${esc(lower(rec.template))} · from ${esc(rec.start)} · ${tasks} task${tasks === 1 ? '' : 's'}${
      rec.mode === 'blocks' ? ' · blocks only' : ' · full schedule'}</div>
  </div>`;
}

/* The notes travelled with the export, so they belong to the day as planned.
   Shown as written and never parsed — the agent downstream owns their meaning. */
function notesHTML(rec) {
  if (!rec.notes || !rec.notes.length) return '';
  return `<div class="cal-notes card">
    <div class="cn-title">notes</div>
    ${rec.notes.map(n => `<div class="cn-row">${esc(n)}</div>`).join('')}
  </div>`;
}

function render() {
  const box = $id('cal-body');
  if (!box) return;
  if (!sel || !strip().includes(sel)) sel = pickDefault();
  box.innerHTML = dayHTML();
  paintBand();
  paintSteps();
}

/* ── Settings ──────────────────────────────────────────────────────────────── */
function renderSettings() {
  const el = $id('cal-status');
  if (!el) return;
  const n = allDays().length;
  const today = Shell.today();
  const ahead = allDays().filter(k => k > today).length;
  el.className = 'settings-status ' + (n ? 'ok' : 'idle');
  el.textContent = n
    ? `${n} day${n === 1 ? '' : 's'} stored · ${ahead} still to come`
    : 'nothing stored yet — export a day from PLAN';
}

function clearAll() {
  if (!allDays().length) { Shell.toast('nothing to clear'); return; }
  if (!Shell.confirm('Clear every stored day? The tasks themselves stay in Todoist.')) return;
  DB = { days:{} }; sel = null;
  save(); render(); renderSettings();
  Shell.toast('calendar cleared');
}

/* ── Wiring ────────────────────────────────────────────────────────────────────
   One document-level listener filtered on the namespace, TEND's pattern: CAL's
   markup is in two places (the slide and the settings panel) and this is the one
   listener that reaches both. No inline handlers, so no attr() escaping to get
   wrong on a day name. */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || !t.closest('.ns-cal')) return;
  const act = t.dataset.act;
  if (act === 'pick')    { pick(t.dataset.day); return; }
  if (act === 'to-plan') { Prefs.tap(); Shell.TABS.includes('plan') ? Shell.go('plan') : Shell.open('plan'); return; }
  if (act === 'clear')   { clearAll(); return; }
});

Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('cal.')) return;
  readConfig(); render();
});
Prefs.subscribe(k => {
  if (k === '*' || k === 'calHour' || k === 'calShowFixed' || k === 'calShowIdle' ||
      k === 'calCalNames' || k === 'calAhead' || k === 'dateFormat') render();
  if (k === '*' || k === 'calKeep') { if (prune()) { save(); render(); renderSettings(); } }
});

render();

Shell.register('cal', {
  onShow: () => { load(); render(); },
  onDayChange: () => { if (prune()) save(); sel = pickDefault(); render(); },
  home: () => { sel = pickDefault(); render(); if (view) view.scrollTop = 0; },
  /* The days are in CAL's own key, not in Config, so search asks here. A task
     is found by its own name — which is how a day is looked for ("when did I
     put the mixing in?") rather than by its date. */
  search: q => {
    const out = [];
    allDays().forEach(iso => {
      (DB.days[iso].events || []).forEach(e => {
        if (e.kind !== 'task') return;
        if (!String(e.name || '').toLowerCase().includes(q)) return;
        out.push({ title: e.name, sub: `calendar · ${iso} · ${e.slot || ''}`.trim(),
                   go: () => { Shell.TABS.includes('cal') ? Shell.go('cal') : Shell.open('cal'); pick(iso); } });
      });
    });
    return out;
  },
});

return { write, render, renderSettings, clearAll, pick,
         days: () => allDays(), day: iso => DB.days[iso] || null, selected: () => sel };
})();
