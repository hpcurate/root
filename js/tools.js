/* TOOLS: the pomodoro, the breathing round, optimise and data.
   Config holds the lengths and the lists; tools_v1 holds state, the dials and
   the histories. Use wall-clock timestamps so sleep, throttling and reloads
   preserve elapsed time. The interval checks completion across tabs and paints
   visible readouts.

   4.8 cut this from four instruments to two. The stopwatch and the countdown
   were a phone's own two clocks with a worse readout, and the decider answered
   a question by not answering it.

   4.12 put two back, and neither is a clock the phone has. OPTIMISE is a
   stopwatch with a *route*: named lists of steps, split by split, against your
   own best — the measurement is the comparison, which is the part a phone's
   stopwatch never had. DATA is the other half of the same idea: instruments
   that write things down are only worth the writing if something reads back.

   Every instrument here now ends the same way — a finished thing is written
   into LOG's day as a block and onto DAY's schedule as a mark, through the
   calls those apps already offer anything that finishes. Neither is required
   to be present: TOOLS works alone and simply records less. */
window.TOOLS = (function () {
'use strict';

const SCOPE = '.ns-tools ';
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const view  = document.getElementById('view-tools');
const toast = msg => Shell.toast(msg);
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const KEY = 'tools_v1';

/* The dial ranges
   The on-tool sliders and the settings defaults are the same numbers read
   twice, so they are written once. A dial the tool offers that settings cannot
   set a default for is a dial you re-set every morning. */
const DIAL = {
  pomFocus:  { min:5,  max:90, step:5,    unit:'m' },
  pomBreak:  { min:1,  max:30, step:1,    unit:'m' },
  pomRounds: { min:1,  max:8,  step:1,    unit:'' },
  whfRounds: { min:1,  max:5,  step:1,    unit:'' },
  whfPace:   { min:1,  max:5,  step:0.25, unit:'s' },
  whfRecov:  { min:5,  max:30, step:1,    unit:'s' },
};
function clampDial(d, v, dflt) {
  const n = parseFloat(v);
  if (!isFinite(n)) return dflt;
  const snapped = Math.round(n / d.step) * d.step;
  return Math.min(d.max, Math.max(d.min, Math.round(snapped * 1000) / 1000));
}

/* The twenty icons
   TOOLS' own set, drawn inline rather than taken from the shell's sprite
   sheet: the sheet is the shell's vocabulary and these belong to one tool's
   lists. Each is a stroked 24x24 path, so they follow the icon weight dial
   like every other icon in the app. */
const ICONS = {
  bolt:     'M13 2 4 14h6l-1 8 9-12h-6z',
  sun:      'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  moon:     'M20 14a8 8 0 1 1-9.9-9.9A7 7 0 0 0 20 14z',
  run:      'M13.5 5.5a1.4 1.4 0 1 0 0-.01M11 21l2.2-5.2-3.2-2.2 1-4.6 3 2 3 1M7.5 14.5 9.5 9.5',
  dumbbell: 'M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10',
  book:     'M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z',
  coffee:   'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h2a2.5 2.5 0 0 1 0 5h-2',
  shower:   'M6 20V8a4 4 0 0 1 8 0M14 8h6M10 13v1M13 15v1M16 13v1M17 17v1',
  brush:    'M15 4l5 5-8 8-5-5zM7 17l-3 3 4-1z',
  music:    'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  code:     'M9 8l-5 4 5 4M15 8l5 4-5 4',
  clock:    'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  leaf:     'M5 19c0-8 5-13 14-13 0 9-5 13-11 13H5zM5 19c2-4 5-6 8-7',
  drop:     'M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3z',
  flame:    'M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1.5 0 1-4-1-8z',
  star:     'M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z',
  heart:    'M12 20s-7-4.5-7-9.5A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.5C19 15.5 12 20 12 20z',
  home:     'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  bag:      'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  target:   'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
};
const ICON_KEYS = Object.keys(ICONS);
const iconSVG = (key, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
   stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
   aria-hidden="true"><path d="${ICONS[key] || ICONS.bolt}"></path></svg>`;

/* The palette the list editor offers. Eight is enough to tell a dozen lists
   apart and few enough that each one is still a decision. */
const PALETTE = ['#e8a33d','#5ad4e6','#5cdb7d','#e06060','#b98ce8','#e8d84d','#7f9cf5','#f08fc0'];

function normHex(v) {
  const s = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('').toLowerCase();
  return '';
}

/* Content */
let POM, WHF, LISTS;
function readConfig() {
  POM = Object.assign({ focus:25, short:5, long:15, rounds:4, autoStart:false, label:'focus' },
                      Config.get('tools.pomodoro') || {});
  ['focus','short','long'].forEach(k => { POM[k] = Math.max(1, Math.min(180, +POM[k] || 1)); });
  POM.rounds = Math.max(1, Math.min(12, +POM.rounds || 4));
  POM.autoStart = !!POM.autoStart;
  POM.label = String(POM.label || 'focus').slice(0, 40) || 'focus';

  WHF = Object.assign({ rounds:3, breaths:30, pace:2.25, recovery:15, chime:true, label:'breathing' },
                      Config.get('tools.wimhof') || {});
  WHF.rounds   = Math.max(1, Math.min(10, +WHF.rounds || 3));
  WHF.breaths  = Math.max(5, Math.min(80, +WHF.breaths || 30));
  /* Seconds for one in-and-out. Below 1s nobody can follow the ring and above
     6s it is not the method any more. */
  WHF.pace     = Math.max(1, Math.min(6, +WHF.pace || 2.25));
  WHF.recovery = Math.max(5, Math.min(60, +WHF.recovery || 15));
  WHF.chime    = !!WHF.chime;
  WHF.label    = String(WHF.label || 'breathing').slice(0, 40) || 'breathing';

  /* The optimise lists. Rebuilt from their known keys rather than trusted:
     they are user content, an export can carry anything, and a list with no
     steps is a START button that measures nothing. */
  const raw = Config.get('tools.optimise');
  LISTS = (Array.isArray(raw) ? raw : []).map((l, i) => ({
    id:        String((l && l.id) || 'list' + i).slice(0, 40),
    name:      String((l && l.name) || 'list ' + (i + 1)).slice(0, 40),
    color:     normHex(l && l.color) || PALETTE[i % PALETTE.length],
    colorMode: ['accent','gradient','custom','preset'].includes(l && l.colorMode) ? l.colorMode : 'preset',
    icon:      ICONS[l && l.icon] ? l.icon : 'bolt',
    steps:     (Array.isArray(l && l.steps) ? l.steps : [])
                 .map(s => String(s || '').trim()).filter(Boolean).slice(0, 24),
  })).filter(l => l.id).slice(0, 24);
}

/* A list's colour, resolved. `accent` and `gradient` take the app's own accent
   and ignore the stored hex, so a look changed in settings carries the lists
   with it; only `custom` and `preset` keep a colour of their own. */
function listColor(l) {
  if (!l) return 'var(--y)';
  return (l.colorMode === 'accent' || l.colorMode === 'gradient') ? 'var(--y)' : l.color;
}
const listGradient = l => l && l.colorMode === 'gradient';

readConfig();

/* State */
/* `endsAt` is a wall-clock ms stamp and is the only thing that says a phase is
   running. `left` is what is left in ms while it is paused, and the two are
   never both set — a paused thing has no end, and a running thing has nothing
   banked. Every readout asks which of the two is filled. */
const blank = () => ({
  v: 3,
  tool: 'pom',
  /* `days` is the day's finished focus *count* and stays a number: it is what
     LOG's note reads, and ROOT.md §5 does not reshape a contract for a
     feature. `log` is the history beside it — the rows the tool now draws.
     `dial` is where the on-tool sliders sit, and null means "whatever settings
     says", so a default changed in settings still reaches a tool nobody has
     touched the sliders on. */
  pom:   { phase:'focus', round:1, endsAt:0, left:0, days:{}, log:{}, dial:null },
  /* The breathing round. `phase` is idle until a session starts; `startedAt`
     is when the current phase began, which is what the hold counts up from.
     `holds` collects this session's retention times, and `days` keeps the
     finished sessions per day. */
  whf:   { phase:'idle', round:1, breath:0, startedAt:0, endsAt:0, holds:[], days:{}, dial:null },
  /* OPTIMISE. `run` is the live attempt or null — one at a time, because a
     stopwatch you are not watching is not measuring you. `days` is the history
     by date and `best` is the record book: fastest total per list, and fastest
     split per list-and-step, which is what makes a split gold. */
  opt:   { run:null, days:{}, best:{ total:{}, split:{} }, filter:null, screen:'list' },
  /* DATA's two dials. Not preferences: they are where you last were in a
     history, the way DAY remembers the day you stepped to. */
  dat:   { range:'month', focus:'all' },
});

let DB = blank();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  DB = normalise(s);
}
/* Rebuilt from its known keys, never trusted. The curate cache in CREATE
   earned this rule the hard way (ROOT.md §6): one undefined array out of a
   store nobody validated took out a whole tab.

   A v1 record carries `sw`, `timer` and `decide` for instruments that no
   longer exist. They are dropped rather than migrated: there is nowhere for a
   lap list to go. `pom.days` is the one thing in a v1 record worth keeping,
   and it is kept — the day's focus count is the number LOG's note reads. */
function normalise(s) {
  const d = blank();
  if (!s || typeof s !== 'object') return d;
  const p = s.pom || {}, w = s.whf || {}, o = s.opt || {}, a = s.dat || {};
  d.tool = TOOL_KEYS.includes(s.tool) ? s.tool : 'pom';
  d.pom = {
    phase: ['focus','short','long'].includes(p.phase) ? p.phase : 'focus',
    round: Math.max(1, +p.round || 1),
    endsAt: Math.max(0, +p.endsAt || 0),
    left:   Math.max(0, +p.left || 0),
    days: (p.days && typeof p.days === 'object') ? p.days : {},
    log:  dayLists(p.log, r => ({ at: String(r.at || ''), mins: Math.max(0, +r.mins || 0) })),
    dial: p.dial && typeof p.dial === 'object' ? {
      focus:  clampDial(DIAL.pomFocus,  p.dial.focus,  null),
      brk:    clampDial(DIAL.pomBreak,  p.dial.brk,    null),
      rounds: clampDial(DIAL.pomRounds, p.dial.rounds, null),
    } : null,
  };
  d.whf = {
    phase: ['idle','breathe','hold','recover'].includes(w.phase) ? w.phase : 'idle',
    round:  Math.max(1, +w.round || 1),
    breath: Math.max(0, +w.breath || 0),
    startedAt: Math.max(0, +w.startedAt || 0),
    endsAt:    Math.max(0, +w.endsAt || 0),
    holds: Array.isArray(w.holds) ? w.holds.map(x => Math.max(0, +x || 0)).slice(0, 20) : [],
    days: dayLists(w.days, r => ({ at: String(r.at || ''), rounds: Math.max(0, +r.rounds || 0),
      holds: Array.isArray(r.holds) ? r.holds.map(x => Math.max(0, +x || 0)).slice(0, 20) : [],
      best: Math.max(0, +r.best || 0) })),
    dial: w.dial && typeof w.dial === 'object' ? {
      rounds:   clampDial(DIAL.whfRounds, w.dial.rounds,   null),
      pace:     clampDial(DIAL.whfPace,   w.dial.pace,     null),
      recovery: clampDial(DIAL.whfRecov,  w.dial.recovery, null),
    } : null,
  };
  const best = (o.best && typeof o.best === 'object') ? o.best : {};
  d.opt = {
    run: normRun(o.run),
    days: dayLists(o.days, r => ({
      at: String(r.at || ''), list: String(r.list || ''), name: String(r.name || ''),
      total: Math.max(0, +r.total || 0),
      splits: Array.isArray(r.splits) ? r.splits.map(x => Math.max(0, +x || 0)).slice(0, 24) : [],
      steps: Array.isArray(r.steps) ? r.steps.map(x => String(x || '')).slice(0, 24) : [],
    })),
    best: { total: numMap(best.total), split: numMap(best.split) },
    filter: o.filter && typeof o.filter === 'object' ? {
      sort: ['recent','fast','list'].includes(o.filter.sort) ? o.filter.sort : 'recent',
      hide: Array.isArray(o.filter.hide) ? o.filter.hide.map(String).slice(0, 24) : [],
      recordsOnly: !!o.filter.recordsOnly,
    } : null,
    screen: ['list','run','hist'].includes(o.screen) ? o.screen : 'list',
  };
  d.dat = {
    range: ['week','month','year'].includes(a.range) ? a.range : 'month',
    focus: ['all','pom','whf','opt'].includes(a.focus) ? a.focus : 'all',
  };
  /* A run whose screen said `run` but whose run is gone lands back on the
     shelf rather than on a stopwatch with nothing in it. */
  if (d.opt.screen === 'run' && !d.opt.run) d.opt.screen = 'list';
  return d;
}
/* `{ iso: [row, …] }`, every row rebuilt by the caller's shaper and the whole
   thing floored to the last 180 days. Three histories wanted the same three
   lines, so they share them. */
function dayLists(src, shape) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  Object.keys(src).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-180).forEach(k => {
    const list = Array.isArray(src[k]) ? src[k] : [];
    const rows = list.filter(r => r && typeof r === 'object').map(shape).slice(-40);
    if (rows.length) out[k] = rows;
  });
  return out;
}
function numMap(src) {
  const out = {};
  if (src && typeof src === 'object') Object.keys(src).slice(0, 400).forEach(k => {
    const n = +src[k];
    if (isFinite(n) && n > 0) out[k] = n;
  });
  return out;
}
function normRun(r) {
  if (!r || typeof r !== 'object' || !r.list) return null;
  return {
    list:      String(r.list).slice(0, 40),
    name:      String(r.name || '').slice(0, 40),
    steps:     (Array.isArray(r.steps) ? r.steps : []).map(x => String(x || '')).slice(0, 24),
    splits:    (Array.isArray(r.splits) ? r.splits : []).map(x => Math.max(0, +x || 0)).slice(0, 24),
    startedAt: Math.max(0, +r.startedAt || 0),
    elapsed:   Math.max(0, +r.elapsed || 0),
    running:   !!r.running,
  };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch {} }

/* Time */
const MIN = 60000;
/* mm:ss, and h:mm:ss once there is an hour to say. Rounded *up* so a timer
   started at 25:00 reads 25:00 rather than 24:59 for its first second. */
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(x).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
const hhmmNow = () => { const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
/* A retention is spoken in minutes and seconds and never in hundredths — it is
   a number you tell someone, not one you race. */
const holdText = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
/* A split *is* one you race, so it keeps its tenth. Past an hour it drops it
   again: at that length a tenth of a second is noise. */
function splitText(ms) {
  const t = Math.max(0, ms || 0);
  if (t >= 3600000) return clock(t);
  const s = Math.floor(t / 1000), tenth = Math.floor((t % 1000) / 100);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenth}`;
}
const today = () => Shell.today();
/* Floor a `{ iso: [] }` history to its last 180 days. Every writer calls it,
   because a store that only grows is the one bug none of them notice. */
function floorDays(map) {
  const out = {};
  Object.keys(map).sort().slice(-180).forEach(k => { out[k] = map[k]; });
  return out;
}
/* The last N days as ISO strings, oldest first — every chart's x axis. */
function lastDays(n) {
  const out = [];
  const d = new Date(today() + 'T12:00:00');
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getTime() - i * 86400000);
    out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') +
             '-' + String(x.getDate()).padStart(2, '0'));
  }
  return out;
}

/* Writing a finished thing down
   The block goes to LOG and the mark goes to DAY, both through the calls those
   apps already offer to anything that finishes something. Neither is required
   to be present: an app switched off simply records less. Since 4.12 all four
   instruments end here rather than only the breathing round. */
function writeDown(label) {
  const name = String(label || '').trim();
  if (!name) return;
  try { if (window.LOG && LOG.setBlock) LOG.setBlock(name, true); } catch {}
  try { if (window.CAL && CAL.markDone) CAL.markDone(name, true); } catch {}
}

/* The pomodoro */
/* The live numbers: the dial where one has been moved, the config default
   where it has not. One reader, so nothing downstream has to know which. */
const pomFocus  = () => (DB.pom.dial && DB.pom.dial.focus  != null) ? DB.pom.dial.focus  : POM.focus;
const pomBreak  = () => (DB.pom.dial && DB.pom.dial.brk    != null) ? DB.pom.dial.brk    : POM.short;
const pomRounds = () => (DB.pom.dial && DB.pom.dial.rounds != null) ? DB.pom.dial.rounds : POM.rounds;
const PHASES = {
  focus: { label:'focus',       mins: () => pomFocus(),     cls:'focus' },
  short: { label:'short break', mins: () => pomBreak(),     cls:'break' },
  long:  { label:'long break',  mins: () => POM.long,       cls:'break' },
};
const pomPhase  = () => PHASES[DB.pom.phase] || PHASES.focus;
const pomTotal  = () => pomPhase().mins() * MIN;
const pomLeft   = () => DB.pom.endsAt ? Math.max(0, DB.pom.endsAt - Date.now()) : DB.pom.left;
const pomRunning= () => !!DB.pom.endsAt;
/* Today's finished focus rounds. Kept per day so the number on the band is
   "what I have done today" and not a lifetime total nobody acts on. */
const pomToday  = () => Math.max(0, +DB.pom.days[today()] || 0);

function pomStart() {
  const left = pomLeft() || pomTotal();
  DB.pom.endsAt = Date.now() + left;
  DB.pom.left = 0;
  save(); render();
}
function pomPause() {
  if (!pomRunning()) return;
  DB.pom.left = pomLeft();
  DB.pom.endsAt = 0;
  save(); render();
}
function pomReset() {
  DB.pom.endsAt = 0; DB.pom.left = 0;
  save(); render();
}
/* The next phase in the cycle: `rounds` focuses, each followed by a short
   break, and a long one after the last. The round counter is what says which
   of the two a break is, so it advances on the focus that just ended rather
   than on the break — a break is not a round. */
function pomAdvance(finished) {
  const p = DB.pom;
  if (p.phase === 'focus') {
    if (finished) {
      const k = today();
      p.days[k] = (+p.days[k] || 0) + 1;
      /* Only the last 90 days are kept: the tally is a "today" number and a
         year of them is a store that only grows. */
      const floor = Object.keys(p.days).sort().slice(-90);
      p.days = floor.reduce((o, d) => { o[d] = p.days[d]; return o; }, {});
      /* And the row beside it, which is what the history draws. */
      p.log[k] = (p.log[k] || []).concat([{ at: hhmmNow(), mins: pomFocus() }]).slice(-40);
      p.log = floorDays(p.log);
      writeDown(POM.label);
    }
    p.phase = (p.round % pomRounds() === 0) ? 'long' : 'short';
  } else {
    if (p.phase === 'long') p.round = 1; else p.round = p.round + 1;
    p.phase = 'focus';
  }
  p.endsAt = 0; p.left = 0;
  if (POM.autoStart) { p.endsAt = Date.now() + pomTotal(); }
  save();
}
function pomSkip() { pomAdvance(false); render(); toast(pomPhase().label); }

/* The breathing round
   Three phases per round, and only two of them have a length:

     breathe   `breaths` breaths at `pace` seconds each. The ring is the breath,
               not the phase — it fills on the way in and empties on the way
               out, so the thing you follow is the thing you do.
     hold      the retention, after the last exhale. It counts **up** and has no
               end: how long you last is the measurement, and a timer that cut
               it off at a guess would be measuring the guess. Tapping ends it.
     recover   `recovery` seconds after the big inhale, counting down.

   The method is Wim Hof's; since 4.12 the instrument is called what it is. The
   storage path is still `wimhof` — ROOT.md §5 does not rename one for a word. */
const whfRounds = () => (DB.whf.dial && DB.whf.dial.rounds   != null) ? DB.whf.dial.rounds   : WHF.rounds;
const whfPace   = () => (DB.whf.dial && DB.whf.dial.pace     != null) ? DB.whf.dial.pace     : WHF.pace;
const whfRecov  = () => (DB.whf.dial && DB.whf.dial.recovery != null) ? DB.whf.dial.recovery : WHF.recovery;
const whfOn      = () => DB.whf.phase !== 'idle';
const whfTotalBreath = () => WHF.breaths * whfPace() * 1000;
const whfLeft = () => DB.whf.endsAt ? Math.max(0, DB.whf.endsAt - Date.now()) : 0;
const whfHeld = () => DB.whf.startedAt ? Date.now() - DB.whf.startedAt : 0;
const whfToday = () => (DB.whf.days[today()] || []).length;

function whfStart() {
  DB.whf.phase = 'breathe';
  DB.whf.round = 1;
  DB.whf.breath = 0;
  DB.whf.holds = [];
  DB.whf.startedAt = Date.now();
  DB.whf.endsAt = Date.now() + whfTotalBreath();
  save(); render(); announce('round 1 · breathe');
}
/* The breathing is over; the retention begins and is not timed by us. */
function whfToHold() {
  DB.whf.phase = 'hold';
  DB.whf.endsAt = 0;
  DB.whf.startedAt = Date.now();
  save(); render(); announce('hold');
}
/* The user says when the hold ends, which is the only honest way to end it. */
function whfEndHold() {
  if (DB.whf.phase !== 'hold') return;
  DB.whf.holds.push(whfHeld());
  DB.whf.phase = 'recover';
  DB.whf.startedAt = Date.now();
  DB.whf.endsAt = Date.now() + whfRecov() * 1000;
  save(); render(); announce('breathe in · hold it');
}
function whfNextRound() {
  if (DB.whf.round >= whfRounds()) { whfFinish(); return; }
  DB.whf.round += 1;
  DB.whf.breath = 0;
  DB.whf.phase = 'breathe';
  DB.whf.startedAt = Date.now();
  DB.whf.endsAt = Date.now() + whfTotalBreath();
  save(); render(); announce('round ' + DB.whf.round + ' · breathe');
}

function whfFinish() {
  const w = DB.whf;
  const k = today();
  const best = w.holds.length ? Math.max(...w.holds) : 0;
  const session = { at: hhmmNow(), rounds: w.holds.length, holds: w.holds.slice(), best };
  w.days[k] = (w.days[k] || []).concat([session]).slice(-40);
  w.days = floorDays(w.days);

  w.phase = 'idle'; w.round = 1; w.breath = 0; w.startedAt = 0; w.endsAt = 0; w.holds = [];
  save();
  writeDown(WHF.label);

  render(); renderSettings();
  toast(session.rounds
    ? `${session.rounds} round${session.rounds === 1 ? '' : 's'} · best ${holdText(best)} · written to log`
    : 'session done');
}
function whfStop() {
  Shell.confirm('Stop the session?\nNothing is written down — a session counts when it finishes.', () => {
    DB.whf = Object.assign(DB.whf, { phase:'idle', round:1, breath:0, startedAt:0, endsAt:0, holds:[] });
    save(); render();
  });
}
/* Calling out the phase
   The cue is a **toast**, not a tone this module plays. ROOT has exactly one
   place that makes noise and it is shell.js (§3) — an app that reaches for the
   sound engine itself is the thing that rule exists to stop, and a harness
   check fails on it. Shell.toast already sounds, so a toast is the cue *and*
   the instruction, which is the better half of the trade: a breathing round is
   done with your eyes shut, and "breathe in" tells you more than a note does. */
function announce(msg) { if (WHF.chime && msg) toast(msg); }

/* Which breath the round is on, derived from the clock rather than counted, so
   a backgrounded tab comes back to the right number. */
function whfBreathNow() {
  if (DB.whf.phase !== 'breathe') return 0;
  const gone = whfTotalBreath() - whfLeft();
  return Math.min(WHF.breaths, Math.floor(gone / (whfPace() * 1000)) + 1);
}
/* 0 → 1 → 0 across one breath: in on the first half, out on the second. */
function whfBreathFrac() {
  if (DB.whf.phase !== 'breathe') return 0;
  const per = whfPace() * 1000;
  const gone = (whfTotalBreath() - whfLeft()) % per;
  const half = per / 2;
  return gone < half ? gone / half : 1 - (gone - half) / half;
}

/* OPTIMISE
   A run is a list of steps against the clock. Two buttons and nothing else:
   one starts and pauses, one completes the step you are on. The splits appear
   under them as they land, and a split faster than the best that list has ever
   posted for that step is **gold** — the point of the instrument is not the
   time, it is the comparison, and gold is the comparison made visible.

   `elapsed` banks the time while paused, `startedAt` is the wall clock while
   running, and — exactly as the timers above — the two are never both live. */
const optList  = id => LISTS.find(l => l.id === id) || null;
const bestKey  = (listId, i) => listId + ' ' + i;
const optRun   = () => DB.opt.run;
function optElapsed() {
  const r = optRun();
  if (!r) return 0;
  return r.running ? r.elapsed + (Date.now() - r.startedAt) : r.elapsed;
}
/* Where the current split started: the sum of the ones already banked. */
const optSplitBase = () => (optRun() ? optRun().splits.reduce((a, b) => a + b, 0) : 0);
const optStepNow   = () => (optRun() ? optRun().splits.length : 0);

function optStart(id) {
  const l = optList(id);
  if (!l) return;
  if (!l.steps.length) { toast('add steps to this list in settings first'); return; }
  DB.opt.run = { list: l.id, name: l.name, steps: l.steps.slice(), splits: [],
                 startedAt: 0, elapsed: 0, running: false };
  DB.opt.screen = 'run';
  save(); render();
}
function optToggle() {
  const r = optRun(); if (!r) return;
  if (r.running) { r.elapsed = optElapsed(); r.running = false; r.startedAt = 0; }
  else { r.startedAt = Date.now(); r.running = true; }
  save(); render();
}
/* Complete the step you are on. The clock keeps running through it — a route
   has no gap between its steps, and stopping it to record one would measure
   the recording. */
function optStep() {
  const r = optRun(); if (!r) return;
  if (!r.running && !r.elapsed) { optToggle(); return; }   // first tap starts it
  const at = optElapsed();
  r.splits.push(Math.max(0, at - optSplitBase()));
  if (r.splits.length >= r.steps.length) { optFinish(); return; }
  save(); render();
}
function optFinish() {
  const r = optRun(); if (!r) return;
  const total = optElapsed();
  const k = today();
  const row = { at: hhmmNow(), list: r.list, name: r.name, total,
                splits: r.splits.slice(), steps: r.steps.slice() };
  DB.opt.days[k] = (DB.opt.days[k] || []).concat([row]).slice(-40);
  DB.opt.days = floorDays(DB.opt.days);

  /* The record book, updated before the run is thrown away — a personal best
     is the only thing a finished run is *for*. */
  const b = DB.opt.best;
  const wasTotal = b.total[r.list] || 0;
  const beatTotal = total > 0 && (!wasTotal || total < wasTotal);
  if (beatTotal) b.total[r.list] = total;
  let goldSplits = 0;
  r.splits.forEach((ms, i) => {
    const key = bestKey(r.list, i);
    if (ms > 0 && (!b.split[key] || ms < b.split[key])) { b.split[key] = ms; goldSplits++; }
  });

  DB.opt.run = null;
  DB.opt.screen = 'list';
  save();
  writeDown(r.name);
  render(); renderSettings();
  toast(beatTotal ? `${splitText(total)} · new record · written to log`
                  : `${splitText(total)}${goldSplits ? ` · ${goldSplits} gold` : ''} · written to log`);
}
function optAbandon() {
  if (!optRun()) { DB.opt.screen = 'list'; save(); render(); return; }
  Shell.confirm('Throw this run away?\nNothing is written down — a run counts when its last step lands.', () => {
    DB.opt.run = null; DB.opt.screen = 'list';
    save(); render();
  });
}
/* Every finished run, newest first, with its list resolved. The history and
   every chart in DATA read this rather than walking `days` themselves. */
function optRuns() {
  const out = [];
  Object.keys(DB.opt.days).sort().reverse().forEach(k => {
    (DB.opt.days[k] || []).slice().reverse().forEach(r => out.push(Object.assign({ date: k }, r)));
  });
  return out;
}
const optFilter = () => DB.opt.filter || (DB.opt.filter = { sort:'recent', hide:[], recordsOnly:false });

/* The tick
   One interval for the whole app, running whatever tab is on screen, and doing
   nothing at all when nothing is running. It has two jobs and they are not the
   same job: **finishing** a phase, which must happen wherever you are, and
   **painting** the readout, which only matters if the readout is on screen.

   200ms rather than 1000: the breathing ring is an animation and a second-long
   tick under it would step rather than breathe. It is also what lets OPTIMISE
   show a tenth without a second interval. */
let timer = null;
function needsTick() { return pomRunning() || whfOn() || !!(optRun() && optRun().running); }
function syncTick() {
  if (needsTick() && !timer) timer = setInterval(tick, 200);
  else if (!needsTick() && timer) { clearInterval(timer); timer = null; }
}
function tick() {
  let fired = false;
  if (pomRunning() && pomLeft() <= 0) {
    const was = pomPhase().label;
    pomAdvance(true);
    toast(was + ' done · ' + pomPhase().label + ' next');
    fired = true;
  }
  if (DB.whf.phase === 'breathe' && whfLeft() <= 0) { whfToHold(); return; }
  if (DB.whf.phase === 'recover' && whfLeft() <= 0) { whfNextRound(); return; }
  /* A phase ending changes more than the digits — the ring's colour, the
     button's word, the round — so that is a full draw. Every other tick moves
     the things that actually moved, because rebuilding the body five times a
     second would take the focus out of anything under a finger. */
  if (fired) { render(); return; }
  if (isOn()) paint();
  syncTick();
}
/* The shell marks the live slide `.cur`, not `.on` — `.on` is a *screen*
   inside a slide, and TOOLS has one of those. */
const isOn = () => !!view && view.classList.contains('cur');

/* Screens */
/* Every instrument this build has, in the order they ship. Which of them the
   strip actually carries, and in what order, is `toolsShown` — the same shape
   the tab bar's `apps` has, for the same reason. */
const ALL_TOOLS = [
  { key:'pom', label:'pomodoro',  icon:'clock' },
  { key:'whf', label:'breathing', icon:'drop' },
  { key:'opt', label:'optimise',  icon:'bolt' },
  { key:'dat', label:'data',      icon:'target' },
];
const TOOL_KEYS = ALL_TOOLS.map(t => t.key);
/* Never empty: a strip with nothing on it is a screen with nothing to do, and
   Prefs already refuses to store an empty list — this is the second guard, for
   a build where every id in the stored list has since been retired. */
function shown() {
  const want = (window.Prefs && Prefs.get('toolsShown')) || TOOL_KEYS;
  const out = want.filter(k => TOOL_KEYS.includes(k));
  return out.length ? out : TOOL_KEYS.slice();
}
const toolsOn = () => shown().map(k => ALL_TOOLS.find(t => t.key === k)).filter(Boolean);
function tool() {
  const on = shown();
  return on.includes(DB.tool) ? DB.tool : on[0];
}

/* The strip, the glider and the scroll-into-view are CREATE's, line for line —
   ROOT.md §6 names the pair, because a third copy of a shape is a third thing
   to keep in step. */
function renderTabs() {
  const bar = $id('tl-tabs'); if (!bar) return;
  const list = toolsOn();
  const sel = tool();
  const sig = list.map(t => t.key).join('|');
  if (bar.dataset.sig !== sig) {
    bar.dataset.sig = sig;
    bar.innerHTML = `<div class="tl-tglide"></div>` + list.map(t =>
      `<button class="tl-tab${t.key === sel ? ' active' : ''}" data-act="tool" data-t="${esc(t.key)}"
              >${esc(t.label)}</button>`).join('');
  } else {
    bar.querySelectorAll('.tl-tab').forEach(b => b.classList.toggle('active', b.dataset.t === sel));
  }
  const active = bar.querySelector('.tl-tab.active');
  const glider = bar.querySelector('.tl-tglide');
  if (!active || !glider) return;
  glider.style.width = active.offsetWidth + 'px';
  glider.style.transform = `translateX(${active.offsetLeft}px)`;
  if (bar.scrollWidth <= bar.clientWidth) return;
  const left = active.offsetLeft, right = left + active.offsetWidth;
  if (left < bar.scrollLeft) bar.scrollLeft = left;
  else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth;
}

/* The band: what the number opposite the wordmark is counting depends on the
   instrument, because "3" means nothing without it. */
function paintBand() {
  const box = $id('tl-daynum'), lab = $id('tl-label');
  const t = tool();
  let n = 0, word = '';
  if (t === 'pom')      { n = pomToday(); word = 'focus rounds today'; }
  else if (t === 'whf') { n = whfToday(); word = n === 1 ? 'session today' : 'sessions today'; }
  else if (t === 'opt') { n = (DB.opt.days[today()] || []).length; word = n === 1 ? 'run today' : 'runs today'; }
  else {
    /* DATA has nothing of its own to count, so it counts what it is reading:
       the days any instrument put something on. */
    n = Object.keys(DB.pom.log).concat(Object.keys(DB.whf.days), Object.keys(DB.opt.days))
          .filter((x, i, a) => a.indexOf(x) === i).length;
    word = n === 1 ? 'day on record' : 'days on record';
  }
  if (lab) lab.textContent = word;
  if (box && window.Shell && Shell.rollNum) Shell.rollNum(box, String(n), n);
}

/* The big readout
   One shape for every instrument that has a clock: a ring that empties, the
   time inside it, and a word under it. It is an SVG circle with a dash offset
   rather than a conic-gradient, so it animates on the property browsers can
   animate cheaply and it is the same drawing at any size. */
const R = 78, CIRC = 2 * Math.PI * R;
const layout = () => (window.Prefs && Prefs.get('toolsLayout')) || 'ring';

/* The readout, four ways.
   Every layout is handed the same 0-to-1 fraction and the same two strings, and
   every one of them carries `#tl-big`, `#tl-sub` and a `--tl-frac` on its outer
   box — so paint() moves one number and one word and does not care which
   drawing is on screen. That is the whole reason these are four *layouts* and
   not four forks of the instrument.

     ring    the original: an SVG circle emptying anticlockwise.
     bar     a departure board — the time set in big tabular figures, a hairline
             rule under it filling left to right, nothing enclosing anything.
     stack   a column of blocks that fill from the bottom, so the readout has a
             quantity you can see across the room rather than a number to read.
     plain   no container at all: the time, very large, and a word under it.

   `--tl-breath` is separate from `--tl-frac` because the breathing disc swells
   and settles on its own curve — see the note in tools.css. */
function readoutHTML(frac, cls, big, sub, pips, breath) {
  const f = Math.max(0, Math.min(1, frac));
  const lay = layout();
  const vars = `--tl-frac:${f.toFixed(4)}` + (breath == null ? '' : `;--tl-breath:${breath.toFixed(3)}`);
  const inner = `<div class="tl-read">
      <div class="tl-big" id="tl-big">${esc(big)}</div>
      <div class="tl-sub" id="tl-sub">${esc(sub)}</div>
    </div>`;

  if (lay === 'ring') {
    const off = CIRC * (1 - f);
    return `<div class="tl-ring ${cls}" style="${vars}">
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle class="tr" cx="90" cy="90" r="${R}"></circle>
        <circle class="tp" cx="90" cy="90" r="${R}"
                stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
      </svg>
      ${inner}
    </div>${pips || ''}`;
  }

  if (lay === 'bar') {
    return `<div class="tl-bar ${cls}" style="${vars}">
      ${inner}
      <div class="tl-rule"><i></i></div>
    </div>${pips || ''}`;
  }

  if (lay === 'stack') {
    /* Twelve blocks is enough to read a fraction at a glance and few enough
       that each one is still a block rather than a stripe. */
    let cells = '';
    for (let i = 0; i < 12; i++) cells += `<i style="--n:${i}"></i>`;
    return `<div class="tl-stack ${cls}" style="${vars}">
      <div class="tl-cells">${cells}</div>
      ${inner}
    </div>${pips || ''}`;
  }

  return `<div class="tl-plain ${cls}" style="${vars}">
    ${inner}
    <div class="tl-underline"><i></i></div>
  </div>${pips || ''}`;
}
/* Kept under its old name so the call sites read the same as they did. */
const ringHTML = readoutHTML;

/* Rounds as dots rather than "round 2 of 4". A count you read is a count you
   have to do; a row of dots is one you see. */
function pipsHTML(done, total, cls) {
  let out = '';
  for (let i = 0; i < total; i++) out += `<i class="${i < done ? 'on' : ''}"></i>`;
  return `<div class="tl-pips ${cls || ''}">${out}</div>`;
}

/* The play button
   Square since 4.12, with its size and its corner on two dials in settings —
   the corner as a *share* of the size, so 50 is a circle whatever the size is
   and the two never have to be set in step. Both are custom properties Prefs
   writes on the root, so this is a class rather than a style attribute. */
function bigBtn(act, label, glyph, extra) {
  return `<button class="tl-big-btn${extra ? ' ' + extra : ''}" data-act="${esc(act)}"
          aria-label="${esc(label)}">${glyph}</button>`;
}
const PLAY  = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg>';
const TICK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/* An on-tool slider. The value is the dial where one has been moved and the
   config default where it has not, and the readout says which — a dial that
   never says "default" is a dial you cannot get back. */
function dialHTML(act, spec, label, value, isDefault) {
  return `<div class="tl-dial" data-slider="${esc(act)}">
    <div class="tl-dial-head">
      <span class="dl-lbl">${esc(label)}</span>
      <span class="dl-val${isDefault ? ' is-def' : ''}">${esc(value)}${esc(spec.unit)}${
        isDefault ? '<em>default</em>' : ''}</span>
    </div>
    <input type="range" class="sl" data-dial="${esc(act)}"
           min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}"
           aria-label="${esc(label)}">
  </div>`;
}
/* The whole rack, folded away behind one word. The instrument is the thing on
   screen; the dials are what you came back to change once. */
function dialsHTML(open, body) {
  return `<div class="tl-dials${open ? ' open' : ''}">
    <button class="tl-dials-tog" data-act="dials" aria-expanded="${!!open}">
      <span>adjust</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    ${open ? `<div class="tl-dial-body">${body}
      <button class="tl-dial-reset" data-act="dials-reset">back to the defaults</button>
    </div>` : ''}
  </div>`;
}
let dialsOpen = false;

function pomHTML() {
  const total = pomTotal(), left = pomLeft() || total;
  const ph = pomPhase();
  const done = pomToday();
  const running = pomRunning();
  const d = DB.pom.dial || {};
  return ringHTML(left / total, ph.cls + (running ? ' live' : ''), clock(left), ph.label,
                  pipsHTML(DB.pom.round - 1, pomRounds(), 'focus')) + `
    <div class="tl-main">
      ${bigBtn('pom-toggle', running ? 'pause' : 'start', running ? PAUSE : PLAY, running ? 'on' : '')}
    </div>
    <div class="tl-side">
      <button class="tl-icon" data-act="pom-skip" aria-label="skip this phase">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l9 7-9 7z"/><line x1="18" y1="5" x2="18" y2="19"/></svg>
        <span>skip</span>
      </button>
      <button class="tl-icon" data-act="pom-reset" aria-label="reset this phase">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><polyline points="3 4 3 10 9 10"/></svg>
        <span>reset</span>
      </button>
    </div>
    <div class="tl-tally">${done
      ? `<b>${done}</b> focus round${done === 1 ? '' : 's'} today`
      : 'nothing finished yet today'}</div>
    ${dialsHTML(dialsOpen,
      dialHTML('pom-focus',  DIAL.pomFocus,  'focus',  pomFocus(),  d.focus  == null) +
      dialHTML('pom-brk',    DIAL.pomBreak,  'break',  pomBreak(),  d.brk    == null) +
      dialHTML('pom-rounds', DIAL.pomRounds, 'rounds', pomRounds(), d.rounds == null))}
    ${pomHistoryHTML()}`;
}

function whfHTML() {
  const w = DB.whf;
  const sessions = DB.whf.days[today()] || [];
  const d = DB.whf.dial || {};
  const dials = dialsHTML(dialsOpen,
    dialHTML('whf-rounds', DIAL.whfRounds, 'rounds',   whfRounds(), d.rounds   == null) +
    dialHTML('whf-pace',   DIAL.whfPace,   'breath',   whfPace(),   d.pace     == null) +
    dialHTML('whf-recov',  DIAL.whfRecov,  'recovery', whfRecov(),  d.recovery == null));

  if (!whfOn()) {
    return ringHTML(0, 'whf ready', String(whfRounds()), 'rounds ready',
                    pipsHTML(0, whfRounds(), 'whf')) + `
      <div class="tl-main">
        ${bigBtn('whf-start', 'start the session', PLAY, 'go')}
      </div>
      <div class="tl-tally">${esc(WHF.breaths)} breaths · ${esc(whfPace())}s each · ${esc(whfRecov())}s recovery</div>
      ${dials}
      ${whfHistoryHTML()}`;
  }

  const ph = w.phase;
  const stop = `<div class="tl-side one"><button class="tl-icon" data-act="whf-stop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg><span>stop</span></button></div>`;

  if (ph === 'breathe') {
    const n = whfBreathNow();
    const frac = whfBreathFrac();
    const per = whfPace() * 1000;
    const inBreath = (whfTotalBreath() - whfLeft()) % per < per / 2;
    return ringHTML(frac, 'whf breathe live', String(n), inBreath ? 'breathe in' : 'let go',
                    pipsHTML(w.round - 1, whfRounds(), 'whf'), frac) + `
      <div class="tl-main">
        <button class="tl-big-btn wide" data-act="whf-hold" aria-label="go to the hold">
          <span>hold now</span>
        </button>
      </div>
      <div class="tl-tally"><b>${esc(n)}</b> of ${esc(WHF.breaths)} · round ${esc(w.round)} of ${esc(whfRounds())}</div>
      ${stop}`;
  }

  if (ph === 'hold') {
    const best = w.holds.length ? Math.max(...w.holds) : 0;
    return ringHTML(1, 'whf hold live', holdText(whfHeld()), 'hold',
                    pipsHTML(w.round - 1, whfRounds(), 'whf')) + `
      <div class="tl-main">
        <button class="tl-big-btn wide go" data-act="whf-breathe" aria-label="end the hold and breathe in">
          <span>breathe in</span>
        </button>
      </div>
      <div class="tl-tally">round ${esc(w.round)} of ${esc(whfRounds())}${
        best ? ` · best so far ${esc(holdText(best))}` : ''}</div>
      ${stop}`;
  }

  const left = whfLeft(), tot = whfRecov() * 1000;
  const last = w.holds[w.holds.length - 1] || 0;
  return ringHTML(left / tot, 'whf recover live', clock(left), 'hold it in',
                  pipsHTML(w.round, whfRounds(), 'whf')) + `
    <div class="tl-main">
      <button class="tl-big-btn wide" data-act="whf-next" aria-label="skip to the next round">
        <span>${w.round >= whfRounds() ? 'finish' : 'next round'}</span>
      </button>
    </div>
    <div class="tl-tally">held <b>${esc(holdText(last))}</b> · round ${esc(w.round)} of ${esc(whfRounds())}</div>`;
}

/* The histories
   Lines and nothing else. A row is a time, a shape and a number, and the one
   thing worth *finding* on it — the best hold of a session, a run that set a
   record — is the one thing that carries the accent. Everything else is grey
   on purpose: if three things are highlighted, nothing is. */
function histHead(word, right) {
  return `<div class="tl-sec"><span>${esc(word)}</span>${right ? `<em>${esc(right)}</em>` : ''}</div>`;
}
/* A day's worth of rows under the date it happened, for the last 14 days that
   have anything in them. Longer than that is DATA's question, not this one's. */
function recentDays(map, n) {
  return Object.keys(map).sort().reverse().filter(k => (map[k] || []).length).slice(0, n || 14);
}
/* "today", "yesterday", then the short date — a date you have to decode is a
   date you skip over. */
function dayWord(k) {
  const t = today();
  if (k === t) return 'today';
  const y = new Date(new Date(t + 'T12:00:00').getTime() - 86400000);
  const yk = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') +
             '-' + String(y.getDate()).padStart(2, '0');
  if (k === yk) return 'yesterday';
  const d = new Date(k + 'T12:00:00');
  return isNaN(d) ? k : d.getDate() + ' ' + MONTHS[d.getMonth()];
}
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function pomHistoryHTML() {
  const days = recentDays(DB.pom.log, 14);
  if (!days.length) return '';
  const counts = days.map(k => (DB.pom.log[k] || []).length);
  const best = Math.max(...counts);
  return histHead('History', `best day ${best}`) + days.map(k => {
    const rows = DB.pom.log[k] || [];
    const mins = rows.reduce((a, r) => a + (+r.mins || 0), 0);
    /* The day that matched the best day is the one worth seeing. */
    const good = rows.length === best && best > 1;
    return `<div class="tl-row${good ? ' good' : ''}">
      <span class="rw-day">${esc(dayWord(k))}</span>
      <span class="rw-bars">${rows.map(r =>
        `<i style="--w:${Math.max(2, Math.min(1, (+r.mins || 25) / 60) * 100)}%"
            title="${esc(r.at)}"></i>`).join('')}</span>
      <span class="rw-n">${esc(rows.length)}<em>${esc(Math.round(mins))}m</em></span>
    </div>`;
  }).join('');
}

function whfHistoryHTML() {
  const days = recentDays(DB.whf.days, 14);
  if (!days.length) return '';
  let allTime = 0;
  Object.keys(DB.whf.days).forEach(k => (DB.whf.days[k] || []).forEach(s => {
    allTime = Math.max(allTime, +s.best || 0);
  }));
  return histHead('History', allTime ? `best hold ${holdText(allTime)}` : '') + days.map(k => {
    const rows = DB.whf.days[k] || [];
    const dayBest = rows.reduce((m, s) => Math.max(m, +s.best || 0), 0);
    return `<div class="tl-row${dayBest && dayBest === allTime ? ' good' : ''}">
      <span class="rw-day">${esc(dayWord(k))}</span>
      <span class="rw-holds">${rows.map(s => (s.holds || []).map(h =>
        `<b${(+h === +s.best && +h === allTime) ? ' class="best"' : ''}>${esc(holdText(h))}</b>`
      ).join('')).join('<i class="rw-gap"></i>')}</span>
      <span class="rw-n">${esc(rows.length)}<em>×</em></span>
    </div>`;
  }).join('');
}

/* OPTIMISE's three screens */
function optHTML() {
  if (DB.opt.screen === 'run' && optRun()) return optRunHTML();
  if (DB.opt.screen === 'hist') return optHistHTML();
  return optShelfHTML();
}

/* The shelf: one row per list — its icon, its name, its fastest time and a
   START. The fastest time is on the row because it is the reason to press the
   button, not a detail behind it. */
function optShelfHTML() {
  if (!LISTS.length) {
    return `<div class="tl-empty">
      <p>No lists yet.</p>
      <p class="sm">A list is a thing you do in a fixed order — a morning routine, a
        pack-down, a set-up. Name it in settings, give it its steps, and it appears
        here with a START and your best time on it.</p>
    </div>${optBarHTML()}`;
  }
  return `<div class="tl-lists">${LISTS.map(l => {
    const best = DB.opt.best.total[l.id] || 0;
    const c = listColor(l);
    return `<div class="tl-list${listGradient(l) ? ' grad' : ''}" style="--lc:${esc(c)}">
      <span class="tl-list-ic">${iconSVG(l.icon)}</span>
      <span class="tl-list-nm">
        <b>${esc(l.name)}</b>
        <em>${l.steps.length} step${l.steps.length === 1 ? '' : 's'}${
          best ? ` · best ${esc(splitText(best))}` : ' · no time yet'}</em>
      </span>
      <button class="tl-go" data-act="opt-start" data-l="${esc(l.id)}">start</button>
    </div>`;
  }).join('')}</div>${optBarHTML()}`;
}
const optBarHTML = () => `<div class="tl-side">
  <button class="tl-icon" data-act="opt-hist">
    ${iconSVG('clock')}<span>history</span>
  </button>
</div>`;

/* The run: the clock, the step you are on, and two buttons — one for the
   clock, one for the step. Everything under them is the splits as they land. */
function optRunHTML() {
  const r = optRun();
  const l = optList(r.list);
  const c = l ? listColor(l) : 'var(--y)';
  const at = optElapsed();
  const i = optStepNow();
  const step = r.steps[i] || 'done';
  const live = at - optSplitBase();
  /* The readout's fraction is how far through the *steps* it is: a route has
     no length in seconds until it is over, so there is nothing else honest for
     a ring to fill with. */
  const frac = r.steps.length ? i / r.steps.length : 0;
  return `<div class="tl-runhead" style="--lc:${esc(c)}">
      <button class="tl-back" data-act="opt-abandon" aria-label="leave this run">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <span>${l ? iconSVG(l.icon) : ''}<b>${esc(r.name)}</b></span>
    </div>` +
    ringHTML(frac, 'opt' + (r.running ? ' live' : ''), splitText(at),
             `${i + 1} of ${r.steps.length} · ${step}`,
             pipsHTML(i, r.steps.length, 'opt')) + `
    <div class="tl-main two">
      ${bigBtn('opt-toggle', r.running ? 'pause' : 'start', r.running ? PAUSE : PLAY, r.running ? 'on' : '')}
      ${bigBtn('opt-step', 'complete this step', TICK, 'step' + (r.running ? ' go' : ''))}
    </div>
    ${optSplitsHTML(r)}`;
}

/* The splits, as they land. Gold is a split faster than the best that list has
   posted for that step — shiny, because a record should look like one. */
function optSplitsHTML(r) {
  if (!r.splits.length) return `<div class="tl-tally">tap the tick as each step lands</div>`;
  const b = DB.opt.best.split;
  return `<div class="tl-splits">${r.splits.map((ms, i) => {
    const prev = b[bestKey(r.list, i)] || 0;
    const gold = ms > 0 && (!prev || ms < prev);
    const delta = prev ? ms - prev : 0;
    return `<div class="tl-split${gold ? ' gold' : ''}">
      <span class="sp-n">${i + 1}</span>
      <span class="sp-nm">${esc(r.steps[i] || '')}</span>
      <span class="sp-t">${esc(splitText(ms))}</span>
      <span class="sp-d">${gold ? 'record' : delta ? (delta > 0 ? '+' : '−') + splitText(Math.abs(delta)) : ''}</span>
    </div>`;
  }).join('')}</div>`;
}

/* The history: every run, with the filters the shelf cannot carry. */
function optHistHTML() {
  const f = optFilter();
  let runs = optRuns();
  if (f.hide.length) runs = runs.filter(r => !f.hide.includes(r.list));
  if (f.recordsOnly) runs = runs.filter(r => (DB.opt.best.total[r.list] || 0) === r.total && r.total > 0);
  if (f.sort === 'fast') runs = runs.slice().sort((a, b) => a.total - b.total);
  else if (f.sort === 'list') runs = runs.slice().sort((a, b) =>
    a.name === b.name ? b.total - a.total : (a.name > b.name ? 1 : -1));

  const chip = (act, val, word, on) =>
    `<button class="tl-chip${on ? ' on' : ''}" data-act="${act}" data-v="${esc(val)}">${esc(word)}</button>`;

  return `<div class="tl-runhead">
      <button class="tl-back" data-act="opt-shelf" aria-label="back to the lists">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <span><b>history</b></span>
    </div>
    <div class="tl-chips">
      ${chip('opt-sort', 'recent', 'recent', f.sort === 'recent')}
      ${chip('opt-sort', 'fast',   'fastest', f.sort === 'fast')}
      ${chip('opt-sort', 'list',   'by list', f.sort === 'list')}
      ${chip('opt-records', '', 'records only', f.recordsOnly)}
    </div>
    ${LISTS.length > 1 ? `<div class="tl-chips soft">${LISTS.map(l =>
      `<button class="tl-chip sm${f.hide.includes(l.id) ? '' : ' on'}" data-act="opt-hide" data-v="${esc(l.id)}"
               style="--lc:${esc(listColor(l))}">${esc(l.name)}</button>`).join('')}</div>` : ''}
    ${!runs.length ? `<div class="tl-empty"><p>Nothing to show.</p>
      <p class="sm">Finish a run and it lands here.</p></div>`
      : `<div class="tl-hist">${runs.slice(0, 120).map(r => {
      const l = optList(r.list);
      const rec = (DB.opt.best.total[r.list] || 0) === r.total && r.total > 0;
      return `<div class="tl-hrow${rec ? ' gold' : ''}" style="--lc:${esc(l ? listColor(l) : 'var(--y)')}">
        <span class="hr-ic">${l ? iconSVG(l.icon) : ''}</span>
        <span class="hr-nm"><b>${esc(r.name)}</b><em>${esc(dayWord(r.date))} · ${esc(r.at)}</em></span>
        <span class="hr-t">${esc(splitText(r.total))}${rec ? '<i>record</i>' : ''}</span>
      </div>`;
    }).join('')}</div>`}`;
}

/* DATA
   LOG's month grid taught this app that a chart is worth more than a table, and
   this is that idea pointed at the instruments: what a week of focus actually
   looked like, where the breathing went, which list is getting faster.

   Everything here is inline SVG against the same tokens the rest of the app
   uses. No library, no canvas — the charts are small, the data is at most a
   year of days, and an SVG scales with the density dial for free. */
const DAT_RANGE = { week:7, month:30, year:365 };
const datDays  = () => DAT_RANGE[DB.dat.range] || 30;
const datFocus = () => DB.dat.focus;

/* One number per day for a given series, over the current range. */
function series(kind, days) {
  return days.map(k => {
    if (kind === 'pom') return (DB.pom.log[k] || []).reduce((a, r) => a + (+r.mins || 0), 0);
    if (kind === 'whf') return (DB.whf.days[k] || []).length;
    if (kind === 'opt') return (DB.opt.days[k] || []).length;
    return 0;
  });
}
const SERIES = [
  { key:'pom', word:'focus',     unit:'min', c:'var(--y)' },
  { key:'whf', word:'breathing', unit:'',    c:'#5ad4e6' },
  { key:'opt', word:'runs',      unit:'',    c:'#e8a33d' },
];
const datSeries = () => SERIES.filter(s => datFocus() === 'all' || datFocus() === s.key);

function datHTML() {
  const days = lastDays(datDays());
  const sets = datSeries();
  const totals = sets.map(s => ({ s, v: series(s.key, days).reduce((a, b) => a + b, 0) }));
  const any = totals.some(t => t.v > 0);

  const chip = (act, val, word, on) =>
    `<button class="tl-chip${on ? ' on' : ''}" data-act="${act}" data-v="${esc(val)}">${esc(word)}</button>`;

  const head = `<div class="tl-chips">
      ${chip('dat-range', 'week',  'week',  DB.dat.range === 'week')}
      ${chip('dat-range', 'month', 'month', DB.dat.range === 'month')}
      ${chip('dat-range', 'year',  'year',  DB.dat.range === 'year')}
    </div>
    <div class="tl-chips soft">
      ${chip('dat-focus', 'all', 'everything', datFocus() === 'all')}
      ${SERIES.map(s => chip('dat-focus', s.key, s.word, datFocus() === s.key)).join('')}
    </div>`;

  if (!any) return head + `<div class="tl-empty"><p>Nothing recorded yet.</p>
    <p class="sm">Finish a focus round, a breathing session or a run and this fills in.</p></div>`;

  return head +
    datTilesHTML(totals, days) +
    datBarsHTML(days, sets) +
    datPieHTML(totals) +
    datRoseHTML(days, sets) +
    datStreakHTML(days, sets);
}

/* The tiles: the one number per series that answers "how much". */
function datTilesHTML(totals, days) {
  return `<div class="tl-tiles">${totals.map(t => {
    const per = t.v / Math.max(1, days.length);
    return `<div class="tl-tile" style="--lc:${t.s.c}">
      <b>${esc(t.v % 1 ? t.v.toFixed(1) : t.v)}</b>
      <span>${esc(t.s.word)}${t.s.unit ? ' · ' + esc(t.s.unit) : ''}</span>
      <em>${esc(per < 10 ? per.toFixed(1) : Math.round(per))} a day</em>
    </div>`;
  }).join('')}</div>`;
}

/* The bars: the range, day by day. Columns rather than a line, because a day
   with nothing in it should read as a gap and a line would draw through it. */
function datBarsHTML(days, sets) {
  const W = 320, H = 96;
  const cols = days.length;
  const gap = cols > 60 ? 0.5 : cols > 20 ? 1.4 : 3;
  const w = Math.max(1, (W - gap * (cols - 1)) / cols);
  let max = 1;
  sets.forEach(s => series(s.key, days).forEach(v => { max = Math.max(max, v); }));
  const body = sets.map(s => {
    const vals = series(s.key, days);
    return `<g fill="${s.c}" opacity="${sets.length > 1 ? 0.72 : 1}">` + vals.map((v, i) => {
      if (!v) return '';
      const h = Math.max(1.5, (v / max) * (H - 8));
      return `<rect x="${(i * (w + gap)).toFixed(2)}" y="${(H - h).toFixed(2)}"
                    width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(1.5, w / 2).toFixed(2)}"/>`;
    }).join('') + '</g>';
  }).join('');
  return `<div class="tl-sec"><span>Day by day</span><em>peak ${esc(max % 1 ? max.toFixed(1) : max)}</em></div>
    <div class="tl-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
        role="img" aria-label="each day in the range">${body}</svg>
      <div class="tl-axis"><span>${esc(dayWord(days[0]))}</span><span>${esc(dayWord(days[days.length - 1]))}</span></div>
    </div>`;
}

/* The pie: the share each instrument took of the range. Only drawn when there
   is more than one slice — a pie with one slice is a circle. */
function datPieHTML(totals) {
  const live = totals.filter(t => t.v > 0);
  if (live.length < 2) return '';
  /* Minutes and counts are not the same unit, so each series is normalised to
     its own share of *itself* across the range before they are compared. This
     is a picture of balance, not of time, and the caption says so. */
  const sum = live.reduce((a, t) => a + t.v, 0);
  let at = -Math.PI / 2;
  const R2 = 46, CX = 56, CY = 56;
  const slices = live.map(t => {
    const frac = t.v / sum;
    const end = at + frac * Math.PI * 2;
    const big = frac > 0.5 ? 1 : 0;
    const p = `M${CX} ${CY} L${(CX + R2 * Math.cos(at)).toFixed(2)} ${(CY + R2 * Math.sin(at)).toFixed(2)}
               A${R2} ${R2} 0 ${big} 1 ${(CX + R2 * Math.cos(end)).toFixed(2)} ${(CY + R2 * Math.sin(end)).toFixed(2)} Z`;
    at = end;
    return `<path d="${p}" fill="${t.s.c}"/>`;
  }).join('');
  return `<div class="tl-sec"><span>The split</span><em>share of the range</em></div>
    <div class="tl-pie">
      <svg viewBox="0 0 112 112" role="img" aria-label="share of the range by instrument">
        ${slices}<circle cx="${CX}" cy="${CY}" r="22" fill="var(--s1)"/>
      </svg>
      <div class="tl-key">${live.map(t => `<span style="--lc:${t.s.c}">
        <i></i>${esc(t.s.word)}<b>${Math.round((t.v / sum) * 100)}%</b></span>`).join('')}</div>
    </div>`;
}

/* The nightingale: the week as a wheel, each weekday a wedge whose *radius* is
   how much that day usually holds. A bar chart answers "when"; this one
   answers "which day am I", which is the only question a weekday shape is
   good for. */
function datRoseHTML(days, sets) {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  sets.forEach(s => {
    const vals = series(s.key, days);
    /* Each series normalised to its own peak before they are added, so minutes
       do not drown out a count of three. */
    const peak = Math.max(1, ...vals);
    days.forEach((k, i) => {
      const d = new Date(k + 'T12:00:00').getDay();
      buckets[(d + 6) % 7] += vals[i] / peak;
    });
  });
  const max = Math.max(...buckets);
  if (!max) return '';
  const NAMES = ['mon','tue','wed','thu','fri','sat','sun'];
  const CX = 80, CY = 80, RMAX = 66, seg = (Math.PI * 2) / 7;
  const wedges = buckets.map((v, i) => {
    const r = 12 + (v / max) * (RMAX - 12);
    const a0 = -Math.PI / 2 + i * seg + 0.03, a1 = a0 + seg - 0.06;
    const p = `M${CX} ${CY} L${(CX + r * Math.cos(a0)).toFixed(2)} ${(CY + r * Math.sin(a0)).toFixed(2)}
               A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(CX + r * Math.cos(a1)).toFixed(2)} ${(CY + r * Math.sin(a1)).toFixed(2)} Z`;
    return `<path d="${p}" fill="var(--y)" opacity="${(0.3 + 0.7 * (v / max)).toFixed(2)}"/>`;
  }).join('');
  const labels = NAMES.map((n, i) => {
    const a = -Math.PI / 2 + i * seg + seg / 2;
    return `<text x="${(CX + 73 * Math.cos(a)).toFixed(1)}" y="${(CY + 73 * Math.sin(a) + 3).toFixed(1)}"
             text-anchor="middle">${n}</text>`;
  }).join('');
  const top = NAMES[buckets.indexOf(max)];
  return `<div class="tl-sec"><span>Which day</span><em>${esc(top)} leads</em></div>
    <div class="tl-rose"><svg viewBox="0 0 160 172" role="img" aria-label="the week as a wheel">
      ${wedges}${labels}</svg></div>`;
}

/* The streak: how many of the last days had anything at all on them. One
   number and a strip, which is the whole of what a streak is. */
function datStreakHTML(days, sets) {
  const hit = days.map(k => sets.some(s => series(s.key, [k])[0] > 0));
  const done = hit.filter(Boolean).length;
  let run = 0;
  for (let i = hit.length - 1; i >= 0 && hit[i]; i--) run++;
  return `<div class="tl-sec"><span>Kept up</span><em>${done} of ${days.length} days</em></div>
    <div class="tl-strip">${hit.map(h => `<i class="${h ? 'on' : ''}"></i>`).join('')}</div>
    <div class="tl-tally">${run ? `<b>${run}</b> day${run === 1 ? '' : 's'} running` : 'nothing today yet'}</div>`;
}

/* Only the readout is repainted on a tick — rebuilding the whole body five
   times a second would take the focus out of anything under a finger. The
   shape is written once by render(); paint() moves what actually changes. */
function paint() {
  const t = tool();
  const big = $id('tl-big'), sub = $id('tl-sub');
  const ring = view && view.querySelector('.tl-ring .tp');
  let text = '', frac = 0, word = null;
  if (t === 'pom') {
    const total = pomTotal(), l = pomLeft() || total;
    text = clock(l); frac = l / total;
  } else if (t === 'opt') {
    const r = optRun();
    if (!r) return;
    text = splitText(optElapsed());
    frac = r.steps.length ? r.splits.length / r.steps.length : 0;
  } else if (DB.whf.phase === 'breathe') {
    const per = whfPace() * 1000;
    const gone = (whfTotalBreath() - whfLeft()) % per;
    text = String(whfBreathNow());
    frac = whfBreathFrac();
    word = gone < per / 2 ? 'breathe in' : 'let go';
  } else if (DB.whf.phase === 'hold') {
    text = holdText(whfHeld()); frac = 1;
  } else if (DB.whf.phase === 'recover') {
    const l = whfLeft(); text = clock(l); frac = l / (whfRecov() * 1000);
  } else return;
  const f = Math.max(0, Math.min(1, frac));
  if (big) big.textContent = text;
  if (word && sub && sub.textContent !== word) sub.textContent = word;
  if (ring) ring.setAttribute('stroke-dashoffset', (CIRC * (1 - f)).toFixed(1));
  /* Every layout reads the fraction off its own box, so this one write drives
     the bar's fill, the stack's blocks and the underline as well as the ring. */
  const box = view && view.querySelector('.tl-ring,.tl-bar,.tl-stack,.tl-plain');
  if (box) {
    box.style.setProperty('--tl-frac', f.toFixed(4));
    if (DB.whf.phase === 'breathe') box.style.setProperty('--tl-breath', f.toFixed(3));
  }
}

function render() {
  renderTabs();
  paintBand();
  const box = $id('tl-body');
  if (box) {
    const t = tool();
    box.className = 'tl-body t-' + t;
    box.innerHTML = t === 'pom' ? pomHTML()
                  : t === 'whf' ? whfHTML()
                  : t === 'opt' ? optHTML()
                  : datHTML();
  }
  syncTick();
}

/* The delegated listener */
document.addEventListener('click', ev => {
  if (!ev.target.closest || !ev.target.closest('.ns-tools')) return;
  const t = ev.target.closest('[data-act]');
  const act = t && t.dataset.act;
  if (!act || t.disabled) return;

  if (act === 'tool')        { DB.tool = t.dataset.t; save(); render(); return; }
  if (act === 'dials')       { dialsOpen = !dialsOpen; render(); return; }
  if (act === 'dials-reset') { resetDials(); return; }
  if (act === 'pom-toggle')  { pomRunning() ? pomPause() : pomStart(); return; }
  if (act === 'pom-skip')    { pomSkip(); return; }
  if (act === 'pom-reset')   { pomReset(); return; }
  if (act === 'whf-start')   { whfStart(); return; }
  if (act === 'whf-hold')    { whfToHold(); return; }
  if (act === 'whf-breathe') { whfEndHold(); return; }
  if (act === 'whf-next')    { whfNextRound(); return; }
  if (act === 'whf-stop')    { whfStop(); return; }

  if (act === 'opt-start')   { optStart(t.dataset.l); return; }
  if (act === 'opt-toggle')  { optToggle(); return; }
  if (act === 'opt-step')    { optStep(); return; }
  if (act === 'opt-abandon') { optAbandon(); return; }
  if (act === 'opt-hist')    { DB.opt.screen = 'hist'; save(); render(); return; }
  if (act === 'opt-shelf')   { DB.opt.screen = 'list'; save(); render(); return; }
  if (act === 'opt-sort')    { optFilter().sort = t.dataset.v; save(); render(); return; }
  if (act === 'opt-records') { const f = optFilter(); f.recordsOnly = !f.recordsOnly; save(); render(); return; }
  if (act === 'opt-hide')    {
    const f = optFilter(), id = t.dataset.v, i = f.hide.indexOf(id);
    if (i < 0) f.hide.push(id); else f.hide.splice(i, 1);
    save(); render(); return;
  }

  if (act === 'dat-range')   { DB.dat.range = t.dataset.v; save(); render(); return; }
  if (act === 'dat-focus')   { DB.dat.focus = t.dataset.v; save(); render(); return; }

  if (act === 'reset')       { resetAll(); return; }
});

/* The on-tool sliders. `input` rather than `change` so the readout follows the
   thumb; the full body is not rebuilt on every pixel — only the number beside
   the slider moves — and the instrument reads the dial live. A dial moved
   while a phase is running takes effect on the phase after it, which is the
   only sane answer: re-timing a running focus round would move a finish line
   somebody is walking towards. */
document.addEventListener('input', ev => {
  const el = ev.target;
  if (!el || !el.dataset || !el.dataset.dial) return;
  if (!el.closest || !el.closest('.ns-tools')) return;
  const which = el.dataset.dial;
  const spec = DIAL_OF[which];
  if (!spec) return;
  const v = clampDial(spec.range, el.value, spec.range.min);
  const bag = DB[spec.on].dial || (DB[spec.on].dial = {});
  bag[spec.field] = v;
  save();
  const row = el.closest('.tl-dial');
  const out = row && row.querySelector('.dl-val');
  if (out) { out.textContent = v + spec.range.unit; out.classList.remove('is-def'); }
  /* Whatever the dial reshapes on the readout — the pips, the "rounds ready"
     number, the tally — is repainted, but not while a phase is mid-flight. */
  if (!needsTick()) {
    const keep = document.activeElement === el ? which : null;
    render();
    if (keep) { const again = view.querySelector(`[data-dial="${keep}"]`); if (again) again.focus(); }
  }
});
const DIAL_OF = {
  'pom-focus':  { on:'pom', field:'focus',    range:DIAL.pomFocus },
  'pom-brk':    { on:'pom', field:'brk',      range:DIAL.pomBreak },
  'pom-rounds': { on:'pom', field:'rounds',   range:DIAL.pomRounds },
  'whf-rounds': { on:'whf', field:'rounds',   range:DIAL.whfRounds },
  'whf-pace':   { on:'whf', field:'pace',     range:DIAL.whfPace },
  'whf-recov':  { on:'whf', field:'recovery', range:DIAL.whfRecov },
};
function resetDials() {
  const t = tool();
  if (t === 'pom') DB.pom.dial = null;
  else if (t === 'whf') DB.whf.dial = null;
  save(); render();
  toast('back to the defaults');
}

/* Settings */
function renderSettings() {
  const st = document.querySelector('.ns-tools #tl-status');
  if (st) {
    const n = pomToday(), s = whfToday(), r = (DB.opt.days[today()] || []).length;
    const running = [pomRunning() && 'pomodoro', whfOn() && WHF.label,
                     optRun() && optRun().running && 'a run'].filter(Boolean);
    st.className = 'settings-status ' + (running.length ? 'ok' : 'idle');
    st.textContent = (running.length ? running.join(' + ') + ' running' : 'nothing running') +
      ` · ${n} focus round${n === 1 ? '' : 's'} · ${s} session${s === 1 ? '' : 's'} · ${r} run${r === 1 ? '' : 's'} today`;
  }
  renderStrip();
}

/* Which instruments the strip carries, and in what order. The same editor
   shape the app list in appearance → layout has: a row per thing, a switch,
   and two arrows. A tool cannot be moved out of the list, only switched off —
   the order *is* the list, so an off tool keeps its place for when it comes
   back on. */
function renderStrip() {
  const box = document.querySelector('.ns-tools #tl-strip');
  if (!box) return;
  const on = shown();
  /* On tools first, in their order, then the off ones in shipping order — the
     same reading the app list gives. */
  const rows = on.concat(TOOL_KEYS.filter(k => !on.includes(k)));
  box.innerHTML = rows.map((k, i) => {
    const t = ALL_TOOLS.find(x => x.key === k);
    const isOn = on.includes(k);
    const pos = on.indexOf(k);
    return `<div class="tl-strip-row${isOn ? '' : ' off'}">
      <span class="ts-ic">${iconSVG(t.icon)}</span>
      <span class="ts-nm">${esc(t.label)}</span>
      <span class="ts-mv">
        <button class="ts-arw" data-act="tl-up" data-k="${esc(k)}"
                ${isOn && pos > 0 ? '' : 'disabled'} aria-label="move ${esc(t.label)} up">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>
        <button class="ts-arw" data-act="tl-down" data-k="${esc(k)}"
                ${isOn && pos >= 0 && pos < on.length - 1 ? '' : 'disabled'} aria-label="move ${esc(t.label)} down">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
      </span>
      <button class="tog${isOn ? ' on' : ''}" data-act="tl-toggle" data-k="${esc(k)}"
              role="switch" aria-checked="${isOn}" aria-label="show ${esc(t.label)}"></button>
    </div>`;
  }).join('');
}
function setShown(list) {
  const out = list.filter(k => TOOL_KEYS.includes(k));
  Prefs.set('toolsShown', out.length ? out : [TOOL_KEYS[0]]);
  renderStrip(); render();
}
document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('.ns-tools [data-act]');
  const act = t && t.dataset.act;
  if (!act || !t.dataset.k) return;
  const k = t.dataset.k;
  const on = shown();
  if (act === 'tl-toggle') {
    if (on.includes(k)) {
      if (on.length <= 1) { toast('one instrument has to stay'); return; }
      setShown(on.filter(x => x !== k));
    } else setShown(on.concat([k]));
    return;
  }
  if (act === 'tl-up' || act === 'tl-down') {
    const i = on.indexOf(k);
    const j = act === 'tl-up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= on.length) return;
    const next = on.slice();
    next[i] = next[j]; next[j] = k;
    setShown(next);
  }
});

function resetAll() {
  Shell.confirm('Reset TOOLS?\nEvery running clock stops, and the day’s focus count, sessions, runs and records go. The lengths and the lists are settings and stay.', () => {
    DB = blank();
    save(); syncTick(); render(); renderSettings();
    toast('tools reset');
  });
}

load();

Config.subscribe(() => { readConfig(); render(); renderSettings(); });
/* 4.9 gave TOOLS its first *Prefs* dial (the readout layout) and this was the
   line it needed to go with it: every other app has subscribed to Prefs for
   versions, TOOLS had nothing to subscribe for. Without it the dial was set,
   the chip lit, and the screen carried on drawing the old layout — which is
   what "the new layouts are not selectable" actually was. 4.12 added the strip
   and the button's two dials to the same line. */
Prefs.subscribe(k => {
  if (k === '*' || k === 'toolsLayout' || k === 'toolsShown') render();
  if (k === '*' || k === 'toolsShown') renderStrip();
});

Shell.register('tools', {
  onShow: () => { render(); syncTick(); },
  onDayChange: () => { paintBand(); render(); },
  /* The tab tapped while you are already on it means "go back to the top
     screen". For three of the four instruments that is where you already are;
     for OPTIMISE it is the shelf, and being dropped back on it from a history
     screen is the whole point of the gesture. A *run* is left alone — losing
     one to a stray tap on the tab bar is exactly what this must not do. */
  home: () => { if (DB.opt.screen === 'hist') { DB.opt.screen = 'list'; save(); render(); } },
  search: q => {
    const out = ALL_TOOLS.filter(t => t.label.includes(q)).map(t => ({
      title: t.label, sub: 'tools',
      go: () => { DB.tool = t.key; save();
                  Shell.TABS.includes('tools') ? Shell.go('tools') : Shell.open('tools');
                  render(); } }));
    LISTS.filter(l => l.name.toLowerCase().includes(q)).forEach(l => out.push({
      title: l.name, sub: 'tools · optimise',
      go: () => { DB.tool = 'opt'; DB.opt.screen = 'list'; save();
                  Shell.TABS.includes('tools') ? Shell.go('tools') : Shell.open('tools');
                  render(); } }));
    return out;
  },
});

render();

return { render, renderSettings, renderStrip, resetAll,
         /* Re-read what is stored. Only the harness has a reason to ask — the
            app reads once at boot and is the only thing that writes after.
            CREATE's `reload` for CREATE's reason. */
         reload: () => { load(); render(); renderSettings(); },
         state: () => JSON.parse(JSON.stringify(DB)),
         /* The icon set, the palette and the drawing itself, so the settings
            editor offers exactly what the tool can draw rather than keeping a
            second copy of the list in step with this one. */
         icons: () => ICON_KEYS.slice(),
         palette: () => PALETTE.slice(),
         iconHTML: k => iconSVG(k),
         /* read-only, for LOG's note and anything else that wants the day's
            focus time, breathing and runs without reaching into the store */
         today: () => {
           const s = DB.whf.days[today()] || [];
           const r = DB.opt.days[today()] || [];
           return { rounds: pomToday(), minutes: pomToday() * pomFocus(),
                    sessions: s.length,
                    best: s.reduce((m, x) => Math.max(m, +x.best || 0), 0),
                    runs: r.length };
         } };
})();
