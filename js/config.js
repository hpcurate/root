/* ── Config ───────────────────────────────────────────────────────────────────
   The content layer. Everything the four apps used to hardcode — DO's routines
   and packing categories, LOG's blocks / meds / meals / counters, PLAN's project
   tree, STORE's aisles and meals — lives here as a DEFAULTS tree, and every
   branch of it can be overridden by the user from Settings.

   Why a separate file: those literals were personal data sitting inside program
   logic. Changing "which blocks exist" meant editing a stylesheet, an HTML
   button and a JS array in three places. Now there is one shape, one editor and
   one storage key.

   Contract for the app modules
   ────────────────────────────
     Config.get(path)          merged value — user override if present, else default
     Config.set(path, value)   persist an override and notify subscribers
     Config.reset(path)        drop the override, fall back to the default
     Config.isCustom(path)     has this branch been overridden?
     Config.defaults(path)     the shipped value, ignoring any override
     Config.subscribe(fn)      fn(path) after any set/reset/import

   Overrides are stored whole-branch, not deep-merged: if you edit the routines,
   your list replaces the shipped one outright. Deep-merging user edits into a
   shipped list makes deletions impossible to express, which is the one thing an
   editor has to be able to do.

   Storage key: root_config_v1 (a single JSON blob of overrides only, so an
   untouched install stores nothing at all). */
window.Config = (function () {
'use strict';

const KEY = 'root_config_v1';

/* ── Defaults ─────────────────────────────────────────────────────────────── */
const DEFAULTS = {

  /* ── DO ─────────────────────────────────────────────────────────────────── */
  do: {
    /* Each routine is an ordered list of items. The glyph prefixes are part of
       the item text, so the editor treats them as plain characters — paste any
       symbol you like. */
    routines: {
      routinep1: { label: 'Routine P1', items: ['≈ shower','≋ teeth','◡ cream','○ breakfast p1','✚ meds','↑ walk kamo','▲ gym'] },
      routinep2: { label: 'Routine P2', items: ['○ breakfast p2','≡ morning log','≡ log meds','✎ journal entry'] },
      routinep3: { label: 'Routine P3', items: ['◐ lunch p1','✎ journal entry','✦ feed kamo','≈ fill kamo water','◐ lunch p2','↑ kamo walk'] },
      routinep4: { label: 'Routine P4', items: ['≡ evening log','✎ journal entry','▤ plan blocks','▦ schedule','○ cleanup / dishes'] },
      cooldown:  { label: 'Cooldown',   items: ['▭ bed out','≈ fill water','≋ teeth','◇ tongue','◡ cream'] },
      cleanup:   { label: 'Cleanup',    items: ['○ dishes','✿ plants','⟳ vacuum','⊞ tidy up','✕ trash/recycle'] },
      deepclean: { label: 'Deep Clean', items: ['≋ dusting','⟳ vacuum','▧ mop','▭ surfaces','≈ bathroom sink','○ toilet','✕ trash'] },
    },
    /* Which routines sit under which home tab, and what the tabs are called.
       Add a tab here and the home screen grows one. */
    tabs: [
      { id: 'daily', label: 'daily', routines: ['routinep1','routinep2','routinep3','routinep4','cooldown','cleanup'] },
      { id: 'other', label: 'other', routines: ['deepclean'] },
    ],
    /* Master packing categories. A new travel checklist is built by picking
       which of these to include; every item starts as a counter at 1. */
    travelCategories: {
      clothes:     ['shirts','boxers','short socks','long socks','sweatpant','pants','shorts','sweater','swim trunks','rain coat','belt','jacket','packing cubes'],
      toiletries:  ['toothbrush','toothbrush charger','toothpaste','face cream','eye cream','soap tube','facewash tube','shampoo tube','deodorant','gel','towel','nail care','nail file','nail cutter','talc','wash cloth','hygiene wipes','razor','razor charger'],
      meds:        ['lamotrigine','ritalin','caffeine pill','vitamins','biseptine','disenfectant','cottons','sunscreen','band aids'],
      electronics: ['phone','watch','headset','earphones','portable speaker','usb a plug','usb a to c','usb c to c','usb a to micro','watch cable','charge block','usb a fast power','mac','mac charger','laptop','laptop charger','laptop pounch','battery bank small','battery bank big','controller','headphones (dj)'],
      kamo:        ['toys','croquette bag','treats','black leash','long leash','towel','duvet','frontale','harness','poop bag','bowls','cold mat','kamo id'],
      essentials:  ['id','wallet','tissues','chapstick','ecig','ecig juice','water bottle','slippers','sunglasses','extra shoes','hand sanitizer','passport'],
      rave:        ['rave pants','earplugs','stickers','big satchel','rave shirt','bucket hat','spoon','pill','vacuum','polaroid','usb','dummy charger'],
      festival:    ['tent','sardines','party tent','chairs','table','matress','pillows','duvet','bedsheet','cart','cart screws','key','tarp','elastic cables','camelback','water pouch','boots','electric pump','wet wipes','toilet paper','trash bags','lighter','duct tape','rubber mallet'],
    },
    categoryOrder: ['clothes','toiletries','meds','electronics','kamo','essentials','rave','festival'],
  },

  /* ── LOG ────────────────────────────────────────────────────────────────── */
  /* Note on scope: the day record's field names (meds_lam, cur_mix, …) and the
     exported .md table are a contract with the Obsidian side of this workflow,
     so they are deliberately NOT user-renameable. What IS editable is everything
     you see and count: which blocks exist and what colour they are, how many
     meals a day has, what the two med slots and three curate counters are
     called, the wording at the ends of each 1–5 scale, and which sections of the
     morning/evening forms appear at all. */
  log: {
    blocks: [
      { name: 'chores',     color: '#9a9a9a' },
      { name: 'edu',        color: '#6ec5e0' },
      { name: 'mixing',     color: '#C4B5FD' },
      { name: 'production', color: '#A78BFA' },
      { name: 'content',    color: '#8B5CF6' },
      { name: 'system',     color: '#5e8cff' },
      { name: 'admin',      color: '#e0a060' },
      { name: 'media',      color: '#e06f9a' },
      { name: 'cooking',    color: '#5cdb7d' },
    ],
    maxBlocks: 6,
    /* Exactly two slots, fixed keys, free labels. */
    meds: { lam: 'lamotrigine', rit: 'ritalin' },
    mealCount: 4,
    mealLabel: 'meal',
    caffeine: { c: 'coffee', ed: 'energy drink' },
    /* Exactly three slots, fixed keys, free labels and colours. */
    curate: {
      mix:  { label: 'mix',  color: '#C4B5FD' },
      prod: { label: 'prod', color: '#A78BFA' },
      cont: { label: 'cont', color: '#8B5CF6' },
    },
    scales: {
      energy: { low: 'drained', high: 'wired' },
      mood:   { low: 'low',     high: 'great' },
      stress: { low: 'calm',    high: 'overwhelmed' },
    },
    workouts: ['push','pull','legs','rest'],
    /* Turn a field off and it vanishes from the form and from the day's UI.
       Already-recorded values are kept, never deleted. */
    fields: {
      wakeTime: true, sleepHours: true, energyM: true, moodM: true,
      coldShower: true, weight: true, kmMorning: true, workout: true,
      kmEvening: true, energyE: true, moodE: true, stress: true,
      meds: true, meals: true, caffeine: true, blocks: true, curate: true,
    },
    streakRequires: 'both',   // 'both' | 'morning' | 'evening'
  },

  /* ── PLAN ───────────────────────────────────────────────────────────────── */
  plan: {
    /* Each type is a tile on the PLAN home; each sub is a row in its sheet.
       `section` is the Todoist section name the task is filed under. */
    types: [
      { key:'curate', label:'curate', pLabel:'curate', color:'#A78BFA', subs:[
        { display:'mixing',      section:'mixing' },
        { display:'production',  section:'production' },
        { display:'socials',     section:'socials' },
      ]},
      { key:'alive', label:'alive', pLabel:'alive', color:'#b8255f', subs:[
        { display:'kamo',        section:'kamo' },
        { display:'activities',  section:'activities' },
        { display:'create',      section:'create' },
        { display:'music',       section:'music' },
        { display:'social',      section:'social' },
        { display:'movie | show',section:'movie | show' },
        { display:'raves',       section:'raves' },
        { display:'trip',        section:'trip' },
      ]},
      { key:'admin', label:'admin', pLabel:'admin', color:'#808080', subs:[
        { display:'tasks', section:'admin | tasks' },
        { display:'rdv',   section:'admin | rdv' },
        { display:'calls', section:'admin | calls' },
      ]},
      { key:'system', label:'system', pLabel:'system', color:'#158fad', subs:[
        { display:'update',   section:'system | update' },
        { display:'projects', section:'system | projects' },
      ]},
      { key:'home', label:'home', pLabel:'home', color:'#4073ff', subs:[
        { display:'food',      section:'home | food' },
        { display:'projects',  section:'home | projects' },
        { display:'chores',    section:'home | chores' },
        { display:'groceries', section:'home | groceries' },
      ]},
      { key:'edu', label:'edu', pLabel:'edu', color:'#e05194', subs:[
        { display:'study',    section:'study' },
        { display:'practice', section:'practice' },
        { display:'exam',     section:'exam' },
        { display:'rdv',      section:'rdv' },
      ]},
    ],
    /* The chips on the task form. Values are what gets appended to the task. */
    blocks: ['b1','b2','b3'],
    times: [
      { label:'2m',  value:'2min'   }, { label:'5m',  value:'5min'  },
      { label:'15m', value:'15min'  }, { label:'30m', value:'30min' },
      { label:'45m', value:'45min'  }, { label:'60m', value:'60min' },
      { label:'2h',  value:'120min' },
    ],
    priorities: [
      { label:'urgent',    p:'p1', value:4 },
      { label:'mandatory', p:'p2', value:3 },
      { label:'optional',  p:'p3', value:2 },
    ],
    defaultPriority: 2,
  },

  /* ── STORE ──────────────────────────────────────────────────────────────── */
  store: {
    /* `icon` is a sprite id from index.html. Adding a category with an unknown
       icon falls back to #ico-other rather than rendering an empty box. */
    categories: {
      vegetables: { label:'vegetables', color:'#5cdb7d', icon:'ico-veg', items:[
        'tomato','zuchini','avocado','carrot','brocolli','spinach','peppers','chili','potato','shallot','onion','garlic'] },
      fruits: { label:'fruits', color:'#e0a060', icon:'ico-fruit', items:[
        'apple','banana','kiwi','peach','avocado'] },
      meats: { label:'meats', color:'#e06060', icon:'ico-meat', items:[
        'chicken','porc','beef','duck','fish','eggs'] },
      snacks: { label:'snacks', color:'#d4a851', icon:'ico-snack', items:[
        'chips','nuts','cookies','dips','brioche'] },
      carbs: { label:'carbs', color:'#c4a47a', icon:'ico-carbs', items:[
        'pasta','rice','bread','baguette','tortilla','ramen'] },
      cans: { label:'cans', color:'#8a8a8a', icon:'ico-can', items:[
        'tomato puree','tomato concentrate','peas','chickpeas','corn','red beans','black beans','lentils'] },
      dairy: { label:'dairy', color:'#e8e0c8', icon:'ico-dairy', items:[
        'cheddar','mozarella','spread','buratta','gouda','creme fraiche','yogurt','butter'] },
      frozen: { label:'frozen', color:'#6ec5e0', icon:'ico-frozen', items:[
        'dumplings','beef','fries','pizza','cod','salmon','squid'] },
      breakfast: { label:'breakfast', color:'#b58a5a', icon:'ico-breakfast', items:[
        'coffee','jam','choco','muesli','oats'] },
      condiments: { label:'condiments', color:'#a0b060', icon:'ico-cond', items:[
        'olive oil','neutral oil','sesame oil','ketchup','mustard','sweet chili','soy sauce'] },
      spices: { label:'spices', color:'#d96a40', icon:'ico-spice', items:[
        'cumin','paprika','garlic powder','onion powder','origan','curry','italian herbs','salt','pepper','cayenne powder'] },
      drinks: { label:'drinks', color:'#5e8cff', icon:'ico-drink', items:[
        'sparkling water','coke zero','ice tea','multifruit','red juice','apple juice','orange juice','monster','redbull'] },
      /* `manual` is load-bearing: uncategorised items land here. Renaming its
         label is fine; removing the key is not, so the editor keeps it pinned. */
      manual: { label:'other', color:'#A78BFA', icon:'ico-other', items:[] },
    },
    meals: {
      pasta_tomato:   { label:'pasta tomato',    items:[['pasta','carbs'],['tomato puree','cans'],['garlic','vegetables'],['onion','vegetables'],['mozarella','dairy'],['olive oil','condiments']] },
      ramen_bowl:     { label:'ramen bowl',      items:[['ramen','carbs'],['eggs','meats'],['chicken','meats'],['garlic','vegetables'],['soy sauce','condiments'],['sesame oil','condiments']] },
      chili_carne:    { label:'chili con carne', items:[['beef','meats'],['red beans','cans'],['tomato concentrate','cans'],['onion','vegetables'],['garlic','vegetables'],['chili','vegetables'],['cumin','spices'],['paprika','spices']] },
      tacos:          { label:'tacos',           items:[['tortilla','carbs'],['beef','meats'],['peppers','vegetables'],['onion','vegetables'],['cheddar','dairy'],['creme fraiche','dairy']] },
      pizza_night:    { label:'pizza night',     items:[['pizza','frozen'],['mozarella','dairy'],['tomato concentrate','cans']] },
      chicken_curry:  { label:'chicken curry',   items:[['chicken','meats'],['curry','spices'],['garlic','vegetables'],['onion','vegetables'],['rice','carbs'],['creme fraiche','dairy']] },
      stir_fry:       { label:'stir fry',        items:[['chicken','meats'],['peppers','vegetables'],['brocolli','vegetables'],['soy sauce','condiments'],['sesame oil','condiments'],['rice','carbs']] },
      salad_bowl:     { label:'salad bowl',      items:[['spinach','vegetables'],['tomato','vegetables'],['avocado','vegetables'],['mozarella','dairy'],['olive oil','condiments']] },
      oats_breakfast: { label:'oats breakfast',  items:[['oats','breakfast'],['banana','fruits'],['muesli','breakfast']] },
      burger_night:   { label:'burger night',    items:[['beef','meats'],['cheddar','dairy'],['brioche','snacks'],['ketchup','condiments'],['mustard','condiments']] },
      fish_rice:      { label:'fish & rice',     items:[['fish','meats'],['rice','carbs'],['garlic','vegetables'],['soy sauce','condiments']] },
      dumpling_night: { label:'dumpling night',  items:[['dumplings','frozen'],['soy sauce','condiments'],['sweet chili','condiments']] },
    },
    /* Counter step buttons, largest first. */
    quickAmounts: [10, 5, 1, 0.5, 0.1],
  },
};

/* ── Store ────────────────────────────────────────────────────────────────── */
let overrides = {};
const subs = [];

function load() {
  try { overrides = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch { overrides = {}; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(overrides)); }
  catch { /* quota — the in-memory value still applies for this session */ }
}

/* Structured clone so a caller mutating what it got back cannot corrupt either
   DEFAULTS or the override tree. The values here are plain JSON, so the cheap
   round-trip is enough and avoids the structuredClone availability question. */
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function dig(tree, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), tree);
}
function plant(tree, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = tree;
  keys.forEach(k => { if (typeof node[k] !== 'object' || node[k] === null) node[k] = {}; node = node[k]; });
  node[last] = value;
}
function uproot(tree, path) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = tree;
  for (const k of keys) { if (typeof node[k] !== 'object' || node[k] === null) return; node = node[k]; }
  delete node[last];
  // prune the empty branches the deletion left behind, so isCustom stays honest
  while (keys.length) {
    const leaf = keys.pop();
    let parent = tree;
    for (const k of keys) parent = parent[k];
    if (parent[leaf] && !Object.keys(parent[leaf]).length) delete parent[leaf]; else break;
  }
}

/* An override anywhere at or ABOVE the requested path wins for that path: if
   `log` as a whole was replaced, `log.blocks` reads out of the replacement. */
function get(path) {
  const own = dig(overrides, path);
  if (own !== undefined) return clone(own);
  return clone(dig(DEFAULTS, path));
}

function set(path, value) {
  plant(overrides, path, clone(value));
  persist();
  notify(path);
}

function reset(path) {
  uproot(overrides, path);
  persist();
  notify(path);
}

function resetAll() {
  overrides = {};
  persist();
  notify('*');
}

function isCustom(path) { return dig(overrides, path) !== undefined; }
function defaults(path) { return clone(path ? dig(DEFAULTS, path) : DEFAULTS); }

function subscribe(fn) { if (typeof fn === 'function') subs.push(fn); }
function notify(path) { subs.forEach(fn => { try { fn(path); } catch (e) { console.error(e); } }); }

/* Whole-tree replace, used by the settings importer. */
function replaceAll(tree) {
  overrides = (tree && typeof tree === 'object') ? clone(tree) : {};
  persist();
  notify('*');
}
function raw() { return clone(overrides); }

/* How much of the shipped content has been customised — shown in Settings so
   "reset everything" is never a blind button. */
function customPaths() {
  const out = [];
  (function walk(node, prefix) {
    Object.keys(node || {}).forEach(k => {
      const p = prefix ? prefix + '.' + k : k;
      const v = node[k];
      // a plain object that mirrors a DEFAULTS object is a branch, not a value
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          dig(DEFAULTS, p) && typeof dig(DEFAULTS, p) === 'object' && !Array.isArray(dig(DEFAULTS, p)) &&
          Object.keys(v).every(kk => dig(DEFAULTS, p + '.' + kk) !== undefined)) {
        walk(v, p);
      } else out.push(p);
    });
  })(overrides, '');
  return out;
}

load();

return { get, set, reset, resetAll, isCustom, defaults, subscribe,
         replaceAll, raw, customPaths, KEY };
})();
