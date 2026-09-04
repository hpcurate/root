// ROOT boot + behaviour harness (jsdom).
//   cd root/test && npm install && node harness.mjs [path-to-root]
// Boots the real index.html with the scripts read from disk (stylesheets and
// fonts are skipped — jsdom does not lay out or paint), then drives it through
// DOM events. Every behaviour fixed in 2.1 has a check here; add one for each
// behaviour you fix, and a bug that has a check does not come back.
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(HERE, '..'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

class LocalLoader extends ResourceLoader {
  fetch(url) {
    const u = new URL(url);
    if (u.hostname === 'localhost' && u.pathname.endsWith('.js')) {
      const p = path.join(ROOT, u.pathname.replace(/^\/root\//, ''));
      return Promise.resolve(fs.readFileSync(p));
    }
    return Promise.resolve(Buffer.from(''));   // css, fonts, favicon: nothing to run
  }
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail?.message || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

let fetchScript = async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' });
let confirmCalls = 0, confirmAnswer = true;

const dom = new JSDOM(html, {
  url: 'http://localhost/root/index.html',
  runScripts: 'dangerously',
  resources: new LocalLoader(),
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
    w.requestAnimationFrame = fn => setTimeout(fn, 0);
    w.Element.prototype.scrollIntoView = function () {};
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.confirm = () => { confirmCalls++; return confirmAnswer; };
    w.fetch = (...a) => fetchScript(...a);
    w.navigator.vibrate = () => true;
  },
});

const w = dom.window, d = w.document;
await new Promise(r => w.addEventListener('load', r));
await new Promise(r => setTimeout(r, 50));

let pass = 0, fail = 0;
const results = [];
/* A throw part-way through used to take every result with it, which left a
   typo in one check looking identical to a broken app. Print what ran first. */
const bail = e => { console.log(results.join('\n'));
  console.error('\nthrew before the end:\n' + ((e && e.stack) || e)); process.exit(1); };
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);
function check(name, cond, note) {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name}${note ? ' — ' + note : ''}`); }
}
const $ = s => d.querySelector(s);
const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
const today = iso(new w.Date());
const offset = (n) => { const x = new w.Date(); x.setDate(x.getDate() + n); return iso(x); };
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const key = (k, target = d) => target.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

// ── 1. boot ──────────────────────────────────────────────────────────────────
check('modules defined', ['Prefs','Config','Creds','Shell','DO','LOG','PLAN','STORE','SET'].every(k => w[k]));
check('no console/jsdom errors at boot', errors.length === 0, errors.slice(0, 3).join(' | '));
for (const t of w.Prefs.THEMES) { w.Prefs.set('theme', t.id); }
check('all themes apply', d.documentElement.dataset.theme === 'noir');
w.Prefs.set('theme', 'void');
for (const p of ['look','layout','behave','do','log','plan','store','tend','track','learn','data']) w.SET.panel(p);
check('every settings panel renders', errors.length === 0, errors.slice(0, 3).join(' | '));

// ── 2. settings routing ─────────────────────────────────────────────────────
w.Shell.go('plan');
w.PLAN.connectTodoist();                     // no token → routes to the key panel
await tick();
check("PLAN 'no key' routes to the data panel", $('.ns-set .set-panel.on')?.dataset.panel === 'data',
  'landed on ' + $('.ns-set .set-panel.on')?.dataset.panel);
check('conn-status text no longer says General', !/General/.test($('.ns-plan #conn-status').textContent));

// ── 3. keyboard while an overlay is open + Escape ───────────────────────────
w.Shell.go('store');
w.STORE.openPad();
key('3');
check('digit keys stay with the numpad, do not switch tab', $('.tab-b.on').getAttribute('aria-label') === 'STORE');
check('numpad received the digit', /3/.test($('.ns-store #pad-amt').textContent));
key('Escape');
check('Escape closes the numpad', !$('.ns-store #pad').classList.contains('on'));
w.STORE.openCartLog();
key('Escape');
check('Escape closes the cart log', !$('.ns-store #clog').classList.contains('on'));

// ── 4. confirmDestructive honoured app-wide ─────────────────────────────────
$('.ns-store #manual-input').value = 'milk'; w.STORE.addManual();
w.Prefs.set('confirmDestructive', false);
confirmCalls = 0;
w.STORE.confirmClearList();
check('STORE clear list skips confirm() when the pref is off', confirmCalls === 0 &&
  JSON.parse(w.localStorage.getItem('store_state_v1')).list.length === 0, 'confirm calls ' + confirmCalls);
w.Prefs.set('confirmDestructive', true);
confirmCalls = 0; confirmAnswer = false;
w.DO.resetDay();
check('DO resetDay asks when the pref is on', confirmCalls === 1);
confirmAnswer = true;

// ── 5. STORE classifier follows aisle edits ─────────────────────────────────
const cats = w.Config.get('store.categories');
cats.vegetables.items.push('zzzfoo');
w.Config.set('store.categories', cats);
$('.ns-store #manual-input').value = 'zzzfoo'; w.STORE.addManual();
const st = JSON.parse(w.localStorage.getItem('store_state_v1'));
check('new aisle vocabulary is used immediately', st.list.find(i => i.name === 'zzzfoo')?.cat === 'vegetables',
  'filed under ' + st.list.find(i => i.name === 'zzzfoo')?.cat);
w.Config.reset('store.categories');

// ── 6. PLAN partial send keeps only the failed tasks ────────────────────────
w.Creds.save('tok');
let n = 0;
fetchScript = async (url, opts) => {
  if (opts?.method === 'POST') { n++; return n === 2
    ? { ok: false, status: 500, json: async () => ({}), text: async () => '' }
    : { ok: true, status: 200, json: async () => ({ id: 'x' + n }), text: async () => '{}' }; }
  return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
};
w.Shell.go('plan');
for (const name of ['a', 'b', 'c']) {          // through the real form: unmapped → confirm() → queued
  w.PLAN.openProj('home'); w.PLAN.pickSub('home', 0);
  $('.ns-plan #task-name').value = name; w.PLAN.addToQueue();
}
check('three tasks queued through the form', JSON.parse(w.localStorage.getItem('plan_queue')).length === 3);
w.PLAN.go('sending');
await tick(600);
const q = JSON.parse(w.localStorage.getItem('plan_queue') || '[]');
check('only the failed task stays queued after a partial send', q.length === 1 && q[0].name === 'b', 'queue now ' + q.map(t => t.name).join(','));

// ── 7. LOG streak ────────────────────────────────────────────────────────────
const day = (m, e) => JSON.stringify({ date: 'x', scale: 5, m: Object.assign({ wt:'', sl:'', nrg:'', mood:'', cs_on:null, cs:'', wkg:'', km:'', wo:'', tkg:'', tmin:'' }, m),
  e: Object.assign({ kme:'', nrg:'', mood:'', stress:'', meds_lam:false, meds_rit:false, meals:[], caf_c:0, caf_ed:0, cur_mix:0, cur_prod:0, cur_cont:0, blocks:[] }, e), entries: [] });
w.localStorage.removeItem('log_' + today);
w.localStorage.setItem('log_' + offset(-1), day({ wt: '07:00' }, { kme: '2' }));
w.localStorage.setItem('log_' + offset(-2), day({ wt: '07:00' }, { kme: '2' }));
w.LOG.resetDate();
check('streak counts back from yesterday when today is not logged yet', /2 days/.test($('.ns-log #h-streak').textContent),
  'streak text: "' + $('.ns-log #h-streak').textContent + '"');
w.localStorage.setItem('log_' + offset(-3), day({ sl: '7' }, {}));           // morning only, no wake time
w.Config.set('log.streakRequires', 'morning');
w.LOG.resetDate();
check("streakRequires 'morning' counts a morning-only day", /3 days/.test($('.ns-log #h-streak').textContent),
  'streak text: "' + $('.ns-log #h-streak').textContent + '"');
w.Config.reset('log.streakRequires');
w.Config.set('log.fields', Object.assign(w.Config.get('log.fields'), { wakeTime: false }));
w.LOG.go('morning'); $('.ns-log #m-sl').value = '8'; w.LOG.saveMorning();
check('morning card is done without a wake time when that field is off', $('.ns-log #card-m').classList.contains('done'));
w.Config.reset('log.fields');

// ── 8. LOG km target + week start ───────────────────────────────────────────
w.Config.set('log.kmTarget', 8);
w.LOG.go('history');
check('km chart reads the configured target', /8 km\/day/.test($('.ns-log .kmc-goal')?.textContent || ''),
  $('.ns-log .kmc-goal')?.textContent);
w.Prefs.set('weekStart', 'sun');
w.LOG.go('history');
check('week start pref moves the km chart to Sunday', $('.ns-log .kmc-day')?.textContent === 'S');
w.Prefs.set('weekStart', 'mon');
w.Config.reset('log.kmTarget');

// ── 9. onclick values with quotes ───────────────────────────────────────────
errors.length = 0;
w.Config.set('log.blocks', [{ name: "it's \"odd\" \\ block", color: '#ffffff' }]);
w.LOG.go('evening');
const blk = $('.ns-log .blk-b');
click(blk);
check('a block name with quotes still toggles', blk.classList.contains('on') && errors.length === 0, errors[0]);
w.Config.reset('log.blocks');
w.Config.set('do.routines', { r1: { label: "Rick's", items: ["it's \\ tricky"] } });
w.Config.set('do.tabs', [{ id: 'daily', label: 'daily', routines: ['r1'] }]);
w.DO.openRoutine('r1');
click($('.ns-do .item-btn'));
check('a routine item with quotes still ticks', $('.ns-do .item-btn').classList.contains('checked') && errors.length === 0, errors[0]);
w.Config.reset('do.routines'); w.Config.reset('do.tabs');

// ── 10. day rollover ────────────────────────────────────────────────────────
w.DO.go('home');
w.DO.openRoutine('routinep1'); click($('.ns-do .item-btn')); w.DO.go('home');   // a tick today → do_<today> exists
check('a tick writes today\'s record', w.localStorage.getItem('do_' + today) !== null);
const tomorrow = offset(1);                  // before the mock: offset() reads w.Date
const RealDate = w.Date;
w.Date = class extends RealDate {
  constructor(...a) { a.length ? super(...a) : super(RealDate.now() + 86400000); }
  static now() { return RealDate.now() + 86400000; }
};
const rolled = w.Shell.checkDay();
check('shell notices the day changed', rolled === true);
check('DO switched to the new day (label moved, old day swept, ticks cleared)',
  $('.ns-do #date-label').textContent === w.Prefs.formatDate(tomorrow).toUpperCase() &&
  w.localStorage.getItem('do_' + today) === null &&
  /0 \/ /.test($('.ns-do #home-grid .card .card-s').textContent),
  $('.ns-do #date-label').textContent + ' | ' + $('.ns-do #home-grid .card .card-s').textContent);
w.DO.openRoutine('routinep1'); click($('.ns-do .item-btn')); w.DO.go('home');
check('a tick after midnight lands in the new day\'s record', w.localStorage.getItem('do_' + tomorrow) !== null);
check('Todoist token survived the day sweep', w.localStorage.getItem('do_todoist_v1') !== null);
check('LOG followed to the new day on its home screen', $('.ns-log #btn-today').classList.contains('hidden'));
w.Date = RealDate;
w.Shell.checkDay();                          // and back to the real today for everything that follows

// ── 11. Prefs fixes ─────────────────────────────────────────────────────────
w.Prefs.preview('paper');
check('preview of a light theme also flips data-mode', d.documentElement.dataset.mode === 'light');
w.Prefs.revert();
w.Prefs.set('displayFont', 'system'); w.Prefs.set('monoFont', 'system');
const fl = d.getElementById('root-fonts');
check('no font link pointing at the page itself', !fl || (fl.getAttribute('href') && fl.getAttribute('href') !== ''),
  fl && 'href="' + fl.getAttribute('href') + '"');
w.Prefs.set('displayFont', 'auto'); w.Prefs.set('monoFont', 'auto');
w.Prefs.set('dateFormat', 'iso');
check('PLAN and STORE home dates follow the date format', $('.ns-plan #home-date').textContent === today &&
  $('.ns-store #date-label').textContent === today, $('.ns-plan #home-date').textContent);
w.Prefs.set('dateFormat', 'long');

// ── 12. meals beyond 4 survive the note parser ──────────────────────────────
const note = `*:LiCalendar: ${offset(-1)}*\n| meals         | 1,2,5,6 |\n| meals_count   | 4 |\n| scale         | 1-5 |\n`;
w.LOG.go('reports');
$('.ns-log #rep-paste').value = note;
w.LOG.parseNotes();
click($('.ns-log #rep-week-btns .rep-btn'));
check('parsed meals above 4 are kept', /\| meals \| 4 total/.test($('.ns-log #rep-pre').textContent),
  ($('.ns-log #rep-pre').textContent.match(/\| meals \|[^\n]*/) || [])[0]);

// ── 13. hash deep link into a settings panel ────────────────────────────────
w.location.hash = '#settings/data';
w.dispatchEvent(new w.Event('hashchange'));
await tick();
check('#settings/<panel> opens that panel', $('.tab-b.on').getAttribute('aria-label') === 'Settings' &&
  $('.ns-set .set-panel.on')?.dataset.panel === 'data');

// ── 14. content editor: select with data-cfg commits on change ──────────────
w.SET.panel('log');                     // LOG's content editors sit at the end of its own panel
const sel = $('.ns-set select[data-cfg="log.streakRequires"]');
if (sel) { sel.value = 'evening'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); }
check('streak rule select commits to Config', w.Config.get('log.streakRequires') === 'evening', sel ? 'got ' + w.Config.get('log.streakRequires') : 'no select rendered');
w.Config.reset('log.streakRequires');

// ── 15. 2.2 — three more apps in the track ─────────────────────────────────
check('TEND, TRACK, LEARN defined', ['TEND', 'TRACK', 'LEARN'].every(k => w[k]));
check('nine tabs, settings last', w.Shell.TABS.length === 9 && w.Shell.TABS[8] === 'settings', w.Shell.TABS.join(','));
check('the pill no longer flags "many" tabs (the arrows always stay)', d.documentElement.dataset.tabs === undefined);
errors.length = 0;
for (const p of ['tend', 'track', 'learn']) w.SET.panel(p);
check('the three new settings panels render', errors.length === 0, errors.slice(0, 3).join(' | '));
w.Shell.go('do');
key('5'); check('key 5 jumps to TEND', $('.tab-b.on')?.dataset.app === 'tend', $('.tab-b.on')?.dataset.app);
key('7'); check('key 7 jumps to LEARN', $('.tab-b.on')?.dataset.app === 'learn', $('.tab-b.on')?.dataset.app);

// the app list: order + visibility
w.Prefs.set('apps', ['track', 'do']);
check('app list reorders the track', w.Shell.TABS.join(',') === 'track,do,settings' &&
  $('#track .view:not(.hidden)')?.id === 'view-track',
  w.Shell.TABS.join(',') + ' | first visible ' + $('#track .view:not(.hidden)')?.id);
check('a switched-off app has no tab', $('.tab-b[data-app="log"]').classList.contains('hidden') && $('#view-log').classList.contains('hidden'));
check('landed on the first shown app after LEARN was hidden', $('.tab-b.on')?.dataset.app === 'track', $('.tab-b.on')?.dataset.app);
w.Prefs.reset('apps');
check('reset restores all nine in shipped order', w.Shell.TABS.join(',') === 'do,log,plan,store,tend,track,learn,cal,settings', w.Shell.TABS.join(','));
w.Prefs.set('colorfulTabs', true);
check('colour-coded tabs are keyed by app, not position', errors.length === 0);   // CSS only; boot did not throw
w.Prefs.set('colorfulTabs', false);

// ── 16. TEND ────────────────────────────────────────────────────────────────
w.Shell.go('tend');
w.TEND.openEditor();
check('editor sheet opens', $('.ns-tend #sheet-edit').classList.contains('on'));
$('.ns-tend #f-name').value = 'Test fern'; $('.ns-tend #f-water').value = '1'; $('.ns-tend #f-last').value = offset(-3);
click($('.ns-tend [data-act="save-edit"]'));
const tendDB = () => JSON.parse(w.localStorage.getItem('tend.v3'));
const fern = tendDB().plants.find(p => p.name === 'Test fern');
check('a plant saves into tend.v3 with a water event', !!fern && tendDB().events.some(e => e.plant === fern.id && e.type === 'water'));
const fernTask = [...d.querySelectorAll('.ns-tend .task')].find(t => t.textContent.includes('Test fern'));
check('an overdue plant is on the round', !!fernTask && /overdue/.test(fernTask.textContent), fernTask?.textContent);
click(fernTask);
check('ticking logs a watering today and offers undo', tendDB().events.some(e => e.plant === fern.id && e.date === today) &&
  $('.ns-tend #undo').classList.contains('on'));
click($('.ns-tend #undo button'));
check('undo removes it again', !tendDB().events.some(e => e.plant === fern.id && e.date === today));
w.TEND.openDetail(fern.id);
key('Escape');
check('Escape closes the TEND detail sheet', !$('.ns-tend #sheet-detail').classList.contains('on'));
w.Config.set('tend.round', Object.assign(w.Config.get('tend.round'), { soonAt: 0.5 }));
check('round thresholds come from Config', w.TEND.status(fern, 'water').state === 'due');
w.Config.reset('tend.round');
w.Prefs.set('dateFormat', 'iso');
check('TEND date label follows the date format', $('.ns-tend #date-label').textContent === today);
w.Prefs.set('dateFormat', 'long');

// nested data-sub: renaming one curate slot must keep the other two
w.SET.panel('log');
const cur = $('.ns-set input[data-cfg="log.curate"][data-sub="mix.label"]');
if (cur) { cur.value = 'mx'; cur.dispatchEvent(new w.Event('input', { bubbles: true })); }
check('editing one curate label keeps the other slots', cur && w.Config.get('log.curate').mix.label === 'mx' &&
  !!w.Config.get('log.curate').prod && !!w.Config.get('log.curate').cont, JSON.stringify(w.Config.get('log.curate')));
w.Config.reset('log.curate');

// ── 17. TRACK ───────────────────────────────────────────────────────────────
w.Shell.go('track');
w.localStorage.removeItem('capTracker.v2');
click($('.ns-track #levels .row[data-id]'));
const cap = JSON.parse(w.localStorage.getItem('capTracker.v2'));
check('ticking a topic files it under its id with today', cap.done.t01 === today, JSON.stringify(cap.done));
check('hero count follows', $('.ns-track #cum').textContent === '1' && $('.ns-track #totalOf').textContent === '/54');
w.Config.set('track.pace', { window: 2, nextCount: 1 });
check('next-up count comes from Config', d.querySelectorAll('.ns-track #next .nextRow').length === 1);
w.Config.reset('track.pace');
$('.ns-track #setRev').value = '6'; $('.ns-track #setRev').dispatchEvent(new w.Event('change', { bubbles: true }));
check('a date setting in the panel saves', JSON.parse(w.localStorage.getItem('capTracker.v2')).revisionWeeks === 6);
w.localStorage.removeItem('capTracker.v2');

// ── 18. LEARN ───────────────────────────────────────────────────────────────
await tick();
check('LEARN says so instead of throwing where IndexedDB is missing', /cannot be stored/i.test($('.ns-learn #deck-list').textContent),
  $('.ns-learn #deck-list').textContent.slice(0, 60));
check('answer row is built from the rating names', d.querySelectorAll('.ns-learn #answer-row .ans').length === 4 &&
  $('.ns-learn #answer-row .ans.easy .ans-l').textContent === 'acquired');
w.Config.set('learn.ratings', ['a', 'b', 'c', 'known']);
check('rating names follow Config', $('.ns-learn #answer-row .ans.easy .ans-l').textContent === 'known');
w.Config.reset('learn.ratings');
check('no library script was loaded without an import', !d.querySelector('script[src*="jszip"]'));

// ── 19. 2.3 — decimal fields, touch preview, the Todoist block, PLAN→LOG, study ─
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('morning');
const slIn = $('.ns-log #m-sl');
slIn.value = '7,5'; slIn.dispatchEvent(new w.Event('input', { bubbles: true }));
check('a comma typed into a decimal field becomes a dot', slIn.value === '7.5', slIn.value);
$('.ns-log #m-wkg').value = '75,3';               // no input event — the save must still normalise
w.LOG.saveMorning();
const savedM = JSON.parse(w.localStorage.getItem('log_' + today)).m;
check('decimal fields save as parseable numbers', savedM.sl === '7.5' && savedM.wkg === '75.3', JSON.stringify(savedM));

w.SET.panel('look');
const themeCard = $('.ns-set [data-theme-pick="ember"]');
const touchOver = new w.MouseEvent('pointerover', { bubbles: true });
Object.defineProperty(touchOver, 'pointerType', { value: 'touch' });
themeCard.dispatchEvent(touchOver);
check('a finger crossing a theme card does not preview it', d.documentElement.dataset.theme === 'void', d.documentElement.dataset.theme);
const mouseOver = new w.MouseEvent('pointerover', { bubbles: true });
Object.defineProperty(mouseOver, 'pointerType', { value: 'mouse' });
themeCard.dispatchEvent(mouseOver);
check('a mouse over a theme card still previews it', d.documentElement.dataset.theme === 'ember');
w.Prefs.revert();

// the Todoist "today" block
const tdCalls = [], tdClosed = new Set();
fetchScript = async (url, opts) => {
  const method = (opts && opts.method) || 'GET';
  tdCalls.push(method + ' ' + url);
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const m = url.match(/\/tasks\/(\w+)\/(close|reopen)/);
  if (m) { if (m[2] === 'close') tdClosed.add(m[1]); else tdClosed.delete(m[1]); return { ok: true, status: 204, json: async () => null, text: async () => '' }; }
  if (url.includes('/projects')) return ok([{ id: 'p1', name: '04 | life', color: 'blue' }, { id: 'p2', name: 'other', color: 'red' }]);
  if (url.includes('/sections')) return ok([{ id: 's1', name: 'admin | tasks', project_id: 'p1' }]);
  if (url.includes('/tasks?')) return ok([
    { id: 't1', content: 'call the bank', labels: ['calls'], priority: 4, due: { date: today }, section_id: 's1' },
    { id: 't2', content: 'old thing',     labels: [],        priority: 1, due: { date: offset(-2) } },
    { id: 't3', content: 'tomorrow',      labels: [],        priority: 2, due: { date: offset(1) } },
    { id: 't4', content: 'no date',       labels: [],        priority: 2, due: null },
  ].filter(t => !tdClosed.has(t.id)));
  return ok([]);
};
click($('.ns-tend #tt-show'));                 // keep TEND's plants off the block for these checks
w.Shell.go('do');
$('.ns-do #td-today-filter').value = '04 | life';     // whole project: the section still names itself per row
w.DO.saveTodaySettings();
w.DO.toggleToday();
await tick(120);
const ttRows = d.querySelectorAll('.ns-do #td-today .tt-row');
check('today block shows due + overdue, not future or dateless', ttRows.length === 2 && !$('.ns-do #td-today').classList.contains('hidden'), 'rows ' + ttRows.length);
check('priority is shown, label chips are not', !!$('.ns-do .tt-row .tt-pri.p1') && !$('.ns-do .tt-row .tt-lbl'));
const secChip = $('.ns-do .tt-row .tt-sec');
check("the section is named on a whole-project rule, in the project's colour", !!secChip && secChip.textContent === 'admin | tasks' && /4073ff/.test(secChip.getAttribute('style') || ''),
  secChip ? secChip.outerHTML : 'no section chip');
check('an overdue task is flagged late', !!$('.ns-do .tt-row.late'));
tdCalls.length = 0;
w.DO.toggleTodayTask('t1'); await tick(50);
check('ticking a task closes it in Todoist', tdCalls.some(c => c.includes('/tasks/t1/close')) && !!$('.ns-do .tt-row.done'));
await w.DO.refreshToday(true);
check('a task closed here stays listed, ticked, after a refresh', d.querySelectorAll('.ns-do .tt-row').length === 2 && !!$('.ns-do .tt-row.done'));
tdCalls.length = 0;
w.DO.toggleTodayTask('t1'); await tick(50);
check('unticking reopens it in Todoist', tdCalls.some(c => c.includes('/tasks/t1/reopen')) && !$('.ns-do .tt-row.done'));
check('the day\'s task list is cached in do_todoist_v1', JSON.parse(w.localStorage.getItem('do_todoist_v1')).today.tasks.length === 2);
w.DO.toggleToday();
check('switching the block off hides it', $('.ns-do #td-today').classList.contains('hidden'));

// PLAN → LOG: a planned task is offered as a block
w.Shell.go('plan'); w.PLAN.openProj('edu'); w.PLAN.pickSub('edu', 0);
$('.ns-plan #task-name').value = 'read NF C 15-100'; w.PLAN.addToQueue();
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('evening');
// the earlier partial-send test left "a" and "c" sent today and "b" queued, so
// all four are planned; find ours by name
const planChip = [...d.querySelectorAll('.ns-log #blk-plan .blk-b.plan')].find(b => b.dataset.name === 'read NF C 15-100');
check('a queued PLAN task is offered under the blocks', !!planChip && !$('.ns-log #blk-plan-wrap').classList.contains('hidden'),
  [...d.querySelectorAll('.ns-log #blk-plan .blk-b.plan')].map(b => b.dataset.name).join(','));
click(planChip);
w.LOG.saveEvening();
check('ticking it records the task as a block', JSON.parse(w.localStorage.getItem('log_' + today)).e.blocks.includes('read NF C 15-100'));
w.PLAN.clearQueue();

// TRACK + LEARN → the note's study section
w.TRACK.toggle('t02');
w.LEARN.recordRating(4, 'Deck A'); w.LEARN.recordRating(2, 'Deck A');
const noteOut = w.LOG.buildNote();
check('the note carries a study section', /#### study/.test(noteOut) && /\| cap_topics\s+\| 2 \|/.test(noteOut) &&
  /\| anki_rated\s+\| 2 \|/.test(noteOut) && /\| anki_acquired\s+\| 1 \|/.test(noteOut) && /Deck A 2/.test(noteOut),
  (noteOut.match(/#### study[\s\S]*/) || ['no section'])[0].slice(0, 200));
w.LOG.go('output');
check('the output screen tags the study day', /2 topics/.test($('.ns-log #out-tags').textContent) && /2 cards/.test($('.ns-log #out-tags').textContent));
w.TRACK.toggle('t02'); w.TRACK.toggle('t01'); w.localStorage.removeItem('learn_daily_v1');
check('a day with no study has no study section', !/#### study/.test(w.LOG.buildNote()));

// ── 20. 2.4 — TEND ↔ Todoist, the DO badge, study in the reports ────────────
const ttOpen = new Map(); let ttNext = 1;
fetchScript = async (url, opts) => {
  const method = (opts && opts.method) || 'GET';
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const none = { ok: true, status: 204, json: async () => null, text: async () => '' };
  const m = url.match(/\/tasks\/(\w+)\/(close|reopen)/);
  if (m) { const t = ttOpen.get(m[1]); if (t) t.open = m[2] === 'reopen'; return none; }
  if (url.includes('/projects')) return ok([{ id: 'p1', name: '04 | life' }]);
  if (url.includes('/sections')) return ok([{ id: 's7', name: 'home | chores', project_id: 'p1' }]);
  if (method === 'POST' && /\/tasks$/.test(url)) {
    const b = JSON.parse(opts.body); const id = 'n' + (ttNext++);
    ttOpen.set(id, Object.assign({ id, open: true }, b)); return ok(Object.assign({ id }, b));
  }
  if (url.includes('/tasks?')) return ok([...ttOpen.values()].filter(t => t.open)
    .map(t => ({ id: t.id, content: t.content, labels: t.labels, priority: t.priority, due: { date: today } })));
  return ok([]);
};
click($('.ns-tend #tt-show'));                 // plants back on DO's block
w.Shell.go('tend');
await tick(300);                               // onShow starts a quiet sync of its own; let it finish first
const fernItem = w.TEND.todayList().find(x => x.pid === fern.id && x.type === 'water');
check("the fern is due today on TEND's list", !!fernItem && !fernItem.done && fernItem.content === 'water test fern', JSON.stringify(fernItem));
await w.TEND.syncTodoist(true);
const made = [...ttOpen.values()][0] || { id: 'none' };
check('a due plant is pushed as a Todoist task with the chosen target, label, priority and date',
  made.content === 'water test fern' && made.project_id === 'p1' && made.section_id === 's7' &&
  made.labels && made.labels[0] === 'home' && made.priority === 3 && made.due_string === 'today',
  JSON.stringify(made) + ' | status: ' + $('.ns-tend #tt-status')?.textContent);
ttOpen.set('none', { open: null });
check('the task id is recorded under tend_todoist_v1', Object.values(JSON.parse(w.localStorage.getItem('tend_todoist_v1')).pushed)[0]?.id === made?.id);
w.Shell.go('do');
const plantRow = [...d.querySelectorAll('.ns-do #td-today .tt-row')].find(r => r.textContent.includes('water test fern'));
check("the due plant is on DO's today block with its priority and tend tag", !!plantRow && !$('.ns-do #td-today').classList.contains('hidden') &&
  !!plantRow.querySelector('.tt-pri.p2') && !!plantRow.querySelector('.tt-src'), plantRow?.textContent);
check('the DO tab and date line carry the open count', $('.tab-b[data-app="do"] .tb-badge')?.textContent === '1' && /1 to do/.test($('.ns-do #today-count').textContent),
  ($('.tab-b[data-app="do"] .tb-badge')?.textContent || 'no badge') + ' | ' + $('.ns-do #today-count').textContent);
w.DO.toggleTodayTask(fernItem.id); await tick(50);
check('ticking it on DO logs the watering and closes the task', tendDB().events.some(e => e.plant === fern.id && e.type === 'water' && e.date === today) && ttOpen.get(made.id).open === false);
check('the badge clears', !$('.tab-b[data-app="do"] .tb-badge'));
w.DO.toggleTodayTask(fernItem.id); await tick(50);
check('unticking removes the watering and reopens the task', !tendDB().events.some(e => e.plant === fern.id && e.type === 'water' && e.date === today) && ttOpen.get(made.id).open === true);
ttOpen.get(made.id).open = false;                  // completed in Todoist
await w.TEND.syncTodoist(true);
check('a task completed in Todoist is logged in TEND on sync', tendDB().events.some(e => e.plant === fern.id && e.type === 'water' && e.date === today));
w.Shell.go('do');
check('… and shows ticked on DO', !![...d.querySelectorAll('.ns-do .tt-row')].find(r => r.textContent.includes('water test fern'))?.classList.contains('done'));

w.TRACK.toggle('t03'); w.LEARN.recordRating(4, 'Deck B');
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('reports'); w.LOG.loadReportLocal('weekly');
const wr = $('.ns-log #rep-pre').textContent;
check('the weekly report has a study row, a study section and the topic title', /\| study \| 1 topics · 1 cards \|/.test(wr) && /## study/.test(wr) && /Les grandeurs électriques/.test(wr),
  (wr.match(/\| study \|[^\n]*/) || ['no row'])[0]);
w.LOG.loadReportLocal('monthly');
check('the monthly report too', /\| study \| 1 topics · 1 cards \|/.test($('.ns-log #rep-pre').textContent));
$('.ns-log #rep-paste').value = `*:LiCalendar: ${today}*\n| cap_topics    | 3 |\n| cap_done      | A; B; C |\n| anki_rated    | 12 |\n| anki_acquired | 4 |\n| scale | 1-5 |\n`;
w.LOG.parseNotes(); click($('.ns-log #rep-week-btns .rep-btn'));
check('parsed notes feed the study rows', /\| study \| 3 topics · 12 cards \|/.test($('.ns-log #rep-pre').textContent) && /- B/.test($('.ns-log #rep-pre').textContent));
w.TRACK.toggle('t03'); w.localStorage.removeItem('learn_daily_v1');

// ── 21. 2.5 — block tasks from Todoist, label chips gone, portrait lock ─────
check('the portrait lock stamps its attribute', d.documentElement.dataset.portrait === 'lock');
w.Prefs.set('lockPortrait', false);
check('… and lifts it', d.documentElement.dataset.portrait === 'free');
w.Prefs.set('lockPortrait', true);
w.Prefs.set('caps', 'off');
check('caps off stamps the attribute the token reads', d.documentElement.dataset.caps === 'off');
w.Prefs.set('caps', 'on');

const bkOpen = new Map([
  ['k1', { id: 'k1', content: 'mix the track', labels: ['b1', 'curate'], priority: 2, due: today, open: true }],
  ['k2', { id: 'k2', content: 'later',         labels: ['b2'],           priority: 1, due: offset(1), open: true }],
]);
fetchScript = async (url, opts) => {
  const method = (opts && opts.method) || 'GET';
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const m = url.match(/\/tasks\/(\w+)\/(close|reopen)/);
  if (m) { const t = bkOpen.get(m[1]); if (t) t.open = m[2] === 'reopen'; return { ok: true, status: 204, json: async () => null, text: async () => '' }; }
  if (url.includes('/labels')) return ok([{ id: 'l1', name: 'b1', color: 'violet' }, { id: 'l2', name: 'b2', color: 'teal' }, { id: 'l3', name: 'curate', color: 'grape' }]);
  if (url.includes('/tasks?')) {
    const lab = new URL(url).searchParams.get('label');
    return ok([...bkOpen.values()].filter(t => t.open && (!lab || t.labels.includes(lab)))
      .map(t => ({ id: t.id, content: t.content, labels: t.labels, priority: t.priority, due: { date: t.due } })));
  }
  return ok([]);
};
await w.DO.refreshToday(true);          // before go('do'): its onShow would start one of its own
w.Shell.go('do');
const tiles = d.querySelectorAll('.ns-do #td-blocks .bk');
check("block tasks due today are tiles in the OTHER label's Todoist colour", tiles.length === 1 &&
  tiles[0].style.getPropertyValue('--bk-c') === '#884dff' && /mix the track/.test(tiles[0].textContent) && /@b1 · curate/.test(tiles[0].textContent),
  tiles.length + ' tile(s) ' + (tiles[0] ? tiles[0].getAttribute('style') + ' ' + tiles[0].textContent : ''));
// the header band is out of the screen now (Shell moves it up), so the first child is the first section
check('blocks come first on the home screen by default', $('.ns-do #s-home').children[0]?.id === 'td-blocks', $('.ns-do #s-home').children[0]?.id);
w.DO.moveSection('blocks', 1);
check('a section can be moved down', $('.ns-do #s-home').children[0]?.id === 'home-grid' && w.Config.get('do.sections')[0] === 'routines');
w.Config.reset('do.sections');
check('the active tab shows the count in place of the icon', $('.tab-b[data-app="do"]').classList.contains('has-badge') && $('.tab-b[data-app="do"] .tb-badge')?.textContent === '1');
w.DO.setTab('other');
check("the other tab hides the today list and the blocks", $('.ns-do #td-blocks').classList.contains('hidden') && $('.ns-do #td-today').classList.contains('hidden'));
w.DO.setTab('daily');
check('… and the first tab shows them again', !$('.ns-do #td-blocks').classList.contains('hidden'));
check('no Todoist label chips on the today rows', !$('.ns-do #td-today .tt-lbl'));
w.DO.toggleBlockTask('k1'); await tick(50);
check('ticking a block closes it in Todoist and fills the tile', bkOpen.get('k1').open === false && !!$('.ns-do #td-blocks .bk.done'));
w.DO.toggleBlocksHideDone();
check('"hide done" removes the finished tile and keeps the section', d.querySelectorAll('.ns-do #td-blocks .bk').length === 0 &&
  !$('.ns-do #td-blocks').classList.contains('hidden') && /show done/.test($('.ns-do #td-blocks .tt-refresh').textContent));
w.DO.toggleBlocksHideDone();
check('"show done" brings it back', d.querySelectorAll('.ns-do #td-blocks .bk').length === 1);
const barFill = $('.ns-do #home-grid .card-bar-fill');
check('routine bars are tinted by progress, foreground → green', /color-mix\(in srgb, var\(--gr\) \d+%, var\(--tx\)\)/.test(barFill?.getAttribute('style') || ''), barFill?.getAttribute('style'));
check("it is recorded as a completed block in today's log", JSON.parse(w.localStorage.getItem('log_' + today)).e.blocks.includes('mix the track'));
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('evening');
const bkChip = [...d.querySelectorAll('.ns-log #blk-plan .blk-b.plan')].find(b => b.dataset.name === 'mix the track');
check('the evening form shows it selected, in the label colour', !!bkChip && bkChip.classList.contains('on') && /884dff/.test(bkChip.getAttribute('style')),
  bkChip ? bkChip.outerHTML.slice(0, 120) : 'no chip');
w.DO.toggleBlockTask('k1'); await tick(50);
const bkChip2 = [...d.querySelectorAll('.ns-log #blk-plan .blk-b.plan')].find(b => b.dataset.name === 'mix the track');   // re-rendered
check('unticking reopens it and deselects the block', bkOpen.get('k1').open === true &&
  !JSON.parse(w.localStorage.getItem('log_' + today)).e.blocks.includes('mix the track') && !!bkChip2 && !bkChip2.classList.contains('on'));

// ── 22. 2.8 — the media tab, the settings menu, apps out of the bar ─────────
const mdOpen = new Map([
  ['m1', { id: 'm1', content: 'Dune',      labels: ['movie'],          open: true }],
  ['m2', { id: 'm2', content: 'Blonde',    labels: ['music', 'album'], open: true }],
  ['m3', { id: 'm3', content: 'Severance', labels: ['show'],           open: true }],
]);
fetchScript = async (url, opts) => {
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const m = url.match(/\/tasks\/(\w+)\/(close|reopen)/);
  if (m) { const t = mdOpen.get(m[1]); if (t) t.open = m[2] === 'reopen'; return { ok: true, status: 204, json: async () => null, text: async () => '' }; }
  if (url.includes('/labels')) return ok([
    { id: 'l1', name: 'movie', color: 'red' }, { id: 'l2', name: 'show', color: 'blue' }, { id: 'l3', name: 'podcast', color: 'orange' },
    { id: 'l4', name: 'music', color: 'green' }, { id: 'l5', name: 'album', color: 'grey' }, { id: 'l6', name: 'b1', color: 'violet' }]);
  if (url.includes('/tasks?')) {
    const lab = new URL(url).searchParams.get('label');
    return ok([...mdOpen.values()].filter(t => t.open && lab && t.labels.includes(lab))
      .map(t => ({ id: t.id, content: t.content, labels: t.labels, priority: 1, due: null })));
  }
  return ok([]);
};
await w.DO.refreshToday(true);
w.Shell.go('do');
check('DO has a media tab between daily and other', [...d.querySelectorAll('.ns-do #home-tabs .tab')].map(b => b.dataset.tab).join(',') === 'daily,media,other',
  [...d.querySelectorAll('.ns-do #home-tabs .tab')].map(b => b.dataset.tab).join(','));
check('the media grid is off the daily tab', $('.ns-do #td-media').classList.contains('hidden'));
w.DO.setTab('media');
const mdBox = $('.ns-do #td-media');
const mdGroups = [...mdBox.querySelectorAll('.md-group')];
check("the media tab draws the tasks grouped under their label, in the label's Todoist colour", !mdBox.classList.contains('hidden') && mdGroups.length === 3 &&
  mdGroups[0].style.getPropertyValue('--bk-c') === '#db4035' && /@movie/.test(mdGroups[0].querySelector('.md-lbl').textContent) &&
  mdGroups[2].style.getPropertyValue('--bk-c') === '#299438' && /@music/.test(mdGroups[2].querySelector('.md-lbl').textContent),
  mdGroups.length + ' groups ' + mdGroups.map(g => g.getAttribute('style') + ' ' + g.querySelector('.md-lbl')?.textContent).join(' | '));
const blonde = [...mdBox.querySelectorAll('.bk')].find(b => /Blonde/.test(b.textContent));
check('a @music task shows its second label as a chip on the tile', !!blonde && blonde.querySelector('.bk-sub')?.textContent === 'album' && blonde.querySelector('.bk-check svg'));
check('the today list and the block tiles stay off the media tab', $('.ns-do #td-today').classList.contains('hidden') && $('.ns-do #td-blocks').classList.contains('hidden'));
w.DO.toggleMediaTask('m2'); await tick(50);
check('ticking closes it in Todoist and fills the tile', mdOpen.get('m2').open === false && !![...mdBox.querySelectorAll('.bk.done')].find(b => /Blonde/.test(b.textContent)));
const mdRec = () => JSON.parse(w.localStorage.getItem('log_' + today)).e.media || [];
check("it lands in today's log as media with its label and second label", mdRec().some(x => x.name === 'Blonde' && x.kind === 'music' && x.sub === 'album'), JSON.stringify(mdRec()));
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('output');
const noteMd = $('.ns-log #out-pre').textContent;
check('the daily note carries a #### media section with the title', /#### media/.test(noteMd) && /\| media_music\s*\| Blonde \(album\) \|/.test(noteMd) && /\| media_count\s*\| 1 \|/.test(noteMd),
  (noteMd.match(/#### media[\s\S]*$/) || ['no section'])[0].slice(0, 200));
w.LOG.go('evening');
check('the evening form shows no media row — the note and the history carry it', !$('.ns-log #media-wrap') && !$('.ns-log #media-g'));
w.localStorage.setItem('log_' + offset(-1), JSON.stringify(Object.assign(w.LOG.buildNote ? JSON.parse(w.localStorage.getItem('log_' + today)) : {}, { date: offset(-1), e: Object.assign(JSON.parse(w.localStorage.getItem('log_' + today)).e, { media: [{ name: 'Heat', kind: 'movie', sub: '' }] }) })));
w.LOG.go('history');
check("history lists a past day's media as a pill", /media: Heat/.test($('.ns-log #hist-list').textContent));
w.localStorage.removeItem('log_' + offset(-1));
w.DO.toggleMediaTask('m2'); await tick(50);
check('unticking reopens it and takes it out of the log', mdOpen.get('m2').open === true && !mdRec().length);
w.DO.toggleMediaTask('m1'); await tick(50);
w.LOG.go('reports'); w.LOG.loadReportLocal('weekly');
const wr2 = $('.ns-log #rep-pre').textContent;
check('the weekly report has a media row, a media section and the title', /\| media \| 1 finished \|/.test(wr2) && /## media/.test(wr2) && /- movie · Dune/.test(wr2),
  (wr2.match(/## media[\s\S]{0,120}/) || ['no section'])[0]);
w.LOG.loadReportLocal('monthly');
check('the monthly report too', /\| media \| 1 finished \|/.test($('.ns-log #rep-pre').textContent) && /- movie · Dune/.test($('.ns-log #rep-pre').textContent));
$('.ns-log #rep-paste').value = `*:LiCalendar: ${today}*\n| media_count | 2 |\n| media_movie | Heat |\n| media_music | Blonde (album) |\n| scale | 1-5 |\n`;
w.LOG.parseNotes(); click($('.ns-log #rep-week-btns .rep-btn'));
check('parsed notes feed the media rows back', /\| media \| 2 finished \|/.test($('.ns-log #rep-pre').textContent) && /- music · album · Blonde/.test($('.ns-log #rep-pre').textContent),
  ($('.ns-log #rep-pre').textContent.match(/## media[\s\S]{0,160}/) || ['no section'])[0]);
w.DO.toggleMediaTask('m1'); await tick(50);
const noteNoMedia = w.LOG.buildNote();
check('a day with nothing finished has no media section', !/#### media/.test(noteNoMedia));
w.DO.setTab('daily');

// settings: a home menu, three categories, the apps out of the bar
w.Shell.go('settings'); w.SET.home();
check('settings opens on a home menu with three categories', $('.ns-set #s-home').classList.contains('on') &&
  [...d.querySelectorAll('.ns-set .set-cat-b')].map(b => b.dataset.cat).join(',') === 'apps,appearance,data');
check('with every app in the bar the home lists none', !$('.ns-set [data-open]'));
w.Prefs.set('apps', ['do', 'log']);
check('apps switched off are listed on the settings home', [...d.querySelectorAll('.ns-set [data-open]')].map(b => b.dataset.open).join(',') === 'plan,store,tend,track,learn,cal',
  [...d.querySelectorAll('.ns-set [data-open]')].map(b => b.dataset.open).join(','));
click($('.ns-set [data-open="tend"]')); await tick();
check('opening one shows its slide, just before settings, with no tab', w.Shell.TABS.join(',') === 'do,log,tend,settings' &&
  !$('#view-tend').classList.contains('hidden') && $('.tab-b[data-app="tend"]').classList.contains('hidden') &&
  $('#view-tend').nextElementSibling?.id === 'view-settings', w.Shell.TABS.join(','));
w.Shell.go('settings'); await tick(400);
check('leaving it retires the slide again', w.Shell.TABS.join(',') === 'do,log,settings' && $('#view-tend').classList.contains('hidden') &&
  $('.tab-b.on')?.dataset.app === 'settings', w.Shell.TABS.join(','));
w.Prefs.reset('apps');
w.SET.panel('do');
check('an app panel sits in the apps category behind its pill bar', $('.ns-set #s-cat').classList.contains('on') && $('.ns-set #set-cat-title').textContent === 'apps' &&
  [...d.querySelectorAll('.ns-set #set-seg .seg-b')].map(b => b.dataset.seg).join(',') === 'do,log,plan,store,tend,track,learn,cal' &&
  $('.ns-set .set-panel.on')?.dataset.panel === 'do');
check("the app's content editors live at the end of its own panel", !!$('.ns-set [data-content-for="do"] [data-group="do.routines"]') &&
  !!$('.ns-set [data-content-for="do"] input[data-cfg="do.mediaLabels"]') && !$('.ns-set [data-content-for="do"] [data-group="log.blocks"]'));
click($('.ns-set #set-seg .seg-b[data-seg="store"]'));
check('a pill switches panels inside the category', $('.ns-set .set-panel.on')?.dataset.panel === 'store' && !!$('.ns-set [data-content-for="store"] [data-group="store.meals"]'));
w.SET.panel('data');
check('data is a single panel: no pill bar', $('.ns-set #set-cat-title').textContent === 'data' && $('.ns-set #set-seg').classList.contains('hidden'));
w.SET.panel('look');
check('look sits under appearance', $('.ns-set #set-cat-title').textContent === 'appearance' &&
  [...d.querySelectorAll('.ns-set #set-seg .seg-b')].map(b => b.dataset.seg).join(',') === 'look,layout,behave');
click($('.ns-set .hd-back'));
check('back returns to the home menu', $('.ns-set #s-home').classList.contains('on') && !$('.ns-set #s-cat').classList.contains('on'));

// ── 23. 2.9 — the left arrow as back, tap-the-tab-for-home, the settings icon, → tomorrow ─
const prev = $('#nav-prev');
w.Shell.go('do'); await tick();
check('on an app home the left arrow is the previous-tab arrow', !prev.classList.contains('is-back') && prev.disabled);
w.DO.openRoutine('routinep1'); await tick();
check('inside a sub-screen it becomes that screen\'s back button', prev.classList.contains('is-back') && !prev.disabled && prev.getAttribute('aria-label') === 'Back');
click(prev); await tick();
check('… and pressing it goes back', $('.ns-do #s-home').classList.contains('on') && !prev.classList.contains('is-back'));
w.DO.openRoutine('routinep1'); await tick();
click($('.tab-b[data-app="do"]')); await tick();
check('tapping the tab you are on goes to its home', $('.ns-do #s-home').classList.contains('on') && !prev.classList.contains('is-back'));
w.Shell.go('settings'); w.SET.panel('do'); await tick();
check('a settings category counts as a sub-screen too', prev.classList.contains('is-back'));
click($('.tab-b[data-app="settings"]')); await tick();
check('tapping the settings tab there returns to the menu', $('.ns-set #s-home').classList.contains('on') && !prev.classList.contains('is-back'));
w.Prefs.set('apps', ['do', 'log']);
click($('.ns-set [data-open="tend"]')); await tick();
const setBtn = $('.tab-b[data-app="settings"]');
check("on an app opened from settings the settings button wears that app's icon", setBtn.querySelector('use').getAttribute('href') === '#tab-tend' &&
  setBtn.querySelector('.tb-l').textContent === 'tend' && setBtn.classList.contains('on'), setBtn.querySelector('use').getAttribute('href'));
click(setBtn); await tick(400);
check('… and tapping it goes to the settings home, retiring the slide', $('.ns-set #s-home').classList.contains('on') && w.Shell.TABS.join(',') === 'do,log,settings' &&
  setBtn.querySelector('use').getAttribute('href') === '#tab-set' && setBtn.querySelector('.tb-l').textContent === 'set', w.Shell.TABS.join(','));
w.Prefs.reset('apps');

// → tomorrow: the open fetched tasks are rescheduled and drop off the list
const tmOpen = new Map([
  ['d1', { id: 'd1', content: 'file taxes', due: today }],
  ['d2', { id: 'd2', content: 'call bank',  due: today }],
]);
const tmMoved = {};
fetchScript = async (url, opts) => {
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const m = url.match(/\/tasks\/(\w+)$/);
  if (m && opts && opts.method === 'POST') { tmMoved[m[1]] = JSON.parse(opts.body).due_string; tmOpen.get(m[1]).due = offset(1); return ok({ id: m[1] }); }
  if (url.includes('/projects')) return ok([{ id: 'p1', name: '04 | life', color: 'blue' }]);
  if (url.includes('/tasks?')) {
    const u = new URL(url);
    if (u.searchParams.get('project_id') === 'p1') return ok([...tmOpen.values()].map(t => ({ id: t.id, content: t.content, labels: [], priority: 1, due: { date: t.due } })));
    return ok([]);
  }
  return ok([]);
};
w.Shell.go('do');
const tdState = () => JSON.parse(w.localStorage.getItem('do_todoist_v1'));
if (!tdState().todayOn) w.DO.toggleToday();
$('.ns-do #td-today-filter').value = '04 | life'; w.DO.saveTodaySettings(); await tick(150);
const openRows = () => [...d.querySelectorAll('.ns-do #td-today .tt-row:not(.done)')].filter(r => !r.querySelector('.tt-src'));
check('two tasks due today are listed', openRows().length === 2, openRows().length + ' rows');
check('the "→ tomorrow" button shows from 20:00 only', !!$('.ns-do .tt-defer') === (new w.Date().getHours() >= 20));
await w.DO.deferToday();
check('"→ tomorrow" reschedules every open task to tomorrow in Todoist', tmMoved.d1 === 'tomorrow' && tmMoved.d2 === 'tomorrow', JSON.stringify(tmMoved));
check('… and they drop off the list', openRows().length === 0 && tdState().today.tasks.length === 0, openRows().length + ' rows');

// ── 24. 2.10 — the title band, blocks → tomorrow, PLAN in label colours ────
check('each slide is a band plus a scroll body', ['do','log','plan','store','tend','track','learn','cal','settings'].every(a => {
  const v = $('#view-' + a); return v.children.length === 2 && v.children[0].classList.contains('h-top') && v.children[1].classList.contains('view-body');
}), [...d.querySelectorAll('#track .view')].map(v => v.id + ':' + [...v.children].map(c => c.className).join('+')).join(' '));
check("DO's tab strip and date live in the band", !!$('#view-do > .h-top #home-tabs') && !!$('#view-do > .h-top #date-label'));
check('the home screens sit in the body', !!$('#view-log > .view-body > #s-home') && !!$('#view-settings > .view-body > #s-cat'));
w.Prefs.set('titleSize', 'xl');
check('the title size dial stamps its attribute', d.documentElement.dataset.title === 'xl');
w.Prefs.reset('titleSize');
check('… and defaults to m', d.documentElement.dataset.title === 'm');

const mvOpen = new Map([['k9', { id: 'k9', content: 'daw session', labels: ['b1', 'curate'], due: today, open: true }]]);
const mvUpdates = {};
fetchScript = async (url, opts) => {
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const up = url.match(/\/tasks\/(\w+)$/);
  if (up && opts && opts.method === 'POST') { mvUpdates[up[1]] = JSON.parse(opts.body); return ok({ id: up[1] }); }
  if (url.includes('/labels')) return ok([{ id: 'l1', name: 'b1', color: 'violet' }, { id: 'l2', name: 'b2', color: 'teal' },
    { id: 'l3', name: 'b3', color: 'orange' }, { id: 'l4', name: 'curate', color: 'grape' }]);
  if (url.includes('/tasks?')) {
    const lab = new URL(url).searchParams.get('label');
    return ok([...mvOpen.values()].filter(t => t.open && lab && t.labels.includes(lab))
      .map(t => ({ id: t.id, content: t.content, labels: t.labels, priority: 1, due: { date: t.due } })));
  }
  return ok([]);
};
$('.ns-do #td-today-filter').value = ''; w.DO.saveTodaySettings(); await tick(100);
await w.DO.refreshToday(true);
w.DO.setTab('daily');
check('a block task is back as a tile with a "→ tomorrow" action on the head', d.querySelectorAll('.ns-do #td-blocks .bk').length === 1 &&
  /→ tomorrow/.test($('.ns-do #td-blocks .tt-head').textContent) && !$('.ns-do .bk-move'));
w.DO.toggleBlockMove();
const slots = [...d.querySelectorAll('.ns-do .bk-move-b')];
check("the slot row appears: b1 b2 b3 in the labels' Todoist colours, disabled until a tile is picked", slots.map(b => b.textContent).join(',') === 'b1,b2,b3' &&
  slots[0].style.getPropertyValue('--bk-c') === '#af38eb' && slots[1].style.getPropertyValue('--bk-c') === '#158fad' && slots.every(b => b.disabled),
  slots.map(b => b.textContent + ' ' + b.getAttribute('style') + (b.disabled ? ' off' : ' on')).join(' | '));
w.DO.selectBlock('k9');
check('tapping a tile selects it instead of ticking it', !!$('.ns-do #td-blocks .bk.sel') && mvOpen.get('k9').open === true &&
  [...d.querySelectorAll('.ns-do .bk-move-b')].every(b => !b.disabled));
await w.DO.moveBlocks('b2');
check('the slot reschedules it to tomorrow under that block, other labels kept', mvUpdates.k9 && mvUpdates.k9.due_string === 'tomorrow' &&
  JSON.stringify(mvUpdates.k9.labels) === JSON.stringify(['curate', 'b2']), JSON.stringify(mvUpdates));
check('… and it leaves the list, the row folds away', d.querySelectorAll('.ns-do #td-blocks .bk').length === 0 && !$('.ns-do .bk-move'));

check('the label colours are cached for every app', w.Todoist.labelColor('curate') === '#884dff' && !!w.localStorage.getItem('root_labels_v1'));
w.Shell.go('plan'); await tick(50);
const curateTile = [...d.querySelectorAll('.ns-plan .proj-tile')].find(t => /curate/.test(t.textContent));
check("PLAN's project tiles take their label's Todoist colour", !!curateTile && curateTile.style.getPropertyValue('--proj-color') === '#884dff', curateTile && curateTile.getAttribute('style'));

// ── 25. 2.11 — the cross-fade, the title morph, PLAN expanding in place ────
check('no glider: the active tab is its own filled pill again', !$('#nav .nav-glider') && $('.tab-b.on')?.dataset.app === 'plan');
// the morph only reads as one title becoming another if every band is the same
// shape — so no app sheet may set the band's box or its own wordmark size
const shellCss = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
const planCss = fs.readFileSync(path.join(ROOT, 'css/plan.css'), 'utf8');
const appSheets = ['do','log','plan','store','tend','track','learn','cal','settings']
  .map(a => [a, fs.readFileSync(path.join(ROOT, 'css/' + a + '.css'), 'utf8')]);
const strays = appSheets.filter(([, css]) => /\.h-top\s*\{/.test(css) || /\.h-logo\{font:/.test(css)).map(([a]) => a);
check('one band shape: no app sheet sets its own .h-top box or wordmark size', !strays.length, strays.join(','));
check('… and one wordmark size for all of them', /--title-base:54px/.test(fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8')) &&
  !appSheets.some(([, css]) => /--title-base/.test(css)));
w.Shell.go('log');
check('a tab change cross-fades: the incoming slide is .cur and morphs its title, the outgoing one leaves',
  $('#view-log').classList.contains('cur') && $('#view-log').classList.contains('morph') &&
  !$('#view-plan').classList.contains('cur') && $('#view-plan').classList.contains('leaving'),
  $('#view-log').className + ' | ' + $('#view-plan').className);
check('the titles slide the way you moved: back through the tabs is -1', $('#view-log').style.getPropertyValue('--dir') === '-1',
  'log ' + $('#view-log').style.getPropertyValue('--dir') + ' plan ' + $('#view-plan').style.getPropertyValue('--dir'));
w.Shell.go('store');
check('… and forwards is +1', $('#view-store').style.getPropertyValue('--dir') === '1');
w.Shell.go('log');
check('the track itself never moves any more', !$('#track').style.transform);
await tick(1000);                                  // the fade and morph are ~2× what 2.11 shipped with
check('… and the slide that left is plain again once the fade is over', !$('#view-plan').classList.contains('leaving'));
w.LOG.go('evening');
w.Shell.go('do'); w.Shell.go('log');
check('a slide left on a sub-screen morphs that screen\'s header, not a wordmark',
  $('#view-log').classList.contains('morph') && $('.ns-log #s-evening').classList.contains('on'));
w.LOG.go('home');

w.Shell.go('plan'); await tick();
check('the section sheet is gone from the markup', !$('#proj-sheet') && !$('#proj-back'));
check('an empty queue has no placeholder block, just the word on its title row',
  !$('#queue-empty-msg') && $('.ns-plan #queue-count').textContent === 'empty');
const projTiles = () => [...d.querySelectorAll('.ns-plan .proj-tile')];
check('every project is a tile, none open', projTiles().length === w.Config.get('plan.types').length && !$('.ns-plan .proj-tile.open'));
// jsdom loads no stylesheets, so this one is read off the sheet itself
check('the "n sections" line is drawn in the tile colour, not a muted grey',
  /\.ns-plan \.proj-meta\{[^}]*color:var\(--proj-color/.test(planCss) && !!$('.ns-plan .proj-meta'));
w.PLAN.openProj('curate');
const openTile = $('.ns-plan .proj-tile.open');
const secs = [...d.querySelectorAll('.ns-plan .proj-sec')];
check('tapping a project expands it in place: one open tile, the others become its section rows',
  !!openTile && /curate/.test(openTile.textContent) && openTile.getAttribute('aria-expanded') === 'true' &&
  projTiles().length === 1 && secs.length === w.Config.get('plan.types').find(t => t.key === 'curate').subs.length,
  (openTile ? 'open ' : 'no open tile ') + projTiles().length + ' tiles ' + secs.length + ' rows');
check('the rows are the project\'s sections, in its colour', secs.map(s => s.textContent.replace('→', '')).join(',') === 'mixing,production,socials' &&
  secs[0].style.getPropertyValue('--proj-color') === '#884dff', secs.map(s => s.textContent).join(','));
/* The rows own their keys. Borrowing the tiles' made each row fly in from
   wherever that tile happened to sit, squashed to its width — the second and
   third rows worst of all — so a row must never carry a p: key again. */
const secKeys = secs.map(s => s.dataset.flip);
check('the section rows own their flip keys, and borrow no tile\'s',
  secKeys.join(',') === 'sec:0,sec:1,sec:2' && new Set(secKeys).size === secKeys.length &&
  $('.ns-plan .queue').dataset.flip === 'queue', secKeys.join(','));
w.PLAN.openProj('curate');
check('tapping the open tile closes it again', !$('.ns-plan .proj-tile.open') && !d.querySelectorAll('.ns-plan .proj-sec').length);
w.PLAN.openProj('alive'); w.PLAN.openProj('curate');
check('opening another project swaps which one is open', /curate/.test($('.ns-plan .proj-tile.open').textContent) && projTiles().length === 1);
w.PLAN.pickSub('curate', 0);
check('picking a section opens the task form in the grid, under its own flip key',
  !!$('.ns-plan .proj-form') && $('.ns-plan .proj-form').dataset.flip === 'form:0' &&
  !d.querySelectorAll('.ns-plan .proj-sec').length && !!$('.ns-plan #task-name'),
  $('.ns-plan .proj-form') ? $('.ns-plan .proj-form').dataset.flip : 'no panel');
check('… and the title tile grows again above it', $('.ns-plan .proj-tile.open.wide') &&
  /curate/.test($('.ns-plan .proj-tile.open').textContent) && $('.ns-plan .pf-sec')?.textContent === 'mixing');
check('the form is no longer a screen of its own', !$('.ns-plan #s-form'));
check('the time row is off by default, block and priority on',
  !$('.ns-plan #opts-time') && !!$('.ns-plan #opts-block') && !!$('.ns-plan #opts-prio') && !!$('.ns-plan #tg-sub'));
const b1chip = [...d.querySelectorAll('.ns-plan #opts-block .opt-b')].find(b => b.textContent === 'b1');
check("the form's block chips wear their label's Todoist colour",
  !!b1chip && b1chip.classList.contains('lbl') && b1chip.style.getPropertyValue('--c') === '#af38eb', b1chip && b1chip.outerHTML);
w.Config.set('plan.formFields', Object.assign(w.Config.get('plan.formFields'), { time: true, subtasks: false }));
check('the form rows follow the setting', !!$('.ns-plan #opts-time') && !$('.ns-plan #tg-sub') && !$('.ns-plan #sub-text'));
w.Config.reset('plan.formFields');
$('.ns-plan #task-name').value = 'write the brief';
$('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
w.PLAN.optPick([...d.querySelectorAll('.ns-plan #opts-block .opt-b')][0], 'block', 'b1');
w.Config.set('plan.defaultPriority', 2);      // a Config edit re-renders the panel
check('a re-render while the form is open keeps what was typed and picked',
  $('.ns-plan #task-name').value === 'write the brief' && !!$('.ns-plan #opts-block .opt-b.on'));
w.PLAN.closeForm();
check('cancel goes back to the section rows, project still open',
  !$('.ns-plan .proj-form') && d.querySelectorAll('.ns-plan .proj-sec').length === 3 && !!$('.ns-plan .proj-tile.open'));
w.PLAN.pickSub('curate', 1);
$('.ns-plan #task-name').value = 'master the mix';
$('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
const qBefore = JSON.parse(w.localStorage.getItem('plan_queue') || '[]').length;
w.PLAN.addToQueue();
const qAfter = JSON.parse(w.localStorage.getItem('plan_queue') || '[]');
check('adding to the queue files it under that section and folds the grid all the way back',
  qAfter.length === qBefore + 1 && qAfter[qAfter.length - 1].name === 'master the mix' &&
  qAfter[qAfter.length - 1].subType === 'production' && !$('.ns-plan .proj-form') && !$('.ns-plan .proj-tile.open'),
  JSON.stringify(qAfter[qAfter.length - 1] || {}).slice(0, 120));
w.PLAN.clearQueue();

// the send button, and the block row with no "none" chip
check('the send button is absent while the queue is empty, not a faded one',
  $('.ns-plan #send-wrap').classList.contains('hidden') && !$('.ns-plan #btn-send').disabled);
w.PLAN.pickSub('curate', 0);
$('.ns-plan #task-name').value = 'a task';
$('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
w.PLAN.addToQueue();
check('… and appears, named for the count, once something is queued',
  !$('.ns-plan #send-wrap').classList.contains('hidden') && /send 1 task to todoist/.test($('.ns-plan #btn-send').textContent));
w.PLAN.pickSub('curate', 0);
check('… and steps out of the way while the task form is open', $('.ns-plan #send-wrap').classList.contains('hidden'));
const blockChips = [...d.querySelectorAll('.ns-plan #opts-block .opt-b')];
check('the block row has no "none" chip', blockChips.length === w.Config.get('plan.blocks').length &&
  !blockChips.some(b => b.classList.contains('none-opt')), blockChips.map(b => b.textContent).join(','));
w.PLAN.optPick(blockChips[0], 'block', 'b1');
check('picking a block selects it', !!$('.ns-plan #opts-block .opt-b.on'));
w.PLAN.optPick($('.ns-plan #opts-block .opt-b.on'), 'block', 'b1');
check('… and tapping it again clears the row, since there is no none chip', !$('.ns-plan #opts-block .opt-b.on'));
w.PLAN.closeForm(); w.PLAN.clearQueue();

/* ── PLAN's transition, driven by a scripted layout ──
   jsdom has neither layout nor Web Animations, so flip() is otherwise a
   complete no-op and none of its three branches is ever reached. Stand both
   in for the length of one open, and read back what it asked for. */
{
  w.PLAN.closeProj();                       // start folded, so openProj opens
  const anims = [];
  const realAnimate = w.Element.prototype.animate;
  const realRect = w.Element.prototype.getBoundingClientRect;
  w.Element.prototype.animate = function (frames, opts) {
    anims.push({ key: this.dataset?.flip || (this.parentElement?.dataset?.flip || '') + ' > child',
                 css: JSON.stringify(frames), opts: opts || {} });
    return { cancel() {}, finish() {} };
  };
  /* before = the folded grid, after = curate open with three section rows.
     The tile is one row tall in both states now; what changes is its width,
     and the name's size inside it. */
  const box = {
    before: { 'p:curate': [0, 0, 155, 46], 'pn:curate': [24, 17, 60, 13], 'pd:curate': [11, 18, 9, 9],
              queue: [0, 300, 340, 120] },
    after:  { 'p:curate': [0, 0, 340, 46], 'pn:curate': [24, 10, 118, 26], 'pd:curate': [11, 17, 11, 11],
              'sec:0': [0, 54, 340, 46], 'sec:1': [0, 108, 340, 46], 'sec:2': [0, 162, 340, 46],
              queue: [0, 340, 340, 120] },
  };
  w.Element.prototype.getBoundingClientRect = function () {
    const open = !!d.querySelector('.ns-plan .proj-tile.open');
    const r = (box[open ? 'after' : 'before'][this.dataset?.flip]) || [0, 0, 0, 0];
    return { left: r[0], top: r[1], width: r[2], height: r[3],
             right: r[0] + r[2], bottom: r[1] + r[3], x: r[0], y: r[1] };
  };

  w.PLAN.openProj('curate');
  const of = k => anims.find(a => a.key === k);

  /* The box is never scaled any more: scaling it scaled its border, its radius
     and its padding with it, which is what made this read as a zoom — and it
     was only because the box was stretched that its contents had to be hidden. */
  const tileAnims = anims.filter(a => a.key === 'p:curate');
  check('opening a project fades the tile\'s border and background, and never scales the box',
    tileAnims.length > 0 && tileAnims.some(a => /borderColor/.test(a.css)) &&
    !tileAnims.some(a => /scale\(/.test(a.css)),
    tileAnims.map(a => a.css.slice(0, 60)).join(' | ') || 'not animated');
  const name = of('pn:curate');
  check('… while the name moves and grows into the heading under its own key',
    !!name && /scale\(0\.5\)/.test(name.css) && /translate\(0px,7px\)/.test(name.css),
    name ? name.css.slice(0, 110) : 'not animated');
  check('… and no text is faded on the way — the name you tapped never leaves the screen',
    !!name && !/opacity/.test(name.css) && !anims.some(a => / > child/.test(a.key)),
    anims.filter(a => /opacity/.test(a.css)).map(a => a.key).join(','));
  /* The border is the thing you notice last, so it has to finish first for the
     gesture to read as fluid rather than as a box still settling. */
  const fade = tileAnims.find(a => /borderColor/.test(a.css));
  check('… the border fade finishing well before the move does',
    !!fade && fade.opts.duration > 0 && fade.opts.duration <= 300,
    fade ? String(fade.opts.duration) : 'no fade');

  const rows = ['sec:0', 'sec:1', 'sec:2'].map(of);
  check('the section rows are revealed, not flown in from the tiles they replaced',
    rows.every(r => r && /translateY\(-7px\)/.test(r.css) && /"opacity":0/.test(r.css)) &&
    !rows.some(r => /scale\(/.test(r.css)),
    rows.map(r => r ? r.css.slice(0, 50) : 'missing').join(' | '));
  check('… one after another, so they read as a list opening',
    rows[0].opts.delay < rows[1].opts.delay && rows[1].opts.delay < rows[2].opts.delay,
    rows.map(r => r.opts.delay).join(','));

  const q = of('queue');
  check('the queue below just slides down to the new height — no scaling of a box that did not change shape',
    !!q && /translate\(0px,-40px\)/.test(q.css) && !/scale\(/.test(q.css), q ? q.css : 'not animated');

  w.Element.prototype.animate = realAnimate;
  w.Element.prototype.getBoundingClientRect = realRect;
  w.PLAN.closeProj();
}

// ── 26. the sent history and its calendar lines ────────────────────────────
// section 6 already pushed two tasks through; clear both the key and the
// module's copy of it, and note what today's own record already holds
confirmAnswer = true;
w.PLAN.clearSent();
const sentBase = JSON.parse(w.localStorage.getItem('plan_sent_v1') || '{"tasks":[]}').tasks.length;
w.PLAN.go('home');
check('the sent list starts empty and says so on its title row',
  $('.ns-plan #sent-count').textContent === 'empty' && $('.ns-plan #sent-clear').classList.contains('hidden') &&
  !d.querySelectorAll('.ns-plan #sent-list .q-item').length);

check('… with no "export" until a row is picked', $('.ns-plan #sent-export').classList.contains('hidden'));

// seven tasks across five projects — enough to fill the six slots and refuse one more
let sent = 0;
fetchScript = async (url, opts) => {
  if (opts && opts.method === 'POST') { sent++; return { ok: true, status: 200, json: async () => ({ id: 'n' + sent }), text: async () => '{}' }; }
  return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
};
const queueOne = (proj, section, name, block) => {
  w.PLAN.pickSub(proj, section);
  $('.ns-plan #task-name').value = name;
  $('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
  if (block) w.PLAN.optPick([...d.querySelectorAll('.ns-plan #opts-block .opt-b')].find(b => b.textContent === block), 'block', block);
  w.PLAN.addToQueue();
};
queueOne('curate', 0, 'mix the track', 'b1');       // curate > mixing
queueOne('curate', 1, 'master it', 'b1');           // curate > production
queueOne('curate', 2, 'post the clip', 'b2');       // curate > socials
queueOne('home',   2, 'chores', null);              // home (no per-section calendar)
queueOne('admin',  0, 'call the bank', null);
queueOne('edu',    0, 'read chapter 3', null);
queueOne('alive',  0, 'walk kamo', null);
w.PLAN.go('sending');
await tick(900);
const sentRows = () => [...d.querySelectorAll('.ns-plan #sent-list .q-item')];
const rowFor = name => sentRows().findIndex(r => r.querySelector('.q-item-name').textContent === name);
const rows = sentRows();
check('everything sent lands in the sent list, newest first, every row a button',
  rows.length === 7 && /walk kamo/.test(rows[0].textContent) && /mix the track/.test(rows[6].textContent) &&
  rows.every(r => r.tagName === 'BUTTON' && r.getAttribute('aria-pressed') === 'false'),
  rows.map(r => r.querySelector('.q-item-name').textContent).join(' | '));
check('… each row naming its project, its block and the day',
  /curate/.test(rows[4].textContent) && /@b2/.test(rows[4].textContent) && /@b1/.test(rows[6].textContent));
check('the title row counts them and offers to clear',
  $('.ns-plan #sent-count').textContent === '7 tasks' && !$('.ns-plan #sent-clear').classList.contains('hidden'));

/* Tapping a row picks it; "export" appears and names how many are picked. */
const expBtn = () => $('.ns-plan #sent-export');
w.PLAN.toggleSent(rowFor('mix the track'));
check('tapping a row selects it and brings "export" out',
  sentRows()[6].classList.contains('on') && sentRows()[6].getAttribute('aria-pressed') === 'true' &&
  !expBtn().classList.contains('hidden') && $('.ns-plan #sent-export-n').textContent === '1');
w.PLAN.toggleSent(rowFor('master it'));
check('… and a second row of the same block joins it — the block no longer caps the picking',
  $('.ns-plan #sent-export-n').textContent === '2' && sentRows()[rowFor('master it')].classList.contains('on'));

/* Six slots in a day, so six picked rows is the ceiling. */
['post the clip', 'chores', 'call the bank', 'read chapter 3'].forEach(nm => w.PLAN.toggleSent(rowFor(nm)));
check('six rows pick without complaint — one per slot', $('.ns-plan #sent-export-n').textContent === '6');
w.PLAN.toggleSent(rowFor('walk kamo'));
check('a seventh is refused, with a word about why',
  $('.ns-plan #sent-export-n').textContent === '6' && !sentRows()[rowFor('walk kamo')].classList.contains('on') &&
  /6 slots in a day/.test($('#toast').textContent), $('#toast').textContent);
w.PLAN.toggleSent(rowFor('read chapter 3'));
check('tapping a picked row lets it go again',
  $('.ns-plan #sent-export-n').textContent === '5' && !sentRows()[rowFor('read chapter 3')].classList.contains('on'));

// ── 27. the export panel ───────────────────────────────────────────────────
/* The two branches the export is built out of, as shipped. */
const shippedCals = w.Config.defaults('plan.calendars');
check('plan.calendars ships the eight projects, curate split three ways',
  Object.keys(shippedCals).length === 8 &&
  shippedCals['curate > mixing'] === '02A1 | curate project mixing' &&
  shippedCals['curate > production'] === '02A2 | curate project production' &&
  shippedCals['curate > socials'] === '02A3 | curate project content' &&
  ['system','admin','home','edu','alive'].every(k => /^02B\d \| /.test(shippedCals[k])),
  Object.keys(shippedCals).join(','));
const shippedTpl = w.Config.defaults('plan.dayTemplates');
const span = t => t.reduce((n, r) => Math.max(n, r.at + r.dur), 0);
check('plan.dayTemplates ships both, the normal day 17h with six slots and the rest day 16h with four',
  Object.keys(shippedTpl).join(',') === 'normal,rest' &&
  span(shippedTpl.normal) === 17 * 60 && span(shippedTpl.rest) === 16 * 60 &&
  shippedTpl.normal.filter(r => r.slot).length === 6 && shippedTpl.rest.filter(r => r.slot).length === 4,
  span(shippedTpl.normal) + '/' + span(shippedTpl.rest));
check('… every row butting onto the next, so the span really is one number',
  [shippedTpl.normal, shippedTpl.rest].every(t => t.every((r, i) => i === 0 ? r.at === 0 : r.at === t[i-1].at + t[i-1].dur)));
/* ROOT writes a Todoist task and stops: it has no Google auth and is not
   getting any, so nothing in PLAN may reach for one. */
const planJs = fs.readFileSync(path.join(ROOT, 'js/plan.js'), 'utf8');
const planUrls = planJs.match(/https?:\/\/[^\s'"`]+/g) || [];
check('every endpoint PLAN talks to is Todoist — the calendar half is not ROOT\'s',
  planUrls.length > 0 && planUrls.every(u => /todoist/.test(u)), planUrls.join(' '));

w.PLAN.openExport();
const panel = () => $('.ns-plan .exp-panel');
check('the export panel opens inside the tile grid, not on a screen of its own',
  !!panel() && panel().closest('#proj-list') === $('.ns-plan #proj-list') &&
  !d.querySelector('.ns-plan #s-form') && !d.querySelector('.ns-plan .proj-tile'),
  panel() ? (panel().parentElement || {}).id : 'no panel');
check('… with all eight fields on it',
  ['exp-date','exp-start','exp-tpl','exp-mode','exp-tasks','exp-notes','exp-out','exp-go-wrap']
    .every(id => !!$('.ns-plan #' + id)),
  ['exp-date','exp-start','exp-tpl','exp-mode','exp-tasks','exp-notes','exp-out','exp-go-wrap']
    .filter(id => !$('.ns-plan #' + id)).join(','));
check('the date defaults to tomorrow', $('.ns-plan #exp-date').value === offset(1),
  $('.ns-plan #exp-date').value + ' vs ' + offset(1));
check('the send button steps out of the way while the panel is open',
  $('.ns-plan #send-wrap').classList.contains('hidden'));

/* One slot row per picked task, six chips each, and nothing to export yet. */
const taskRows = () => [...d.querySelectorAll('.ns-plan .exp-task')];
check('every picked row gets its own slot row, with the six named slots to tap',
  taskRows().length === 5 &&
  [...taskRows()[0].querySelectorAll('.exp-slot')].map(b => b.textContent).join(' ') === 'b1a b1b b2a b2b b3a b3b',
  taskRows().length + ' rows');
check('the export button is absent while a picked task has no slot',
  !$('.ns-plan #exp-go') && /5 tasks still without a slot/.test($('.ns-plan #exp-go-wrap').textContent),
  $('.ns-plan #exp-go-wrap').textContent.trim());

/* Slots are assigned by tapping, never derived from the order things were sent. */
const rowIdx = name => taskRows().findIndex(r => r.querySelector('.exp-task-name').textContent.includes(name));
const slotBtn = (name, slot) => [...taskRows()[rowIdx(name)].querySelectorAll('.exp-slot')].find(b => b.textContent === slot);
click(slotBtn('chores', 'b1a'));
check('a task takes the slot it is given, not the one its send order would imply',
  slotBtn('chores', 'b1a').classList.contains('on') && taskRows()[rowIdx('chores')].classList.contains('on'));
click(slotBtn('mix the track', 'b1a'));
check('… and a slot another task already holds is refused, by name',
  !slotBtn('mix the track', 'b1a').classList.contains('on') && /b1a is taken — by chores/.test($('#toast').textContent),
  $('#toast').textContent);
click(slotBtn('mix the track', 'b1b'));
click(slotBtn('chores', 'b1a'));
check('tapping a task\'s own slot again clears it', !slotBtn('chores', 'b1a').classList.contains('on'));
click(slotBtn('chores', 'b1a'));

/* The rest template has four block slots, not six. */
const tplChip = n => [...d.querySelectorAll('.ns-plan #exp-tpl .opt-b')].find(b => b.textContent === n);
check('both templates are offered', !!tplChip('normal') && !!tplChip('rest') &&
  tplChip('normal').classList.contains('on'));
click(tplChip('rest'));
click(slotBtn('master it', 'b3a'));
check('assigning a b3 slot on a rest day is refused, with a toast saying why',
  !slotBtn('master it', 'b3a').classList.contains('on') &&
  /rest has no b3a — those hours are free time/.test($('#toast').textContent), $('#toast').textContent);
check('… and the two b3 chips are marked as not on offer',
  slotBtn('master it', 'b3a').classList.contains('off') && slotBtn('master it', 'b3b').classList.contains('off') &&
  !slotBtn('master it', 'b2b').classList.contains('off'));
click(slotBtn('master it', 'b2b'));
check('a rest day still takes its four slots', slotBtn('master it', 'b2b').classList.contains('on'));
click(slotBtn('master it', 'b2b'));            // free it again
click(tplChip('rest'));                        // no-op: already on rest
click(slotBtn('post the clip', 'b2b'));
click(tplChip('normal'));
click(slotBtn('master it', 'b3a'));
check('… and the same slot is taken without complaint once normal is picked back',
  slotBtn('master it', 'b3a').classList.contains('on'));
click(tplChip('rest'));
check('switching back to rest drops the b3 assignment rather than losing it at export time',
  !slotBtn('master it', 'b3a').classList.contains('on') &&
  /rest has no b3a \/ b3b — 1 task unassigned/.test($('#toast').textContent), $('#toast').textContent);
click(tplChip('normal'));
click(slotBtn('master it', 'b3a'));
click(slotBtn('call the bank', 'b2a'));

/* Two start times, because one proves nothing about an offset model. */
const at = (tpl, start, i) => { const r = w.PLAN.resolved(tpl); return r[i]; };
const setStart = hhmm => { const el = $('.ns-plan #exp-start'); el.value = hhmm;
  el.dispatchEvent(new w.Event('input', { bubbles: true })); };
setStart('07:00');
check('normal resolves off the start time — 07:00 puts gym at 08:45 and b1a at 11:00',
  at('normal', '', 2).event === 'gym' && at('normal', '', 2).from === '08:45' && at('normal', '', 2).to === '09:45' &&
  at('normal', '', 5).slot === 'b1a' && at('normal', '', 5).from === '11:00' && at('normal', '', 5).to === '12:30',
  JSON.stringify([at('normal', '', 2), at('normal', '', 5)]));
check('… and the 17-hour span ends at midnight',
  at('normal', '', 19).event === 'cooldown' && at('normal', '', 19).from === '23:45' && at('normal', '', 19).to === '00:00');
check('rest at the same start puts b1a an hour earlier, gym being gone',
  at('rest', '', 4).slot === 'b1a' && at('rest', '', 4).from === '10:00' && at('rest', '', 4).to === '11:30' &&
  at('rest', '', 17).event === 'cooldown' && at('rest', '', 17).from === '22:45',
  JSON.stringify([at('rest', '', 4), at('rest', '', 17)]));
setStart('09:30');
check('a second start time moves the whole day with it, nothing being a wall-clock constant',
  at('normal', '', 5).from === '13:30' && at('normal', '', 5).to === '15:00' &&
  at('rest', '', 4).from === '12:30' && at('rest', '', 4).to === '14:00' &&
  at('normal', '', 19).from === '02:15' && at('normal', '', 19).over === true,
  JSON.stringify([at('normal', '', 5), at('rest', '', 4), at('normal', '', 19)]));
check('rest carries four block slots and normal six',
  w.PLAN.resolved('rest').filter(r => r.slot).length === 4 &&
  w.PLAN.resolved('normal').filter(r => r.slot).length === 6 &&
  !w.PLAN.resolved('rest').some(r => /^b3/.test(r.slot || '')));
setStart('07:00');

/* The preview: one line per event, at the clock time it resolves to. */
check('the preview shows one line per picked task in blocks mode, with real times',
  w.PLAN.previewRows().length === 5 && d.querySelectorAll('.ns-plan .exp-line').length === 5,
  w.PLAN.previewRows().length + ' rows for ' + taskRows().length + ' picked');
const line = slot => [...d.querySelectorAll('.ns-plan .exp-line')].find(l => l.textContent.includes(slot + '|'));
check('… naming the event as <slot>|<task> on the calendar the project maps to',
  /12:45–14:15/.test(line('b1b').textContent) && /b1b\|mix the track/.test(line('b1b').textContent) &&
  /02A1 \| curate project mixing/.test(line('b1b').textContent), line('b1b').textContent.replace(/\s+/g, ' ').trim());
check('… and a project with no per-section calendar falls back to its own',
  /11:00–12:30/.test(line('b1a').textContent) && /02B4 \| home/.test(line('b1a').textContent),
  line('b1a').textContent.replace(/\s+/g, ' ').trim());
check('blocks mode writes nothing but the slots — no routine, no breaks',
  !w.PLAN.previewRows().some(r => r.event));
w.PLAN.setMode('full');
check('full schedule previews the whole template, the idle slots included',
  w.PLAN.previewRows().length === 20 && d.querySelectorAll('.ns-plan .exp-line.idle').length === 1,
  w.PLAN.previewRows().length + ' rows');
check('… and warns that the day is replaced, and where what is there now goes',
  /will be replaced/.test($('.ns-plan .exp-warn').textContent) &&
  /00B \| schedule 2/.test($('.ns-plan .exp-warn').textContent) &&
  /archived/.test($('.ns-plan .exp-warn').textContent),
  $('.ns-plan .exp-warn').textContent.replace(/\s+/g, ' ').trim());
w.PLAN.setMode('blocks');
check('the export button is there once every picked task has a slot, and names the count',
  !!$('.ns-plan #exp-go') && $('.ns-plan #exp-go').textContent === 'export 5 tasks');

/* ── The description is a contract: byte for byte ── */
const dayISO = offset(1);
const wanted = [
  `day: ${dayISO}`, 'start: 07:00', 'template: normal', 'mode: blocks', '',
  'b1a | home | chores',
  'b1b | curate > mixing | mix the track',
  'b2a | admin | call the bank',
  'b2b | curate > socials | post the clip',
  'b3a | curate > production | master it',
].join('\n');
check('the description renders byte-exactly, slots in template order',
  w.PLAN.exportDescription() === wanted, JSON.stringify(w.PLAN.exportDescription()));
check('… with the notes section omitted entirely when there are none, not left as a bare header',
  !/notes/.test(w.PLAN.exportDescription()));
const notesEl = $('.ns-plan #exp-notes');
notesEl.value = 'buy strings\n\n  call mum  \n';
notesEl.dispatchEvent(new w.Event('input', { bubbles: true }));
check('… and present, one dash per line, once something is written',
  w.PLAN.exportDescription() === wanted + '\n\nnotes:\n- buy strings\n- call mum',
  JSON.stringify(w.PLAN.exportDescription()));

/* plan.calendars is Config: an edit reaches the panel without a reload. */
const calMap = w.Config.get('plan.calendars');
calMap['curate > mixing'] = '99Z | somewhere else';
w.Config.set('plan.calendars', calMap);
check('a plan.calendars edit survives the re-render and reaches the description',
  /99Z \| somewhere else/.test($('.ns-plan #exp-out').textContent) &&
  /b1b \| curate > mixing \| mix the track/.test(w.PLAN.exportDescription()) &&
  $('.ns-plan #exp-notes').value === 'buy strings\n\n  call mum  \n',
  $('.ns-plan #exp-out').textContent.replace(/\s+/g, ' ').slice(0, 90));
w.Config.reset('plan.calendars');
check('… and resetting it puts the shipped calendar back',
  /02A1 \| curate project mixing/.test($('.ns-plan #exp-out').textContent));

/* The send: one task, through the shell's own Todoist helper, labelled import. */
w.Creds.save('tok');
let posted = null;
fetchScript = async (url, opts) => {
  if (opts && opts.method === 'POST') { posted = { url: String(url), body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ id: 'exp1' }), text: async () => '{}' }; }
  return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
};
await w.PLAN.doExport();
await tick();
check('export POSTs one task through the shell helper, labelled import',
  !!posted && posted.url === 'https://api.todoist.com/api/v1/tasks' &&
  JSON.stringify(posted.body.labels) === '["import"]' && posted.body.content === `schedule ${dayISO}`,
  JSON.stringify(posted && { url: posted.url, labels: posted.body.labels, content: posted.body.content }));
check('… carrying the description verbatim',
  !!posted && posted.body.description === wanted + '\n\nnotes:\n- buy strings\n- call mum',
  JSON.stringify(posted && posted.body.description));
check('… and says so, closing the panel and letting the picked rows go',
  /exported · 5 tasks/.test($('#toast').textContent) && !panel() &&
  $('.ns-plan #sent-export').classList.contains('hidden'), $('#toast').textContent);
check('the start time is remembered for next time',
  JSON.parse(w.localStorage.getItem('plan_export_v1')).start === '07:00');

/* A failure is never silent: the task not reaching Todoist means no calendar. */
w.PLAN.toggleSent(rowFor('chores'));
w.PLAN.openExport();
click(slotBtn('chores', 'b1a'));
fetchScript = async (url, opts) => (opts && opts.method === 'POST')
  ? { ok: false, status: 500, json: async () => ({}), text: async () => '' }
  : { ok: true, status: 200, json: async () => [], text: async () => '[]' };
await w.PLAN.doExport();
await tick();
check('a failed export says so and leaves the panel up with its button back',
  /export failed/.test($('#toast').textContent) && !!panel() &&
  !!$('.ns-plan #exp-go') && !$('.ns-plan #exp-go').disabled, $('#toast').textContent);
w.PLAN.closeExport();
check('cancelling puts the project tiles back', !panel() && !!d.querySelector('.ns-plan .proj-tile'));

confirmAnswer = true;
w.PLAN.clearSent();
check('clear empties the list, the key and the selection',
  !sentRows().length && JSON.parse(w.localStorage.getItem('plan_history_v1')).length === 0 &&
  expBtn().classList.contains('hidden'));
check("clearing the history leaves today's own sent record alone — LOG reads that one",
  JSON.parse(w.localStorage.getItem('plan_sent_v1')).tasks.length === sentBase + 7,
  JSON.parse(w.localStorage.getItem('plan_sent_v1')).tasks.length + ' vs ' + (sentBase + 7));
w.PLAN.clearQueue();

/* The two new branches are editable in settings, like every other content
   branch — and the templates round-trip through their text form. */
w.SET.panel('plan');
const edPaths = [...d.querySelectorAll('.ns-set [data-content-for="plan"] [data-group]')].map(b => b.dataset.group);
check('plan.calendars and plan.dayTemplates are editable in settings → apps → plan',
  edPaths.includes('plan.calendars') && edPaths.includes('plan.dayTemplates'), edPaths.join(','));
const calBox = $('.ns-set [data-group="plan.calendars"] textarea');
check('… the calendar map rendering one line per project, the name keeping its own pipes',
  /^curate > mixing \| 02A1 \| curate project mixing$/m.test(calBox.value) &&
  /^alive \| 02B6 \| alive$/m.test(calBox.value), calBox.value.split('\n')[0]);
calBox.value = calBox.value.replace('02B6 | alive', '02B9 | alive again');
calBox.dispatchEvent(new w.Event('input', { bubbles: true }));
check('… and an edit splitting on the first pipe only, so the name survives whole',
  w.Config.get('plan.calendars').alive === '02B9 | alive again' &&
  w.Config.get('plan.calendars')['curate > mixing'] === '02A1 | curate project mixing',
  JSON.stringify(w.Config.get('plan.calendars').alive));
w.Config.reset('plan.calendars');
w.SET.panel('plan');
const tplBox = () => $('.ns-set [data-group="plan.dayTemplates"] [data-key="normal"] textarea');
check('the day templates render as offset | minutes | what',
  /^0:00 \| 30 \| routine p1 \| 01A1 \| routine$/m.test(tplBox().value) &&
  /^4:00 \| 90 \| b1a$/m.test(tplBox().value), tplBox().value.split('\n')[0]);
const beforeTpl = JSON.stringify(w.Config.get('plan.dayTemplates').normal);
tplBox().dispatchEvent(new w.Event('input', { bubbles: true }));
check('… and round-trip through that text unchanged',
  JSON.stringify(w.Config.get('plan.dayTemplates').normal) === beforeTpl,
  JSON.stringify(w.Config.get('plan.dayTemplates').normal).slice(0, 120));
w.SET.panel('plan');
tplBox().value = tplBox().value.replace('4:00 | 90 | b1a', '4:00 | 1h30 | b1a');
tplBox().dispatchEvent(new w.Event('input', { bubbles: true }));
check('… reading "1h30" as ninety minutes, so a duration can be written either way',
  JSON.stringify(w.Config.get('plan.dayTemplates').normal) === beforeTpl);
w.Config.reset('plan.dayTemplates');
w.Shell.go('plan');

// ── 28. the day a task is due, picked on the form ──────────────────────────
/* Everything PLAN sent used to be due "today", full stop. The day is picked
   on the task form now — ← tomorrow → — carried on the queued task, and sent
   as an explicit date. */
w.PLAN.pickSub('home', 0);
const dWord = () => $('.ns-plan #date-word').textContent;
const dSub  = () => $('.ns-plan #date-sub').textContent;
check('the task form carries a date row: an arrow either side of the day itself',
  !!$('.ns-plan #opts-date') && !!$('.ns-plan #date-back') && !!$('.ns-plan #date-fwd') &&
  !!$('.ns-plan #date-now'));
check('… starting on today, with its left arrow dead — nothing is planned into the past',
  dWord() === 'today' && $('.ns-plan #date-back').disabled &&
  !$('.ns-plan #date-now').classList.contains('on'), dWord());
click($('.ns-plan #date-fwd'));
check('one tap right is tomorrow, in words, and the middle marks itself moved',
  dWord() === 'tomorrow' && dSub() === w.Prefs.formatDate(offset(1), 'short') &&
  $('.ns-plan #date-now').classList.contains('on') && !$('.ns-plan #date-back').disabled,
  dWord() + ' / ' + dSub());
click($('.ns-plan #date-fwd'));
check('… and past tomorrow it names the weekday, the date itself under it either way',
  dWord() !== 'tomorrow' && dWord() !== 'today' && dSub() === w.Prefs.formatDate(offset(2), 'short'),
  dWord() + ' / ' + dSub());
click($('.ns-plan #date-back'));
check('the left arrow walks it back a day', dWord() === 'tomorrow', dWord());
w.PLAN.stepDate(-1); w.PLAN.stepDate(-1);
check('the floor holds: it will not step past today', dWord() === 'today' && $('.ns-plan #date-back').disabled, dWord());
click($('.ns-plan #date-fwd'));
click($('.ns-plan #date-now'));
check('tapping the middle is the way back to today',
  dWord() === 'today' && !$('.ns-plan #date-now').classList.contains('on'), dWord());

/* The panel repaints itself from formState on every draw, the day included. */
click($('.ns-plan #date-fwd'));
$('.ns-plan #task-name').value = 'water the plants';
$('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
w.Config.set('plan.defaultPriority', 2);           // a re-render under the open form
check('a re-render keeps the day picked, the way it keeps what was typed',
  dWord() === 'tomorrow' && $('.ns-plan #task-name').value === 'water the plants', dWord());
w.PLAN.setSub(true);
$('.ns-plan #sub-text').value = 'fill the can';
w.PLAN.addSubtask();
w.PLAN.addToQueue();
const qDated = JSON.parse(w.localStorage.getItem('plan_queue'));
check('the queued task carries the day it was given, not the day it was queued',
  qDated.length === 1 && qDated[0].date === offset(1), JSON.stringify(qDated.map(t => [t.name, t.date])));
check('… and the queue row says so — a pill only when the day is not today',
  /tomorrow/.test($('.ns-plan #queue-list').textContent));
w.PLAN.pickSub('home', 1);
check('the next task starts on the same day: a day is queued in one gesture', dWord() === 'tomorrow', dWord());
click($('.ns-plan #date-now'));
$('.ns-plan #task-name').value = 'take the bins out';
$('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
w.PLAN.addToQueue();
check('… and one put back on today wears no pill',
  !/tomorrow/.test([...d.querySelectorAll('.ns-plan #queue-list .q-item')][1].textContent),
  [...d.querySelectorAll('.ns-plan #queue-list .q-item')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | '));

/* What Todoist is actually told. */
const posts = [];
fetchScript = async (url, opts) => {
  if (opts && opts.method === 'POST') { posts.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ id: 'dd' + posts.length }), text: async () => '{}' }; }
  return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
};
const sentBefore = JSON.parse(w.localStorage.getItem('plan_sent_v1')).tasks.length;
w.PLAN.go('sending');
await tick(700);
const bodyOf = nm => posts.find(b => b.content === nm) || {};
check('each task is sent with its own explicit due date, never the word "today"',
  bodyOf('water the plants').due_date === offset(1) && bodyOf('take the bins out').due_date === today &&
  posts.every(b => !b.due_string),
  JSON.stringify(posts.map(b => [b.content, b.due_date, b.due_string])));
check("… and a subtask lands on its parent's day",
  bodyOf('fill the can').parent_id === 'dd1' && bodyOf('fill the can').due_date === offset(1),
  JSON.stringify(bodyOf('fill the can')));

w.PLAN.go('home');
const sentRec = JSON.parse(w.localStorage.getItem('plan_sent_v1')).tasks;
check("only the task due today joins plan_sent_v1 — LOG's evening form is about today",
  sentRec.length === sentBefore + 1 && sentRec[sentRec.length - 1].name === 'take the bins out',
  (sentRec.length - sentBefore) + ' added, last ' + (sentRec[sentRec.length - 1] || {}).name);
const plannedNames = w.PLAN.plannedToday().map(t => t.name);
check('… and plannedToday() says the same, for the queue as well as the sent',
  plannedNames.includes('take the bins out') && !plannedNames.includes('water the plants'),
  plannedNames.join(','));
const histDated = JSON.parse(w.localStorage.getItem('plan_history_v1'));
check('the sent history files a task under the day it is due, not the day it was pushed',
  histDated.length === 2 && (histDated.find(t => t.name === 'water the plants') || {}).date === offset(1) &&
  (histDated.find(t => t.name === 'take the bins out') || {}).date === today,
  JSON.stringify(histDated.map(t => [t.name, t.date])));
check('… and the row names that day',
  [...d.querySelectorAll('.ns-plan #sent-list .q-item')]
    .find(r => /water the plants/.test(r.textContent))?.textContent
    .includes(w.Prefs.formatDate(offset(1), 'short')));
confirmAnswer = true;
w.PLAN.clearSent(); w.PLAN.clearQueue();

/* An override written before the row existed has no key for it, and a missing
   key is not "off" — it is "not asked". */
w.Config.set('plan.formFields', { block: true, time: false, priority: true, subtasks: true });
w.PLAN.pickSub('home', 0);
check('an override predating the date row still shows it', !!$('.ns-plan #opts-date'));
w.SET.panel('plan');
const dateTog = () => $('.ns-set [data-cfg-toggle="plan.formFields.date"]');
check('… and the switch in settings shows it on', !!dateTog() && dateTog().classList.contains('on'),
  dateTog() ? dateTog().className : 'no switch');
click(dateTog());
check('… so one tap turns it off, not two', w.Config.get('plan.formFields').date === false,
  JSON.stringify(w.Config.get('plan.formFields')));
w.Shell.go('plan');
w.PLAN.pickSub('home', 0);
check('the date row follows the setting, like every other row',
  !$('.ns-plan #opts-date') && !!$('.ns-plan #opts-block'));
w.Config.reset('plan.formFields'); w.Config.reset('plan.defaultPriority');
w.PLAN.closeProj();

/* The open project tile is a heading, not a box: no wash, no border, one tile
   tall — and the same with the form open under it. The closed tile is a single
   row now, so a tile *is* what the heading used to be half of. */
check('an open project tile drops its box and stands one tile tall',
  /\.ns-plan \.proj-tile\.open\{[^}]*min-height:var\(--tile-h\)/.test(planCss) &&
  /\.ns-plan \.proj-tile\.open\{[^}]*background:none/.test(planCss) &&
  /\.ns-plan \.proj-tile\.open\{[^}]*border-color:transparent/.test(planCss));
check('… and neither :active nor a queued project paints it back in',
  /\.ns-plan \.proj-tile\.open:active,\.ns-plan \.proj-tile\.open\.has\{background:none\}/.test(planCss));
check('… and the form open under it no longer grows the heading',
  !/\.proj-tile\.open\.wide\{[^}]*min-height/.test(planCss));

// the gap under the title band: the shell's, and the same on every app
check('the gap under the band is set once, in shell.css', /\.view-body #s-home\{padding-top:18px\}/.test(shellCss) &&
  /\.view-body #s-home > :first-child\{margin-top:0\}/.test(shellCss));
w.Shell.go('do');
const firstOf = () => {
  const kids = [...$('.ns-do #s-home').children];
  return { marked: kids.filter(el => el.classList.contains('first-vis')),
           shown: kids.find(el => !el.classList.contains('hidden')) };
};
w.DO.setTab('daily');
let fv = firstOf();
check('DO marks the first section actually on screen, so its gap matches the rest',
  fv.marked.length === 1 && fv.marked[0] === fv.shown, (fv.marked[0] || {}).id + ' vs ' + (fv.shown || {}).id);
w.DO.setTab('other');
fv = firstOf();
check('… and re-marks it when a tab hides the sections above it',
  fv.marked.length === 1 && fv.marked[0] === fv.shown, (fv.marked[0] || {}).id + ' vs ' + (fv.shown || {}).id);
w.DO.setTab('daily');

// ── 29. 2.19 — search, DO's quick cards and its history, PLAN presets, LOG's alert ─

/* ── search ── */
w.Shell.go('do');
key('/');
check('"/" opens search rather than settings',
  $('#search').classList.contains('on') && $('#search-back').classList.contains('on'));
key('3');
check('… and the sheet owns the keyboard while it is up: no tab change',
  $('.tab-b.on').getAttribute('aria-label') === 'DO', $('.tab-b.on').getAttribute('aria-label'));
const sq = $('#search-q');
const type = v => { sq.value = v; sq.dispatchEvent(new w.Event('input', { bubbles: true })); };
type('tomat');
check('search finds a grocery item by its aisle content',
  [...d.querySelectorAll('#search-out .sr')].some(r => /tomato/.test(r.textContent) && /STORE/.test(r.textContent)),
  [...d.querySelectorAll('#search-out .sr')].slice(0, 3).map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
type('corner');
const cornerHit = w.SEARCH.results('corner')[0];
check('… and a settings dial by the label it actually wears',
  !!cornerHit && /corner radius/i.test(cornerHit.title) && cornerHit.sub.includes('layout'),
  cornerHit ? cornerHit.title + ' / ' + cornerHit.sub : 'no hit');
type('mixing');
check('… a PLAN section, named for its project',
  w.SEARCH.results('mixing').some(r => /mixing/i.test(r.title) && /PLAN/.test(r.sub)),
  JSON.stringify(w.SEARCH.results('mixing').slice(0, 2).map(r => r.title + ' / ' + r.sub)));
/* The index is derived, never a second list: rename a routine and it is
   findable at once. */
const rts = w.Config.get('do.routines');
rts.routinep1.label = 'zzz morning ritual';
w.Config.set('do.routines', rts);
check('… and a routine renamed a second ago, because nothing here is a copy',
  w.SEARCH.results('zzz morning').some(r => /zzz morning ritual/.test(r.title)),
  JSON.stringify(w.SEARCH.results('zzz morning').map(r => r.title)));
w.Config.reset('do.routines'); w.Config.reset('do.tabs');
type('learn');
const appHit = w.SEARCH.results('learn').find(r => r.kind === 'app');
check('an app is its own first result', !!appHit && appHit.title === 'LEARN');
/* A module's rows are labelled with the app they came from, never left blank. */
w.Shell.go('tend');
check('a plant is found by its room, and the row says which app it is in',
  w.SEARCH.results('kitchen').some(r => r.kind === 'tend' && /basil/i.test(r.title)),
  JSON.stringify(w.SEARCH.results('kitchen').map(r => r.kind + ':' + r.title).slice(0, 3)));
/* Picking a settings hit lands on that panel, with the sheet gone. */
type('corner');
click([...d.querySelectorAll('#search-out .sr')][0]);
await tick();
check('picking a dial closes search and lands on its panel',
  !$('#search').classList.contains('on') && $('.ns-set .set-panel.on')?.dataset.panel === 'layout',
  $('.ns-set .set-panel.on')?.dataset.panel);
w.SEARCH.open(); key('Escape', $('#search-q'));
check('Escape closes it', !$('#search').classList.contains('on'));
check('the search sheet is a sibling of #views, never inside #track',
  $('#search').parentElement === d.body && $('#search-back').parentElement === d.body);

/* ── DO · @quick ── */
const qkOpen = new Map([
  ['q1', { id:'q1', content:'change the filter', labels:['quick'], project_id:'P1', parent_id:null, open:true }],
  ['q2', { id:'q2', content:'desk reset',        labels:['quick'], project_id:'P1', parent_id:null, open:true }],
  ['q2a',{ id:'q2a',content:'clear the cables',  labels:[],        project_id:'P1', parent_id:'q2',  open:true }],
  ['q2b',{ id:'q2b',content:'wipe it down',      labels:[],        project_id:'P1', parent_id:'q2',  open:true }],
]);
const closed = [];
fetchScript = async (url, opts) => {
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const m = url.match(/\/tasks\/(\w+)\/(close|reopen)/);
  if (m) { const t = qkOpen.get(m[1]); if (t) t.open = m[2] === 'reopen'; closed.push(m[2] + ':' + m[1]);
           return { ok: true, status: 204, json: async () => null, text: async () => '' }; }
  if (url.includes('/labels')) return ok([{ id:'l9', name:'quick', color:'lime_green' }]);
  if (url.includes('/tasks?')) {
    const p = new URL(url).searchParams;
    const lab = p.get('label'), proj = p.get('project_id');
    const rows = [...qkOpen.values()].filter(t => t.open &&
      (lab ? t.labels.includes(lab) : proj ? t.project_id === proj : false));
    return ok(rows.map(t => ({ id:t.id, content:t.content, labels:t.labels, priority:1, due:null,
                               project_id:t.project_id, parent_id:t.parent_id })));
  }
  return ok([]);
};
w.Config.set('do.mediaLabels', []);            // keep this refresh to the quick fetch alone
await w.DO.refreshToday(true);
w.Shell.go('do'); w.DO.setTab('daily');
const qkBox = () => $('.ns-do #td-quick');
const qkCards = () => [...qkBox().querySelectorAll('.qk')];
check('a @quick task is a card under the routine cards', !qkBox().classList.contains('hidden') &&
  qkCards().length === 2 && $('.ns-do #s-home').children[0]?.id !== 'td-quick', qkCards().length + ' cards');
const withSub = () => qkCards().find(c => /desk reset/.test(c.textContent));
check('… and one with subtasks is a checklist, counted on its head',
  withSub().classList.contains('has-sub') && withSub().querySelectorAll('.qk-item').length === 2 &&
  /0 \/ 2 done/.test(withSub().querySelector('.qk-sub').textContent),
  withSub().querySelector('.qk-sub').textContent);
check('… while one without is the tick itself',
  !qkCards().find(c => /change the filter/.test(c.textContent)).classList.contains('has-sub'));
w.DO.toggleQuickTask('q2'); await tick(30);
check('the head of a card with subtasks does not close it — its rows do',
  qkOpen.get('q2').open === true && !closed.length, closed.join(','));
w.DO.toggleQuickSub('q2', 'q2a'); await tick(40);
check('ticking one subtask closes that subtask and leaves the parent open',
  qkOpen.get('q2a').open === false && qkOpen.get('q2').open === true &&
  /1 \/ 2 done/.test(withSub().querySelector('.qk-sub').textContent),
  closed.join(',') + ' | ' + withSub().querySelector('.qk-sub').textContent);
w.DO.toggleQuickSub('q2', 'q2b'); await tick(40);
check('… and ticking the last one closes the parent too, which Todoist will not do',
  qkOpen.get('q2b').open === false && qkOpen.get('q2').open === false &&
  withSub().classList.contains('done'), closed.join(','));
w.DO.toggleQuickSub('q2', 'q2b'); await tick(40);
check('unticking a row reopens the row and the parent with it',
  qkOpen.get('q2b').open === true && qkOpen.get('q2').open === true && !withSub().classList.contains('done'),
  closed.join(','));
w.DO.toggleQuickTask('q1'); await tick(40);
check('a childless quick task closes on its own tick',
  qkOpen.get('q1').open === false &&
  qkCards().find(c => /change the filter/.test(c.textContent)).classList.contains('done'));
/* A closed task is kept for the day so it can be unticked, and the refetch
   does not lose the subtask that is no longer returned. */
await w.DO.refreshToday(true);
check('a task closed here stays on the list, ticked, until midnight',
  qkCards().length === 2 && qkCards().find(c => /change the filter/.test(c.textContent)).classList.contains('done'),
  qkCards().length + ' cards');
check('… and a subtask closed here is carried over rather than dropped',
  withSub().querySelectorAll('.qk-item').length === 2 &&
  /1 \/ 2 done/.test(withSub().querySelector('.qk-sub').textContent),
  withSub().querySelector('.qk-sub').textContent);
w.SET.panel('do');
check('the label is a Config field on DO\'s panel, not a constant',
  $('.ns-set #td-quick-label')?.dataset.cfg === 'do.quickLabel' && $('.ns-set #td-quick-label').value === 'quick',
  $('.ns-set #td-quick-label')?.value);
w.Shell.go('do');
w.DO.toggleQuick();
check('switching the section off empties it as well as hiding it',
  qkBox().classList.contains('hidden') && qkBox().innerHTML === '');
w.DO.toggleQuick();
w.Config.reset('do.mediaLabels');

/* ── DO · the history the sweep used to throw away ── */
w.DO.go('home');
w.DO.openRoutine('routinep1');
const rItems = [...d.querySelectorAll('.ns-do .item-btn')];
click(rItems[0]); click(rItems[1]);
w.DO.go('home');
const liveNow = w.DO.statsFor(today);
check('today reads live out of the record being written',
  !!liveNow && liveNow.done === 2 && liveNow.total > 2, JSON.stringify(liveNow));
const cells = () => [...d.querySelectorAll('.ns-do #do-hist .dh-cell')];
check('the strip draws one cell per day asked for, flexed rather than fixed',
  cells().length === w.Config.get('do.history').days && !!$('.ns-do #do-hist .dh-legend'),
  cells().length + ' cells');
const RealDate2 = w.Date;
w.Date = class extends RealDate2 {
  constructor(...a) { a.length ? super(...a) : super(RealDate2.now() + 86400000); }
  static now() { return RealDate2.now() + 86400000; }
};
w.Shell.checkDay();
const folded = w.DO.statsFor(today);
check('the swept day is folded into a tally instead of being thrown away',
  !!folded && folded.done === 2 && w.localStorage.getItem('do_' + today) === null, JSON.stringify(folded));
check('… under a key the do_ sweep cannot reach', w.localStorage.getItem('do-stats-v1') !== null &&
  !('do-stats-v1'.startsWith('do_')));
w.Date = RealDate2;
w.Shell.checkDay();
check('and it survives the roll back, when the record itself is long gone',
  (w.DO.statsFor(today) || {}).done === 2, JSON.stringify(w.DO.statsFor(today)));
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('reports'); w.LOG.loadReportLocal('weekly');
check('the weekly report grows a routines row out of it',
  /\| routines \| \d+% ticked · \d+ day/.test($('.ns-log #rep-pre').textContent),
  ($('.ns-log #rep-pre').textContent.match(/\| routines \|.*/) || ['no row'])[0]);

/* ── PLAN · queue presets ── */
w.Shell.go('plan');
confirmAnswer = true;
w.PLAN.clearQueue();
for (const nm of ['mix the intro', 'bounce the stems']) {
  w.PLAN.openProj('curate'); w.PLAN.pickSub('curate', 0);
  $('.ns-plan #task-name').value = nm;
  $('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
  w.PLAN.addToQueue();
}
w.prompt = () => 'studio monday';
w.PLAN.savePreset();
const saved = w.Config.get('plan.presets');
check('a queue saves as a preset — its tasks, never its day',
  saved.length === 1 && saved[0].label === 'studio monday' && saved[0].tasks.length === 2 &&
  saved[0].tasks.every(t => t.date === undefined), JSON.stringify(saved[0] && saved[0].tasks.map(t => t.name)));
check('… and it shows on the queue row as a chip naming the count',
  /studio monday/.test($('.ns-plan #queue-presets').textContent) &&
  /2/.test($('.ns-plan #queue-presets .pre-b em').textContent));
w.PLAN.clearQueue();
w.PLAN.applyPreset(saved[0].key);
const requeued = JSON.parse(w.localStorage.getItem('plan_queue'));
check('one tap refills the queue, dated from today rather than from the day it was saved',
  requeued.length === 2 && requeued[0].name === 'mix the intro' && requeued.every(t => t.date === today),
  JSON.stringify(requeued.map(t => [t.name, t.date])));
w.SET.panel('plan');
check('a preset is editable content like everything else',
  !!$('.ns-set [data-group="plan.presets"] input[data-field="label"]'));
w.Shell.go('plan');
w.PLAN.deletePreset(saved[0].key);
check('deleting one takes its chip with it',
  (w.Config.get('plan.presets') || []).length === 0 && $('.ns-plan #queue-presets').classList.contains('hidden'));
w.PLAN.clearQueue();

/* ── LOG · the tab alert ── */
const logIcon = () => $('.tab-b[data-app="log"] use').getAttribute('href');
const logBtn = () => $('.tab-b[data-app="log"]');
w.localStorage.removeItem('log_' + today);
w.LOG.resetDate();
w.Config.set('log.alerts', { on: true, morning: '00:00', evening: '00:00', plan: '00:00' });
check('an unwritten morning past its hour turns the LOG tab into a "!"',
  w.LOG.alertReason() === 'morning' && logIcon() === '#tab-alert' && logBtn().classList.contains('has-alert'),
  w.LOG.alertReason() + ' / ' + logIcon());
w.Shell.go('log'); w.LOG.go('morning');
$('.ns-log #m-sl').value = '7'; w.LOG.saveMorning();
check('writing it moves the flag on to the evening rather than clearing it',
  w.LOG.alertReason() === 'evening' && logIcon() === '#tab-alert', w.LOG.alertReason());
w.LOG.go('evening'); $('.ns-log #e-kme').value = '2'; w.LOG.saveEvening();
/* The unplanned-tomorrow rule is PLAN's business, so it flags PLAN — a "!" on
   LOG that means "go and use the other app" pointed at the wrong door. LOG
   still owns the rule, the hours and the preview. */
const planIcon = () => $('.tab-b[data-app="plan"] svg use').getAttribute('href');
const planBtn  = () => $('.tab-b[data-app="plan"]');
check('… and with both halves written it is tomorrow that is unplanned — flagged on PLAN, not LOG',
  w.LOG.alertReason() === 'plan' && planIcon() === '#tab-alert' &&
  planBtn().classList.contains('has-alert') && logIcon() === '#tab-log' &&
  !logBtn().classList.contains('has-alert'),
  w.LOG.alertReason() + ' log=' + logIcon() + ' plan=' + planIcon());
w.Shell.go('plan');
w.PLAN.openProj('home'); w.PLAN.pickSub('home', 0);
$('.ns-plan #task-name').value = 'clear the desk';
$('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
w.PLAN.optPick($('.ns-plan #opts-block .opt-b'), 'block', 'b1');
w.PLAN.stepDate(1);
w.PLAN.addToQueue();
check('planning one block for tomorrow answers it: PLAN\'s icon goes back',
  w.PLAN.plannedOn(offset(1)).blocks === 1 && w.LOG.refreshAlert() === null &&
  planIcon() === '#tab-plan' && !planBtn().classList.contains('has-alert') &&
  logIcon() === '#tab-log' && !logBtn().classList.contains('has-alert'),
  JSON.stringify(w.PLAN.plannedOn(offset(1))) + ' / ' + planIcon());
check('an alerting tab wears a filled pill, not only a "!"',
  /\.tab-b\.has-alert::before\{[^}]*opacity:1/.test(fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8')) &&
  /\.tab-b\.has-alert::before\{[^}]*background:var\(--or\)/.test(fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8')));
w.LOG.testAlert('evening');
check('the settings preview really changes the tab, and says which rule it is showing',
  logIcon() === '#tab-alert' && /preview/.test($('.ns-log #al-status').textContent),
  $('.ns-log #al-status').textContent);
w.LOG.testAlert('plan');
check('… and previewing the plan rule moves the "!" to PLAN',
  planIcon() === '#tab-alert' && logIcon() === '#tab-log',
  'log=' + logIcon() + ' plan=' + planIcon());
w.LOG.testAlert('');
check('… and switching the preview off puts the real state back',
  logIcon() === '#tab-log' && /nothing to flag/.test($('.ns-log #al-status').textContent),
  $('.ns-log #al-status').textContent);
w.Config.set('log.alerts', { on: false, morning: '00:00', evening: '00:00', plan: '00:00' });
w.localStorage.removeItem('log_' + today); w.LOG.resetDate();
check('switched off it never flags, whatever the hour',
  w.LOG.alertReason() === null && logIcon() === '#tab-log');
w.Config.reset('log.alerts');
w.PLAN.clearQueue();

// ── 30. 2.20 — the exported day, drawn as a calendar ───────────────────────
w.Prefs.reset('apps');
w.Shell.go('cal');

/* The line §8 draws around PLAN is drawn around CAL too: it is a view of what
   PLAN resolved, and it talks to nothing. */
const calJs = fs.readFileSync(path.join(ROOT, 'js/cal.js'), 'utf8');
check('CAL reaches for nothing — no endpoint, no fetch, the calendar half is still not ROOT\'s',
  !/https?:\/\//.test(calJs) && !/\bfetch\s*\(/.test(calJs) && !/XMLHttpRequest/.test(calJs),
  (calJs.match(/https?:\/\/[^\s'"`]+/g) || []).join(' '));
check('CAL is a module with a tab, a slide and a settings panel',
  !!w.CAL && w.Shell.TABS.includes('cal') && !!$('#view-cal') &&
  !!$('.tab-b[data-app="cal"]') && !!$('.ns-set .set-panel[data-panel="cal"]'),
  w.Shell.TABS.join(','));
/* Section 27 already exported a day through the real button, so CAL is holding
   one — which is itself worth saying out loud before clearing it. */
check('the export back in §27 landed here without CAL being asked',
  w.CAL.days().length > 0, w.CAL.days().join(','));
confirmAnswer = true;
w.CAL.clearAll();
check('clearing empties the key and puts the empty state back',
  !w.CAL.days().length && !!$('.ns-cal .cal-empty') && /nothing planned/.test($('.ns-cal .cal-empty').textContent),
  $('.ns-cal #cal-body').textContent.trim().slice(0, 60));

/* Two tasks, two projects, exported for tomorrow. */
w.Shell.go('plan');
confirmAnswer = true;
w.PLAN.clearSent();
let calSent = 0;
fetchScript = async (url, opts) => {
  if (opts && opts.method === 'POST') { calSent++; return { ok: true, status: 200, json: async () => ({ id: 'c' + calSent }), text: async () => '{}' }; }
  return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
};
queueOne('home',   2, 'clear the desk', 'b1');
queueOne('curate', 0, 'mix the track',  'b1');
w.PLAN.go('sending');
await tick(900);
w.PLAN.toggleSent(rowFor('clear the desk'));
w.PLAN.toggleSent(rowFor('mix the track'));
w.PLAN.openExport();
click(slotBtn('clear the desk', 'b1a'));
click(slotBtn('mix the track', 'b2a'));
const calDay = $('.ns-plan #exp-date').value;              // tomorrow
await w.PLAN.doExport();
await tick();

const stored = () => JSON.parse(w.localStorage.getItem('cal_days_v1') || '{"days":{}}').days;
const rec = () => stored()[calDay];
check('exporting writes the day into cal_days_v1, under the day it is for',
  !!rec() && rec().day === calDay && Object.keys(stored()).length === 1, Object.keys(stored()).join(','));
check('… carrying the four things the export was given',
  rec().start === '07:00' && rec().template === 'normal' && rec().mode === 'blocks' &&
  Array.isArray(rec().notes), JSON.stringify({ s: rec().start, t: rec().template, m: rec().mode }));

/* The whole template goes down, not just the two rows the export writes: CAL
   is a view of the day, and the day has a shape either way. */
const evs = () => rec().events;
const kinds = k => evs().filter(e => e.kind === k);
check('the whole template is stored, not only what blocks-mode exported',
  evs().length === w.Config.defaults('plan.dayTemplates').normal.length, evs().length + ' rows');
check('… the two given slots stored as tasks, the four unclaimed ones as idle, the rest as fixed',
  kinds('task').length === 2 && kinds('idle').length === 4 && kinds('fixed').length === 14,
  `task ${kinds('task').length} / idle ${kinds('idle').length} / fixed ${kinds('fixed').length}`);
check('every row carries the clock time PLAN resolved it to, from the one start',
  evs()[0].from === '07:00' && evs()[0].to === '07:30' &&
  kinds('task').find(e => e.slot === 'b1a').from === '11:00',
  evs()[0].from + '–' + evs()[0].to);

/* The colour is the project's own — the same one PLAN paints its tile with,
   which is what "the same colours as plan" has to mean to be worth anything. */
w.Shell.go('plan');
const tileColor = key => {
  const t = d.querySelector(`.ns-plan .proj-tile[data-flip="p:${key}"]`);
  return t ? (String(t.getAttribute('style') || '').match(/--proj-color:\s*([^;"]+)/) || [])[1]?.trim() : null;
};
check('a task row wears its project\'s colour, the very one PLAN\'s tile uses',
  kinds('task').find(e => e.project === 'home').color === tileColor('home') &&
  kinds('task').find(e => e.project === 'curate').color === tileColor('curate') &&
  tileColor('home') !== tileColor('curate'),
  `${kinds('task').find(e => e.project === 'home').color} vs tile ${tileColor('home')}`);
check('… and the calendar each task was exported to travels with it',
  kinds('task').find(e => e.slot === 'b2a').cal === '02A1 | curate project mixing' &&
  kinds('task').find(e => e.slot === 'b1a').cal === '02B4 | home',
  kinds('task').map(e => e.cal).join(' | '));

/* A stored day is self-contained: renaming the project later must not repaint
   a day already planned, because the day is a record, not a live query. */
const homeWas = tileColor('home');
const types = w.Config.get('plan.types');
types.find(t => t.key === 'home').color = '#000000';
w.Config.set('plan.types', types);
check('recolouring a project repaints its tile but not the days already planned',
  tileColor('home') === '#000000' && homeWas !== '#000000' &&
  rec().events.find(e => e.project === 'home').color === homeWas,
  `stored ${rec().events.find(e => e.project === 'home').color} / tile now ${tileColor('home')}`);
w.Config.reset('plan.types');

// ── the drawing ──
w.Shell.go('cal');
const evRows = () => [...d.querySelectorAll('.ns-cal .cal-ev')];
const styleOf = (el, prop) => (String(el.getAttribute('style') || '').match(new RegExp(prop + ':\\s*([^;"]+)')) || [])[1]?.trim();
check('CAL lands on the day just exported and draws every row of it',
  w.CAL.selected() === calDay && evRows().length === evs().length, evRows().length + ' drawn');
check('the date sits in the title band beside the wordmark, in lower case',
  $('#view-cal > .h-top #cal-band-date .cbd-date').textContent ===
    $('#view-cal #cal-band-date .cbd-date').textContent.toLowerCase() &&
  /tomorrow/.test($('#view-cal #cal-band-date .cbd-rel').textContent),
  $('#view-cal #cal-band-date').textContent);
check('… on the wordmark\'s own row, at a declared height so it cannot grow the band',
  !!$('#view-cal > .h-top > .h-logo-row > .h-logo') &&
  !!$('#view-cal > .h-top > .h-logo-row > #cal-band-date') &&
  /\.ns-cal \.cal-band-date\{[^}]*height:32px/.test(fs.readFileSync(path.join(ROOT, 'css/cal.css'), 'utf8')));
check('… and the head says what the day is made of, lower case too',
  /normal/.test($('.ns-cal .ch-meta').textContent) && /07:00/.test($('.ns-cal .ch-meta').textContent) &&
  /2 tasks/.test($('.ns-cal .ch-meta').textContent) &&
  $('.ns-cal .ch-meta').textContent === $('.ns-cal .ch-meta').textContent.toLowerCase(),
  $('.ns-cal .ch-meta').textContent);
check('DAY opts out of the caps switch by name, the one app that does',
  /\.ns-cal \.cbd-date\{[^}]*text-transform:none/.test(fs.readFileSync(path.join(ROOT, 'css/cal.css'), 'utf8')) &&
  /\.ns-cal \.ch-meta\{[^}]*text-transform:none/.test(fs.readFileSync(path.join(ROOT, 'css/cal.css'), 'utf8')));
/* Fixed, so it may not live in the slide: a transformed ancestor would become
   its containing block, and #track animates transforms. */
check('the day stepper is a sibling of #views, never inside #track',
  $('#cal-steps').parentElement === d.body && !$('#track #cal-steps') &&
  $('#cal-steps').classList.contains('ns-cal'),
  $('#cal-steps').parentElement?.tagName);
check('an hour is drawn an hour tall — the height is the duration, not a constant',
  styleOf(evRows()[0], '--ev-h') === '28px' &&            // 30 min at the default 56px/hour
  styleOf(evRows().find(r => r.classList.contains('task')), '--ev-h') === '84px',
  evRows().slice(0, 3).map(r => styleOf(r, '--ev-h')).join(','));
check('the task rows carry the project colour into the drawing',
  styleOf(evRows().find(r => r.classList.contains('task')), '--ev-color') === tileColor('home'),
  styleOf(evRows().find(r => r.classList.contains('task')), '--ev-color'));
check('a fixed row is coloured by the calendar it sits on, from cal.eventColors',
  styleOf(evRows()[0], '--ev-color') === w.Config.get('cal.eventColors')['01A1 | routine'],
  styleOf(evRows()[0], '--ev-color'));
check('an unclaimed slot is named and marked, never shown as a task',
  evRows().some(r => r.classList.contains('idle') && /free/.test(r.textContent)),
  evRows().filter(r => r.classList.contains('idle')).map(r => r.textContent.trim()).join(' | '));

/* Left and right, one day at a time, through the days that exist. */
const arrows = () => [...d.querySelectorAll('.ns-cal .cal-arrow')];
const backBtn = () => arrows()[0], fwdBtn = () => arrows()[1];
check('the day is stepped with two arrows, not a strip of chips',
  arrows().length === 2 && !d.querySelector('.ns-cal .cal-chip'), arrows().length + ' arrows');
check('tomorrow is the last day there is, so forward is darkened and disabled',
  fwdBtn().classList.contains('off') && fwdBtn().disabled && !backBtn().classList.contains('off'),
  'fwd off=' + fwdBtn().classList.contains('off') + ' back off=' + backBtn().classList.contains('off'));
click(backBtn());
check('stepping back lands on today — unplanned, and it says so rather than drawing yesterday\'s',
  w.CAL.selected() === today && !!$('.ns-cal .cal-empty'), w.CAL.selected());
check('… and now it is back that has nowhere to go',
  backBtn().classList.contains('off') && backBtn().disabled && !fwdBtn().classList.contains('off'));
click(backBtn());
check('a disabled arrow does nothing at all', w.CAL.selected() === today);
click(fwdBtn());
check('… and forward brings the planned day back', w.CAL.selected() === calDay && !!$('.ns-cal .cal-day'));

// ── the dials ──
w.Prefs.set('calShowFixed', false);
check('switching the template off leaves only the blocks',
  evRows().length === 6 && !evRows().some(r => r.classList.contains('fixed')), evRows().length + ' rows');
w.Prefs.set('calShowIdle', false);
check('… and switching the unclaimed hours off leaves only the two tasks',
  evRows().length === 2 && evRows().every(r => r.classList.contains('task')), evRows().length + ' rows');
w.Prefs.set('calHour', 100);
check('the hour dial really changes the drawing',
  styleOf(evRows()[0], '--ev-h') === '150px', styleOf(evRows()[0], '--ev-h'));
w.Prefs.set('calHour', 56);
w.Prefs.set('calCalNames', true);
check('calendar names can be put on the rows',
  /02B4 \| home/.test(evRows()[0].textContent), evRows()[0].textContent.trim());
w.Prefs.set('calCalNames', false);
w.Prefs.set('calShowFixed', true); w.Prefs.set('calShowIdle', true);

/* A failed export is not a planned day. */
w.Shell.go('plan');
w.PLAN.toggleSent(rowFor('clear the desk'));
w.PLAN.openExport();
click(slotBtn('clear the desk', 'b1b'));
const failDay = $('.ns-plan #exp-date').value;
const beforeFail = JSON.stringify(stored());
fetchScript = async (url, opts) => (opts && opts.method === 'POST')
  ? { ok: false, status: 500, json: async () => ({}), text: async () => '' }
  : { ok: true, status: 200, json: async () => [], text: async () => '[]' };
await w.PLAN.doExport();
await tick();
check('an export that failed writes no day — a drawn day is a scheduled day',
  JSON.stringify(stored()) === beforeFail && failDay === calDay, Object.keys(stored()).join(','));

/* Re-exporting a day is how you correct it, so the last export wins whole. */
fetchScript = async (url, opts) => (opts && opts.method === 'POST')
  ? { ok: true, status: 200, json: async () => ({ id: 'c9' }), text: async () => '{}' }
  : { ok: true, status: 200, json: async () => [], text: async () => '[]' };
await w.PLAN.doExport();
await tick();
check('re-exporting the same day replaces it rather than merging into it',
  Object.keys(stored()).length === 1 && rec().events.filter(e => e.kind === 'task').length === 1 &&
  rec().events.find(e => e.kind === 'task').slot === 'b1b',
  rec().events.filter(e => e.kind === 'task').map(e => e.slot).join(','));

/* A day that is nothing but template, with the template switched off, is the
   one state where the drawing really is empty. It has to say which dials did
   that — "nothing planned" would be a lie about a day that was planned. */
w.CAL.write({ day: offset(3), start:'07:00', template:'normal', mode:'blocks', notes:[],
  events: [{ from:'07:00', to:'07:30', dur:30, kind:'fixed', name:'routine p1', cal:'01A1 | routine' }] });
w.Prefs.set('calShowFixed', false); w.Prefs.set('calShowIdle', false);
check('a day whose every row is switched off says so, rather than "nothing planned"',
  !!$('.ns-cal .cal-empty') && /switched off/.test($('.ns-cal .cal-empty').textContent) &&
  !!$('.ns-cal .cal-head'),
  $('.ns-cal .cal-empty').textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
w.Prefs.set('calShowFixed', true); w.Prefs.set('calShowIdle', true);
w.CAL.pick(calDay);

/* The keep window sweeps behind and never ahead. */
const old = JSON.parse(w.localStorage.getItem('cal_days_v1'));
old.days[offset(-400)] = { day: offset(-400), events: [], notes: [] };
old.days[offset(400)]  = { day: offset(400),  events: [], notes: [] };
w.localStorage.setItem('cal_days_v1', JSON.stringify(old));
w.Shell.go('cal');                                     // onShow reloads, the dial prunes
w.Prefs.set('calKeep', 30);
check('a day past the keep window is swept, and a day far ahead never is',
  !stored()[offset(-400)] && !!stored()[offset(400)], Object.keys(stored()).join(','));
w.Prefs.reset('calKeep');

/* Findable and accounted for, like everything else. */
check('a planned task is findable by its own name, and the row names the day it is on',
  w.SEARCH.results('clear the desk').some(r => r.kind === 'cal' && /clear the desk/.test(r.title) && r.sub.includes(calDay)),
  JSON.stringify(w.SEARCH.results('clear the desk').map(r => r.kind + ':' + r.sub).slice(0, 3)));
w.Shell.go('settings'); w.SET.panel('cal');
check('CAL\'s panel renders, with its dials and its stored count',
  !!$('.ns-set .set-panel[data-panel="cal"] [data-pref="calHour"]') &&
  /day/.test($('.ns-set #cal-status').textContent), $('.ns-set #cal-status').textContent);
check('… and its event colours are editable content like every other branch',
  !!$('.ns-set [data-content-for="cal"] [data-group="cal.eventColors"] textarea'),
  [...d.querySelectorAll('.ns-set [data-content-for="cal"] [data-group]')].map(b => b.dataset.group).join(','));
w.SET.panel('data');
check('cal_days_v1 is filed under DAY in the storage report',
  /DAY/.test($('.ns-set #panel-data').textContent), 'no DAY row');

// ── 31. 2.20.1 — a task over several hours, the day stepped, DAY, the row tile ─
/* A two-hour job used to have to be sent twice and picked twice. */
w.Shell.go('plan');
w.PLAN.toggleSent(rowFor('clear the desk'));
w.PLAN.openExport();
click(slotBtn('clear the desk', 'b1a'));
click(slotBtn('clear the desk', 'b1b'));
check('one task can hold more than one slot',
  slotBtn('clear the desk', 'b1a').classList.contains('on') &&
  slotBtn('clear the desk', 'b1b').classList.contains('on'),
  [...taskRows()[rowIdx('clear the desk')].querySelectorAll('.exp-slot.on')].map(b => b.textContent).join(','));
check('… and the row says how many hours it is taking, so it reads as deliberate',
  /2 slots/.test(taskRows()[rowIdx('clear the desk')].textContent),
  taskRows()[rowIdx('clear the desk')].textContent.replace(/\s+/g, ' ').trim());
check('… writing one line per slot — the same name twice, in the day\'s order',
  w.PLAN.exportDescription().split('\n\n')[1] === 'b1a | home | clear the desk\nb1b | home | clear the desk',
  JSON.stringify(w.PLAN.exportDescription().split('\n\n')[1]));
click(slotBtn('clear the desk', 'b1a'));
check('tapping one of its own slots gives back that hour alone, not the lot',
  !slotBtn('clear the desk', 'b1a').classList.contains('on') &&
  slotBtn('clear the desk', 'b1b').classList.contains('on'));
click(slotBtn('clear the desk', 'b1a'));
w.PLAN.toggleSent(rowFor('mix the track'));
click(slotBtn('mix the track', 'b1b'));
check('… while another task still cannot take an hour this one holds',
  !slotBtn('mix the track', 'b1b').classList.contains('on') &&
  /b1b is taken — by clear the desk/.test($('#toast').textContent), $('#toast').textContent);
click(slotBtn('mix the track', 'b2a'));
fetchScript = async (url, opts) => (opts && opts.method === 'POST')
  ? { ok: true, status: 200, json: async () => ({ id: 'm1' }), text: async () => '{}' }
  : { ok: true, status: 200, json: async () => [], text: async () => '[]' };
await w.PLAN.doExport();
await tick();
const multi = JSON.parse(w.localStorage.getItem('cal_days_v1')).days[calDay];
const deskRows = multi.events.filter(e => e.kind === 'task' && e.name === 'clear the desk');
check('a task holding two hours becomes two blocks on the day, both in its own colour',
  deskRows.length === 2 && deskRows.map(e => e.slot).join(',') === 'b1a,b1b' &&
  new Set(deskRows.map(e => e.color)).size === 1 &&
  multi.events.filter(e => e.kind === 'task').length === 3,
  multi.events.filter(e => e.kind === 'task').map(e => e.slot + ':' + e.name).join(' | '));

/* The tile is one row now, and the meta sits at its end rather than under it. */
check('a project tile is a single row: half the height, its meta on the right',
  /--tile-h:46px/.test(planCss) &&
  /\.ns-plan \.proj-tile\{[^}]*flex-direction:row/.test(planCss) &&
  /\.ns-plan \.proj-meta\{[^}]*text-align:right/.test(planCss),
  (planCss.match(/--tile-h:[^;]*/) || ['?'])[0]);

/* The wordmark is a label; `cal` is the identity, and stays one. */
check('the tab wears DAY while everything that is an identity stays cal',
  $('#view-cal .h-logo').textContent.replace(/\s/g, '') === 'DAY.' &&
  $('.tab-b[data-app="cal"] .tb-l').textContent === 'day' &&
  !!$('.ns-set .set-panel[data-panel="cal"]') && !!$('#view-cal.ns-cal') &&
  w.Prefs.APPS.includes('cal') && !!w.localStorage.getItem('cal_days_v1'),
  $('#view-cal .h-logo').textContent);
check('… and it is findable by the name it wears',
  w.SEARCH.results('day').some(r => r.kind === 'app' && r.title === 'DAY'),
  JSON.stringify(w.SEARCH.results('day').filter(r => r.kind === 'app').map(r => r.title)));

/* DO's today list gets the blocks section's gesture. */
/* Everything section 19 fetched has since been ticked or moved, so seed the
   list again the same way it did. */
w.Shell.go('do'); w.DO.setTab('daily');
fetchScript = async (url, opts) => {
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (opts && opts.method === 'POST') return ok({});
  if (url.includes('/projects')) return ok([{ id: 'p1', name: '04 | life', color: 'blue' }]);
  if (url.includes('/sections')) return ok([{ id: 's1', name: 'admin | tasks', project_id: 'p1' }]);
  if (url.includes('/tasks?')) return ok([
    { id: 'x1', content: 'move me one', labels: [], priority: 2, due: { date: today }, section_id: 's1' },
    { id: 'x2', content: 'move me two', labels: [], priority: 2, due: { date: today }, section_id: 's1' },
  ]);
  return ok([]);
};
$('.ns-do #td-today-filter').value = '04 | life';      // the rule section 19 used
w.DO.saveTodaySettings();
if (!JSON.parse(w.localStorage.getItem('do_todoist_v1')).todayOn) w.DO.toggleToday();
await w.DO.refreshToday();
await tick(150);
const openIds = JSON.parse(w.localStorage.getItem('do_todoist_v1')).today.tasks.filter(t => !t.done).map(t => t.id);
check('the today list has open fetched tasks to move', openIds.length > 0,
  'on=' + JSON.parse(w.localStorage.getItem('do_todoist_v1')).todayOn +
  ' tasks=' + JSON.stringify(JSON.parse(w.localStorage.getItem('do_todoist_v1')).today.tasks.map(t => t.id + (t.done ? '(done)' : ''))) +
  ' rows=' + d.querySelectorAll('.ns-do #td-today .tt-row').length);
check('"→ tomorrow" is offered whatever the hour now, not only after 20:00',
  [...d.querySelectorAll('.ns-do #td-today .tt-acts button')].some(b => b.textContent === '→ tomorrow'),
  [...d.querySelectorAll('.ns-do #td-today .tt-acts button')].map(b => b.textContent).join(','));
w.DO.toggleTodayMove();
check('it turns the rows from tick to select, the way the blocks section does',
  !!$('.ns-do #td-today .bk-move') &&
  /tap the tasks to move/.test($('.ns-do #td-today .bk-move').textContent) &&
  [...d.querySelectorAll('.ns-do #td-today .tt-row')].every(r => /selectToday/.test(r.getAttribute('onclick') || '')),
  $('.ns-do #td-today .bk-move')?.textContent.replace(/\s+/g, ' ').trim());
check('… with the move button disabled until something is picked',
  d.querySelector('.ns-do #td-today .bk-move-b').disabled);
w.DO.selectToday(openIds[0]);
check('picking a row marks it and arms the button',
  !!$('.ns-do #td-today .tt-row.sel') && !d.querySelector('.ns-do #td-today .bk-move-b').disabled &&
  /1 → tomorrow/.test($('.ns-do #td-today .bk-move').textContent),
  $('.ns-do #td-today .bk-move').textContent.replace(/\s+/g, ' ').trim());
w.DO.selectToday('tend:zzz');
check('a plant is not postponed from here — TEND owns those',
  /plants are TEND/.test($('#toast').textContent), $('#toast').textContent);
const deferPosts = [];
fetchScript = async (url, opts) => {
  if (opts && opts.method === 'POST') { deferPosts.push(String(url)); return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; }
  return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
};
confirmAnswer = true;
await w.DO.deferToday();
await tick(80);
check('only the picked task is moved, and it leaves the list',
  deferPosts.length === 1 && deferPosts[0].includes('/tasks/' + openIds[0]) &&
  JSON.parse(w.localStorage.getItem('do_todoist_v1')).today.tasks
    .filter(t => !t.done).length === openIds.length - 1,
  deferPosts.join(',') + ' | left ' + JSON.parse(w.localStorage.getItem('do_todoist_v1')).today.tasks.filter(t => !t.done).length);

// ── 32. 2.21 — the twelve fixes ───────────────────────────────────────────
const calCss2  = fs.readFileSync(path.join(ROOT, 'css/cal.css'), 'utf8');
const setCss   = fs.readFileSync(path.join(ROOT, 'css/settings.css'), 'utf8');
const doCss    = fs.readFileSync(path.join(ROOT, 'css/do.css'), 'utf8');

/* TRACK: what you had done before the app is a starting point, not a sprint. */
w.Shell.go('track');
if (!w.TRACK.progress().done) { w.TRACK.toggle('t01'); w.TRACK.toggle('t02'); }
const doneBefore = w.TRACK.progress().done;
check('there are ticks to bank', doneBefore > 0, String(doneBefore));
w.TRACK.baselineNow();
check('"everything ticked is my start" banks what is done and starts tracking tomorrow',
  w.TRACK.trackFrom() === offset(1) && w.TRACK.baseCount() === doneBefore &&
  w.TRACK.progress().done === doneBefore,
  `from ${w.TRACK.trackFrom()} · banked ${w.TRACK.baseCount()} · still done ${w.TRACK.progress().done}`);
check('… so nothing ticked before it can move the pace',
  w.TRACK.project().p === null || w.TRACK.project().p === 0,
  JSON.stringify(w.TRACK.project().p));
w.SET.panel('track');
check('the panel offers the tracking start and says how much is banked',
  !!$('.ns-set #setTrackFrom') && /kept out of the pace/.test($('.ns-set #baseNote').textContent),
  $('.ns-set #baseNote').textContent);

/* LOG: a third medication slot, additive to a contract the Obsidian side parses. */
check('log.meds ships a third slot — keys are the contract, labels are yours',
  Object.keys(w.Config.defaults('log.meds')).join(',') === 'lam,rit,m3',
  Object.keys(w.Config.defaults('log.meds')).join(','));
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('evening');
check('… the evening form drawing one button per slot rather than two by name',
  d.querySelectorAll('.ns-log #med-g .med-b').length === 3 && !!$('.ns-log #med-m3'),
  d.querySelectorAll('.ns-log #med-g .med-b').length + ' buttons');
w.LOG.toggleMed('m3');
$('.ns-log #e-kme').value = '3';
w.LOG.saveEvening();
check('… and the record writing meds_m3 beside the two that were always there',
  JSON.parse(w.localStorage.getItem('log_' + today)).e.meds_m3 === true,
  JSON.stringify(JSON.parse(w.localStorage.getItem('log_' + today)).e.meds_m3));
/* The .md is the contract the Obsidian side parses: one row per slot, the two
   original names untouched and the new one added after them. Additive, so a
   note written before today is unaffected and the parser (which looks rows up
   by name) simply finds no m3 row in it. */
const medNote = w.LOG.buildNote();
const medRec = JSON.parse(w.localStorage.getItem('log_' + today)).e;
const yn = v => (v ? 'yes' : 'no');
check('the exported note writes a row per slot, each matching the record',
  ['lam', 'rit', 'm3'].every(k =>
    new RegExp(`\\| meds_${k}\\s+\\| ${yn(medRec['meds_' + k])} \\|`).test(medNote)) &&
  medRec.meds_m3 === true,
  (medNote.match(/\| meds_\w+\s+\|[^\n]*/g) || []).join(' · '));
check('… in the order the slots are configured, so the table reads the same every day',
  (medNote.match(/\| (meds_\w+)/g) || []).join(',') === '| meds_lam,| meds_rit,| meds_m3',
  (medNote.match(/\| (meds_\w+)/g) || []).join(','));

/* The chrome. */
w.Prefs.set('chromeBlur', false);
check('the blur behind the bar is a setting, and off really removes it',
  d.documentElement.dataset.chromeBlur === 'off' &&
  /\[data-chrome-blur="off"\]\{[^}]*--chrome-blur:none/
    .test(fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8')),
  d.documentElement.dataset.chromeBlur);
w.Prefs.set('chromeBlur', true);
check('… and back on again', d.documentElement.dataset.chromeBlur === 'on');

/* jsdom does not cascade, so a broken stylesheet is invisible to every other
   check here. 2.21 added the blur override by opening a new selector *inside*
   :root, which closed the block early and left every token below it — including
   --title-base and --caps — applying only while blur was off. The whole app
   went lower case with miniscule wordmarks and 411 checks stayed green. This
   reads the file's shape instead. */
const tokensCss = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
const rootBlock = (tokensCss.match(/:root\s*\{[\s\S]*?\n\}/) || [''])[0];
const rootTokens = ['--title-base','--caps','--nav-fh','--scr-pad-b','--t-fade','--readable','--chrome-blur'];
check('every shell token is declared inside :root, not stranded in an override',
  !!rootBlock && rootTokens.every(t => rootBlock.includes(t + ':')),
  rootTokens.filter(t => !rootBlock.includes(t + ':')).join(',') || 'all present');
check('… and an override of one of them is a rule of its own, after :root closes',
  /\[data-chrome-blur="off"\]\{--chrome-blur:none\}/.test(tokensCss) &&
  !/:root\[data-chrome-blur/.test(tokensCss));
check('… with the file\'s braces balanced',
  (tokensCss.match(/\{/g) || []).length === (tokensCss.match(/\}/g) || []).length,
  (tokensCss.match(/\{/g) || []).length + ' open / ' + (tokensCss.match(/\}/g) || []).length + ' close');

/* The gaps, the colour, the icon — appearance, asserted where it lives. */
check('a status box has a gap above it as well as below',
  /\.ns-set \.td-status\{[^}]*margin:calc\(12px \* var\(--dens\)\) 0 8px/.test(setCss));
check('the content editors carry their own gap, so they never butt onto a danger button',
  /\.ns-set \.set-content\{[^}]*margin-top:calc\(26px \* var\(--dens\)\)/.test(setCss));
check('a quick card\'s second line takes the card\'s colour, like a block tile\'s tag',
  /\.ns-do \.qk-sub\{[^}]*color:var\(--bk-c/.test(doCss));
const calSymbol = (html.match(/<symbol id="tab-cal"[\s\S]*?<\/symbol>/) || [''])[0];
check('DAY wears a sun, not an agenda that read like PLAN\'s grid at 19px',
  /<circle/.test(calSymbol) && !/<rect/.test(calSymbol),
  calSymbol.replace(/\s+/g, ' ').slice(0, 90));
/* A tab icon is only doing its job if it is not another tab's icon. DAY's sun
   was a circle with eight radiating strokes and so was the settings gear —
   the same mark twice, which at 19px is one mark. A signature of each symbol's
   shapes catches that without anyone having to look. */
const tabSigs = [...html.matchAll(/<symbol id="(tab-[\w-]+)"[\s\S]*?<\/symbol>/g)].map(m =>
  [m[1], (m[0].match(/<(circle|rect|line|path|polyline|polygon)\b/g) || [])
    .map(s => s.slice(1)).sort().join('+')]);
const sigDupes = tabSigs.filter(([, sig], i) => tabSigs.findIndex(([, s]) => s === sig) !== i);
check('no two tab icons are built from the same shapes',
  tabSigs.length > 8 && sigDupes.length === 0,
  sigDupes.map(([n, s]) => n + ':' + s).join(', ') || tabSigs.length + ' distinct');
check('… settings wearing sliders now, which is what that panel actually is',
  /<symbol id="tab-set"[\s\S]*?<line[\s\S]*?<circle[\s\S]*?<\/symbol>/.test(html) &&
  !/<symbol id="tab-set"[^>]*>\s*<circle[^>]*\/>\s*<path/.test(html));

/* DAY's stepper and its empty day. */
check('the stepper is shown only while DAY is the slide on screen',
  /body:has\(#view-cal\.cur\) \.cal-steps\{display:flex\}/.test(calCss2) &&
  /\.cal-steps\{[\s\S]*?position:fixed/.test(calCss2));
w.Shell.go('cal'); w.CAL.pick(today);
check('an unplanned day offers one of DAY\'s own controls, not a stretched form button',
  !!$('.ns-cal .cal-empty') && !!$('.ns-cal .ce-go') && !d.querySelector('.ns-cal .cal-empty .btn'),
  $('.ns-cal .cal-empty')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 50));
check('… and the arrows are in the fixed stepper, not in the scrolling day',
  d.querySelectorAll('#cal-steps .cal-arrow').length === 2 &&
  !d.querySelector('#view-cal .cal-arrow'),
  d.querySelectorAll('#cal-steps .cal-arrow').length + ' in the stepper');
check('… drawn from the sprite like the nav\'s own arrows, never typed as characters',
  d.querySelectorAll('#cal-steps .cal-arrow svg use').length === 2 &&
  [...d.querySelectorAll('#cal-steps .cal-arrow svg use')].map(u => u.getAttribute('href')).join(',')
    === '#ico-chev-l,#ico-chev-r' &&
  ![...d.querySelectorAll('#cal-steps .cal-arrow')].some(b => /[←→]/.test(b.textContent)),
  [...d.querySelectorAll('#cal-steps .cal-arrow svg use')].map(u => u.getAttribute('href')).join(','));

check('no errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

/* ── a ninth app has to arrive on an install that already has an app list ────
   `apps` is stored whole, so without the appsSeen migration CAL would have no
   tab on any install that has ever opened the layout panel — which is every
   install that has been used. Proved by booting a second window with prefs
   already in localStorage, which is the only way to run Prefs.load() again. */
async function bootWith(seed) {
  const dom2 = new JSDOM(html, {
    url: 'http://localhost/root/index.html',
    runScripts: 'dangerously', resources: new LocalLoader(),
    pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(win) {
      win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
      win.requestAnimationFrame = fn => setTimeout(fn, 0);
      win.Element.prototype.scrollIntoView = function () {};
      win.HTMLElement.prototype.scrollIntoView = function () {};
      win.confirm = () => true;
      win.fetch = async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' });
      win.navigator.vibrate = () => true;
      win.localStorage.setItem('root_prefs_v1', JSON.stringify(seed));
    },
  });
  await new Promise(r => dom2.window.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 40));
  return dom2.window;
}

// an install from before CAL, with three apps in the bar and the rest switched off
const w2 = await bootWith({ apps: ['do', 'log', 'track'], theme: 'void' });
check('a new app reaches an install whose app list predates it',
  w2.Prefs.get('apps').includes('cal') && w2.Shell.TABS.includes('cal') &&
  !w2.document.querySelector('.tab-b[data-app="cal"]').classList.contains('hidden'),
  w2.Prefs.get('apps').join(','));
check('… in its shipped position, not tacked onto the end of settings',
  w2.Prefs.get('apps').join(',') === 'do,log,track,cal', w2.Prefs.get('apps').join(','));
check('… while the apps that install had switched off stay switched off',
  ['plan', 'store', 'tend', 'learn'].every(a => !w2.Prefs.get('apps').includes(a)),
  w2.Prefs.get('apps').join(','));
check('… and the migration records what it offered, so it runs once and not every boot',
  w2.Prefs.get('appsSeen').includes('cal') &&
  JSON.parse(w2.localStorage.getItem('root_prefs_v1')).appsSeen.includes('cal'),
  JSON.stringify(w2.Prefs.get('appsSeen')));

// an install that has already been offered CAL and turned it off keeps it off
const w3 = await bootWith({ apps: ['do', 'log'], appsSeen: w.Prefs.APPS.slice(), theme: 'void' });
check('an app switched off on purpose is not resurrected by the same migration',
  !w3.Prefs.get('apps').includes('cal') && !w3.Shell.TABS.includes('cal'),
  w3.Prefs.get('apps').join(','));

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
