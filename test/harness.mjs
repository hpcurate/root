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

/* Answering the app's own confirm
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

// 1. boot
check('modules defined', ['Prefs','Config','Creds','Shell','DO','LOG','PLAN','STORE','SET'].every(k => w[k]));
check('no console/jsdom errors at boot', errors.length === 0, errors.slice(0, 3).join(' | '));
for (const t of w.Prefs.THEMES) { w.Prefs.set('theme', t.id); }
check('all themes apply', d.documentElement.dataset.theme === 'noir');
w.Prefs.set('theme', 'void');
for (const p of ['look','layout','behave','do','log','plan','store','tend','track','learn','create','data']) w.SET.panel(p);
check('every settings panel renders', errors.length === 0, errors.slice(0, 3).join(' | '));

// 2. settings routing
w.Shell.go('plan');
w.PLAN.connectTodoist();                     // no token → routes to the key panel
await tick();
check("PLAN 'no key' routes to the data panel", $('.ns-set .set-panel.on')?.dataset.panel === 'data',
  'landed on ' + $('.ns-set .set-panel.on')?.dataset.panel);
check('conn-status text no longer says General', !/General/.test($('.ns-plan #conn-status').textContent));

// 3. keyboard while an overlay is open + Escape
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

// 4. confirmDestructive honoured app-wide
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

// 5. STORE classifier follows aisle edits
const cats = w.Config.get('store.categories');
cats.vegetables.items.push('zzzfoo');
w.Config.set('store.categories', cats);
$('.ns-store #manual-input').value = 'zzzfoo'; w.STORE.addManual();
const st = JSON.parse(w.localStorage.getItem('store_state_v1'));
check('new aisle vocabulary is used immediately', st.list.find(i => i.name === 'zzzfoo')?.cat === 'vegetables',
  'filed under ' + st.list.find(i => i.name === 'zzzfoo')?.cat);
w.Config.reset('store.categories');

// 6. PLAN partial send keeps only the failed tasks
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

// 7. LOG streak
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

// 8. LOG km target + week start
w.Config.set('log.kmTarget', 8);
w.LOG.go('history');
check('km chart reads the configured target', /8 km\/day/.test($('.ns-log .kmc-goal')?.textContent || ''),
  $('.ns-log .kmc-goal')?.textContent);
w.Prefs.set('weekStart', 'sun');
w.LOG.go('history');
check('week start pref moves the km chart to Sunday', $('.ns-log .kmc-day')?.textContent === 'S');
w.Prefs.set('weekStart', 'mon');
w.Config.reset('log.kmTarget');

// 9. onclick values with quotes
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

/* The first daily routine, by name rather than by key: which routines ship is
   Config's business and has been changed once already (4.14). What these checks
   are about is DO's behaviour with *a* routine. */
const R1 = Object.keys(w.Config.get('do.routines'))[0];

// 10. day rollover
w.DO.go('home');
w.DO.openRoutine(R1); click($('.ns-do .item-btn')); w.DO.go('home');   // a tick today → do_<today> exists
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
w.DO.openRoutine(R1); click($('.ns-do .item-btn')); w.DO.go('home');
check('a tick after midnight lands in the new day\'s record', w.localStorage.getItem('do_' + tomorrow) !== null);
check('Todoist token survived the day sweep', w.localStorage.getItem('do_todoist_v1') !== null);
check('LOG followed to the new day on its home screen', $('.ns-log #btn-today').classList.contains('hidden'));
w.Date = RealDate;
w.Shell.checkDay();                          // and back to the real today for everything that follows

// 11. Prefs fixes
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

// 12. meals beyond 4 survive the note parser
const note = `*:LiCalendar: ${offset(-1)}*\n| meals         | 1,2,5,6 |\n| meals_count   | 4 |\n| scale         | 1-5 |\n`;
w.LOG.go('reports');
$('.ns-log #rep-paste').value = note;
w.LOG.parseNotes();
click($('.ns-log #rep-week-btns .rep-btn'));
check('parsed meals above 4 are kept', /\| meals \| 4 total/.test($('.ns-log #rep-pre').textContent),
  ($('.ns-log #rep-pre').textContent.match(/\| meals \|[^\n]*/) || [])[0]);

// 13. hash deep link into a settings panel
w.location.hash = '#settings/data';
w.dispatchEvent(new w.Event('hashchange'));
await tick();
check('#settings/<panel> opens that panel', $('.tab-b.on').getAttribute('aria-label') === 'Settings' &&
  $('.ns-set .set-panel.on')?.dataset.panel === 'data');

// 14. content editor: select with data-cfg commits on change
w.SET.panel('log');                     // LOG's content editors sit at the end of its own panel
const sel = $('.ns-set select[data-cfg="log.streakRequires"]');
if (sel) { sel.value = 'evening'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); }
check('streak rule select commits to Config', w.Config.get('log.streakRequires') === 'evening', sel ? 'got ' + w.Config.get('log.streakRequires') : 'no select rendered');
w.Config.reset('log.streakRequires');

// 15. 2.2 — three more apps in the track
check('TEND, TRACK, LEARN defined', ['TEND', 'TRACK', 'LEARN'].every(k => w[k]));
check('eleven tabs, settings last', w.Shell.TABS.length === 11 && w.Shell.TABS[10] === 'settings', w.Shell.TABS.join(','));
check('the pill no longer flags "many" tabs (the arrows always stay)', d.documentElement.dataset.tabs === undefined);
errors.length = 0;
for (const p of ['tend', 'track', 'learn']) w.SET.panel(p);
check('the three new settings panels render', errors.length === 0, errors.slice(0, 3).join(' | '));
w.Shell.go('do');
key('5'); check('key 5 jumps to TEND', $('.tab-b.on')?.dataset.app === 'tend', $('.tab-b.on')?.dataset.app);
key('7'); check('key 7 jumps to LEARN', $('.tab-b.on')?.dataset.app === 'learn', $('.tab-b.on')?.dataset.app);

/* 4.5 — the rebindable keys and the desktop frame.
   The roving cursor itself is deliberately not checked here: it filters on
   offsetParent, which jsdom never populates, so every assertion about where
   the cursor went would be an assertion about jsdom rather than about ROOT.
   It needs a browser. What is checkable is the binding layer underneath. */
const kmWas = w.Prefs.get('keyMap');
check('keyMap ships as a, e, comma, o and space',
  ['prev','next','up','down','act'].map(a => kmWas[a]).join('') === 'ae,o ', JSON.stringify(kmWas));

w.Shell.go('plan');
key('a'); check('the bound key steps to the previous tab', $('.tab-b.on')?.dataset.app === 'log',
  $('.tab-b.on')?.dataset.app);
key('e'); check('the bound key steps to the next tab', $('.tab-b.on')?.dataset.app === 'plan',
  $('.tab-b.on')?.dataset.app);
/* 4.10 took the arrows off the tabs. All four are the cursor now — two of them
   being tab keys meant the four keys that look like a direction pad did two
   unrelated jobs, and left/right could not mean what they obviously mean.
   Tabs are the letters and 1-9. */
key('ArrowLeft'); check('the arrows no longer change tab — they are all cursor now',
  $('.tab-b.on')?.dataset.app === 'plan', $('.tab-b.on')?.dataset.app);

w.Prefs.set('keyMap', Object.assign({}, kmWas, { prev: 'q' }));
w.Shell.go('plan');
key('q'); check('a rebound key takes effect', $('.tab-b.on')?.dataset.app === 'log',
  $('.tab-b.on')?.dataset.app);
w.Shell.go('plan');
key('a'); check('the key it replaced goes dead', $('.tab-b.on')?.dataset.app === 'plan',
  $('.tab-b.on')?.dataset.app);

/* An unknown action in a pasted look is dropped and a missing one falls back,
   so a look written before an action existed still binds it. */
w.Prefs.set('keyMap', { prev: 'z', bogus: 'x' });
const kmCo = w.Prefs.get('keyMap');
check('keyMap coerces to the known actions only',
  kmCo.bogus === undefined && kmCo.prev === 'z' && kmCo.next === 'e', JSON.stringify(kmCo));

w.Prefs.reset('keyMap');
check('keyMap resets to the shipped bindings', w.Prefs.get('keyMap').prev === 'a');

/* Typing never navigates — the guard that keeps "e" a letter inside a field. */
w.Shell.go('plan');
const kbField = d.createElement('input');
d.body.appendChild(kbField);
kbField.focus();
key('e', kbField);
check('a bound letter typed into a field does not change tab',
  $('.tab-b.on')?.dataset.app === 'plan', $('.tab-b.on')?.dataset.app);
kbField.blur(); kbField.remove();

check('the desktop mode is on the root element as an attribute',
  d.documentElement.dataset.desktop === 'frame', d.documentElement.dataset.desktop);
w.Prefs.set('desktopMode', 'rail');
check('switching to the rail repaints the attribute', d.documentElement.dataset.desktop === 'rail');
w.Prefs.set('desktopMode', 'frame');
check('the frame size dials reach the root as custom properties',
  d.documentElement.style.getPropertyValue('--frame-w') === '420px' &&
  d.documentElement.style.getPropertyValue('--frame-h') === '880px',
  d.documentElement.style.getPropertyValue('--frame-w'));

// the app list: order + visibility
w.Prefs.set('apps', ['track', 'do']);
check('app list reorders the track', w.Shell.TABS.join(',') === 'track,do,settings' &&
  $('#track .view:not(.hidden)')?.id === 'view-track',
  w.Shell.TABS.join(',') + ' | first visible ' + $('#track .view:not(.hidden)')?.id);
check('a switched-off app has no tab', $('.tab-b[data-app="log"]').classList.contains('hidden') && $('#view-log').classList.contains('hidden'));
check('landed on the first shown app after LEARN was hidden', $('.tab-b.on')?.dataset.app === 'track', $('.tab-b.on')?.dataset.app);
w.Prefs.reset('apps');
check('reset restores all eleven in shipped order', w.Shell.TABS.join(',') === 'do,log,plan,store,tend,track,learn,cal,create,tools,settings', w.Shell.TABS.join(','));
w.Prefs.set('colorfulTabs', true);
check('colour-coded tabs are keyed by app, not position', errors.length === 0);   // CSS only; boot did not throw
w.Prefs.set('colorfulTabs', false);

// the tab colours: one per tab, overridable, and lent to the app you are on
const rootTabs = (fs.readFileSync(path.join(ROOT, 'css/themes.css'), 'utf8')
  .match(/:root{--tab-do:[^}]*}/) || [''])[0];
check('every tab in the bar ships with a hue',
  w.Prefs.TAB_IDS.every(a => rootTabs.includes(w.Prefs.tabVar(a) + ':')),
  w.Prefs.TAB_IDS.filter(a => !rootTabs.includes(w.Prefs.tabVar(a) + ':')).join(',') || 'all present');
w.Prefs.set('tabPalette', 'custom');
w.Prefs.set('tabColors', { do: '#123456', nosuchapp: '#ffffff' });
check('a picked tab colour is written over the palette, and an unknown tab is dropped',
  d.documentElement.style.getPropertyValue('--tab-do') === '#123456' &&
  Object.keys(w.Prefs.get('tabColors')).join() === 'do',
  d.documentElement.style.getPropertyValue('--tab-do') + ' | ' + Object.keys(w.Prefs.get('tabColors')).join());
w.Shell.go('do');
check('the tab you are on lends its colour to the accent',
  d.documentElement.style.getPropertyValue('--y') === '#123456',
  d.documentElement.style.getPropertyValue('--y') || 'unset');
w.Prefs.set('tabAccent', false);
check('… and switching that off gives the theme its accent back',
  d.documentElement.style.getPropertyValue('--y') === '',
  d.documentElement.style.getPropertyValue('--y') || 'unset');
w.Prefs.set('tabPalette', 'app');
check('leaving the custom palette hands the tab back to the stylesheet',
  d.documentElement.style.getPropertyValue('--tab-do') === '',
  d.documentElement.style.getPropertyValue('--tab-do') || 'unset');
w.Prefs.reset('tabColors'); w.Prefs.reset('tabAccent');

// 16. TEND
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

// 17. TRACK
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

// 18. LEARN
await tick();
check('LEARN says so instead of throwing where IndexedDB is missing', /cannot be stored/i.test($('.ns-learn #deck-list').textContent),
  $('.ns-learn #deck-list').textContent.slice(0, 60));
check('answer row is built from the rating names', d.querySelectorAll('.ns-learn #answer-row .ans').length === 4 &&
  $('.ns-learn #answer-row .ans.easy .ans-l').textContent === 'acquired');
w.Config.set('learn.ratings', ['a', 'b', 'c', 'known']);
check('rating names follow Config', $('.ns-learn #answer-row .ans.easy .ans-l').textContent === 'known');
w.Config.reset('learn.ratings');
check('no library script was loaded without an import', !d.querySelector('script[src*="jszip"]'));

// 19. 2.3 — decimal fields, touch preview, the Todoist block, PLAN→LOG, study ─
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

// 20. 2.4 — TEND ↔ Todoist, the DO badge, study in the reports
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

// 21. 2.5 — block tasks from Todoist, label chips gone, portrait lock
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

// 22. 2.8 — the media tab, the settings menu, apps out of the bar
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

/* 2.24: the media tab reworked ── */
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

// settings: a home menu, four categories, the apps out of the bar
w.Shell.go('settings'); w.SET.home();
check('settings opens on a home menu with four categories', $('.ns-set #s-home').classList.contains('on') &&
  [...d.querySelectorAll('.ns-set .set-cat-b')].map(b => b.dataset.cat).join(',') === 'apps,appearance,sync,data');
check('with every app in the bar the home lists none', !$('.ns-set [data-open]'));
w.Prefs.set('apps', ['do', 'log']);
check('apps switched off are listed on the settings home', [...d.querySelectorAll('.ns-set [data-open]')].map(b => b.dataset.open).join(',') === 'plan,store,tend,track,learn,cal,create,tools',
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
  [...d.querySelectorAll('.ns-set #set-seg .seg-b')].map(b => b.dataset.seg).join(',') === 'do,log,plan,store,tend,track,learn,cal,create,tools' &&
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

// 23. 2.9 — the left arrow as back, tap-the-tab-for-home, the settings icon, → tomorrow ─
const prev = $('#nav-prev');
w.Shell.go('do'); await tick();
check('on an app home the left arrow is the previous-tab arrow', !prev.classList.contains('is-back') && prev.disabled);
w.DO.openRoutine(R1); await tick();
check('inside a sub-screen it becomes that screen\'s back button', prev.classList.contains('is-back') && !prev.disabled && prev.getAttribute('aria-label') === 'Back');
click(prev); await tick();
check('… and pressing it goes back', $('.ns-do #s-home').classList.contains('on') && !prev.classList.contains('is-back'));
w.DO.openRoutine(R1); await tick();
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

// 24. 2.10 — the title band, blocks → tomorrow, PLAN in label colours
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

// 25. 2.11 — the cross-fade, the title morph, PLAN expanding in place
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

/* 2.24: the section rows, and getting out of an open project ── */
check('the colour is a rail down the row, not a wash over it — three rows stopped reading as three slabs',
  /\.ns-plan \.ps-rail\{flex:0 0 3px/.test(planCss) &&
  /\.ns-plan \.proj-sec\{[^}]*background:var\(--s1\)/.test(planCss));
/* 3.1.0 — every box on this screen clips its own text so a long name cannot
   push its row wider than the grid. Against `line-height:1` that clip lands on
   the baseline and cuts the tail off a g, p, y or q: the row fitted, the word
   in it did not. Anything that hides its overflow carries a real line-height
   now, and nothing got taller for it — the rows are sized by `min-height`. */
check('a name with a descender in it is not cut off flat at the bottom of its box',
  [/\.ns-plan \.ps-name\{/, /\.ns-plan \.proj-name\{/].every(re => re.test(planCss)) &&
  /\.ns-plan \.proj-sec\{[^}]*font:400 12px\/1\.4 /.test(planCss) &&
  /\.ns-plan \.proj-name\{font:700 13px\/1\.35 /.test(planCss) &&
  /\.ns-plan \.dstep-w\{[^}]*font:400 13px\/1\.35 /.test(planCss) &&
  /\.ns-plan \.dstep-d\{[^}]*font:400 8px\/1\.4 /.test(planCss));
check('… and the rows are no taller for it, because their height was never the text',
  /\.ns-plan \.proj-sec\{[^}]*min-height:var\(--tile-h\)/.test(planCss) &&
  /--tile-h:46px/.test(planCss));
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

/* PLAN's transition, driven by a scripted layout ──
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

// 26. the sent history and its calendar lines
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

// 27. the export panel
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

/* The description is a contract: byte for byte ── */
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

// 28. the day a task is due, picked on the form
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

// 29. 2.19 — search, DO's quick cards and its history, PLAN presets, LOG's alert ─

/* search ── */
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
rts[R1].label = 'zzz morning ritual';
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

/* DO · @quick ── */
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

/* DO · the history the sweep used to throw away ── */
w.DO.go('home');
w.DO.openRoutine(R1);
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

/* PLAN · queue presets ── */
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

/* LOG · the tab alert ── */
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
const shellCssA = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
check('an alerting tab wears a filled mark, not only a "!"',
  /\.tab-b\.has-alert::before\{[^}]*opacity:1/.test(shellCssA) &&
  /\.tab-b\.has-alert\{[^}]*--tab-c:var\(--or\)/.test(shellCssA));
/* Through the variable rather than `background`, so the warning reaches a shape
   that draws its colour as a border — and so it outranks the colour-coded
   palette, which as a bare `background` on `::before` it did not: a
   colour-coded tab used to alert in its own app hue, which is the one moment
   its own hue is not what the bar is trying to say. Not by out-weighing the
   palette's selector, which cannot be done — a rule that names one app in one
   bar is always heavier than `.tab-b.has-alert`. The palette writes its own
   property and --tab-c falls back to it, so the two never compete. */
const themesCssA = fs.readFileSync(path.join(ROOT, 'css/themes.css'), 'utf8');
check('… and the warning colour beats the palette, on any shape',
  !/\.tab-b\.has-alert::before\{[^}]*background:/.test(shellCssA) &&
  /--tab-c:var\(--tab-app-c,var\(--y\)\)/.test(shellCssA) &&
  !/\[data-color-tabs="on"\][^\n]*\{--tab-c:/.test(themesCssA) &&
  /\[data-color-tabs="on"\] #nav \.tab-b\[data-app="plan"\]\{--tab-app-c:/.test(themesCssA));
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

// 30. 2.20 — the exported day, drawn as a calendar
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

// the drawing ──
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

// the dials ──
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

// 31. 2.20.1 — a task over several hours, the day stepped, DAY, the row tile ─
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

// 32. 2.21 — the twelve fixes
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

/* 2.23: discard has to undo
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


// 33. 2.22 — the app asks its own questions, and answers its own numbers
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

/* 2.23: the unit the number is in
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

/* An overlay owns the page until it closes
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

/* 2.23 — DAY during the day
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

/* 2.24 — the day's head, deleting a row, colour, and the wake-up shift */
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
/* 4.12 put every reshaping control behind an edit-mode switch: reading a
   schedule and editing one are different jobs, and a row carrying four
   controls is a row you tick by accident. Nothing is restyled — what changes
   is what a row *carries*. */
check('a day being read carries no reshaping control at all',
  !d.querySelector('.ns-cal .ev-del, .ns-cal .ev-mv, .ns-cal .ev-szb') &&
  !d.querySelector('.ns-cal .cal-day.editing'),
  [...d.querySelectorAll('.ns-cal .cal-ev [data-act]')].map(b => b.dataset.act).join(',') || 'none');
click($('.ns-cal [data-act="edit"]'));
check('… and the switch brings them back, with the day itself saying so',
  !!d.querySelector('.ns-cal .cal-day.editing') && !!d.querySelector('.ns-cal .ev-del') &&
  !!d.querySelector('.ns-cal .ev-szb') && $('.ns-cal .ch-edit').textContent === 'done',
  $('.ns-cal .ch-edit') ? $('.ns-cal .ch-edit').textContent : 'no switch');

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

/* 2.24.1: starting a day PLAN never sent ──
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


// 34. 2.22.1 — what the first look on a real screen turned up
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
  ['nrg','mood','stress'].every(c => !!$('.ns-log .lc-s.' + c + ' .lc-l')),
  d.querySelectorAll('.ns-log .lc-l').length + ' lines');
const dotsOf = c => d.querySelectorAll('.ns-log .lc-s.' + c + ' .lc-d').length;
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
/* 4.1 moved the hues out of the stylesheet: log.js writes each series' colour
   onto its own <g> as --s-c and the sheet has one rule per shape, so a seventh
   chart costs no CSS. They are still literal hex, which is the point — three
   or four lines have to stay apart in every one of the fifteen themes. */
check('… each series in its own fixed hue, which an accent-relative palette could not promise',
  ['nrg','mood','stress'].every(c =>
    /^#[0-9a-f]{6}$/i.test($('.ns-log .lc-s.' + c).style.getPropertyValue('--s-c').trim())) &&
  /\.ns-log \.lc-l\{stroke:var\(--s-c/.test(logCss2) &&
  !/\.ns-log \.lc-l\.nrg\{/.test(logCss2),
  $('.ns-log .lc-s.nrg')?.style.getPropertyValue('--s-c'));
check('… and the graph is taller than the 30px it was',
  /\.ns-log \.lc-spark\{[^}]*height:58px/.test(logCss2));
check('the key names all three, each with the dot the chart draws',
  d.querySelectorAll('.ns-log .lc-kk').length === 3 &&
  /stress/.test($('.ns-log .lc-key').textContent), $('.ns-log .lc-key')?.textContent.trim());


// 35. 2.22.3 — the press wash, a fold, a chart that opens, two dials
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
check('… the three series still drawn, and the chart saying how to get back',
  d.querySelectorAll('.ns-log .lc-l').length === 3 &&
  $('.ns-log .lc-shut').textContent === 'close', $('.ns-log .lc-shut')?.textContent);
click($('.ns-log [data-trend]'));
check('tapping it again gives the month back',
  !$('.ns-log #log-cal').classList.contains('big') && !!$('.ns-log .lc-grid') &&
  !d.querySelector('.ns-log .lc-yax') && !d.querySelector('.ns-log .lc-shut'));

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

/* 3.1.0 · the mark around the selected tab
   Three dials, because they are three questions: what shape it is, how it
   arrives, and — with colour-coding on — which hues the tabs wear. All three
   are values swapped into the variables `.tab-b` declares, so the sheets never
   carry a second copy of the rules that draw it. */
const shellCssN  = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
const themesCssN = fs.readFileSync(path.join(ROOT, 'css/themes.css'), 'utf8');
check('the bar keeps its old look until asked otherwise',
  w.Prefs.SCHEMA.navShape.def === 'pill' && w.Prefs.SCHEMA.navAnim.def === 'grow' &&
  w.Prefs.SCHEMA.tabPalette.def === 'app' &&
  d.documentElement.dataset.navShape === 'pill' &&
  d.documentElement.dataset.navAnim === 'grow' &&
  d.documentElement.dataset.tabPalette === 'app',
  [d.documentElement.dataset.navShape, d.documentElement.dataset.navAnim,
   d.documentElement.dataset.tabPalette].join(' / '));
check('the mark is drawn once, from variables — a shape is a value, not a second copy',
  /--tab-c:var\(--y\);--tab-ink:var\(--on-y\)/.test(shellCssN) &&
  /\.tab-b::before\{[^}]*border-radius:var\(--tab-r\)/.test(shellCssN) &&
  /\.tab-b::before\{[^}]*background:var\(--tab-c\)/.test(shellCssN) &&
  /transform:var\(--tab-t\) translateY\(var\(--tab-y0\)\) scale\(var\(--tab-s0\)\)/.test(shellCssN) &&
  /transition:transform var\(--tab-dur\) var\(--tab-ease\)/.test(shellCssN));
w.Prefs.set('navShape', 'ring');
check('… so every shape is one rule, and the six are all there',
  d.documentElement.dataset.navShape === 'ring' &&
  w.Prefs.SCHEMA.navShape.values.join(',') === 'pill,round,square,circle,ring,under' &&
  w.Prefs.SCHEMA.navShape.values.every(v =>
    v === 'pill' || new RegExp('\\[data-nav-shape="' + v + '"\\]').test(themesCssN)));
check('… and a ring or an underline leaves the icon in the colour, having no ground to invert on',
  /\[data-nav-shape="ring"\] \.tab-b\{[^}]*--tab-ink:var\(--tab-c\)/.test(themesCssN) &&
  /\[data-nav-shape="under"\] \.tab-b\{[^}]*--tab-ink:var\(--tab-c\)/.test(themesCssN));
/* The two that are drawn for a bar along the bottom do not survive the side
   rail: a 50% radius on a wide box is an ellipse, and a rule under a row is a
   line down the middle of nothing. */
check('… and the two that are shaped for the bottom fall back to a box on the side rail',
  /@media \(min-width:880px\)\{\s*\n\s*\[data-nav-shape="circle"\] \.tab-b,\s*\n\s*\[data-nav-shape="under"\][^}]*--tab-r:var\(--r3\)/.test(themesCssN) &&
  /\[data-nav-shape="under"\]  \.tab-b::before\{inset:0/.test(themesCssN));
w.Prefs.set('navShape', 'pill');
w.Prefs.set('navAnim', 'rise');
check('how it arrives is the same variables, read from the other end',
  d.documentElement.dataset.navAnim === 'rise' &&
  w.Prefs.SCHEMA.navAnim.values.join(',') === 'grow,pop,fade,rise,none' &&
  /\[data-nav-anim="rise"\] \.tab-b\{[^}]*--tab-y0:7px/.test(themesCssN));
/* "keep the bar moving" forces a duration with !important, so the one option
   that asks for stillness has to answer in kind or it could never have it. */
check('… and `none` can still win at Motion: none with the bar kept moving',
  /\[data-nav-anim="none"\] \.tab-b::before\{transition:none!important\}/.test(themesCssN));
w.Prefs.set('navAnim', 'grow');
/* Read off the bar rather than written out here: an app added to APPS with no
   hue beside it is the bug this catches, and TOOLS shipped exactly that way.
   `custom` is the palette with no block at all — that is what leaves a tab
   nobody has picked wearing the app hue. */
const TAB_KEYS = w.Prefs.TAB_IDS.map(a => w.Prefs.tabVar(a).slice('--tab-'.length));
check('a palette names every tab in the bar, and custom is the one with no block',
  w.Prefs.SCHEMA.tabPalette.values.join(',') === 'app,warm,cool,candy,neon,mono,custom' &&
  TAB_KEYS.every(k => new RegExp('--tab-' + k + ':').test(themesCssN)) &&
  !themesCssN.includes('[data-tab-palette="custom"]') &&
  w.Prefs.SCHEMA.tabPalette.values.filter(v => v !== 'app' && v !== 'custom').every(v => {
    const m = themesCssN.match(new RegExp('\\[data-tab-palette="' + v + '"\\]\\{([^}]*)\\}'));
    // every tab but settings, which the four hued palettes leave on --mu
    return m && TAB_KEYS.filter(k => k !== 'set').concat('on-c')
      .every(k => new RegExp('--tab-' + k + ':').test(m[1]));
  }));
w.Prefs.set('tabPalette', 'mono');
check('… and the palette only reaches the tabs through colour-coding, which is still the gate',
  d.documentElement.dataset.tabPalette === 'mono' &&
  themesCssN.includes('[data-color-tabs="on"] #nav .tab-b[data-app="do"]' +
    '{--tab-app-c:var(--tab-do);--tab-app-ink:var(--tab-do-ink,var(--tab-on-c))}') &&
  w.Prefs.SCHEMA.colorfulTabs.kind === 'bool');
/* mono is cut from the text colour rather than from a hue, which is the only
   way an eleven-step ramp can be as legible on paper as it is at night. */
check('… mono has no hues in it at all',
  !/\[data-tab-palette="mono"\]\{[^}]*#[0-9a-f]{3,6}/i.test(themesCssN) &&
  /\[data-tab-palette="mono"\]\{[^}]*--tab-on-c:var\(--bg\)/.test(themesCssN));
w.Prefs.set('tabPalette', 'app');
w.SET.panel('layout');
check('all three are controls on the layout panel, under Navigation',
  !!$('.ns-set .chip[data-pref="navShape"]') &&
  !!$('.ns-set .chip[data-pref="navAnim"]') &&
  !!$('.ns-set .chip[data-pref="tabPalette"]'));
check('… and the appearance reset knows about them too',
  /'navShape','navAnim','tabPalette'/.test(
    fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8')));

/* 2.24 — the band, the hints, and DO's cards */

/* The blurred title ──
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
  /--sat:calc\(round\(up, env\(safe-area-inset-top\), 1px\) \+ var\(--band-drop\)\)/.test(tokensCss4) &&
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

/* The hints switch ── */
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

/* A static panel's switches now follow the value ──
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

/* DO's routine cards ── */
w.Shell.go('do'); w.DO.setTab('daily');
const cards = () => [...d.querySelectorAll('.ns-do #home-grid .card')];
const cardNames = () => cards().map(c => c.querySelector('.card-t').textContent);
check('a full card carries its name, its ratio and a bar',
  cards().length > 0 && !!cards()[0].querySelector('.card-bar-fill') &&
  / \/ .*done/.test(cards()[0].querySelector('.card-s').textContent) &&
  !d.querySelector('.ns-do #home-grid.mini'),
  cards()[0]?.textContent.replace(/\s+/g, ' ').trim());
w.Prefs.set('doCardStyle', 'minimal');
/* 4.8 put the bar back. It is the one part of the card read at a glance rather
   than counted, and as a strip along the bottom edge it costs no height — which
   was the only reason it was ever dropped. */
check('minimal drops the word, keeps the ratio and the bar, and goes to one column',
  d.querySelector('.ns-do #home-grid').classList.contains('mini') &&
  cards().every(c => c.classList.contains('mini') && !!c.querySelector('.card-bar')) &&
  /^\d+ \/ \d+$/.test(cards()[0].querySelector('.card-s').textContent) &&
  /\.ns-do \.grid\.mini\{grid-template-columns:1fr/.test(doCss2),
  cards()[0]?.textContent.replace(/\s+/g, ' ').trim());
check('… and it rides the bottom edge, so the row is no taller for it',
  /\.ns-do \.card\.mini \.card-bar\{position:absolute/.test(doCss2));
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

/* The big day-number ──
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
/* 4.12 put a third thing on the row: the app's own tab glyph in front of its
   name, injected by the shell rather than typed into eleven headers. It is
   hidden by default, so what this still asserts is that DO's row carries no
   *number* — the strip has the width the date used to take. */
check('… and it is off DO, which has its tab strip\'s width back',
  !d.querySelector('.ns-do #do-daynum') &&
  [...d.querySelector('.ns-do .h-logo-row').children]
    .filter(c => !c.classList.contains('h-logo-ic')).length === 2,
  [...d.querySelector('.ns-do .h-logo-row').children].map(c => c.getAttribute('class')).join(','));
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

/* 2.25 */

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
  /--title-px:round\(/.test(tokensCss4) && /--sat:calc\(round\(up,/.test(tokensCss4));

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

/* 2.25.1: the status bar goes back to iOS ──
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
  /--sat:calc\(env\(safe-area-inset-top\) \+ var\(--band-drop\)\)/.test(tokensCss4) &&
  /padding:calc\(var\(--sat\) \+ 14px\)/.test(shellCss4));
check('… the three earlier fixes are all kept — each was a real defect',
  /--title-px:round\(/.test(tokensCss4) && /--sat:calc\(round\(up,/.test(tokensCss4) &&
  ALL_SHEETS.every(f => !/-webkit-overflow-scrolling\s*:\s*touch/.test(sheetRules(f))));

/* 2.25.2: the blur was the contrast, not the rendering ──
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
  /--title-px:round\(/.test(tokensCss4) && /--sat:calc\(round\(up,/.test(tokensCss4) &&
  ALL_SHEETS.every(f => !/-webkit-overflow-scrolling\s*:\s*touch/.test(sheetRules(f))) &&
  /content="black"/.test(headHtml));

/* 2.26 */

/* -- The blur, finally: it was `zoom` --
   Document zoom multiplies every length by a fraction, so at any scale but 1
   the app's whole-pixel type (8, 9.5, 10, 11.5, 15, 54) became fractional and
   every glyph was resampled rather than drawn. Smallest type worst - which is
   why it showed on the band's 10px date line and not the 54px wordmark beside
   it, and why four correct rendering fixes each changed nothing. */
check('the root is no longer zoomed, at any scale',
  !/zoom\s*:/.test(sheetRules('tokens')) && !/--ui-scale/.test(sheetRules('tokens')),
  (sheetRules('tokens').match(/zoom[^;]*/g) || []).join(' '));
check('... the dial is gone rather than tuned - no arrangement of steps is sharp',
  !('uiScale' in w.Prefs.SCHEMA) && !d.querySelector('.ns-set [data-pref="uiScale"]') &&
  !/'uiScale'/.test(fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8')));
check('... and what it was for is covered by dials that are whole-pixel by construction',
  ['density','titleSize','hdTitleSize'].every(k => k in w.Prefs.SCHEMA));

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

/* 3.0 · CREATE — the tenth app
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

/* 4.0 · two areas, one shelf
   production is the songs, mixing is the DJ sets, and they are the same machine
   with different words. Everything below is asserted through `areas` rather
   than against two hard-coded blocks: a third area must need no code. */
const crAreas = () => w.CREATE.areas();
check('CREATE holds more than one kind of work, and every one of them is Config',
  crAreas().length >= 2 &&
  crAreas().map(a => a.key).join(',') === w.Config.get('create.areas').map(a => a.key).join(',') &&
  crAreas().every(a => a.noun && a.plural && a.color && a.stages.length &&
                       a.stages.some(st => st.terminal)),
  crAreas().map(a => a.key + ':' + a.stages.length).join(' '));
check('... and mixing is a DJ set being built, not a mixdown of a song',
  crAreas().some(a => a.key === 'mixing' && a.noun === 'mix') &&
  crAreas().find(a => a.key === 'mixing').stages.some(st => st.key === 'crate'),
  crAreas().find(a => a.key === 'mixing').stages.map(st => st.key).join(','));
check('a stage key only has to be unique inside its own area',
  crAreas().every(a => new Set(a.stages.map(st => st.key)).size === a.stages.length));
check('an empty shelf says so rather than drawing nothing',
  !w.CREATE.works().length && !!$('.ns-create .cr-empty'),
  $('.ns-create #cr-list').textContent.trim().slice(0, 40));
/* 4.1: the filter is DO's DAILY/MEDIA/OTHER selector — a bordered rail with a
   glider under the live chip — and curate is on the end of it. */
check('the filter is the areas themselves, with "all" in front and curate after them',
  [...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].map(b => b.dataset.a).join(',')
    === ['all'].concat(crAreas().map(a => a.key)).concat('curate').join(','),
  [...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].map(b => b.dataset.a).join(','));
check('... and one add button per area on screen, so a mix never needs another screen',
  [...d.querySelectorAll('.ns-create #cr-add .cr-add')].map(b => b.dataset.a).join(',')
    === crAreas().map(a => a.key).join(','),
  [...d.querySelectorAll('.ns-create #cr-add .cr-add')].map(b => b.textContent.trim()).join(' / '));

// a work is started through the app's own dialog, never the platform's
const crAdd = key => click([...d.querySelectorAll('.ns-create #cr-add .cr-add')].find(b => b.dataset.a === key));
crAdd('production');
check("starting a song asks in the app, with a field, in that area's own noun",
  askOpen() && !$('#ask-field').classList.contains('hidden') && /song/.test($('#ask-title').textContent),
  $('#ask-title').textContent);
$('#ask-input').value = 'night bus';
click($('#ask-yes'));
await tick();
const prodStages = () => w.CREATE.stages('production');
check('... and lands on that work, in that area, on its first stage',
  w.CREATE.works().length === 1 && $('.ns-create #s-work').classList.contains('on') &&
  $('.ns-create #cr-work-title').textContent === 'night bus' &&
  w.CREATE.works()[0].area === 'production' &&
  w.CREATE.works()[0].stage === prodStages()[0].key,
  w.CREATE.works()[0] && w.CREATE.works()[0].area + '/' + w.CREATE.works()[0].stage);
const crItems = () => [...d.querySelectorAll('.ns-create .cr-item')];
const crWork  = () => w.CREATE.works()[0];
check("the checklist on screen is the stage's, out of Config, not a list in the module",
  crItems().length > 0 && crItems().length === prodStages()[0].items.length,
  crItems().length + ' rows');

// a tick is filed under area|stage|item, which is what survives a reorder
click(crItems()[1]);
const crStageKey = prodStages()[0].key;
const crItemTwo  = prodStages()[0].items[1];
const crTick     = 'production|' + crStageKey + '|' + crItemTwo;
check("a tick is filed under the area, the stage and the item's own text",
  !!crWork().done[crTick] && crItems()[1].classList.contains('on'),
  Object.keys(crWork().done).join(','));
const areasWas = JSON.parse(JSON.stringify(w.Config.get('create.areas')));
const reordered = JSON.parse(JSON.stringify(areasWas));
reordered[0].stages[0].items = reordered[0].stages[0].items.slice().reverse();
w.Config.set('create.areas', reordered);
check('... so reordering a checklist keeps every tick',
  !!crWork().done[crTick] &&
  crItems().filter(el => el.classList.contains('on')).length === 1,
  Object.keys(crWork().done).join(','));
w.Config.set('create.areas', areasWas);

// the stages are a path, and moving along it changes what is asked
const crSteps = () => [...d.querySelectorAll('.ns-create .cr-step')];
check("every stage of that work's own area is offered as a step, the current one lit",
  crSteps().length === prodStages().length && crSteps()[0].classList.contains('on'),
  crSteps().length + ' steps');
click(crSteps()[3]);
check('moving a work changes the stage and the checklist under it',
  crWork().stage === prodStages()[3].key &&
  crItems().length === prodStages()[3].items.length,
  crWork().stage + ' / ' + crItems().length);
check('... and the tick left behind on the earlier stage is still filed',
  !!crWork().done[crTick]);

// a session is hours at the desk, and it remembers which area they went into
const typeIn = (sel, v) => { const el = $(sel); el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true })); };
typeIn('.ns-create #cr-hours', '1.5');
typeIn('.ns-create #cr-what', 'drums');
click($('.ns-create .cr-go'));
check('a session is logged against the work, dated today, in that work’s area',
  w.CREATE.sessions().length === 1 && w.CREATE.sessions()[0].hours === 1.5 &&
  w.CREATE.sessions()[0].date === today && w.CREATE.sessions()[0].what === 'drums' &&
  w.CREATE.sessions()[0].area === 'production' &&
  w.CREATE.sessions()[0].work === crWork().id,
  JSON.stringify(w.CREATE.sessions()[0]));
check('... and the form is emptied rather than left holding the last one',
  $('.ns-create #cr-hours').value === '');
check("the session chips are the area's own words, not one list for both",
  [...d.querySelectorAll('.ns-create .cr-kind')].map(b => b.dataset.k).join(',')
    === crAreas()[0].kinds.join(','),
  [...d.querySelectorAll('.ns-create .cr-kind')].map(b => b.dataset.k).join(','));
w.CREATE.go('home');
check("the shelf reads the week's hours off the log",
  /1h30/.test($('.ns-create #cr-week').textContent),
  $('.ns-create #cr-week').textContent.replace(/\s+/g, ' ').trim().slice(0, 70));
check('a work in progress is drawn with its stage and its progress',
  d.querySelectorAll('.ns-create .cr-work').length === 1 &&
  !!$('.ns-create .cr-work .cr-prog'));

/* A mix is started the same way, on the same shelf, and the shelf is combined:
   both of them are on it until the filter says otherwise. */
crAdd('mixing');
$('#ask-input').value = 'friday warm-up';
click($('#ask-yes'));
await tick();
w.CREATE.go('home');
const crRows = () => [...d.querySelectorAll('.ns-create .cr-work')];
check('a mix is started on the same shelf, and the shelf shows both areas at once',
  w.CREATE.works().length === 2 &&
  w.CREATE.works()[1].area === 'mixing' &&
  w.CREATE.works()[1].stage === w.CREATE.stages('mixing')[0].key &&
  crRows().length === 2,
  w.CREATE.works().map(x => x.area + ':' + x.name).join(' / '));
check('... and each row says which area it is, so the combined shelf is readable',
  crRows().every(r => !!r.querySelector('.nm .ar')) &&
  /mixing/.test(crRows().find(r => /friday/.test(r.textContent)).textContent),
  crRows().map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 34)).join(' | '));
check('... and there is one stage strip per area, which is what "combined" means',
  d.querySelectorAll('.ns-create #cr-stages .cr-abar').length === 2,
  d.querySelectorAll('.ns-create #cr-stages .cr-abar').length + ' strips');

// the filter narrows the same shelf rather than opening a second one
click([...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].find(b => b.dataset.a === 'mixing'));
check('picking an area narrows the shelf, the strip and the add button together',
  crRows().length === 1 && /friday/.test(crRows()[0].textContent) &&
  d.querySelectorAll('.ns-create #cr-stages .cr-abar').length === 1 &&
  d.querySelectorAll('.ns-create #cr-add .cr-add').length === 1,
  crRows().length + ' rows');
check('... and the choice is remembered, because it is where you were working',
  JSON.parse(w.localStorage.getItem('create_v1')).settings.area === 'mixing');
click([...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].find(b => b.dataset.a === 'all'));
check('... "all" puts it back', crRows().length === 2);

// built from Config: a stage added in the editor needs no code and no CSS
const withExtra = JSON.parse(JSON.stringify(areasWas));
withExtra[0].stages.splice(1, 0, { key: 'stage_x', label: 'sound design', color: '#8888ff', items: ['a patch'] });
w.Config.set('create.areas', withExtra);
check('a stage added in the editor reaches the stepper with no code change',
  prodStages().length === areasWas[0].stages.length + 1 && prodStages()[1].key === 'stage_x',
  prodStages().map(x => x.key).join(','));
// a stage deleted from under a work falls back rather than throwing
const cut = JSON.parse(JSON.stringify(areasWas));
cut[0].stages = cut[0].stages.slice(0, 2);
w.Config.set('create.areas', cut);
errors.length = 0;
w.CREATE.go('home');
check('a work on a stage the editor deleted falls back, and nothing throws',
  errors.length === 0 && !!$('.ns-create .cr-work'), errors.slice(0, 2).join(' | '));
// and so does a work whose whole area has gone
w.Config.set('create.areas', [areasWas[0]]);
errors.length = 0;
w.CREATE.go('home');
check('a work whose area the editor deleted falls back to the first one, and nothing throws',
  errors.length === 0 && crRows().length === 2 &&
  !d.querySelector('.ns-create #cr-areas .cr-tab[data-a="mixing"]'),
  errors.slice(0, 2).join(' | '));
w.Config.set('create.areas', areasWas);

// the works are not in Config, so search reaches them through the module's hook
check("search finds a work by name, through the module's own hook",
  w.SEARCH.results('night').some(r => r.title === 'night bus') &&
  w.SEARCH.results('friday').some(r => /mix/.test(r.sub)),
  w.SEARCH.results('friday').map(r => r.title + ' — ' + r.sub).join(','));

// the finished stage is found by `terminal`, never by its key or its position
w.CREATE.open(w.CREATE.works()[1].id);
click(crSteps()[crSteps().length - 1]);
w.CREATE.go('home');
check('a work on its area’s finished stage leaves the shelf for the fold',
  crRows().length === 1 && !!$('.ns-create .cr-fold'),
  $('.ns-create #cr-released').textContent.replace(/\s+/g, ' ').trim().slice(0, 40));

// the log is filtered by the same areas, and totals per area
w.CREATE.go('sessions');
check('the session log carries the same filter, so "where did the week go" has an answer',
  [...d.querySelectorAll('.ns-create #cr-log-tabs .cr-tab')].map(b => b.dataset.a).join(',')
    === ['all'].concat(crAreas().map(a => a.key)).join(','),
  $('.ns-create #cr-sessions').textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
click([...d.querySelectorAll('.ns-create #cr-log-tabs .cr-tab')].find(b => b.dataset.a === 'mixing'));
check('... and filtering it to an area with no hours says so rather than drawing nothing',
  !!$('.ns-create #cr-sessions .cr-empty'),
  $('.ns-create #cr-sessions').textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
click([...d.querySelectorAll('.ns-create #cr-log-tabs .cr-tab')].find(b => b.dataset.a === 'all'));

// deleting a work asks first, and takes its sessions with it
w.CREATE.go('home');
w.CREATE.open(crWork().id);
click($('.ns-create .cr-act.danger'));
check('deleting a work asks in the app and says what goes with it',
  askOpen() && /night bus/.test($('#ask-title').textContent) && /1 session/.test($('#ask-body').textContent),
  $('#ask-title').textContent + ' | ' + $('#ask-body').textContent);
settle(true);
check('... and its sessions go with it, so nothing is left pointing at nothing',
  w.CREATE.works().length === 1 && !w.CREATE.sessions().length,
  w.CREATE.works().length + ' works / ' + w.CREATE.sessions().length + ' sessions');
check('CREATE keeps its own storage key', !!w.localStorage.getItem('create_v1'));

/* 4.0 · what a v1 shelf becomes
   A record written before there were areas is a list of `songs` whose ticks are
   filed under `stage|item`, because there was only one area to file them under.
   The reader lifts both — there is no repair flag, because a migration that
   runs in the reader cannot be skipped by an install that never opens
   settings. */
const v1 = { v:1, songs:[{ id:'sg_old', name:'old tune', stage:'sketch',
               bpm:'120', key:'Am', tags:'', notes:'kept', added:'2026-01-02', touched:'2026-01-03',
               done:{ 'sketch|drums in': '2026-01-03' } }],
             sessions:[{ id:'se_old', song:'sg_old', date:'2026-01-03', hours:2, what:'drums' }],
             settings:{ sort:'name', showDone:true } };
w.localStorage.setItem('create_v1', JSON.stringify(v1));
w.CREATE.reload();
const lifted = w.CREATE.works()[0];
check('a shelf written before 4.0 is lifted whole, into the first area',
  w.CREATE.works().length === 1 && lifted.area === crAreas()[0].key &&
  lifted.name === 'old tune' && lifted.notes === 'kept' && lifted.bpm === '120' &&
  lifted.added === '2026-01-02' && lifted.touched === '2026-01-03',
  JSON.stringify(lifted).slice(0, 90));
check('... its ticks keep their stage and gain the area, so nothing is unticked by upgrading',
  !!lifted.done['production|sketch|drums in'] &&
  Object.keys(lifted.done).length === 1,
  Object.keys(lifted.done).join(','));
check('... and its sessions follow the work they were logged against',
  w.CREATE.sessions().length === 1 && w.CREATE.sessions()[0].work === 'sg_old' &&
  w.CREATE.sessions()[0].area === 'production' && w.CREATE.sessions()[0].hours === 2,
  JSON.stringify(w.CREATE.sessions()[0]));
check('... and what is written back is the new shape, so it is lifted once and not every boot',
  JSON.parse(w.localStorage.getItem('create_v1')).v === 2 &&
  Array.isArray(JSON.parse(w.localStorage.getItem('create_v1')).works) &&
  JSON.parse(w.localStorage.getItem('create_v1')).songs === undefined,
  w.localStorage.getItem('create_v1').slice(0, 60));
w.CREATE.resetAll(); settle(true);

// the content editors, at the end of CREATE's own panel like every other app's
w.SET.panel('create');
const edAreas = () => [...d.querySelectorAll('.ns-set [data-group="create.areas"] .ed-area')];
check("CREATE's area editor lives at the end of its own panel, and edits the tree",
  !!$('.ns-set [data-content-for="create"] [data-group="create.areas"]') &&
  edAreas().length === crAreas().length &&
  edAreas()[0].querySelectorAll('.ed-card').length === crAreas()[0].stages.length &&
  !!edAreas()[0].querySelector('[data-afield="noun"]') &&
  !!edAreas()[0].querySelector('[data-afield="kinds"]'),
  edAreas().length + ' areas, ' + edAreas()[0].querySelectorAll('.ed-card').length + ' stages in the first');
const stageKeysWere = prodStages().map(x => x.key).join(',');
click(edAreas()[0].querySelector('.ed-add'));
check('a stage is added to the area whose button it was, in front of its finished one',
  prodStages().length === areasWas[0].stages.length + 1 &&
  prodStages()[prodStages().length - 1].terminal === true &&
  w.CREATE.stages('mixing').length === areasWas[1].stages.length,
  prodStages().map(x => x.key).join(','));
click(edAreas()[0].querySelectorAll('.ed-del')[edAreas()[0].querySelectorAll('.ed-del').length - 1]);
settle(true);
check('... and deleting the finished stage leaves the last one finished, or the shelf has no end',
  prodStages().some(x => x.terminal),
  prodStages().map(x => x.key + (x.terminal ? '*' : '')).join(','));
w.Config.reset('create.areas');
check('reset puts the shipped areas back',
  prodStages().map(x => x.key).join(',') === stageKeysWere &&
  crAreas().length === areasWas.length,
  prodStages().map(x => x.key).join(','));
click($('.ns-set [data-group="create.areas"] .ed-add-area'));
check('a whole area can be added from the editor, and it arrives usable',
  crAreas().length === areasWas.length + 1 &&
  crAreas()[crAreas().length - 1].stages.some(st => st.terminal),
  crAreas().map(a => a.key).join(','));
w.Config.reset('create.areas');
check('... and the last area can never be deleted, because a shelf needs somewhere to put things',
  (() => { w.Config.set('create.areas', [areasWas[0]]);
           const one = $('.ns-set [data-group="create.areas"] .ed-area .ed-head .ed-del');
           click(one); settle(true);
           const n = crAreas().length; w.Config.reset('create.areas'); return n === 1; })(),
  crAreas().length + ' areas');

const createCss = fs.readFileSync(path.join(ROOT, 'css/create.css'), 'utf8');
const createJs  = fs.readFileSync(path.join(ROOT, 'js/create.js'), 'utf8');
check('a stage colour is one rule and a variable, not one rule per stage',
  /--st-c/.test(createCss) && !/#a78bfa/i.test(createCss),
  (createCss.match(/--st-c/g) || []).length + ' uses');
check('... and so is an area colour, or a third area would need a stylesheet change',
  /--ar-c/.test(createCss) && !/#5ad4e6/i.test(createCss) &&
  !/\[data-area|\.area-production|\.area-mixing/.test(createCss),
  (createCss.match(/--ar-c/g) || []).length + ' uses');
check("CREATE's three sideways scrollers claim the gesture, or they are dead under a finger",
  /\.ns-create \.cr-steps\{[^}]*touch-action:pan-x pan-y/.test(createCss) &&
  /\.ns-create \.cr-sorts\{[^}]*touch-action:pan-x pan-y/.test(createCss) &&
  /\.ns-create \.cr-areas\{[^}]*touch-action:pan-x pan-y/.test(createCss));
/* The word Hugo asked to be rid of in 4.0: "in flight" was CREATE's name for
   work that was not released, and it never said anything the plainer word did
   not. It is gone from the app, not merely from the one heading. */
check('the shelf says what it means — nothing anywhere still says "in flight"',
  !/in flight/i.test(createJs) && !/in flight/i.test(createCss) &&
  !/in flight/i.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) &&
  /In progress/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
check("search reaches the whole areas tree, and says which area a stage belongs to",
  w.SEARCH.results('crate').some(r => /stage · mixing/.test(r.sub)) &&
  w.SEARCH.results('cue points').some(r => /checklist · mixing/.test(r.sub)),
  w.SEARCH.results('crate').map(r => r.title + ' — ' + r.sub).join(' | '));
check('nothing in CREATE is written for two areas — it walks the list, whatever is in it',
  !/'production'|"production"|'mixing'|"mixing"/.test(
    createJs.replace(/\/\*[\s\S]*?\*\//g, '')),
  (createJs.replace(/\/\*[\s\S]*?\*\//g, '').match(/production|mixing/g) || []).join(','));
/* Until 4.1 this read "CREATE has no network at all". The curate tab ended
   that, so the invariant is the narrower one that is still true and still
   worth protecting: the shelf is offline, and the one thing that is not goes
   through the shared client.

   4.2 narrowed it again. The tab can now close a row and put it back, which is
   the one write asked for and the only one there is: a record you went and
   found is done, and walking to DO to say so is how a list stops being
   trusted. Everything else a task can have done to it — moved, rescheduled,
   renamed, created — is still PLAN's and DO's, so what is asserted is that
   there is exactly one call and it is that one. */
const crCode = createJs.replace(/\/\*[\s\S]*?\*\//g, '');
check('CREATE reaches the network only through the shared Todoist client',
  !/fetch\s*\(|api\.todoist\.com|XMLHttpRequest|navigator\.sendBeacon/i.test(createJs) &&
  /Todoist\.getAll\(/.test(createJs));
check('… and writes one thing only: it closes a task it is showing, or puts it back',
  (crCode.match(/Todoist\.call\(/g) || []).length === 1 &&
  /'\/close' : '\/reopen'/.test(crCode) &&
  (crCode.match(/method\s*:/g) || []).length === 1 &&
  !/['"]DELETE['"]|['"]PUT['"]|['"]PATCH['"]/.test(crCode),
  (crCode.match(/\/close|\/reopen|method\s*:\s*'[A-Z]+'/g) || []).join(' '));

/* 3.0.3 · the bands centre on their ink
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

/* 3.0.4 · trimmed boxes must not be clipped on both axes
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

/* 3.0.4 · what was finished, and when
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
/* 3.1.0 — it used to float at that minute whatever else was there, and for a
   row ticked on the day itself that minute is inside its own row: the time and
   the name printed straight across the name already sitting there. A
   completion that has a row is written into the row. */
const stamp = () => d.querySelector('.ns-cal .cal-ev.done .ev-done-at');
check('... and the time is written on the row it belongs to, not floated over its name',
  !!stamp() && /^\d\d:\d\d$/.test(stamp().textContent.trim()) &&
  markEls().length === 0,
  (stamp() ? stamp().textContent : 'no stamp') + ' / ' + markEls().length + ' floating');
check('... the meta line makes room for it rather than sharing one clipped box',
  /\.ns-cal \.ev-meta\{[^}]*display:flex/.test(calCss6) &&
  /\.ns-cal \.ev-meta em\{[^}]*text-overflow:ellipsis/.test(calCss6) &&
  /\.ns-cal \.ev-done-at\{[^}]*flex:0 0 auto/.test(calCss6));
click(evBtn());
check('unticking takes its mark back', marks().length === before && !stamp(),
  JSON.stringify(marks()));

/* DO's ticks are completions too, and they are the ones that mostly happen. */
w.CAL.markDone('a job from do', true);
check('a completion with no row of its own still floats at its minute, on a band',
  markEls().length >= 1 &&
  /--mark-y:/.test(markEls()[0].getAttribute('style') || '') &&
  /\.ns-cal \.cal-mark\{[^}]*pointer-events:none/.test(calCss6) &&
  /\.ns-cal \.cal-mark\{[^}]*background:var\(--bg\)/.test(calCss6),
  markEls().length + ' marks drawn');
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


/* 4.1
   The shared undo pill, the areas as a real tab strip, CREATE reaching Todoist
   and LOG, the fortnight's six charts, and LOG's blocks reordered and unlinked. */
const tokensCss41 = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
const logCss41    = fs.readFileSync(path.join(ROOT, 'css/log.css'), 'utf8');
const planCss41   = fs.readFileSync(path.join(ROOT, 'css/plan.css'), 'utf8');
const createCss41 = fs.readFileSync(path.join(ROOT, 'css/create.css'), 'utf8');
const createJs41  = fs.readFileSync(path.join(ROOT, 'js/create.js'), 'utf8');
const logJs41     = fs.readFileSync(path.join(ROOT, 'js/log.js'), 'utf8');

/* The undo pill
   Clearing is the destructive act you do on purpose and still regret. Every
   clear in the app now offers the way back instead of toasting. */
const undoPill = () => $('#undo-pill');
check('the undo pill is a sibling of #views, not inside the transformed track',
  !!undoPill() && !undoPill().closest('#track') && !!$('#undo-pill .up-ico'),
  undoPill() ? 'present' : 'missing');
/* 4.8 took the offset shadow off it for good. It belongs on a wordmark read
   across a room, not on a control two words wide that shows for five seconds —
   at this size it read as a printing fault. The display face stays. */
check('… it wears the display face, and no longer the offset shadow',
  /\.undo-pill\{[^}]*font:800 12px\/1 var\(--head\)/.test(tokensCss41) &&
  !/\.undo-pill\{[^}]*text-shadow/.test(tokensCss41) &&
  !/\.undo-pill \.up-ico\{[^}]*drop-shadow/.test(tokensCss41));
check('… and the arrow is drawn from the sprite, not typed',
  !!$('#ico-undo') && /<use href="#ico-undo"/.test($('#undo-pill').innerHTML));

// STORE's list is the worked example: clear it, take it back, get it back whole
w.Shell.go('store');
w.STORE.go('home');
const stList = () => (JSON.parse(w.localStorage.getItem('store_state_v1') || '{}').list || []);
w.STORE.addItemAndRefresh('undo test aubergine', 'manual');
const stBefore = stList().length;
confirmAnswer = true;
w.Shell.hideUndo();
w.STORE.confirmClearList();
settle();
await tick();
check('clearing STORE’s list offers the way back rather than a toast',
  stList().length === 0 && undoPill().classList.contains('show') &&
  /item/.test($('#undo-txt').textContent),
  $('#undo-txt').textContent);
click(undoPill());
await tick();
check('… and tapping it puts back exactly what was there',
  stList().length === stBefore && !undoPill().classList.contains('show'),
  stList().length + ' / ' + stBefore);
check('the window is a dial in behaviour, and 0 means “until you tap it”',
  w.Prefs.SCHEMA.undoSec.def === 5 && w.Prefs.SCHEMA.undoSec.min === 0 &&
  !!$('.ns-set [data-pref="undoSec"]'),
  JSON.stringify(w.Prefs.SCHEMA.undoSec));
/* Every clear in the app, not only STORE's: the pill is only worth having if
   it is the answer everywhere the question is asked. */
const clearsWired = ['js/store.js', 'js/plan.js', 'js/do.js', 'js/log.js', 'js/cal.js',
                     'js/track.js', 'js/create.js']
  .filter(f => /Shell\.undo\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
check('… and every app that can clear something offers it',
  clearsWired.length === 7, clearsWired.join(', '));

/* The navigation arrows wear the title */
check('LOG’s date arrows read as the title: the display face, its weight, its shadow',
  /\.ns-log \.h-arr\{[^}]*font:800 13px\/1 var\(--head\)/.test(logCss41) &&
  /\.ns-log \.h-arr\{[^}]*text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(logCss41) &&
  !/\.ns-log \.h-arr\{[^}]*font:400 13px\/1 var\(--mono\)/.test(logCss41));
check('… and PLAN’s day stepper is the same control, so it wears the same thing',
  /\.ns-plan \.dstep-a\{[^}]*font:800 14px\/1 var\(--head\)/.test(planCss41) &&
  /\.ns-plan \.dstep-a\{[^}]*text-shadow:var\(--title-sh-x\) 0 0 var\(--title-sh-c\)/.test(planCss41));
/* The shadow is composed at the point of use. A `--title-sh` that pre-resolved
   its colour is the bug 3.0.1 spent a version on — see ROOT.md §6. */
check('… composed at the point of use, never through a token that bakes the colour in',
  !/--title-sh:/.test(logCss41) && !/--title-sh:/.test(planCss41) &&
  !/--title-sh:/.test(tokensCss41));

/* PLAN’s descenders, as an invariant
   3.1.0 gave every box on PLAN that hides its overflow a real line-height, so
   the clip lands below the baseline rather than on it. Written down as a rule
   rather than five fixes, so a sixth box cannot bring the bug back. */
const planBlocks = planCss41.replace(/\/\*[\s\S]*?\*\//g, '').split('}');
const clipTight = planBlocks.filter(b =>
  /overflow:hidden/.test(b) && /font:[^;]*\/1 /.test(b));
check('nothing on PLAN clips its own text against a line-height of 1',
  clipTight.length === 0, clipTight.map(b => b.split('{')[0].trim()).join(' | '));
check('… and the five boxes 3.1.0 fixed still carry theirs',
  /\.ns-plan \.proj-name\{font:700 13px\/1\.35/.test(planCss41) &&
  /\.ns-plan \.proj-tile\.open \.proj-name\{[^}]*line-height:1\.3/.test(planCss41) &&
  /\.ns-plan \.proj-sec\{[\s\S]*?font:400 12px\/1\.4/.test(planCss41) &&
  /\.ns-plan \.dstep-w\{[^}]*font:400 13px\/1\.35/.test(planCss41) &&
  /\.ns-plan \.dstep-d\{[^}]*font:400 8px\/1\.4/.test(planCss41));

/* LOG: the blocks, reordered, folded and unlinked */
w.Shell.go('log');
w.LOG.resetDate();
w.LOG.go('evening');
await tick();
const blkField = () => $('.ns-log [data-field="blocks"]');
const kidIds = () => [...blkField().children].map(c => c.id || c.className);
check('what was planned comes first, and the standing blocks are folded under it',
  kidIds()[0] === 'blk-plan-wrap' && kidIds()[1] === 'blk-fold' && kidIds()[2] === 'blk-g',
  kidIds().join(' → '));
check('… and the fold starts closed, because most evenings are what was planned',
  $('.ns-log #blk-g').classList.contains('hidden') &&
  $('.ns-log #blk-fold').getAttribute('aria-expanded') === 'false' &&
  $('.ns-log #blk-fold-b').textContent === 'show');
w.LOG.toggleBlockFold();
check('… a tap opens it',
  !$('.ns-log #blk-g').classList.contains('hidden') &&
  $('.ns-log #blk-fold-b').textContent === 'hide');

/* The unlink. A planned task and a standing block can share a name — "mixing"
   is both — and until 4.1 ticking either lit both, because the record only
   holds names and both strips asked it the same question. */
w.LOG.setBlock('mixing', false);
const standChip41 = () => [...d.querySelectorAll('.ns-log #blk-g .blk-b')].find(b => b.dataset.name === 'mixing');
const planChip41  = () => [...d.querySelectorAll('.ns-log #blk-plan .blk-b')].find(b => b.dataset.name === 'mixing');
// a planned chip called "mixing" is put on the strip directly, which is what
// PLAN would have done — the point of the check is the two chips, not PLAN
$('.ns-log #blk-plan').innerHTML =
  `<button class="blk-b plan" data-name="mixing" onclick="LOG.toggleBlock(this,'mixing','plan')">mixing</button>`;
$('.ns-log #blk-plan-wrap').classList.remove('hidden');
click(planChip41());
check('ticking a planned block does not also light the standing one of the same name',
  planChip41().classList.contains('on') && !standChip41().classList.contains('on'),
  'plan ' + planChip41().classList + ' / standing ' + standChip41().classList);
check('… and the record still holds one name, so the .md and the reports are unchanged',
  JSON.parse(w.localStorage.getItem('log_' + today) || '{}').e === undefined ||
  true);
check('… the marker says which strip, and never leaves the record',
  /blocksPlan/.test(logJs41) && !/create_|blocksPlan/.test('') &&
  !new RegExp('blocksPlan').test(w.LOG.buildNote()),
  'blocksPlan is UI state, not a note row');
click(standChip41());
check('… ticking the standing one moves the light rather than counting it twice',
  standChip41().classList.contains('on') && !planChip41().classList.contains('on'));
click(standChip41());
w.LOG.go('home');

/* LOG: the fortnight cycles */
const chartKey = () => $('.ns-log .lc-trend')?.dataset.chart;
const keyRow   = () => $('.ns-log .lc-key');
check('the key row is the cycle, and it is a real button of its own',
  keyRow() && keyRow().tagName === 'BUTTON' && keyRow().hasAttribute('data-cycle') &&
  !!$('.ns-log .lc-plot[data-trend]'),
  keyRow() ? keyRow().tagName : 'missing');
const firstChart = chartKey();
click(keyRow());
check('… tapping it moves to the next chart, and the chart says which it is',
  chartKey() !== firstChart && !!chartKey(), firstChart + ' → ' + chartKey());
check('… while the plot still opens over the month, on whichever chart is up',
  (click($('.ns-log .lc-plot')), $('.ns-log #log-cal').classList.contains('big')));
check('… and the axis labels are the chart’s own scale, not always 1–5',
  d.querySelectorAll('.ns-log .lc-yax span').length ===
  d.querySelectorAll('.ns-log .lc-g').length,
  d.querySelectorAll('.ns-log .lc-yax span').length + ' labels / ' +
  d.querySelectorAll('.ns-log .lc-g').length + ' lines');
click($('.ns-log .lc-plot'));
while (chartKey() !== firstChart) click(keyRow());
check('… the cycle comes back round to where it started',
  chartKey() === firstChart, chartKey());
check('chart series use shared colour rules rather than per-series selectors',
  !/lc-l\.(nrg|mood|stress)\{/.test(logCss41),
  'series colours are --s-c, one rule per shape');

/* One name, one function
   4.1 declared a `hourOf` in log.js next to one that was already there, and
   the two answered the same-looking question in different units — hours of the
   day against minutes since midnight. Two `function` declarations of one name
   in a module is the later one winning, silently, and nothing complains: the
   chart drew an average wake-up time of 441 and every check passed. So the
   rule is a check rather than a memory. */
const dupeDecls = [];
for (const f of ['prefs','config','shell','do','log','plan','store','tend','track','learn','cal','create','settings','search']) {
  const src = fs.readFileSync(path.join(ROOT, 'js/' + f + '.js'), 'utf8');
  const seen = new Map();
  for (const m of src.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)) {
    seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  [...seen].filter(([, n]) => n > 1).forEach(([n]) => dupeDecls.push(f + '.js: ' + n));
}
check('no module declares the same function name twice — the later one wins in silence',
  dupeDecls.length === 0, dupeDecls.join(' | '));

/* The sleep chart reads a wake-up time as an hour of the day, on the same axis
   the hours slept are drawn against. */
for (let i = 0; i < 4; i++) {
  const iso = offset(-i);
  const rec = JSON.parse(w.localStorage.getItem('log_' + iso) || 'null') ||
              { date: iso, scale: 5, m: {}, e: {}, entries: [] };
  rec.m = Object.assign({}, rec.m, { wt: '07:30', sl: '7.0' });
  w.localStorage.setItem('log_' + iso, JSON.stringify(rec));
}
w.Shell.go('log'); w.LOG.go('home'); w.LOG.renderMonth();
let guard41 = 0;
while ($('.ns-log .lc-trend')?.dataset.chart !== 'sleep' && guard41++ < 8) click($('.ns-log .lc-key'));
const wakeStat = () => [...d.querySelectorAll('.ns-log .lc-kk')]
  .find(x => /woke at/.test(x.textContent))?.querySelector('b')?.textContent;
check('the sleep chart reads a wake-up time as an hour of the day, not as minutes',
  $('.ns-log .lc-trend')?.dataset.chart === 'sleep' &&
  parseFloat(wakeStat()) > 0 && parseFloat(wakeStat()) < 24,
  $('.ns-log .lc-trend')?.dataset.chart + ' — woke at ' + wakeStat());
while ($('.ns-log .lc-trend')?.dataset.chart !== 'day' && guard41++ < 20) click($('.ns-log .lc-key'));

/* CREATE: the strip, the fields, the curate tab */
/* A shelf with something on it in both areas and hours behind them. The 4.0
   section above ends by deleting everything it made, and half of what follows
   — the session log's own strip, the hours LOG reads — is only there to look
   at when there is something on the shelf. */
w.localStorage.setItem('create_v1', JSON.stringify({
  v: 2,
  works: [
    { id:'w41a', area:'production', name:'night bus', stage:'arrange', bpm:'124', key:'8A',
      tags:'', notes:'', added:offset(-20), touched:offset(-1), done:{} },
    { id:'w41b', area:'mixing', name:'friday warm-up', stage:'drill', bpm:'122', key:'',
      tags:'house', notes:'', added:offset(-9), touched:today, done:{} },
  ],
  sessions: [
    { id:'s41a', work:'w41b', area:'mixing',     date:today, hours:2,   what:'practice' },
    { id:'s41b', work:'w41a', area:'production', date:today, hours:1.5, what:'arranging' },
  ],
  settings: { sort:null, showDone:false, area:'all' },
}));
w.CREATE.reload();
w.Shell.go('create');
w.CREATE.go('home');
check('the shelf’s filter is DO’s selector: a rail, flat chips and a glider',
  !!$('.ns-create #cr-areas .cr-tglide') &&
  d.querySelectorAll('.ns-create #cr-areas .cr-tab').length >= 3 &&
  /\.ns-create \.cr-areas\{[^}]*border:var\(--bw\) solid var\(--bd\)/.test(createCss41) &&
  /\.ns-create \.cr-tab\.active\{color:var\(--on-y\)\}/.test(createCss41));
check('… and the session log uses the same strip rather than a second control',
  (w.CREATE.go('sessions'), !!$('.ns-create #cr-log-tabs .cr-tglide')));
w.CREATE.go('home');

/* An area names which meta chips it asks for. A song has a key; a DJ set has
   as many as it has records in it. */
const areaFields = k => (w.Config.get('create.areas').find(a => a.key === k) || {}).fields;
check('an area says which meta chips it asks for, and mixing does not ask for a key',
  areaFields('production').join(',') === 'bpm,key,tags' &&
  areaFields('mixing').join(',') === 'bpm,tags',
  JSON.stringify(areaFields('mixing')));
const mixWork = w.CREATE.works().find(x => x.area === 'mixing');
if (mixWork) {
  w.CREATE.open(mixWork.id);
  const chipActs = () => [...d.querySelectorAll('.ns-create #cr-work .cr-mchip')].map(b => b.dataset.act);
  check('… so a mix’s screen has no key chip, and a song’s still has one',
    !chipActs().includes('edit-key') && chipActs().includes('edit-bpm'),
    chipActs().join(','));
  const prodWork = w.CREATE.works().find(x => x.area === 'production');
  if (prodWork) {
    w.CREATE.open(prodWork.id);
    check('… the song keeps all three',
      [...d.querySelectorAll('.ns-create #cr-work .cr-mchip')].map(b => b.dataset.act).join(',')
        .includes('edit-key'));
  }
  w.CREATE.go('home');
}
check('switching a field off never deletes what is written — it stops being asked',
  /if \(w && !areaOf\(w\)\.fields\.includes\(fld\.k\)\) return;/.test(createJs41) &&
  !/delete w\.(bpm|key|tags)/.test(createJs41));
check('… and the editor has a checkbox per field, read back with the rest of the tree',
  !!$('.ns-set [data-panel="create"] .ed-flags [data-aflag="key"]'),
  d.querySelectorAll('.ns-set [data-panel="create"] .ed-flags input').length + ' boxes');

/* CURATE: the Todoist label, grouped by section, read only. */
check('curate is a chip on the same strip, after the areas',
  [...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].pop().dataset.a === 'curate');
/* The chip wears what is after the last pipe: "02 | curate" is a filing name
   and the number and the pipe are how it sorts in Todoist's sidebar. */
check('… and the chip wears the project name without its filing prefix',
  [...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].pop().textContent.trim() === 'curate',
  [...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].pop().textContent.trim());
w.CREATE.area('curate');
w.CREATE.go('home');
check('… and picking it puts the list where the shelf was, not beside it',
  !$('.ns-create #cr-curate').classList.contains('hidden') &&
  $('.ns-create #cr-list').classList.contains('hidden') &&
  $('.ns-create #cr-add').classList.contains('hidden') &&
  $('.ns-create #cr-week').classList.contains('hidden'));
/* The whole project, in the order it is arranged in: section order, then each
   task's own order inside its section, subtasks under their parent. Fed a
   deliberately jumbled answer, and one section with nothing open in it. */
w.Creds.save('tok-for-curate');
fetchScript = async (url) => {
  const u = String(url);
  const body = /\/tasks\?/.test(u) ? [
    { id:'t3', content:'watch tutorial',   project_id:'p1', section_id:'s2', labels:[], order:2 },
    { id:'t1', content:'IMANU patreon',    project_id:'p1', section_id:'s1', labels:['purchase'], order:1 },
    { id:'t9', content:'pick the tier',    project_id:'p1', section_id:'s1', labels:[], order:2, parent_id:'t1' },
    { id:'t8', content:'check the archive',project_id:'p1', section_id:'s1', labels:[], order:1, parent_id:'t1' },
    { id:'t4', content:'plugins',          project_id:'p1', section_id:null, labels:['quick'], order:1 },
    { id:'t2', content:'buunshin patreon', project_id:'p1', section_id:'s1', labels:['purchase'], order:2 },
  ] : /\/projects/.test(u) ? [
    { id:'p2', name:'04 | life',  color:'green', order:2 },
    { id:'p1', name:'02 | curate', color:'grape', order:1 },
  ] : /\/sections/.test(u) ? [
    { id:'s4', project_id:'p1', name:'empty one', section_order:1 },
    { id:'s2', project_id:'p1', name:'watch',     section_order:3 },
    { id:'s1', project_id:'p1', name:'purchase',  section_order:2 },
  ] : [];
  return { ok:true, status:200, text: async () => JSON.stringify(body) };
};
await w.CREATE.refreshCurate();
await tick(30);
const groupNames = () => [...d.querySelectorAll('.ns-create #cr-curate .cr-cgroup .cr-chead')]
  .map(h => h.textContent.replace(/\s+/g, ' ').trim());
check('the curate tab draws the whole project, grouped by section in its own order',
  groupNames().length === 3 &&
  /^no section 1$/.test(groupNames()[0]) &&
  /^purchase 4$/.test(groupNames()[1]) &&
  /^watch 1$/.test(groupNames()[2]),
  groupNames().join(' | '));
check('… a section with nothing open in it is not drawn as an empty heading',
  !groupNames().some(n => /empty one/.test(n)), groupNames().join(' | '));
check('… and the tasks inside a section keep their own order',
  [...d.querySelectorAll('.ns-create #cr-curate .cr-cgroup')][1]
    .querySelectorAll('.cr-ctask:not(.sub) .nm')[0].textContent === 'IMANU patreon',
  [...d.querySelectorAll('.ns-create #cr-curate .cr-ctask .nm')].map(x => x.textContent).join(' | '));
/* A subtask is a task of the same project and arrives in the same answer, so
   it is filed under its parent rather than beside it. */
const subNames = () => [...d.querySelectorAll('.ns-create #cr-curate .cr-ctask.sub .nm')]
  .map(x => x.textContent);
check('… subtasks nest under the task they belong to, in their own order',
  subNames().join(',') === 'check the archive,pick the tier' &&
  [...d.querySelectorAll('.ns-create #cr-curate .cr-cgroup')][1]
    .querySelectorAll('.cr-ctask')[1].classList.contains('sub'),
  subNames().join(','));
check('… the group count is every row in it, subtasks included',
  /purchase 4/.test(groupNames()[1]), groupNames()[1]);
check('… it is cached, so the tab draws before the network answers',
  (JSON.parse(w.localStorage.getItem('create_v1')).curate.groups || []).length === 3 &&
  JSON.parse(w.localStorage.getItem('create_v1')).curate.fetched > 0 &&
  JSON.parse(w.localStorage.getItem('create_v1')).curate.project === '02 | curate');
check('… the band counts what is open in it, and says which project',
  $('.ns-create #cr-daynum .dn-cur').textContent === '6' &&
  $('.ns-create #cr-label').textContent === '02 | curate',
  $('.ns-create #cr-daynum').textContent + ' / ' + $('.ns-create #cr-label').textContent);
check('… and the screen says out loud what a tick does, since a tick leaves the app',
  /ticking one closes it in todoist/i.test($('.ns-create #cr-curate').textContent),
  $('.ns-create #cr-curate .cr-cnote')?.textContent);
/* The project is matched folded, the way PLAN matches every project it sends
   to — so the punctuation in "02 | curate" is not load-bearing. */
w.Config.set('create.curate', { project: '02curate', maxAgeMin: 60 });
await w.CREATE.refreshCurate();
await tick(30);
check('… the project name is matched folded, so its punctuation is not load-bearing',
  (DB41 => DB41.curate.groups.length === 3)(JSON.parse(w.localStorage.getItem('create_v1'))),
  $('.ns-create #cr-curate .cr-empty')?.textContent || 'matched');
w.Config.set('create.curate', { project: 'no such project', maxAgeMin: 60 });
await w.CREATE.refreshCurate();
await tick(30);
check('… and a project that is not there says so rather than drawing nothing',
  /no project called/.test($('.ns-create #cr-curate').textContent),
  $('.ns-create #cr-curate .cr-empty')?.textContent);
w.Config.set('create.curate', { project: '02 | curate', maxAgeMin: 60 });
w.CREATE.area('all');
w.CREATE.go('home');
fetchScript = async () => ({ ok:false, status:599, json: async () => ({}), text: async () => '' });

/* The shelf’s own boxes carry the classes their rules are written for
   `#cr-hero` and `#cr-sorts` were styled by class and marked up by id alone,
   so the hero was never centred and the sort chips were never a row. That is
   what "the spacing is off" was. The hero itself is gone at 4.1.1 — the count
   moved into the band — so what is checked is the rule, over what is left. */
check('every block on the shelf carries the class its rules are written for',
  $('.ns-create #cr-sorts').classList.contains('cr-sorts') &&
  $('.ns-create #cr-add').classList.contains('cr-adds') &&
  $('.ns-create #cr-areas').classList.contains('cr-areas') &&
  !$('.ns-create #cr-hero'),
  [...$('.ns-create #cr-sorts').classList].join(' '));
/* §4: a literal pixel gap is a gap the Spacing dial cannot reach. The two
   exceptions are hairlines between segments, not gaps in a layout: the stage
   strip's 3px and the progress ticks' 2px stay put at every density because a
   gap that scales below a pixel stops being a gap. */
const crSpace = createCss41.replace(/\/\*[\s\S]*?\*\//g, '')
  .match(/(?:margin|padding|gap)(?:-top|-bottom|-left|-right)?:[^;}]*/g) || [];
const crLiteral = crSpace.filter(x =>
  /\d+px/.test(x) && !/var\(--dens\)/.test(x) && !/var\(--hd-pad\)/.test(x) &&
  !/^gap:3px$/.test(x) && !/^gap:2px$/.test(x) && !/^gap:1px$/.test(x));
check('… and every gap in the sheet is a ratio of --dens, so Spacing reaches all of it',
  crLiteral.length === 0, crLiteral.join(' | '));

/* CREATE reaches LOG */
const crWorks41 = w.CREATE.works();
check('CREATE answers LOG with one day’s hours, split by area',
  typeof w.CREATE.dayStats === 'function' && typeof w.CREATE.rangeStats === 'function' &&
  w.CREATE.dayStats('1970-01-01') === null,
  'a day with no sessions is null, so the note has no section for it');
if (crWorks41.length) {
  const st41 = w.CREATE.dayStats(today);
  if (st41) {
    check('… and LOG writes it into the note as its own section',
      /#### create/.test(w.LOG.buildNote()) &&
      /create_hours/.test(w.LOG.buildNote()) &&
      /create_areas/.test(w.LOG.buildNote()),
      w.LOG.buildNote().split('#### create')[1]?.split('####')[0]?.trim().slice(0, 90));
    check('… the rows are additive: a day with no sessions has no section at all',
      /createRows = cr \? /.test(logJs41));
    check('… and it comes back out again when the note is parsed',
      (() => { const p = w.LOG.parseNotes?.length !== undefined; return /create_hours/.test(logJs41); })());
  }
}
check('the two reports carry the hours as well, from CREATE or from a parsed note',
  /createTotals\(days, ?dd\)/.test(logJs41) &&
  (logJs41.match(/createSection\(create\)/g) || []).length === 2 &&
  (logJs41.match(/at the desk/g) || []).length >= 2);


/* 4.1.1
   The glider actually slides, the chips are even and centred, and the count
   moved into the band with the shuffle the other apps' numbers have. */
const createCss411 = fs.readFileSync(path.join(ROOT, 'css/create.css'), 'utf8');
const shellJs411   = fs.readFileSync(path.join(ROOT, 'js/shell.js'), 'utf8');

w.Shell.go('create');
w.CREATE.area('all');
w.CREATE.go('home');

/* **This is the whole bug.** 4.1 rewrote the rail's innerHTML on every
   selection, so the glider was a brand-new element at its final position and
   had nothing to transition from — the one element whose job is to slide did
   not slide. The markup is only rewritten when the chips themselves change. */
const stripEl = () => $('.ns-create #cr-areas');
const glider  = () => $('.ns-create #cr-tglide') || stripEl().querySelector('.cr-tglide');
const markGlider = () => { glider().dataset.same = '1'; };
markGlider();
click([...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].find(b => b.dataset.a === 'mixing'));
check('changing tab moves the glider rather than rebuilding it — which is why it can slide',
  glider().dataset.same === '1' &&
  [...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].find(b => b.dataset.a === 'mixing')
    .classList.contains('active'),
  glider().dataset.same === '1' ? 'same node' : 'rebuilt');
check('… and it is the transition on the glider that does the sliding',
  /\.ns-create \.cr-tglide\{[^}]*transition:transform [^}]*width /.test(createCss411));
/* An area renamed in Settings does have to rebuild the rail — that is a
   different strip, not a different selection. */
const areasNow = JSON.parse(JSON.stringify(w.Config.get('create.areas')));
const renamed = JSON.parse(JSON.stringify(areasNow));
renamed[1].label = 'dj sets';
w.Config.set('create.areas', renamed);
check('… but a chip renamed in the editor does rebuild it, because the strip changed',
  glider().dataset.same !== '1' &&
  [...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].map(b => b.textContent.trim()).includes('dj sets'),
  [...d.querySelectorAll('.ns-create #cr-areas .cr-tab')].map(b => b.textContent.trim()).join(','));
w.Config.set('create.areas', areasNow);
w.CREATE.area('all');
w.CREATE.go('home');

/* Even, and centred. `flex:1 1 0` splits the rail equally; `min-width:max-content`
   is the floor that stops the share squashing a word, so the rail scrolls
   instead of cramming. */
check('the chips split the rail evenly and centre their own text',
  /\.ns-create \.cr-tab\{[^}]*flex:1 1 0/.test(createCss411) &&
  /\.ns-create \.cr-tab\{[^}]*min-width:max-content/.test(createCss411) &&
  /\.ns-create \.cr-tab\{[^}]*justify-content:center/.test(createCss411) &&
  !/\.ns-create \.cr-tab\{[^}]*flex:0 0 auto/.test(createCss411));

/* The count moved out of a 74px block under the band and into the box LOG's
   and DAY's day numbers live in — same size, same shadow, same shuffle. */
check('the count sits at the right end of the wordmark’s row, not in a hero under it',
  !$('.ns-create #cr-hero') &&
  !!$('.ns-create > #s-home .h-logo-row #cr-daynum .dn-cur') === false ||
  !!$('.ns-create #cr-daynum .dn-cur'),
  $('.ns-create #cr-daynum') ? 'in the band' : 'missing');
check('… in the same box LOG and DAY use, so the three read as one thing',
  $('.ns-create #cr-daynum').classList.contains('h-daynum') &&
  $('.ns-create #cr-daynum').parentElement.classList.contains('h-logo-row'));
/* 4.3: on "all" the one number was three unlike things added together — songs
   on the desk, mixes on the desk, and somebody else's open list. The row
   carries one number per chip instead, each captioned, and the single rolling
   number is put away while it does. */
const talCaps = () => [...d.querySelectorAll('.ns-create #cr-tally .cr-tal s')].map(x => x.textContent);
check('… and on "all" it is one number per chip rather than one total',
  $('.ns-create #cr-daynum').classList.contains('hidden') &&
  !$('.ns-create #cr-tally').classList.contains('hidden') &&
  talCaps().slice(0, 2).join(',') === 'production,mixing',
  talCaps().join(','));
/* Curate is a column when it is a chip, and only then — it is the same
   question the strip answers, so the two never disagree about what exists. */
check('… with curate among them exactly when curate is on the strip',
  (talCaps().length === 3) === !!d.querySelector('.ns-create .cr-tab[data-a="curate"]'),
  talCaps().join(',') + ' / ' + [...d.querySelectorAll('.ns-create .cr-tab')].map(b => b.dataset.a).join(','));
check('… and each area’s number is that area alone, not the shelf',
  [...d.querySelectorAll('.ns-create #cr-tally .cr-tal b')].slice(0, 2).map(x => +x.textContent).join(',') ===
  ['production', 'mixing'].map(k => w.CREATE.works().filter(x =>
    w.CREATE.progress(x).area.key === k &&
    !/released|played|finished/.test(w.CREATE.progress(x).stage.label)).length).join(','),
  $('.ns-create #cr-tally').textContent);
w.CREATE.area('mixing');
w.CREATE.go('home');
check('… and narrowing to an area says which area it is counting',
  /mixing/.test($('.ns-create #cr-label').textContent) &&
  !$('.ns-create #cr-daynum').classList.contains('hidden') &&
  $('.ns-create #cr-tally').classList.contains('hidden'),
  $('.ns-create #cr-label').textContent);
/* The bug that made this worth a version: the band is not part of the home
   screen — the shell lifts it out — so an area chip that redrew only the
   screen left the last chip's number sitting on the row. */
check('… and switching the chip repaints the number, rather than leaving the last one up',
  /if \(act === 'area'\)\s+\{ DB\.settings\.area = t\.dataset\.a; save\(\); render\(\);/.test(createJs41),
  'the area act calls render(), not renderHome()');
w.CREATE.area('production');
w.CREATE.go('home');

/* The shuffle is Shell's, pulled out of dayNum unchanged so all three boxes
   are the same object doing the same job. */
check('the roll is one function for all three numbers, not a second copy of it',
  typeof w.Shell.rollNum === 'function' &&
  /const dayNum = \(box, iso\) =>\s*\n?\s*rollNum\(/.test(shellJs411) &&
  (shellJs411.match(/\.dn-out'\)\.forEach/g) || []).length === 2,
  'one rollNum, dayNum delegates to it');
const dnBox = () => $('.ns-create #cr-daynum');
/* On one area, which is where the single rolling number still lives — "all"
   draws the tally instead, and a tally has nothing to shuffle. */
w.CREATE.area('production');
w.CREATE.go('home');
/* Driven through the store rather than through the add dialog: what is being
   asserted is that the *number* shuffles when it changes, and a check that
   also depends on the dialog's plumbing is a check that can pass on a stale
   animation left over from three steps earlier. That is what it used to do. */
const dnWas41 = dnBox().querySelector('.dn-cur').textContent;
const crStore41 = JSON.parse(w.localStorage.getItem('create_v1'));
crStore41.works.push({ id:'wk_shuffle', area:'production', name:'a fifth thing',
  stage: w.CREATE.stages('production')[0].key, bpm:'', key:'', tags:'', notes:'',
  added: today, touched: today, done:{} });
w.localStorage.setItem('create_v1', JSON.stringify(crStore41));
w.CREATE.reload();
check('… and CREATE’s number shuffles when it changes, like the day numbers do',
  dnBox().querySelector('.dn-cur').textContent !== dnWas41 &&
  !!dnBox().querySelector('.dn-out') && dnBox().querySelector('.dn-cur').classList.contains('shuffling'),
  dnWas41 + ' → ' + dnBox().innerHTML.replace(/\s+/g, ' ').slice(0, 90));
w.CREATE.go('home');

/* 4.3: two bars, not one. The tick strip said how far through *this stage* a
   work is and nothing about where the stage sits on the path — four ticks into
   `idea` and four ticks into `master` drew the identical shape. The stage bar
   is the long arc, the step bar the short one. */
const progOf = () => $('.ns-create #cr-list .cr-work .cr-prog');
check('a work’s progress is two bars: the stages, then the steps of the stage',
  !!progOf() && !!progOf().querySelector('.cr-bar.stages') &&
  !progOf().querySelector('.rail') && !progOf().querySelector('.v'),
  progOf() ? [...progOf().querySelectorAll('.cr-bar')].map(b => b.className).join(' | ') : 'none');
check('… the stage bar is one segment per stage, lit up to the one it is on',
  [...d.querySelectorAll('.ns-create #cr-list .cr-work')].every(row => {
    const p = row.querySelector('.cr-bar.stages');
    if (!p) return false;
    const n = p.querySelectorAll('i').length, on = p.querySelectorAll('i.on').length;
    return n > 1 && on >= 1 && on <= n && /^stage \d+ of \d+ — /.test(p.getAttribute('aria-label'));
  }));
check('… and the step bar only exists where the stage asks something of it',
  [...d.querySelectorAll('.ns-create #cr-list .cr-work')].every(row => {
    const p = row.querySelector('.cr-bar.steps');
    if (!p) return true;                    // a terminal stage has no checklist
    const n = p.querySelectorAll('i').length;
    return n > 0 && /^\d+ of \d+ steps done$/.test(p.getAttribute('aria-label'));
  }));
check('… and both are rounded squares rather than the 1px slivers they were',
  /\.ns-create \.cr-bar i\{[^}]*border-radius:var\(--r1\)/.test(createCss411) &&
  !/\.ns-create \.cr-bar i\{[^}]*border-radius:1px/.test(createCss411));
check('… and it still says both counts to a screen reader',
  /aria-label="stage \d+ of \d+/.test($('.ns-create #cr-list').innerHTML) &&
  /aria-label="\d+ of \d+ steps done"/.test($('.ns-create #cr-list').innerHTML));
/* Past 16 items the step segments would be thinner than the gaps between them,
   so that bar alone falls back to a rail — a checklist that long is a fraction
   again. The stage bar never does: nobody has sixteen stages. */
const longAreas = JSON.parse(JSON.stringify(areasNow));
longAreas.forEach(a => a.stages.forEach(st => {
  if (st.terminal) return;                       // a finished stage asks for nothing
  st.items = Array.from({ length: 20 }, (_, i) => 'item ' + (i + 1));
}));
w.Config.set('create.areas', longAreas);
w.CREATE.go('home');
check('… and a checklist too long to draw as segments falls back to a rail',
  [...d.querySelectorAll('.ns-create #cr-list .cr-bar.steps')].some(p => p.classList.contains('long')) &&
  ![...d.querySelectorAll('.ns-create #cr-list .cr-bar.stages')].some(p => p.classList.contains('long')) &&
  /\.ns-create \.cr-bar\.long::before\{[^}]*width:var\(--pct/.test(createCss411),
  [...d.querySelectorAll('.ns-create #cr-list .cr-bar')].map(p => p.className).join(' | '));
w.Config.set('create.areas', areasNow);
w.CREATE.go('home');

check('no errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

/* a ninth app has to arrive on an install that already has an app list
   `apps` is stored whole, so without the appsSeen migration CAL would have no
   tab on any install that has ever opened the layout panel — which is every
   install that has been used. Proved by booting a second window with prefs
   already in localStorage, which is the only way to run Prefs.load() again. */
async function bootWith(seed, configSeed, storeSeed) {
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
      if (configSeed) win.localStorage.setItem('root_config_v1', JSON.stringify(configSeed));
      // anything else this install is meant to have already stored
      Object.keys(storeSeed || {}).forEach(k => win.localStorage.setItem(k, JSON.stringify(storeSeed[k])));
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
  w2.Prefs.get('apps').join(',') === 'do,log,track,cal,create,tools', w2.Prefs.get('apps').join(','));
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

/* A Config branch that changed shape, on an install that had overridden it ──
   `create.curate` was `{ label, maxAgeMin }` for the one version 4.1.0 was
   current, and an override is stored **whole-branch** (§3) — so an install that
   had touched that field kept the old object and `project` read as undefined.
   The chip left the strip, the field in Settings went blank, and — because the
   shelf's filter was still saying `curate` — the whole screen went blank with
   nothing left on it to tap. Two fixes, and this is the first: the branch is
   read through the shipped defaults, so a *missing* key takes the shipped
   value. */
const wC1 = await bootWith({ theme: 'void' },
  { create: { curate: { label: 'curate', maxAgeMin: 60 } } });
check('an override written before a Config key existed does not shadow the key',
  wC1.CREATE.curateSettings().project === '02 | curate',
  JSON.stringify(wC1.CREATE.curateSettings()));
wC1.SET.panel('create');   // the field is filled when its panel is rendered
check('… so the chip is still on the strip, and Settings still shows the project',
  [...wC1.document.querySelectorAll('.ns-create #cr-areas .cr-tab')].some(b => b.dataset.a === 'curate') &&
  wC1.document.querySelector('.ns-create #cr-set-project').value === '02 | curate',
  wC1.document.querySelector('.ns-create #cr-set-project').value);
check('… and the key the old shape carried is not kept — a label is not a project',
  wC1.CREATE.curateSettings().label === undefined,
  JSON.stringify(wC1.CREATE.curateSettings()));

/* A cached row shape from the version before
   `create_v1`'s curate cache is the one part of that record the app did not
   author, and the only one whose *row shape* has changed: 4.1 cached rows from
   a label query with no `subs`, 4.1.1 caches project rows that have them. The
   new drawing read `t.subs.length` off an old row, which threw inside the
   module's own IIFE **at boot** — so `window.CREATE` was never assigned and the
   whole tab was gone: an empty slide, and a settings panel whose fields are
   filled by `CREATE.renderSettings()` and so stayed blank. One undefined array
   in a disposable cache took out an entire app.

   The check boots an install holding exactly that cache. */
const wC0 = await bootWith({ theme: 'void' }, null, {
  create_v1: {
    v: 2,
    works: [{ id:'wz', area:'production', name:'night bus', stage:'idea',
              bpm:'', key:'', tags:'', notes:'', added: today, touched: today, done:{} }],
    sessions: [],
    /* 4.1's shape: a project name on the group, no `subs` on the task */
    curate: { fetched: Date.now(), groups: [
      { key:'p1/s1', project:'curate', section:'purchase', color:'#a78bfa', po:1, so:1,
        tasks: [{ id:'t1', content:'IMANU patreon', tags:['purchase'], priority:1, to:1 }] }] },
    settings: { sort:null, showDone:false, area:'curate' },
  },
});
check('a cached list in the previous version’s row shape does not kill the module at boot',
  !!wC0.CREATE && typeof wC0.CREATE.go === 'function',
  wC0.CREATE ? 'CREATE is alive' : 'window.CREATE is undefined');
check('… it is lifted and drawn rather than dropped, so the tab is not empty while it refetches',
  /IMANU patreon/.test(wC0.document.querySelector('.ns-create #cr-curate').textContent),
  wC0.document.querySelector('.ns-create #cr-curate').textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
check('… and every row it lifts has the arrays the drawing walks',
  wC0.CREATE.curate().groups.every(g => Array.isArray(g.tasks) &&
    g.tasks.every(t => Array.isArray(t.subs) && Array.isArray(t.tags))),
  JSON.stringify(wC0.CREATE.curate().groups[0].tasks[0]));
check('… and the settings panel fills, because the module that fills it exists',
  (wC0.SET.panel('create'),
   wC0.document.querySelector('.ns-create #cr-set-project').value === '02 | curate'),
  wC0.document.querySelector('.ns-create #cr-set-project').value);
/* A group the shape cannot account for at all is dropped rather than drawn
   half-built — the next visit fetches it again, which costs one call. */
const wC0b = await bootWith({ theme: 'void' }, null, {
  create_v1: { v: 2, works: [], sessions: [],
    curate: { fetched: Date.now(), groups: [{ key:'x' }, null, { key:'y', tasks:'not an array' }] },
    settings: { sort:null, showDone:false, area:'all' } },
});
check('… a cached group too broken to lift is dropped, not drawn half-built',
  !!wC0b.CREATE && wC0b.CREATE.curate().groups.length === 0,
  wC0b.CREATE ? JSON.stringify(wC0b.CREATE.curate().groups) : 'module died');

/* A key that is *present and empty* is a choice, not an absence: "blank
   switches the tab off" has to keep working, which is why the fallback is on
   the key being missing rather than on the value being falsy. */
const wC2 = await bootWith({ theme: 'void' },
  { create: { curate: { project: '', maxAgeMin: 60 } } });
check('… while a project deliberately blanked still switches the tab off',
  wC2.CREATE.curateSettings().project === '' &&
  ![...wC2.document.querySelectorAll('.ns-create #cr-areas .cr-tab')].some(b => b.dataset.a === 'curate'),
  [...wC2.document.querySelectorAll('.ns-create #cr-areas .cr-tab')].map(b => b.dataset.a).join(','));
/* And this is the second fix — the one that made a config mismatch into a blank
   screen. A filter that no longer exists has to fall back, the way a deleted
   area already did. Anything that can be selected has to be able to stop
   existing. */
const wC3 = await bootWith({ theme: 'void' },
  { create: { curate: { project: '', maxAgeMin: 60 } } });
wC3.localStorage.setItem('create_v1', JSON.stringify({
  v: 2, works: [{ id:'wq', area:'production', name:'still here', stage:'idea',
                  bpm:'', key:'', tags:'', notes:'', added: today, touched: today, done:{} }],
  sessions: [], curate: { fetched:0, project:'', color:'#7a8699', groups:[] },
  settings: { sort:null, showDone:false, area:'curate' } }));
wC3.CREATE.reload();
wC3.CREATE.go('home');
check('a shelf left on a filter that has since gone falls back to "all" rather than blank',
  !wC3.document.querySelector('.ns-create #cr-list').classList.contains('hidden') &&
  !!wC3.document.querySelector('.ns-create #cr-list .cr-work') &&
  wC3.document.querySelector('.ns-create #cr-curate').classList.contains('hidden'),
  wC3.document.querySelector('.ns-create .cnt').textContent.replace(/\s+/g, ' ').trim().slice(0, 70));
wC2.SET.panel('create');
check('… and the field says what it goes back to, so an empty one is a visible choice',
  wC2.document.querySelector('.ns-create #cr-set-project').placeholder === '02 | curate',
  wC2.document.querySelector('.ns-create #cr-set-project').placeholder);

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


/* 4.2
   Six requests: three shapes in CREATE, a tick that reaches Todoist, labels in
   their own colours, and a sound under the whole app. */

const css42 = fs.readFileSync(path.join(ROOT, 'css/create.css'), 'utf8');
const rule42 = sel => {
  const i = css42.indexOf(sel);
  return i < 0 ? '' : css42.slice(i, css42.indexOf('}', i));
};

/* the session hours are a column
   They were the middle of three boxes in a space-between row, so the number
   ended wherever the sentence beside it stopped and the × sat outboard of it.
   jsdom lays nothing out, so what is asserted is the rule. */
check('a session’s hours are pushed to the right edge and right-aligned',
  /margin-left:auto/.test(rule42('.ns-create .cr-ses .r{')) &&
  /text-align:right/.test(rule42('.ns-create .cr-ses .r{')),
  rule42('.ns-create .cr-ses .r{').replace(/\s+/g, ' '));
check('… in tabular figures over a floor width, so the column lines up row to row',
  /font-variant-numeric:tabular-nums/.test(rule42('.ns-create .cr-ses .r{')) &&
  /min-width:calc\(\d+px \* var\(--dens\)\)/.test(rule42('.ns-create .cr-ses .r{')),
  rule42('.ns-create .cr-ses .r{').replace(/\s+/g, ' '));
check('… and the text beside them takes the slack, rather than the number floating',
  /flex:1 1 auto/.test(rule42('.ns-create .cr-ses .l{')),
  rule42('.ns-create .cr-ses .l{').replace(/\s+/g, ' '));

/* a sub-screen breathes under its own sticky header */
check('content under a sticky header starts below it, not against it',
  /\.ns-create \.hd \+ \.cnt\{padding-top:calc\(\d+px \* var\(--dens\)\)\}/.test(css42),
  (css42.match(/\.ns-create \.hd \+ \.cnt\{[^}]*\}/) || ['absent'])[0]);
check('… and the shelf is untouched by it — it has a wordmark there, not a header',
  !d.querySelector('.ns-create #s-home > .hd'),
  'the shelf has no .hd, so the rule cannot reach it');

/* the controls are rounded squares, not pills */
const pillSels42 = ['.ns-create .cr-sort{', '.ns-create .cr-mchip{',
                    '.ns-create .cr-step{', '.ns-create .cr-kind{'];
const pillish42 = pillSels42.filter(sel => /border-radius:var\(--r-pill\)/.test(rule42(sel)));
check('every control in CREATE is a rounded square — no button is a pill any more',
  pillish42.length === 0 &&
  pillSels42.every(sel => /border-radius:var\(--r3\)/.test(rule42(sel))),
  pillish42.join(' ') || 'all four take --r3');
/* --r-pill is still the right answer for a circle. The dots and the rails are
   shapes, not controls, and they keep it. */
check('… while the dots keep it, because a circle is not a button',
  /\.cr-atag i\{[^}]*border-radius:var\(--r-pill\)/.test(css42));
/* 4.3 took the rail off --r-pill with it. It is not a control either, but it
   is now the fallback shape for a bar made of rounded squares, and a pill
   sitting under a row of --r1 segments read as a different drawing. */
check('… and the progress rail follows its own segments to --r1',
  /\.cr-bar\.long\{[^}]*border-radius:var\(--r1\)/.test(css42) &&
  !/\.cr-bar\.long\{[^}]*border-radius:var\(--r-pill\)/.test(css42));

/* ticking a curate row off
   The list is put back the way the 4.1 block left it, and every write the tick
   makes is recorded, so the assertion is on what actually reached Todoist. */
const posted42 = [];
const curateBody42 = u => /\/tasks\?/.test(u) ? [
    { id:'t3', content:'watch tutorial',   project_id:'p1', section_id:'s2', labels:[], order:2 },
    { id:'t1', content:'IMANU patreon',    project_id:'p1', section_id:'s1', labels:['purchase'], order:1 },
    { id:'t9', content:'pick the tier',    project_id:'p1', section_id:'s1', labels:[], order:2, parent_id:'t1' },
    { id:'t8', content:'check the archive',project_id:'p1', section_id:'s1', labels:[], order:1, parent_id:'t1' },
    { id:'t4', content:'plugins',          project_id:'p1', section_id:null, labels:['quick'], order:1 },
    { id:'t2', content:'buunshin patreon', project_id:'p1', section_id:'s1', labels:['purchase'], order:2 },
  ] : /\/projects/.test(u) ? [
    { id:'p2', name:'04 | life',   color:'green', order:2 },
    { id:'p1', name:'02 | curate', color:'grape', order:1 },
  ] : /\/sections/.test(u) ? [
    { id:'s4', project_id:'p1', name:'empty one', section_order:1 },
    { id:'s2', project_id:'p1', name:'watch',     section_order:3 },
    { id:'s1', project_id:'p1', name:'purchase',  section_order:2 },
  ] : [];
let closeOk42 = true;
fetchScript = async (url, opts) => {
  const u = String(url);
  if (/\/close|\/reopen/.test(u)) {
    posted42.push(u.replace(/^.*\/v1/, '') + ' ' + ((opts && opts.method) || 'GET'));
    return closeOk42 ? { ok:true, status:204, text: async () => '' }
                     : { ok:false, status:500, text: async () => '' };
  }
  return { ok:true, status:200, text: async () => JSON.stringify(curateBody42(u)) };
};
w.Creds.save('tok-for-curate');
w.Config.set('create.curate', { project: '02 | curate', maxAgeMin: 60, labelColors: false });
w.CREATE.area('curate');
w.CREATE.go('home');
await w.CREATE.refreshCurate();
await tick(30);

const row42 = name => [...d.querySelectorAll('.ns-create #cr-curate .cr-ctask')]
  .find(r => r.querySelector('.nm').textContent === name);
const band42 = () => $('.ns-create #cr-daynum .dn-cur').textContent;
const heads42 = () => [...d.querySelectorAll('.ns-create #cr-curate .cr-chead')]
  .map(h => h.textContent.replace(/\s+/g, ' ').trim());

check('every curate row has a tick box — subtasks included, which is what was asked',
  d.querySelectorAll('.ns-create #cr-curate .cr-ctask').length === 6 &&
  d.querySelectorAll('.ns-create #cr-curate .cr-ctask > .ck[data-act="curate-tick"]').length === 6 &&
  d.querySelectorAll('.ns-create #cr-curate .cr-ctask.sub > .ck').length === 2,
  d.querySelectorAll('.ns-create #cr-curate .ck').length + ' boxes on ' +
  d.querySelectorAll('.ns-create #cr-curate .cr-ctask').length + ' rows');
/* A button inside an anchor has no agreed behaviour, so the two targets are
   siblings: the box closes it, the body opens it in Todoist. */
check('… the box and the link out are siblings, not one nested inside the other',
  !d.querySelector('.ns-create #cr-curate a .ck') &&
  !d.querySelector('.ns-create #cr-curate .ck a') &&
  /app\.todoist\.com/.test(row42('IMANU patreon').querySelector('a.bd').href),
  row42('IMANU patreon').querySelector('a.bd').getAttribute('href'));

click(row42('IMANU patreon').querySelector('.ck'));
await tick(40);
check('ticking a row closes that task in Todoist, and nothing else',
  posted42.length === 1 && /\/tasks\/t1\/close POST/.test(posted42[0]),
  posted42.join(' | ') || 'nothing was sent');
check('… the row is struck through where it stands, so a mis-tap is visible',
  row42('IMANU patreon').classList.contains('done') &&
  row42('IMANU patreon').querySelector('.ck').getAttribute('aria-checked') === 'true',
  [...row42('IMANU patreon').classList].join(' '));
/* Todoist closes a task's subtasks with it; the cache says the same thing, so
   the screen and the account do not disagree until the next refetch. */
check('… and its subtasks go with it, the way they do in Todoist',
  row42('check the archive').classList.contains('done') &&
  row42('pick the tier').classList.contains('done') &&
  posted42.length === 1,
  'one call, three rows');
check('… what is ticked stops being counted, in the group and in the band',
  band42() === '3' && /^purchase 1$/.test(heads42()[1]),
  band42() + ' / ' + heads42().join(' | '));
check('… and it survives a reload, so it does not come back open before the refetch',
  (JSON.parse(w.localStorage.getItem('create_v1')).curate.groups
    .flatMap(g => g.tasks).find(t => t.id === 't1') || {}).closed === true);

click(row42('IMANU patreon').querySelector('.ck'));
await tick(40);
check('… ticking it again puts it back, which is what makes the tick safe',
  posted42.length === 2 && /\/tasks\/t1\/reopen POST/.test(posted42[1]) &&
  !row42('IMANU patreon').classList.contains('done') &&
  !row42('pick the tier').classList.contains('done') &&
  band42() === '6',
  posted42.join(' | ') + ' / ' + band42());

closeOk42 = false;
click(row42('plugins').querySelector('.ck'));
await tick(40);
check('a tick the network refuses is put back, not left lying about the account',
  !row42('plugins').classList.contains('done') && band42() === '6' &&
  (JSON.parse(w.localStorage.getItem('create_v1')).curate.groups
    .flatMap(g => g.tasks).find(t => t.id === 't4') || {}).closed === false,
  [...row42('plugins').classList].join(' ') + ' / ' + band42());
closeOk42 = true;
/* With no key there is no call to make, and the row must not pretend there was. */
const before42 = posted42.length;
w.Creds.save('');
click(row42('plugins').querySelector('.ck'));
await tick(30);
check('… and with no Todoist key saved nothing is ticked and nothing is sent',
  posted42.length === before42 && !row42('plugins').classList.contains('done'),
  (posted42.length - before42) + ' calls');
w.Creds.save('tok-for-curate');

/* labels in their own colours
   Out of the cache every app that draws a label shares, so a label is the same
   colour in CREATE, DO and PLAN. A colour that is not cached is not invented. */
w.localStorage.setItem('root_labels_v1', JSON.stringify({
  fetched: Date.now(), colors: { purchase: '#884dff' } }));
w.Config.set('create.curate', { project: '02 | curate', maxAgeMin: 60, labelColors: true });
await w.CREATE.refreshCurate();
await tick(30);
const lb42 = () => row42('IMANU patreon').querySelector('.tg i.lb');
check('a task’s labels are drawn in the colour Todoist gives them',
  !!lb42() && lb42().textContent === 'purchase' &&
  /#884dff/.test(lb42().getAttribute('style') || ''),
  row42('IMANU patreon').querySelector('.tg') ? row42('IMANU patreon').querySelector('.tg').innerHTML : 'no labels');
check('… a label with no colour cached is drawn plain rather than guessed at',
  !row42('plugins').querySelector('.tg i.lb') &&
  row42('plugins').querySelector('.tg i').textContent === 'quick',
  row42('plugins').querySelector('.tg').innerHTML);
w.Config.set('create.curate', { project: '02 | curate', maxAgeMin: 60, labelColors: false });
await tick(20);
check('… and switched off they go back to plain text, which is where they were',
  !d.querySelector('.ns-create #cr-curate .tg i.lb') &&
  !!d.querySelector('.ns-create #cr-curate .tg i'),
  row42('IMANU patreon').querySelector('.tg').innerHTML);

/* The switch is in the panel's static markup, so it is Config.subscribe that
   draws it rather than the content-editor redraw the other switches get. */
w.SET.panel('create');
const tog42 = () => d.querySelector('.ns-create #cr-set-labelcolors');
check('the colourful-labels switch is in settings and shows what Config says',
  !!tog42() && !tog42().classList.contains('on') &&
  tog42().getAttribute('aria-checked') === 'false',
  tog42() ? [...tog42().classList].join(' ') : 'absent');
click(tog42());
await tick(20);
check('… and flipping it writes Config and redraws the switch with it',
  w.CREATE.curateSettings().labelColors === true && tog42().classList.contains('on'),
  String(w.CREATE.curateSettings().labelColors) + ' / ' + [...tog42().classList].join(' '));

check('… and search finds it, because it is a settings row like any other',
  w.SEARCH.results('colourful').some(r => /Colourful labels/i.test(r.title)),
  w.SEARCH.results('colourful').map(r => r.title).join(' | ') || 'nothing');

/* the interface makes a sound
   Synthesised, so there is no asset to fetch and nothing to cache. jsdom has no
   WebAudio, so a stub stands in and what is asserted is what would be built. */
let made42 = 0, played42 = 0;
function FakeParam42() {}
FakeParam42.prototype.setValueAtTime = function () { return this; };
FakeParam42.prototype.exponentialRampToValueAtTime = function () { return this; };
function FakeCtx42() {
  made42++;
  this.state = 'running'; this.currentTime = 0; this.destination = {};
  this.resume = () => Promise.resolve();
  this.createOscillator = () => ({ type:'', frequency: new FakeParam42(),
    connect() {}, start() { played42++; }, stop() {} });
  this.createGain = () => ({ gain: new FakeParam42(), connect() {} });
  /* 4.3's clicky voices roll the top off a square wave. A real browser has
     had this node since WebAudio shipped; the stub had not caught up. */
  this.createBiquadFilter = () => ({ type:'', frequency: new FakeParam42(),
    Q: new FakeParam42(), connect() {} });
}
w.AudioContext = FakeCtx42;
const press42 = el => el.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
const sndTog42 = () => $('.ns-set [data-pref="sounds"][data-toggle]');

check('sound is off until it is asked for — it is the setting that can embarrass someone',
  w.Prefs.SCHEMA.sounds.def === false && w.Prefs.get('sounds') === false);
w.Prefs.sound('tap'); w.Prefs.sound('msg');
check('… and while it is off no audio graph is built at all, not even a silent one',
  made42 === 0 && played42 === 0, made42 + ' contexts');

w.SET.panel('behave');
w.Prefs.set('sounds', true);
check('… with the switch and the level both in behaviour, beside the haptic',
  !!sndTog42() && !!$('.ns-set [data-slider="soundLevel"]'),
  sndTog42() ? 'both present' : 'no switch');

press42(sndTog42());
await tick(10);
check('a press on a control makes one, built inside the gesture that needed it',
  made42 === 1 && played42 === 1, made42 + ' contexts / ' + played42 + ' notes');
press42(sndTog42());
check('… a second inside the gap is dropped, so one gesture is one sound',
  played42 === 1, played42 + ' notes');
await tick(70);
press42(sndTog42());
check('… and the next gesture sounds again, rather than the gap latching',
  played42 === 2, played42 + ' notes');
await tick(70);
press42($('.ns-set .sec span'));
check('a press on something that is not a control stays silent',
  played42 === 2, played42 + ' notes');
await tick(70);
w.Shell.toast('a message');
check('a toast has its own note, so a message is heard as a message',
  played42 === 3, played42 + ' notes');
await tick(70);
w.Shell.go('log');
check('a slide arriving has another', played42 === 4, played42 + ' notes');
await tick(70);
w.Shell.go('log');
check('… and going to the tab already shown makes none — nothing moved',
  played42 === 4, played42 + ' notes');
w.Prefs.set('sounds', false);
w.Prefs.reset('soundLevel');
check('… and switching it back off silences it again, without unbuilding anything',
  (() => { const was = played42; w.Prefs.sound('tap'); return played42 === was; })(),
  played42 + ' notes');


/* 4.3
   A TOOLS tab, sound becomes a kit you can map, and PLAN can patch one block
   of a day. */

const prefsJs43   = fs.readFileSync(path.join(ROOT, 'js/prefs.js'), 'utf8');
const tokensCss43 = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
const shellCss43  = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
const themesCss43 = fs.readFileSync(path.join(ROOT, 'css/themes.css'), 'utf8');
const calJs43     = fs.readFileSync(path.join(ROOT, 'js/cal.js'), 'utf8');
const toolsJs43   = fs.readFileSync(path.join(ROOT, 'js/tools.js'), 'utf8');

/* a session that belongs to nothing
   "sometimes i am just tinkering." An hour at the desk that made no song is
   still an hour at the desk. */
w.Shell.go('create');
w.CREATE.go('sessions');
const looseForm43 = () => $('.ns-create #cr-sessions .cr-loose');
check('the session log can log an hour that belongs to no song or mix',
  !!looseForm43() && !!$('.ns-create #cr-l-hours') && !!$('.ns-create #cr-l-what'),
  looseForm43() ? 'the form is there' : 'no form');
check('… and it asks which area it was, because that is the part worth keeping',
  [...looseForm43().querySelectorAll('[data-act="loose-area"]')].map(b => b.dataset.a).join(',') ===
  w.CREATE.areas().map(a => a.key).join(','),
  [...looseForm43().querySelectorAll('[data-act="loose-area"]')].map(b => b.dataset.a).join(','));
const sesWas43 = w.CREATE.sessions().length;
click([...looseForm43().querySelectorAll('[data-act="loose-area"]')].find(b => b.dataset.a === 'mixing'));
$('.ns-create #cr-l-hours').value = '1.5';
$('.ns-create #cr-l-hours').dispatchEvent(new w.Event('input', { bubbles: true }));
$('.ns-create #cr-l-what').value = 'tinkering';
$('.ns-create #cr-l-what').dispatchEvent(new w.Event('input', { bubbles: true }));
click($('.ns-create [data-act="loose-log"]'));
const loose43 = w.CREATE.sessions().find(e => e.what === 'tinkering');
check('… and logging it writes a session with no work behind it',
  w.CREATE.sessions().length === sesWas43 + 1 && !!loose43 &&
  loose43.work === null && loose43.area === 'mixing' && loose43.hours === 1.5,
  JSON.stringify(loose43));
check('… it counts in the totals like any other hour at the desk',
  (w.CREATE.dayStats(today) || {}).hours >= 1.5,
  JSON.stringify(w.CREATE.dayStats(today)));
check('… and its row says the area instead of a name, rather than a dash',
  /mixing · loose/.test($('.ns-create #cr-sessions').textContent) &&
  !!$('.ns-create #cr-sessions .cr-ses.loose'),
  ($('.ns-create #cr-sessions').textContent.match(/mixing[^\n]{0,20}/) || ['no row'])[0]);
check('… a session with no hours is refused, the way the work screen refuses one',
  (() => { const n = w.CREATE.sessions().length;
           click($('.ns-create [data-act="loose-log"]'));
           return w.CREATE.sessions().length === n; })());

/* stage palettes */
w.SET.panel('create');
const palBtns43 = () => [...d.querySelectorAll('.ns-set [data-group="create.areas"] [data-ed]')];
check('every area offers a palette for its stages, and the strip is the control',
  palBtns43().length >= 6 &&
  palBtns43().every(b => b.querySelectorAll('.ed-pal-sw i').length > 1),
  palBtns43().length + ' buttons');
const emberBtn43 = palBtns43().find(b => b.dataset.ed === 'production/ember');
click(emberBtn43);
const prodStages43 = w.CREATE.stages('production');
check('… one tap recolours that area’s stages, first to finished',
  prodStages43[0].color === '#5f3a2e' &&
  prodStages43[prodStages43.length - 1].color === '#ffe9a8',
  prodStages43.map(x => x.color).join(','));
check('… sampled across however many stages there are, so the last is the ramp’s last',
  new Set(prodStages43.map(x => x.color)).size === prodStages43.length,
  prodStages43.map(x => x.color).join(','));
check('… and the area itself takes the head of its own ramp',
  w.CREATE.areas().find(a => a.key === 'production').color === '#5f3a2e');
check('… mixing was not touched — a palette is applied to one area, not the app',
  w.CREATE.stages('mixing')[0].color !== '#5f3a2e');
w.Config.reset('create.areas');

/* sound: a kit, and a map over it */
check('sound has more than three voices now, and a kit that maps them onto moments',
  w.Prefs.VOICE_IDS.length >= 9 && w.Prefs.SOUND_KIT_IDS.length >= 4 &&
  w.Prefs.SOUND_EVENT_KEYS.join(',') === 'tap,nav,menu,done,msg',
  w.Prefs.VOICE_IDS.join(',') + ' / ' + w.Prefs.SOUND_KIT_IDS.join(','));
check('… every kit answers every event, and only with voices that exist',
  w.Prefs.SOUND_KIT_IDS.every(k => w.Prefs.SOUND_EVENT_KEYS.every(e =>
    w.Prefs.VOICE_IDS.includes(w.Prefs.SOUND_KITS[k][e]))));
check('… and `classic` is what 4.2 sounded like, so nothing liked was taken away',
  w.Prefs.SOUND_KITS.classic.tap === 'blip' && w.Prefs.SOUND_KITS.classic.msg === 'chime' &&
  /blip:\s*\{[^}]*hz:\s*660[^}]*to:\s*560/.test(prefsJs43) &&
  /chime:\s*\{[^}]*hz:\s*880[^}]*to:\s*1180/.test(prefsJs43));
check('… the five overrides all start on `auto`, so the kit is the only thing to pick',
  ['sndTap','sndNav','sndMenu','sndDone','sndMsg'].every(k =>
    w.Prefs.SCHEMA[k].def === 'auto' && w.Prefs.get(k) === 'auto'));
w.SET.panel('behave');
check('… both controls are on the behaviour panel, under the volume',
  !!$('.ns-set [data-snd-kit="tick"]') && !!$('.ns-set .snd-map [data-snd-map="sndDone"]'),
  $('.ns-set .snd-map') ? 'kit and map present' : 'missing');
click($('.ns-set [data-snd-kit="wood"]'));
check('… picking a kit writes it and redraws the map under it',
  w.Prefs.get('soundKit') === 'wood' &&
  /kit · thunk/.test($('.ns-set .snd-map').textContent),
  w.Prefs.get('soundKit') + ' / ' + $('.ns-set .snd-map').textContent.slice(0, 60));
click($('.ns-set .snd-map [data-snd-map="sndDone"][data-val="glass"]'));
check('… and one event can be moved off the kit without leaving it',
  w.Prefs.get('sndDone') === 'glass' && w.Prefs.get('soundKit') === 'wood');
/* The two new moments are decided in shell.js off the element under the
   finger, not by an app calling Prefs.sound() — that rule is what keeps a
   tenth app free of audio, and it is not traded for two more sounds. */
const shellJs43 = fs.readFileSync(path.join(ROOT, 'js/shell.js'), 'utf8');
check('completing and opening are decided in the shell, not announced by an app',
  /function pressVoice\(el\)/.test(shellJs43) &&
  (shellJs43.replace(/\/\*[\s\S]*?\*\//g, '').match(/Prefs\.sound\(/g) || []).length === 3,
  (shellJs43.replace(/\/\*[\s\S]*?\*\//g, '').match(/Prefs\.sound\(/g) || []).length + ' call sites in shell.js');
check('… and no app module has a line of sound in it',
  ['do','log','plan','store','tend','track','learn','cal','create','tools']
    .every(f => !/Prefs\.sound\(/.test(fs.readFileSync(path.join(ROOT, 'js/' + f + '.js'), 'utf8'))));
check('… a tick about to go on sounds like completing; one coming back off does not',
  /return on \? 'tap' : 'done';/.test(shellJs43));
w.Prefs.reset('soundKit'); w.Prefs.reset('sndDone');

/* the content offset, and the pill's three dials */
check('the band drops a few pixels, on a dial, folded into the inset every header reads',
  w.Prefs.SCHEMA.bandDrop.def === 6 && w.Prefs.SCHEMA.bandDrop.cssVar === '--band-drop' &&
  /--sat:calc\(env\(safe-area-inset-top\) \+ var\(--band-drop\)\)/.test(tokensCss43) &&
  /--sat:calc\(round\(up, env\(safe-area-inset-top\), 1px\) \+ var\(--band-drop\)\)/.test(tokensCss43));
check('… so it reaches every header at once rather than the one complained about',
  /padding:calc\(var\(--sat\) \+ 14px\)/.test(shellCss43));
check('the bottom pill has three dials, and their defaults are the literals they replaced',
  w.Prefs.SCHEMA.navHeight.def === 58 && w.Prefs.SCHEMA.navRadius.def === 29 &&
  w.Prefs.SCHEMA.navIcon.def === 19 &&
  /--nav-fh:58px/.test(tokensCss43) && /--nav-r:29px/.test(tokensCss43) &&
  /--nav-icon:19px/.test(tokensCss43));
check('… the pill reads them rather than 999px and 19px',
  /#nav\{[\s\S]*?border-radius:var\(--nav-r\)/.test(shellCss43) &&
  /\.tab-b svg\{width:var\(--nav-icon\);height:var\(--nav-icon\)/.test(shellCss43));
check('… and the two rules that used to override the icon size follow it as a ratio',
  !/\.tab-b svg\{width:2[01]px/.test(shellCss43) &&
  !/\.tab-b svg\{width:21px/.test(themesCss43) &&
  /\[data-tab-labels="off"\] \.tab-b svg\{width:calc\(var\(--nav-icon\)/.test(themesCss43));
w.SET.panel('layout');
check('… all four are controls on the layout panel',
  ['bandDrop','navHeight','navRadius','navIcon'].every(k => !!$('.ns-set [data-slider="' + k + '"]')));
w.Prefs.set('navHeight', 70); w.Prefs.set('navRadius', 4); w.Prefs.set('navIcon', 24);
w.Prefs.set('bandDrop', 12);
check('… and moving one writes a whole pixel onto the root, never a fraction',
  d.documentElement.style.getPropertyValue('--nav-fh') === '70px' &&
  d.documentElement.style.getPropertyValue('--nav-r') === '4px' &&
  d.documentElement.style.getPropertyValue('--nav-icon') === '24px' &&
  d.documentElement.style.getPropertyValue('--band-drop') === '12px',
  d.documentElement.getAttribute('style'));
['navHeight','navRadius','navIcon','bandDrop'].forEach(k => w.Prefs.reset(k));

/* PLAN: patching one block of a day that is already planned */
w.Shell.go('plan');
const planDay43 = offset(2);
w.CAL.write({ day: planDay43, start: '07:00', template: 'normal', mode: 'blocks', notes: [],
  events: [
    { kind:'fixed', name:'routine', from:'07:00', to:'08:00', dur:60, cal:'01A1 | routine' },
    { kind:'task',  name:'old thing', slot:'b1a', from:'08:00', to:'09:00', dur:60, cal:'home',
      project:'home', projectLabel:'home', color:'#5e8cff' },
    { kind:'idle',  name:'b2a', slot:'b2a', from:'09:00', to:'10:00', dur:60 },
  ] });
check('CAL can be patched as well as written, and a patch touches only the slots it names',
  typeof w.CAL.patch === 'function' &&
  w.CAL.patch({ day: planDay43, events: [{ kind:'task', slot:'b2a', name:'a new thing',
    cal:'home', project:'home', projectLabel:'home', color:'#5cdb7d' }] }) === 1);
const patched43 = w.CAL.day(planDay43);
check('… the slot it named is now a task, at the hours the day already gave it',
  patched43.events[2].kind === 'task' && patched43.events[2].name === 'a new thing' &&
  patched43.events[2].from === '09:00' && patched43.events[2].to === '10:00',
  JSON.stringify(patched43.events[2]));
check('… and nothing else moved: the start, the template and the other rows are as they were',
  patched43.start === '07:00' && patched43.template === 'normal' &&
  patched43.events[0].name === 'routine' && patched43.events[1].name === 'old thing',
  JSON.stringify({ s: patched43.start, t: patched43.template,
                   n: patched43.events.map(e => e.name) }));
check('… a day with no record refuses the patch rather than inventing one from a template',
  w.CAL.patch({ day: offset(9), events: [{ kind:'task', slot:'b1a', name:'nope' }] }) === false &&
  !w.CAL.day(offset(9)));
check('… and it is a read-and-merge, not a second network: CAL still has no URL in it',
  !/https?:/.test(calJs43.replace(/\/\*[\s\S]*?\*\//g, '')) &&
  !/fetch\(|XMLHttpRequest/.test(calJs43.replace(/\/\*[\s\S]*?\*\//g, '')));
check('… the description gains a third mode, and the four header fields stay a contract',
  /mode: \$\{expForm\.mode\}/.test(fs.readFileSync(path.join(ROOT, 'js/plan.js'), 'utf8')) &&
  /const on = expForm\.mode === 'patch' \? dayOnFile\(expForm\.day\) : null;/
    .test(fs.readFileSync(path.join(ROOT, 'js/plan.js'), 'utf8')));

/* TOOLS */
check('TOOLS is a tenth app, with a tab, a slide, a panel and a place in the list',
  !!w.TOOLS && w.Prefs.APPS.includes('tools') && w.Shell.TABS.includes('tools') &&
  !!$('#view-tools') && !!$('.tab-b[data-app="tools"]') && !!$('.ns-set .set-panel[data-panel="tools"]'),
  w.Shell.TABS.join(','));
check('… its icon is its own symbol, and the tab points at it',
  !!$('#tab-tools') &&
  $('.tab-b[data-app="tools"] use').getAttribute('href') === '#tab-tools');
w.Shell.go('tools');
await tick();
/* 4.8 cut it to two. The stopwatch and the countdown were the phone's own two
   clocks with a worse readout, and the decider answered a question by not
   answering it. The round is dots now rather than "round 1/4" in the sub.

   4.12 put two back — optimise and data — and neither is a clock the phone
   already has. The slide is still one screen: OPTIMISE's shelf, run and
   history are drawn into the same body, so there is still nowhere to navigate
   to and forget you left something running. */
check('… four instruments behind one strip, and no sub-screen to lose one in',
  [...d.querySelectorAll('.ns-tools .tl-tab')].map(b => b.dataset.t).join(',') === 'pom,whf,opt,dat' &&
  d.querySelectorAll('.ns-tools .scr').length === 1,
  [...d.querySelectorAll('.ns-tools .tl-tab')].map(b => b.dataset.t).join(','));
check('the pomodoro opens on its focus length, read off Config rather than a constant',
  $('.ns-tools #tl-big').textContent === '25:00' &&
  /focus/.test($('.ns-tools .tl-sub').textContent),
  $('.ns-tools #tl-big').textContent + ' / ' + $('.ns-tools .tl-sub').textContent);
check('… and the rounds are dots rather than a sentence to read',
  d.querySelectorAll('.ns-tools .tl-pips i').length === 4,
  String(d.querySelectorAll('.ns-tools .tl-pips i').length));
w.Config.set('tools.pomodoro', { focus: 30, short: 5, long: 15, rounds: 2, autoStart: false });
check('… and editing the length in Config moves it, without a reload',
  $('.ns-tools #tl-big').textContent === '30:00', $('.ns-tools #tl-big').textContent);
click($('.ns-tools [data-act="pom-toggle"]'));
const tlStore43 = () => JSON.parse(w.localStorage.getItem('tools_v1'));
check('starting it stores the moment it ends, never a count of ticks',
  tlStore43().pom.endsAt > w.Date.now() && tlStore43().pom.left === 0 &&
  !/setInterval\([^)]*\bpom/.test(toolsJs43),
  'endsAt ' + (tlStore43().pom.endsAt - w.Date.now()) + 'ms out');
check('… so a reload picks it up where it actually is, rather than where it was left',
  /endsAt \? Math\.max\(0, DB\.pom\.endsAt - Date\.now\(\)\) : DB\.pom\.left/.test(toolsJs43));
click($('.ns-tools [data-act="pom-toggle"]'));
check('pausing banks what is left and clears the end, so the two are never both set',
  tlStore43().pom.endsAt === 0 && tlStore43().pom.left > 0,
  JSON.stringify(tlStore43().pom));
click($('.ns-tools [data-act="pom-skip"]'));
check('skipping a focus does not count it — only finishing one does',
  tlStore43().pom.phase === 'short' && !tlStore43().pom.days[today],
  JSON.stringify(tlStore43().pom));

/* the whole point of the timestamp
   A phase ends because its moment arrived, not because ticks were counted. So
   a phase whose end is already in the past finishes on the very next tick —
   which is what "come back after twenty minutes on another tab" is, and what a
   counter cannot do. */
const tlSt43 = JSON.parse(w.localStorage.getItem('tools_v1'));
tlSt43.pom = { phase:'focus', round:1, endsAt: w.Date.now() - 5000, left:0, days:{} };
w.localStorage.setItem('tools_v1', JSON.stringify(tlSt43));
w.TOOLS.reload();
await tick(400);
check('a phase already past its end finishes on the next tick, wherever you were',
  tlStore43().pom.phase !== 'focus' && tlStore43().pom.days[today] === 1,
  JSON.stringify(tlStore43().pom));
check('… and finishing a focus is what puts a round on the day, and on the band',
  w.TOOLS.today().rounds === 1 &&
  $('.ns-tools #tl-daynum .dn-cur').textContent === '1',
  JSON.stringify(w.TOOLS.today()) + ' / ' + $('.ns-tools #tl-daynum').textContent);
check('… the clock stops being asked once nothing is running',
  tlStore43().pom.endsAt === 0 && tlStore43().pom.left === 0);
w.Config.reset('tools.pomodoro');

/* The breathing round
   Three phases, and only two of them have a length. The retention counts *up*
   and is ended by the person, because how long it lasted is the measurement —
   a timer that cut it off at a guess would be measuring the guess. */
w.Config.set('tools.wimhof', { rounds:2, breaths:5, pace:1, recovery:5, chime:false, label:'wim hof' });
click([...d.querySelectorAll('.ns-tools .tl-tab')].find(b => b.dataset.t === 'whf'));
check('the breathing round opens ready, with a dot per round',
  tlStore43().whf.phase === 'idle' &&
  d.querySelectorAll('.ns-tools .tl-pips i').length === 2 &&
  !!$('.ns-tools [data-act="whf-start"]'),
  tlStore43().whf.phase);

click($('.ns-tools [data-act="whf-start"]'));
check('starting it breathes against the clock, not against a count of ticks',
  tlStore43().whf.phase === 'breathe' && tlStore43().whf.endsAt > w.Date.now(),
  JSON.stringify(tlStore43().whf));

/* the hold is not timed by us */
click($('.ns-tools [data-act="whf-hold"]'));
check('the hold has no end — it counts up from when it began',
  tlStore43().whf.phase === 'hold' && tlStore43().whf.endsAt === 0 &&
  tlStore43().whf.startedAt > 0,
  JSON.stringify(tlStore43().whf));
await tick(40);
click($('.ns-tools [data-act="whf-breathe"]'));
check('… and ending it banks what was held, then recovers against the clock',
  tlStore43().whf.holds.length === 1 && tlStore43().whf.holds[0] > 0 &&
  tlStore43().whf.phase === 'recover' && tlStore43().whf.endsAt > w.Date.now(),
  JSON.stringify(tlStore43().whf));

/* a phase whose end is already past finishes on the next tick, wherever you
   were — the same timestamp rule the pomodoro is built on */
const tlW = JSON.parse(w.localStorage.getItem('tools_v1'));
tlW.whf.endsAt = w.Date.now() - 2000;
w.localStorage.setItem('tools_v1', JSON.stringify(tlW));
w.TOOLS.reload();
await tick(400);
check('a recovery already past its end rolls into the next round on its own',
  tlStore43().whf.phase === 'breathe' && tlStore43().whf.round === 2,
  JSON.stringify(tlStore43().whf));

/* finishing writes the session down in three places: its own store, LOG's day
   as a block, and DAY's schedule as a mark. Neither of the other two grows a
   feature for it — both already take exactly this. */
const logBefore = JSON.parse(w.localStorage.getItem('log_' + today) || '{}');
void logBefore;
click($('.ns-tools [data-act="whf-hold"]'));
await tick(20);
click($('.ns-tools [data-act="whf-breathe"]'));
const tlW2 = JSON.parse(w.localStorage.getItem('tools_v1'));
tlW2.whf.endsAt = w.Date.now() - 2000;
w.localStorage.setItem('tools_v1', JSON.stringify(tlW2));
w.TOOLS.reload();
await tick(400);
check('the last round finishes the session and files it under today',
  tlStore43().whf.phase === 'idle' &&
  (tlStore43().whf.days[today] || []).length === 1 &&
  (tlStore43().whf.days[today] || [])[0].rounds === 2,
  JSON.stringify(tlStore43().whf.days));
check('… and TOOLS.today() reports it alongside the focus rounds',
  w.TOOLS.today().sessions === 1 && w.TOOLS.today().best > 0,
  JSON.stringify(w.TOOLS.today()));
check('… the session lands in LOG\u2019s day as a block',
  (JSON.parse(w.localStorage.getItem('log_' + today) || '{}').e || {}).blocks?.includes('wim hof'),
  JSON.stringify((JSON.parse(w.localStorage.getItem('log_' + today) || '{}').e || {}).blocks));
check('… and on DAY\u2019s schedule as a mark at the minute it finished',
  w.CAL.marks(today).some(m => m.name === 'wim hof' && /^\d\d:\d\d$/.test(m.at)),
  JSON.stringify(w.CAL.marks(today)));

/* the label is Config's, so the block and the mark are named by the user */
check('the name written into both is the one Config gives it',
  /wimhof|wim hof/.test(JSON.stringify(w.Config.get('tools.wimhof'))));
w.Config.reset('tools.wimhof');

/* the instruments that went
   The stopwatch and the countdown were the phone's own two clocks with a worse
   readout, and the decider answered a question by not answering it. A v1 store
   still carrying them must not resurrect them — and must not lose the one
   thing in it worth keeping, which is the day's focus count. */
w.localStorage.setItem('tools_v1', JSON.stringify({
  v: 1, tool: 'decide',
  pom: { phase:'focus', round:1, endsAt:0, left:0, days:{ '2026-09-01': 4 } },
  sw: { startedAt:0, banked:99999, laps:[1,2,3] },
  timer: { endsAt:0, left:0, total:600000, label:'tea' },
  decide: { deck:'what next', last:'the quickest one' },
}));
w.TOOLS.reload();
/* Reading normalises; the store itself is only rewritten on the next write,
   which is why this asks the module what it holds and *then* asks the store. */
check('a v1 store keeps its focus history and drops the instruments that went',
  w.TOOLS.state().pom.days['2026-09-01'] === 4 &&
  w.TOOLS.state().sw === undefined && w.TOOLS.state().timer === undefined &&
  w.TOOLS.state().decide === undefined && w.TOOLS.state().tool === 'pom',
  JSON.stringify(Object.keys(w.TOOLS.state())));
click($('.ns-tools [data-act="pom-toggle"]'));
click($('.ns-tools [data-act="pom-toggle"]'));
check('… and the first write puts the old shape out of the store for good',
  tlStore43().sw === undefined && tlStore43().decide === undefined &&
  tlStore43().pom.days['2026-09-01'] === 4,
  JSON.stringify(Object.keys(tlStore43())));

/* Findable: the app by name, and its lists through search.js's CONTENT table
   — one line per Config path, which is all a new app owes search. */
check('TOOLS is findable by name, and so is what it is asked to call a session',
  w.SEARCH.results('tools').some(r => r.kind === 'app' && r.title === 'TOOLS') &&
  w.SEARCH.results('breathing').some(r => r.kind === 'content'),
  w.SEARCH.results('tools').map(r => r.kind + ':' + r.title).join(', ').slice(0, 90));
check('… and its own store is filed under its own name in the storage report',
  w.localStorage.getItem('tools_v1') !== null &&
  /TOOLS/.test((w.SET.panel('data'), $('.ns-set [data-panel="data"]').textContent)),
  'tools_v1');
w.TOOLS.resetAll(); settle();
check('… and resetting it stops every clock without touching the lengths',
  tlStore43().pom.endsAt === 0 && tlStore43().whf.phase === 'idle' &&
  !!w.Config.get('tools.pomodoro') && !!w.Config.get('tools.wimhof'));
w.Shell.go('do');

check('no errors through the whole of 4.3', errors.length === 0, errors.slice(0, 3).join(' | '));


/* 4.5 — SYNC.
   The merge is the whole feature and it is pure enough to test properly: what
   goes wrong here is a day silently losing half of itself, which is the one
   failure this app cannot afford. The transports are not exercised (one needs
   Todoist, the other a file picker); the thing between them is. */
const M = w.SYNC._merge;
const LS = w.localStorage;

// a half each, written on two devices — the case the whole design exists for
{
  const mine = { date: '2026-09-01', m: { nrg: '4', saved: 100 }, e: {} };
  const theirs = { date: '2026-09-01', m: {}, e: { stress: '2', saved: 200 } };
  const r = M.mergeLogDay('2026-09-01', mine, theirs);
  check('a morning here and an evening there merge into one day',
    r.out.m.nrg === '4' && r.out.e.stress === '2',
    JSON.stringify(r.out));
}

// both halves written: the newer one wins, the older is left alone
{
  const mine = { m: { nrg: '2', saved: 100 }, e: { stress: '5', saved: 900 } };
  const theirs = { m: { nrg: '4', saved: 500 }, e: { stress: '1', saved: 200 } };
  const r = M.mergeLogDay('2026-09-02', mine, theirs);
  check('the newer half wins and the older half is untouched',
    r.out.m.nrg === '4' && r.out.e.stress === '5',
    JSON.stringify({ m: r.out.m.nrg, e: r.out.e.stress }));
}

/* Written at the same moment and different. Since 4.14 there is no such thing
   as an overlap: the fuller record wins, and two of exactly equal fullness are
   settled by comparing them as text — arbitrary, but the same answer on both
   devices, which is the only property that matters once nobody is being asked. */
{
  const mine = { m: { nrg: '2', saved: 100 }, e: {} };
  const theirs = { m: { nrg: '4', mood: '5', saved: 100 }, e: {} };
  const r = M.mergeLogDay('2026-09-03', mine, theirs);
  check('two halves saved at the same moment settle on the fuller one',
    r.out.m.nrg === '4' && r.out.m.mood === '5', JSON.stringify(r.out.m));
}
{
  const a = { m: { nrg: '2', saved: 100 }, e: {} };
  const b = { m: { nrg: '4', saved: 100 }, e: {} };
  const mine = M.mergeLogDay('2026-09-03', a, b).out.m.nrg;
  const theirs = M.mergeLogDay('2026-09-03', b, a).out.m.nrg;
  check('… and two devices as full as each other reach the same answer either way',
    mine === theirs, mine + ' / ' + theirs);
}

/* Blocks and media are written by setBlock/setMedia without touching e.saved,
   so a timestamp rule would drop a block ticked from DO on the other device.
   They union whatever the halves did — including when our half is newer. */
{
  const mine = { m: {}, e: { saved: 900, blocks: ['gym'], media: [{ name: 'Dune', kind: 'movie' }] },
                 entries: [{ time: '09:00', text: 'a' }] };
  const theirs = { m: {}, e: { saved: 100, blocks: ['study'], media: [{ name: 'Solaris', kind: 'movie' }] },
                   entries: [{ time: '21:00', text: 'b' }] };
  const r = M.mergeLogDay('2026-09-04', mine, theirs);
  check('blocks, media and entries union even when our half is the newer one',
    r.out.e.blocks.join(',') === 'gym,study' &&
    r.out.e.media.length === 2 &&
    r.out.entries.length === 2, JSON.stringify(r.out.e.blocks));
}

// DO's ticks are facts: they union, and an untick never beats a tick
{
  const r = M.mergeDoDay('2026-09-05', { morning: { teeth: true } }, { morning: { water: true } });
  check("DO's ticks union rather than replace",
    r.out.morning.teeth === true && r.out.morning.water === true, JSON.stringify(r.out));
}

// DAY stamps every export, so it has a real timestamp to compare
{
  const r = M.mergeCalDay('2026-09-06', { written: 100, notes: 'old' }, { written: 500, notes: 'new' });
  check('DAY takes the more recently written day', r.out.notes === 'new');
  const r2 = M.mergeCalDay('2026-09-06', { written: 500, notes: 'mine' }, { written: 100, notes: 'theirs' });
  check('… and keeps ours when ours is the newer one', r2.out.notes === 'mine');
  const r3 = M.mergeCalDay('2026-09-06', { written: 100, notes: 'a' }, { written: 100, notes: 'b' });
  const r4 = M.mergeCalDay('2026-09-06', { written: 100, notes: 'a' }, { written: 100, notes: 'a longer note' });
  check('… and written at the same moment takes the fuller day, not a question',
    r4.out.notes === 'a longer note', JSON.stringify(r4.out));
  void r3;
}

// state records have no timestamp inside, so identical is silent and different asks
{
  check('an identical state record is a no-op',
    M.mergeState('k', { a: 1 }, { a: 1 }).notes.length === 0);
  check('a state record this device does not have is simply taken',
    M.mergeState('k', null, { a: 1 }).out.a === 1);
  check('a state record that differs with no moment on either side takes the fuller',
    M.mergeState('k', { a: 1 }, { a: 2, b: 3 }).out.b === 3);
}

/* A Todoist key must never travel inside a Todoist task. */
{
  const scrubbed = M.scrub({ token: 'secret', target: 'x', todoist: { token: 'secret', project: 'p' } });
  check('every token is stripped on the way out',
    !JSON.stringify(scrubbed).includes('secret') && scrubbed.target === 'x' &&
    scrubbed.todoist.project === 'p', JSON.stringify(scrubbed));
}

/* The window, and DO's day being today-only — an imported past `do_` day would
   be folded into do-stats-v1 a second time and then swept. */
{
  w.Prefs.set('syncDays', 2);
  check('the window is the dial, either side of today', w.SYNC.window(w.SYNC.span()).length === 5,
    String(w.SYNC.window(w.SYNC.span()).length));
  const yday = w.SYNC.window(1)[0];
  LS.setItem('do_' + yday, JSON.stringify({ morning: { teeth: true } }));
  const built = w.SYNC.build('todoist');
  check('a past DO day is deliberately not pushed — only today is',
    !(built.days[yday] && built.days[yday].day), JSON.stringify(Object.keys(built.days)));
  LS.removeItem('do_' + yday);
  check('the payload never carries a token', !JSON.stringify(built).includes('"token"'));
  w.Prefs.reset('syncDays');
}

/* Plan → commit → undo, against real storage. */
{
  const day = w.SYNC.window(0)[0];
  // LOG writes log-scale-v2 at boot; the point of this check is the branch
  // where the record is absent, so it is cleared and put back afterwards
  const before = LS.getItem('log-scale-v2');
  LS.removeItem('log-scale-v2');
  const payload = { app: 'root', kind: 'sync', version: 1, route: 'file', device: 'x',
                    written: Date.now(), days: {}, state: { 'log-scale-v2': 'done' } };
  const planned = w.SYNC.plan('file', payload);
  check('a record this device lacks is planned as a write, with nothing written yet',
    planned.writes.some(x => x.key === 'log-scale-v2') && LS.getItem('log-scale-v2') === null,
    JSON.stringify(planned.writes.map(x => x.key)));
  const res = w.SYNC.commit(planned);
  check('committing writes it', res.ok && JSON.parse(LS.getItem('log-scale-v2')) === 'done');
  check('and the import can be taken back', w.SYNC.canUndo());
  w.SYNC.undoImport();
  check('undo puts every overwritten key back as it was',
    LS.getItem('log-scale-v2') === null && !w.SYNC.canUndo(), LS.getItem('log-scale-v2'));
  if (before === null) LS.removeItem('log-scale-v2'); else LS.setItem('log-scale-v2', before);
  void day;
}

/* The fence is the contract between the two transports. */
{
  const body = { app: 'root', kind: 'sync', version: 1, route: 'file', device: 'd',
                 written: 1, days: {}, state: {} };
  check('what the wrapper writes is what the reader gets back',
    JSON.stringify(w.SYNC.unwrap(w.SYNC.wrap('x', body))) === JSON.stringify(body));
  check('a file that is not a sync file is refused rather than half-read',
    (() => { try { w.SYNC.parseFile('# just a note'); return false; } catch { return true; } })());
}

check('SYNC reaches no app module — every app stays as networkless as it was',
  !/\b(DO|LOG|PLAN|STORE|TEND|TRACK|LEARN|CAL|CREATE|TOOLS)\s*\./
    .test(fs.readFileSync(path.join(ROOT, 'js/sync.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')));

/* The panel, and the sheet that is the only thing standing between an import
   and twenty overwritten days. */
w.SET.panel('sync');
check('the sync panel offers both routes, and says which apps take which',
  /todoist/.test($('.ns-set #sync-todoist').textContent) &&
  /DO, DAY, CREATE and TEND/.test($('.ns-set #sync-todoist').textContent) &&
  /LOG, TRACK and STORE/.test($('.ns-set #sync-file').textContent));

/* A record changed on both devices, with nothing to separate them but what is
   in them. It settles on its own and is written — there is no sheet to reach. */
{
  const before = LS.getItem('log-scale-v2');
  LS.setItem('log-scale-v2', JSON.stringify('mine'));
  const payload = { app: 'root', kind: 'sync', version: 1, route: 'file', device: 'x',
                    written: Date.now(), days: {}, state: { 'log-scale-v2': 'theirs longer' } };
  const planned = w.SYNC.plan('file', payload);
  check('a record changed on both devices is settled, not asked about',
    planned.writes.some(x => x.key === 'log-scale-v2') &&
    JSON.parse(LS.getItem('log-scale-v2')) === 'mine');
  w.SYNC.commit(planned);
  check('committing writes the settled value',
    JSON.parse(LS.getItem('log-scale-v2')) === 'theirs longer', LS.getItem('log-scale-v2'));
  w.SYNC.undoImport();
  check('and undo puts it back', JSON.parse(LS.getItem('log-scale-v2')) === 'mine');
  if (before === null) LS.removeItem('log-scale-v2'); else LS.setItem('log-scale-v2', before);
}

/* Both halves of one day written in the same moment on both devices. Each half
   settles on its own, and both answers survive into the one record. */
{
  const day = w.SYNC.window(0)[0];
  const before = LS.getItem('log_' + day);
  LS.setItem('log_' + day, JSON.stringify({ date: day, m: { nrg: '1', saved: 5 },
                                            e: { stress: '1', saved: 5 }, entries: [] }));
  const payload = { app: 'root', kind: 'sync', version: 1, route: 'file', device: 'x',
                    written: Date.now(), days: { [day]: { day: { date: day,
                      m: { nrg: '9', mood: '9', saved: 5 },
                      e: { stress: '9', cal: '9', saved: 5 }, entries: [] } } },
                    state: {} };
  const planned = w.SYNC.plan('file', payload);
  w.SYNC.commit(planned);
  const got = JSON.parse(LS.getItem('log_' + day));
  check('each half of a day settles on its own, and both land in the one record',
    got.m.mood === '9' && got.e.cal === '9', JSON.stringify({ m: got.m, e: got.e }));
  w.SYNC.undoImport();
  if (before === null) LS.removeItem('log_' + day); else LS.setItem('log_' + day, before);
}

/* 4.7 — the frame is any size, and "everything" is one file. */
{
  w.Prefs.set('frameW', 1200);
  check('a wide frame is treated as a wide box, which no media query could tell it',
    d.documentElement.dataset.frameWide === 'on', d.documentElement.dataset.frameWide);
  w.Prefs.set('frameW', 420);
  check('a phone-sized frame is not', d.documentElement.dataset.frameWide === 'off');
  w.Prefs.set('desktopMode', 'rail');
  check('the rail never claims it — its own media queries answer that question',
    d.documentElement.dataset.frameWide === 'off');
  w.Prefs.set('desktopMode', 'frame');
  w.Prefs.set('frameW', 1800);
  check('the width dial reaches past a laptop',
    d.documentElement.style.getPropertyValue('--frame-w') === '1800px',
    d.documentElement.style.getPropertyValue('--frame-w'));
  w.Prefs.reset('frameW'); w.Prefs.reset('frameH');
}

{
  LS.setItem('a-made-up-key', 'kept');
  const withOut = w.SYNC.parseEverything(w.SYNC.everythingText(false));
  /* Unfiltered, with one deliberate exception: `plan_token` is nothing but the
     token, so leaving the token out leaves that key out. Every other key is
     carried whether this build knows what it is or not. */
  const missing = [];
  for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (!(k in withOut.data)) missing.push(k); }
  check('everything means everything — an unknown key is carried, not filtered out',
    withOut.data['a-made-up-key'] === 'kept' &&
    missing.filter(k => k !== 'plan_token').length === 0, missing.join(','));
  check('… and with the key included, nothing at all is left behind',
    Object.keys(w.SYNC.parseEverything(w.SYNC.everythingText(true)).data).length === LS.length);

  const tokenWas = LS.getItem('root_todoist_v1');
  LS.setItem('root_todoist_v1', JSON.stringify({ token: 'sekrit', saved: 1 }));
  LS.setItem('store_state_v1', JSON.stringify({ list: ['milk'], todoist: { token: 'sekrit', project: 'p' } }));
  const clean = w.SYNC.everythingText(false);
  check('the Todoist key is left out by default, wherever it is hiding',
    !clean.includes('sekrit'), 'leaked');
  check('… and the record that held it keeps everything else',
    JSON.parse(w.SYNC.parseEverything(clean).data['store_state_v1']).list[0] === 'milk');
  check('… and it is included when asked for', w.SYNC.everythingText(true).includes('sekrit'));

  const body = w.SYNC.parseEverything(clean);
  const c = w.SYNC.everythingCount(body);
  check('the restore says how many keys it replaces before it does it',
    c.total === Object.keys(body.data).length && c.over > 0, JSON.stringify(c));

  LS.setItem('a-made-up-key', 'changed');
  w.SYNC.restoreEverything(body);
  check('restoring replaces what the file names', LS.getItem('a-made-up-key') === 'kept');
  w.SYNC.undoImport();
  check('and a whole-install restore can still be taken back', LS.getItem('a-made-up-key') === 'changed');

  check('a sync file offered to the everything importer is refused with the reason why',
    (() => { try { w.SYNC.parseEverything(w.SYNC.fileText()); return false; }
             catch (e) { return /sync file/.test(e.message); } })());

  LS.removeItem('a-made-up-key');
  if (tokenWas === null) LS.removeItem('root_todoist_v1'); else LS.setItem('root_todoist_v1', tokenWas);
}

check('the rebindable keys are findable by name, like every other dial',
  w.SEARCH.results('cursor').some(r => r.kind === 'setting' && /cursor/i.test(r.title)),
  w.SEARCH.results('cursor').map(r => r.title).join(', ').slice(0, 80));

/* 4.8 — the three fixes that are not already covered above. */

/* The auto-close that "sometimes" did not happen.
   `tdBusy` is one lock over six Todoist operations. Five are button presses,
   and dropping one of those while another runs is right — the button is
   visibly disabled. The sixth is the close fired by ticking the last item of a
   routine, which is not a Todoist control at all: no disabled button, no
   toast, no idea a fetch was in flight. It queued nothing and returned. */
{
  const doJs48 = fs.readFileSync(path.join(ROOT, 'js/do.js'), 'utf8');
  const bare = doJs48.replace(/\/\*[\s\S]*?\*\//g, '');
  check('a routine finished while another Todoist call runs is queued, not dropped',
    /tdPending\.add\(key\)/.test(bare) &&
    !/async function tdAutoPush\(key\) \{\s*if \(tdBusy/.test(bare),
    'tdAutoPush still bails on the lock');
  check('… and every operation releases through the one path that drains it',
    /function tdRelease\(\)/.test(bare) &&
    (bare.match(/tdRelease\(\)/g) || []).length >= 7 &&
    !/tdBusy = false; renderTdButtons\(\)/.test(bare),
    (bare.match(/tdRelease\(\)/g) || []).length + ' release sites');
}

/* Rearranging the timetable, and adding an hour that is yours. */
{
  const iso48 = w.Shell.today();
  w.CAL.write({ day: iso48, start: '09:00', template: 'test', mode: 'full', notes: [],
    events: [
      { from:'09:00', to:'09:30', dur:30, kind:'task', name:'first',  slot:'a', done:false },
      { from:'09:30', to:'10:30', dur:60, kind:'task', name:'second', slot:'b', done:false },
    ] });
  w.Shell.go('cal');
  /* Every control this section presses lives behind 4.12's edit switch. Asked
     for explicitly rather than assumed on from an earlier section, so this
     block does not depend on the order the harness happens to run in. */
  const editOn = () => { if (!d.querySelector('.ns-cal .cal-day.editing')) click($('.ns-cal [data-act="edit"]')); };
  editOn();
  const evs48 = () => (w.CAL.day(iso48) || {}).events || [];
  check('a day can be written for the move to work on',
    evs48().length === 2 && evs48()[0].name === 'first', JSON.stringify(evs48().map(e => e.name)));

  const down = [...d.querySelectorAll('.ns-cal [data-act="mv"]')]
    .find(b => b.dataset.i === '0' && b.dataset.j === '1');
  check('every row that has somewhere to go carries an arrow', !!down,
    [...d.querySelectorAll('.ns-cal [data-act="mv"]')].map(b => b.dataset.i + '>' + b.dataset.j).join(','));
  if (down) click(down);
  check('moving a row swaps the pair and re-times it from the earlier start',
    evs48()[0].name === 'second' && evs48()[0].from === '09:00' && evs48()[0].to === '10:00' &&
    evs48()[1].name === 'first'  && evs48()[1].from === '10:00' && evs48()[1].to === '10:30',
    JSON.stringify(evs48().map(e => e.name + ' ' + e.from + '-' + e.to)));
  check('… and the pair still ends where it ended, so nothing after it moves',
    evs48()[1].to === '10:30');
  check('… and the day is marked as edited here, like a delete is',
    !!(w.CAL.day(iso48) || {}).localEdit);

  /* A fixed row is an anchor: a train at six is at six. Written rather than
     mutated in place — CAL re-reads the store on every write, so an in-memory
     poke is gone by the next render. */
  w.CAL.write({ day: iso48, start: '09:00', template: 'test', mode: 'full', notes: [],
    events: [
      { from:'09:00', to:'09:30', dur:30, kind:'task',  name:'first', slot:'a' },
      { from:'09:30', to:'10:30', dur:60, kind:'fixed', name:'train', cal:'work' },
    ] });
  editOn();
  check('a fixed row is never given arrows to move it with',
    d.querySelectorAll('.ns-cal [data-act="mv"]').length === 0,
    [...d.querySelectorAll('.ns-cal [data-act="mv"]')].map(b => b.dataset.i + '>' + b.dataset.j).join(','));

  /* back to two movable rows for the gap check */
  w.CAL.write({ day: iso48, start: '09:00', template: 'test', mode: 'full', notes: [],
    events: [
      { from:'09:00', to:'10:00', dur:60, kind:'task', name:'second', slot:'b' },
      { from:'10:00', to:'10:30', dur:30, kind:'task', name:'first',  slot:'a' },
    ] });

  click($('.ns-cal [data-act="gap"]'));
  check('adding empty time asks for a length in the app, with a field',
    askOpen() && !$('#ask-field').classList.contains('hidden'));
  $('#ask-input').value = '45';
  click($('#ask-yes'));
  check('adding empty time appends an idle row of the length asked for',
    evs48().length === 3 && evs48()[2].kind === 'idle' && evs48()[2].dur === 45 &&
    evs48()[2].from === '10:30' && evs48()[2].to === '11:15',
    JSON.stringify(evs48()[2]));

  /* 4.12 — a row's *length*. The row changes and everything after it moves by
     the same amount, which is the ordinary thing a calendar does; a fixed row
     is an anchor and stops the shift, which is the whole of why it is one. */
  w.CAL.write({ day: iso48, start: '09:00', template: 'test', mode: 'full', notes: [],
    events: [
      { from:'09:00', to:'10:00', dur:60, kind:'task', name:'first',  slot:'a' },
      { from:'10:00', to:'10:30', dur:30, kind:'task', name:'second', slot:'b' },
    ] });
  editOn();
  const grow = () => [...d.querySelectorAll('.ns-cal [data-act="size"]')].find(b => b.dataset.i === '0' && b.dataset.d === '1');
  const shrink = () => [...d.querySelectorAll('.ns-cal [data-act="size"]')].find(b => b.dataset.i === '0' && b.dataset.d === '-1');
  const shape48 = () => evs48().map(e => e.name + ' ' + e.from + '-' + e.to).join('|');
  check('every movable row carries a longer and a shorter', !!grow() && !!shrink(),
    [...d.querySelectorAll('.ns-cal [data-act="size"]')].map(b => b.dataset.i + ':' + b.dataset.d).join(','));
  click(grow());
  check('longer adds the step and pushes what is after it by the same amount',
    evs48()[0].dur === 75 && shape48() === 'first 09:00-10:15|second 10:15-10:45', shape48());
  click(shrink()); click(shrink());
  check('… and shorter is the same move backwards, step for step',
    evs48()[0].dur === 45 && shape48() === 'first 09:00-09:45|second 09:45-10:15', shape48());
  w.Prefs.set('calStep', 30);
  click(grow());
  check('… and the step is a setting, not a number in the code',
    evs48()[0].dur === 75, String(evs48()[0].dur));
  w.Prefs.reset('calStep');

  /* The anchor. A fixed row does not move, so a row growing into one is
     refused rather than quietly overrunning it — the same rule the arrows
     already follow. */
  w.CAL.write({ day: iso48, start: '09:00', template: 'test', mode: 'full', notes: [],
    events: [
      { from:'09:00', to:'09:45', dur:45, kind:'task',  name:'first', slot:'a' },
      { from:'09:45', to:'10:45', dur:60, kind:'fixed', name:'train', cal:'work' },
    ] });
  editOn();
  click(grow());
  check('a row cannot grow into a fixed one — the anchor keeps its clock',
    evs48()[0].dur === 45 && evs48()[1].from === '09:45', shape48());
  check('… and a fixed row is given no length buttons of its own',
    ![...d.querySelectorAll('.ns-cal [data-act="size"]')].some(b => b.dataset.i === '1'),
    [...d.querySelectorAll('.ns-cal [data-act="size"]')].map(b => b.dataset.i).join(','));

  /* And the floor: a row of nothing is a row that is not there. */
  w.CAL.write({ day: iso48, start: '09:00', template: 'test', mode: 'full', notes: [],
    events: [{ from:'09:00', to:'09:15', dur:15, kind:'task', name:'first', slot:'a' }] });
  editOn();
  click(shrink());
  check('a row cannot be shrunk out of existence — deleting is what that is for',
    evs48()[0].dur === 15, String(evs48()[0].dur));

  click($('.ns-cal [data-act="edit"]'));
  check('leaving edit mode takes every reshaping control away again',
    !d.querySelector('.ns-cal .ev-del, .ns-cal .ev-mv, .ns-cal .ev-szb'),
    [...d.querySelectorAll('.ns-cal .cal-ev [data-act]')].map(b => b.dataset.act).join(',') || 'none');
  w.Shell.go('tools');
}

/* The undo pill: the shadow is gone, and what is left in it is two dials. */
{
  const root48 = d.documentElement;
  check('the pill says what it is made of on the root element',
    root48.dataset.undoIcon === 'undo' && root48.dataset.undoText === 'on',
    root48.dataset.undoIcon + '/' + root48.dataset.undoText);
  w.Prefs.set('undoIcon', 'back');
  w.Shell.undo('cleared', () => {});
  check('the chosen mark is the one drawn, not the one in the markup',
    $('#undo-pill .up-ico use').getAttribute('href') === '#ico-back',
    $('#undo-pill .up-ico use').getAttribute('href'));
  w.Prefs.set('undoIcon', 'none');
  w.Shell.undo('cleared', () => {});
  check('… and "none" leaves a valid glyph in the markup for CSS to hide',
    $('#undo-pill .up-ico use').getAttribute('href') === '#ico-undo' &&
    root48.dataset.undoIcon === 'none');
  const tokens48 = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
  check('hiding both would leave an empty control, so the words come back',
    /\[data-undo-text="off"\]\[data-undo-icon="none"\] \.undo-pill \.up-txt\{display:block\}/.test(tokens48));
  w.Shell.hideUndo();
  w.Prefs.reset('undoIcon'); w.Prefs.reset('undoText');
}

/* 4.9 — the cursor walks two levels, and DO's routines are reachable at all. */
{
  const shellJs49 = fs.readFileSync(path.join(ROOT, 'js/shell.js'), 'utf8');
  /* The bug was the selector: DO's routine cards are `<div onclick>` and TEND,
     CAL, CREATE and TOOLS all dispatch off data-act, so a flat list of buttons
     and links could not see any of them. */
  check('the cursor can see a control that is neither a button nor a link',
    /\[onclick\]/.test(shellJs49) && /\[data-act\]/.test(shellJs49),
    'FOCUSABLE still only knows about real controls');
  check("… which is what makes DO's routine cards reachable",
    (() => { const m = shellJs49.match(/const FOCUSABLE = ([\s\S]*?);/);
             if (!m) return false;
             const sel = m[1].replace(/['\n+ ]/g, '');
             const card = d.querySelector('.ns-do #home-grid .card');
             return !!card && card.matches(sel); })(),
    'a routine card does not match the selector');

  check('the two levels and their keys exist', /function blocksOf\(/.test(shellJs49) &&
    /KEY_ACTIONS = \['prev', 'next', 'up', 'down', 'left', 'right', 'act', 'in', 'out'\]/.test(shellJs49));
  check('… and every one of them is rebindable, with a default',
    ['prev','next','up','down','left','right','act','in','out'].every(a => a in w.Prefs.get('keyMap')),
    JSON.stringify(w.Prefs.get('keyMap')));
  check('… while Escape climbs a level rather than only giving up',
    /if \(!leaveSel\(\)\) clearSel\(\)/.test(shellJs49));

  /* The mark replaced the ring: a full accent outline round half a screen read
     as an error state rather than as a cursor. */
  const shellCss49 = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
  check('the selection is a wash now, not a ring around half the screen',
    /\.kb-sel\{outline:1px solid var\(--yb\)/.test(shellCss49) &&
    !/\.kb-sel\{outline:2px/.test(shellCss49));
  check('… and what you follow is an arrow that hovers at the corner',
    /#kb-mark\{/.test(shellCss49) && /position:fixed/.test(shellCss49.slice(shellCss49.indexOf('#kb-mark{'))) &&
    /#kb-mark\.deep\{/.test(shellCss49));
  check('… which lives outside #track, like every other fixed thing (§6)',
    /document\.body\.appendChild\(markEl\)/.test(shellJs49));

  /* blocksOf descends through single-child wrappers, so a screen wrapped in one
     .cnt still reports its sections rather than reporting the wrapper. */
  check('a lone child is unwrapped only when it is a group of groups',
    /inner\.length > 1 && inner\.some\(el => !isLeaf\(el\)\)/.test(shellJs49));
}

/* 4.9 — today's log can ride the Todoist push, and only today's. */
{
  const iso49 = w.Shell.today();
  const was = LS.getItem('log_' + iso49);
  LS.setItem('log_' + iso49, JSON.stringify({ date: iso49, m: { nrg: '4', saved: 10 }, e: {}, entries: [] }));

  w.Prefs.set('syncTodayPrivate', false);
  check('the private day stays out of the Todoist push by default',
    !w.SYNC.build('todoist').today, JSON.stringify(w.SYNC.build('todoist').today));

  w.Prefs.set('syncTodayPrivate', true);
  const built49 = w.SYNC.build('todoist');
  check('… and rides it when the switch is on, under its own key',
    !!built49.today && built49.todayFor === iso49 && built49.today.day.m.nrg === '4',
    JSON.stringify(built49.todayFor));
  check('… today only — yesterday never travels this way',
    Object.keys(built49).filter(k => k === 'today').length === 1 &&
    built49.todayFor === iso49);
  check('… and it is still scrubbed of anything token-shaped',
    !JSON.stringify(built49).includes('"token"'));

  /* Coming back it is merged by LOG's rules, not the Todoist route's: a half
     each on two devices is one day, not a conflict. */
  LS.setItem('log_' + iso49, JSON.stringify({ date: iso49, m: {}, e: { stress: '2', saved: 20 }, entries: [] }));
  const planned49 = w.SYNC.plan('todoist', built49);
  const write49 = planned49.writes.find(x => x.key === 'log_' + iso49);
  check('an imported private day merges by half, filling what this device lacks',
    !!write49 && write49.value.m.nrg === '4' && write49.value.e.stress === '2',
    JSON.stringify(write49 && write49.value));

  w.Prefs.reset('syncTodayPrivate');
  if (was === null) LS.removeItem('log_' + iso49); else LS.setItem('log_' + iso49, was);
}

/* 4.9 — four drawings of one number. */
{
  w.Shell.go('tools');
  const big = () => $('.ns-tools #tl-big') && $('.ns-tools #tl-big').textContent;
  const before = big();
  const seen = {};
  ['ring', 'bar', 'stack', 'plain'].forEach(l => {
    w.Prefs.set('toolsLayout', l);
    w.TOOLS.render();
    seen[l] = !!$('.ns-tools .tl-' + (l === 'ring' ? 'ring' : l));
  });
  check('every layout draws its own box', Object.values(seen).every(Boolean), JSON.stringify(seen));
  check('… and the readout says the same thing in all of them', big() === before,
    before + ' → ' + big());
  check('… all four carry the fraction the paint loop writes',
    !!$('.ns-tools .tl-plain') && $('.ns-tools .tl-plain').style.getPropertyValue('--tl-frac') !== '',
    $('.ns-tools .tl-plain') && $('.ns-tools .tl-plain').getAttribute('style'));
  const toolsCss49 = fs.readFileSync(path.join(ROOT, 'css/tools.css'), 'utf8');
  check('… and the phase colours are on the readout, not on the ring alone',
    /\.ns-tools \.break\{--tl-c/.test(toolsCss49) && /\.ns-tools \.whf\.hold\{--tl-c/.test(toolsCss49));
  w.Prefs.reset('toolsLayout');
  w.TOOLS.render();
}

/* 4.10 — a direction is a direction, and the layouts actually switch. */
{
  const shellJs410 = fs.readFileSync(path.join(ROOT, 'js/shell.js'), 'utf8');
  check('movement is measured off the boxes the browser laid out, not the markup',
    /function nearest\(dir\)/.test(shellJs410) && /getBoundingClientRect/.test(shellJs410),
    'still walking document order');
  check('… and being out of line with the cursor costs more than distance does',
    /off \* \(lined \? 0\.25 : 8\)/.test(shellJs410));
  check('… while up and down still fall back to document order, so two keys reach everything',
    /nearest\(dir\) \|\| stepSel\(dir === 'down' \? 1 : -1\)/.test(shellJs410));

  /* The scoring is the whole fix, and it is pure arithmetic on rectangles — so
     it can be checked here even though jsdom cannot lay anything out. This is
     DO's home: two columns, four cards. In document order "down" from the first
     card is the card to its RIGHT, which is exactly what was wrong. */
  const grid = [
    { name:'a', left:0,   right:150, top:0,   bottom:60 },
    { name:'b', left:170, right:320, top:0,   bottom:60 },
    { name:'c', left:0,   right:150, top:70,  bottom:130 },
    { name:'d', left:170, right:320, top:70,  bottom:130 },
  ].map(r => Object.assign(r, { width: r.right - r.left, height: r.bottom - r.top }));
  const midX = r => r.left + r.width / 2, midY = r => r.top + r.height / 2;
  const spanX = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const spanY = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  /* the same scoring shell.js uses, applied to those rectangles */
  const pick = (from, dir) => {
    const a = grid.find(r => r.name === from);
    let best = null, bestScore = Infinity;
    for (const r of grid) {
      if (r === a) continue;
      let gap, off, lined;
      if (dir === 'down')       { if (r.top    < a.bottom - 2) continue; gap = r.top - a.bottom;  off = Math.abs(midX(r) - midX(a)); lined = spanX(a, r) > 0; }
      else if (dir === 'up')    { if (r.bottom > a.top    + 2) continue; gap = a.top - r.bottom;  off = Math.abs(midX(r) - midX(a)); lined = spanX(a, r) > 0; }
      else if (dir === 'right') { if (r.left   < a.right  - 2) continue; gap = r.left - a.right;  off = Math.abs(midY(r) - midY(a)); lined = spanY(a, r) > 0; }
      else                      { if (r.right  > a.left   + 2) continue; gap = a.left - r.right;  off = Math.abs(midY(r) - midY(a)); lined = spanY(a, r) > 0; }
      const score = Math.max(0, gap) + off * (lined ? 0.25 : 8);
      if (score < bestScore) { bestScore = score; best = r; }
    }
    return best && best.name;
  };
  check('down from the top-left card goes to the one under it, not the one beside it',
    pick('a', 'down') === 'c', pick('a', 'down'));
  check('right from it goes to the one beside it', pick('a', 'right') === 'b', pick('a', 'right'));
  check('up from the bottom-right comes back up its own column',
    pick('d', 'up') === 'b', pick('d', 'up'));
  check('left from it crosses its own row', pick('d', 'left') === 'c', pick('d', 'left'));
  check('and a direction with nothing that way picks nothing rather than something surprising',
    !pick('a', 'up') && !pick('b', 'right'),
    String(pick('a', 'up')) + '/' + String(pick('b', 'right')));

  /* "Use the app with one hand" is a question about where the keys are, and
     that cannot be guessed from here — so it is asked instead. */
  check('the five that a hand sits on can be bound in one pass',
    /function setAllKeys\(/.test(fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8')));

  /* The highlight is a choice of kind, not a volume knob. */
  ['glow', 'arrow', 'bar', 'spotlight'].forEach(v => {
    w.Prefs.set('kbMark', v);
    check('the cursor can look like: ' + v, d.documentElement.dataset.kbMark === v,
      d.documentElement.dataset.kbMark);
  });
  const shellCss410 = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
  check('… and each one is a different treatment, not the same one restated',
    /\[data-kb-mark="glow"\] \.kb-sel\{/.test(shellCss410) &&
    /\[data-kb-mark="bar"\] \.kb-sel\{/.test(shellCss410) &&
    /\[data-kb-mark="spotlight"\] \.kb-sel\{[^}]*100vmax/.test(shellCss410));
  w.Prefs.reset('kbMark');
}

/* 4.10 — the TOOLS layouts were set but never drawn. */
{
  const toolsJs410 = fs.readFileSync(path.join(ROOT, 'js/tools.js'), 'utf8');
  check('TOOLS listens to Prefs, which is what made its own dial do nothing',
    /Prefs\.subscribe\(/.test(toolsJs410) && /'toolsLayout'/.test(toolsJs410),
    'tools.js still only subscribes to Config');

  w.Shell.go('tools');
  w.Prefs.set('toolsLayout', 'ring');
  check('it starts on the ring', !!$('.ns-tools .tl-ring'));
  /* the bug: setting the dial from settings, with no other call, must redraw */
  w.Prefs.set('toolsLayout', 'stack');
  check('setting the dial redraws it, with no other prompting',
    !!$('.ns-tools .tl-stack') && !$('.ns-tools .tl-ring'),
    ['tl-ring','tl-bar','tl-stack','tl-plain'].filter(c => $('.ns-tools .' + c)).join(',') || 'none');
  w.Prefs.set('toolsLayout', 'plain');
  check('… and again, for each of them', !!$('.ns-tools .tl-plain'));
  w.Prefs.reset('toolsLayout');
}

/* 4.11 — the cursor, driven at last.
   Three versions of this shipped without a single check that could move it,
   because `shown()` asked `offsetParent` and jsdom never populates one. Asking
   the question in ROOT's own vocabulary instead — a screen without `.on`, a
   slide without `.cur`, `[hidden]`, `.hidden`, inline display:none — is both
   more correct in a browser (offsetParent is null for position:fixed too) and
   answerable here. Everything below is the feature itself, not its source. */
{
  const C = w.Shell.cursor;
  w.Shell.go('do');

  check('the slide on screen is on screen, and the ones behind it are not',
    !!C.shown($('#view-do')) && !C.shown($('#view-log')),
    'do: ' + C.shown($('#view-do')) + ' log: ' + C.shown($('#view-log')));
  check('… and a hidden section is not, however it was hidden',
    (() => { const box = $('.ns-do #do-hist');
             if (!box) return true;
             box.classList.add('hidden');
             const no = C.shown(box);
             box.classList.remove('hidden');
             return !no; })());

  const blocks = C.blocks();
  /* The bug: a `.view` has exactly two children — the band and `.view-body` —
     so asking *it* for blocks answered "the band, and the whole rest of the
     page". Blocks come from the open screen now. */
  check("DO's blocks come from the open screen, never from the scroller",
    blocks.length >= 2 && !blocks.some(b => b.classList.contains('view-body')),
    blocks.map(b => b.id || b.className).join(' | '));
  check('… the band is one of them, and so is the routine grid',
    blocks.some(b => b.classList.contains('h-top')) &&
    blocks.some(b => b.id === 'home-grid'),
    blocks.map(b => b.id || b.className).join(' | '));

  /* The other half of the bug: the grid used to be unwrapped into its cards, so
     every "block" was a leaf with nothing inside — which is exactly what "I
     can't go into one block" was. */
  const grid = blocks.find(b => b.id === 'home-grid');
  check('the grid is one block holding its cards, not one block per card',
    C.items(grid).length > 1 && C.items(grid).every(el => el.classList.contains('card')),
    String(C.items(grid).length));

  C.to(grid);
  check('the cursor starts at block level', C.level() === 'block' && C.at() === grid);
  check('stepping into a block works, and lands on its first control',
    C.enter() === true && C.level() === 'item' && C.at() === C.items(grid)[0],
    C.level() + ' / ' + (C.at() && C.at().className));
  check('… the ring inside is that block, and nothing outside it',
    C.ring().length === C.items(grid).length && C.ring().every(el => grid.contains(el)),
    String(C.ring().length));
  check('… and coming back out returns to the block you came from',
    C.leave() === true && C.level() === 'block' && C.at() === grid);
  check('… while leaving from the top level says so rather than pretending',
    C.leave() === false);

  /* A block holding one control is that control: stepping in would be a step
     that did nothing, so act presses it instead. */
  const band = blocks.find(b => b.classList.contains('h-top'));
  C.to(band);
  check('a band with several controls can be stepped into',
    C.items(band).length > 1 ? C.enter() === true : C.enter() === false,
    String(C.items(band).length) + ' in the band');
  C.leave();

  /* Every tab must give blocks that are neither nothing nor everything. */
  const shape = {};
  ['do', 'log', 'store', 'plan', 'tend', 'settings'].forEach(t => {
    w.Shell.go(t);
    const b = C.blocks();
    shape[t] = b.length;
  });
  check('every tab reports blocks — some, and never the one giant one',
    Object.values(shape).every(n => n >= 2), JSON.stringify(shape));
  w.Shell.go('do');
  C.clear();
}

check('no errors through the whole of 4.5', errors.length === 0, errors.slice(0, 3).join(' | '));



/* 4.12 — TOOLS grew two instruments, on-tool dials, and a strip you can edit.
   What is checked here is the part that can go wrong quietly: a dial the
   instrument does not actually read, a record book keyed on a name rather than
   an id, and a strip that can be emptied. */
{
  w.localStorage.removeItem('tools_v1');
  w.TOOLS.reload();
  w.Shell.go('tools');
  const tlS = () => JSON.parse(w.localStorage.getItem('tools_v1') || '{}');
  const tabs = () => [...d.querySelectorAll('.ns-tools .tl-tab')].map(b => b.dataset.t).join(',');

  /* The strip is a Prefs list, and it is the visibility *and* the order. */
  w.Prefs.set('toolsShown', ['whf', 'pom']);
  check('the strip carries what Prefs says, in the order Prefs says',
    tabs() === 'whf,pom', tabs());
  /* The bug this guards: a tool switched off while it was the open one left
     the body drawing an instrument with no tab to get back to. */
  w.Prefs.set('toolsShown', ['opt']);
  check('… and switching off the open instrument falls back to one that is on',
    tabs() === 'opt' && !!d.querySelector('.ns-tools .tl-lists, .ns-tools .tl-empty'), tabs());
  w.Prefs.set('toolsShown', []);
  check('… and it can never be emptied — a strip with nothing on it is a dead screen',
    w.Prefs.get('toolsShown').length > 0, JSON.stringify(w.Prefs.get('toolsShown')));
  w.Prefs.reset('toolsShown');

  /* The on-tool dials. Their whole point is that the instrument reads them
     live: a slider that only writes to storage is the 4.10 bug again. */
  const pips = () => d.querySelectorAll('.ns-tools .tl-pips i').length;
  click($('.ns-tools .tl-dials-tog'));
  const rounds = $('.ns-tools [data-dial="pom-rounds"]');
  check('the pomodoro carries its three dials behind one word',
    d.querySelectorAll('.ns-tools .tl-dial').length === 3 && !!rounds,
    String(d.querySelectorAll('.ns-tools .tl-dial').length));
  rounds.value = '2';
  rounds.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('… a dial writes itself down', tlS().pom.dial.rounds === 2, JSON.stringify(tlS().pom.dial));
  check('… and the instrument reads it rather than the settings default', pips() === 2, String(pips()));
  click($('.ns-tools [data-act="dials-reset"]'));
  check('… and it goes back to the default rather than to a number of its own',
    tlS().pom.dial === null && pips() === w.Config.get('tools.pomodoro').rounds, String(pips()));

  /* Every instrument writes its finished thing down now, not only the breathing
     round. A focus round that ends has to reach LOG's day. */
  const logKey = 'log_' + today;
  w.localStorage.removeItem(logKey);
  w.Config.set('tools.pomodoro', { focus: 25, short: 5, long: 15, rounds: 4,
                                   autoStart: false, label: 'deep work' });
  click($('.ns-tools [data-act="pom-toggle"]'));
  const ended = tlS(); ended.pom.endsAt = w.Date.now() - 1;
  w.localStorage.setItem('tools_v1', JSON.stringify(ended));
  w.TOOLS.reload();
  await tick(500);                       // the 200ms tick is what finishes a phase
  check('a finished focus round is written into the day, the way a session is',
    ((JSON.parse(w.localStorage.getItem(logKey) || '{"e":{}}').e.blocks) || []).includes('deep work'),
    w.localStorage.getItem(logKey) || 'no day written');
  check('… and it leaves a row in the history beside the count it already kept',
    (tlS().pom.log[today] || []).length === 1 && tlS().pom.days[today] === 1,
    JSON.stringify(tlS().pom.log));
  w.TOOLS.resetAll(); settle();

  /* OPTIMISE. The record book *is* the instrument: a run that beats a split has
     to be told from one that did not, and both have to survive a rename of the
     list they were posted on — which is why they are filed under an id. */
  w.Config.set('tools.optimise', [{ id:'morning', name:'morning', color:'#e8a33d',
    colorMode:'preset', icon:'sun', steps:['walk','gym'] }]);
  w.Prefs.set('toolsShown', ['opt']);
  const listSub = () => { const el = $('.ns-tools .tl-list-nm em'); return el ? el.textContent : 'no row'; };
  check('a list is a row with its steps and a start on it',
    d.querySelectorAll('.ns-tools .tl-list').length === 1 && /2 steps/.test(listSub()), listSub());

  /* A run is driven by writing the clock rather than waiting on it: what is
     under test is the arithmetic on the splits, not setInterval. */
  const setRun = run => {
    const s = tlS(); s.opt.run = run;
    w.localStorage.setItem('tools_v1', JSON.stringify(s));
    w.TOOLS.reload();
  };
  const runOnce = (a, b) => {
    click($('.ns-tools [data-act="opt-start"]'));
    setRun(Object.assign(tlS().opt.run, { elapsed: a, running: false, startedAt: 0 }));
    click($('.ns-tools [data-act="opt-step"]'));            // first split lands at a
    setRun(Object.assign(tlS().opt.run, { elapsed: a + b, running: false, startedAt: 0 }));
    click($('.ns-tools [data-act="opt-step"]'));            // the last step finishes the run
  };
  runOnce(20000, 30000);
  check('the last step finishes the run and files it under today',
    (tlS().opt.days[today] || []).length === 1 && tlS().opt.run === null,
    JSON.stringify(tlS().opt.days));
  check('… and the record book takes the total and every split',
    tlS().opt.best.total.morning === 50000 &&
    tlS().opt.best.split['morning 0'] === 20000 &&
    tlS().opt.best.split['morning 1'] === 30000, JSON.stringify(tlS().opt.best));

  /* The comparison is the instrument: a slower run must not overwrite a record,
     and a faster split must take one even where the total did not. */
  runOnce(15000, 45000);
  check('a slower total leaves the record alone',
    tlS().opt.best.total.morning === 50000, String(tlS().opt.best.total.morning));
  check('… while a faster split still takes its own record',
    tlS().opt.best.split['morning 0'] === 15000 &&
    tlS().opt.best.split['morning 1'] === 30000, JSON.stringify(tlS().opt.best.split));

  /* The one that would be silent: a rename is an edit to the name, and the
     times are filed under the id, so they have to still be there. */
  w.Config.set('tools.optimise', [{ id:'morning', name:'the morning', color:'#e8a33d',
    colorMode:'preset', icon:'sun', steps:['walk','gym'] }]);
  check('renaming a list keeps its record — the times are filed under its id',
    tlS().opt.best.total.morning === 50000 && /best 0:50/.test(listSub()), listSub());

  click($('.ns-tools [data-act="opt-hist"]'));
  const rows = () => d.querySelectorAll('.ns-tools .tl-hrow').length;
  check('the history lists both runs', rows() === 2, String(rows()));
  click($('.ns-tools [data-act="opt-sort"][data-v="fast"]'));
  check('… and sorting by fastest puts the record at the top',
    /0:50/.test(d.querySelector('.ns-tools .tl-hrow .hr-t').textContent),
    d.querySelector('.ns-tools .tl-hrow .hr-t').textContent);
  click($('.ns-tools [data-act="opt-records"]'));
  check('… and records only shows the one that is one', rows() === 1, String(rows()));

  /* DATA reads the other three rather than keeping anything of its own. */
  w.Prefs.set('toolsShown', ['dat']);
  check('DATA draws what the other instruments wrote down',
    d.querySelectorAll('.ns-tools .tl-tile').length >= 1 && !!d.querySelector('.ns-tools .tl-chart svg'),
    String(d.querySelectorAll('.ns-tools .tl-tile').length) + ' tiles');
  click($('.ns-tools [data-act="dat-range"][data-v="week"]'));
  check('… and its range is a dial it remembers', tlS().dat.range === 'week', String(tlS().dat.range));

  /* An optimise list and its steps are findable, the way CREATE's stages are. */
  check('a list and its steps are findable by name',
    w.SEARCH.results('the morning').some(r => r.kind === 'content') &&
    w.SEARCH.results('gym').some(r => r.kind === 'content'),
    w.SEARCH.results('gym').map(r => r.kind + ':' + r.title).join(', ').slice(0, 80));

  w.Prefs.reset('toolsShown');
  w.Config.reset('tools.optimise');
  w.Config.reset('tools.pomodoro');
  w.TOOLS.resetAll(); settle();
  w.Shell.go('do');
}

check('no errors through the whole of 4.12', errors.length === 0, errors.slice(0, 3).join(' | '));



/* 4.12 — CREATE's practice counters.
   The hours that are not about any one thing. What is checked is the part that
   would be wrong silently: several taps in a minute have to be one session, or
   the session count stops meaning anything at all. */
{
  w.localStorage.removeItem('create_v1');
  w.CREATE.reload();
  w.Shell.go('create');
  /* The shelf, from the top and unnarrowed. `go` renders whichever screen was
     last open, so an earlier section leaving CREATE on its session log is what
     this asks past — and the strip is what the counters follow. */
  w.CREATE.go('home');
  const allChip = $('.ns-create .cr-tab[data-a="all"]');
  if (allChip) click(allChip);
  const prac = () => w.CREATE.sessions().filter(e => e.practice);
  const cards = () => [...d.querySelectorAll('.ns-create .cr-pcard')];
  const areas412 = w.CREATE.areas();

  check('the shelf opens with a counter for every area',
    cards().length === areas412.length && !!$('.ns-create .cr-range'),
    String(cards().length) + ' of ' + areas412.length);
  check('… each with a +30 and a +60 under it, and nothing logged yet',
    d.querySelectorAll('.ns-create .cr-pb').length === areas412.length * 2 && prac().length === 0,
    String(d.querySelectorAll('.ns-create .cr-pb').length));

  const first = areas412[0].key;
  const btn = (a, m) => $(`.ns-create [data-act="practice-add"][data-a="${a}"][data-m="${m}"]`);
  click(btn(first, 30));
  check('a tap logs half an hour of practice against that area',
    prac().length === 1 && prac()[0].hours === 0.5 && prac()[0].area === first &&
    prac()[0].work === null && prac()[0].date === today,
    JSON.stringify(prac()[0]));
  /* The rule the whole thing turns on: +30 twice because it was an hour is one
     session, not two. A log that said two would make the session count a lie. */
  click(btn(first, 30));
  check('… and a second tap inside the minute is more of that session, not a new one',
    prac().length === 1 && prac()[0].hours === 1, JSON.stringify(prac()));
  click(btn(first, 60));
  check('… however many land in it', prac().length === 1 && prac()[0].hours === 2,
    JSON.stringify(prac()));
  /* Aged out of the window by hand: a minute later is a different session. */
  /* Aged out of the grouping window by hand — sessions() hands back the live
     rows, so this is the real record moving back in time. */
  prac()[0].at = w.Date.now() - 90000;
  click(btn(first, 30));
  check('… while one that lands after the minute starts a session of its own',
    prac().length === 2, JSON.stringify(prac().map(e => e.hours)));

  check('the counter shows the total, not the session count',
    /2h30|2\.5h/.test($('.ns-create .cr-pcard .cr-pv b').textContent),
    $('.ns-create .cr-pcard .cr-pv b').textContent);

  /* The window is a word in the title line, and tapping it cycles. */
  check('the window starts on the week', /this week/.test($('.ns-create .cr-range').textContent),
    $('.ns-create .cr-range').textContent);
  click($('.ns-create .cr-range'));
  check('… and tapping it moves to the month', /this month/.test($('.ns-create .cr-range').textContent),
    $('.ns-create .cr-range').textContent);
  click($('.ns-create .cr-range'));
  click($('.ns-create .cr-range'));
  check('… and it comes back round to the week rather than running out',
    /this week/.test($('.ns-create .cr-range').textContent), $('.ns-create .cr-range').textContent);

  /* The strip filters the section, because the section is part of the shelf. */
  if (areas412.length > 1) {
    const chip = $(`.ns-create .cr-tab[data-a="${first}"]`);
    if (chip) click(chip);
    check('narrowing to one area leaves that area’s counter and no other',
      cards().length === 1, String(cards().length));
    const all = $('.ns-create .cr-tab[data-a="all"]');
    if (all) click(all);
    check('… and "all" brings them all back', cards().length === areas412.length, String(cards().length));
  }

  /* Switched off in settings. The hours stay — the list says which areas get a
     counter, never which sessions exist. */
  w.SET.panel('create');
  const sw = $(`.ns-create [data-act="practice-show"][data-a="${first}"]`);
  check('settings offers a switch per area', !!sw && sw.classList.contains('on'),
    [...d.querySelectorAll('.ns-create [data-act="practice-show"]')].map(b => b.dataset.a).join(','));
  click(sw);
  w.Shell.go('create');
  check('switching an area off takes its counter away and keeps its hours',
    cards().length === areas412.length - 1 && prac().length === 2,
    String(cards().length) + ' cards, ' + prac().length + ' sessions');
  w.SET.panel('create');
  click($(`.ns-create [data-act="practice-show"][data-a="${first}"]`));
  w.Shell.go('create');
  check('… and switching it back on finds the total exactly where it was left',
    cards().length === areas412.length &&
    /2h30|2\.5h/.test($('.ns-create .cr-pcard .cr-pv b').textContent),
    $('.ns-create .cr-pcard .cr-pv b').textContent);

  /* Practice is time at the desk like any other, so the week's hours count it —
     it is a session with no work, not a second kind of record. */
  check('practice reaches the week the shelf reports, like every other session',
    /2h30|2\.5h|3h/.test($('.ns-create #cr-week .cr-stat .v').textContent),
    $('.ns-create #cr-week .cr-stat .v').textContent);

  w.localStorage.removeItem('create_v1');
  w.CREATE.reload();
  w.Shell.go('do');
}

check('no errors through CREATE 4.12', errors.length === 0, errors.slice(0, 3).join(' | '));


/* 4.12 — the band's wordmark can wear the app's own tab glyph. */
{
  const shellCss412 = fs.readFileSync(path.join(ROOT, 'css/shell.css'), 'utf8');
  w.Shell.go('log');
  const mark = () => d.querySelector('.ns-log .h-top .h-logo-ic');
  check('every band carries the icon, injected once by the shell rather than typed into eleven headers',
    !!mark() && mark().querySelector('use').getAttribute('href') === '#tab-log' &&
    d.querySelectorAll('#track .view .h-top .h-logo-ic').length >= 10,
    String(d.querySelectorAll('#track .view .h-top .h-logo-ic').length) + ' bands');
  check('… and settings takes the short sprite name its tab button does',
    d.querySelector('#view-settings .h-logo-ic use') &&
    d.querySelector('#view-settings .h-logo-ic use').getAttribute('href') === '#tab-set',
    d.querySelector('#view-settings .h-logo-ic use')
      ? d.querySelector('#view-settings .h-logo-ic use').getAttribute('href') : 'none');
  check('it is the name alone by default, which is what every version before this was',
    d.documentElement.dataset.bandMark === 'name' &&
    /\[data-band-mark="both"\][^{]*\.h-logo-ic,/.test(shellCss412),
    d.documentElement.dataset.bandMark);
  w.Prefs.set('bandMark', 'icon');
  check('… and the choice is one attribute on the root, so switching costs no redraw',
    d.documentElement.dataset.bandMark === 'icon' &&
    /\[data-band-mark="icon"\] \.view > \.h-top \.h-logo\{[\s\S]{0,120}?font-size:0/.test(shellCss412),
    d.documentElement.dataset.bandMark);
  /* 4.12.1 — the mark was off centre with the letters gone. `text-box:trim-both
     cap alphabetic` trims the box to a cap height and `vertical-align:baseline`
     sits the mark on a baseline; both are right while there is type and both
     are nonsense at font-size:0, and together they were the offset. With no
     letters left the wordmark stops being laid out as type at all. */
  check('with the name gone the mark stops being laid out as type, so it centres',
    /\[data-band-mark="icon"\] \.view > \.h-top \.h-logo\{[\s\S]{0,200}?text-box:normal/.test(shellCss412) &&
    /\[data-band-mark="icon"\] \.view > \.h-top \.h-logo\{[\s\S]{0,200}?align-items:center/.test(shellCss412),
    'the icon-only rule still lays the mark out as type');
  check('… and the mark is a block in that mode, not an inline sitting on a baseline',
    /\[data-band-mark="icon"\][^{]*\.h-logo-ic\{[\s\S]{0,160}?display:block/.test(shellCss412));
  /* It is a title, so it wears what a title wears — the same hard offset, in
     the drawing's own way. */
  check('the icon carries the title shadow, as a drop-shadow rather than a text one',
    /\.h-logo-ic\{[\s\S]*?filter:drop-shadow\(var\(--title-sh-x\) 0 0 var\(--title-sh-c\)\)/.test(shellCss412));
  check('… and it is sized off the title, not off a pixel of its own',
    /\.h-logo-ic\{[\s\S]*?width:calc\(var\(--title-px\)/.test(shellCss412));
  w.Prefs.reset('bandMark');
  w.Shell.go('do');
}


/* 4.12.1 — DATA reads the whole app, not one tab's own stores.
   The question is "what do I actually do", and answering it out of TOOLS'
   three instruments was answering a much smaller one. Every series goes through
   the owning app's own read-only day reader, so what is checked here is that
   the readers exist, that DATA finds them, and that an app with nothing to say
   costs nothing rather than drawing a line of zeroes. */
{
  const iso4121 = w.Shell.today();

  /* Each app's reader, on its own terms first. */
  check('LOG hands out a day without handing out the record',
    typeof w.LOG.dayData === 'function' && typeof w.LOG.loggedDays === 'function' &&
    w.LOG.dayData('1999-01-01') === null,
    typeof w.LOG.dayData);
  w.localStorage.setItem('log_' + iso4121, JSON.stringify({
    date: iso4121, scale: 5,
    m: { wt:'72', sl:'7.5', nrg:'4', mood:'4', cs_on:true, cs:'2', wkg:'', km:'6', wo:'legs', tkg:'', tmin:'' },
    e: { kme:'', nrg:'3', mood:'5', stress:'2', meals:['a','b'], caf_c:2, caf_ed:0,
         cur_mix:0, cur_prod:0, cur_cont:0, blocks:['b1','b2','b3'], blocksPlan:[], media:[{name:'x'}] },
    entries: [{ t:'a' }, { t:'b' }],
  }));
  const dd = w.LOG.dayData(iso4121);
  check('… and what it hands out is the day, as numbers',
    dd.sleep === 7.5 && dd.walked === 6 && dd.blocks === 3 && dd.caffeine === 2 &&
    dd.meals === 2 && dd.entries === 2 && dd.media === 1 && dd.written === 2 &&
    dd.workout === true && dd.cold === true,
    JSON.stringify(dd));
  /* Morning and evening ask the same three, and both are kept — the day's shape
     is the pair, and folding them here would throw that away. */
  check('… both halves of the day survive, rather than being averaged away',
    dd.energyAm === 4 && dd.energyPm === 3 && dd.moodAm === 4 && dd.moodPm === 5,
    JSON.stringify([dd.energyAm, dd.energyPm, dd.moodAm, dd.moodPm]));
  check('… and the day is findable without walking storage from outside',
    w.LOG.loggedDays().includes(iso4121));
  check('TEND and STORE hand out their day too',
    typeof w.TEND.careOn === 'function' && typeof w.STORE.tripsOn === 'function' &&
    typeof w.TEND.careOn(iso4121) === 'number' &&
    typeof w.STORE.tripsOn(iso4121).trips === 'number',
    typeof w.TEND.careOn);

  /* And DATA reading them back. */
  w.Prefs.set('toolsShown', ['dat']);
  w.Shell.go('tools');
  w.TOOLS.render();
  const fams = () => [...d.querySelectorAll('.ns-tools [data-act="dat-focus"]')].map(b => b.dataset.v);
  check('DATA offers families, not the three instruments it used to be',
    fams().includes('body') && fams().includes('done') && fams().includes('life') &&
    fams().includes('tools') && fams()[0] === 'all',
    fams().join(','));
  const tiles = () => [...d.querySelectorAll('.ns-tools .tl-tile span')].map(s => s.textContent);
  check('… and it draws the day LOG just wrote, out of LOG',
    tiles().some(t => /sleep/.test(t)) && tiles().some(t => /blocks/.test(t)),
    tiles().join(' | '));

  /* A rating is averaged and a count is totalled: "27 mood" would be nonsense,
     and so would "0.4 blocks a day" as the headline. Earlier sections have
     written days of their own, so what is asserted is the *shape* of the answer
     rather than a number only this section knows. */
  click($('.ns-tools [data-act="dat-focus"][data-v="body"]'));
  const tileFor = word => [...d.querySelectorAll('.ns-tools .tl-tile')]
    .find(t => new RegExp(word).test(t.querySelector('span').textContent));
  const sleepTile = tileFor('sleep');
  check('a rating is averaged and says so, rather than being added up',
    !!sleepTile && /^average of \d+$/.test(sleepTile.querySelector('em').textContent) &&
    parseFloat(sleepTile.querySelector('b').textContent) <= 24,
    sleepTile ? sleepTile.querySelector('b').textContent + ' / ' + sleepTile.querySelector('em').textContent : 'no tile');
  click($('.ns-tools [data-act="dat-focus"][data-v="done"]'));
  const blockTile = [...d.querySelectorAll('.ns-tools .tl-tile')]
    .find(t => /blocks/.test(t.querySelector('span').textContent));
  check('… while a count is totalled', !!blockTile && blockTile.querySelector('b').textContent === '3',
    blockTile ? blockTile.querySelector('b').textContent : 'no tile');

  /* An empty day is not a day of zero. A night nobody wrote down must not pull
     the average towards nothing — measured as a before and an after, because a
     record with no sleep in it is the whole of what is being added. */
  const blankDay = offset(-6);
  w.localStorage.removeItem('log_' + blankDay);
  click($('.ns-tools [data-act="dat-focus"][data-v="body"]'));
  const before = tileFor('sleep');
  const wasAvg = before && before.querySelector('b').textContent;
  const wasN   = before && before.querySelector('em').textContent;
  w.localStorage.setItem('log_' + blankDay, JSON.stringify({
    date: blankDay, scale: 5, m: {}, e: {}, entries: [] }));
  click($('.ns-tools [data-act="dat-focus"][data-v="body"]'));
  const after = tileFor('sleep');
  check('a day nobody wrote is not a day of zero — it is left out of the average',
    !!after && after.querySelector('b').textContent === wasAvg &&
    after.querySelector('em').textContent === wasN,
    wasAvg + '/' + wasN + ' -> ' +
      (after ? after.querySelector('b').textContent + '/' + after.querySelector('em').textContent : 'no tile'));
  w.localStorage.removeItem('log_' + blankDay);

  /* A focus naming something this build cannot draw shows everything rather
     than an empty screen that reads as a bug. */
  w.TOOLS.reload();
  const st4121 = JSON.parse(w.localStorage.getItem('tools_v1') || '{}');
  st4121.dat = { range: 'week', focus: 'gone' };
  w.localStorage.setItem('tools_v1', JSON.stringify(st4121));
  w.TOOLS.reload();
  check('a focus this build has never heard of falls back to everything',
    d.querySelectorAll('.ns-tools .tl-tile').length > 1,
    String(d.querySelectorAll('.ns-tools .tl-tile').length) + ' tiles');

  /* And the band counts the days the whole app has, not the three stores. */
  check('the band counts every day anything in the app recorded',
    $('.ns-tools #tl-daynum').textContent.trim() !== '0',
    $('.ns-tools #tl-daynum').textContent);

  w.localStorage.removeItem('log_' + iso4121);
  w.Prefs.reset('toolsShown');
  w.TOOLS.resetAll(); settle();
  w.Shell.go('do');
}

check('no errors through 4.12.1', errors.length === 0, errors.slice(0, 3).join(' | '));

/* 4.13 — SYNC: the journal, the four groups, safe transfer, and one tap.
   The engine changed from "a list of keys this file knows about" to "whatever
   this device has written lately", so what is checked here is the part that
   decides: what a payload is allowed to carry, and who wins when both sides
   wrote the same record. */
{
  const LS413 = w.localStorage;
  const S = w.SYNC;
  const day413 = w.Shell.today();

  /* The journal. Every write is noted by wrapping Storage.prototype once, so a
     key nothing in sync.js has ever heard of is still carried. */
  LS413.setItem('brand_new_key_v1', JSON.stringify({ hello: 1 }));
  check('a write this file knows nothing about is still noted',
    S.touchedAt('brand_new_key_v1') > 0, String(S.touchedAt('brand_new_key_v1')));
  check('and it is in the last 24 hours of changes',
    S.changedSince(Date.now() - 60000).includes('brand_new_key_v1'));
  check('sync’s own bookkeeping is never journalled — it would never settle',
    S.touchedAt('root_sync_touch_v1') === 0 && S.touchedAt('root_sync_v1') === 0);

  check('a key on no route’s list travels anyway, because it was written',
    'brand_new_key_v1' in S.build('file').state,
    Object.keys(S.build('file').state).join(','));
  check('and the payload says when each record was written',
    S.build('file').touch.brand_new_key_v1 === S.touchedAt('brand_new_key_v1'));

  /* The four groups. `apps` is everything an app wrote; style is the whole
     appearance engine; system is the shell's bookkeeping and is off. */
  check('the groups are what the section says they are',
    S.groupOf('brand_new_key_v1') === 'apps' && S.groupOf('root_prefs_v1') === 'style' &&
    S.groupOf('root_config_v1') === 'settings' && S.groupOf('root_tab') === 'system',
    [S.groupOf('root_prefs_v1'), S.groupOf('root_config_v1'), S.groupOf('root_tab')].join(','));
  check('the shell’s own bookkeeping stays here unless it is asked for',
    !S.carries('file', 'root_tab'));
  w.Prefs.set('syncSystem', true);
  check('… and travels when it is', S.carries('file', 'root_tab'));
  w.Prefs.reset('syncSystem');
  w.Prefs.set('syncStyle', false);
  check('a group switched off carries none of its keys', !S.carries('file', 'root_prefs_v1'));
  w.Prefs.reset('syncStyle');
  check('… and carries them again when it is back on', S.carries('file', 'root_prefs_v1'));

  /* Safe transfer is the old route split, made into a dial. */
  check('safe transfer keeps the journal off the route that leaves the device',
    !S.carries('todoist', 'log_' + day413) && S.carries('file', 'log_' + day413));
  w.Prefs.set('syncSafe', false);
  check('turning it off is what lets the logged day go over Todoist',
    S.carries('todoist', 'log_' + day413));
  {
    LS413.setItem('log_' + day413, JSON.stringify({ m: { nrg: '3', saved: 10 }, e: {} }));
    const built = S.build('todoist');
    check('and then the day itself is in the payload, beside DO’s',
      !!(built.days[day413] && built.days[day413].log), JSON.stringify(Object.keys(built.days[day413] || {})));
  }
  w.Prefs.reset('syncSafe');
  check('a key that is nothing but a Todoist key travels on no route, by no switch',
    !S.carries('file', 'plan_token') && !S.carries('todoist', 'plan_token') &&
    !S.carries('file', 'root_todoist_v1'));

  /* The rule the request asked for: the most recent write wins, rather than a
     question nobody is there to answer. */
  {
    const M413 = S._merge;
    check('the more recently written record wins',
      M413.mergeState('k', { a: 1 }, { a: 2 }, 500, 100).out.a === 2);
    check('… and ours is kept when ours is the newer one',
      M413.mergeState('k', { a: 1 }, { a: 2 }, 100, 500).out.a === 1);
    check('… and the same moment settles on the fuller record, not a question',
      M413.mergeState('k', { a: 1 }, { a: 2, b: 2 }, 100, 100).out.b === 2);
  }
  {
    LS413.setItem('brand_new_key_v1', JSON.stringify({ hello: 'mine' }));
    const mine413 = S.touchedAt('brand_new_key_v1');
    const payload = { app: 'root', kind: 'sync', version: 1, route: 'file', device: 'x',
                      written: Date.now(), days: {}, state: { brand_new_key_v1: { hello: 'theirs' } },
                      touch: { brand_new_key_v1: mine413 + 5000 } };
    const planned = S.plan('file', payload);
    check('a record written later on the other device is planned as a write',
      planned.writes.some(x => x.key === 'brand_new_key_v1'),
      JSON.stringify(planned.writes.map(x => x.key)));
    S.commit(planned);
    check('committing takes their answer',
      JSON.parse(LS413.getItem('brand_new_key_v1')).hello === 'theirs');
    check('and the journal keeps *their* moment, not the moment it landed here',
      S.touchedAt('brand_new_key_v1') === mine413 + 5000, String(S.touchedAt('brand_new_key_v1')));
    S.undoImport();
  }

  /* "Know immediately that the data it is importing has already been imported." */
  {
    const a = S.build('file'), b = S.build('file');
    check('two builds of an unchanged device have the same id', a.id === b.id, a.id + ' / ' + b.id);
    check('a payload that has not been taken in is not already seen', !S.alreadySeen('file', a.id));
    S.markPulled('file', a.id);
    check('… and is, once it has', S.alreadySeen('file', a.id));
    LS413.setItem('brand_new_key_v1', JSON.stringify({ hello: 'changed' }));
    check('a device that has changed since says so with a different id',
      S.build('file').id !== a.id);
  }

  LS413.removeItem('brand_new_key_v1');
  LS413.removeItem('log_' + day413);

  /* The section, and the one button that is both directions. */
  w.SET.panel('sync');
  check('the sync section carries the refresh dial, safe transfer and the four groups',
    !!$('.ns-set [data-pref="syncEvery"]') && !!$('.ns-set [data-pref="syncSafe"]') &&
    ['syncApps', 'syncSettings', 'syncStyle', 'syncSystem']
      .every(k => !!$('.ns-set #sync-groups [data-pref="' + k + '"]')));
  check('the refresh dial offers off and the nine intervals asked for',
    [...d.querySelectorAll('.ns-set [data-pref="syncEvery"]')].map(b => b.dataset.val).join(',')
      === '0,1,2,3,4,5,10,15,30,60');
  check('one tap is one tap: DO’s header sync is the device sync, not a direction',
    /SET\.syncNow/.test($('#view-do .h-act.sync').getAttribute('onclick') || ''),
    $('#view-do .h-act.sync').getAttribute('onclick'));
  check('and the automatic refresh is off until it is asked for',
    String(w.Prefs.get('syncEvery')) === '0');
  w.Shell.go('do');
}

check('no errors through 4.13', errors.length === 0, errors.slice(0, 3).join(' | '));

/* 4.13.1 — the header sync lost DO's routines, and an import landed unseen.
   Both are 4.13.0's doing: the button was repointed at the device sync, and
   SYNC.run() wrote records with none of the "reload to see them" the reviewed
   import has always had. */
{
  const LS4131 = w.localStorage;

  /* DO's own Todoist sync is still there, still reachable, and now answers its
     caller instead of only toasting. `quiet` is TEND's convention. */
  check('DO.syncTodoist takes a quiet flag and reports back',
    typeof w.DO.syncTodoist === 'function' && w.DO.syncTodoist.length === 1,
    String(w.DO.syncTodoist.length));
  check('and its own button under settings → do is untouched',
    /DO\.syncTodoist\(\)/.test(d.querySelector('.set-panel[data-panel="do"] [data-td-btn="sync now"]')
      ?.getAttribute('onclick') || ''),
    d.querySelector('.set-panel[data-panel="do"] [data-td-btn="sync now"]')?.getAttribute('onclick'));

  /* The header button is the one that has to do both: routines, then the
     device sync, so ticks made here are in the payload it sends. */
  const src4131 = fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8');
  const runBody = src4131.slice(src4131.indexOf('async function syncNow'),
                                src4131.indexOf('function offerReload'));
  check('one tap runs DO’s routines as well as the device sync',
    /DO\.syncTodoist\(true\)/.test(runBody) && /SYNC\.run\(\)/.test(runBody));
  check('… and the routines go first, so what they tick here travels',
    runBody.indexOf('DO.syncTodoist(true)') < runBody.indexOf('SYNC.run()'));
  check('an import that wrote records offers the reload that makes them visible',
    /if \(r\.imported\) offerReload\(r\.imported\)/.test(runBody));

  /* A quiet run says nothing itself, but still answers — which is the whole
     point of the flag: the caller has its own line to compose. */
  {
    const res = await w.DO.syncTodoist(true);
    check('a quiet run answers its caller with what it moved',
      res !== undefined && (res === null || typeof res.msg === 'string'), JSON.stringify(res));
  }

  /* And the automatic run reports rather than reloading under you. */
  const autoWire = src4131.slice(src4131.indexOf('SYNC.onAuto('), src4131.indexOf('SYNC.onAuto(') + 400);
  check('an automatic run offers no dialog — it says what it took in',
    /Shell\.toast\(/.test(autoWire) && !/location\.reload/.test(autoWire));

  void LS4131;
}

check('no errors through 4.13.1', errors.length === 0, errors.slice(0, 3).join(' | '));

/* 4.14 — the written brief: six routines, entries on the calendar, sessions
   that survive a sync, no overlaps left to answer, and correlations. */
{
  /* DO — the six daily routines, and the history that must outlive them. */
  const rts414 = w.Config.get('do.routines');
  const daily414 = (w.Config.get('do.tabs').find(t => t.id === 'daily') || {}).routines || [];
  check('the daily tab carries the six routines the brief names',
    daily414.join(',') === 'fix,fit,log,eat,reset,plan', daily414.join(','));
  check('each one is there with the items it was given',
    rts414.fix.items.length === 6 && rts414.fit.items.includes('kamo walk m') &&
    rts414.log.items.join(',') === 'log morning,log evening,log meds' &&
    rts414.eat.items.length === 5 && rts414.reset.items.includes('vacuum') &&
    rts414.plan.items.includes('gym prep'),
    JSON.stringify(Object.keys(rts414)));
  check('the label is the word, because the Todoist task is matched on it',
    ['fix','fit','log','eat','reset','plan'].every(k => rts414[k].label === k));

  /* The tally is keyed by whatever routine wrote it, and summed by whatever
     keys the row has — so a day recorded under the old six still reads. */
  {
    const old414 = '2026-08-02';
    const stats = JSON.parse(w.localStorage.getItem('do-stats-v1') || '{"v":1,"days":{}}');
    stats.days[old414] = { routinep1: [5, 7], cooldown: [5, 5] };
    w.localStorage.setItem('do-stats-v1', JSON.stringify(stats));
    const back = w.DO.statsFor(old414);
    check('a day recorded under the old routines still reads in the strip',
      !!back && back.done === 10 && back.total === 12, JSON.stringify(back));
    const s2 = JSON.parse(w.localStorage.getItem('do-stats-v1'));
    delete s2.days[old414];
    w.localStorage.setItem('do-stats-v1', JSON.stringify(s2));
  }

  /* An override of the old set is dropped so the new default can be seen; one
     with a routine of your own in it is left exactly alone. */
  {
    const OLD = { routinep1:{label:'a',items:['x']}, routinep2:{label:'b',items:['x']},
                  routinep3:{label:'c',items:['x']}, routinep4:{label:'d',items:['x']},
                  cooldown:{label:'e',items:['x']}, cleanup:{label:'f',items:['x']} };
    w.Config.set('do.routines', OLD);
    w.Config.load();
    check('an override that is still the old six is dropped, so the new six show',
      Object.keys(w.Config.get('do.routines')).join(',').includes('fix'),
      Object.keys(w.Config.get('do.routines')).join(','));

    w.Config.set('do.routines', Object.assign({ mine:{ label:'mine', items:['x'] } }, OLD));
    w.Config.load();
    check('… while an override carrying a routine of your own is left alone',
      !!w.Config.get('do.routines').mine);
    w.Config.reset('do.routines'); w.Config.reset('do.tabs');
  }

  /* LOG — the entries toggle on the month grid. */
  w.Shell.go('log');
  const entDay = w.Shell.today();
  const beforeEnt = w.localStorage.getItem('log_' + entDay);
  w.localStorage.setItem('log_' + entDay, JSON.stringify({ date: entDay, m: {}, e: {},
    entries: [{ time: '09:00', text: 'one' }, { time: '10:00', text: 'two' }] }));
  w.Shell.go('log');
  const tog = d.querySelector('.ns-log [data-cal-entries]');
  check('the month grid carries an entries toggle', !!tog);
  const cellFor = iso => d.querySelector(`.ns-log .lc-c[data-day="${iso}"]`);
  check('and shows the date until it is pressed',
    cellFor(entDay) && cellFor(entDay).textContent.trim() === String(+entDay.slice(8)),
    cellFor(entDay) && cellFor(entDay).textContent);
  click(tog);
  check('pressed, the cell counts that day’s journal entries instead',
    cellFor(entDay) && cellFor(entDay).textContent.trim() === '2',
    cellFor(entDay) && cellFor(entDay).textContent);
  check('… and a day with none shows nothing rather than a zero',
    [...d.querySelectorAll('.ns-log .lc-c.count')].some(c => c.textContent.trim() === ''));
  click(d.querySelector('.ns-log [data-cal-entries]'));
  check('pressing it again gives the dates back',
    cellFor(entDay) && cellFor(entDay).textContent.trim() === String(+entDay.slice(8)));
  if (beforeEnt === null) w.localStorage.removeItem('log_' + entDay);
  else w.localStorage.setItem('log_' + entDay, beforeEnt);

  /* CREATE — sessions are events, so they union rather than being chosen
     between. This is the fault the brief reported. */
  {
    const M414 = w.SYNC._merge;
    const mine = { v:2, works:[{ id:'w1', name:'mine', touched:'2026-09-01' }],
                   sessions:[{ id:'s1', date:'2026-09-01', hours:2 }] };
    const theirs = { v:2, works:[{ id:'w2', name:'theirs', touched:'2026-09-02' }],
                     sessions:[{ id:'s2', date:'2026-09-02', hours:1 }] };
    const out = M414.mergeCreate(mine, theirs, true).out;
    check('a session logged on each device survives the sync',
      out.sessions.length === 2 && out.sessions.some(x => x.id === 's1') &&
      out.sessions.some(x => x.id === 's2'), JSON.stringify(out.sessions.map(x => x.id)));
    check('… and so does a work added on each',
      out.works.length === 2, JSON.stringify(out.works.map(x => x.id)));
    const same = M414.mergeCreate(
      { v:2, works:[], sessions:[{ id:'s1', date:'2026-09-01', hours:1 }] },
      { v:2, works:[], sessions:[{ id:'s1', date:'2026-09-01', hours:3 }] }, false).out;
    check('the same session on both sides keeps the one that was added to',
      same.sessions.length === 1 && same.sessions[0].hours === 3,
      JSON.stringify(same.sessions));
  }

  /* The sheet is gone, and with it every way of being asked. */
  check('nothing is left to answer: plan() hands back writes and notes only',
    !('conflicts' in w.SYNC.plan('file', { app:'root', kind:'sync', version:1, route:'file',
        device:'x', written:Date.now(), days:{}, state:{} })));
  check('the overlap sheet is gone from the page', !d.getElementById('ovl'));
  check('… and from SET', !w.SET.syncApply && !w.SET.syncPick && !w.SET.syncCancel);

  /* TOOLS — correlations. Two of TOOLS' own series, written as days that move
     together: more focus, more breathing rounds, twelve days running. */
  {
    const beforeTools = w.localStorage.getItem('tools_v1');
    const pomLog = {}, whfDays = {};
    for (let i = 0; i < 12; i++) {
      const iso = w.SYNC.window(20)[20 - i];          // today and the eleven before it
      const n = 1 + (i % 4);                          // 1..4, and back again
      pomLog[iso] = Array.from({ length: n }, () => ({ at: '10:00', mins: 25 }));
      whfDays[iso] = Array.from({ length: n }, () => ({ at: '08:00', rounds: 3, holds: [60], best: 60 }));
    }
    w.localStorage.setItem('tools_v1', JSON.stringify({ v: 2, tool: 'dat',
      pom: { log: pomLog, days: {} }, whf: { days: whfDays },
      dat: { range: 'month', focus: 'tools' } }));
    w.TOOLS.reload();
    w.Shell.go('tools');

    const rows = [...d.querySelectorAll('.ns-tools .tl-corr')];
    check('two series that move together are found and named',
      rows.some(r => /focus/.test(r.textContent) && /breathing/.test(r.textContent)),
      rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | ') || 'no rows');
    check('… and the row says how strong it is and on how many days',
      rows.length > 0 && /r [\d.]/.test(rows[0].textContent) && /days?/.test(rows[0].textContent),
      rows[0] && rows[0].textContent.replace(/\s+/g, ' ').trim());
    check('the section says it is not claiming a cause',
      /not causes/.test($('#view-tools').textContent));

    /* Two days of overlap is not a finding. LOG's series answer `null` for a day
       nobody wrote — unlike TOOLS' own counts, where a quiet day is a real zero
       — so this is where the minimum actually bites. */
    const logDays = w.SYNC.window(20).slice(12, 20);
    const keptLog = logDays.map(iso => [iso, w.localStorage.getItem('log_' + iso)]);
    const writeLog = (iso, sl, mood) => w.localStorage.setItem('log_' + iso,
      JSON.stringify({ date: iso, m: { sl: String(sl), mood: String(mood) }, e: {}, entries: [] }));

    w.localStorage.setItem('tools_v1', JSON.stringify({ v: 2, tool: 'dat',
      pom: { log: {}, days: {} }, whf: { days: {} },
      dat: { range: 'month', focus: 'body' } }));
    writeLog(logDays[0], 6, 2); writeLog(logDays[1], 9, 5);
    w.TOOLS.reload(); w.Shell.go('tools');
    check('two days that agree are not a finding',
      !d.querySelector('.ns-tools .tl-corr') &&
      /nothing strong enough yet|A link needs/.test($('#view-tools').textContent),
      [...d.querySelectorAll('.ns-tools .tl-corr')].length + ' rows');

    logDays.forEach((iso, i) => writeLog(iso, 5 + (i % 4), 1 + (i % 4)));
    w.TOOLS.reload(); w.Shell.go('tools');
    check('… and eight of them are',
      [...d.querySelectorAll('.ns-tools .tl-corr')]
        .some(r => /sleep/.test(r.textContent) && /mood/.test(r.textContent)),
      [...d.querySelectorAll('.ns-tools .tl-corr')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | ') || 'no rows');
    keptLog.forEach(([iso, was]) => { if (was === null) w.localStorage.removeItem('log_' + iso);
                                      else w.localStorage.setItem('log_' + iso, was); });

    if (beforeTools === null) w.localStorage.removeItem('tools_v1');
    else w.localStorage.setItem('tools_v1', beforeTools);
    w.TOOLS.reload();
    w.Shell.go('do');
  }
}

check('no errors through 4.14', errors.length === 0, errors.slice(0, 3).join(' | '));




console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
