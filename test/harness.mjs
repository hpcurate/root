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
check('eight tabs, settings last', w.Shell.TABS.length === 8 && w.Shell.TABS[7] === 'settings', w.Shell.TABS.join(','));
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
check('reset restores all eight in shipped order', w.Shell.TABS.join(',') === 'do,log,plan,store,tend,track,learn,settings', w.Shell.TABS.join(','));
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
check('apps switched off are listed on the settings home', [...d.querySelectorAll('.ns-set [data-open]')].map(b => b.dataset.open).join(',') === 'plan,store,tend,track,learn',
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
  [...d.querySelectorAll('.ns-set #set-seg .seg-b')].map(b => b.dataset.seg).join(',') === 'do,log,plan,store,tend,track,learn' &&
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
check('each slide is a band plus a scroll body', ['do','log','plan','store','tend','track','learn','settings'].every(a => {
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
const appSheets = ['do','log','plan','store','tend','track','learn','settings']
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
  /\.ns-plan \.proj-meta\{[^}]*color:var\(--proj-color/.test(fs.readFileSync(path.join(ROOT, 'css/plan.css'), 'utf8')) &&
  !!$('.ns-plan .proj-meta'));
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
  // before = the folded grid, after = curate open with three section rows
  const box = {
    before: { 'p:curate': [0, 0, 155, 92], queue: [0, 300, 340, 120] },
    after:  { 'p:curate': [0, 0, 340, 124], 'sec:0': [0, 132, 340, 46],
              'sec:1': [0, 186, 340, 46], 'sec:2': [0, 240, 340, 46], queue: [0, 340, 340, 120] },
  };
  w.Element.prototype.getBoundingClientRect = function () {
    const open = !!d.querySelector('.ns-plan .proj-tile.open');
    const r = (box[open ? 'after' : 'before'][this.dataset?.flip]) || [0, 0, 0, 0];
    return { left: r[0], top: r[1], width: r[2], height: r[3],
             right: r[0] + r[2], bottom: r[1] + r[3], x: r[0], y: r[1] };
  };

  w.PLAN.openProj('curate');
  const of = k => anims.find(a => a.key === k);

  const tile = of('p:curate');
  check('opening a project moves and scales only the tile that persists',
    !!tile && /scale\(0\.45\d*,\s*0\.74\d*\)/.test(tile.css), tile ? tile.css.slice(0, 110) : 'not animated');
  check('… and holds its contents back until the scale has nearly resolved, so no text is stretched',
    anims.some(a => a.key === 'p:curate > child' && /"opacity":0/.test(a.css) && /0\.45/.test(a.css)));

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

check('no errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
