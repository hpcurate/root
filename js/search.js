/* ── Search ───────────────────────────────────────────────────────────────────
   One field over the whole of ROOT: the apps, every settings dial by name,
   everything Config holds — routines and their items, packing lists, aisles and
   groceries, meals, PLAN's projects and sections, TEND's plant types, TRACK's
   54 topics — and whatever each app answers for its own storage (DO's travel
   checklists, TEND's plants, LEARN's decks) through the `search` hook it
   registers with the shell.

   Why it exists: eleven settings panels and ~40 dials means "where do I change
   X" was the longest walk in the app, and the content editors made the same
   true of "where is that item". Nothing here is a new source of truth — every
   entry is derived from Config, from Prefs' own rendered controls (see
   SET.searchIndex) or from a module, so a routine renamed this morning is
   findable this afternoon without a line being added here.

   The overlay is a `.sheet-back` sibling of #views, not a child of #track:
   anything position:fixed inside the track is captured by the first ancestor
   that animates a transform. Being a sheet also buys Escape and the shell's
   keyboard suppression for free, which is what lets you type "b" in here
   without landing on another tab. */
window.SEARCH = (function () {
'use strict';

const back  = document.getElementById('search-back');
const sheet = document.getElementById('search');
const input = document.getElementById('search-q');
const list  = document.getElementById('search-out');
if (!back || !sheet || !input || !list) return { open(){}, close(){}, results: () => [] };

const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const APP_NAMES = { do:'DO', log:'LOG', plan:'PLAN', store:'STORE', tend:'TEND', track:'TRACK', learn:'LEARN', cal:'DAY' };

/* ── What Config holds, flattened ─────────────────────────────────────────────
   One entry per line: which path it lives under, what a match is called, and
   where tapping it goes — always the panel whose editor owns that path, since
   that is the one place the thing can actually be changed. A path missing from
   Config (an app's branch reset to nothing) simply yields nothing. */
const CONTENT = [
  { path:'do.routines',        app:'do',    what:'routine',
    rows: v => Object.keys(v || {}).flatMap(k => [{ name: v[k].label, sub:'routine' }]
      .concat((v[k].items || []).map(i => ({ name: i, sub: 'routine · ' + v[k].label })))) },
  { path:'do.travelCategories', app:'do',   what:'packing',
    rows: v => Object.keys(v || {}).flatMap(k => [{ name: k, sub:'packing category' }]
      .concat((v[k] || []).map(i => ({ name: i, sub: 'packing · ' + k })))) },
  { path:'do.mediaLabels',     app:'do',    rows: v => (v || []).map(l => ({ name:'@' + l, sub:'media label' })) },
  { path:'log.blocks',         app:'log',   rows: v => (v || []).map(b => ({ name: b.name, sub:'focus block' })) },
  { path:'log.workouts',       app:'log',   rows: v => (v || []).map(x => ({ name: x, sub:'workout type' })) },
  { path:'plan.types',         app:'plan',
    rows: v => (v || []).flatMap(t => [{ name: t.label, sub:'plan project' }]
      .concat((t.subs || []).map(s => ({ name: s.display, sub: 'section · ' + t.label })))) },
  { path:'plan.presets',       app:'plan',  rows: v => (v || []).map(p => ({ name: p.label, sub:`preset · ${(p.tasks || []).length} tasks` })) },
  { path:'plan.calendars',     app:'plan',  rows: v => Object.keys(v || {}).map(k => ({ name: v[k], sub: 'calendar · ' + k })) },
  { path:'store.categories',   app:'store',
    rows: v => Object.keys(v || {}).flatMap(k => [{ name: v[k].label, sub:'aisle' }]
      .concat((v[k].items || []).map(i => ({ name: i, sub: 'aisle · ' + v[k].label })))) },
  { path:'store.meals',        app:'store', rows: v => Object.keys(v || {}).map(k => ({ name: v[k].label, sub:'meal' })) },
  { path:'tend.groups',        app:'tend',  rows: v => (v || []).map(g => ({ name: g.label, sub:'plant type' })) },
  { path:'track.curriculum',   app:'track', rows: v => (v || []).map(t => ({ name: t.t, sub: `topic ${t.id} · ${t.dom}` })) },
  { path:'learn.ratings',      app:'learn', rows: v => (v || []).map(r => ({ name: r, sub:'rating' })) },
  { path:'cal.eventColors',    app:'cal',   rows: v => Object.keys(v || {}).map(k => ({ name: k, sub:'event colour' })) },
];

function contentHits(q) {
  const out = [];
  CONTENT.forEach(src => {
    let rows = [];
    try { rows = src.rows(Config.get(src.path)) || []; } catch { rows = []; }
    rows.forEach(r => {
      if (!r.name || !fold(r.name).includes(q)) return;
      out.push({ kind:'content', title: r.name, sub: `${APP_NAMES[src.app]} · ${r.sub}`,
                 go: () => Shell.settings(src.app) });
    });
  });
  return out;
}

/* The apps themselves — by name, and by what they are for. An app that is not
   in the bar opens the way the settings home opens it. */
function appHits(q) {
  return Shell.APPS.filter(a => fold(a).includes(q) || fold(APP_NAMES[a]).includes(q))
    .map(a => ({ kind:'app', title: APP_NAMES[a], sub:'open the app',
                 go: () => (Shell.TABS.includes(a) ? Shell.go(a) : Shell.open(a)) }));
}

function settingHits(q) {
  const idx = (window.SET && SET.searchIndex) ? SET.searchIndex() : [];
  return idx.filter(e => e.words.includes(q) || fold(e.title).includes(q))
            .map(e => ({ kind: e.kind, title: e.title, sub: e.sub, go: () => Shell.settings(e.panel) }));
}

/* Order: the apps, then their own data, then content, then settings. What you
   are looking for is nearly always a thing before it is a knob. */
const LIMIT = 40;
function results(raw) {
  const q = fold(String(raw || '').trim());
  if (q.length < 2) return [];
  const hits = appHits(q)
    .concat(Shell.searchApps ? Shell.searchApps(q) : [])
    .concat(contentHits(q))
    .concat(settingHits(q));
  const seen = new Set();
  return hits.filter(h => {
    const k = h.kind + '|' + h.title + '|' + h.sub;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, LIMIT);
}

let shown = [];
function render() {
  const q = input.value;
  shown = results(q);
  if (fold(q.trim()).length < 2) {
    list.innerHTML = `<div class="sr-empty">apps · routines · groceries · plants · topics · every setting by name</div>`;
    return;
  }
  if (!shown.length) { list.innerHTML = `<div class="sr-empty">nothing matches “${esc(q.trim())}”</div>`; return; }
  list.innerHTML = shown.map((h, i) => `<button class="sr" data-i="${i}">
      <span class="sr-k">${esc(h.kind)}</span>
      <span class="sr-b"><span class="sr-t">${esc(h.title)}</span><span class="sr-s">${esc(h.sub)}</span></span>
    </button>`).join('');
}

function pick(i) {
  const h = shown[+i];
  if (!h) return;
  close();
  if (window.Prefs) Prefs.tap();
  try { h.go(); } catch (e) { console.error(e); Shell.toast('could not open that'); }
}

function open() {
  if (window.SET && SET.dropIndex) SET.dropIndex();   // a panel may have changed since last time
  back.classList.add('on');
  sheet.classList.add('on');
  input.value = '';
  render();
  /* Not focused on a touch device: the keyboard would cover the results before
     there are any, and the field is one tap away. On a laptop — where "/" is
     how this was opened — focus is the whole point. */
  try { if (!window.matchMedia || !matchMedia('(pointer:coarse)').matches) input.focus(); } catch {}
}
function close() {
  back.classList.remove('on');
  sheet.classList.remove('on');
  input.blur();
}

back.addEventListener('click', close);
document.getElementById('search-close').addEventListener('click', close);
input.addEventListener('input', render);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { pick(0); e.preventDefault(); }
  if (e.key === 'Escape') { close(); e.preventDefault(); }
});
list.addEventListener('click', e => {
  const b = e.target.closest('.sr');
  if (b) pick(b.dataset.i);
});

return { open, close, results };
})();
