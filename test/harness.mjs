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
/* Since 2.22 nothing in ROOT may reach a system dialog: confirm and prompt are
   the app's own overlay. These count anything that slips through, and the very
   last check in this file fails if the count is not zero. */
let systemDialogs = 0;

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
    w.confirm = () => { systemDialogs++; return true; };
    w.prompt  = () => { systemDialogs++; return ''; };
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

/* ── Answering the app's own confirm ──────────────────────────────────────────
   Shell.confirm opens #ask and waits for a tap, so an action that asks does not
   finish on the call any more. settle() answers whatever question is up the way
   confirmAnswer says and counts it; with no question up it does nothing at all,
   which is what makes it safe to put after any action that *might* ask. */
const askOpen = () => { const el = $('#ask'); return !!el && !el.classList.contains('hidden'); };
function settle(answer = confirmAnswer) {
  if (!askOpen()) return false;
  confirmCalls++;
  click($(answer ? '#ask-yes' : '#ask-no'));
  return true;
}
// the same, for an async action: the question is up by the time it yields
const settled = async fn => { const p = fn(); settle(); return p; };
const key = (k, target = d) => target.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

// ── 1. boot ──────────────────────────────────────────────────────────────────
check('modules defined', ['Prefs','Config','Creds','Shell','DO','LOG','PLAN','STORE','SET'].every(k => w[k]));
check('no console/jsdom errors at boot', errors.length === 0, errors.slice(0, 3).join(' | '));
for (const t of w.Prefs.THEMES) { w.Prefs.set('theme', t.id); }
check('all themes apply', d.documentElement.dataset.theme === 'noir');
w.Prefs.set('theme', 'void');
for (const p of ['look','layout','behave','do','log','plan','store','tend','track','learn','create','data']) w.SET.panel(p);
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
w.STORE.confirmClearList(); settle();
check('STORE clear list skips confirm() when the pref is off', confirmCalls === 0 &&
  JSON.parse(w.localStorage.getItem('store_state_v1')).list.length === 0, 'confirm calls ' + confirmCalls);
w.Prefs.set('confirmDestructive', true);
confirmCalls = 0; confirmAnswer = false;
w.Shell.go('do');
const firstRoutine = Object.keys(w.Config.get('do.routines'))[0];
w.DO.openRoutine(firstRoutine);
const ticks = () => d.querySelectorAll('.ns-do .item-btn.checked').length;
click($('.ns-do .item-btn'));                             // something to lose
check('a routine item ticks', ticks() === 1, ticks() + ' ticked');
w.DO.resetDay();
check('DO resetDay asks in the app, not through the browser', askOpen() && systemDialogs === 0);
check('… the question names itself and offers a way out',
  /reset all items/i.test($('#ask-title').textContent) && !!$('#ask-no.modal-cancel'),
  $('#ask-title').textContent);
settle();                                                 // answers "cancel"
check('… and cancelling does nothing at all', confirmCalls === 1 && !askOpen() && ticks() === 1,
  'ticks left: ' + ticks());
confirmAnswer = true;
w.DO.openRoutine(firstRoutine);
w.DO.resetDay(); settle();
w.DO.openRoutine(firstRoutine);
check('… while confirming clears the day', ticks() === 0, ticks() + ' ticked');

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
  $('.ns-plan #task-name').value = name; w.PLAN.addToQueue(); settle();
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
check('ten tabs, settings last', w.Shell.TABS.length === 10 && w.Shell.TABS[9] === 'settings', w.Shell.TABS.join(','));
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
check('reset restores all ten in shipped order', w.Shell.TABS.join(',') === 'do,log,plan,store,tend,track,learn,cal,create,settings', w.Shell.TABS.join(','));
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
    // due today and carrying a block label: the blocks section's, not the list's
    { id: 't5', content: 'mix the track',  labels: ['b1', 'curate'], priority: 2, due: { date: today } },
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
/* 2.23: a task due today carrying @b1 answers both fetches, and used to be
   drawn in both places — two rows for one task, counted twice in the badge, and
   tickable in one while the other still showed it open. The blocks section is
   the more specific of the two and keeps it. */
const named = () => [...d.querySelectorAll('.ns-do #td-today .tt-name')].map(x => x.textContent);
check('a block-labelled task is the blocks section\'s, and not also a today row',
  !named().includes('mix the track') && ttRows.length === 2, named().join(' | '));
w.DO.toggleBlocks();
check('… and switching the blocks section off hands it straight back to the list',
  named().includes('mix the track'), named().join(' | '));
w.DO.toggleBlocks();
check('… and back again', !named().includes('mix the track'), named().join(' | '));
// it has answered its question; the rest of this file was written against a
// world without it, and a block task left open would sit in the tab's count
tdClosed.add('t5');
await w.DO.refreshToday(true); await tick(120);
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
$('.ns-plan #task-name').value = 'read NF C 15-100'; w.PLAN.addToQueue(); settle();
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('evening');
// the earlier partial-send test left "a" and "c" sent today and "b" queued, so
// all four are planned; find ours by name
const planChip = [...d.querySelectorAll('.ns-log #blk-plan .blk-b.plan')].find(b => b.dataset.name === 'read NF C 15-100');
check('a queued PLAN task is offered under the blocks', !!planChip && !$('.ns-log #blk-plan-wrap').classList.contains('hidden'),
  [...d.querySelectorAll('.ns-log #blk-plan .blk-b.plan')].map(b => b.dataset.name).join(','));
click(planChip);
w.LOG.saveEvening();
check('ticking it records the task as a block', JSON.parse(w.localStorage.getItem('log_' + today)).e.blocks.includes('read NF C 15-100'));
w.PLAN.clearQueue(); settle();

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

/* 2.23 — how far back "show done" reaches is a setting. DO's own cache is one
   day deep and always was; the earlier days come from LOG, which is where the
   tick already files the name. */
const pastDay = offset(-3);
w.localStorage.setItem('log_' + pastDay, JSON.stringify({ date: pastDay, m: {}, e: { blocks: ['an older block'] }, entries: [] }));
check('the window starts at "day", which is exactly what it did before',
  w.DO.blocksDoneWin() === 'day' && !$('.ns-do #td-blocks .bk-past'), w.DO.blocksDoneWin());
w.DO.cycleBlocksDone();
check('… "week" reaches back and names the day each one was finished on',
  w.DO.blocksDoneWin() === 'week' && !!$('.ns-do #td-blocks .bk-past') &&
  /an older block/.test($('.ns-do #td-blocks .bk-past').textContent),
  w.DO.blocksDoneWin() + ' / ' + ($('.ns-do #td-blocks .bk-past')?.textContent.replace(/\s+/g, ' ').trim() || 'nothing'));
check('… and they are names, not tiles: there is nothing there to try to untick',
  !d.querySelector('.ns-do #td-blocks .bk-past button') &&
  !!$('.ns-do #td-blocks .bk-past-date') && !!$('.ns-do #td-blocks .bk-past-names'));
w.DO.toggleBlocksHideDone();
check('… "hide done" hides the earlier days too — they are all done',
  !$('.ns-do #td-blocks .bk-past'));
w.DO.toggleBlocksHideDone();
w.DO.cycleBlocksDone();
check('… "month" reaches further still, and the cycle comes back round to "day"',
  w.DO.blocksDoneWin() === 'month' && !!$('.ns-do #td-blocks .bk-past') &&
  (w.DO.cycleBlocksDone(), w.DO.blocksDoneWin() === 'day'), w.DO.blocksDoneWin());
check('… the setting is on DO\'s own panel, and survives a reload',
  !!$('#td-blocks-done') && JSON.parse(w.localStorage.getItem('do_todoist_v1')).blocksDone === 'day');
w.localStorage.removeItem('log_' + pastDay);
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
const blonde = [...mdBox.querySelectorAll('.md-row')].find(b => /Blonde/.test(b.textContent));
check('a @music task shows its kind and its second label on the row', !!blonde &&
  [...blonde.querySelectorAll('.md-meta i')].map(i => i.textContent).join(' ') === '@music album' &&
  !!blonde.querySelector('.md-check svg') && !!blonde.querySelector('.md-rail'),
  blonde && [...blonde.querySelectorAll('.md-meta i')].map(i => i.textContent).join(' '));
check('the title is the row, not a tile: it gets the full width', !!blonde && blonde.classList.contains('md-row') &&
  !mdBox.querySelector('.bk-grid'));
check('the today list and the block tiles stay off the media tab', $('.ns-do #td-today').classList.contains('hidden') && $('.ns-do #td-blocks').classList.contains('hidden'));

/* ── 2.24: the media tab reworked ── */
const mdChips = () => [...mdBox.querySelectorAll('.md-chip')].map(c => c.textContent);
check('a chip per label that has something on it, plus "all", each with its open count',
  mdChips()[0] === 'all3' && mdChips().slice(1).join(',') === '@movie1,@show1,@music1', mdChips().join(','));
w.DO.setMediaKind('music');
check('tapping a chip narrows the list to that label',
  [...mdBox.querySelectorAll('.md-row')].length === 1 &&
  [...mdBox.querySelectorAll('.md-row')].every(r => /@music/.test(r.textContent)) &&
  mdBox.querySelector('.md-chip.on').textContent === '@music1',
  [...mdBox.querySelectorAll('.md-row')].map(r => r.textContent.trim()).join(' | '));
check('… and the narrowing is stored, not just drawn', JSON.parse(w.localStorage.getItem('do_todoist_v1')).mediaKind === 'music');
w.DO.setMediaKind('music');
check('tapping the live chip again clears it', !mdBox.querySelector('.md-chip.on').textContent.startsWith('@') &&
  [...mdBox.querySelectorAll('.md-row')].length === 3);
w.DO.cycleMediaSort();
check('sort cycles kind → a → z, and ungroups when it is no longer by kind',
  mdBox.querySelector('.md-sort').textContent === 'a → z' && !mdBox.querySelector('.md-group') &&
  [...mdBox.querySelectorAll('.md-name')].map(n => n.textContent).join('|') ===
  [...mdBox.querySelectorAll('.md-name')].map(n => n.textContent).sort((a, b) => a.localeCompare(b)).join('|'),
  mdBox.querySelector('.md-sort').textContent + ' :: ' + [...mdBox.querySelectorAll('.md-name')].map(n => n.textContent).join('|'));
w.DO.cycleMediaSort();
check('… then by priority, urgent first', mdBox.querySelector('.md-sort').textContent === 'by priority');
w.DO.cycleMediaSort();
check('… and back to by kind, grouped again', mdBox.querySelector('.md-sort').textContent === 'by kind' && !!mdBox.querySelector('.md-group'));
w.DO.setMediaQuery('blon');
check('the find box matches on the title, ignoring case',
  [...mdBox.querySelectorAll('.md-row')].length === 1 && /Blonde/.test(mdBox.querySelector('.md-row').textContent));
check('… and a query that matches nothing says so rather than going blank',
  (w.DO.setMediaQuery('zzzz'), /nothing matching/.test(mdBox.querySelector('.tt-empty')?.textContent || '')),
  mdBox.querySelector('.tt-empty')?.textContent);
w.DO.setMediaQuery('');
check('surprise me picks one open title and lights its row',
  (w.DO.mediaPick(), mdBox.querySelectorAll('.md-row.picked').length === 1));
w.DO.toggleMediaTask('m2'); await tick(50);
check('ticking closes it in Todoist and strikes the row through',
  mdOpen.get('m2').open === false && !![...mdBox.querySelectorAll('.md-row.done')].find(b => /Blonde/.test(b.textContent)));
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
check('apps switched off are listed on the settings home', [...d.querySelectorAll('.ns-set [data-open]')].map(b => b.dataset.open).join(',') === 'plan,store,tend,track,learn,cal,create',
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
  [...d.querySelectorAll('.ns-set #set-seg .seg-b')].map(b => b.dataset.seg).join(',') === 'do,log,plan,store,tend,track,learn,cal,create' &&
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
/* The button used to be gated on the hour, because it moved *everything* open
   and that only made sense late in the evening. It has picked its tasks since
   2.19, so it is offered whenever there is something open — the check was left
   behind by that change and passed only because it is false before 20:00. */
check('the "→ tomorrow" button is offered whenever something is open, at any hour',
  !!$('.ns-do .tt-acts') && /tomorrow/.test($('.ns-do #td-today .tt-acts').textContent),
  $('.ns-do #td-today .tt-acts')?.textContent);
await settled(() => w.DO.deferToday());
check('"→ tomorrow" reschedules every open task to tomorrow in Todoist', tmMoved.d1 === 'tomorrow' && tmMoved.d2 === 'tomorrow', JSON.stringify(tmMoved));
check('… and they drop off the list', openRows().length === 0 && tdState().today.tasks.length === 0, openRows().length + ' rows');

// ── 24. 2.10 — the title band, blocks → tomorrow, PLAN in label colours ────
check('each slide is a band plus a scroll body', ['do','log','plan','store','tend','track','learn','cal','create','settings'].every(a => {
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
const appSheets = ['do','log','plan','store','tend','track','learn','cal','create','settings']
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
check('the rows are the project\'s sections, in its colour',
  secs.map(s => s.querySelector('.ps-name').textContent).join(',') === 'mixing,production,socials' &&
  secs[0].style.getPropertyValue('--proj-color') === '#884dff' && !!secs[0].querySelector('.ps-rail'),
  secs.map(s => s.textContent.replace(/\s+/g, ' ').trim()).join(','));

/* ── 2.24: the section rows, and getting out of an open project ── */
check('the colour is a rail down the row, not a wash over it — three rows stopped reading as three slabs',
  /\.ns-plan \.ps-rail\{flex:0 0 3px/.test(planCss) &&
  /\.ns-plan \.proj-sec\{[^}]*background:var\(--s1\)/.test(planCss));
check('the other projects stay on screen as chips, so switching is one tap and not three',
  [...d.querySelectorAll('.ns-plan .proj-jump')].map(b => b.textContent.replace(/\s+/g, '')).join(',')
    === w.Config.get('plan.types').filter(t => t.key !== 'curate').map(t => t.label).join(','),
  [...d.querySelectorAll('.ns-plan .proj-jump')].map(b => b.textContent.replace(/\s+/g, '')).join(','));
check('… and they are chips, not tiles: exactly one full project box stays open',
  projTiles().length === 1 && !d.querySelector('.ns-plan .proj-jump.proj-tile'));
check('… each with its own flip key, so they arrive with the reveal',
  [...d.querySelectorAll('.ns-plan .proj-jump')].every(b => /^j:/.test(b.dataset.flip)) &&
  $('.ns-plan .proj-jumps').dataset.flip === 'jumps');
w.PLAN.openProj('alive');
check('tapping one opens that project without closing back to the grid first',
  /alive/.test($('.ns-plan .proj-tile.open').textContent) && projTiles().length === 1 &&
  [...d.querySelectorAll('.ns-plan .proj-jump')].some(b => /curate/.test(b.textContent)),
  $('.ns-plan .proj-tile.open')?.textContent.replace(/\s+/g, ' ').trim());
w.PLAN.openProj('curate');
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
w.PLAN.addToQueue(); settle();
const qAfter = JSON.parse(w.localStorage.getItem('plan_queue') || '[]');
check('adding to the queue files it under that section and folds the grid all the way back',
  qAfter.length === qBefore + 1 && qAfter[qAfter.length - 1].name === 'master the mix' &&
  qAfter[qAfter.length - 1].subType === 'production' && !$('.ns-plan .proj-form') && !$('.ns-plan .proj-tile.open'),
  JSON.stringify(qAfter[qAfter.length - 1] || {}).slice(0, 120));
w.PLAN.clearQueue(); settle();

// the send button, and the block row with no "none" chip
check('the send button is absent while the queue is empty, not a faded one',
  $('.ns-plan #send-wrap').classList.contains('hidden') && !$('.ns-plan #btn-send').disabled);
w.PLAN.pickSub('curate', 0);
$('.ns-plan #task-name').value = 'a task';
$('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
w.PLAN.addToQueue(); settle();
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
w.PLAN.closeForm(); w.PLAN.clearQueue(); settle();

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
  /* Since 2.22.2 the tile is not painted *at all* while its name travels: the
     box comes in with the rest of the screen once the move is over, held back
     by fill:backwards on a delayed animation rather than crossfaded under it. */
  const fade = tileAnims.find(a => /borderColor/.test(a.css));
  check('… the tile is unpainted for the whole move and painted in after it',
    !!fade && fade.opts.delay > 0 && fade.opts.fill === 'backwards' &&
    /"borderColor":"transparent"/.test(fade.css),
    fade ? JSON.stringify(fade.opts) : 'no fade');
  check('… and the name is the only thing moving while it does',
    anims.filter(a => /transform.*(translate|scale)/.test(a.css) && a.opts.delay === undefined)
      .every(a => ['pn:curate', 'pd:curate', 'queue'].includes(a.key)),
    anims.filter(a => a.opts.delay === undefined).map(a => a.key).join(','));

  const rows = ['sec:0', 'sec:1', 'sec:2'].map(of);
  check('the section rows are held back for the move, then revealed',
    rows.every(r => r && /translateY\(-6px\)/.test(r.css) && /"opacity":0/.test(r.css) &&
                    r.opts.fill === 'backwards' && r.opts.delay >= fade.opts.delay) &&
    !rows.some(r => /scale\(/.test(r.css)),
    rows.map(r => r ? r.css.slice(0, 50) + ' @' + r.opts.delay : 'missing').join(' | '));
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
w.PLAN.clearSent(); settle();
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
  w.PLAN.addToQueue(); settle();
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
w.PLAN.clearSent(); settle();
check('clear empties the list, the key and the selection',
  !sentRows().length && JSON.parse(w.localStorage.getItem('plan_history_v1')).length === 0 &&
  expBtn().classList.contains('hidden'));
check("clearing the history leaves today's own sent record alone — LOG reads that one",
  JSON.parse(w.localStorage.getItem('plan_sent_v1')).tasks.length === sentBase + 7,
  JSON.parse(w.localStorage.getItem('plan_sent_v1')).tasks.length + ' vs ' + (sentBase + 7));
w.PLAN.clearQueue(); settle();

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
w.PLAN.addToQueue(); settle();
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
w.PLAN.addToQueue(); settle();
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
w.PLAN.clearSent(); settle(); w.PLAN.clearQueue(); settle();

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
w.PLAN.clearQueue(); settle();
for (const nm of ['mix the intro', 'bounce the stems']) {
  w.PLAN.openProj('curate'); w.PLAN.pickSub('curate', 0);
  $('.ns-plan #task-name').value = nm;
  $('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
  w.PLAN.addToQueue(); settle();
}
/* Naming a preset is the app's own dialog with a field in it, not window.prompt */
w.PLAN.savePreset();
check('naming a preset asks in the app, with a field', askOpen() && !$('#ask-field').classList.contains('hidden'));
$('#ask-input').value = 'studio monday';
click($('#ask-yes'));
const saved = w.Config.get('plan.presets');
check('a queue saves as a preset — its tasks, never its day',
  saved.length === 1 && saved[0].label === 'studio monday' && saved[0].tasks.length === 2 &&
  saved[0].tasks.every(t => t.date === undefined), JSON.stringify(saved[0] && saved[0].tasks.map(t => t.name)));
check('… and it shows on the queue row as a chip naming the count',
  /studio monday/.test($('.ns-plan #queue-presets').textContent) &&
  /2/.test($('.ns-plan #queue-presets .pre-b em').textContent));
w.PLAN.clearQueue(); settle();
w.PLAN.applyPreset(saved[0].key);
const requeued = JSON.parse(w.localStorage.getItem('plan_queue'));
check('one tap refills the queue, dated from today rather than from the day it was saved',
  requeued.length === 2 && requeued[0].name === 'mix the intro' && requeued.every(t => t.date === today),
  JSON.stringify(requeued.map(t => [t.name, t.date])));
w.SET.panel('plan');
check('a preset is editable content like everything else',
  !!$('.ns-set [data-group="plan.presets"] input[data-field="label"]'));
w.Shell.go('plan');
w.PLAN.deletePreset(saved[0].key); settle();
check('deleting one takes its chip with it',
  (w.Config.get('plan.presets') || []).length === 0 && $('.ns-plan #queue-presets').classList.contains('hidden'));
w.PLAN.clearQueue(); settle();

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
/* Arriving on PLAN dismisses that flag for the day (2.22.1), and earlier
   sections have been on PLAN a great deal — so clear the record before asking
   whether the rule flags the right tab. */
w.localStorage.removeItem('log-alert-seen-v1');
w.LOG.refreshAlert();
check('… and with both halves written it is tomorrow that is unplanned — flagged on PLAN, not LOG',
  w.LOG.alertReason() === 'plan' && planIcon() === '#tab-alert' &&
  planBtn().classList.contains('has-alert') && logIcon() === '#tab-log' &&
  !logBtn().classList.contains('has-alert'),
  w.LOG.alertReason() + ' log=' + logIcon() + ' plan=' + planIcon());
/* …and opening PLAN answers it. "Nothing planned for tomorrow" is a prompt you
   can answer by looking, unlike the two LOG rules, which clear by being done. */
w.Shell.go('plan');
check('opening PLAN clears the flag it was wearing',
  planIcon() === '#tab-plan' && !planBtn().classList.contains('has-alert') &&
  w.LOG.alertReason() === 'plan' && !w.LOG.alertShown().includes('plan'),
  planIcon() + ' / still true: ' + w.LOG.alertReason());
check('… the rule itself is untouched — it is the prompt that was answered, not the day',
  w.LOG.alertReasons ? true : w.LOG.alertReason() === 'plan');
w.localStorage.removeItem('log-alert-seen-v1');
w.LOG.refreshAlert();
check('… and it is back tomorrow, because the dismissal is filed under the day',
  planIcon() === '#tab-alert', planIcon());
w.Shell.go('plan');
w.PLAN.openProj('home'); w.PLAN.pickSub('home', 0);
$('.ns-plan #task-name').value = 'clear the desk';
$('.ns-plan #task-name').dispatchEvent(new w.Event('input', { bubbles: true }));
w.PLAN.optPick($('.ns-plan #opts-block .opt-b'), 'block', 'b1');
w.PLAN.stepDate(1);
w.PLAN.addToQueue(); settle();
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
w.PLAN.clearQueue(); settle();

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
w.CAL.clearAll(); settle();
check('clearing empties the key and puts the empty state back',
  !w.CAL.days().length && !!$('.ns-cal .cal-empty') && /nothing planned/.test($('.ns-cal .cal-empty').textContent),
  $('.ns-cal #cal-body').textContent.trim().slice(0, 60));

/* Two tasks, two projects, exported for tomorrow. */
w.Shell.go('plan');
confirmAnswer = true;
w.PLAN.clearSent(); settle();
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
await settled(() => w.DO.deferToday());
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
const medBtns = () => d.querySelectorAll('.ns-log #med-g .med-b').length;
/* Since 2.22 the third slot ships *off*: it exists, the record and the .md
   still carry it, and the form simply does not ask until you say so. */
check('the third slot is opt-in — configured, and not on the form until asked',
  medBtns() === 2 && !$('.ns-log #med-m3') &&
  w.Config.defaults('log.medsOn').m3 === false, medBtns() + ' buttons');
w.Config.set('log.medsOn', Object.assign({}, w.Config.defaults('log.medsOn'), { m3: true }));
check('… switching it on draws one button per slot rather than two by name',
  medBtns() === 3 && !!$('.ns-log #med-m3'), medBtns() + ' buttons');
check('… each in its own colour, from Config rather than from a selector per key',
  $('.ns-log #med-m3').style.getPropertyValue('--med-c') === w.Config.get('log.medColors').m3,
  $('.ns-log #med-m3').getAttribute('style'));
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

/* ── 2.23: discard has to undo ─────────────────────────────────────────────────
   The forms write straight into the live record as they are tapped — the
   scales, the meds, the counters, the blocks — and `save()` only flushes it.
   So "go back without saving" left the edits in memory and the *next* write
   from anywhere committed them: an entry, a block ticked on DO, the other half
   of the day. The form was discarded; the data was not. */
w.LOG.resetDate();
$('.ns-log #e-kme').value = '3'; w.LOG.saveEvening();
const eveRec = () => JSON.parse(w.localStorage.getItem('log_' + today)).e;
const medWas = eveRec().meds_lam;
w.LOG.go('evening');
w.LOG.toggleMed('lam');                        // straight into the live record
w.LOG.incCaf('c');
confirmAnswer = true;
w.LOG.goBack(); settle();
check('going back without saving leaves the record exactly as it was',
  eveRec().meds_lam === medWas && !eveRec().caf_c,
  'lam ' + eveRec().meds_lam + ' / caf ' + eveRec().caf_c);
w.LOG.addEntry && (($('.ns-log #et') || {}).value = 'a note');
w.LOG.addEntry();
check('… and a later write from somewhere else cannot resurrect them',
  eveRec().meds_lam === medWas && !eveRec().caf_c,
  'lam ' + eveRec().meds_lam + ' / caf ' + eveRec().caf_c);
w.LOG.go('evening');
w.LOG.toggleMed('lam');
confirmAnswer = false;
w.LOG.goBack(); settle();
check('… while cancelling the question keeps you on the form with the edit intact',
  !!$('.ns-log #s-evening.on'), $('.ns-log .scr.on')?.id);
confirmAnswer = true;
w.LOG.goBack(); settle();

/* A half of the day is written when someone wrote it. `setBlock` files a block
   ticked on DO straight into the real today's record without the evening form
   being opened, and `blocks` used to count as evidence — so one tick on DO
   turned the evening card green, cleared LOG's "!" and extended the streak. */
const blank = { date: offset(-9), m: {}, e: { blocks: ['a block DO ticked'] }, entries: [] };
w.localStorage.setItem('log_' + blank.date, JSON.stringify(blank));
w.LOG.pickDate(blank.date);
check('an evening whose only content is blocks DO ticked is not a written evening',
  !$('.ns-log #card-e').classList.contains('done'),
  $('.ns-log #card-e').className);
$('.ns-log #e-kme').value = '';
w.LOG.go('evening'); w.LOG.saveEvening();
check('… and saving the form is what marks it, with a stamp rather than a guess',
  $('.ns-log #card-e').classList.contains('done') &&
  typeof JSON.parse(w.localStorage.getItem('log_' + blank.date)).e.saved === 'number',
  JSON.stringify(JSON.parse(w.localStorage.getItem('log_' + blank.date)).e.saved));
check('… the blocks themselves are untouched by any of it',
  JSON.parse(w.localStorage.getItem('log_' + blank.date)).e.blocks.join() === 'a block DO ticked');
w.localStorage.removeItem('log_' + blank.date);
w.LOG.resetDate(); w.LOG.go('home');

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


// ── 33. 2.22 — the app asks its own questions, and answers its own numbers ───
const shellCss3 = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
const shellJs3  = fs.readFileSync(path.join(ROOT, 'js/shell.js'), 'utf8');
const logCss2  = fs.readFileSync(path.join(ROOT, 'css/log.css'), 'utf8');
const storeCss2 = fs.readFileSync(path.join(ROOT, 'css/store.css'), 'utf8');
const calCss3  = fs.readFileSync(path.join(ROOT, 'css/cal.css'), 'utf8');
const planJs2  = fs.readFileSync(path.join(ROOT, 'js/plan.js'), 'utf8');

/* Nothing may reach a system dialog. This is the check the whole of 2.22's
   confirm work exists for, and it counts the ones every section above would
   have triggered. */
check('not one system dialog was raised by anything above', systemDialogs === 0,
  systemDialogs + ' raised');
check('… and no module calls confirm() or prompt() directly any more',
  ['do','log','plan','store','tend','track','learn','cal','settings','search']
    .every(m => !/(^|[^.\w])(confirm|prompt)\s*\(/.test(
      fs.readFileSync(path.join(ROOT, 'js/' + m + '.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))),
  ['do','log','plan','store','tend','track','learn','cal','settings','search']
    .filter(m => /(^|[^.\w])(confirm|prompt)\s*\(/.test(
      fs.readFileSync(path.join(ROOT, 'js/' + m + '.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))).join(','));
/* The dialog is a .modal-overlay with a .modal-cancel in it, which is what
   earns it Escape and the shell's keyboard suppression without new wiring. */
w.Shell.confirm('Throw it away? It cannot be undone.', () => {});
check('the dialog splits one message into a question and its detail',
  $('#ask-title').textContent === 'Throw it away?' &&
  /cannot be undone/.test($('#ask-body').textContent),
  $('#ask-title').textContent + ' | ' + $('#ask-body').textContent);
check('… and Escape closes it, because it is an overlay the shell already knows',
  askOpen() && (key('Escape'), !askOpen()));
let asked = 'nothing';
w.Shell.confirm('Sure?', () => { asked = 'ran'; });
click($('#ask-no'));
check('cancelling never runs the action', asked === 'nothing');
click($('#ask-yes'));
check('… and a cancelled question cannot be answered afterwards', asked === 'nothing');
w.Shell.confirm('Sure?', () => { asked = 'ran'; });
click($('#ask-yes'));
check('confirming runs it exactly once', asked === 'ran' && !askOpen());
w.Prefs.set('confirmDestructive', false);
asked = 'nothing';
w.Shell.confirm('Sure?', () => { asked = 'ran'; });
check('with "confirm before clearing" off it runs at once and asks nothing',
  asked === 'ran' && !askOpen());
w.Prefs.set('confirmDestructive', true);

/* The numpad: which fields it claims, and what a digit means in each. */
const kind = sel => w.Shell.numpad.kindOf($(sel));
check('the pad claims a decimal field, an integer field and nothing else',
  kind('.ns-log #m-km') === 'decimal' && kind('.ns-log #m-tkg') === 'int' &&
  kind('.ns-log #m-wt') === null && kind('.ns-store #manual-input') === null,
  [kind('.ns-log #m-km'), kind('.ns-log #m-tkg'), kind('.ns-log #m-wt'), kind('.ns-store #manual-input')].join(','));
check('… and reads data-pad for the two shapes it cannot infer',
  kind('.ns-log #m-sl') === 'duration' && kind('.ns-set #al-morning') === 'clock',
  kind('.ns-log #m-sl') + ',' + kind('.ns-set #al-morning'));
check('… a fractional step means decimal, not integer',
  kind('.ns-set [data-cfg="tend.round"][data-sub="soonAt"]') === 'decimal',
  String(kind('.ns-set [data-cfg="tend.round"][data-sub="soonAt"]')));
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('morning');
const sleep = $('.ns-log #m-sl');
w.Shell.numpad.open(sleep, 'duration');
'720'.split('').forEach(c => w.Shell.numpad.key(c));
check('720 in the sleep field is seven hours twenty, stored as 7.33',
  sleep.value === '7.33' && /7h20m/.test($('#npad-val').textContent),
  sleep.value + ' · ' + $('#npad-val').textContent);
check('… and it says what it is about to store', /7\.33/.test($('#npad-note').textContent),
  $('#npad-note').textContent);
w.Shell.numpad.key('back'); w.Shell.numpad.key('back');
check('backspace walks it back to seven hours flat', sleep.value === '7',
  sleep.value + ' · ' + $('#npad-val').textContent);
w.Shell.numpad.key('clear');
check('clear empties the field rather than leaving the old number in it', sleep.value === '');
w.Shell.numpad.close();
const alarm = $('.ns-set #al-morning');
w.Shell.numpad.open(alarm, 'clock');
'930'.split('').forEach(c => w.Shell.numpad.key(c));
check('930 in an alert hour is 09:30', alarm.value === '09:30', alarm.value);
w.Shell.numpad.key('9');
check('… and 9309 is refused rather than written as a time that is not one',
  alarm.value === '09:30' && $('#npad-val').classList.contains('bad'),
  alarm.value + ' · ' + $('#npad-note').textContent);
w.Shell.numpad.close();
const km = $('.ns-log #m-km');
w.Shell.numpad.open(km, 'decimal');
['3', '.', '5'].forEach(c => w.Shell.numpad.key(c));
check('a decimal field takes a decimal point; an integer field is not offered one',
  km.value === '3.5', km.value);
w.Shell.numpad.close();
w.Shell.numpad.open($('.ns-log #m-tkg'), 'int');
w.Shell.numpad.key('.');
check('… the dot key is disabled on an integer field',
  $('#npad [data-npad="."]').disabled && $('.ns-log #m-tkg').value === '');
w.Shell.numpad.close();
check('the pad is a sheet, so it steps the shell\'s shortcuts aside like every other one',
  /\.npad\{[\s\S]*?position:fixed/.test(shellCss3) && !!$('#npad-back.sheet-back'));

/* ── 2.23: the unit the number is in ─────────────────────────────────────────
   A pad-owned field is never focused, so while you answer it the only things on
   screen are the pad's own label and a number — and the label the pad covers is
   often the only place the unit was written down. */
const padUnit = () => $('#npad-val .npad-unit')?.textContent || '';
w.Shell.numpad.open($('.ns-log #m-wkg'), 'decimal');
'645'.split('').forEach(c => w.Shell.numpad.key(c));
check('the pad says what the number is in, declared per field with data-unit',
  padUnit() === 'kg' && $('#npad-val').textContent === '645kg',
  $('#npad-val').textContent);
w.Shell.numpad.key('clear');
check('… and an empty field shows no unit — there is nothing for it to be the unit of',
  padUnit() === '' || $('#npad-val').classList.contains('empty'),
  $('#npad-val').textContent + ' / ' + $('#npad-val').className);
w.Shell.numpad.close();
w.Shell.numpad.open($('.ns-log #m-cs'), 'int');
w.Shell.numpad.key('4'); w.Shell.numpad.key('5');
check('… seconds on the cold shower, the field whose unit lives nowhere else',
  padUnit() === 's' && $('.ns-log #m-cs').value === '45', $('#npad-val').textContent);
w.Shell.numpad.close();
w.Shell.numpad.open($('.ns-log #m-sl'), 'duration');
w.Shell.numpad.key('7');
check('… and a duration is left alone: 7h20m is already a unit, and two would be one too many',
  padUnit() === '' && /7h00m/.test($('#npad-val').textContent), $('#npad-val').textContent);
w.Shell.numpad.close();
check('nothing is inferred — a unit guessed from a label is a unit that is wrong somewhere',
  /padUnitOf = el => String\(\(el && el\.dataset && el\.dataset\.unit\)/.test(shellJs3),
  'padUnitOf');

/* ── An overlay owns the page until it closes ────────────────────────────────
   The three reports that turned out to be one rule: the pad's closing tap also
   pressed what was under it, the pad was drawn over a live system keyboard
   against a viewport iOS had already shrunk, and the platform's own selection
   callout had nothing that would dismiss it. */
check('opening the pad blurs whatever is focused first, so nothing is moving when it is drawn',
  /function padOpen[\s\S]{0,400}?const active = document\.activeElement;[\s\S]{0,200}?active\.blur/.test(shellJs3));
check('… a tap that closes the pad is stopped there, and the click it would make is swallowed',
  /if \(padIsOpen\(\) && !inPad\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);/.test(shellJs3) &&
  /padSwallowUntil = Date\.now\(\) \+ 700/.test(shellJs3));
check('… a tap outside the focused field ends it, on every screen rather than per app',
  /const FOCUSABLE_TEXT = 'input,textarea,select/.test(shellJs3) &&
  /active\.matches\(FOCUSABLE_TEXT\)[\s\S]{0,200}?blurField\(active\)/.test(shellJs3));
/* 2.22.3 took the press *wash* off anything scrolled under a finger. This is
   the other half: the press itself. */
check('a gesture that travelled is not a press, and its click never reaches the page',
  /const TAP_SLOP = 12/.test(shellJs3) &&
  /addEventListener\('touchmove', gestureMoved/.test(shellJs3) &&
  /const fromDrag = gDown && gMoved/.test(shellJs3));
/* A click with no pointer behind it is the keyboard's, and must not inherit the
   last finger's verdict — so a key press ends the gesture, and each swallow is
   consumed here whether or not it fires. */
check('… while a keyboard click carries no gesture and is never swallowed',
  /addEventListener\('keydown', \(\) => \{ gDown = false; \}, true\)/.test(shellJs3) &&
  /padSwallowUntil = 0; gDown = false;/.test(shellJs3));
check('… and the pad\'s own keys are exempt, because they fire on pointerdown',
  /const fromDrag = gDown && gMoved && !inPad;/.test(shellJs3));

/* LOG's home: a month, a fortnight, and no scrolling. Two known days first —
   one written in full, one not written at all — so the cells and the lines have
   something to be about. */
w.localStorage.setItem('log_' + offset(-1),
  day({ wt:'07:00', nrg:4, mood:4 }, { kme:'2', nrg:3, mood:5, stress:2 }));
w.localStorage.setItem('log_' + offset(-2),
  day({ wt:'07:30', nrg:2, mood:3 }, { kme:'1', nrg:2, mood:2, stress:4 }));
w.localStorage.removeItem('log_' + offset(-3));
w.Shell.go('log'); w.LOG.go('home'); w.LOG.resetDate();
check('LOG\'s home draws the month it is on', !!$('.ns-log #log-cal .lc-grid') &&
  d.querySelectorAll('.ns-log .lc-grid .lc-c:not(.pad)').length >= 28,
  d.querySelectorAll('.ns-log .lc-grid .lc-c:not(.pad)').length + ' days');
check('… with today marked and the selected day the same day', !!$('.ns-log .lc-c.today.sel'),
  $('.ns-log .lc-c.sel')?.getAttribute('aria-label'));
check('… a day that has both halves written drawn fuller than one that has neither',
  !!$(`.ns-log .lc-c[aria-label="${offset(-1)}"].f2`) &&
  !!$(`.ns-log .lc-c[aria-label="${offset(-3)}"].f0`),
  $(`.ns-log .lc-c[aria-label="${offset(-1)}"]`)?.className + ' / ' +
  $(`.ns-log .lc-c[aria-label="${offset(-3)}"]`)?.className);
check('… and tomorrow is offered as neither', (() => {
  const t = $(`.ns-log .lc-c[aria-label="${offset(1)}"]`);
  return !t || (t.disabled && t.classList.contains('future'));
})());
click($(`.ns-log .lc-c[aria-label="${offset(-1)}"]`));
check('tapping a day selects it, the way the two arrows in the band do',
  $('.ns-log #home-date').textContent === w.Prefs.formatDate(offset(-1)) &&
  $('.ns-log .lc-c.sel')?.getAttribute('aria-label') === offset(-1),
  $('.ns-log #home-date').textContent);
w.LOG.resetDate();
check('the fortnight draws its series, and nothing straight through a gap',
  !!$('.ns-log .lc-spark') && d.querySelectorAll('.ns-log .lc-l').length === 3 &&
  ![...d.querySelectorAll('.ns-log .lc-l')].some(p => /NaN|undefined/.test(p.getAttribute('d'))),
  d.querySelectorAll('.ns-log .lc-l').length + ' lines');
check('the home is a column that does not scroll, above a phone-sized screen',
  /@media \(min-height:560px\)\{[\s\S]*?\.ns-log #s-home\.on\{[^}]*overflow:hidden/.test(logCss2) &&
  /\.ns-log #s-home \.lc\{flex:1 1 auto/.test(logCss2));
check('… and the two utility cards share a row rather than taking one each',
  !/class="card full muted"/.test(html.slice(html.indexOf('ns-log'), html.indexOf('ns-plan'))));

/* DAY. */
check('DAY opens on today, planned or not', (() => {
  w.Shell.go('cal'); w.CAL.render();
  return w.CAL.selected() === today;
})(), w.CAL.selected());
/* 2.22 made the stepper a full-width bar with two half-width arrows; 2.22.1
   put it back to the size it was, square, with the radius every other box in
   the app uses rather than the nav's pill. */
/* Bounded with [^}] rather than [\s\S]: a lazy match across the whole file
   finds the next rule's declaration and asserts nothing about this one. */
check('the stepper is compact again, and its arrows are square boxes not lozenges',
  /\.cal-steps\{[^}]*border-radius:var\(--r2\)/.test(calCss3) &&
  /\.cal-steps \.cal-arrow\{flex:0 0 auto;width:38px/.test(calCss3) &&
  /\.cal-steps \.cal-arrow\{[^}]*border-radius:var\(--r2\)/.test(calCss3) &&
  !/\.cal-steps[^{]*\{[^}]*border-radius:var\(--r-pill\)/.test(calCss3));
check('… and steps aside once it has been idle, on a dial rather than a literal',
  /\.cal-steps\.idle\{[^}]*opacity:0/.test(calCss3) && w.Prefs.SCHEMA.calStepsHide.def === 5 &&
  /calStepsHide/.test(fs.readFileSync(path.join(ROOT, 'js/cal.js'), 'utf8')));
check('the empty day\'s one action is upper case — the exception DAY makes for it',
  /\.ns-cal \.ce-go\{[\s\S]*?text-transform:uppercase/.test(calCss3));

/* ── 2.23 — DAY during the day ───────────────────────────────────────────────
   A now line, rows that can be ticked off, and the day's slots fillable from
   the blocks DO is holding. All three are about using DAY at four in the
   afternoon rather than reading it at eight in the morning. */
const dayNow = new w.Date();
/* Three hours that bracket the current one, so "now" falls inside the day
   wherever in the day this suite happens to run.

   The window is slid to fit rather than wrapped. `hour - 1` modulo 24 turns
   00:xx into a day that starts at 23:00 — an hour *before* the date it is filed
   under — so "now" landed before its own day began and the line clamped to the
   top. This check failed for one hour every night, which is the worst kind of
   red: real, reproducible, and never while anyone is looking. CAL was right
   both times; the fixture was asking it where midnight falls in a day that had
   not started. */
const startH = Math.max(0, Math.min(21, dayNow.getHours() - 1));
const atH = h => String(startH + h).padStart(2, '0') + ':00';
const nowRow = dayNow.getHours() - startH;      // which of the three rows holds now
w.CAL.write({ day: today, start: atH(0), template: 'normal', mode: 'blocks', notes: [],
  events: [
    { from: atH(0), to: atH(1), dur: 60, kind: 'fixed', name: 'routine', cal: 'home' },
    { from: atH(1), to: atH(2), dur: 60, kind: 'task', name: 'a job', slot: 'b1a', color: '#fff' },
    { from: atH(2), to: atH(3), dur: 60, kind: 'idle', name: 'b1b', slot: 'b1b' },
  ] });
w.CAL.pick(today);
const nowEl = () => $('.ns-cal #cal-now');
const nowY = () => parseInt(String(nowEl()?.getAttribute('style') || '').replace(/.*--now-y:(-?\d+)px.*/, '$1'), 10);
const perHour = Math.max(20, +w.Prefs.get('calHour') || 56);
check('today carries a line at the hour the clock has reached',
  !!nowEl() && nowY() >= perHour * nowRow && nowY() <= perHour * (nowRow + 1),
  (nowEl() ? nowY() + 'px of ' + perHour + '/hour, row ' + nowRow : 'no line'));
check('… placed from the same durations the rows are drawn from, not measured off the DOM',
  /\.ns-cal \.cal-now\{[^}]*top:var\(--now-y/.test(calCss3) &&
  /\.ns-cal \.cal-now\{[^}]*pointer-events:none/.test(calCss3));
w.CAL.pick(calDay);
check('… and a day that is not today has no line on it — it is about now, not about the plan',
  !nowEl(), w.CAL.selected());
w.CAL.pick(today);

/* A tick is a mark on the drawing. CAL has no network by contract (§8), so it
   cannot and must not close anything in Todoist. */
const evAt = i => d.querySelectorAll('.ns-cal .cal-ev')[i];
check('a task row and a template row can be ticked off; an unclaimed slot cannot',
  evAt(0).tagName === 'BUTTON' && evAt(1).tagName === 'BUTTON' && evAt(2).tagName === 'DIV',
  [...d.querySelectorAll('.ns-cal .cal-ev')].map(e => e.tagName + '.' + e.className).join(' | '));
click(evAt(1)); settle();
check('… ticking one strikes it through and records it on the day',
  !!$('.ns-cal .cal-ev.task.done') && w.CAL.day(today).events[1].done === true &&
  /1 done/.test($('.ns-cal .ch-meta').textContent),
  $('.ns-cal .ch-meta').textContent);
check('… and it survives being left and come back to',
  (w.CAL.pick(calDay), w.CAL.pick(today), !!$('.ns-cal .cal-ev.task.done')));
click($('.ns-cal .cal-ev.task.done')); settle();
check('… ticking it again takes it back off', !$('.ns-cal .cal-ev.done'));

/* Filling the day's slots from DO. The slots come from the record, never from
   plan.dayTemplates — CAL does not resolve a template and is not starting now. */
check('a day with slots offers to fill them from DO', !!$('.ns-cal .ch-act'),
  $('.ns-cal .cal-head')?.textContent.replace(/\s+/g, ' ').trim());
click($('.ns-cal .ch-act')); settle();
const csRows = () => [...d.querySelectorAll('.ns-cal .cs-row')];
const slotIn = (row, slot) => csRows()[row].querySelector(`.cs-slot[data-slot="${slot}"]`);
const doBlk = w.DO.blockTasks();
check('… the panel lists the blocks DO is holding, against this day\'s own slots',
  !!$('.ns-cal .cal-sched') && csRows().length === doBlk.length && doBlk.length > 1 &&
  csRows().every(r => [...r.querySelectorAll('.cs-slot')].map(b => b.dataset.slot).join(',') === 'b1a,b1b'),
  csRows().length + ' rows for ' + doBlk.length + ' blocks');
check('… and it will not go anywhere until a slot is picked',
  $('.ns-cal .cs-go').disabled && /pick a slot/.test($('.ns-cal .cs-go').textContent));
click(slotIn(0, 'b1b')); settle();
check('… picking one names the count on the button',
  !$('.ns-cal .cs-go').disabled && /schedule 1 block/.test($('.ns-cal .cs-go').textContent) &&
  slotIn(0, 'b1b').classList.contains('on'),
  $('.ns-cal .cs-go').textContent);
/* PLAN's rule, deliberately: a slot another task holds is refused by name
   rather than taken away in silence (§8). */
click(slotIn(1, 'b1b')); settle();
check('… a slot another task already holds is refused, naming the task that holds it',
  !slotIn(1, 'b1b').classList.contains('on') && slotIn(1, 'b1b').classList.contains('taken') &&
  $('#toast').textContent === `b1b is taken — by ${doBlk[0].content}`, $('#toast').textContent);
click(slotIn(0, 'b1a')); settle();
check('… while a task moving to another slot gives its old one back — one task, one slot',
  slotIn(0, 'b1a').classList.contains('on') && !slotIn(0, 'b1b').classList.contains('on') &&
  /schedule 1 block/.test($('.ns-cal .cs-go').textContent));
click(slotIn(0, 'b1a')); settle();
check('… and tapping the slot it already holds gives that hour back',
  $('.ns-cal .cs-go').disabled);
click(slotIn(0, 'b1b')); settle();
confirmAnswer = false;
click($('.ns-cal .cs-go')); settle();
check('… and it asks before it overwrites, so cancelling changes nothing',
  w.CAL.day(today).events[2].kind === 'idle' && !w.CAL.day(today).localEdit &&
  !!$('.ns-cal .cal-sched'), w.CAL.day(today).events[2].kind);
confirmAnswer = true;
click($('.ns-cal .cs-go')); settle();
const after = () => w.CAL.day(today).events;
check('… confirming puts the block in the slot it was given',
  after()[2].kind === 'task' && after()[2].name === doBlk[0].content && after()[2].slot === 'b1b',
  after()[2].kind + ' ' + after()[2].name);
check('… every slot is rewritten, so the one left empty goes back to free',
  after()[1].kind === 'idle' && after()[1].name === 'b1a',
  after()[1].kind + ' ' + after()[1].name);
check('… the template\'s own hours are not ours to move',
  after()[0].kind === 'fixed' && after()[0].name === 'routine');
/* Everywhere else on this screen, what is drawn is what PLAN resolved and sent.
   This day no longer is, and it has to say so rather than quietly showing a
   schedule Google was never told about. */
check('… and the day says it was edited here, because it no longer matches what was sent',
  typeof after.call(null) === 'object' && !!w.CAL.day(today).localEdit &&
  [...$('.ns-cal .ch-meta').querySelectorAll('span')].some(s => s.textContent === 'edited'),
  $('.ns-cal .ch-meta').textContent);
check('… the panel closes itself, and nothing about it was persisted',
  !$('.ns-cal .cal-sched') && !('picks' in (w.CAL.day(today) || {})));
/* The line CAL is not allowed to cross, restated where the new code is. */
check('… and none of it taught CAL to talk to anything',
  !/fetch\(|XMLHttpRequest|https?:\/\//.test(fs.readFileSync(path.join(ROOT, 'js/cal.js'), 'utf8')));
w.CAL.clearDay(); settle();
w.CAL.write({ day: today, start: '08:00', template: 'normal', mode: 'blocks', notes: [],
  events: [{ from: '08:00', to: '09:00', dur: 60, kind: 'task', name: 'a job', slot: 'b1a', color: '#fff' }] });
check('a drawn day offers a way to clear itself', !!$('.ns-cal .ch-clear'));
confirmAnswer = false;
click($('.ns-cal .ch-clear')); settle();
check('… and cancelling keeps it', !!w.CAL.day(today));
confirmAnswer = true;
click($('.ns-cal .ch-clear')); settle();
check('… while confirming clears that day and no other',
  !w.CAL.day(today) && !!$('.ns-cal .cal-empty'), w.CAL.days().join(','));

/* ══ 2.24 — the day's head, deleting a row, colour, and the wake-up shift ═════ */
const calCss = fs.readFileSync(path.join(ROOT, 'css/cal.css'), 'utf8');

/* The head. Each fact is its own element with the separator drawn by CSS, so a
   line can only break *between* facts — "5 tasks" came apart across two lines
   when the whole thing was one run of text with `·` typed into it. */
w.CAL.write({ day: today, start: '07:00', template: 'normal', mode: 'blocks', notes: [],
  events: [
    { from: '07:00', to: '08:00', dur: 60, kind: 'fixed', name: 'routine', cal: 'kamo' },
    { from: '08:00', to: '09:30', dur: 90, kind: 'task', name: 'a job',   slot: 'b1a', color: '#e06f9a', project: 'life' },
    { from: '09:30', to: '10:00', dur: 30, kind: 'idle',  name: 'free',   slot: 'b1b' },
    { from: '10:00', to: '11:00', dur: 60, kind: 'task', name: 'another', slot: 'b2a', color: '#4a9', project: 'core' },
  ] });
const chSpans = () => [...d.querySelectorAll('.ns-cal .ch-meta > span')].map(s => s.textContent);
check('every fact on the head is its own element, so a line breaks between them and never inside one',
  chSpans().join('|') === 'normal|from 07:00|2 tasks|blocks only', chSpans().join('|'));
check('… each one unbreakable, with the separator drawn rather than typed',
  /\.ns-cal \.ch-meta > span\{white-space:nowrap\}/.test(calCss) &&
  /\.ns-cal \.ch-meta > span::after\{content:'·'/.test(calCss) &&
  !/·/.test(d.querySelector('.ns-cal .ch-meta').textContent));
check('… and the head stacks, so the actions never take width off the facts',
  /\.ns-cal \.cal-head\{[^}]*flex-direction:column/.test(calCss));
check('"schedule from do" is down to two characters and keeps the accent',
  $('.ns-cal .ch-act').textContent === '+ do' && /\.ns-cal \.ch-act\{color:var\(--y\)\}/.test(calCss));

/* Nothing on the day answers a finger that is scrolling. The press wash and the
   click-after-drag were already handled globally; the day's rows are as tall as
   their hours, so a scroll crosses several of them and every one was live. */
check('the day takes no pointer at all while a slide is scrolling',
  /\[data-scrolling="on"\] \.ns-cal \.cal-day,\s*\[data-scrolling="on"\] \.ns-cal \.cal-head\{pointer-events:none\}/.test(calCss));

/* Deleting a row. Two honest answers to "what happens to the hour", so it asks
   with three buttons rather than choosing one of them for you. */
const evNamesAt = () => [...d.querySelectorAll('.ns-cal .cal-ev .ev-name')].map(n => n.textContent);
const evTimesAt = () => [...d.querySelectorAll('.ns-cal .cal-ev .ev-at')].map(n => n.textContent.slice(0, 5));
check('an unclaimed slot has no delete — there is nothing in it to remove',
  [...d.querySelectorAll('.ns-cal .cal-ev')].filter(e => e.querySelector('.ev-del')).length === 3 &&
  !d.querySelectorAll('.ns-cal .cal-ev')[2].querySelector('.ev-del'));
click(d.querySelectorAll('.ns-cal .cal-ev')[1].querySelector('.ev-del'));
check('deleting asks what to do with the time, and offers both answers plus a way out',
  askOpen() && /Delete “a job”\?/.test($('#ask-title').textContent) &&
  /90 min/.test($('#ask-body').textContent) &&
  $('#ask-yes').textContent === 'close the gap' && $('#ask-alt').textContent === 'leave it free' &&
  !$('#ask-alt').hidden && $('#ask-acts').classList.contains('three'),
  $('#ask-title').textContent + ' :: ' + $('#ask-body').textContent);
check('… and the row is not also ticked on the way past', !w.CAL.day(today).events[1].done);
click($('#ask-no'));
check('cancelling leaves the day exactly as it was', evNamesAt().join('|') === 'routine|a job|free|another');
click(d.querySelectorAll('.ns-cal .cal-ev')[1].querySelector('.ev-del'));
click($('#ask-alt'));
check('"leave it free" keeps the hour and empties it, and the rest of the day does not move',
  evNamesAt().join('|') === 'routine|free|free|another' && evTimesAt().join('|') === '07:00|08:00|09:30|10:00' &&
  w.CAL.day(today).events[1].kind === 'idle' && w.CAL.day(today).events[1].project === null,
  evNamesAt().join('|') + ' :: ' + evTimesAt().join('|'));
check('… and the day says it was edited, because it no longer matches what was sent',
  !!w.CAL.day(today).localEdit && chSpans().includes('edited'));
w.CAL.write({ day: today, start: '07:00', template: 'normal', mode: 'blocks', notes: [],
  events: [
    { from: '07:00', to: '08:00', dur: 60, kind: 'fixed', name: 'routine', cal: 'kamo' },
    { from: '08:00', to: '09:30', dur: 90, kind: 'task', name: 'a job',   slot: 'b1a', color: '#e06f9a' },
    { from: '09:30', to: '10:30', dur: 60, kind: 'task', name: 'another', slot: 'b2a', color: '#4a9' },
  ] });
click(d.querySelectorAll('.ns-cal .cal-ev')[1].querySelector('.ev-del'));
click($('#ask-yes'));
check('"close the gap" removes the row and pulls everything after it earlier by its duration',
  evNamesAt().join('|') === 'routine|another' && evTimesAt().join('|') === '07:00|08:00' &&
  w.CAL.day(today).events[1].to === '09:00',
  evNamesAt().join('|') + ' :: ' + evTimesAt().join('|') + ' :: ' + JSON.stringify(w.CAL.day(today).events[1]));

/* Colour. Two dials, and an unclaimed slot is never lit. */
check('the day is not coloured by default', !d.querySelector('.ns-cal .cal-day').className.includes('lit-'));
w.Prefs.set('calColorBlocks', true);
check('colouring the blocks marks the day and washes the task rows only',
  d.querySelector('.ns-cal .cal-day').classList.contains('lit-task') &&
  !d.querySelector('.ns-cal .cal-day').classList.contains('lit-fixed') &&
  /\.ns-cal \.cal-day\.lit-task \.cal-ev\.task\{\s*background:color-mix\(in srgb,var\(--ev-color/.test(calCss));
w.Prefs.set('calColorOther', true);
check('… and the other events are their own switch',
  d.querySelector('.ns-cal .cal-day').classList.contains('lit-fixed') &&
  /\.ns-cal \.cal-day\.lit-fixed \.cal-ev\.fixed\{/.test(calCss));
check('neither switch reaches an unclaimed slot', !/lit-\w+ \.cal-ev\.idle/.test(calCss));
w.Prefs.set('calColorBlocks', false); w.Prefs.set('calColorOther', false);

/* The wake-up shift. LOG says when the morning started; CAL moves the day. */
w.CAL.write({ day: today, start: '07:00', template: 'normal', mode: 'blocks', notes: [],
  events: [
    { from: '07:00', to: '08:00', dur: 60, kind: 'fixed', name: 'routine', cal: 'kamo' },
    { from: '08:00', to: '09:30', dur: 90, kind: 'task', name: 'a job', slot: 'b1a', color: '#e06f9a' },
  ] });
check('a wake-up later than the planned start moves the whole day by the difference',
  w.CAL.setWake(today, '08:10') === true && evTimesAt().join('|') === '08:10|09:10' &&
  w.CAL.day(today).events[1].to === '10:40',
  evTimesAt().join('|'));
check('… and the head says the day was woken', chSpans().includes('woken'), chSpans().join('|'));
check('saving the same time again does not move it a second time',
  w.CAL.setWake(today, '08:10') === false && evTimesAt().join('|') === '08:10|09:10');
check('correcting the time moves it by the correction, not by the whole amount again',
  w.CAL.setWake(today, '07:50') === true && evTimesAt().join('|') === '07:50|08:50');
check('clearing it puts the day back where PLAN wrote it',
  w.CAL.setWake(today, '') === true && evTimesAt().join('|') === '07:00|08:00' &&
  w.CAL.day(today).wakeShift === undefined && !chSpans().includes('woken'));
check('an unreadable time moves nothing', w.CAL.setWake(today, 'soon') === false && evTimesAt().join('|') === '07:00|08:00');
w.Prefs.set('calWakeShift', false);
check('and the whole thing is a dial: off, the day stays exactly as it was exported',
  w.CAL.setWake(today, '09:00') === false && evTimesAt().join('|') === '07:00|08:00');
w.Prefs.set('calWakeShift', true);
w.CAL.clearDay(); settle();

/* ── 2.24.1: starting a day PLAN never sent ──
   DAY could only ever draw a day PLAN had exported, so a morning with nothing
   planned offered one route: leave for PLAN. But the blocks are usually already
   on DO, and the only thing missing is a shape to drop them into. */
check('an empty day offers to build one from DO, as well as the older route to PLAN',
  !!$('.ns-cal .cal-empty') && !!$('.ns-cal [data-act="start-day"]') &&
  $('.ns-cal [data-act="start-day"]').textContent.replace(/\s+/g, ' ').trim().startsWith('schedule from do') &&
  !!$('.ns-cal [data-act="to-plan"]'),
  $('.ns-cal .cal-empty')?.textContent.replace(/\s+/g, ' ').trim());
check('… and the two are not both the accent — one question, two answers',
  $('.ns-cal [data-act="to-plan"]').classList.contains('ce-alt') &&
  !$('.ns-cal [data-act="start-day"]').classList.contains('ce-alt') &&
  /\.ns-cal \.ce-alt\{background:none/.test(calCss));
/* §9's rule stands: CAL never resolves plan.dayTemplates. PLAN resolves it and
   hands the record over, and write() is still the only way into the store. */
/* The word appears in cal.js twice, in comments saying it never does this. What
   must never appear is a *read* of it. */
check('CAL still resolves no template of its own — PLAN does it and CAL is handed the day',
  !/Config\.get\(\s*['"`]plan\./.test(calJs) && /PLAN\.blankDay/.test(calJs) &&
  /function blankDay\(/.test(fs.readFileSync(path.join(ROOT, 'js/plan.js'), 'utf8')),
  (calJs.match(/Config\.get\([^)]*\)/g) || []).join(' '));
const blankRec = w.PLAN.blankDay(today);
check('the shape PLAN hands over is the template with every slot empty — no tasks in it',
  !!blankRec && blankRec.day === today && blankRec.events.length > 0 &&
  blankRec.events.every(e => e.kind === 'idle' || e.kind === 'fixed') &&
  blankRec.events.some(e => e.kind === 'idle' && e.slot),
  blankRec ? blankRec.events.map(e => e.kind).join(',') : 'null');
check('… and asking for it changes nothing on its own — it is a value, not a write',
  !w.CAL.day(today));
click($('.ns-cal [data-act="start-day"]'));
check('starting a day writes it and it is drawn',
  !!w.CAL.day(today) && !!$('.ns-cal .cal-day') && !$('.ns-cal .cal-empty'),
  w.CAL.days().join(','));
check('… every slot on it is free, because nothing has been put in one yet',
  w.CAL.day(today).events.every(e => e.kind !== 'task'));
check('… "+ do" is now offered, which is the whole point of building the shape',
  !!$('.ns-cal .ch-act') && $('.ns-cal .ch-act').textContent === '+ do');
/* §9's other rule: DAY never claims a day that was not actually scheduled. */
check('… and the day says it was never sent, permanently and ahead of "edited"',
  !!w.CAL.day(today).localOnly &&
  [...d.querySelectorAll('.ns-cal .ch-meta > span')].map(s2 => s2.textContent).includes('not sent'),
  [...d.querySelectorAll('.ns-cal .ch-meta > span')].map(s2 => s2.textContent).join('|'));
check('a real export replaces it and the day stops saying "not sent"',
  (w.CAL.write({ day: today, start: '07:00', template: 'normal', mode: 'blocks', notes: [],
     events: [{ from: '07:00', to: '08:00', dur: 60, kind: 'task', name: 'a job', slot: 'b1a', color: '#e06f9a' }] }),
   w.CAL.day(today).localOnly === undefined &&
   ![...d.querySelectorAll('.ns-cal .ch-meta > span')].map(s2 => s2.textContent).includes('not sent')),
  [...d.querySelectorAll('.ns-cal .ch-meta > span')].map(s2 => s2.textContent).join('|'));
w.CAL.clearDay(); settle();

/* DO's quick cards. */
check('a quick card is drawn in its label\'s colour, like a block tile',
  /\.ns-do \.qk\{background:color-mix\(in srgb,var\(--bk-c\)/.test(doCss) &&
  /\.ns-do \.qk\.done\{background:color-mix/.test(doCss));
check('… and it is the *other* label that colours it — @quick is on all of them',
  /const other = \(t\.labels \|\| \[\]\)[\s\S]*?tdName\(QUICK_LABEL\)/.test(
    fs.readFileSync(path.join(ROOT, 'js/do.js'), 'utf8')));

/* 2.22 crossfaded the tile's border under the move and 2.22.1 shortened the
   crossfade; 2.22.2 removed it — the tile is not painted at all until the move
   is over. There is no fade fraction left to tune, which was the point. */
check('the tile is no longer crossfaded under the move at all',
  !/Math\.max\(70, Math\.round\(ms \* \.\d+\)\)/.test(planJs2) &&
  !/borderColor:a\.bd/.test(planJs2));
check('… and the tile\'s own CSS transition cannot become the slow one instead',
  /\.ns-plan \.proj-tile\{[^}]*transition:border-color \.12s/.test(
    fs.readFileSync(path.join(ROOT, 'css/plan.css'), 'utf8')));

/* STORE's pinned counter. */
w.Shell.go('store'); w.STORE.go('home');
check('the counter carries its own pin', !!$('.ns-store #cw-pin'));
click($('.ns-store #cw-pin'));
check('… which pins it, and remembers that it is pinned',
  $('.ns-store #cw').classList.contains('pinned') &&
  JSON.parse(w.localStorage.getItem('store_state_v1')).cwPin === true);
check('… as sticky, never fixed — nothing fixed may live inside #track',
  /\.ns-store \.cw\.pinned\{position:sticky/.test(storeCss2) &&
  !/\.ns-store \.cw\.pinned\{[^}]*position:fixed/.test(storeCss2));
click($('.ns-store #cw-pin'));
check('… and unpins again', !$('.ns-store #cw').classList.contains('pinned') &&
  JSON.parse(w.localStorage.getItem('store_state_v1')).cwPin === false);


// ── 34. 2.22.1 — what the first look on a real screen turned up ─────────────
/* The pinned calculator keeps its buttons. 2.22 folded the ± rows away while
   pinned, on the theory that a pinned counter is a readout — it is not, the
   buttons are the reason you pinned it. */
check('a pinned calculator is the whole calculator, buttons and all',
  !/\.cw\.pinned \.cw-btns/.test(storeCss2) && !/\.cw\.pinned \.cw-foot/.test(storeCss2) &&
  /\.ns-store \.cw\.pinned\{position:sticky/.test(storeCss2));
w.Shell.go('store'); w.STORE.go('home');
if (!JSON.parse(w.localStorage.getItem('store_state_v1')).cwPin) click($('.ns-store #cw-pin'));
check('… and its ± rows are still in the DOM while it is pinned',
  $('.ns-store #cw').classList.contains('pinned') &&
  d.querySelectorAll('.ns-store #cw .cw-btns').length === 2 && !!$('.ns-store #cw .cw-foot'));
click($('.ns-store #cw-pin'));

/* The numpad's keys were landing on the wrong row. The field was focused and
   iOS moves the viewport for a focused field whatever inputmode says, which
   puts a fixed pad's keys somewhere other than where they are drawn. The field
   is never focused now, and the keys fire on pointerdown rather than on a
   synthesised click. */
const shellJs = fs.readFileSync(path.join(ROOT, 'js/shell.js'), 'utf8');
check('opening the pad refuses the tap that would focus the field',
  /if \(!kind \|\| !padWanted\(\)\)[\s\S]{0,140}?e\.preventDefault\(\);\s*\n\s*padOpen/.test(shellJs));
check('… and the keys fire on pointerdown, with click kept only for the keyboard',
  /npadEl\.addEventListener\('pointerdown'[\s\S]{0,220}?padHit\(b\)/.test(shellJs) &&
  /Date\.now\(\) - padDownAt < 700/.test(shellJs));
check('… with the pad and its keys claiming the touch outright',
  /\.npad\{[^}]*touch-action:manipulation/.test(shellCss3) &&
  /\.npad-k\{[^}]*touch-action:manipulation/.test(shellCss3));
/* `auto` reads matchMedia, which is stubbed to "not a touch screen" here, so
   the pad would never open on a tap. `always` is the same code path with the
   question already answered. */
w.Prefs.set('numpad', 'always');
w.Shell.go('log'); w.LOG.resetDate(); w.LOG.go('morning');
const kmField = $('.ns-log #m-km');
kmField.value = '';
kmField.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
check('a tap on a numeric field opens the pad without focusing it',
  w.Shell.numpad.isOpen() && w.Shell.numpad.target() === kmField &&
  d.activeElement !== kmField && kmField.classList.contains('pad-on'),
  (d.activeElement && d.activeElement.id) + ' / ' + kmField.className);
const key5 = $('#npad [data-npad="5"]');
key5.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
check('… and a key pressed on pointerdown reaches the field it is drawn over',
  kmField.value === '5', kmField.value);
click(key5);                                        // the click that follows must not double it
check('… without the click behind it counting a second time', kmField.value === '5', kmField.value);
w.Shell.numpad.close();
check('closing it takes the marker off the field',
  !kmField.classList.contains('pad-on') && !w.Shell.numpad.isOpen());
w.Prefs.set('numpad', 'auto');
check('… and on a pointer that is not coarse, `auto` leaves the field alone entirely', (() => {
  kmField.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  return !w.Shell.numpad.isOpen();
})());

/* PLAN's transition: nothing moves but the name and its dot. Three releases
   were spent making this smoother by animating *more* of it; a screen where
   eight things move at once has no subject, and a gesture with no subject reads
   as a stutter however well each part is timed. */
const planJs3 = fs.readFileSync(path.join(ROOT, 'js/plan.js'), 'utf8');
check('the ghosts are gone — what leaves is hidden, like everything else that is not the name',
  !/ghostOut/.test(planJs3) &&
  !/\.ns-plan \.proj-grid\{[^}]*position:relative/.test(
    fs.readFileSync(path.join(ROOT, 'css/plan.css'), 'utf8')));
check('the movers are the text elements, and their box is a carrier rather than a mover',
  /const movers = new Set\(\), carriers = new Set\(\)/.test(planJs3) &&
  /movers\.add\(el\);\s*\n\s*carriers\.add\(now\.get\(box\)\.el\)/.test(planJs3));
check('… a mover carries its full delta now, since its box no longer slides under it',
  /transform:`translate\(\$\{d\.dx\}px,\$\{d\.dy\}px\) scale\(\$\{s\}\)`/.test(planJs3) &&
  !/const tx = d\.dx - p\.dx/.test(planJs3));
check('… the carrier is held unpainted rather than faded, because opacity would take its text with it',
  /carriers\.forEach\(el => \{[\s\S]{0,420}?borderColor:'transparent', backgroundColor:'transparent'/.test(planJs3) &&
  /fill:'backwards'/.test(planJs3));
check('… everything else in the grid is held at nothing for the whole move',
  /delay:moveMs \+ \(fresh\+\+ \* 22\)/.test(planJs3) &&
  /if \(grid\) Array\.from\(grid\.children\)\.forEach\(el => \{ if \(!carriers\.has\(el\)\) hold\(el\); \}\)/.test(planJs3));
check('… and there is no move at all when the name does not actually go anywhere',
  /const travels = \[\.\.\.movers\]\.some/.test(planJs3) &&
  /const moveMs\s+= travels \? Math\.round\(ms \* \.\d+\) : 0/.test(planJs3));
/* 2.24.0 gave the move .58 of the budget — near 400ms of watching a word change
   size, which is the one part of this gesture where the scale is what you see. */
check('… and the name resizes in well under half the budget, not most of it',
  +(planJs3.match(/travels \? Math\.round\(ms \* \.(\d+)\) : 0/) || [])[1] <= 40,
  (planJs3.match(/travels \? Math\.round\(ms \* \.(\d+)\) : 0/) || [])[1]);
check('the queue outside the grid still slides, and is never blinked',
  /if \(grid && grid\.contains\(el\)\) return;/.test(planJs3));
/* The rule under an open project's name. As an ::after it could not be animated
   by el.animate(), so it snapped in on the first frame while every real element
   around it was still held at zero. As a child of the tile it joins the wave. */
w.PLAN.closeProj(); w.PLAN.openProj('curate');
check('the rule under the open project is a real element, so it can come down with the rows',
  !!d.querySelector('.ns-plan .proj-tile.open .ph-rule') &&
  d.querySelector('.ns-plan .ph-rule').parentElement.classList.contains('proj-tile') &&
  !/\.proj-head::after/.test(planCss),
  d.querySelector('.ns-plan .ph-rule')?.parentElement.className);
check('… and it holds no mover, so the reveal wave does not skip it',
  !d.querySelector('.ns-plan .ph-rule').querySelector('[data-flip-text]'));
check('… a closed tile has none — it is the open heading it underlines',
  (w.PLAN.closeProj(), !d.querySelector('.ns-plan .ph-rule')));
w.PLAN.openProj('curate');
// move + reveal must still fit the one motion budget the shell uses for a tab change
const mv = +(planJs3.match(/travels \? Math\.round\(ms \* \.(\d+)\) : 0/) || [])[1];
const rv = +(planJs3.match(/const revealMs = Math\.round\(ms \* \.(\d+)\)/) || [])[1];
check('… and the whole gesture still fits inside one --t-flip',
  mv + rv <= 100, mv + '% move + ' + rv + '% reveal');
w.Shell.go('plan'); w.PLAN.closeProj();
w.PLAN.openProj('curate');
check('opening a project still leaves exactly one tile and its sections on screen',
  d.querySelectorAll('.ns-plan .proj-tile').length === 1 &&
  d.querySelectorAll('.ns-plan .proj-sec').length > 0,
  d.querySelectorAll('.ns-plan .proj-tile').length + ' tiles');
w.PLAN.closeProj();

/* LOG's month and its fortnight. */
check('a written day is a tint rather than a fill — the border carries the state',
  /\.ns-log \.lc-c\.f2\{background:color-mix/.test(logCss2) &&
  !/\.ns-log \.lc-c\.f2\{background:var\(--y\)/.test(logCss2));
/* Forty-two boxes at the full border weight is a lattice, and it was the
   loudest thing on the screen. Half of --bw, floored at one physical pixel —
   a ratio, so the Border weight dial still reaches it (§4). */
check('a day\'s border is a hairline, and still derived from --bw rather than a literal',
  /\.ns-log \.lc-c\{[^}]*border:max\(\.5px, calc\(var\(--bw\) \* \.5\)\) solid/.test(logCss2) &&
  !/\.ns-log \.lc-c\{[^}]*border:var\(--bw\) solid/.test(logCss2));
/* 2.23: the ring became an inversion. A third border weight in a grid that
   already has a hairline and today's accent was not a difference you could see
   at 5mm across; swapping the ground for the ink is. It must also beat the
   written-day tints, which it does by being declared after them. */
check('… and the selected day is inverted rather than ringed',
  /\.ns-log \.lc-c\.sel\{background:var\(--tx\);border-color:var\(--tx\);color:var\(--bg\)/.test(logCss2) &&
  !/\.ns-log \.lc-c\.sel\{box-shadow:0 0 0 1\.5px/.test(logCss2) &&
  logCss2.indexOf('.ns-log .lc-c.sel{') > logCss2.indexOf('.ns-log .lc-c.f2{'));
check('… and the day numbers are bold enough to read at that size',
  /\.ns-log \.lc-c\{[^}]*font:700 9\.5px\/1 var\(--mono\)/.test(logCss2));
w.Shell.go('log'); w.LOG.go('home'); w.LOG.resetDate();
check('the fortnight draws three series now, stress beside energy and mood',
  d.querySelectorAll('.ns-log .lc-l').length === 3 &&
  ['nrg','mood','stress'].every(c => !!$('.ns-log .lc-l.' + c)),
  d.querySelectorAll('.ns-log .lc-l').length + ' lines');
const dotsOf = c => d.querySelectorAll('.ns-log .lc-d.' + c).length;
check('… with a dot on every day that has a value, and none on the days that do not',
  dotsOf('nrg') >= 2 && dotsOf('mood') >= 2 && dotsOf('stress') >= 2 &&
  dotsOf('nrg') + dotsOf('mood') + dotsOf('stress') === d.querySelectorAll('.ns-log .lc-dh').length &&
  d.querySelectorAll('.ns-log .lc-d').length < 14 * 3,   // not one per day: the gaps are real
  [dotsOf('nrg'), dotsOf('mood'), dotsOf('stress')].join('/') + ' dots, ' +
  d.querySelectorAll('.ns-log .lc-dh').length + ' halos');
check('… drawn as round caps, so the stretched viewBox cannot flatten them into ellipses',
  [...d.querySelectorAll('.ns-log .lc-d')].every(p => /l\.01 0$/.test(p.getAttribute('d'))) &&
  /\.lc-d,\.ns-log \.lc-dh\{[^}]*stroke-linecap:round/.test(logCss2) &&
  /\.lc-d,\.ns-log \.lc-dh\{[^}]*vector-effect:non-scaling-stroke/.test(logCss2));
check('… each series in its own fixed hue, which an accent-relative palette could not promise',
  /--lc-nrg:#/.test(logCss2) && /--lc-mood:#/.test(logCss2) && /--lc-stress:#/.test(logCss2));
check('… and the graph is taller than the 30px it was',
  /\.ns-log \.lc-spark\{[^}]*height:58px/.test(logCss2));
check('the key names all three, each with the dot the chart draws',
  d.querySelectorAll('.ns-log .lc-kk').length === 3 &&
  /stress/.test($('.ns-log .lc-key').textContent), $('.ns-log .lc-key')?.textContent.trim());


// ── 35. 2.22.3 — the press wash, a fold, a chart that opens, two dials ──────
const tokensCss2 = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
const doCss3  = fs.readFileSync(path.join(ROOT, 'css/do.css'), 'utf8');
const logCss3 = fs.readFileSync(path.join(ROOT, 'css/log.css'), 'utf8');

/* :active on a touch screen is applied when the finger lands and cleared when
   it lifts — so a touch that becomes a scroll lights up the row it started on
   and keeps it lit as the list moves under it. One token, switched off for the
   length of the gesture. */
check('the press wash is one token, not 22 literals',
  /--press:var\(--s2\)/.test(tokensCss2) &&
  /\[data-scrolling="on"\]\{--press:transparent\}/.test(tokensCss2));
check('… and no app sheet presses with the literal any more', (() => {
  const sheets = ['do','log','store','learn','shell','plan','tend','track','settings'];
  const bad = sheets.filter(s => /:active\{background:var\(--s2\)/.test(
    fs.readFileSync(path.join(ROOT, 'css/' + s + '.css'), 'utf8')));
  return bad.length === 0;
})());
check('… reaching the row that reported it',
  /\.ns-do \.qk-item:active\{background:var\(--press\)\}/.test(doCss3) &&
  /\.ns-do \.qk-head:active\{background:var\(--press\)\}/.test(doCss3));
check('the shell raises the flag while a slide moves, and lowers it after',
  /rootEl\.setAttribute\('data-scrolling', 'on'\)/.test(shellJs) &&
  /rootEl\.removeAttribute\('data-scrolling'\)/.test(shellJs) &&
  /addEventListener\('touchmove', markScrolling/.test(shellJs));
w.Shell.go('do');
const body = $('#view-do .view-body');
body.dispatchEvent(new w.Event('scroll', { bubbles: false }));
check('… and a scroll actually raises it', d.documentElement.dataset.scrolling === 'on',
  String(d.documentElement.dataset.scrolling));
await tick(220);
check('… and it is down again once the gesture is over', !d.documentElement.dataset.scrolling,
  String(d.documentElement.dataset.scrolling));

/* DO's quick section folds from its own title. */
w.Shell.go('do');
if (!JSON.parse(w.localStorage.getItem('do_todoist_v1')).quickOn) w.DO.toggleQuick();
w.DO.renderQuick();
const quickShown = () => !$('.ns-do #td-quick').classList.contains('hidden');
if (quickShown()) {
  check('the quick section\'s title is the fold switch', !!$('.ns-do #td-quick .tt-fold'));
  click($('.ns-do #td-quick .tt-fold'));
  check('… folding hides the cards and keeps the head',
    $('.ns-do #td-quick').classList.contains('folded') &&
    !!$('.ns-do #td-quick .tt-head') && !!$('.ns-do #td-quick .tt-fold') &&
    $('.ns-do #td-quick #td-quick-body').classList.contains('hidden'),
    $('.ns-do #td-quick').className);
  check('… the count stays readable while it is folded',
    /open/.test($('.ns-do #td-quick .tt-fold').textContent),
    $('.ns-do #td-quick .tt-fold').textContent.trim());
  check('… and it is remembered', JSON.parse(w.localStorage.getItem('do_todoist_v1')).quickFold === true);
  click($('.ns-do #td-quick .tt-fold'));
  check('… tapping it again brings them back',
    !$('.ns-do #td-quick').classList.contains('folded') &&
    !$('.ns-do #td-quick #td-quick-body').classList.contains('hidden'));
} else {
  check('the quick section folds from its title (source)', /toggleQuickFold/.test(
    fs.readFileSync(path.join(ROOT, 'js/do.js'), 'utf8')));
}

/* LOG's chart opens over the month. */
w.Shell.go('log'); w.LOG.go('home'); w.LOG.resetDate();
check('the chart is a button', !!$('.ns-log [data-trend]') &&
  $('.ns-log [data-trend]').getAttribute('role') === 'button');
click($('.ns-log [data-trend]'));
check('opening it takes the month\'s place rather than squeezing it',
  $('.ns-log #log-cal').classList.contains('big') &&
  !$('.ns-log .lc-grid') && !$('.ns-log .lc-head') && !!$('.ns-log .lc-trend.big'));
check('… and only then does it carry axes',
  d.querySelectorAll('.ns-log .lc-yax span').length === 5 &&
  d.querySelectorAll('.ns-log .lc-xax span').length === 14 &&
  d.querySelectorAll('.ns-log .lc-g').length === 5,
  d.querySelectorAll('.ns-log .lc-yax span').length + '/' +
  d.querySelectorAll('.ns-log .lc-xax span').length + '/' +
  d.querySelectorAll('.ns-log .lc-g').length);
/* The y labels run 5 at the top to 1 at the bottom; the x labels start at the
   plot's own PAD inset and end at 100 − PAD, which is where the first and last
   points are. Both read off the same x()/y() the chart draws with. */
const yTops = [...d.querySelectorAll('.ns-log .lc-yax span')].map(s => parseFloat(s.style.top));
const xLefts = [...d.querySelectorAll('.ns-log .lc-xax span')].map(s => parseFloat(s.style.left));
check('… the axes placed at the same fractions the plot uses, so they line up by construction',
  yTops.join(',') === '0,25,50,75,100' &&
  xLefts[0] === 4 && xLefts[13] === 96 &&
  xLefts.every((v, i) => i === 0 || v > xLefts[i - 1]),
  yTops.join(',') + ' | ' + xLefts[0] + '…' + xLefts[13]);
check('… and they are HTML, not <text> in a viewBox that is stretched',
  !/<text/.test($('.ns-log .lc-spark').innerHTML) &&
  $('.ns-log .lc-yax').tagName === 'DIV');
check('… the three series still drawn, and the key saying how to get back',
  d.querySelectorAll('.ns-log .lc-l').length === 3 &&
  $('.ns-log .lc-kn').textContent === 'close', $('.ns-log .lc-kn').textContent);
click($('.ns-log [data-trend]'));
check('tapping it again gives the month back',
  !$('.ns-log #log-cal').classList.contains('big') && !!$('.ns-log .lc-grid') &&
  !d.querySelector('.ns-log .lc-yax') && $('.ns-log .lc-kn').textContent === '14d');

/* Motion: a speed dial that composes with the preset, and one exception to none. */
check('--mo is the preset times the dial, so the two compose',
  /--mo-base:1;/.test(tokensCss2) && /--mo-scale:1;/.test(tokensCss2) &&
  /--mo:calc\(var\(--mo-base\) \* var\(--mo-scale\)\)/.test(tokensCss2) &&
  /\[data-motion="reduced"\]\{--mo-base:\.45\}/.test(tokensCss2) &&
  !/\[data-motion="reduced"\]\{--mo:/.test(tokensCss2));
w.Prefs.set('motionSpeed', 2);
check('… and speed goes in while a duration multiplier comes out',
  d.documentElement.style.getPropertyValue('--mo-scale') === '0.5',
  d.documentElement.style.getPropertyValue('--mo-scale'));
w.Prefs.set('motionSpeed', 0.5);
check('… both ways', d.documentElement.style.getPropertyValue('--mo-scale') === '2',
  d.documentElement.style.getPropertyValue('--mo-scale'));
w.Prefs.set('motionSpeed', 1);
check('the bar can keep moving at Motion: none, and does not by default',
  w.Prefs.SCHEMA.navMotion.def === false &&
  d.documentElement.dataset.navMotion === 'off');
w.Prefs.set('navMotion', true);
check('… switched on it is one exception, scoped to the bar and its arrows',
  d.documentElement.dataset.navMotion === 'on' &&
  /\[data-motion="none"\]\[data-nav-motion="on"\] #nav,/.test(tokensCss2) &&
  /\[data-motion="none"\]\[data-nav-motion="on"\] \.nav-arrow\{\s*\n?\s*transition-duration:\.24s!important\}/.test(tokensCss2));
w.Prefs.set('navMotion', false);
w.SET.panel('layout');
check('both are controls on the layout panel, findable like every other dial',
  !!$('.ns-set [data-slider="motionSpeed"]') && !!$('.ns-set [data-pref="navMotion"]'));
check('… and the appearance reset knows about them',
  /'motion','motionSpeed','navMotion','contrast'/.test(
    fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8')));

/* ══ 2.24 — the band, the hints, and DO's cards ═══════════════════════════════ */

/* ── The blurred title ──
   Four of the five title sizes multiply out to a fraction (54 × .86 = 46.44),
   and the band is bottom-aligned, so that fraction became the offset every row
   inside it sat at — text on a half pixel is resampled rather than drawn, and
   the smallest text in the band, the date line, is where it showed. */
const tokensCss4 = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
const doCss2     = fs.readFileSync(path.join(ROOT, 'css/do.css'), 'utf8');
const shellCss4  = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
check('the wordmark is snapped to a whole pixel, and the band is measured in the snapped value',
  /--title-px:round\(calc\(var\(--title-base\) \* var\(--title-scale\)\), 1px\)/.test(tokensCss4) &&
  /\.view > \.h-top \.h-logo\{[\s\S]*?font-size:var\(--title-px\)/.test(shellCss4) &&
  /min-height:calc\(var\(--sat\) \+ 54px \+ max\(var\(--band-row\), var\(--title-px\) \* var\(--title-cap\)\)\)/.test(shellCss4));
/* 2.24.0 snapped the wordmark and the blur stayed, because the band has *two*
   fractional inputs and the other is the status-bar inset — 47.33px on a
   notched iPhone, landing in the padding and the min-height alike. */
check('the status-bar inset is snapped too, and every header measures from it',
  /--sat:round\(up, env\(safe-area-inset-top\), 1px\)/.test(tokensCss4) &&
  /padding:calc\(var\(--sat\) \+ 14px\)/.test(shellCss4) &&
  (() => {
    // comments explain the inset by name; what must be gone is every *use* of it
    const rules = f => fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const sheets = ['shell','do','log','plan','store','learn','settings'];
    const bad = sheets.filter(f => /env\(safe-area-inset-top\)/.test(rules(f)));
    return bad.length === 0 || bad.join(',');
  })() === true,
  (() => {
    const rules = f => fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return ['shell','do','log','plan','store','learn','settings']
      .filter(f => /env\(safe-area-inset-top\)/.test(rules(f))).join(',');
  })());
check('… rounded up, never down — it is clearance from a physical notch',
  /round\(up, env\(safe-area-inset-top\)/.test(tokensCss4));
check('… behind @supports, so a browser without round() keeps the plain multiplication',
  /@supports \(font-size: round\(1\.5px, 1px\)\)/.test(tokensCss4) &&
  /--title-px:calc\(var\(--title-base\) \* var\(--title-scale\)\)/.test(tokensCss4));
/* The other half: .morph was added on every tab change and never taken off, so
   the title's fill-mode animation stayed applied — holding the wordmark on a
   compositing layer, where text is drawn with grayscale antialiasing. */
w.Shell.go('log'); w.Shell.go('do');
await tick(950);
check('the morph class comes off once it has played, so the title is not left on a layer',
  ![...d.querySelectorAll('#track .view')].some(v => v.classList.contains('morph')),
  [...d.querySelectorAll('#track .view.morph')].map(v => v.id).join(','));

/* ── The hints switch ── */
check('the hints are on by default and claim the root', w.Prefs.get('tips') === true &&
  d.documentElement.dataset.tips === 'on');
w.Prefs.set('tips', false);
const setCss4 = fs.readFileSync(path.join(ROOT, 'css/settings.css'), 'utf8');
check('switching them off reaches every kind of hint at once, through one attribute',
  d.documentElement.dataset.tips === 'off' &&
  /\[data-tips="off"\] \.ns-set \.data-warn,[\s\S]*?\.ns-set \.setting-lbl small,[\s\S]*?\{display:none\}/.test(setCss4));
check('… but never the control\'s own name, nor the home menu\'s map of what is inside a category',
  !/\[data-tips="off"\][^{]*\.set-cat-b small/.test(setCss4) &&
  !/\[data-tips="off"\][^{]*\.set-app-b small/.test(setCss4));
w.SET.panel('behave');
check('it is a control on the behaviour panel, findable like every other dial',
  !!$('.ns-set [data-pref="tips"]') &&
  w.SET.searchIndex().some(r => /explain the controls/i.test(r.title)));
w.Prefs.set('tips', true);

/* ── A static panel's switches now follow the value ──
   The app panels are markup in index.html: their data-pref switches were
   written with the shipped default on them and nothing ever painted them
   again, so CAL's three had been showing the default since they shipped. */
w.Prefs.set('calShowIdle', false);
w.SET.panel('cal');
check('a static panel\'s switch is painted from the pref, not left on the shipped default',
  !$('.ns-set [data-pref="calShowIdle"]').classList.contains('on') &&
  $('.ns-set [data-pref="calShowIdle"]').getAttribute('aria-checked') === 'false' &&
  $('.ns-set [data-pref="calShowFixed"]').classList.contains('on'));
click($('.ns-set [data-pref="calShowIdle"]'));
check('… and flipping it moves the dot as well as the value',
  w.Prefs.get('calShowIdle') === true && $('.ns-set [data-pref="calShowIdle"]').classList.contains('on'));
check('the two colour switches and the wake-up one are on that panel too',
  !!$('.ns-set [data-pref="calColorBlocks"]') && !!$('.ns-set [data-pref="calColorOther"]') &&
  !!$('.ns-set [data-pref="calWakeShift"]'));

/* ── DO's routine cards ── */
w.Shell.go('do'); w.DO.setTab('daily');
const cards = () => [...d.querySelectorAll('.ns-do #home-grid .card')];
const cardNames = () => cards().map(c => c.querySelector('.card-t').textContent);
check('a full card carries its name, its ratio and a bar',
  cards().length > 0 && !!cards()[0].querySelector('.card-bar-fill') &&
  / \/ .*done/.test(cards()[0].querySelector('.card-s').textContent) &&
  !d.querySelector('.ns-do #home-grid.mini'),
  cards()[0]?.textContent.replace(/\s+/g, ' ').trim());
w.Prefs.set('doCardStyle', 'minimal');
check('minimal drops the bar and the word, keeps the ratio, and goes to one column',
  d.querySelector('.ns-do #home-grid').classList.contains('mini') &&
  cards().every(c => c.classList.contains('mini') && !c.querySelector('.card-bar')) &&
  /^\d+ \/ \d+$/.test(cards()[0].querySelector('.card-s').textContent) &&
  /\.ns-do \.grid\.mini\{grid-template-columns:1fr/.test(doCss2),
  cards()[0]?.textContent.replace(/\s+/g, ' ').trim());
w.Prefs.set('doCardStyle', 'full');
/* toggleAll() works on whichever routine is open and *toggles*, so finishing
   one means opening it first and coming back — the same three taps a person
   makes — and only when it is not already finished. The state is read back off
   DO's own key rather than off the grid, because a hidden card is not there to
   be asked. */
const doState = () => { try { return JSON.parse(w.localStorage.getItem('do_' + w.Shell.today())) || {}; } catch { return {}; } };
const allTicked = k => { const st = doState()[k] || {};
  return w.Config.get('do.routines')[k].items.every(i => st[i]); };
const setDone = (k, want) => {
  if (allTicked(k) === want) return;
  w.DO.openRoutine(k); w.DO.toggleAll(); w.DO.go('home');
};
const finish = k => setDone(k, true);
const dailyKeys = w.Config.get('do.tabs').find(t => t.id === 'daily').routines
  .filter(k => w.Config.get('do.routines')[k]);
const firstKey = dailyKeys[0];
const firstName = w.Config.get('do.routines')[firstKey].label;
finish(firstKey);
check('a finished card is marked done and stays on the grid',
  cardNames().includes(firstName) && !!d.querySelector('.ns-do #home-grid .card.done'));
w.Prefs.set('doHideDone', true);
check('… until the dial says hide it, and then it is gone',
  !cardNames().includes(firstName) && !d.querySelector('.ns-do #home-grid .card.done'),
  cardNames().join(','));
check('… and nothing was lost: the ticks are still there and switching back brings it straight back',
  (w.Prefs.set('doHideDone', false), cardNames().includes(firstName) &&
   !!d.querySelector('.ns-do #home-grid .card.done')));
w.Prefs.set('doHideDone', true);
dailyKeys.forEach(finish);
check('a tab with nothing left says so rather than leaving a hole where the grid was',
  !!d.querySelector('.ns-do .grid-clear') && /all done/.test($('.ns-do .grid-clear').textContent) &&
  /settings → apps → do/.test($('.ns-do .grid-clear').textContent));
dailyKeys.forEach(k => setDone(k, false));   // put the day back for whatever runs after
w.Prefs.set('doHideDone', false);

/* ── The big day-number ──
   2.24.0 put it on DO (wrong: it crowded the tab strip, and the number only
   changed at midnight). 2.24.1 moved it to LOG. 2.25 gives DAY the same one and
   defines it once in the shell, because the point is that they are identical. */
w.Shell.go('log');
const dayNum = () => $('.ns-log #log-daynum');
check('the date sits at the other end of the wordmark\'s row, in the same type at the same size',
  !!dayNum() && dayNum().parentElement.classList.contains('h-logo-row') &&
  dayNum().querySelector('.dn-cur').textContent === String(Number(w.Shell.today().slice(8, 10))) &&
  /\.view > \.h-top \.h-daynum\{[^}]*font:800 var\(--title-px\)\/1 var\(--head\)/.test(shellCss4),
  dayNum()?.textContent);
check('… in the title\'s own colour, not the muted one',
  /\.view > \.h-top \.h-daynum\{[^}]*color:var\(--tx\)/.test(shellCss4));
check('… defined once in the shell, not once per app that carries one',
  !/h-daynum/.test(fs.readFileSync(path.join(ROOT, 'css/log.css'), 'utf8')) &&
  !/h-daynum/.test(fs.readFileSync(path.join(ROOT, 'css/cal.css'), 'utf8')) &&
  !/\.ns-do \.h-daynum/.test(doCss2));
check('… and it is off DO, which has its tab strip\'s width back',
  !d.querySelector('.ns-do #do-daynum') &&
  d.querySelector('.ns-do .h-logo-row').children.length === 2,
  [...d.querySelector('.ns-do .h-logo-row').children].map(c => c.className).join(','));
check('… and it is hidden from the reading order — the date line above it already says the date',
  dayNum().getAttribute('aria-hidden') === 'true');

/* 2.25: a shuffle, not a roll. The number that leaves is flicked off to one
   side, tilted and blurred; the next drops in from the other side. */
check('the change is a sideways shuffle with blur, not a vertical roll',
  /@keyframes dn-in\{[\s\S]*?translateX\(calc\(var\(--dn-dir,1\) \* \.55em\)\)[\s\S]*?filter:blur\(7px\)/.test(shellCss4) &&
  /@keyframes dn-out\{[\s\S]*?filter:blur\(7px\)/.test(shellCss4) &&
  !/translateY\(100%\)/.test(shellCss4),
  (shellCss4.match(/@keyframes dn-in\{[\s\S]*?\}\}/) || ['none'])[0].slice(0, 120));
check('… and it tilts as it goes, which is what makes it read as a card and not a slide',
  /rotate\(calc\(var\(--dn-dir,1\) \* 7deg\)\)/.test(shellCss4) &&
  /rotate\(calc\(var\(--dn-dir,1\) \* -7deg\)\)/.test(shellCss4));
const dnText = () => dayNum().querySelector('.dn-cur').textContent;
const dnWas = dnText();
w.LOG.shiftDate(-1);
check('stepping the date shuffles the number, the old one leaving as the new one arrives',
  dnText() !== dnWas && dayNum().querySelectorAll('.dn-out').length === 1 &&
  dayNum().querySelector('.dn-cur').classList.contains('shuffling') &&
  dayNum().querySelector('.dn-out').textContent === dnWas,
  dnWas + ' -> ' + dnText() + ' out=' + dayNum().querySelectorAll('.dn-out').length);
check('… stepping back throws it the other way, so the animation agrees with the gesture',
  dayNum().style.getPropertyValue('--dn-dir') === '-1',
  dayNum().style.getPropertyValue('--dn-dir'));
w.LOG.resetDate();
check('… and forward throws it the first way again',
  dnText() === dnWas && dayNum().style.getPropertyValue('--dn-dir') === '1');

/* DAY carries the same number, from the same helper. */
w.Shell.go('cal');
const calNum = () => $('.ns-cal #cal-daynum');
check('DAY carries the same big date, in the same row, from the same helper',
  !!calNum() && calNum().parentElement.classList.contains('h-logo-row') &&
  calNum().querySelector('.dn-cur').textContent === String(Number(w.CAL.selected().slice(8, 10))) &&
  calNum().getAttribute('aria-hidden') === 'true',
  calNum()?.textContent);
/* The cleanup timer used to be one module-level handle shared by both boxes, so
   whichever shuffled second cancelled the first one's cleanup and left its
   outgoing digits in the DOM to pile up behind the live number. Shuffle both,
   several times, and neither box may accumulate. */
w.Shell.go('log');
for (let i = 0; i < 3; i++) { w.LOG.shiftDate(-1); w.CAL.pick(calDay); w.CAL.pick(today); }
const piled = box => box.querySelectorAll('.dn-out').length > 1 ||
  box.querySelector('.dn-cur').textContent.length > 2;
check('… and one box\'s shuffle never cancels the other box\'s cleanup',
  !piled(dayNum()) && !piled(calNum()),
  'log=' + dayNum().querySelector('.dn-cur').textContent + '/' + dayNum().querySelectorAll('.dn-out').length +
  ' cal=' + calNum().querySelector('.dn-cur').textContent + '/' + calNum().querySelectorAll('.dn-out').length);
w.LOG.resetDate();
check('… it travels with the title on a tab change, and holds still when the track does',
  /\.view\.morph > \.h-top \.h-daynum,/.test(shellCss4) &&
  /#track\.still \.h-logo,#track\.still \.hd-title,#track\.still \.h-daynum\{animation:none!important\}/.test(shellCss4));
check('… and reduced motion takes it off with the rest of the morph',
  /\.view\.morph > \.h-top \.h-daynum,\.view\.leaving > \.h-top \.h-daynum\{animation:none\}/.test(shellCss4));

/* == 2.25 ==================================================================== */

/* -- The blur, third attempt --
   Not a fractional pixel after all. `-webkit-overflow-scrolling:touch` opts a
   scroller into iOS's legacy accelerated path, where the scroller and anything
   composited over it are rasterised and re-scaled rather than redrawn - and
   `.h-top` sits directly over `.view-body` at z-index 20. It has done nothing
   since iOS 13 and is deprecated. */
const sheetRules = f => fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const ALL_SHEETS = ['shell','do','log','plan','store','settings','cal','learn','tend','track'];
const logCss4 = fs.readFileSync(path.join(ROOT, 'css/log.css'), 'utf8');
check('no scroller is on iOS legacy accelerated path any more',
  ALL_SHEETS.every(f => !/-webkit-overflow-scrolling\s*:\s*touch/.test(sheetRules(f))),
  ALL_SHEETS.filter(f => /-webkit-overflow-scrolling\s*:\s*touch/.test(sheetRules(f))).join(','));
check('... and the sideways strips still claim pan-x, which is what makes them draggable',
  /\.ns-do \.tabs\{[\s\S]*?touch-action:pan-x pan-y/.test(doCss2) &&
  /\.set-seg\{[\s\S]*?touch-action:pan-x pan-y/.test(setCss4));
check('... the two earlier fixes are kept, because both were real',
  /--title-px:round\(/.test(tokensCss4) && /--sat:round\(up,/.test(tokensCss4));

/* -- LOG's arrows step aside like DAY's stepper -- */
w.Shell.go('log');
const metaRow = () => $('#view-log .h-meta');
check('LOG date arrows fade on idle and share DAY dial rather than inventing a second one',
  /\.ns-log \.h-meta\.idle \.h-arr,[\s\S]*?opacity:0;pointer-events:none\}/.test(logCss4) &&
  /Prefs\.get\('calStepsHide'\)/.test(fs.readFileSync(path.join(ROOT, 'js/log.js'), 'utf8')));
metaRow().classList.add('idle');
w.LOG.wakeArrows();
check('... and any touch on LOG brings them straight back', !metaRow().classList.contains('idle'));
metaRow().classList.add('idle');
w.LOG.shiftDate(-1);
check('... stepping the date counts as using them', !metaRow().classList.contains('idle'));
w.LOG.resetDate();

/* -- STORE: the list total, and the pinned cost -- */
const storeCss4 = fs.readFileSync(path.join(ROOT, 'css/store.css'), 'utf8');
w.Shell.go('store');
const sCount = () => $('.ns-store #store-count');
const sCost  = () => $('.ns-store #store-cost');
check('STORE puts the list total in the band, the way the other apps put their meta there',
  !!sCount() && !!sCount().closest('.h-top'), sCount() && sCount().textContent);
/* 2.25.1: the count moved to the date line. Two big things at one end of a
   phone-wide band is how the total ended up running off the edge. */
check('... the count reads on the date line now, and the total has the wordmark row to itself',
  sCount().parentElement.classList.contains('h-label') &&
  sCost().parentElement.classList.contains('h-logo-row') &&
  !d.querySelector('.ns-store .h-band-end'),
  sCount().parentElement.className + ' | ' + sCost().parentElement.className);
check('... the total is the wordmark\'s own size, capped only where it would not fit',
  /\.ns-store \.h-cost\{[\s\S]*?font-size:min\(var\(--title-px\), 14vw\)/.test(storeCss4) &&
  /\.ns-store \.h-cost\{[^}]*min-width:0;overflow:visible;clip-path:inset\(-100% 0\)/.test(storeCss4) &&
  /\.view > \.h-top\{overflow:hidden\}/.test(shellCss4));
check('the cost is hidden while the counter is unpinned', sCost().classList.contains('hidden'));
w.STORE.togglePin();
check('pinning puts the running cost in the band, at the wordmark size and in white',
  !sCost().classList.contains('hidden') && /^[\d.]+/.test(sCost().textContent) &&
  !!sCost().querySelector('.cu') &&
  /\.ns-store \.h-cost\{[\s\S]*?color:var\(--tx\)/.test(storeCss4),
  sCost().textContent);
check('... with a hard offset copy of its own glyphs behind it, not a soft drop shadow',
  /\.ns-store \.h-cost\{[\s\S]*?text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(storeCss4) &&
  !/text-shadow:[^;]*blur/.test(storeCss4));
/* 3.0.1: the mark wore the inverse of the number — accent glyph, title-coloured
   shadow — the way the wordmark's dot did, and it went the same way. The total is
   one number and one signal; half of it in the other colour is what reads as a
   fault rather than as a total moving. */
check('... and the currency mark wears what the number wears, not the inverse of it',
  /\.ns-store \.h-cost \.cu\{[^}]*color:var\(--tx\)/.test(storeCss4) &&
  /\.ns-store \.h-cost \.cu\{[^}]*--title-sh-c:var\(--y\);text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(storeCss4) &&
  !/\.ns-store \.h-cost \.cu\{[^}]*text-shadow:none/.test(storeCss4));
check('... and nothing in the change is a colour any more',
  !/\.h-cost\.(up|down)[^{]*\{[^}]*color/.test(storeCss4),
  (storeCss4.match(/\.h-cost\.(up|down)[^{]*\{[^}]*/g) || []).join(' | ').slice(0, 90));
check('... and the total reserves room for its own shadow rather than clipping it',
  /\.ns-store \.h-cost\{[\s\S]*?padding-right:var\(--title-sh-x\)/.test(storeCss4));
check('... arriving is not a change: pinning mid-trip mounts, it does not flash',
  sCost().classList.contains('mount') &&
  !sCost().classList.contains('up') && !sCost().classList.contains('down'));
check('... and the two are distinguishable: one is the date line, the other the big number',
  /\.ns-store \.h-count\{color:var\(--y\);margin-left:10px\}/.test(storeCss4));

/* 3.0.2 — the change is a sign, not a colour. Green and red asked the eye to
   decode a hue into a direction, on a number that already carries the accent in
   its shadow and against a palette the theme picker can move out from under it.
   A `+` or a `−` says the same thing in one glyph. */
const sSign = () => $('.ns-store #store-cost .cs');
/* jsdom loads no stylesheets, so `display` is unreadable here: the class is the
   state, and the sheet is asserted separately. */
check('at rest the sign reserves nothing — the band is tight enough already',
  !!sSign() && !sSign().classList.contains('on') &&
  /\.ns-store \.h-cost \.cs\{display:none/.test(storeCss4),
  sSign() ? sSign().className || '(no class)' : 'no sign element');
w.STORE.addCart(4.5);
check('a rise puts a + at the head of the total',
  sSign().textContent === '+' && sSign().classList.contains('on') &&
  sCost().classList.contains('up') && !sCost().classList.contains('down'),
  JSON.stringify(sSign().textContent) + ' | ' + sCost().className);
w.STORE.addCart(-2);
check('a fall puts a minus there — the typographic one, which is a digit wide',
  sSign().textContent === '−' && sSign().classList.contains('on') &&
  sCost().classList.contains('down') && !sCost().classList.contains('up'),
  JSON.stringify(sSign().textContent) + ' | ' + sCost().className);
check('... and there is no green or red left anywhere in the counter',
  !/--gr|--re/.test(storeCss4.slice(storeCss4.indexOf('.h-cost'), storeCss4.indexOf('.h-settings-btn'))),
  'colour tokens still in the counter block');
check('... the sign wears what the number wears, not a colour of its own',
  /\.ns-store \.h-cost \.cs\{[^}]*text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(storeCss4) &&
  !/\.ns-store \.h-cost \.cs\{[^}]*color:/.test(storeCss4));
check('... it turns in, holds while the total is read, then goes, on one animation',
  /@keyframes cost-sign\{[\s\S]*?rotateX\(-88deg\)[\s\S]*?100%\{opacity:0/.test(storeCss4) &&
  /\.cs\.on\{[^}]*animation:cost-sign calc\(\.9s \* var\(--mo\)\)/.test(storeCss4));
check('... the movement under it is still a nudge, not a jump',
  /@keyframes cost-up\s*\{0%\{transform:none\} 34%\{transform:translateY\(-\.055em\)\}/.test(storeCss4) &&
  /@keyframes cost-down\{0%\{transform:none\} 34%\{transform:translateY\(\.055em\)\}/.test(storeCss4));
/* 3.0 — the digits turn over, and every node survives a repaint.
   The mark used to be rebuilt by an `innerHTML =` on every paint, and a
   replaced element has no previous value to transition from. The sign is held
   across a rebuild for the same reason: its animation is running while the
   number under it changes. */
const cuNode = () => $('.ns-store #store-cost .cu');
const cuWas = cuNode();
w.STORE.addCart(1.25);
check('the currency mark is the same element after a repaint, or its colour cannot ease',
  !!cuNode() && cuNode() === cuWas, cuNode() ? 'a node, but a new one' : 'no mark');
check('... and the number is cells, one per character, the decimal point included',
  [...d.querySelectorAll('.ns-store #store-cost .cd')].map(c => c.textContent).join('') ===
  $('.ns-store #cw-cart').textContent,
  [...d.querySelectorAll('.ns-store #store-cost .cd')].map(c => c.textContent).join(''));
check('... which carry no colour of their own, so they follow .h-cost frame for frame',
  !/\.ns-store \.h-cost \.cd\{[^}]*color:/.test(storeCss4) &&
  !/\.ns-store \.h-cost \.cd\{[^}]*text-shadow:/.test(storeCss4));
/* Only what changed turns over: 5.75 -> 5.95 is one card, not four. */
const flapped = () => [...d.querySelectorAll('.ns-store #store-cost .cd.flap')].map(c => c.textContent).join('');
w.STORE.addCart(0.2);
check('only the characters that changed flip, the way a board turns one card',
  flapped().length > 0 && flapped().length < $('.ns-store #cw-cart').textContent.length,
  $('.ns-store #cw-cart').textContent + ' flipped [' + flapped() + ']');
check('... the flip is a card falling from the top edge, in a perspective, staggered left to right',
  /\.ns-store \.h-cost\{[\s\S]*?perspective:140px/.test(storeCss4) &&
  /\.ns-store \.h-cost \.cd\{[^}]*transform-origin:50% 0/.test(storeCss4) &&
  /@keyframes cost-flap\{[\s\S]*?rotateX\(-88deg\)/.test(storeCss4) &&
  /animation-delay:calc\(var\(--i, 0\) \* \.026s \* var\(--mo\)\)/.test(storeCss4));
check('... and it rides --mo, so "no motion" stops it dead like everything else',
  /animation:cost-flap calc\(\.26s \* var\(--mo\)\)/.test(storeCss4));

const costCls = sCost().className;
w.STORE.addCart(0);
check('a repaint that changes nothing does not re-flash', sCost().className === costCls);
check('the widget stops drawing the price it handed to the band, and keeps the bar',
  /\.ns-store \.cw\.pinned \.cw-total\{display:none\}/.test(storeCss4) &&
  !/\.cw\.pinned \.cw-bar\{display:none\}/.test(storeCss4) &&
  !!$('.ns-store #cw-fill'));
check('... and it locks flush rather than tucking its own top border out of sight',
  /\.ns-store \.cw\.pinned\{position:sticky;top:0;/.test(storeCss4) &&
  !/\.cw\.pinned\{position:sticky;top:calc\(-1 \* var\(--bw\)\)/.test(storeCss4));
w.STORE.togglePin();
check('unpinning takes the cost back out of the band and gives the widget its number back',
  sCost().classList.contains('hidden') && !$('.ns-store #cw').classList.contains('pinned'));

/* -- More fonts, and a dial for the sticky sub-screen title -- */
check('there are more faces to choose from, and the range is wider rather than just longer',
  w.Prefs.DISPLAY_FONTS.length >= 14 && w.Prefs.MONO_FONTS.length >= 8 &&
  ['playfair','oswald','nunito'].every(id => w.Prefs.DISPLAY_FONTS.some(f => f.id === id)) &&
  ['courier','sourcemono'].every(id => w.Prefs.MONO_FONTS.some(f => f.id === id)),
  w.Prefs.DISPLAY_FONTS.length + ' display, ' + w.Prefs.MONO_FONTS.length + ' mono');
check('... and every new one names the weights the titles actually render',
  w.Prefs.DISPLAY_FONTS.every(f => !f.google || /wght@|Bebas|DM\+Serif/.test(f.google)));
check('the sticky sub-screen title has a size dial of its own, separate from the wordmark',
  w.Prefs.get('hdTitleSize') === 'm' && d.documentElement.dataset.hdTitle === 'm' &&
  w.Prefs.SCHEMA.hdTitleSize.values.join(',') === 'xs,s,m,l,xl');
check('... every sticky header measures from it instead of the literal 15px it had',
  ['do','learn','log','plan','settings','store'].every(f => {
    const css = fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8');
    return /\.hd-title\{font:800 var\(--hd-title-px\)\/1 var\(--head\)/.test(css) &&
           !/\.hd-title\{font:800 15px/.test(css);
  }));
check('... and the bar grows with it, rather than cramming a bigger word into the same box',
  ['do','learn','log','plan','settings','store'].every(f =>
    /padding:calc\(var\(--hd-pad\) \+ var\(--sat\)\) 18px var\(--hd-pad\)/.test(
      fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))) &&
  /--hd-pad:calc\(var\(--hd-title-px\) \* \.93\)/.test(tokensCss4));
w.Prefs.set('hdTitleSize', 'xl');
check('... and moving it claims the root, like every other enumerated dial',
  d.documentElement.dataset.hdTitle === 'xl');
w.Prefs.set('hdTitleSize', 'm');
w.SET.panel('layout');
check('both size dials are on the layout panel, findable by name',
  !!$('.ns-set [data-pref="hdTitleSize"]') &&
  w.SET.searchIndex().some(r => /sub-screen title size/i.test(r.title)));
check('... and the appearance reset knows about the new one',
  /'titleSize','hdTitleSize'/.test(fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8')));

/* ── 2.25.1: the status bar goes back to iOS ──
   `black-translucent` hands the page the whole screen, status bar included, and
   lets iOS draw its own material over that strip — so everything the band put
   up there sat under something the page does not control. Three CSS-side causes
   were found and fixed across 2.24.0-2.25.0 and none of them was it. */
const headHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').slice(0, 4000);
check('the page no longer asks to run underneath the status bar',
  /name="apple-mobile-web-app-status-bar-style" content="black"/.test(headHtml) &&
  !/content="black-translucent"/.test(headHtml),
  (headHtml.match(/apple-mobile-web-app-status-bar-style[^>]*/) || ['missing'])[0]);
check('… while the bottom inset is still claimed, for the home indicator',
  /viewport-fit=cover/.test(headHtml) &&
  /env\(safe-area-inset-bottom\)/.test(tokensCss4));
check('… and every header still measures from env(), so either value works unchanged',
  /--sat:env\(safe-area-inset-top\)/.test(tokensCss4) &&
  /padding:calc\(var\(--sat\) \+ 14px\)/.test(shellCss4));
check('… the three earlier fixes are all kept — each was a real defect',
  /--title-px:round\(/.test(tokensCss4) && /--sat:round\(up,/.test(tokensCss4) &&
  ALL_SHEETS.every(f => !/-webkit-overflow-scrolling\s*:\s*touch/.test(sheetRules(f))));

/* ── 2.25.2: the blur was the contrast, not the rendering ──
   --mu is #4a4a4a on #0e0e0e — about 2.1:1, under half the minimum for body
   text. It is the placeholder colour and the band's date line was using it as a
   label colour at 10px, bold, uppercase, letter-spaced. Small text at 2:1 reads
   as out of focus, not as faint, which is why four rendering fixes each changed
   nothing. */
const BAND_SHEETS = ['do','log','plan','store','tend','track','learn','cal','settings'];
check('no title band draws its label row in placeholder grey',
  BAND_SHEETS.every(f => {
    const css = sheetRules(f);
    const rows = css.match(/\.h-(label|meta)\{[^}]*\}/g) || [];
    return rows.every(r => !/var\(--mu\)/.test(r));
  }),
  BAND_SHEETS.filter(f => (sheetRules(f).match(/\.h-(label|meta)\{[^}]*\}/g) || [])
    .some(r => /var\(--mu\)/.test(r))).join(','));
check('… they take the secondary foreground, which is what a label is',
  BAND_SHEETS.every(f => {
    const rows = sheetRules(f).match(/\.h-(label|meta)\{[^}]*\}/g) || [];
    return rows.length === 0 || rows.some(r => /color:var\(--tx-2\)/.test(r));
  }));
check('… and so do the actions sitting in the same band',
  !/\.ns-do \.h-act\{[^}]*color:var\(--mu\)/.test(sheetRules('do')) &&
  !/\.ns-log \.h-arr\{[^}]*color:var\(--mu\)/.test(sheetRules('log')) &&
  !/\.ns-tend \.h-act\{[^}]*color:var\(--mu\)/.test(sheetRules('tend')));
check('… --mu itself is unchanged: it is still the placeholder colour, and now says so',
  /--mu:#4a4a4a/.test(tokensCss4) &&
  /never a label, see above/.test(tokensCss4));
/* Every earlier fix stays: each was a real defect on its own terms. */
check('… and none of the four earlier fixes was reverted to get here',
  /--title-px:round\(/.test(tokensCss4) && /--sat:round\(up,/.test(tokensCss4) &&
  ALL_SHEETS.every(f => !/-webkit-overflow-scrolling\s*:\s*touch/.test(sheetRules(f))) &&
  /content="black"/.test(headHtml));

/* == 2.26 ==================================================================== */

/* -- The blur, finally: it was `zoom` --
   Document zoom multiplies every length by a fraction, so at any scale but 1
   the app's whole-pixel type (8, 9.5, 10, 11.5, 15, 54) became fractional and
   every glyph was resampled rather than drawn. Smallest type worst - which is
   why it showed on the band's 10px date line and not the 54px wordmark beside
   it, and why four correct rendering fixes each changed nothing. */
const tokensRaw = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
check('the root is no longer zoomed, at any scale',
  !/zoom\s*:/.test(sheetRules('tokens')) && !/--ui-scale/.test(sheetRules('tokens')),
  (sheetRules('tokens').match(/zoom[^;]*/g) || []).join(' '));
check('... the dial is gone rather than tuned - no arrangement of steps is sharp',
  !('uiScale' in w.Prefs.SCHEMA) && !d.querySelector('.ns-set [data-pref="uiScale"]') &&
  !/'uiScale'/.test(fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8')));
check('... and what it was for is covered by dials that are whole-pixel by construction',
  ['density','titleSize','hdTitleSize'].every(k => k in w.Prefs.SCHEMA));
check('... tokens.css says why, so nobody re-adds it',
  /There is no `zoom` here any more/.test(tokensRaw));

/* -- The shadow, shared -- */
/* .055em is 2.97px on the 54px wordmark but 0.825px on a 15px sticky title, and
   a glyph copied less than a pixel sideways is a smear, not a shadow — it reads
   as blurred text, which is what 2.26.0 did to every sticky title. */
/* 3.0.1 — the one that mattered. `--title-sh` composed the offset and the
   colour at :root, and a custom property's own var()s are substituted where it
   is *declared*: the colour was baked there and inherited down as a finished
   value, so every --title-sh-c override in the app was a no-op. Lengths are the
   opposite — they stay lazy and resolve against whoever uses them — which is why
   the offset was correctly 3px on the wordmark and 1px on the currency mark
   while the colour was the accent on both. That split is what made it look like
   it worked for five versions. Composed at the point of use now. */
check('the title shadow is composed where it is used, never pre-baked in a token',
  !/--title-sh:/.test(tokensCss4) &&
  /--title-sh-c:/.test(tokensCss4) && /--title-sh-x:/.test(tokensCss4));
check('... and nothing anywhere still reaches for the token that baked its colour',
  ['tokens','shell','settings','do','log','plan','store','tend','track','learn','cal','create','themes']
    .every(f => !/var\(--title-sh\)/.test(
      fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))),
  ['tokens','shell','settings','do','log','plan','store','tend','track','learn','cal','create','themes']
    .filter(f => /var\(--title-sh\)/.test(
      fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))).join(','));
check('... its offset is a whole pixel at every size, with a 1px floor and a fallback',
  /--title-sh-x:max\(1px, round\(\.055em, 1px\)\)/.test(tokensCss4) &&
  /--title-sh-x:1px;/.test(tokensCss4));
/* a shadow needs room: .h-daynum has to clip, so it reserves exactly the offset
   on its right or the shadow is the part that gets cut off */
check('... and the offset is nameable, so anything that clips can reserve it',
  /\.view > \.h-top \.h-daynum\{[\s\S]*?min-width:calc\(1\.1em \+ var\(--title-sh-x\)\)/.test(shellCss4) &&
  /\.view > \.h-top \.h-daynum span\{position:absolute;right:var\(--title-sh-x\)/.test(shellCss4));
/* The dot is the word: title text colour, accent shadow, exactly like the
   letters. 2.26.2 and 3.0 both tried to make it the inverse and the second
   attempt succeeded at applying an effect nobody asked for. There is no rule
   for it now in any sheet — it inherits both — and that is the assertion. */
check('... the dot after a wordmark is the word: title colour, accent shadow, no rule of its own',
  !/\.h-logo em\{[^}]*color:/.test(shellCss4) &&
  !/\.h-logo em\{[^}]*--title-sh-c:/.test(shellCss4) &&
  !/\.h-logo em\{[^}]*text-shadow:/.test(shellCss4));
check('... and no app sheet paints it the accent either, or it is the inverse again',
  ['do','log','plan','store','tend','track','learn','cal','create','settings']
    .every(f => !/\.h-logo em\{[^}]*color:/.test(
      fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))),
  ['do','log','plan','store','tend','track','learn','cal','create','settings']
    .filter(f => /\.h-logo em\{[^}]*color:/.test(
      fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))).join(','));
check('... and the wordmark wears it too, not just the sub-screen titles',
  /\.view > \.h-top \.h-logo\{[\s\S]*?text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(shellCss4));
check('... every sticky sub-screen title wears it',
  ['do','learn','log','plan','settings','store'].every(f =>
    /\.hd-title\{[^}]*text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(
      fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))),
  ['do','learn','log','plan','settings','store'].filter(f =>
    !/\.hd-title\{[^}]*text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(
      fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))).join(','));
check('... and so do the big dates on LOG and DAY',
  /\.view > \.h-top \.h-daynum\{[^}]*text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(shellCss4));

/* -- LOG's caffeine counters --
   The label under a selected coffee or energy drink was rgba(167,139,250,.6) -
   VOID's violet, frozen in - so on every other preset it stayed violet while
   its own border and number had already gone to the theme's accent. */
/* the comment above the rule names the old value, so this reads the rules only */
check('a selected coffee or energy drink reads in the theme accent, not a frozen violet',
  /\.ns-log \.caf-b\.on \.cnt-l\{color:var\(--y\);opacity:\.6\}/.test(logCss4) &&
  !/rgba\(167,\s*139,\s*250/.test(sheetRules('log')),
  (sheetRules('log').match(/rgba\(167[^)]*\)/g) || []).join(' '));

/* -- DO's QUICK heading --
   `.tt-name` was declared twice in do.css: once for this fold button and once,
   later and at the same specificity, for a task row's name (12.5px mono in the
   foreground). The row's rule won, so QUICK's heading had been set in a task
   row's font while BLOCKS, TODAY and MEDIA used the head's own 10px accent
   caps. The two names had nothing to do with each other. */
check('QUICK\'s heading is a class of its own, not one shared with a task row name',
  (sheetRules('do').match(/\.ns-do \.tt-name\{/g) || []).length === 1 &&
  /\.ns-do \.tt-fold\{[^}]*font:inherit/.test(sheetRules('do')),
  (sheetRules('do').match(/\.ns-do \.tt-name\{/g) || []).length + ' declarations of .tt-name');
check('... so it inherits the section head\'s type, like every other section title',
  /\.ns-do \.tt-fold\{[^}]*color:inherit[^}]*letter-spacing:inherit[^}]*text-transform:inherit/.test(sheetRules('do')));
check('... and no section head carries a text-shadow — the shadow is the band\'s, not the body\'s',
  !/\.ns-do \.tt-head\{[^}]*text-shadow/.test(sheetRules('do')) &&
  !/\.ns-do \.tt-fold\{[^}]*text-shadow/.test(sheetRules('do')));

/* ── 3.0 · CREATE — the tenth app ────────────────────────────────────────────
   Songs on stages, each stage's own checklist, and the hours at the desk. What
   is asserted here is the part that is easy to get wrong later: that the whole
   app is built from Config rather than from lists in the module, that a tick is
   filed under something a reorder cannot move, and that a deleted stage or a
   deleted song leaves nothing dangling. */
w.Shell.go('create');
await tick();
check('CREATE is the tenth app, wired everywhere an app has to be wired',
  !!w.CREATE && w.Shell.TABS.includes('create') && !!$('#view-create') &&
  !!$('.tab-b[data-app="create"]') && !!$('.ns-set .set-panel[data-panel="create"]') &&
  w.Prefs.APPS.includes('create'),
  w.Shell.TABS.join(','));
check('an empty shelf says so rather than drawing nothing',
  !w.CREATE.songs().length && !!$('.ns-create .cr-empty'),
  $('.ns-create #cr-list').textContent.trim().slice(0, 40));

// a song is started through the app's own dialog, never the platform's
click($('.ns-create .cr-add'));
check('starting a song asks in the app, with a field',
  askOpen() && !$('#ask-field').classList.contains('hidden'));
$('#ask-input').value = 'night bus';
click($('#ask-yes'));
await tick();
check('... and lands on that song, on the first stage',
  w.CREATE.songs().length === 1 && $('.ns-create #s-song').classList.contains('on') &&
  $('.ns-create #cr-song-title').textContent === 'night bus' &&
  w.CREATE.songs()[0].stage === w.CREATE.stages()[0].key,
  w.CREATE.songs()[0] && w.CREATE.songs()[0].stage);
const crItems = () => [...d.querySelectorAll('.ns-create .cr-item')];
const crSong  = () => w.CREATE.songs()[0];
check("the checklist on screen is the stage's, out of Config, not a list in the module",
  crItems().length > 0 && crItems().length === w.Config.get('create.stages')[0].items.length,
  crItems().length + ' rows');

// a tick is filed under stage|item, which is what survives a reorder
click(crItems()[1]);
const crStageKey   = w.Config.get('create.stages')[0].key;
const crItemTwo = w.Config.get('create.stages')[0].items[1];
check("a tick is filed under the stage and the item's own text",
  !!crSong().done[crStageKey + '|' + crItemTwo] && crItems()[1].classList.contains('on'),
  Object.keys(crSong().done).join(','));
const stagesWas = JSON.parse(JSON.stringify(w.Config.get('create.stages')));
const reordered = JSON.parse(JSON.stringify(stagesWas));
reordered[0].items = reordered[0].items.slice().reverse();
w.Config.set('create.stages', reordered);
check('... so reordering a checklist keeps every tick',
  !!crSong().done[crStageKey + '|' + crItemTwo] &&
  crItems().filter(el => el.classList.contains('on')).length === 1,
  Object.keys(crSong().done).join(','));
w.Config.set('create.stages', stagesWas);

// the stages are a path, and moving along it changes what is asked
const crSteps = () => [...d.querySelectorAll('.ns-create .cr-step')];
check('every stage is offered as a step, the current one lit',
  crSteps().length === w.CREATE.stages().length && crSteps()[0].classList.contains('on'),
  crSteps().length + ' steps');
click(crSteps()[3]);
check('moving a song changes the stage and the checklist under it',
  crSong().stage === w.CREATE.stages()[3].key &&
  crItems().length === w.CREATE.stages()[3].items.length,
  crSong().stage + ' / ' + crItems().length);
check('... and the tick left behind on the earlier stage is still filed',
  !!crSong().done[crStageKey + '|' + crItemTwo]);

// a session is hours at the desk, and the shelf counts them
const typeIn = (sel, v) => { const el = $(sel); el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true })); };
typeIn('.ns-create #cr-hours', '1.5');
typeIn('.ns-create #cr-what', 'drums');
click($('.ns-create .cr-go'));
check('a session is logged against the song, dated today',
  w.CREATE.sessions().length === 1 && w.CREATE.sessions()[0].hours === 1.5 &&
  w.CREATE.sessions()[0].date === today && w.CREATE.sessions()[0].what === 'drums',
  JSON.stringify(w.CREATE.sessions()[0]));
check('... and the form is emptied rather than left holding the last one',
  $('.ns-create #cr-hours').value === '');
w.CREATE.go('home');
check("the shelf reads the week's hours off the log",
  /1h30/.test($('.ns-create #cr-week').textContent),
  $('.ns-create #cr-week').textContent.replace(/\s+/g, ' ').trim().slice(0, 70));
check('a song in flight is drawn with its stage and its progress',
  d.querySelectorAll('.ns-create .cr-song').length === 1 &&
  !!$('.ns-create .cr-song .cr-prog'));

// built from Config: a stage added in the editor needs no code and no CSS
const withExtra = JSON.parse(JSON.stringify(stagesWas));
withExtra.splice(1, 0, { key: 'stage_x', label: 'sound design', color: '#8888ff', items: ['a patch'] });
w.Config.set('create.stages', withExtra);
check('a stage added in the editor reaches the stepper with no code change',
  w.CREATE.stages().length === stagesWas.length + 1 && w.CREATE.stages()[1].key === 'stage_x',
  w.CREATE.stages().map(x => x.key).join(','));
// a stage deleted from under a song falls back rather than throwing
w.Config.set('create.stages', stagesWas.slice(0, 2));
errors.length = 0;
w.CREATE.go('home');
check('a song on a stage the editor deleted falls back, and nothing throws',
  errors.length === 0 && !!$('.ns-create .cr-song'), errors.slice(0, 2).join(' | '));
w.Config.set('create.stages', stagesWas);

// the songs are not in Config, so search reaches them through the module's hook
check("search finds a song by name, through the module's own hook",
  w.SEARCH.results('night').some(r => r.title === 'night bus'),
  w.SEARCH.results('night').map(r => r.title).join(','));

// the finished stage is found by `terminal`, never by its key or its position
w.CREATE.open(crSong().id);
click(crSteps()[crSteps().length - 1]);
w.CREATE.go('home');
check('a song on the finished stage leaves the shelf for "released"',
  !d.querySelector('.ns-create .cr-song') && !!$('.ns-create .cr-fold'),
  $('.ns-create #cr-released').textContent.replace(/\s+/g, ' ').trim().slice(0, 40));

// deleting a song asks first, and takes its sessions with it
w.CREATE.open(crSong().id);
click($('.ns-create .cr-act.danger'));
check('deleting a song asks in the app and says what goes with it',
  askOpen() && /night bus/.test($('#ask-title').textContent) && /1 session/.test($('#ask-body').textContent),
  $('#ask-title').textContent + ' | ' + $('#ask-body').textContent);
settle(true);
check('... and its sessions go with it, so nothing is left pointing at nothing',
  !w.CREATE.songs().length && !w.CREATE.sessions().length,
  w.CREATE.songs().length + ' songs / ' + w.CREATE.sessions().length + ' sessions');
check('CREATE keeps its own storage key', !!w.localStorage.getItem('create_v1'));

// the content editors, at the end of CREATE's own panel like every other app's
w.SET.panel('create');
check("CREATE's stage editor lives at the end of its own panel",
  !!$('.ns-set [data-content-for="create"] [data-group="create.stages"]') &&
  !!$('.ns-set [data-content-for="create"] input[data-cfg="create.sessionKinds"]') &&
  d.querySelectorAll('.ns-set [data-group="create.stages"] .ed-card').length === w.CREATE.stages().length,
  d.querySelectorAll('.ns-set [data-group="create.stages"] .ed-card').length + ' cards');
const stageKeysWere = w.CREATE.stages().map(x => x.key).join(',');
click($('.ns-set [data-group="create.stages"] .ed-add'));
check('a stage is added in front of the finished one, never after it',
  w.CREATE.stages().length === stagesWas.length + 1 &&
  w.CREATE.stages()[w.CREATE.stages().length - 1].terminal === true,
  w.CREATE.stages().map(x => x.key).join(','));
click(d.querySelectorAll('.ns-set [data-group="create.stages"] .ed-del')[w.CREATE.stages().length - 1]);
check('... and deleting the finished stage leaves the last one finished, or the shelf has no end',
  w.CREATE.stages().some(x => x.terminal),
  w.CREATE.stages().map(x => x.key + (x.terminal ? '*' : '')).join(','));
w.Config.reset('create.stages');
check('reset puts the shipped stages back',
  w.CREATE.stages().map(x => x.key).join(',') === stageKeysWere,
  w.CREATE.stages().map(x => x.key).join(','));

const createCss = fs.readFileSync(path.join(ROOT, 'css/create.css'), 'utf8');
const createJs  = fs.readFileSync(path.join(ROOT, 'js/create.js'), 'utf8');
check('a stage colour is one rule and a variable, not one rule per stage',
  /--st-c/.test(createCss) && !/#a78bfa/i.test(createCss),
  (createCss.match(/--st-c/g) || []).length + ' uses');
check("CREATE's two sideways scrollers claim the gesture, or they are dead under a finger",
  /\.ns-create \.cr-steps\{[^}]*touch-action:pan-x pan-y/.test(createCss) &&
  /\.ns-create \.cr-sorts\{[^}]*touch-action:pan-x pan-y/.test(createCss));
check('CREATE has no network at all — a song is not a task',
  !/fetch\s*\(|todoist\.com|XMLHttpRequest|navigator\.sendBeacon/i.test(createJs));

/* ── 3.0.3 · the bands centre on their ink ───────────────────────────────────
   A wordmark is all caps, and caps in a line-height:1 box leave the descender
   space empty underneath — 8.5px of a 54px box, measured in Chrome. The band had
   no slack to redistribute (14 + 82 + 12 was exactly its 108px floor), so all of
   it read as a gap under the title. jsdom has no layout, so what is asserted
   here is the rule; the measurement is in the update log. */
const shellCss5 = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
const tokensCss5 = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
const storeCss5 = fs.readFileSync(path.join(ROOT, 'css/store.css'), 'utf8');
check('the band centres its content rather than piling the slack at one end',
  /\.view > \.h-top\{[^}]*justify-content:center/.test(shellCss5) &&
  !/\.view > \.h-top\{[^}]*justify-content:flex-end/.test(shellCss5));
check('... and the titles are trimmed to their caps, so what is centred is the ink',
  /\.view > \.h-top \.h-logo\{[^}]*text-box:trim-both cap alphabetic/.test(shellCss5) &&
  /\.view \.scr \.hd-title\{text-box:trim-both cap alphabetic\}/.test(shellCss5) &&
  /\.ns-store \.h-cost\{[^}]*text-box:trim-both cap alphabetic/.test(storeCss5));
check('... the cap height is a measured token, not a literal in three sheets',
  /--title-cap:\.65/.test(tokensCss5) &&
  !/text-box[^;]*;[\s\S]{0,40}0\.65/.test(shellCss5));
/* One band shape for every app is what makes the title morph read as one title
   being pushed along. Trimming the wordmark to 35px made DO's 40px tab strip the
   tallest thing in its row for the first time, which made its band 2px taller
   than the other nine. The row is declared now, for everyone. */
check('every band shares one row height, so no app can be the odd one out',
  /--band-row:40px/.test(tokensCss5) &&
  /\.view > \.h-top > \.h-logo-row\{[^}]*min-height:max\(var\(--band-row\), calc\(var\(--title-px\) \* var\(--title-cap\)\)\)/.test(shellCss5) &&
  /min-height:calc\(var\(--sat\) \+ 54px \+ max\(var\(--band-row\)/.test(shellCss5));
check("... and DO's tab strip is declared rather than padding-derived, as §6 asks",
  /\.ns-do > \.h-top \.tabs\{height:var\(--band-row\)/.test(fs.readFileSync(path.join(ROOT, 'css/do.css'), 'utf8')));
/* The gap under the band is the shell's and an app must not add to it. STORE's
   .cnt was padding all four sides, so the home screen had 18 + 18 between the
   wordmark and the counter widget — the gap that started this. */
check("the gap under the band is the shell's alone, on every app's home",
  /\.ns-store #s-home > \.cnt\{padding-top:0\}/.test(storeCss5) &&
  ['tend','track','cal','create'].every(f =>
    /\.ns-\w+ \.cnt\{padding:0 /.test(fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))),
  ['tend','track','cal','create'].filter(f =>
    !/\.ns-\w+ \.cnt\{padding:0 /.test(fs.readFileSync(path.join(ROOT, 'css/' + f + '.css'), 'utf8'))).join(','));
/* The counter is a title too: it sits on the wordmark's row and should be
   pushed along with it rather than appearing where the last one left. */
check('the pinned total slides with the titles, both ways',
  /\.view\.morph > \.h-top \.h-daynum,\.view\.morph > \.h-top \.h-cost\{/.test(shellCss5) &&
  /\.view\.leaving > \.h-top \.h-daynum,\.view\.leaving > \.h-top \.h-cost\{/.test(shellCss5));
check('... and reduced motion takes it off with the rest of the morph',
  /\.view\.morph > \.h-top \.h-cost,\.view\.leaving > \.h-top \.h-cost\{animation:none\}/.test(shellCss5));

/* ── 3.0.4 · trimmed boxes must not be clipped on both axes ──────────────────
   3.0.3 trimmed these boxes to their cap height for layout, but their children
   still lay out in full line boxes — so `overflow:hidden`, which clips both
   axes, cut 9.4px off the top of the day number and 10px off the bottom of the
   counter. Measured in Chrome. The clip these actually wanted is horizontal:
   the sliding is sideways, and nothing about it needs a vertical cut. */
const calCss6 = fs.readFileSync(path.join(ROOT, 'css/cal.css'), 'utf8');
const shellCss6 = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
const storeCss6 = fs.readFileSync(path.join(ROOT, 'css/store.css'), 'utf8');
check('the day number clips sideways only, so its digits are not cut top and bottom',
  /\.view > \.h-top \.h-daynum\{[^}]*overflow:visible;clip-path:inset\(-100% 0\)/.test(shellCss6) &&
  !/\.view > \.h-top \.h-daynum\{[^}]*overflow:hidden/.test(shellCss6));
check('... and so does the counter, which still cannot run into the wordmark',
  /\.ns-store \.h-cost\{[^}]*overflow:visible;clip-path:inset\(-100% 0\)/.test(storeCss6) &&
  /flex:0 1 auto;min-width:0;overflow:visible/.test(storeCss6) &&
  !/flex:0 1 auto;min-width:0;overflow:hidden/.test(storeCss6));

/* ── 3.0.4 · what was finished, and when ────────────────────────────────────
   Every other thing on DAY is the day as planned. A mark is the day as it
   happened: a completion puts a dot on the calendar at the minute it was
   ticked, whoever ticked it. */
w.Shell.go('cal');
/* a day with two rows that can be ticked, bracketing the current hour so the
   mark has somewhere on the drawing to land */
const mkH = h => String(Math.max(0, Math.min(22, new w.Date().getHours() - 1)) + h).padStart(2, '0') + ':00';
w.CAL.write({ day: today, start: mkH(0), template: 'normal', mode: 'blocks', notes: [],
  events: [
    { from: mkH(0), to: mkH(1), dur: 60, kind: 'task', name: 'mix the intro', slot: 'b1a', color: '#fff' },
    { from: mkH(1), to: mkH(2), dur: 60, kind: 'fixed', name: 'routine', cal: 'home' },
  ] });
w.CAL.pick(today);
const marks = () => w.CAL.marks(today);
const markEls = () => [...d.querySelectorAll('.ns-cal .cal-mark')];
const evBtn = () => d.querySelector('.ns-cal .cal-ev[data-act="tick"]');
const before = marks().length;
click(evBtn());
check('ticking a row on DAY leaves a mark at the time it was ticked',
  marks().length === before + 1 && /^\d\d:\d\d$/.test(marks()[marks().length - 1].at),
  JSON.stringify(marks()));
check('... and the mark is drawn on the day, small, over the rows',
  markEls().length >= 1 &&
  /--mark-y:/.test(markEls()[0].getAttribute('style') || '') &&
  /\.ns-cal \.cal-mark\{[^}]*pointer-events:none/.test(calCss6),
  markEls().length + ' marks drawn');
click(evBtn());
check('unticking takes its mark back', marks().length === before, JSON.stringify(marks()));

/* DO's ticks are completions too, and they are the ones that mostly happen. */
w.CAL.markDone('a job from do', true);
check("anything that finishes a task can leave one — DO calls it on both its lists",
  marks().some(m => m.name === 'a job from do') &&
  /CAL\.markDone\(task\.content, task\.done\)/.test(fs.readFileSync(path.join(ROOT, 'js/do.js'), 'utf8')) &&
  (fs.readFileSync(path.join(ROOT, 'js/do.js'), 'utf8').match(/CAL\.markDone\(/g) || []).length === 4,
  (fs.readFileSync(path.join(ROOT, 'js/do.js'), 'utf8').match(/CAL\.markDone\(/g) || []).length + ' call sites');
w.CAL.markDone('a job from do', false);
check('... and taking it back removes exactly one, not every mark of that name',
  !marks().some(m => m.name === 'a job from do'), JSON.stringify(marks()));
/* A mark is a fact about the afternoon, not a claim about what was sent. */
check('marks are kept beside the days, not inside one that claims to be the plan',
  /"marks"/.test(w.localStorage.getItem('cal_days_v1') || '{}') ||
  !/marks/.test(JSON.stringify(w.CAL.day(today) || {})),
  'marks are not written into the day record');
check('only today can take a mark — a completion has a clock time because it is now',
  /sel !== Shell\.today\(\)/.test(fs.readFileSync(path.join(ROOT, 'js/cal.js'), 'utf8')));

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
  w2.Prefs.get('apps').join(',') === 'do,log,track,cal,create', w2.Prefs.get('apps').join(','));
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

/* 2.26.0 folded a stored Interface scale into Spacing, which was the same defect
   moved to another multiplier: --dens multiplies every padding, so 1.1 turns an
   18px pad into 19.8px and puts the text below it on a fractional baseline. The
   scale is dropped now, and an install that was folded is repaired once. */
const w4 = await bootWith({ uiScale: 1.2, density: 1.2, theme: 'void' });
check('a stored Interface scale is dropped, not folded into Spacing',
  w4.Prefs.get('uiScale') === undefined && w4.Prefs.get('density') === w4.Prefs.SCHEMA.density.def,
  w4.Prefs.get('density') + ' / ' + w4.Prefs.get('uiScale'));
check('... the repair is recorded, so it runs once and not on every boot',
  w4.Prefs.get('densRepair') === true &&
  JSON.parse(w4.localStorage.getItem('root_prefs_v1')).densRepair === true &&
  JSON.parse(w4.localStorage.getItem('root_prefs_v1')).uiScale === undefined);
const w5 = await bootWith({ density: 1.25, densRepair: true, theme: 'void' });
check('... and a Spacing chosen after the repair is left alone',
  Math.abs(w5.Prefs.get('density') - 1.25) < 1e-9, String(w5.Prefs.get('density')));
check('... with no control for the repair flag — it is a record, not a setting',
  !w5.document.querySelector('.ns-set [data-pref="densRepair"]'));

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
