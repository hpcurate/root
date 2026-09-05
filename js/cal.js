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
      done: false,
    })),
  };
  prune();
  save();
  sel = day.day;                            // land on what was just planned
  sched = null;
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

/* **Today, always.** DAY used to open on the nearest day that had something on
   it, which meant that on a morning with nothing planned the app answered a
   question nobody asked — "here is Thursday" — and you had to step back to find
   out that today was empty. An app called DAY opens on the day it is. The
   stepper is one tap away from whatever else is planned. */
function pickDefault() { return Shell.today(); }

function pick(iso) {
  if (!isoRe.test(String(iso || ''))) return;
  Prefs.tap();
  sel = iso;
  sched = null;              // the panel is about the day it was opened on
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

/* The index in the record travels with the event, because a tick has to be
   written back to the row it came from and the visible set is a filtered one —
   two dials can take rows out from under it between one draw and the next. */
function visibleEvents(rec) {
  const showFixed = Prefs.get('calShowFixed') !== false;
  const showIdle  = Prefs.get('calShowIdle')  !== false;
  return (rec.events || []).map((e, i) => ({ e, i })).filter(({ e }) =>
    e.kind === 'task' || (e.kind === 'fixed' && showFixed) || (e.kind === 'idle' && showIdle));
}

/* ── Ticking a row off ─────────────────────────────────────────────────────────
   A day you can only read is a day you re-read: the question at four in the
   afternoon is not "what was planned" but "what is left", and answering it
   meant holding the first half of the day in your head. A tick answers it on
   the drawing.

   It is a mark on the record and nothing else. CAL has no network by contract
   (§8 — a harness check fails on any fetch in this file), so ticking a task
   here does not close it in Todoist and cannot: the row is a *drawing* of a
   task, resolved and frozen at export time, and it does not carry the id that
   would be needed. The same task ticked on DO is the one that closes it.

   An idle row is not tickable. It is the absence of an event — there is
   nothing there to have finished — and offering a tick on one would be
   offering an action that means nothing. */
const tickable = e => e && (e.kind === 'task' || e.kind === 'fixed');
function toggleEvent(i) {
  const rec = sel && DB.days[sel];
  const e = rec && rec.events && rec.events[+i];
  if (!e || !tickable(e)) return;
  e.done = !e.done;
  Prefs.tap();
  save(); render();
}

/* ── Clock arithmetic ─────────────────────────────────────────────────────────
   The stored day is a list of rows, each carrying its own `from`, `to` and
   duration in minutes; the drawing stacks them and reads the times off the
   rows. So moving part of a day is arithmetic on those strings, and this is
   the only place that does it. Minutes are taken modulo the day rather than
   clamped: a row pushed past midnight belongs at the small hours, which is
   what `over` on the record already means. */
const hhmm = n => {
  const m = ((Math.round(n) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
function shiftEvent(e, mins) {
  if (!mins) return;
  const a = minsOf(e.from), b = minsOf(e.to);
  if (a == null) return;
  e.from = hhmm(a + mins);
  if (b != null) e.to = hhmm(b + mins);
  // "+1" is a claim about the clock, so it is re-derived rather than carried
  e.over = (a + mins) + (+e.dur || 0) >= 1440;
}

/* ── Removing a row ───────────────────────────────────────────────────────────
   A day arrives from PLAN whole. Until now the only way to correct one was to
   re-export it, which is a great deal of ceremony for "that meeting is off".

   Deleting leaves an hour behind, and there are exactly two honest things to
   do with it, which is why this asks rather than choosing:

     close the gap    every row after it moves earlier by its duration. The
                      day is genuinely shorter — everything happens sooner and
                      you finish sooner. This is the answer when the thing was
                      cancelled and you want the time back.
     leave it free    the row becomes an unclaimed slot and the rest of the day
                      stays exactly where it was planned. This is the answer
                      when the *rest* of the day is fixed — a train at six is
                      still at six whether or not the morning emptied out.

   A `fixed` template row left free is still an idle row: what an idle row
   means is "this hour, nothing in it", which is true of both. */
function deleteEvent(i) {
  const rec = sel && DB.days[sel];
  const idx = +i;
  const e = rec && rec.events && rec.events[idx];
  if (!e || e.kind === 'idle') return;
  Shell.ask({
    title: `Delete “${e.name}”?`,
    body: `${e.from}–${e.to} · ${e.dur} min. What should happen to the time it leaves behind?`,
    yes: 'close the gap',
    alt: 'leave it free',
    danger: false,
    done: a => {
      if (!a) return;
      const cur = sel && DB.days[sel];
      const ev = cur && cur.events && cur.events[idx];
      if (!ev || ev !== e) return;              // the day changed under the question
      if (a === 'alt') {
        /* Kept in place, emptied out. Everything that made it a task — the
           project, the colour, the slot it held — goes, or a slot would still
           read as claimed by a task that is not there any more. */
        cur.events[idx] = { from:ev.from, to:ev.to, over:!!ev.over, dur:+ev.dur || 0,
                            kind:'idle', name:IDLE_LABEL, slot:ev.slot || null,
                            cal:null, project:null, projectLabel:null, section:null,
                            color:null, done:false };
      } else {
        const by = -(+ev.dur || 0);
        cur.events.splice(idx, 1);
        cur.events.slice(idx).forEach(x => shiftEvent(x, by));
      }
      cur.localEdit = Date.now();
      save(); render(); renderSettings();
      Shell.toast(a === 'alt' ? 'deleted · the hour is free' : 'deleted · the day closed up');
    },
  });
}

/* ── The day starts when you woke up ──────────────────────────────────────────
   PLAN resolves a day against one start time, chosen the night before. The
   morning then happens, and by the time LOG's morning form is filled in the
   real answer is known — and it is rarely the one PLAN guessed. Every row on
   the day is then off by the difference, and the "now" line crosses a schedule
   that stopped being true before breakfast.

   LOG calls this when the wake time is saved. The whole day moves by the
   difference between `start` and the wake time: the day keeps its shape, which
   is the thing this app draws, and only its position on the clock changes.

   `wakeShift` is the shift already applied, so this is idempotent and
   reversible — a wake time corrected from 08:10 to 07:50 moves the day by the
   twenty minutes between them, not by another two hours and ten, and clearing
   the field puts the day back where PLAN wrote it. Without it, saving the
   morning form twice would walk the day down the clock. */
function setWake(iso, time) {
  if (Prefs.get('calWakeShift') === false) return false;
  load();
  const rec = DB.days[iso];
  if (!rec || !Array.isArray(rec.events) || !rec.events.length) return false;
  const base = minsOf(rec.start);
  if (base == null) return false;
  const want = time ? minsOf(time) : null;
  // an unreadable time is not a reason to move the day anywhere
  if (time && want == null) return false;
  const target = want == null ? 0 : want - base;
  const delta  = target - (+rec.wakeShift || 0);
  if (!delta) return false;
  rec.events.forEach(e => shiftEvent(e, delta));
  rec.wakeShift = target;
  if (!target) delete rec.wakeShift;
  save();
  if (sel === iso) render();
  return true;
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
  wakeSteps();
}

/* ── The stepper steps aside ───────────────────────────────────────────────────
   It is a bar the width of the screen now rather than a small pill: two targets
   you can hit with either thumb without looking, sitting above the tab bar. The
   price of that width is that it covers the bottom of the day, so it fades out
   once you have stopped using it and comes back on the first touch. The delay
   is a dial (`calStepsHide`, 0 pins it) rather than a literal five seconds. */
let stepsTimer = null;
function wakeSteps() {
  const el = document.getElementById('cal-steps');
  if (!el) return;
  el.classList.remove('idle');
  clearTimeout(stepsTimer);
  const secs = +Prefs.get('calStepsHide');
  if (!isFinite(secs) || secs <= 0) return;
  stepsTimer = setTimeout(() => el.classList.add('idle'), secs * 1000);
}

/* ── Where "now" falls on the drawing ─────────────────────────────────────────
   The rows are stacked in order and each one's height is its duration, so the
   day already *is* a time axis — it just had nothing marking the present on it,
   which is the one piece of information a day-shaped drawing is uniquely good
   at carrying. The line is drawn only on today, and only while now is inside
   the day's span: before the first row and after the last one it would be a
   line pinned to an edge, saying "the day has not started" in the most
   ambiguous way available.

   The offset is computed from the same numbers the rows are drawn from rather
   than measured off the DOM, so it cannot disagree with them, and it survives a
   row being hidden by a dial (a hidden row contributes no height, and neither
   does it here). A gap between two rows — which the template does not currently
   produce, but nothing stops it from producing — puts the line at the top of
   the row that is next. */
const HHMM = /^(\d{1,2}):(\d{2})$/;
const minsOf = t => { const m = HHMM.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
function nowOffset(evs, per) {
  if (sel !== Shell.today()) return null;
  const d = new Date(), now = d.getHours() * 60 + d.getMinutes();
  let y = 0;
  for (const { e } of evs) {
    const h = Math.max(18, Math.round((e.dur / 60) * per));
    const a = minsOf(e.from);
    // a row that runs past midnight owns the rest of the clock, not a wrapped span
    const b = a == null ? null : a + (+e.dur || 0);
    if (a == null || b == null) { y += h; continue; }
    if (now < a) return y;                       // in the gap before this row
    if (now < b) return y + Math.round(h * ((now - a) / Math.max(1, b - a)));
    y += h;
  }
  return null;                                   // the day is over
}
function nowLabel() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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
    return dayHead(rec) + schedHTML(rec) + `<div class="cal-empty card"><div class="ce-title">every row is switched off</div>
      <div class="ce-note">the template events and the free slots are both hidden — turn one back on
        under settings → apps → cal.</div></div>`;
  }
  const nowY = nowOffset(evs, per);
  /* Colour on the rows themselves rather than only on the 3px rail. Two dials,
     because the two kinds of row answer different questions: a block is work
     you chose and put in a slot, a template row is the shape the day has
     anyway. Washing both at once is a rainbow and reads as noise; washing one
     of them makes that one the thing you see. Off for both is what 2.23
     looked like, and is still the default. */
  const cls = [
    Prefs.get('calColorBlocks') === true ? 'lit-task' : '',
    Prefs.get('calColorOther')  === true ? 'lit-fixed' : '',
  ].filter(Boolean).join(' ');
  return dayHead(rec) + schedHTML(rec) + `<div class="cal-day${cls ? ' ' + cls : ''}" style="--cal-hour:${per}px">${evs.map(({ e, i }) => {
    const h = Math.max(18, Math.round((e.dur / 60) * per));
    const color = e.kind === 'task' ? (e.color || '#6b6b6b')
                : e.kind === 'fixed' ? fixedColor(e.cal) : null;
    const meta = e.kind === 'task'
      ? [e.slot, e.projectLabel || e.project, names ? e.cal : null].filter(Boolean).join(' · ')
      : e.kind === 'idle' ? `${e.slot} · ${IDLE_LABEL}`
      : (names && e.cal) ? e.cal : '';
    /* A row you can tick is a button; a row you cannot is not one, rather than
       a button that refuses — the two must not feel the same under a finger. */
    const tag = tickable(e) ? 'button' : 'div';
    const style = ` style="${color ? `--ev-color:${esc(color)};` : ''}--ev-h:${h}px"`;
    /* The tick is the row and the delete is a control inside it, so the delete
       cannot be a <button> nested in the row's own <button> — that is invalid
       markup and the inner one does not reliably get the tap. It is a <span>
       with a role, and the row's handler is the one delegated listener either
       way: `data-act` on the span wins over the row's, because the listener
       reads the closest one. An idle row has nothing to delete. */
    const del = e.kind === 'idle' ? '' :
      `<span class="ev-del" role="button" tabindex="0" data-act="del" data-i="${i}"
             aria-label="delete ${esc(e.name)}"><svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>`;
    return `<${tag} class="cal-ev ${e.kind}${e.done ? ' done' : ''}"${style}${
      tickable(e) ? ` data-act="tick" data-i="${i}" aria-pressed="${!!e.done}"` : ''}>
      <span class="ev-at">${esc(e.from)}<b>${esc(e.to)}${e.over ? ' +1' : ''}</b></span>
      <span class="ev-box">
        <span class="ev-name">${esc(e.name)}</span>
        ${meta ? `<span class="ev-meta">${esc(meta)}</span>` : ''}
      </span>
      ${del}
      ${tickable(e) ? `<span class="ev-check"><svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ''}
    </${tag}>`;
  }).join('')}${nowY == null ? '' :
    `<div class="cal-now" id="cal-now" style="--now-y:${nowY}px" aria-hidden="true"><span>${esc(nowLabel())}</span></div>`
  }</div>` + notesHTML(rec);
}

/* The day itself is named by the nav above; this is only what it is made of.
   Lower case throughout, and deliberately not `var(--caps)` — see cal.css.

   It used to be one string with `·` typed between the parts, which meant the
   browser was free to break a line anywhere a space fell — and it did, in the
   worst place: "5 tasks" and "3 done" split across two lines, so the head read
   as a number stranded above its noun. Each fact is its own element now, with
   the separator drawn by CSS rather than typed, so a fact is an unbreakable
   unit that either fits on the line or moves to the next one whole.

   The actions moved to their own row underneath. On a phone the meta already
   wanted the full width, and "schedule from do" — the longest label on the
   screen for a panel that is used a few times a month — was competing with it
   for that width. It is `+ do` now: still the accent, still the only thing on
   the head that adds rather than removes, and a quarter of the length. */
function dayHead(rec) {
  const evs = rec.events || [];
  const tasks = evs.filter(e => e.kind === 'task').length;
  const done  = evs.filter(e => tickable(e) && e.done).length;
  /* "Edited here" is not decoration. Everywhere else on this screen, what is
     drawn is what PLAN resolved and sent — that is the whole claim the app
     makes (§9). Filling the slots from DO, deleting a row and shifting the day
     to a logged wake-up time all break that claim, so the day says so,
     permanently, rather than quietly showing a schedule Google was never told
     about. */
  const facts = [
    lower(rec.template),
    'from ' + rec.start,
    `${tasks} task${tasks === 1 ? '' : 's'}`,
    rec.mode === 'blocks' ? 'blocks only' : 'full schedule',
    done ? `${done} done` : '',
    rec.wakeShift ? 'woken' : '',
    rec.localEdit ? 'edited' : '',
  ].filter(Boolean);
  return `<div class="cal-head">
    <div class="ch-meta">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>
    <div class="ch-acts">
      ${slotsOf(rec).length ? '<button class="ch-act" data-act="sched">+ do</button>' : ''}
      <button class="ch-clear" data-act="clear-day">clear</button>
    </div>
  </div>`;
}

/* ── The day's blocks, filled from DO ──────────────────────────────────────────
   PLAN builds a day and sends it; that is the way a day gets here and it is not
   changing. But the day PLAN sent is the day as it looked the night before, and
   by the morning the blocks on DO are the ones that are actually happening —
   they came from Todoist, they are what got labelled @b1 in the end, and
   re-exporting the whole day through PLAN to move two of them is a great deal
   of ceremony for a small correction.

   So: the slots this day already has, filled from the block tasks DO is holding
   right now. Only the slots — a `fixed` template row is the shape of the day and
   is not up for negotiation here — and only on a day that exists, because the
   slots come from the record rather than from `plan.dayTemplates`. CAL does not
   resolve a template; it never has, and a day drawn from one that was never sent
   anywhere would be a day this app is not allowed to claim.

   The slot rules are PLAN's, deliberately (§8): a slot one task holds is refused
   to another, by name, rather than taken away in silence, and tapping the slot a
   task already holds gives it back. What is different is the ending — this
   overwrites, so it asks first, and it marks the day as edited here afterwards.

   `sched` is a gesture, not state: module-level, never persisted, dropped on any
   day change. Same rule as PLAN's `openKey` and DO's move selections. */
let sched = null;                    // { picks: { slot: task } } while the panel is open

function slotsOf(rec) {
  const out = [];
  (rec && rec.events || []).forEach(e => { if (e.slot && !out.includes(e.slot)) out.push(e.slot); });
  return out;
}
function doBlocks() {
  return (window.DO && DO.blockTasks) ? DO.blockTasks().filter(t => t && t.content) : [];
}
function openSched() {
  const rec = sel && DB.days[sel];
  if (!rec || !slotsOf(rec).length) { Shell.toast('this day has no block slots'); return; }
  if (!doBlocks().length) { Shell.toast('no blocks on do — fetch them there first'); return; }
  sched = { picks: {} };
  Prefs.tap(); render();
}
function closeSched() { sched = null; Prefs.tap(); render(); }

/* Keyed by slot rather than by task, because the slot is the thing that is
   exclusive and the refusal has to name the task that already holds it. */
function pickSlot(id, slot) {
  if (!sched) return;
  const t = doBlocks().find(x => String(x.id) === String(id));
  if (!t) return;
  const held = sched.picks[slot];
  if (held && String(held.id) === String(id)) { delete sched.picks[slot]; Prefs.tap(); render(); return; }
  // PLAN's phrasing, because it is PLAN's rule (§8) and the two panels should
  // refuse in the same words
  if (held) { Shell.toast(`${slot} is taken — by ${held.content}`); return; }
  // one task, one slot: taking a new one gives the old one back
  Object.keys(sched.picks).forEach(k => { if (String(sched.picks[k].id) === String(id)) delete sched.picks[k]; });
  sched.picks[slot] = t;
  Prefs.tap(); render();
}

function applySched() {
  const rec = sel && DB.days[sel];
  if (!rec || !sched) return;
  const picks = sched.picks, n = Object.keys(picks).length;
  if (!n) return;
  const name = lower(Prefs.formatDate(sel, 'short'));
  Shell.confirm(
    `Put ${n} block${n === 1 ? '' : 's'} into ${name}? Every slot on this day is rewritten — the ones you have not filled go back to ${IDLE_LABEL}. Nothing is sent anywhere: the tasks stay as they are in Todoist, and the calendar keeps whatever PLAN already told it.`,
    () => {
      const r = DB.days[sel];
      if (!r) return;
      r.events = (r.events || []).map(e => {
        if (!e.slot) return e;                       // the template's own hours are not ours
        const t = picks[e.slot];
        if (!t) return Object.assign({}, e, { kind:'idle', name:e.slot, project:null,
                                              projectLabel:null, section:null, color:null, done:false });
        return Object.assign({}, e, {
          kind:'task', name:String(t.content), project:'todoist',
          projectLabel: t.tag || 'todoist', section:null,
          color: t.color || null, done:false });
      });
      r.localEdit = Date.now();
      sched = null;
      save(); render(); renderSettings();
      Shell.toast(`${n} block${n === 1 ? '' : 's'} scheduled`);
    });
}

function schedHTML(rec) {
  if (!sched) return '';
  const slots = slotsOf(rec), tasks = doBlocks();
  const n = Object.keys(sched.picks).length;
  return `<div class="cal-sched card">
    <div class="cs-head">
      <span class="cs-title">schedule from do</span>
      <button class="cs-close" data-act="sched-close">cancel</button>
    </div>
    <div class="cs-note">the blocks do is holding, put into this day's slots. every slot is
      rewritten — what you leave empty goes back to ${esc(IDLE_LABEL)}.</div>
    ${tasks.map(t => `<div class="cs-row">
        <div class="cs-task" style="--cs-c:${esc(t.color || '#6b6b6b')}">
          <span class="cs-name">${esc(t.content)}</span>
          <span class="cs-tag">@${esc(t.block)}${t.tag ? ` · ${esc(t.tag)}` : ''}${t.done ? ' · done' : ''}</span>
        </div>
        <div class="cs-slots">${slots.map(sl => {
          const held = sched.picks[sl];
          const on = held && String(held.id) === String(t.id);
          const taken = held && !on;
          return `<button class="cs-slot${on ? ' on' : ''}${taken ? ' taken' : ''}"
            data-act="sched-pick" data-id="${esc(t.id)}" data-slot="${esc(sl)}">${esc(sl)}</button>`;
        }).join('')}</div>
      </div>`).join('')}
    <button class="cs-go" data-act="sched-go"${n ? '' : ' disabled'}>${
      n ? `schedule ${n} block${n === 1 ? '' : 's'}` : 'pick a slot'}</button>
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
  Shell.confirm('Clear every stored day? The tasks themselves stay in Todoist.', () => {
    DB = { days:{} }; sel = null;
    save(); render(); renderSettings();
    Shell.toast('calendar cleared');
  });
}

/* One day, from the day it is drawn on. Re-exporting is how a day is corrected;
   this is how a day that should not be there at all goes away — a plan that was
   abandoned, or a day exported to the wrong date. The Todoist task it wrote is
   not ROOT's to withdraw, and the message says so. */
function clearDay() {
  if (!sel || !DB.days[sel]) { Shell.toast('nothing to clear'); return; }
  const name = lower(Prefs.formatDate(sel, 'short'));
  Shell.confirm(`Clear ${name}? The tasks themselves stay in Todoist.`, () => {
    delete DB.days[sel];
    save(); render(); renderSettings();
    Shell.toast('day cleared');
  });
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
  if (act === 'pick')      { pick(t.dataset.day); return; }
  if (act === 'to-plan')   { Prefs.tap(); Shell.TABS.includes('plan') ? Shell.go('plan') : Shell.open('plan'); return; }
  if (act === 'clear')     { clearAll(); return; }
  if (act === 'clear-day') { clearDay(); return; }
  /* The delete sits inside the row, so its click is on its way to the row's
     own handler. Stopping it here is what keeps deleting a row from also
     ticking it. */
  if (act === 'del')         { e.stopPropagation(); e.preventDefault(); deleteEvent(t.dataset.i); return; }
  if (act === 'tick')        { toggleEvent(t.dataset.i); return; }
  if (act === 'sched')       { openSched(); return; }
  if (act === 'sched-close') { closeSched(); return; }
  if (act === 'sched-pick')  { pickSlot(t.dataset.id, t.dataset.slot); return; }
  if (act === 'sched-go')    { applySched(); return; }
});

/* Any touch on DAY brings the stepper back — including one on the stepper
   itself, which is what stops it fading out mid-tap while you step through. */
['pointerdown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, e => {
    if (!document.getElementById('view-cal')?.classList.contains('cur')) return;
    if (e.target.closest && (e.target.closest('#view-cal') || e.target.closest('#cal-steps'))) wakeSteps();
  }, { passive: true }));

Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('cal.')) return;
  readConfig(); render();
});
Prefs.subscribe(k => {
  if (k === '*' || k === 'calHour' || k === 'calShowFixed' || k === 'calShowIdle' ||
      k === 'calCalNames' || k === 'calAhead' || k === 'dateFormat' ||
      k === 'calColorBlocks' || k === 'calColorOther') render();
  if (k === '*' || k === 'calKeep') { if (prune()) { save(); render(); renderSettings(); } }
  if (k === '*' || k === 'calStepsHide') wakeSteps();
});

render();

/* The line has to move, and the shell already has the one timer that notices a
   minute passing — a second one for this would be a second thing to keep in
   step (§3). It moves the line and nothing else: a full redraw once a minute
   would throw away the scroll position and the open panel with it. */
function paintNow() {
  const rec = sel && DB.days[sel];
  // the day is not on screen at all: there is no line to move, and redrawing a
  // slide nobody is looking at once a minute is exactly what this avoids
  if (!rec || !document.querySelector('#view-cal .cal-day')) return;
  const el = document.querySelector('#view-cal #cal-now');
  const per = Math.max(20, +Prefs.get('calHour') || 56);
  const y = nowOffset(visibleEvents(rec), per);
  if (y == null) { if (el) el.remove(); return; }
  if (!el) { render(); return; }              // it has come back into the day
  el.style.setProperty('--now-y', y + 'px');
  const lab = el.querySelector('span');
  if (lab) lab.textContent = nowLabel();
}

Shell.register('cal', {
  onShow: () => { load(); render(); },
  onDayChange: () => { if (prune()) save(); sel = pickDefault(); sched = null; render(); },
  onMinute: paintNow,
  home: () => { sel = pickDefault(); sched = null; render(); if (view) view.scrollTop = 0; },
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

return { write, render, renderSettings, clearAll, clearDay, pick, wakeSteps,
         toggleEvent, deleteEvent, setWake, openSched, closeSched, pickSlot, applySched, paintNow,
         days: () => allDays(), day: iso => DB.days[iso] || null, selected: () => sel };
})();
