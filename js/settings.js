/* ── Settings ─────────────────────────────────────────────────────────────────
   Split out of shell.js, which used to be the frame AND the settings screen.

   Twelve panels behind one segmented control:

     look      theme gallery, accent, fonts, live preview
     layout    shape, density, depth, texture, nav + the app list, contrast
     behave    start tab, gestures, haptics, confirmations, formats
     content   the editors for everything Config holds
     do/log/plan/store/tend/track/learn   each app's own settings, rendered by
               the app module into markup that carries its namespace
     data      Todoist key, backup, storage, resets

   Two conventions hold the whole file together:

     · Every appearance/behaviour control is bound by a `data-pref` attribute and
       handled by ONE delegated listener. Adding a control is markup, not wiring.
     · Every content editor lives inside a `[data-group="<config path>"]` and is
       read back out of the DOM wholesale by that group's read(). Nothing tracks
       per-field state, so an editor cannot drift out of step with what is saved.

   The four app panels keep their original markup and ids so each module's scoped
   $id() still finds its own controls wherever they sit. */
window.SET = (function () {
'use strict';

const SCOPE = '.ns-set ';
const $id  = id  => document.querySelector(SCOPE + '#' + id);
const $one = sel => document.querySelector(SCOPE + sel);
const $all = sel => document.querySelectorAll(SCOPE + sel);
const esc  = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const PANELS = ['look','layout','behave','content','do','log','plan','store','tend','track','learn','data'];
let currentPanel = 'look';

/* Display names for the app list and the start-tab chips. */
const APP_NAMES = { do:'DO', log:'LOG', plan:'PLAN', store:'STORE', tend:'TEND', track:'TRACK', learn:'LEARN' };
const APP_HINTS = { do:'routines + packing', log:'daily log', plan:'todoist queue', store:'groceries',
                    tend:'plant care', track:'CAP curriculum', learn:'anki decks' };

/* Which storage keys belong to which app — read-only bookkeeping for the
   storage report. The shell never writes to another app's keys. LEARN's decks
   are in IndexedDB, not here; renderStorage() asks the module for them. */
const GROUPS = [
  { name:'DO',    color:'#A78BFA', match:k => k.startsWith('do_') || k.startsWith('travel_state_') },
  { name:'LOG',   color:'#5cdb7d', match:k => k.startsWith('log_') || k === 'log-scale-v2' },
  { name:'PLAN',  color:'#5e8cff', match:k => k.startsWith('plan_') },
  { name:'STORE', color:'#e8a33d', match:k => k === 'store_state_v1' || k === 'eat_state_v1' },
  { name:'TEND',  color:'#3fc9b0', match:k => k.startsWith('tend.') || k.startsWith('tend_') },
  { name:'TRACK', color:'#f0709a', match:k => k.startsWith('capTracker.') },
  { name:'LEARN', color:'#5ad4e6', match:k => k.startsWith('learn_') },
  { name:'ROOT',  color:'#e06f9a', match:k => k.startsWith('root_') },
];

const allKeys = () => { try { return Object.keys(localStorage); } catch { return []; } };
const fmtSize = n => { const kb = n/1024;
  return kb < 1 ? n + ' B' : kb < 1024 ? kb.toFixed(1) + ' KB' : (kb/1024).toFixed(2) + ' MB'; };

/* Sprite ids the STORE category editor may choose from. */
const STORE_ICONS = ['ico-veg','ico-fruit','ico-meat','ico-snack','ico-carbs','ico-can','ico-dairy',
  'ico-frozen','ico-breakfast','ico-cond','ico-spice','ico-drink','ico-meal','ico-list','ico-other'];

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'x';
const uniqueKey = (base, taken) => {
  let k = slug(base), n = 2;
  while (taken.includes(k)) k = slug(base) + '_' + n++;
  return k;
};
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);


/* ══ Control builders ══════════════════════════════════════════════════════════
   All three read their current value straight from Prefs, so a re-render after
   any change needs no bookkeeping. */

function chips(prefKey, opts, label, note) {
  const cur = Prefs.get(prefKey);
  return `<div class="opt-set">
    <label class="lbl">${esc(label)}${note ? `<em>${esc(note)}</em>` : ''}</label>
    <div class="chips">${opts.map(o => {
      const v = typeof o === 'string' ? o : o.v;
      const l = typeof o === 'string' ? o : o.l;
      return `<button class="chip${v === cur ? ' on' : ''}" data-pref="${prefKey}" data-val="${esc(v)}">${esc(l)}</button>`;
    }).join('')}</div></div>`;
}

/* `auto` sliders (radius, border) sit at null until the user touches them, at
   which point the theme stops deciding. The readout says which is true. */
function slider(prefKey, label, fmt) {
  const s = Prefs.SCHEMA[prefKey];
  const raw = Prefs.get(prefKey);
  const isAuto = raw === null;
  const ch = Prefs.character();
  const shown = isAuto ? (prefKey === 'radius' ? ch.radius : prefKey === 'border' ? ch.border : s.def) : raw;
  const read = isAuto ? `auto · ${shown}${s.unit || ''}` : (fmt ? fmt(shown) : shown + (s.unit || ''));
  return `<div class="slider-row" data-slider="${prefKey}">
    <div class="slider-head">
      <label class="lbl">${esc(label)}</label>
      <span class="slider-val${isAuto ? ' is-auto' : ''}">${esc(read)}</span>
    </div>
    <input type="range" class="sl" data-pref="${prefKey}"
           min="${s.min}" max="${s.max}" step="${s.step}" value="${shown}">
  </div>`;
}

function toggle(prefKey, label, sub) {
  const on = !!Prefs.get(prefKey);
  return `<div class="setting-row">
    <span class="setting-lbl">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    <button class="tog${on ? ' on' : ''}" data-pref="${prefKey}" data-toggle="1"
            role="switch" aria-checked="${on}" aria-label="${esc(label)}"></button>
  </div>`;
}

const sectionHead = (title, resetPath) =>
  `<div class="sec"><span>${esc(title)}</span>${
    resetPath ? `<button class="sec-reset${Config.isCustom(resetPath) ? '' : ' hidden'}"
                          data-cfg-reset="${resetPath}">reset to default</button>` : ''}</div>`;


/* ══ LOOK ═════════════════════════════════════════════════════════════════════ */

function previewHTML() {
  return `<div class="preview">
    <div class="pv-top"><div class="pv-logo">ROOT<em>.</em></div><div class="pv-tag">live preview</div></div>
    <div class="pv-bar"><i></i></div>
    <div class="pv-row">
      <div class="pv-card"><div class="pv-card-t">Morning</div><div class="pv-card-s">data + workout</div></div>
      <div class="pv-card"><div class="pv-card-t">Evening</div><div class="pv-card-s">blocks done</div></div>
    </div>
    <div class="pv-btns">
      <span class="pv-btn">save</span>
      <span class="pv-btn ghost">cancel</span>
      <span class="pv-btn acc">3 / 7</span>
    </div>
  </div>`;
}

function themeCards(group) {
  const cur = Prefs.activeTheme();
  return Prefs.THEMES.filter(t => t.group === group).map(t => `
    <button class="theme-card${t.id === cur ? ' on' : ''}" data-theme-pick="${t.id}">
      <span class="theme-swatch">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>
      <span class="theme-name">${esc(t.name)}<span class="tick">✓</span></span>
      <span class="theme-desc">${esc(t.desc)}</span>
    </button>`).join('');
}

function renderLook() {
  const mode = Prefs.get('themeMode');
  const acc  = Prefs.get('accent');
  const custom = Prefs.normHex(Prefs.get('accentCustom'));

  $id('panel-look').innerHTML = previewHTML() + `

    ${sectionHead('Theme')}
    <div class="opt-set">
      <label class="lbl">Follow the system<em>${mode === 'system' ? 'dark and light swap automatically' : 'one theme, always'}</em></label>
      <div class="chips">
        <button class="chip${mode === 'fixed'  ? ' on' : ''}" data-pref="themeMode" data-val="fixed">fixed</button>
        <button class="chip${mode === 'system' ? ' on' : ''}" data-pref="themeMode" data-val="system">auto</button>
      </div>
    </div>

    ${mode === 'system' ? `
      <div class="set-note">Pick the pair. ROOT switches between them when the device does.</div>
      <div class="opt-set"><label class="lbl">Dark half</label>
        <div class="chips">${Prefs.THEMES.filter(t => t.group === 'dark').map(t =>
          `<button class="chip${Prefs.get('themeDark') === t.id ? ' on' : ''}" data-pref="themeDark" data-val="${t.id}">${esc(t.name)}</button>`).join('')}</div></div>
      <div class="opt-set"><label class="lbl">Light half</label>
        <div class="chips">${Prefs.THEMES.filter(t => t.group === 'light').map(t =>
          `<button class="chip${Prefs.get('themeLight') === t.id ? ' on' : ''}" data-pref="themeLight" data-val="${t.id}">${esc(t.name)}</button>`).join('')}</div></div>
    ` : `
      <div class="set-note">A theme sets more than colour — it also picks the corner
        radius, the depth, the texture and the type pairing. Every one of those
        stays yours to override under <strong>layout</strong>.</div>
      <div class="theme-grid">${themeCards('dark')}</div>
      <div class="sec"><span>Light themes</span></div>
      <div class="theme-grid">${themeCards('light')}</div>
    `}

    ${sectionHead('Accent')}
    <div class="acc-grid">
      ${Prefs.ACCENTS.map(a => `
        <button class="acc-b${acc === a.id ? ' on' : ''}${a.id === 'preset' ? ' theme-acc' : ''}"
                data-pref="accent" data-val="${a.id}" title="${esc(a.name)}" aria-label="${esc(a.name)}">
          <i${a.hex ? ` style="background:${a.hex}"` : ''}></i></button>`).join('')}
      <button class="acc-b${acc === 'custom' ? ' on' : ''}" data-pref="accent" data-val="custom"
              title="custom" aria-label="custom accent">
        <i style="background:conic-gradient(#e06060,#e8a33d,#5cdb7d,#5ad4e6,#7c8cff,#ff4ecd,#e06060)"></i></button>
    </div>
    ${acc === 'custom' ? `
      <div class="acc-custom-row">
        <input type="color" id="acc-color" value="${custom}" aria-label="accent colour">
        <input type="text" id="acc-hex" value="${custom}" spellcheck="false" autocapitalize="off"
               placeholder="#A78BFA" aria-label="accent hex">
      </div>` : ''}

    ${sectionHead('Type')}
    <div class="opt-set">
      <label class="lbl">Display face<em>${esc(Prefs.resolvedDisplay().name)}</em></label>
      <div class="chips">
        <button class="chip${Prefs.get('displayFont') === 'auto' ? ' on' : ''}" data-pref="displayFont" data-val="auto">auto</button>
        ${Prefs.DISPLAY_FONTS.map(f =>
          `<button class="chip${Prefs.get('displayFont') === f.id ? ' on' : ''}" data-pref="displayFont" data-val="${f.id}">${esc(f.name)}</button>`).join('')}
      </div>
    </div>
    <div class="opt-set">
      <label class="lbl">Mono face<em>${esc(Prefs.resolvedMono().name)}</em></label>
      <div class="chips">
        <button class="chip${Prefs.get('monoFont') === 'auto' ? ' on' : ''}" data-pref="monoFont" data-val="auto">auto</button>
        ${Prefs.MONO_FONTS.map(f =>
          `<button class="chip${Prefs.get('monoFont') === f.id ? ' on' : ''}" data-pref="monoFont" data-val="${f.id}">${esc(f.name)}</button>`).join('')}
      </div>
    </div>
    <div class="set-note">Body copy, the .md previews and every number stay in the
      mono face — the exports are whitespace-significant and come apart in a
      proportional one.</div>
    ${toggle('caps', 'Uppercase labels', 'off gives sentence case throughout')}
    ${toggle('monoNumbers', 'Tabular figures', 'counters stop shuffling width as they change')}
  `;
}


/* ══ LAYOUT ═══════════════════════════════════════════════════════════════════ */

function renderLayout() {
  const pct = v => Math.round(v * 100) + '%';
  $id('panel-layout').innerHTML = previewHTML() + `

    ${sectionHead('Shape')}
    ${slider('radius', 'Corner radius')}
    <div class="chips" style="margin:-6px 0 16px">
      <button class="chip" data-preset-shape="0">sharp</button>
      <button class="chip" data-preset-shape="4">soft</button>
      <button class="chip" data-preset-shape="12">round</button>
      <button class="chip" data-preset-shape="20">pill</button>
      <button class="chip" data-pref-null="radius">auto</button>
    </div>
    ${slider('border', 'Border weight')}
    <div class="chips" style="margin:-6px 0 16px">
      <button class="chip" data-preset-border="0">none</button>
      <button class="chip" data-preset-border="1">hairline</button>
      <button class="chip" data-preset-border="2">heavy</button>
      <button class="chip" data-pref-null="border">auto</button>
    </div>
    ${chips('cardStyle', [
      { v:'outline', l:'outline' }, { v:'fill', l:'filled' },
      { v:'ghost', l:'ghost' },     { v:'line', l:'rules' },
    ], 'Surfaces', 'what a card is made of')}

    ${sectionHead('Depth')}
    ${chips('depth', [
      { v:'auto', l:'auto' }, { v:'flat', l:'flat' }, { v:'soft', l:'soft' },
      { v:'lift', l:'lifted' }, { v:'heavy', l:'hard' }, { v:'glow', l:'glow' },
    ], 'Elevation', Prefs.get('depth') === 'auto' ? Prefs.character().depth : '')}
    ${toggle('accentGlow', 'Accent halo', 'a soft bloom around anything carrying the accent')}

    ${sectionHead('Density')}
    ${slider('density', 'Spacing', v => pct(v))}
    ${slider('uiScale', 'Interface scale', v => pct(v))}
    ${slider('contentWidth', 'Max content width', v => Math.round(v) + 'px')}
    ${slider('iconStroke', 'Icon weight', v => v.toFixed(1))}

    ${sectionHead('Texture')}
    ${chips('texture', [
      { v:'auto', l:'auto' }, { v:'none', l:'none' }, { v:'grain', l:'grain' },
      { v:'scan', l:'scanlines' }, { v:'grid', l:'grid' }, { v:'dots', l:'dots' },
    ], 'Overlay', Prefs.get('texture') === 'auto' ? Prefs.character().texture : '')}
    ${slider('textureAmount', 'Strength', v => pct(v))}

    ${sectionHead('Navigation')}
    ${chips('navStyle', [
      { v:'pill', l:'floating pill' }, { v:'bar', l:'bottom bar' }, { v:'minimal', l:'hidden' },
    ], 'Tab bar', 'on a wide window it becomes a side rail regardless')}
    ${toggle('showTabLabels', 'Show tab names', 'off leaves the icons alone')}
    ${toggle('colorfulTabs', 'Colour-code the tabs', 'each app keeps its own hue instead of the accent')}
    ${slider('chromeAlpha', 'Chrome opacity', v => pct(v))}
    ${toggle('autoHideChrome', 'Get out of the way', 'the bar steps aside while you scroll down')}

    ${sectionHead('Apps in the bar')}
    <div class="set-note">Which apps get a tab, and in what order. An app switched
      off keeps its data and its settings panel — it just has no slide. Settings
      is always last. With seven or more tabs the pill widens and the arrows step
      aside; the swipe and the number keys still reach everything.</div>
    ${appsList()}

    ${sectionHead('Motion & contrast')}
    ${chips('motion', [{ v:'full', l:'full' }, { v:'reduced', l:'reduced' }, { v:'none', l:'none' }],
      'Animation', 'the OS setting still wins when it asks for less')}
    ${chips('contrast', [{ v:'normal', l:'normal' }, { v:'more', l:'more' }, { v:'max', l:'maximum' }],
      'Contrast', 'lifts muted text and hardens hairlines')}
    ${chips('accentUse', [{ v:'subtle', l:'subtle' }, { v:'normal', l:'normal' }, { v:'loud', l:'loud' }],
      'Accent intensity', 'how strongly the accent washes a surface')}

    <div class="sec"><span>Reset</span></div>
    <button class="btn btn-2" data-act="reset-appearance">reset appearance to defaults</button>
  `;
}


/* The app list: the enabled apps in their order, then the disabled ones. Each
   row has up/down and a switch; the shell rebuilds the track on every change. */
function appsList() {
  const on = Prefs.get('apps');
  const order = on.concat(Prefs.APPS.filter(a => !on.includes(a)));
  return order.map((a, i) => {
    const active = on.includes(a);
    return `<div class="setting-row app-row${active ? '' : ' off'}" data-app-row="${a}">
      <span class="setting-lbl">${esc(APP_NAMES[a] || a)}<small>${esc(APP_HINTS[a] || '')}</small></span>
      <span class="app-acts">
        <button class="setting-btn" data-app-move="${a}:-1" aria-label="move ${esc(APP_NAMES[a] || a)} up"${!active || i === 0 ? ' disabled' : ''}>↑</button>
        <button class="setting-btn" data-app-move="${a}:1" aria-label="move ${esc(APP_NAMES[a] || a)} down"${!active || i >= on.length - 1 ? ' disabled' : ''}>↓</button>
        <button class="tog${active ? ' on' : ''}" data-app-toggle="${a}" role="switch" aria-checked="${active}" aria-label="show ${esc(APP_NAMES[a] || a)}"></button>
      </span></div>`;
  }).join('');
}


/* ══ BEHAVE ═══════════════════════════════════════════════════════════════════ */

function renderBehave() {
  $id('panel-behave').innerHTML = `
    ${sectionHead('Opening')}
    ${chips('startTab', [
      { v:'last', l:'where I left off' },
      ...Prefs.get('apps').map(a => ({ v:a, l:(APP_NAMES[a] || a).toLowerCase() })),
      { v:'settings', l:'settings' },
    ], 'Start on')}

    ${sectionHead('Gestures')}
    ${toggle('swipe', 'Swipe between tabs', 'a drag inside a text field always belongs to the field')}
    ${slider('swipeStrength', 'Swipe commitment', v => Math.round(v * 100) + '% of the width')}
    ${toggle('keyboardNav', 'Keyboard shortcuts', '← → between tabs, 1–9 to jump, / to open settings')}
    ${toggle('haptics', 'Haptic feedback', 'Android only — iOS browsers do not expose the vibration API')}

    ${sectionHead('Safety')}
    ${toggle('confirmDestructive', 'Confirm before clearing', 'off makes reset and clear buttons act immediately')}
    ${slider('toastMs', 'Toast duration', v => (v / 1000).toFixed(1) + 's')}

    ${sectionHead('Formats')}
    ${chips('dateFormat', [
      { v:'long', l:'Monday, 1 September 2026' },
      { v:'short', l:'Mon 1 Sep' },
      { v:'iso', l:'2026-09-01' },
    ], 'Dates')}
    ${chips('weekStart', [{ v:'mon', l:'Monday' }, { v:'sun', l:'Sunday' }], 'Week starts on',
      'the km chart — reports keep ISO weeks, which start on Monday')}
    <div class="f">
      <label class="lbl">Currency symbol</label>
      <input type="text" id="cur-sym" value="${esc(Prefs.get('currency'))}" maxlength="3"
             spellcheck="false" aria-label="currency symbol">
    </div>
    <div class="set-note">Used by STORE's counter, its numpad and every saved trip.</div>

    <div class="sec"><span>Reset</span></div>
    <button class="btn btn-2" data-act="reset-behaviour">reset behaviour to defaults</button>
  `;
}


/* ══ CONTENT ══════════════════════════════════════════════════════════════════
   Editors for everything Config holds. Each group declares how it renders and
   how it reads itself back; the delegated listener does the rest. */

const textareaOf = (rows, ph) =>
  `<textarea data-field="items" rows="${rows}" placeholder="${esc(ph)}" spellcheck="false"></textarea>`;

const EDITORS = {

  /* ── DO · routines ─────────────────────────────────────────────────────── */
  'do.routines': {
    title: 'Daily routines',
    note: 'One checklist per card, one item per line. The glyphs are ordinary characters — paste whatever you like.',
    render() {
      const routines = Config.get('do.routines');
      const tabs = Config.get('do.tabs');
      const tabOf = id => (tabs.find(t => t.routines.includes(id)) || tabs[0] || {}).id;
      return Object.keys(routines).map(key => {
        const r = routines[key];
        return `<div class="ed-card" data-key="${esc(key)}">
          <div class="ed-head">
            <input type="text" data-field="label" value="${esc(r.label)}" placeholder="name" aria-label="routine name">
            <select data-field="tab" aria-label="tab">${tabs.map(t =>
              `<option value="${esc(t.id)}"${tabOf(key) === t.id ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
            <button class="ed-del" data-del="${esc(key)}" aria-label="delete routine">×</button>
          </div>
          <textarea data-field="items" rows="${Math.min(12, Math.max(3, r.items.length))}"
                    spellcheck="false" aria-label="items">${esc(r.items.join('\n'))}</textarea>
        </div>`;
      }).join('') + `<button class="ed-add" data-add="1">+ add a routine</button>`;
    },
    read(box) {
      const routines = {}, byTab = {};
      box.querySelectorAll('.ed-card').forEach(card => {
        const key = card.dataset.key;
        routines[key] = {
          label: card.querySelector('[data-field=label]').value.trim() || key,
          items: lines(card.querySelector('[data-field=items]').value),
        };
        const tab = card.querySelector('[data-field=tab]').value;
        (byTab[tab] = byTab[tab] || []).push(key);
      });
      Config.set('do.routines', routines);
      Config.set('do.tabs', Config.get('do.tabs').map(t =>
        Object.assign({}, t, { routines: byTab[t.id] || [] })));
    },
    add() {
      const r = Config.get('do.routines');
      r[uniqueKey('routine', Object.keys(r))] = { label: 'New routine', items: ['first item'] };
      Config.set('do.routines', r);
    },
    del(key) {
      const r = Config.get('do.routines');
      delete r[key];
      Config.set('do.routines', r);
      Config.set('do.tabs', Config.get('do.tabs').map(t =>
        Object.assign({}, t, { routines: t.routines.filter(x => x !== key) })));
    },
  },

  /* ── DO · packing categories ───────────────────────────────────────────── */
  'do.travelCategories': {
    title: 'Packing categories',
    note: 'The master lists a new travel checklist is built from. Every item starts as a counter at 1.',
    render() {
      const cats = Config.get('do.travelCategories');
      const order = Config.get('do.categoryOrder').filter(k => cats[k])
        .concat(Object.keys(cats).filter(k => !Config.get('do.categoryOrder').includes(k)));
      return order.map(key => `
        <div class="ed-card" data-key="${esc(key)}">
          <div class="ed-head">
            <input type="text" data-field="label" value="${esc(key)}" placeholder="category" aria-label="category name">
            <span class="ed-badge">${cats[key].length} items</span>
            <button class="ed-del" data-del="${esc(key)}" aria-label="delete category">×</button>
          </div>
          <textarea data-field="items" rows="5" spellcheck="false" aria-label="items">${esc(cats[key].join('\n'))}</textarea>
        </div>`).join('') + `<button class="ed-add" data-add="1">+ add a category</button>`;
    },
    read(box) {
      const cats = {}, order = [];
      box.querySelectorAll('.ed-card').forEach(card => {
        const name = slug(card.querySelector('[data-field=label]').value) || card.dataset.key;
        cats[name] = lines(card.querySelector('[data-field=items]').value);
        order.push(name);
      });
      Config.set('do.travelCategories', cats);
      Config.set('do.categoryOrder', order);
    },
    add() {
      const c = Config.get('do.travelCategories');
      const k = uniqueKey('category', Object.keys(c));
      c[k] = [];
      Config.set('do.travelCategories', c);
      Config.set('do.categoryOrder', Config.get('do.categoryOrder').concat(k));
    },
    del(key) {
      const c = Config.get('do.travelCategories');
      delete c[key];
      Config.set('do.travelCategories', c);
      Config.set('do.categoryOrder', Config.get('do.categoryOrder').filter(x => x !== key));
    },
  },

  /* ── LOG · blocks ──────────────────────────────────────────────────────── */
  'log.blocks': {
    title: 'Focus blocks',
    note: 'The buttons on the evening form. Their names are what the exported .md records, so renaming one starts a new series in your history.',
    render() {
      const blocks = Config.get('log.blocks');
      return `<div class="ed-card">
        <div class="ed-head">
          <span class="setting-lbl" style="flex:1">Most blocks per day</span>
          <input type="number" data-field="max" min="1" max="12" value="${Config.get('log.maxBlocks')}" aria-label="max blocks">
        </div>
      </div>` + blocks.map((b, i) => `
        <div class="ed-card" data-key="${i}">
          <div class="ed-head">
            <input type="text" data-field="name" value="${esc(b.name)}" placeholder="block name" aria-label="block name">
            <input type="color" class="ed-swatch" data-field="color" value="${esc(b.color)}" aria-label="block colour">
            <button class="ed-del" data-del="${i}" aria-label="delete block">×</button>
          </div>
        </div>`).join('') + `<button class="ed-add" data-add="1">+ add a block</button>`;
    },
    read(box) {
      const max = box.querySelector('[data-field=max]');
      if (max) Config.set('log.maxBlocks', Math.max(1, Math.min(12, parseInt(max.value, 10) || 6)));
      const out = [];
      box.querySelectorAll('.ed-card[data-key]').forEach(card => {
        const name = card.querySelector('[data-field=name]').value.trim();
        if (name) out.push({ name, color: card.querySelector('[data-field=color]').value });
      });
      Config.set('log.blocks', out);
    },
    add()      { Config.set('log.blocks', Config.get('log.blocks').concat({ name:'new block', color:'#9a9a9a' })); },
    del(idx)   { Config.set('log.blocks', Config.get('log.blocks').filter((_, i) => i !== +idx)); },
  },

  /* ── LOG · labels ──────────────────────────────────────────────────────── */
  'log.labels': {
    title: 'Names and counts',
    paths: ['log.meds','log.mealCount','log.mealLabel','log.caffeine','log.curate','log.scales','log.workouts',
            'log.kmTarget','log.streakRequires'],
    note: 'What the forms call things, plus the walking target and the streak rule. The underlying field names in the exported .md never change, so your Obsidian notes stay parseable.',
    render() {
      const meds = Config.get('log.meds'), caf = Config.get('log.caffeine');
      const cur  = Config.get('log.curate'), sc = Config.get('log.scales');
      const pair = (path, a, b, la, lb) => `<div class="ed-pair">
        <div><label class="lbl">${esc(la)}</label><input type="text" data-cfg="${path}" data-sub="${a.k}" value="${esc(a.v)}"></div>
        <div><label class="lbl">${esc(lb)}</label><input type="text" data-cfg="${path}" data-sub="${b.k}" value="${esc(b.v)}"></div>
      </div>`;
      return `
        <label class="lbl">Medication slots</label>
        ${pair('log.meds', {k:'lam',v:meds.lam}, {k:'rit',v:meds.rit}, 'slot 1', 'slot 2')}

        <label class="lbl">Caffeine counters</label>
        ${pair('log.caffeine', {k:'c',v:caf.c}, {k:'ed',v:caf.ed}, 'counter 1', 'counter 2')}

        <label class="lbl">Meals</label>
        <div class="ed-pair">
          <div><label class="lbl">how many</label>
            <input type="number" min="1" max="8" data-cfg="log.mealCount" value="${Config.get('log.mealCount')}"></div>
          <div><label class="lbl">called</label>
            <input type="text" data-cfg="log.mealLabel" value="${esc(Config.get('log.mealLabel'))}"></div>
        </div>

        <label class="lbl">Curate counters</label>
        ${Object.keys(cur).map(k => `<div class="ed-card">
          <div class="ed-head">
            <input type="text" data-cfg="log.curate" data-sub="${k}.label" value="${esc(cur[k].label)}" aria-label="${k} label">
            <input type="color" class="ed-swatch" data-cfg="log.curate" data-sub="${k}.color" value="${esc(cur[k].color)}" aria-label="${k} colour">
          </div></div>`).join('')}

        <label class="lbl">Scale endpoints</label>
        ${Object.keys(sc).map(k => `<div class="ed-card">
          <div class="ed-head">
            <span class="ed-badge">${esc(k)}</span>
            <input type="text" data-cfg="log.scales" data-sub="${k}.low"  value="${esc(sc[k].low)}"  aria-label="${k} low">
            <input type="text" data-cfg="log.scales" data-sub="${k}.high" value="${esc(sc[k].high)}" aria-label="${k} high">
          </div></div>`).join('')}

        <div class="f" style="margin-top:14px">
          <label class="lbl">Workout types <em>comma separated</em></label>
          <input type="text" data-cfg="log.workouts" data-list="1" value="${esc(Config.get('log.workouts').join(', '))}">
        </div>

        <label class="lbl">Walking and streak</label>
        <div class="ed-pair">
          <div><label class="lbl">km target per day</label>
            <input type="number" inputmode="decimal" min="0.5" max="50" step="0.5" data-cfg="log.kmTarget"
                   value="${esc(Config.get('log.kmTarget'))}"></div>
          <div><label class="lbl">a day counts when</label>
            <select data-cfg="log.streakRequires" aria-label="streak rule">${[
              ['both', 'morning + evening'], ['morning', 'morning logged'], ['evening', 'evening logged'],
            ].map(([v, l]) => `<option value="${v}"${Config.get('log.streakRequires') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>`;
    },
    read() { /* per-field, handled by the data-cfg listener */ },
  },

  /* ── LOG · fields ──────────────────────────────────────────────────────── */
  'log.fields': {
    title: 'Which fields appear',
    note: 'Turning a field off hides it from the form. Anything already recorded is kept and still exports — nothing is deleted.',
    render() {
      const f = Config.get('log.fields');
      const NAMES = {
        wakeTime:'wake time', sleepHours:'sleep hours', energyM:'energy (am)', moodM:'mood (am)',
        coldShower:'cold shower', weight:'weight', kmMorning:'km (am)', workout:'workout',
        kmEvening:'km (pm)', energyE:'energy (pm)', moodE:'mood (pm)', stress:'stress',
        meds:'meds', meals:'meals', caffeine:'caffeine', blocks:'blocks', curate:'curate output',
      };
      return `<div class="ed-grid">${Object.keys(NAMES).map(k => `
        <div class="ed-toggle"><span>${esc(NAMES[k])}</span>
          <button class="tog${f[k] ? ' on' : ''}" data-cfg-toggle="log.fields.${k}"
                  role="switch" aria-checked="${!!f[k]}" aria-label="${esc(NAMES[k])}"></button>
        </div>`).join('')}</div>`;
    },
    read() {},
  },

  /* ── PLAN · projects ───────────────────────────────────────────────────── */
  'plan.types': {
    title: 'Projects and sections',
    note: 'One tile per project. Each line in the box is a section: what you see, then a pipe, then the Todoist section name it files under.',
    render() {
      return Config.get('plan.types').map((t, i) => `
        <div class="ed-card" data-key="${i}">
          <div class="ed-head">
            <input type="text" data-field="label" value="${esc(t.label)}" placeholder="project" aria-label="project name">
            <input type="color" class="ed-swatch" data-field="color" value="${esc(t.color)}" aria-label="project colour">
            <button class="ed-del" data-del="${i}" aria-label="delete project">×</button>
          </div>
          <textarea data-field="subs" rows="${Math.min(10, Math.max(2, t.subs.length))}" spellcheck="false"
                    aria-label="sections">${esc(t.subs.map(s => s.display === s.section ? s.display : s.display + ' | ' + s.section).join('\n'))}</textarea>
          <div class="ed-hint">display name | todoist section — omit the pipe when they match</div>
        </div>`).join('') + `<button class="ed-add" data-add="1">+ add a project</button>`;
    },
    read(box) {
      const prev = Config.get('plan.types');
      const out = [];
      box.querySelectorAll('.ed-card').forEach(card => {
        const i = +card.dataset.key;
        const label = card.querySelector('[data-field=label]').value.trim();
        if (!label) return;
        out.push({
          // keep the original key where there was one: plan_mappings is keyed by it
          key: (prev[i] && prev[i].key) || uniqueKey(label, out.map(t => t.key)),
          label, pLabel: label,
          color: card.querySelector('[data-field=color]').value,
          subs: lines(card.querySelector('[data-field=subs]').value).map(l => {
            const [d, s] = l.split('|').map(x => x.trim());
            return { display: d, section: s || d };
          }),
        });
      });
      Config.set('plan.types', out);
    },
    add() {
      const t = Config.get('plan.types');
      Config.set('plan.types', t.concat({
        key: uniqueKey('project', t.map(x => x.key)), label:'new project', pLabel:'new project',
        color:'#808080', subs:[{ display:'tasks', section:'tasks' }],
      }));
    },
    del(idx) { Config.set('plan.types', Config.get('plan.types').filter((_, i) => i !== +idx)); },
  },

  /* ── PLAN · chips ──────────────────────────────────────────────────────── */
  'plan.chips': {
    title: 'Task form chips',
    paths: ['plan.blocks','plan.times'],
    note: 'The quick-pick rows on the new-task form.',
    render() {
      return `
        <div class="f">
          <label class="lbl">Blocks <em>comma separated</em></label>
          <input type="text" data-cfg="plan.blocks" data-list="1" value="${esc(Config.get('plan.blocks').join(', '))}">
        </div>
        <div class="f">
          <label class="lbl">Time estimates</label>
          <textarea data-cfg="plan.times" data-pairs="label,value" rows="8" spellcheck="false"
            >${esc(Config.get('plan.times').map(t => t.label + ' | ' + t.value).join('\n'))}</textarea>
          <div class="ed-hint">button text | what Todoist receives</div>
        </div>`;
    },
    read() {},
  },

  /* ── STORE · categories ────────────────────────────────────────────────── */
  'store.categories': {
    title: 'Aisles',
    note: 'Each aisle is a tile in "add items", a colour on the list, and the vocabulary the auto-categoriser matches against. The "other" aisle cannot be removed — uncategorised items land there.',
    render() {
      const cats = Config.get('store.categories');
      return Object.keys(cats).map(key => {
        const c = cats[key];
        const locked = key === 'manual';
        return `<div class="ed-card" data-key="${esc(key)}">
          <div class="ed-head">
            <input type="text" data-field="label" value="${esc(c.label)}" placeholder="aisle" aria-label="aisle name">
            <input type="color" class="ed-swatch" data-field="color" value="${esc(c.color)}" aria-label="aisle colour">
            <select data-field="icon" aria-label="icon">${STORE_ICONS.map(ic =>
              `<option value="${ic}"${c.icon === ic ? ' selected' : ''}>${ic.replace('ico-','')}</option>`).join('')}</select>
            ${locked ? '<span class="ed-badge">fixed</span>'
                     : `<button class="ed-del" data-del="${esc(key)}" aria-label="delete aisle">×</button>`}
          </div>
          <textarea data-field="items" rows="4" spellcheck="false" aria-label="items">${esc(c.items.join('\n'))}</textarea>
        </div>`;
      }).join('') + `<button class="ed-add" data-add="1">+ add an aisle</button>`;
    },
    read(box) {
      const prev = Config.get('store.categories');
      const out = {};
      box.querySelectorAll('.ed-card').forEach(card => {
        const key = card.dataset.key;                       // the key is the identity, never renamed
        out[key] = {
          label: card.querySelector('[data-field=label]').value.trim() || key,
          color: card.querySelector('[data-field=color]').value,
          icon:  card.querySelector('[data-field=icon]').value,
          items: lines(card.querySelector('[data-field=items]').value),
        };
      });
      if (!out.manual) out.manual = prev.manual;            // never let the fallback aisle vanish
      Config.set('store.categories', out);
    },
    add() {
      const c = Config.get('store.categories');
      const k = uniqueKey('aisle', Object.keys(c));
      // insert before `manual`, which stays last
      const out = {};
      Object.keys(c).forEach(x => { if (x !== 'manual') out[x] = c[x]; });
      out[k] = { label:'new aisle', color:'#8a8a8a', icon:'ico-other', items:[] };
      out.manual = c.manual;
      Config.set('store.categories', out);
    },
    del(key) {
      if (key === 'manual') return;
      const c = Config.get('store.categories');
      delete c[key];
      Config.set('store.categories', c);
    },
  },

  /* ── STORE · meals ─────────────────────────────────────────────────────── */
  'store.meals': {
    title: 'Premade meals',
    note: 'Tapping a meal adds its ingredients to the list. One per line: the item, a pipe, then which aisle it belongs to.',
    render() {
      const meals = Config.get('store.meals');
      const cats  = Object.keys(Config.get('store.categories'));
      return Object.keys(meals).map(key => {
        const m = meals[key];
        return `<div class="ed-card" data-key="${esc(key)}">
          <div class="ed-head">
            <input type="text" data-field="label" value="${esc(m.label)}" placeholder="meal" aria-label="meal name">
            <span class="ed-badge">${m.items.length} items</span>
            <button class="ed-del" data-del="${esc(key)}" aria-label="delete meal">×</button>
          </div>
          <textarea data-field="items" rows="${Math.min(10, Math.max(3, m.items.length))}" spellcheck="false"
                    aria-label="ingredients">${esc(m.items.map(p => p[0] + ' | ' + p[1]).join('\n'))}</textarea>
          <div class="ed-hint">aisles: ${esc(cats.join(', '))}</div>
        </div>`;
      }).join('') + `<button class="ed-add" data-add="1">+ add a meal</button>`;
    },
    read(box) {
      const cats = Object.keys(Config.get('store.categories'));
      const out = {};
      box.querySelectorAll('.ed-card').forEach(card => {
        const key = card.dataset.key;
        out[key] = {
          label: card.querySelector('[data-field=label]').value.trim() || key,
          items: lines(card.querySelector('[data-field=items]').value).map(l => {
            const [n, c] = l.split('|').map(x => x.trim());
            return [n, cats.includes(c) ? c : 'manual'];
          }).filter(p => p[0]),
        };
      });
      Config.set('store.meals', out);
    },
    add() {
      const m = Config.get('store.meals');
      m[uniqueKey('meal', Object.keys(m))] = { label:'new meal', items:[] };
      Config.set('store.meals', m);
    },
    del(key) { const m = Config.get('store.meals'); delete m[key]; Config.set('store.meals', m); },
  },

  /* ── STORE · counter ───────────────────────────────────────────────────── */
  'store.quickAmounts': {
    title: 'Counter steps',
    note: 'The +/− buttons over the in-store total, largest first.',
    render() {
      return `<div class="f">
        <label class="lbl">Amounts <em>comma separated</em></label>
        <input type="text" data-cfg="store.quickAmounts" data-numlist="1"
               value="${esc(Config.get('store.quickAmounts').join(', '))}">
      </div>`;
    },
    read() {},
  },

  /* ── TEND · plant types ────────────────────────────────────────────────── */
  'tend.groups': {
    title: 'Plant types',
    note: 'How seasonal each type is: 1 stretches its watering fully with the growth curve, 0 not at all, above 1 harder still. The note shows under the type in the editor. A type in use by a plant can be renamed freely; deleting it sends the plant to the default type for its maths.',
    render() {
      return Config.get('tend.groups').map((g, i) => `
        <div class="ed-card" data-key="${i}">
          <div class="ed-head">
            <input type="text" data-field="label" value="${esc(g.label)}" placeholder="type" aria-label="type name">
            <input type="number" data-field="season" min="0" max="3" step="0.1" value="${esc(g.season)}" aria-label="season factor" title="season factor">
            <button class="ed-del" data-del="${i}" aria-label="delete type">×</button>
          </div>
          <textarea data-field="note" rows="2" spellcheck="false" aria-label="note">${esc(g.note || '')}</textarea>
        </div>`).join('') + `<button class="ed-add" data-add="1">+ add a type</button>`;
    },
    read(box) {
      const prev = Config.get('tend.groups');
      const out = [];
      box.querySelectorAll('.ed-card').forEach(card => {
        const i = +card.dataset.key;
        const label = card.querySelector('[data-field=label]').value.trim();
        if (!label) return;
        out.push({
          // the key is what each plant is filed under, so it survives a rename
          key: (prev[i] && prev[i].key) || uniqueKey(label, out.map(g => g.key)),
          label,
          season: Math.max(0, Math.min(3, parseFloat(card.querySelector('[data-field=season]').value) || 0)),
          note: card.querySelector('[data-field=note]').value.trim(),
        });
      });
      if (out.length) Config.set('tend.groups', out);
    },
    add() {
      const g = Config.get('tend.groups');
      Config.set('tend.groups', g.concat({ key: uniqueKey('type', g.map(x => x.key)), label:'new type', season:1, note:'' }));
    },
    del(idx) {
      const g = Config.get('tend.groups');
      if (g.length <= 1) return;
      Config.set('tend.groups', g.filter((_, i) => i !== +idx));
    },
  },

  /* ── TEND · vocabulary + curve ─────────────────────────────────────────── */
  'tend.labels': {
    title: 'Care vocabulary and season',
    paths: ['tend.tasks','tend.seasons','tend.growth','tend.feedFloor'],
    note: 'The three care tasks are fixed slots with editable names (the log is filed under water / feed / repot). The growth curve is twelve values, January to December, from 0 to 1 — watering stretches as it falls, and feeding pauses below the cut-off.',
    render() {
      const t = Config.get('tend.tasks');
      const row = (k, name) => `<div class="ed-card"><div class="ed-head">
        <span class="ed-badge">${esc(name)}</span>
        <input type="text" data-cfg="tend.tasks" data-sub="${k}.label" value="${esc(t[k].label)}" aria-label="${k} label" placeholder="label">
        <input type="text" data-cfg="tend.tasks" data-sub="${k}.verb"  value="${esc(t[k].verb)}"  aria-label="${k} verb" placeholder="past tense">
      </div></div>`;
      return row('water', 'water') + row('feed', 'feed') + row('repot', 'repot') + `
        <div class="f" style="margin-top:14px">
          <label class="lbl">Growth curve <em>12 values, Jan → Dec</em></label>
          <input type="text" data-cfg="tend.growth" data-numlist="all" inputmode="decimal"
                 value="${esc(Config.get('tend.growth').join(', '))}">
        </div>
        <div class="f">
          <label class="lbl">Season names <em>12, Jan → Dec</em></label>
          <input type="text" data-cfg="tend.seasons" data-list="1"
                 value="${esc(Config.get('tend.seasons').join(', '))}">
        </div>
        <div class="f">
          <label class="lbl">Pause feeding below <em>growth, 0–1</em></label>
          <input type="number" min="0" max="1" step="0.05" inputmode="decimal" data-cfg="tend.feedFloor"
                 value="${esc(Config.get('tend.feedFloor'))}">
        </div>`;
    },
    read() {},
  },

  /* ── TRACK · labels ────────────────────────────────────────────────────── */
  'track.labels': {
    title: 'Curriculum labels',
    paths: ['track.phases','track.levelLabel','track.pse','track.revision'],
    note: 'The names around the plan. The 54 topics themselves are not editable here — the ticks are filed under their ids, and renumbering would orphan them.',
    render() {
      const ph = Config.get('track.phases'), pse = Config.get('track.pse');
      return `
        <label class="lbl">Phases</label>
        ${['real','mes','main'].map(k => `<div class="f"><input type="text" data-cfg="track.phases" data-sub="${k}" value="${esc(ph[k] || '')}" aria-label="phase ${k}"></div>`).join('')}
        <div class="ed-pair">
          <div><label class="lbl">level word</label><input type="text" data-cfg="track.levelLabel" value="${esc(Config.get('track.levelLabel'))}"></div>
          <div><label class="lbl">separate subject</label><input type="text" data-cfg="track.pse" data-sub="label" value="${esc(pse.label)}"></div>
        </div>
        <div class="f"><label class="lbl">its note</label><input type="text" data-cfg="track.pse" data-sub="note" value="${esc(pse.note || '')}"></div>
        <div class="f">
          <label class="lbl">Revision reminders <em>one per line</em></label>
          <textarea data-cfg="track.revision" data-lines="1" rows="4" spellcheck="false">${esc(Config.get('track.revision').join('\n'))}</textarea>
        </div>`;
    },
    read() {},
  },

  /* ── LEARN · ratings ───────────────────────────────────────────────────── */
  'learn.ratings': {
    title: 'Rating names',
    note: 'The four buttons under a revealed card, lowest first. The fourth is the one that counts as learned; the other three are "needs work".',
    render() {
      return `<div class="f">
        <label class="lbl">Ratings <em>comma separated, four of them</em></label>
        <input type="text" data-cfg="learn.ratings" data-list="1" value="${esc(Config.get('learn.ratings').join(', '))}">
      </div>`;
    },
    read() {},
  },
};

const EDITOR_ORDER = ['do.routines','do.travelCategories','log.blocks','log.labels','log.fields',
                      'plan.types','plan.chips','store.categories','store.meals','store.quickAmounts',
                      'tend.groups','tend.labels','track.labels','learn.ratings'];

function renderContent() {
  $id('panel-content').innerHTML = `
    <div class="set-note">Everything the apps used to have baked into their
      code. Edits save as you type and take effect immediately — the screen
      behind this one re-renders itself. Each section can be put back to what
      ROOT ships with, independently.</div>
    ` + EDITOR_ORDER.map(path => {
      const ed = EDITORS[path];
      const paths = ed.paths || [path];
      const custom = paths.some(p => Config.isCustom(p)) ||
                     (path === 'do.routines' && Config.isCustom('do.tabs')) ||
                     (path === 'do.travelCategories' && Config.isCustom('do.categoryOrder')) ||
                     (path === 'log.blocks' && Config.isCustom('log.maxBlocks'));
      return `
        <div class="sec"><span>${esc(ed.title)}</span>
          <button class="sec-reset${custom ? '' : ' hidden'}" data-cfg-reset="${path}">reset to default</button>
        </div>
        ${ed.note ? `<div class="set-note">${ed.note}</div>` : ''}
        <div data-group="${path}">${ed.render()}</div>`;
    }).join('');
}

/* Paths a group's "reset to default" has to clear — a collection and the index
   that orders it always go back together. */
const RESET_BUNDLE = {
  'do.routines':          ['do.routines','do.tabs'],
  'do.travelCategories':  ['do.travelCategories','do.categoryOrder'],
  'log.blocks':           ['log.blocks','log.maxBlocks'],
  'log.labels':           ['log.meds','log.mealCount','log.mealLabel','log.caffeine','log.curate','log.scales','log.workouts',
                           'log.kmTarget','log.streakRequires'],
  'plan.chips':           ['plan.blocks','plan.times'],
  'tend.labels':          ['tend.tasks','tend.seasons','tend.growth','tend.feedFloor'],
  'track.labels':         ['track.phases','track.levelLabel','track.pse','track.revision'],
};


/* ══ DATA ═════════════════════════════════════════════════════════════════════ */

function tdStatus(msg, kind) {
  const el = $id('set-td-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'td-status' + (kind ? ' ' + kind : '');
}

/* onShow re-renders this panel every time the settings tab comes back up, so the
   field is only refilled from storage when it holds nothing the user has not
   saved yet — otherwise leaving the tab and returning wiped a key that had been
   pasted but not saved. */
function renderToken() {
  const tok = Creds.token();
  const inp = $id('set-td-token');
  if (inp) {
    const unsaved = inp.value && inp.value !== tok;
    if (!unsaved && document.activeElement !== inp) inp.value = tok;
  }
  tdStatus(tok ? 'key saved · used by DO, PLAN and STORE' : 'no key yet', tok ? 'good' : '');
}

function saveToken() {
  Creds.save($id('set-td-token').value.trim());
  renderToken();
  Shell.toast(Creds.token() ? 'todoist key saved' : 'todoist key cleared');
}

/* A single check against the account, rather than three per-app ones. Each app
   still has its own project/section test in its own panel. */
async function testToken() {
  const tok = Creds.token();
  if (!tok) { tdStatus('paste your key and save it first', 'bad'); return; }
  const btn = $id('set-td-test');
  btn.disabled = true;
  tdStatus('checking…', 'busy');
  try {
    const res = await fetch('https://api.todoist.com/api/v1/projects?limit=1',
                            { headers: { 'Authorization': 'Bearer ' + tok } });
    if (res.status === 401 || res.status === 403) throw new Error('key rejected by Todoist');
    if (!res.ok) throw new Error('Todoist error ' + res.status);
    tdStatus('key works — DO, PLAN and STORE are all using it', 'good');
  } catch (e) {
    tdStatus(location.protocol === 'file:'
      ? 'blocked by the browser — serve over http(s), not as a local file'
      : e.message, 'bad');
  } finally { btn.disabled = false; }
}

function renderStorage() {
  const keys = allKeys();
  let total = 0;
  const sizes = {};
  keys.forEach(k => {
    const n = k.length + (localStorage.getItem(k) || '').length;
    total += n;
    const g = GROUPS.find(g => g.match(k));
    if (g) sizes[g.name] = (sizes[g.name] || 0) + n;
  });
  // localStorage is ~5MB on every browser that matters; the meter is indicative
  const CAP = 5 * 1024 * 1024;
  const rows = GROUPS.map(g => {
    const n = keys.filter(g.match).length;
    return `<div class="data-stat">
      <span class="data-stat-k">${g.name}</span>
      <span class="data-stat-v">${n} key${n === 1 ? '' : 's'} · ${fmtSize(sizes[g.name] || 0)}</span>
    </div>`;
  }).join('');
  $id('set-storage').innerHTML = rows + `
    <div class="data-stat"><span class="data-stat-k">All keys on this origin</span>
      <span class="data-stat-v">${keys.length} · ${fmtSize(total)}</span></div>
    <div class="st-meter"><i style="width:${Math.min(100, total / CAP * 100).toFixed(1)}%"></i></div>
    <div class="st-legend"><span>${(total / CAP * 100).toFixed(1)}% of a typical 5 MB budget</span></div>
    <div class="data-stat" id="set-storage-idb"><span class="data-stat-k">LEARN decks (IndexedDB)</span>
      <span class="data-stat-v">…</span></div>`;
  // the decks are outside localStorage and outside the backup; say how much is there
  if (window.LEARN) LEARN.deckStats().then(s => {
    const el = $id('set-storage-idb'); if (!el) return;
    el.querySelector('.data-stat-v').textContent = s.ok
      ? `${s.decks} deck${s.decks === 1 ? '' : 's'} · ${s.cards} cards · ${fmtSize(s.bytes)} media · not in the backup`
      : 'unavailable';
  });
}

function renderData() {
  renderToken();
  renderStorage();
  const n = Config.customPaths().length;
  const el = $id('set-custom-count');
  if (el) el.textContent = n ? `${n} section${n === 1 ? '' : 's'} customised` : 'nothing customised yet';
}

/* Deliberately not filtered to the known prefixes: a backup that silently drops
   a key is worse than one that carries a few bytes too many. */
async function exportAll() {
  const keys = allKeys();
  if (!keys.length) { Shell.toast('nothing stored yet'); return; }
  const data = {};
  keys.forEach(k => { data[k] = localStorage.getItem(k); });
  const payload = { app:'root', version:2, exported:new Date().toISOString(), data };
  const json = JSON.stringify(payload);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const filename = `root_backup_${stamp}.json`;
  try {
    const file = new File([json], filename, { type:'application/json' });
    if (navigator.canShare?.({ files:[file] })) { await navigator.share({ files:[file] }); return; }
    if (navigator.share) { await navigator.share({ title:filename, text:json }); return; }
  } catch (err) { if (err.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type:'application/json' }));
  a.download = filename; a.click();
  Shell.toast(`exported ${keys.length} keys`);
}

function pickImport() { $id('set-import-file').click(); }

function importAll(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    event.target.value = '';
    let payload;
    try { payload = JSON.parse(reader.result); } catch { Shell.toast('invalid file'); return; }
    const data = payload && typeof payload.data === 'object' ? payload.data : null;
    if (!data) { Shell.toast('not a root backup'); return; }
    const incoming = Object.keys(data);
    if (!incoming.length) { Shell.toast('nothing in that file'); return; }
    const existing = new Set(allKeys());
    const overwrite = incoming.filter(k => existing.has(k)).length;
    const msg = `Restore ${incoming.length} key${incoming.length !== 1 ? 's' : ''}?\n\n`
              + `${incoming.length - overwrite} new · ${overwrite} will overwrite what is here.\n\n`
              + `The app reloads afterwards.`;
    if (!confirm(msg)) return;
    try { incoming.forEach(k => { if (typeof data[k] === 'string') localStorage.setItem(k, data[k]); }); }
    catch { Shell.toast('storage full — nothing changed'); return; }
    location.reload();
  };
  reader.readAsText(file);
}

/* A theme/layout/content preset on its own, small enough to paste into a note or
   a message. Deliberately separate from the full backup: appearance is the thing
   people actually want to move between devices or share. */
async function exportLook() {
  const payload = { app:'root', kind:'look', version:2,
                    prefs: Prefs.all(), config: Config.raw() };
  const json = JSON.stringify(payload, null, 2);
  try { await navigator.clipboard.writeText(json); Shell.toast('look copied to clipboard'); return; }
  catch {}
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type:'application/json' }));
  a.download = 'root_look.json'; a.click();
}

async function importLook() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch {}
  if (!text) text = prompt('Paste a ROOT look') || '';
  if (!text.trim()) return;
  let p;
  try { p = JSON.parse(text); } catch { Shell.toast('that is not valid JSON'); return; }
  if (!p || p.app !== 'root') { Shell.toast('not a root look'); return; }
  if (p.prefs)  Prefs.setMany(p.prefs);
  if (p.config) Config.replaceAll(p.config);
  render();
  Shell.toast('look applied');
}


/* ══ Panels ═══════════════════════════════════════════════════════════════════ */

const RENDERERS = {
  look: renderLook, layout: renderLayout, behave: renderBehave,
  content: renderContent, data: renderData,
  do:   () => window.DO   && DO.renderSettings(),
  log:  () => window.LOG  && LOG.renderDataScreen(),
  plan: () => window.PLAN && PLAN.renderSettings(),
  store:() => window.STORE&& STORE.renderSettings(),
  tend: () => window.TEND && TEND.renderSettings(),
  track:() => window.TRACK&& TRACK.renderSettings(),
  learn:() => window.LEARN&& LEARN.renderSettings(),
};

function panel(name) {
  if (!PANELS.includes(name)) return;
  currentPanel = name;
  $all('.set-panel').forEach(p => p.classList.toggle('on', p.dataset.panel === name));
  $all('.seg-b').forEach(b => {
    const on = b.dataset.seg === name;
    b.classList.toggle('on', on);
    // nine chips overflow a phone; keep the active one on screen
    if (on && b.scrollIntoView) b.scrollIntoView({ block:'nearest', inline:'nearest' });
  });
  const view = document.getElementById('view-settings');
  if (view) view.scrollTop = 0;
  Shell.showChrome();
  // #settings/<panel> is linkable; the shell leaves this segment alone
  try { if (location.hash.startsWith('#settings')) history.replaceState(null, '', '#settings/' + name); } catch {}
  RENDERERS[name] && RENDERERS[name]();
}

function render() { RENDERERS[currentPanel] && RENDERERS[currentPanel](); }


/* ══ One delegated listener for every generated control ═══════════════════════
   Change events for text/colour/number/range inputs, clicks for chips, toggles
   and editor buttons. Nothing here knows what any individual control means — it
   reads the intent off the element and hands it to Prefs or Config. */

const view = document.getElementById('view-settings');

function groupOf(el) { return el.closest('[data-group]'); }

function commitGroup(el) {
  const box = groupOf(el);
  if (!box) return;
  const ed = EDITORS[box.dataset.group];
  if (ed && ed.read) ed.read(box);
}

/* data-cfg fields write one value straight to a Config path.

   `data-sub` writes one key of an object and saves the object whole, which is
   the only safe shape: an override is stored whole-branch, so writing the leaf
   path alone would shadow the object with a one-key fragment and every other
   key would read as undefined. A number or range input's sub is stored as a
   number, so the modules never parse what they read. */
const isNumeric = el => el.type === 'number' || el.type === 'range';
function commitField(el) {
  const path = el.dataset.cfg;
  if (!path) return;
  if (el.dataset.sub) {
    /* `data-sub` may be dotted (mix.label) so the branch that is saved whole is
       the one the module reads whole. 2.1 pointed these at log.curate.mix with
       sub=label, which overrode log.curate with a one-slot fragment: rename one
       curate counter and the other two vanished from the evening form. */
    const obj = Config.get(path) || {};
    const keys = el.dataset.sub.split('.');
    const last = keys.pop();
    let node = obj;
    keys.forEach(k => { if (typeof node[k] !== 'object' || node[k] === null) node[k] = {}; node = node[k]; });
    node[last] = isNumeric(el) ? (parseFloat(el.value) || 0) : el.value;
    Config.set(path, obj);
  } else if (el.dataset.list) {
    Config.set(path, el.value.split(',').map(s => s.trim()).filter(Boolean));
  } else if (el.dataset.lines) {
    Config.set(path, lines(el.value));
  } else if (el.dataset.numlist) {
    // "all" keeps zeros (a growth curve may have one); the default drops them
    // (a zero counter button is meaningless)
    const keepZero = el.dataset.numlist === 'all';
    Config.set(path, el.value.split(',').map(s => parseFloat(s.trim()))
                             .filter(n => isFinite(n) && (keepZero || n !== 0)));
  } else if (el.dataset.pairs) {
    const [a, b] = el.dataset.pairs.split(',');
    Config.set(path, lines(el.value).map(l => {
      const parts = l.split('|').map(x => x.trim());
      return { [a]: parts[0], [b]: parts[1] || parts[0] };
    }));
  } else if (isNumeric(el)) {
    Config.set(path, parseFloat(el.value) || 0);
  } else {
    Config.set(path, el.value);
  }
}

view.addEventListener('input', e => {
  const el = e.target;

  // sliders: live, and the readout follows the thumb
  if (el.dataset.pref && el.type === 'range') {
    Prefs.set(el.dataset.pref, el.value);
    const row = el.closest('.slider-row');
    const out = row && row.querySelector('.slider-val');
    if (out) {
      out.classList.remove('is-auto');
      out.textContent = readoutFor(el.dataset.pref, parseFloat(el.value));
    }
    return;
  }
  // free-text and colour fields commit as you type
  if (el.dataset.cfg) { commitField(el); return; }
  if (el.closest('[data-group]') && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) commitGroup(el);
});

view.addEventListener('change', e => {
  const el = e.target;
  // a select bound straight to a path (the streak rule) commits here — it does
  // not reliably fire `input`, and its group's read() is a no-op
  if (el.dataset.cfg) { commitField(el); return; }
  if (el.tagName === 'SELECT' && el.closest('[data-group]')) { commitGroup(el); return; }
  if (el.id === 'acc-color') {
    Prefs.set('accentCustom', el.value);
    const hex = $id('acc-hex'); if (hex) hex.value = el.value;
    return;
  }
  if (el.id === 'acc-hex') {
    const v = Prefs.normHex(el.value);
    Prefs.set('accentCustom', v);
    el.value = v;
    const c = $id('acc-color'); if (c) c.value = v;
    return;
  }
  if (el.id === 'cur-sym') Prefs.set('currency', el.value.slice(0, 3) || '€');
});

view.addEventListener('click', e => {
  const t = e.target.closest('[data-pref],[data-toggle],[data-theme-pick],[data-add],[data-del],[data-cfg-reset],[data-cfg-toggle],[data-preset-shape],[data-preset-border],[data-pref-null],[data-app-toggle],[data-app-move],[data-act]');
  if (!t) return;

  // the app list: switch an app's tab on or off, or move it
  if (t.dataset.appToggle) {
    const a = t.dataset.appToggle, on = Prefs.get('apps');
    const next = on.includes(a) ? on.filter(x => x !== a)
               : Prefs.APPS.filter(x => on.includes(x) || x === a);   // re-enable in shipped order
    if (!next.length) { Shell.toast('keep at least one app'); return; }
    Prefs.set('apps', next); Prefs.tap(); renderLayout(); return;
  }
  if (t.dataset.appMove) {
    const [a, dir] = t.dataset.appMove.split(':');
    const on = Prefs.get('apps'), i = on.indexOf(a), j = i + (+dir);
    if (i < 0 || j < 0 || j >= on.length) return;
    [on[i], on[j]] = [on[j], on[i]];
    Prefs.set('apps', on); renderLayout(); return;
  }

  // theme card
  if (t.dataset.themePick) { Prefs.set('theme', t.dataset.themePick); Prefs.tap();
    renderLook(); Shell.toast('theme · ' + Prefs.themeInfo().name); return; }

  // toggle switch bound to a pref
  if (t.dataset.toggle) { Prefs.set(t.dataset.pref, !Prefs.get(t.dataset.pref)); Prefs.tap();
    render(); return; }

  // chip bound to a pref
  if (t.dataset.pref && t.dataset.val !== undefined) {
    Prefs.set(t.dataset.pref, t.dataset.val); Prefs.tap(); render(); return; }

  // shape quick-picks
  if (t.dataset.presetShape  !== undefined) { Prefs.set('radius', t.dataset.presetShape); renderLayout(); return; }
  if (t.dataset.presetBorder !== undefined) { Prefs.set('border', t.dataset.presetBorder); renderLayout(); return; }
  if (t.dataset.prefNull)                   { Prefs.reset(t.dataset.prefNull); renderLayout(); return; }

  // content editors
  if (t.dataset.add) { const box = groupOf(t); EDITORS[box.dataset.group].add(); renderContent(); return; }
  if (t.dataset.del !== undefined && groupOf(t)) {
    const box = groupOf(t);
    if (!confirmed('Remove this?')) return;
    EDITORS[box.dataset.group].del(t.dataset.del);
    renderContent(); return;
  }
  if (t.dataset.cfgReset) {
    const paths = RESET_BUNDLE[t.dataset.cfgReset] || [t.dataset.cfgReset];
    if (!confirmed('Put this section back to what ROOT ships with?')) return;
    paths.forEach(p => Config.reset(p));
    renderContent(); Shell.toast('reset to default'); return;
  }
  if (t.dataset.cfgToggle) {
    const path = t.dataset.cfgToggle;
    const i = path.lastIndexOf('.');
    const obj = Config.get(path.slice(0, i)) || {};
    obj[path.slice(i + 1)] = !obj[path.slice(i + 1)];
    Config.set(path.slice(0, i), obj);
    renderContent(); return;
  }

  // panel-level actions
  if (t.dataset.act === 'reset-appearance') {
    if (!confirmed('Reset every appearance setting?')) return;
    ['theme','themeMode','themeDark','themeLight','accent','accentCustom','displayFont','monoFont',
     'depth','texture','motion','contrast','caps','navStyle','cardStyle','accentUse','radius','border',
     'density','uiScale','iconStroke','chromeAlpha','contentWidth','textureAmount',
     'showTabLabels','accentGlow','monoNumbers','colorfulTabs','apps'].forEach(k => Prefs.reset(k));
    render(); Shell.toast('appearance reset');
  }
  if (t.dataset.act === 'reset-behaviour') {
    if (!confirmed('Reset every behaviour setting?')) return;
    ['startTab','swipe','swipeStrength','autoHideChrome','haptics','confirmDestructive',
     'toastMs','keyboardNav','dateFormat','weekStart','currency'].forEach(k => Prefs.reset(k));
    render(); Shell.toast('behaviour reset');
  }
  if (t.dataset.act === 'reset-content') {
    if (!confirm('Discard every content edit and go back to what ROOT ships with?\n\nYour logged days, lists and history are untouched.')) return;
    Config.resetAll(); renderData(); Shell.toast('content reset');
  }
  if (t.dataset.act === 'export-look') exportLook();
  if (t.dataset.act === 'import-look') importLook();
});

/* Preview the theme under the pointer, and put the saved one back on leaving.
   Mouse only: a finger scrolling the gallery fires pointerover on whatever card
   it crosses, and :hover then sticks to the last one it lifted from, so the
   preview was applied and never reverted — the look changed to a theme that
   was neither chosen nor shown as selected. Touch gets no preview; a tap picks. */
const isMouse = e => !e.pointerType || e.pointerType === 'mouse';
view.addEventListener('pointerover', e => {
  if (!isMouse(e)) return;
  const c = e.target.closest && e.target.closest('[data-theme-pick]');
  if (c) Prefs.preview(c.dataset.themePick);
});
view.addEventListener('pointerout', e => {
  if (!isMouse(e)) return;
  const c = e.target.closest && e.target.closest('[data-theme-pick]');
  if (c && !view.querySelector('[data-theme-pick]:hover')) Prefs.revert();
});
view.addEventListener('pointercancel', () => Prefs.revert());

function readoutFor(key, v) {
  const s = Prefs.SCHEMA[key];
  if (key === 'toastMs')       return (v / 1000).toFixed(1) + 's';
  if (key === 'swipeStrength') return Math.round(v * 100) + '% of the width';
  if (key === 'iconStroke')    return v.toFixed(1);
  if (['density','uiScale','textureAmount','chromeAlpha'].includes(key)) return Math.round(v * 100) + '%';
  return v + (s.unit || '');
}

/* Honours the "confirm before clearing" preference — the one place that reads
   it, so turning it off is a real change rather than a decoration. */
function confirmed(msg) { return !Prefs.get('confirmDestructive') || confirm(msg); }

$all('.seg-b').forEach(b => b.addEventListener('click', () => panel(b.dataset.seg)));

/* A content edit changes what the four apps draw; each module re-renders itself
   on its own Config.subscribe. This only keeps the settings screen honest about
   which sections now count as customised. */
Config.subscribe(() => {
  if (currentPanel === 'content') {
    $all('[data-cfg-reset]').forEach(b => {
      const paths = RESET_BUNDLE[b.dataset.cfgReset] || [b.dataset.cfgReset];
      b.classList.toggle('hidden', !paths.some(p => Config.isCustom(p)));
    });
  }
});

Shell.register('settings', { onShow: render });
// a deep link (#settings/data) opens on that panel; anything else on `look`
const linked = Shell.hashTarget();
panel(linked.name === 'settings' && PANELS.includes(linked.sub) ? linked.sub : 'look');

return { panel, render, saveToken, testToken, renderStorage, renderData,
         exportAll, pickImport, importAll, exportLook, importLook,
         reload: () => location.reload() };
})();
