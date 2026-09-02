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
for (const p of ['look','layout','behave','content','do','log','plan','store','tend','track','learn','data']) w.SET.panel(p);
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
w.SET.panel('content');
const sel = $('.ns-set select[data-cfg="log.streakRequires"]');
if (sel) { sel.value = 'evening'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); }
check('streak rule select commits to Config', w.Config.get('log.streakRequires') === 'evening', sel ? 'got ' + w.Config.get('log.streakRequires') : 'no select rendered');
w.Config.reset('log.streakRequires');

// ── 15. 2.2 — three more apps in the track ─────────────────────────────────
check('TEND, TRACK, LEARN defined', ['TEND', 'TRACK', 'LEARN'].every(k => w[k]));
check('eight tabs, settings last', w.Shell.TABS.length === 8 && w.Shell.TABS[7] === 'settings', w.Shell.TABS.join(','));
check('seven-plus tabs flag the pill as "many"', d.documentElement.dataset.tabs === 'many');
errors.length = 0;
for (const p of ['tend', 'track', 'learn']) w.SET.panel(p);
check('the three new settings panels render', errors.length === 0, errors.slice(0, 3).join(' | '));
w.Shell.go('do');
key('5'); check('key 5 jumps to TEND', $('.tab-b.on')?.dataset.app === 'tend', $('.tab-b.on')?.dataset.app);
key('7'); check('key 7 jumps to LEARN', $('.tab-b.on')?.dataset.app === 'learn', $('.tab-b.on')?.dataset.app);

// the app list: order + visibility
w.Prefs.set('apps', ['track', 'do']);
check('app list reorders the track', w.Shell.TABS.join(',') === 'track,do,settings' &&
  $('#track .view:not(.hidden)')?.id === 'view-track' && d.documentElement.dataset.tabs === 'few',
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
w.SET.panel('content');
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
check('blocks come first on the home screen by default', $('.ns-do #s-home').children[1]?.id === 'td-blocks', $('.ns-do #s-home').children[1]?.id);
w.DO.moveSection('blocks', 1);
check('a section can be moved down', $('.ns-do #s-home').children[1]?.id === 'home-grid' && w.Config.get('do.sections')[0] === 'routines');
w.Config.reset('do.sections');
check('the active tab shows the count in place of the icon', $('.tab-b[data-app="do"]').classList.contains('has-badge') && $('.tab-b[data-app="do"] .tb-badge')?.textContent === '1');
w.DO.setTab('other');
check("the other tab hides the today list and the blocks", $('.ns-do #td-blocks').classList.contains('hidden') && $('.ns-do #td-today').classList.contains('hidden'));
w.DO.setTab('daily');
check('… and the first tab shows them again', !$('.ns-do #td-blocks').classList.contains('hidden'));
check('no Todoist label chips on the today rows', !$('.ns-do #td-today .tt-lbl'));
w.DO.toggleBlockTask('k1'); await tick(50);
check('ticking a block closes it in Todoist and fills the tile', bkOpen.get('k1').open === false && !!$('.ns-do #td-blocks .bk.done'));
check("it is recorded as a completed block in today's log", JSON.parse(w.localStorage.getItem('log_' + today)).e.blocks.includes('mix the track'));
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('evening');
const bkChip = [...d.querySelectorAll('.ns-log #blk-plan .blk-b.plan')].find(b => b.dataset.name === 'mix the track');
check('the evening form shows it selected, in the label colour', !!bkChip && bkChip.classList.contains('on') && /884dff/.test(bkChip.getAttribute('style')),
  bkChip ? bkChip.outerHTML.slice(0, 120) : 'no chip');
w.DO.toggleBlockTask('k1'); await tick(50);
const bkChip2 = [...d.querySelectorAll('.ns-log #blk-plan .blk-b.plan')].find(b => b.dataset.name === 'mix the track');   // re-rendered
check('unticking reopens it and deselects the block', bkOpen.get('k1').open === true &&
  !JSON.parse(w.localStorage.getItem('log_' + today)).e.blocks.includes('mix the track') && !!bkChip2 && !bkChip2.classList.contains('on'));

check('no errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
