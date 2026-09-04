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
      /* `media` is a fixed id: DO draws the Todoist media grid on it rather
         than routine cards, and puts it back at this spot if an older override
         of the list is missing it. */
      { id: 'media', label: 'media', routines: [] },
      { id: 'other', label: 'other', routines: ['deepclean'] },
    ],
    /* The Todoist labels the media tab fetches, in the order its groups are
       drawn. Each group takes the label's own Todoist colour; any second label
       on a task (@album, @set, @track under @music) is shown on the tile. */
    mediaLabels: ['movie', 'show', 'podcast', 'music'],
    /* The one Todoist label the quick section fetches. A task carrying it is a
       card under the routine cards — on its own if it has no subtasks, as a
       checklist if it has. One label, not a list: "quick" is a shape of task,
       not a category of them. */
    quickLabel: 'quick',
    /* The consistency strip: how many days of routine history it draws. The
       ticks themselves are folded into `do-stats-v1` as each day is swept —
       see js/do.js. */
    history: { on: true, days: 14 },
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
    /* The order of the sections on DO's first tab: the block tasks from
       Todoist, the routine cards, the @quick cards, the today list and the
       consistency strip. Settings → do moves them. A section this list does
       not name goes last, which is where `quick` and `history` land for an
       override written before they existed. */
    sections: ['blocks', 'routines', 'quick', 'today', 'history'],
  },

  /* ── LOG ────────────────────────────────────────────────────────────────── */
  /* Note on scope: the day record's field names (meds_lam, cur_mix, …) and the
     exported .md table are a contract with the Obsidian side of this workflow,
     so they are deliberately NOT user-renameable. What IS editable is everything
     you see and count: which blocks exist and what colour they are, how many
     meals a day has, what the med slots and three curate counters are
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
    /* Fixed keys, free labels. The *keys* are the contract — the day record
       writes `meds_<key>` and the .md exports a row per key — so a key is
       never renamed and never removed; a label is yours to change. Adding one
       is additive: older notes simply have no row for it, and the parser looks
       rows up by name. `m3` arrived in 2.21. */
    meds: { lam: 'lamotrigine', rit: 'ritalin', m3: 'medication' },
    /* Which slots the evening form actually asks about. A fixed set of
       booleans, read through the shipped record the way plan.formFields is —
       a missing key is "not asked", not "off". Switching one off only hides
       the button: the record keeps what it has, the .md still exports a row
       per key, and turning it back on shows yesterday's answer exactly where
       it was. `m3` ships off, so the third slot is opt-in. */
    medsOn: { lam: true, rit: true, m3: false },
    /* One colour per slot, so a slot reads as itself at a glance. Not a
       hardcoded pair of CSS selectors any more: log.js writes --med-c and an
       unlisted slot falls back to the accent, so a fourth slot costs nothing. */
    medColors: { lam: '#6ec5e0', rit: '#e0a060', m3: '#5cdb7d' },
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
    /* Daily walking target, km — the line on the weekly chart under History. */
    kmTarget: 6,
    /* Turn a field off and it vanishes from the form and from the day's UI.
       Already-recorded values are kept, never deleted. */
    fields: {
      wakeTime: true, sleepHours: true, energyM: true, moodM: true,
      coldShower: true, weight: true, kmMorning: true, workout: true,
      kmEvening: true, energyE: true, moodE: true, stress: true,
      meds: true, meals: true, caffeine: true, blocks: true, curate: true,
    },
    /* What a day needs before it counts towards the streak on the home screen. */
    streakRequires: 'both',   // 'both' | 'morning' | 'evening'
    /* The LOG tab's icon becomes a "!" while one of these is true: the morning
       is still unlogged past `morning`, the evening past `evening`, or nothing
       is planned for tomorrow past `plan`. Hours are local wall-clock "HH:MM";
       an empty string switches that one rule off on its own. */
    alerts: { on: true, morning: '10:00', evening: '21:00', plan: '21:00' },
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
    /* Which rows the task form shows. The task name is always there; the rest
       is a preference. The time estimate is off by default — a day planned in
       blocks has no use for a per-task estimate — but the chips above are kept
       so switching it back on needs no re-typing. `date` is the ← today →
       stepper: on by default, and PLAN reads this record through the shipped
       one, so an override written before the row existed still shows it. */
    formFields: { date: true, block: true, time: false, priority: true, subtasks: true },

    /* ── Queue presets ──────────────────────────────────────────────────────
       A day that is the same five tasks every week, saved once and refilled
       with one tap. Each preset is a name and the tasks as they were queued,
       minus the day: a preset is a shape of day, not a dated one, so applying
       it dates every task from the form's own floor (today, or the day the
       last task was queued for). Nothing ships — a preset is by definition
       personal — so the shipped value is an empty list. */
    presets: [],

    /* ── The export ─────────────────────────────────────────────────────────
       Which Google Calendar a project's events belong on. A *name*, never an
       id: ROOT has no Google auth and never resolves one — the name is passed
       through in the exported description and the scheduled agent looks it up.

       The key is the PLAN type, or `type > sub` where one type splits across
       several calendars. Only curate splits today; a type with no `>` entry
       falls back to its own key. */
    calendars: {
      'curate > mixing':     '02A1 | curate project mixing',
      'curate > production': '02A2 | curate project production',
      'curate > socials':    '02A3 | curate project content',
      system:                '02B1 | system',
      admin:                 '02B3 | admin',
      home:                  '02B4 | home',
      edu:                   '02B5 | edu / career',
      alive:                 '02B6 | alive',
    },

    /* Two shapes of day. Every row is `at` minutes from the day's start and a
       duration in minutes — nothing here is a wall-clock time, so one start
       time moves the whole day. A row is either a fixed event (`cal` + `event`)
       or one of the block slots the picked tasks are assigned to (`slot`).

       `normal` and `rest` are identities, not labels: the exported description
       carries `template: normal|rest` and a downstream agent parses it.

       The two differ by exactly two things — the hour of gym, and the b3 pair.
       **`rest` has four block slots, not six**: b3a and b3b do not exist on it,
       and those hours are free time. Dropping gym is why every offset after it
       is an hour earlier on a rest day. */
    dayTemplates: {
      normal: [
        { at:   0, dur: 30, cal:'01A1 | routine', event:'routine p1' },
        { at:  30, dur: 75, cal:'01A2 | kamo',    event:'kamo' },
        { at: 105, dur: 60, cal:'01A3 | care',    event:'gym' },
        { at: 165, dur: 30, cal:'01A1 | routine', event:'routine p2' },
        { at: 195, dur: 45, cal:'01A5 | no work', event:'break' },
        { at: 240, dur: 90, slot:'b1a' },
        { at: 330, dur: 15, cal:'01A5 | no work', event:'break' },
        { at: 345, dur: 90, slot:'b1b' },
        { at: 435, dur: 45, cal:'01A1 | routine', event:'routine p3' },
        { at: 480, dur: 90, slot:'b2a' },
        { at: 570, dur: 15, cal:'01A5 | no work', event:'break' },
        { at: 585, dur: 90, slot:'b2b' },
        { at: 675, dur: 15, cal:'01A5 | no work', event:'break' },
        { at: 690, dur: 45, cal:'01A2 | kamo',    event:'kamo' },
        { at: 735, dur: 15, cal:'01A1 | routine', event:'meal' },
        { at: 750, dur: 90, slot:'b3a' },
        { at: 840, dur: 30, cal:'01A1 | routine', event:'routine p4' },
        { at: 870, dur: 90, slot:'b3b' },
        { at: 960, dur: 45, cal:'01A5 | no work', event:'free time' },
        { at:1005, dur: 15, cal:'01A1 | routine', event:'cooldown' },
      ],
      rest: [
        { at:   0, dur: 30, cal:'01A1 | routine', event:'routine p1' },
        { at:  30, dur: 75, cal:'01A2 | kamo',    event:'kamo' },
        { at: 105, dur: 30, cal:'01A1 | routine', event:'routine p2' },
        { at: 135, dur: 45, cal:'01A5 | no work', event:'break' },
        { at: 180, dur: 90, slot:'b1a' },
        { at: 270, dur: 15, cal:'01A5 | no work', event:'break' },
        { at: 285, dur: 90, slot:'b1b' },
        { at: 375, dur: 45, cal:'01A1 | routine', event:'routine p3' },
        { at: 420, dur: 90, slot:'b2a' },
        { at: 510, dur: 15, cal:'01A5 | no work', event:'break' },
        { at: 525, dur: 90, slot:'b2b' },
        { at: 615, dur: 15, cal:'01A5 | no work', event:'break' },
        { at: 630, dur: 45, cal:'01A2 | kamo',    event:'kamo' },
        { at: 675, dur: 15, cal:'01A1 | routine', event:'meal' },
        { at: 690, dur: 90, cal:'01A5 | no work', event:'free time' },
        { at: 780, dur: 30, cal:'01A1 | routine', event:'routine p4' },
        { at: 810, dur:135, cal:'01A5 | no work', event:'free time' },
        { at: 945, dur: 15, cal:'01A1 | routine', event:'cooldown' },
      ],
    },
  },

  /* ── CAL ────────────────────────────────────────────────────────────────────
     The colours CAL paints a day in. A *task* row already carries its project's
     colour — resolved by PLAN at export time and stored with the day, so a
     project recoloured next month does not repaint the days already planned.
     What is left is the template around it: the fixed rows, which are grouped
     by the calendar they sit on rather than by project, so the routine hours
     read as one band all day.

     The key is the calendar name from `plan.calendars` / `plan.dayTemplates`,
     and `*` is the fallback for one this map has never heard of. */
  cal: {
    eventColors: {
      '01A1 | routine': '#7a8699',
      '01A2 | kamo':    '#c98b3f',
      '01A3 | care':    '#3fc9b0',
      '01A5 | no work': '#4f5560',
      '*':              '#6b6b6b',
    },
    /* What an unclaimed block slot is called on the day. It is not "empty" —
       those hours exist and are yours; nothing was filed into them. */
    idleLabel: 'free',
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

  /* ── TEND ───────────────────────────────────────────────────────────────── */
  /* The plants themselves and their care log live in `tend.v3` (shared with the
     standalone app). What is here is the vocabulary TEND reasons with: the plant
     types and how seasonal each is, the three care tasks' names, the growth
     curve that stretches every interval through the year, and the thresholds
     the round is drawn with. `tasks` has three fixed keys — water / feed /
     repot — because the event log is filed under them; the labels are free. */
  tend: {
    groups: [
      { key:'herb',      label:'herb / edible',      season:0.6, note:'Drinks steadily even indoors in winter — only mildly seasonal.' },
      { key:'seedling',  label:'seedling',           season:0.7, note:'Keep evenly moist. Small pots dry out fast.' },
      { key:'tropical',  label:'tropical foliage',   season:1,   note:'Slows down noticeably in winter. Let the top few cm dry.' },
      { key:'succulent', label:'cactus / succulent', season:1.5, note:'Nearly dormant in winter — stretch hard, and never feed then.' },
    ],
    tasks: {
      water: { label:'water', verb:'watered' },
      feed:  { label:'feed',  verb:'fed' },
      repot: { label:'repot', verb:'repotted' },
    },
    /* Relative growth, January to December, northern hemisphere. One curve
       drives everything: watering stretches as growth falls, and feeding stops
       altogether once growth is under `feedFloor`. Southern hemisphere: rotate
       it six months and rename the seasons to match. */
    growth:  [0.10, 0.20, 0.50, 0.80, 1, 1, 1, 1, 0.80, 0.50, 0.20, 0.10],
    seasons: ['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'],
    feedFloor: 0.4,
    /* How the round is drawn: when a task starts showing as "coming up" (as a
       fraction of its interval), how many days late turns a task red, how many
       upcoming tasks to list, how long the undo pill stays, and how much history
       the detail sheet shows. */
    round: { soonAt: 0.75, overdueAfter: 2, soonCount: 6, undoSec: 7, historyCount: 10 },
    /* What the editor is pre-filled with for a new plant. */
    newPlant: { group:'tropical', water:7, feed:21, repot:12, glyph:'🌿' },
    /* Seeded on a first-ever install, and by "reset to starter plants". Each row
       is name, species, type, water-every (summer days), glyph, room. */
    starter: [
      ['Basil','Ocimum basilicum','herb',2,'🌿','kitchen'],
      ['Chives','Allium schoenoprasum','herb',3,'🌿','kitchen'],
      ['Spring onions','Allium fistulosum','herb',3,'🧅','kitchen'],
      ['Apple seedling 1','Malus sp.','seedling',4,'🌱','windowsill'],
      ['Apple seedling 2','Malus sp.','seedling',4,'🌱','windowsill'],
      ['Apple seedling 3','Malus sp.','seedling',4,'🌱','windowsill'],
      ['Pilea pup','Pilea peperomioides','tropical',7,'🪴','living room'],
      ['Turtle vine','Callisia repens','tropical',6,'🌿','living room'],
      ['Money tree','Pachira aquatica','tropical',9,'🌳','living room'],
      ['Rubber plant','Ficus elastica','tropical',9,'🪴','living room'],
      ['Aloe','Aloe sp.','succulent',14,'🪴','windowsill'],
      ['Snake plant','Dracaena trifasciata','succulent',18,'🪴','bedroom'],
      ['Snake plant pup','Dracaena trifasciata','succulent',16,'🌱','bedroom'],
      ['Cane cactus','Austrocylindropuntia','succulent',18,'🌵','windowsill'],
      ['Columnar cactus','Echinopsis sp.','succulent',20,'🌵','windowsill'],
    ],
  },

  /* ── TRACK ──────────────────────────────────────────────────────────────── */
  /* The CAP Électricien plan, transcribed from learn/plan_cap_elec.pdf: five
     levels, three phases, 54 topics (44 theory + 10 bench). Ticks and dates live
     in `capTracker.v2`, filed under the topic ids below — the id is the
     identity, so a topic can be reworded but never renumbered without orphaning
     what was ticked against it. There is deliberately no editor for the
     curriculum itself for that reason; the labels around it are editable. */
  track: {
    phases: {
      real: "Réalisation d'une installation",
      mes:  "Mise en service d'une installation",
      main: "Maintenance d'une installation",
    },
    levelLabel: 'Niveau',
    curriculum: [
      // ── LEVEL 1 ──
      [1,'real',"Bases de l'électricité","Les circuits électriques"],
      [1,'real',"Bases de l'électricité","Les moyens de productions électriques et son transport"],
      [1,'real',"Bases de l'électricité","Les grandeurs électriques de base et lois fondamentales"],
      [1,'real',"Lecture et compréhension des documents techniques","Lecture et interprétation des plans et schémas électriques"],
      [1,'real',"Lecture et compréhension des documents techniques","Vocabulaire professionnel"],
      [1,'real',"Normes, cadre professionnel et environnement","Présentation de la norme NF C 15-100 et ses exigences"],
      [1,'real',"Normes, cadre professionnel et environnement","Le métier d'électricien"],
      [1,'real',"Équipements, appareillages et réseaux","Les matériels et appareillages électriques 1"],
      [1,'real',"Sécurité, risques et habilitations","Les risques professionnels, les EPI et les EPC"],
      [1,'real',"Conduits, implantation et préparation du chantier","Façonner et implanter des conduits"],
      [1,'real',"Exercices — mise en pratique","Exercices simple allumage / prise de courant / prise commandée",1],
      [1,'real',"Exercices — mise en pratique","Exercice double allumage",1],
      [1,'real',"Exercices — mise en pratique","Exercice va-et-vient",1],
      [1,'mes' ,"Mesures et contrôles électriques","Les équipements de protection : disjoncteurs différentiels"],
      // ── LEVEL 2 ──
      [2,'real',"Bases de l'électricité","Le fonctionnement des systèmes électriques : des chaînes d'énergie aux chaînes d'information"],
      [2,'real',"Équipements, appareillages et réseaux","Le tableau électrique"],
      [2,'real',"Normes, cadre professionnel et environnement","Gestion des déchets et impact environnemental des installations électriques"],
      [2,'real',"Sécurité, risques et habilitations","Les habilitations — tronc commun"],
      [2,'mes' ,"Mise en service","Vérification hors tension"],
      [2,'mes' ,"Mise en service","Vérification sous tension"],
      [2,'mes' ,"Mise en service","Réaliser une mise en service"],
      [2,'mes' ,"Mesures et contrôles électriques","Les appareils de mesure"],
      [2,'mes' ,"Exercices — mise en pratique","Exercice interrupteur horaire",1],
      [2,'mes' ,"Exercices — mise en pratique","Exercice sonnerie modulaire et gâche de porte",1],
      // ── LEVEL 3 ──
      [3,'real',"Confort thermique et gestion du bâtiment","L'éclairage et les systèmes de commande"],
      [3,'real',"Confort thermique et gestion du bâtiment","Chauffage et isolation thermique"],
      [3,'real',"Confort thermique et gestion du bâtiment","La climatisation"],
      [3,'real',"Performance énergétique et régulation","Gestion de la performance énergétique"],
      [3,'real',"Équipements, appareillages et réseaux","Initiation aux réseaux de communication"],
      [3,'real',"Exercices — mise en pratique","Exercice contacteur HC/HP",1],
      [3,'real',"Exercices — mise en pratique","Exercice télérupteur",1],
      [3,'mes' ,"Exercices — mise en pratique","Exercice détecteur de mouvement",1],
      [3,'mes' ,"Exercices — mise en pratique","Exercice interrupteur crépusculaire",1],
      [3,'main',"Maintenance, dépannage et réparations","Diagnostic et correction des erreurs avant la validation finale"],
      // ── LEVEL 4 ──
      [4,'real',"Lecture et compréhension des documents techniques","Le SLT"],
      [4,'real',"Performance énergétique et régulation","Régulation et optimisation de la consommation énergétique"],
      [4,'real',"Sécurité, risques et habilitations","Procédure de consignation et déconsignation des circuits avant intervention"],
      [4,'mes' ,"Exercices — mise en pratique","Exercice minuterie 3 fils ou 4 fils",1],
      [4,'main',"Maintenance, dépannage et réparations","Les principes de la maintenance préventive et corrective"],
      [4,'main',"Maintenance, dépannage et réparations","Méthodes de dépannage en électricité : recherche de panne et correction"],
      [4,'main',"Maintenance, dépannage et réparations","Détection et réparation des défauts électriques"],
      [4,'main',"Maintenance, dépannage et réparations","Analyse des causes de dysfonctionnements"],
      [4,'main',"Maintenance, dépannage et réparations","Remplacement et réparation des composants défectueux"],
      // ── LEVEL 5 ──
      [5,'real',"Lecture et compréhension des documents techniques","Les schémas électriques en industrie"],
      [5,'real',"Équipements, appareillages et réseaux","Les moteurs électriques"],
      [5,'real',"Normes, cadre professionnel et environnement","Communication professionnelle interne"],
      [5,'real',"Normes, cadre professionnel et environnement","Contexte administratif, juridique de l'acte de construire"],
      [5,'real',"Sécurité, risques et habilitations","Procédure de consignation et déconsignation des circuits avant intervention"],
      [5,'mes' ,"Programmation et paramétrage","Démarrage un sens de marche"],
      [5,'mes' ,"Programmation et paramétrage","Démarrage deux sens de marche"],
      [5,'mes' ,"Documentation professionnelle","Documentation professionnelle"],
      [5,'main',"Sécurisation des interventions et traçabilité","Rédaction de rapports d'intervention et traçabilité des opérations de maintenance"],
      [5,'main',"Sécurisation des interventions et traçabilité","Techniques de communication verbale et non verbale"],
      [5,'main',"Gestion administrative et relation client","Les documents clients"],
    ].map((r, i) => ({ id:'t' + String(i + 1).padStart(2, '0'), lv:r[0], ph:r[1], dom:r[2], t:r[3], ex:!!r[4] })),
    /* The separately-examined subject and the standing revision reminders. */
    pse: { label:'PSE — Prévention Santé Environnement', note:'Separately examined. Its own band in the plan, no topic list.' },
    revision: [
      "Apprendre les termes et schémas spécifiques à l'électricien",
      'Maîtriser les techniques évoquées',
      'Réaliser les entraînements et les évaluations de fin de niveau',
    ],
    /* The projection: how many weeks of ticks the pace is averaged over, and
       how many topics "next up" lists. The dates themselves stay in
       capTracker.v2 with the ticks, shared with the standalone app. */
    pace: { window: 4, nextCount: 3 },
  },

  /* ── LEARN ──────────────────────────────────────────────────────────────── */
  /* Decks and cards live in IndexedDB (`learn_v1`), the shuffle flag in
     `learn_settings` — both shared with the standalone app. Here: the four
     rating labels, lowest to highest (the fourth is "acquired", everything
     below it is "needs work"), and the session shape. */
  learn: {
    ratings: ['revision', 'shaky', 'almost', 'acquired'],
    study: { sessionCap: 0, cardScale: 1, flip: false, showTags: false },
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
