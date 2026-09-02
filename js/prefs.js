/* ── Prefs ────────────────────────────────────────────────────────────────────
   The appearance and behaviour engine. Loaded FIRST, from <head>, before any
   stylesheet — it only ever touches document.documentElement, which exists by
   then, so the whole look is stamped on before the first paint and a non-default
   theme never flashes the default palette.

   How the look is expressed
   ─────────────────────────
   Two mechanisms, deliberately split:

     data-* attributes on <html>    enumerated choices whose effect is more than
                                    one value — a theme, a depth ramp, a texture,
                                    a font pairing. themes.css keys off these.

     inline custom properties       continuous choices — the radius scale, the
                                    border weight, the density multiplier, the UI
                                    scale, a custom accent. Inline wins over any
                                    stylesheet rule, so a dial always beats the
                                    preset it is layered on.

   That is the whole trick behind "the themes decide the look": a preset is not a
   palette swap, it sets the shape, depth, type and density tokens too, and every
   one of those remains individually overridable afterwards.

   Storage key: root_prefs_v1. The legacy root_theme key is read once on first
   run so an existing install keeps its theme.

   Anything here that is NOT appearance (start tab, haptics, date format …) lives
   in the same object under the same API — one place to look, one thing to back
   up. Shell and the app modules read them through Prefs.get(). */
window.Prefs = (function () {
'use strict';

const KEY        = 'root_prefs_v1';
const LEGACY_KEY = 'root_theme';
const root       = document.documentElement;

/* ── Themes ───────────────────────────────────────────────────────────────────
   `mode` drives color-scheme and the address-bar colour. `swatch` is what the
   picker draws: ground, surface, accent, text. `fonts` is the pairing the preset
   asks for; the user's own font choice, if they make one, overrides it. */
const THEMES = [
  // ── dark ──
  { id:'void',      name:'Void',      mode:'dark',  group:'dark',
    desc:'the original — near-black, violet', sw:['#0e0e0e','#161616','#A78BFA','#dedede'] },
  { id:'ember',     name:'Ember',     mode:'dark',  group:'dark',
    desc:'warm charcoal, amber', sw:['#100d0b','#191512','#e8a33d','#e6ded3'] },
  { id:'frost',     name:'Frost',     mode:'dark',  group:'dark',
    desc:'cold slate, cyan', sw:['#0b0f13','#12181e','#5ad4e6','#d6e3ea'] },
  { id:'moss',      name:'Moss',      mode:'dark',  group:'dark',
    desc:'deep forest, chlorophyll green', sw:['#0a0f0c','#111813','#6ee7a0','#d5e5da'] },
  { id:'bloom',     name:'Bloom',     mode:'dark',  group:'dark',
    desc:'plum dusk, rose accent', sw:['#120c11','#1b131a','#f087a8','#ecdde6'] },
  { id:'abyss',     name:'Abyss',     mode:'dark',  group:'dark',
    desc:'midnight navy, electric blue', sw:['#070b14','#0d1320','#6f9bff','#ccd8f0'] },
  { id:'terminal',  name:'Terminal',  mode:'dark',  group:'dark',
    desc:'pure black, phosphor green, hard corners', sw:['#000000','#0a0a0a','#33ff88','#cfe8d8'] },
  { id:'synth',     name:'Synth',     mode:'dark',  group:'dark',
    desc:'neon magenta on indigo, glow on', sw:['#0d0819','#150e26','#ff4ecd','#e5dcf7'] },
  { id:'dune',      name:'Dune',      mode:'dark',  group:'dark',
    desc:'sand over basalt, soft and round', sw:['#14110d','#1d1913','#d9b070','#e9e0d0'] },
  { id:'carbon',    name:'Carbon',    mode:'dark',  group:'dark',
    desc:'brutalist grey, white accent, heavy rules', sw:['#121212','#1a1a1a','#ffffff','#e8e8e8'] },

  // ── light ──
  { id:'paper',     name:'Paper',     mode:'light', group:'light',
    desc:'warm stock, serif display, real shadows', sw:['#f2ede3','#fffdf7','#6b4df0','#22201c'] },
  { id:'linen',     name:'Linen',     mode:'light', group:'light',
    desc:'off-white, olive ink, generous', sw:['#f6f4ef','#ffffff','#5c7a3f','#242420'] },
  { id:'arctic',    name:'Arctic',    mode:'light', group:'light',
    desc:'cool white, glacier blue, crisp', sw:['#f0f4f8','#ffffff','#0f6fd1','#12202c'] },
  { id:'blueprint', name:'Blueprint', mode:'light', group:'light',
    desc:'grid paper, ink lines, technical', sw:['#e8eef4','#f7fafc','#1b4f8f','#10222f'] },
  { id:'noir',      name:'Noir',      mode:'light', group:'light',
    desc:'paper white, black accent, no colour', sw:['#fafafa','#ffffff','#111111','#111111'] },
];

/* Accent swatches offered on top of whatever the preset picked. */
const ACCENTS = [
  { id:'preset', name:'theme',    hex:null },
  { id:'violet', name:'violet',   hex:'#A78BFA' },
  { id:'indigo', name:'indigo',   hex:'#7C8CFF' },
  { id:'blue',   name:'blue',     hex:'#5e8cff' },
  { id:'cyan',   name:'cyan',     hex:'#5ad4e6' },
  { id:'teal',   name:'teal',     hex:'#3fc9b0' },
  { id:'green',  name:'green',    hex:'#5cdb7d' },
  { id:'lime',   name:'lime',     hex:'#b5d94a' },
  { id:'amber',  name:'amber',    hex:'#e8a33d' },
  { id:'orange', name:'orange',   hex:'#f0793a' },
  { id:'red',    name:'red',      hex:'#e06060' },
  { id:'rose',   name:'rose',     hex:'#f0709a' },
  { id:'pink',   name:'pink',     hex:'#ff4ecd' },
  { id:'mono',   name:'mono',     hex:'#d8d8d8' },
];

/* Font pairings. `google` is the family spec appended to one shared Google
   Fonts request; a null means the stack is already on the device. */
const DISPLAY_FONTS = [
  { id:'syne',     name:'Syne',        stack:"'Syne',sans-serif",                          google:'Syne:wght@700;800' },
  { id:'fraunces', name:'Fraunces',    stack:"'Fraunces',Georgia,serif",                   google:'Fraunces:opsz,wght@9..144,600;9..144,800' },
  { id:'grotesk',  name:'Grotesk',     stack:"'Space Grotesk',system-ui,sans-serif",       google:'Space+Grotesk:wght@500;700' },
  { id:'bebas',    name:'Bebas',       stack:"'Bebas Neue',Impact,sans-serif",             google:'Bebas+Neue' },
  { id:'archivo',  name:'Archivo',     stack:"'Archivo',system-ui,sans-serif",             google:'Archivo:wght@600;800' },
  { id:'unbounded',name:'Unbounded',   stack:"'Unbounded',system-ui,sans-serif",           google:'Unbounded:wght@600;800' },
  { id:'system',   name:'System',      stack:"system-ui,-apple-system,'Segoe UI',sans-serif", google:null },
  { id:'mono',     name:'Mono',        stack:"var(--mono)",                                google:null },
];

const MONO_FONTS = [
  { id:'jetbrains', name:'JetBrains', stack:"'JetBrains Mono','Courier New',monospace",  google:'JetBrains+Mono:wght@400;700' },
  { id:'plex',      name:'IBM Plex',  stack:"'IBM Plex Mono','JetBrains Mono',monospace", google:'IBM+Plex+Mono:wght@400;700' },
  { id:'spacemono', name:'Space',     stack:"'Space Mono','JetBrains Mono',monospace",    google:'Space+Mono:wght@400;700' },
  { id:'dm',        name:'DM Mono',   stack:"'DM Mono','JetBrains Mono',monospace",       google:'DM+Mono:wght@400;500' },
  { id:'system',    name:'System',    stack:"ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", google:null },
];

/* What each preset asks for when the user has not chosen a pairing themselves,
   plus the shape/depth character that makes the preset a look rather than a
   repaint. These are applied as data-attributes, so they still lose to an
   explicit user dial. */
const THEME_CHARACTER = {
  void:      { display:'syne',      mono:'jetbrains', radius:4,  border:1, depth:'flat',  texture:'none' },
  ember:     { display:'syne',      mono:'jetbrains', radius:5,  border:1, depth:'flat',  texture:'none' },
  frost:     { display:'grotesk',   mono:'jetbrains', radius:6,  border:1, depth:'soft',  texture:'none' },
  moss:      { display:'grotesk',   mono:'dm',        radius:8,  border:1, depth:'soft',  texture:'none' },
  bloom:     { display:'unbounded', mono:'dm',        radius:14, border:1, depth:'soft',  texture:'none' },
  abyss:     { display:'archivo',   mono:'plex',      radius:6,  border:1, depth:'lift',  texture:'none' },
  terminal:  { display:'mono',      mono:'spacemono', radius:0,  border:1, depth:'flat',  texture:'scan' },
  synth:     { display:'unbounded', mono:'spacemono', radius:2,  border:1, depth:'glow',  texture:'grid' },
  dune:      { display:'fraunces',  mono:'plex',      radius:16, border:1, depth:'soft',  texture:'grain' },
  carbon:    { display:'archivo',   mono:'jetbrains', radius:0,  border:2, depth:'flat',  texture:'none' },
  paper:     { display:'fraunces',  mono:'plex',      radius:12, border:1, depth:'lift',  texture:'grain' },
  linen:     { display:'fraunces',  mono:'dm',        radius:10, border:1, depth:'soft',  texture:'none' },
  arctic:    { display:'grotesk',   mono:'plex',      radius:8,  border:1, depth:'soft',  texture:'none' },
  blueprint: { display:'archivo',   mono:'spacemono', radius:2,  border:1, depth:'flat',  texture:'grid' },
  noir:      { display:'archivo',   mono:'jetbrains', radius:0,  border:1, depth:'flat',  texture:'none' },
};

/* ── Apps ─────────────────────────────────────────────────────────────────────
   Every app the shell can host, in the order they ship. `apps` below is the
   user's own subset and order; the shell builds its slide track and tab bar
   from it, so an app switched off here has no tab and no slide. Settings is
   always last and is not in this list. */
const APPS = ['do', 'log', 'plan', 'store', 'tend', 'track', 'learn'];

/* ── Schema ───────────────────────────────────────────────────────────────────
   Every setting in one table: its default, its kind, and its bounds. The
   settings UI is generated from this, so adding a knob is one line here plus
   whatever CSS reads it. `auto` means "take it from the theme's character". */
const SCHEMA = {
  // appearance — enumerated
  theme:        { kind:'enum',   def:'void',   values:() => THEMES.map(t => t.id), attr:'data-theme' },
  themeMode:    { kind:'enum',   def:'fixed',  values:['fixed','system'] },
  themeDark:    { kind:'enum',   def:'void',   values:() => THEMES.filter(t => t.mode === 'dark').map(t => t.id) },
  themeLight:   { kind:'enum',   def:'paper',  values:() => THEMES.filter(t => t.mode === 'light').map(t => t.id) },
  /* 'custom' is a valid accent alongside the named swatches — it reads its hex
     from accentCustom rather than from the ACCENTS table. */
  accent:       { kind:'enum',   def:'preset', values:() => ACCENTS.map(a => a.id).concat('custom') },
  accentCustom: { kind:'color',  def:'#A78BFA' },
  displayFont:  { kind:'enum',   def:'auto',   values:() => ['auto', ...DISPLAY_FONTS.map(f => f.id)] },
  monoFont:     { kind:'enum',   def:'auto',   values:() => ['auto', ...MONO_FONTS.map(f => f.id)] },
  depth:        { kind:'enum',   def:'auto',   values:['auto','flat','soft','lift','heavy','glow'], attr:'data-depth' },
  texture:      { kind:'enum',   def:'auto',   values:['auto','none','grain','scan','grid','dots'], attr:'data-texture' },
  motion:       { kind:'enum',   def:'full',   values:['full','reduced','none'],       attr:'data-motion' },
  contrast:     { kind:'enum',   def:'normal', values:['normal','more','max'],         attr:'data-contrast' },
  caps:         { kind:'enum',   def:'on',     values:['on','off'],                    attr:'data-caps' },
  navStyle:     { kind:'enum',   def:'pill',   values:['pill','bar','minimal'],        attr:'data-nav' },
  cardStyle:    { kind:'enum',   def:'outline',values:['outline','fill','ghost','line'],attr:'data-cards' },
  accentUse:    { kind:'enum',   def:'normal', values:['subtle','normal','loud'],      attr:'data-accent-use' },
  titleSize:    { kind:'enum',   def:'m',      values:['xs','s','m','l','xl'],         attr:'data-title' },

  // appearance — continuous, written as inline custom properties
  radius:       { kind:'range',  def:null, min:0,   max:24,  step:1,    unit:'px',  cssVar:'--r-base' },
  border:       { kind:'range',  def:null, min:0,   max:3,   step:0.5,  unit:'px',  cssVar:'--bw' },
  density:      { kind:'range',  def:1,    min:0.78,max:1.35,step:0.02,             cssVar:'--dens' },
  uiScale:      { kind:'range',  def:1,    min:0.8, max:1.35,step:0.05,             cssVar:'--ui-scale' },
  iconStroke:   { kind:'range',  def:2,    min:1,   max:3,   step:0.1,              cssVar:'--icon-stroke' },
  chromeAlpha:  { kind:'range',  def:0.82, min:0.35,max:1,   step:0.01,             cssVar:'--chrome-alpha' },
  contentWidth: { kind:'range',  def:780,  min:560, max:1400,step:20,  unit:'px',   cssVar:'--readable' },
  textureAmount:{ kind:'range',  def:1,    min:0,   max:2,   step:0.1,              cssVar:'--tex-mult' },

  // appearance — flags
  showTabLabels:{ kind:'bool',   def:true,  attr:'data-tab-labels' },
  accentGlow:   { kind:'bool',   def:false, attr:'data-glow' },
  monoNumbers:  { kind:'bool',   def:true,  attr:'data-tnum' },
  colorfulTabs: { kind:'bool',   def:false, attr:'data-color-tabs' },

  // navigation — which apps have a tab, and in what order
  apps:         { kind:'list',   def:APPS.slice() },

  // behaviour
  startTab:     { kind:'enum',   def:'last', values:['last', ...APPS, 'settings'] },
  swipe:        { kind:'bool',   def:true },
  swipeStrength:{ kind:'range',  def:0.22, min:0.1, max:0.5, step:0.01 },
  autoHideChrome:{kind:'bool',   def:true },
  haptics:      { kind:'bool',   def:false },
  confirmDestructive:{ kind:'bool', def:true },
  toastMs:      { kind:'range',  def:1800, min:800, max:5000, step:100 },
  keyboardNav:  { kind:'bool',   def:true },
  lockPortrait: { kind:'bool',   def:true,  attr:'data-portrait' },

  // formatting
  dateFormat:   { kind:'enum',   def:'long', values:['long','short','iso'] },
  weekStart:    { kind:'enum',   def:'mon',  values:['mon','sun'] },
  currency:     { kind:'text',   def:'€' },
};

/* ── State ────────────────────────────────────────────────────────────────── */
let prefs = {};
const subs = [];

function defaultsOf() {
  const o = {};
  // arrays are copied so a list pref never aliases the schema's own default
  Object.keys(SCHEMA).forEach(k => { const d = SCHEMA[k].def; o[k] = Array.isArray(d) ? d.slice() : d; });
  return o;
}

function load() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  prefs = Object.assign(defaultsOf(), stored);
  // first run on an install that only ever knew the old four themes
  if (!stored.theme) {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && THEMES.some(t => t.id === legacy)) prefs.theme = legacy;
    } catch {}
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  // keep the pre-2.0 key in step; the standalone apps still read it
  try { localStorage.setItem(LEGACY_KEY, activeTheme()); } catch {}
}

function get(k)  { return prefs[k]; }
function all()   { return Object.assign({}, prefs); }

function set(k, v) {
  if (!(k in SCHEMA)) return;
  prefs[k] = coerce(k, v);
  persist();
  apply();
  notify(k);
}
function setMany(obj) {
  Object.keys(obj).forEach(k => { if (k in SCHEMA) prefs[k] = coerce(k, obj[k]); });
  persist(); apply(); notify('*');
}

function coerce(k, v) {
  const s = SCHEMA[k];
  if (!s) return v;
  if (s.kind === 'bool')  return !!v;
  if (s.kind === 'range') {
    if (v === null || v === '' || v === undefined) return s.def;
    const n = parseFloat(v);
    if (!isFinite(n)) return s.def;
    return Math.min(s.max, Math.max(s.min, n));
  }
  if (s.kind === 'enum') {
    const vals = typeof s.values === 'function' ? s.values() : s.values;
    return vals.includes(v) ? v : s.def;
  }
  /* the app list: known ids only, no duplicates, never empty — a pasted look
     that names an app this build does not have simply loses that entry */
  if (s.kind === 'list') {
    if (!Array.isArray(v)) return s.def.slice();
    const out = v.filter((x, i, a) => APPS.includes(x) && a.indexOf(x) === i);
    return out.length ? out : s.def.slice();
  }
  // a pasted "look" can carry anything; keep text and colour well-formed
  if (s.kind === 'text')  return String(v ?? '').slice(0, 8) || s.def;
  if (s.kind === 'color') return normHex(v);
  return v;
}

function reset(k) {
  if (k in SCHEMA) { prefs[k] = defaultsOf()[k]; persist(); apply(); notify(k); }
}
function resetAll() { prefs = defaultsOf(); persist(); apply(); notify('*'); }

function subscribe(fn) { if (typeof fn === 'function') subs.push(fn); }
function notify(k) { subs.forEach(fn => { try { fn(k); } catch (e) { console.error(e); } }); }

/* ── Derived ──────────────────────────────────────────────────────────────── */
const prefersDark = () => {
  try { return !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches; }
  catch { return true; }
};

/* Which preset is actually on screen right now. In `system` mode the two chosen
   presets take turns; in `fixed` mode it is simply `theme`. */
function activeTheme() {
  if (prefs.themeMode === 'system') return prefersDark() ? prefs.themeDark : prefs.themeLight;
  return prefs.theme;
}
function themeInfo(id) { return THEMES.find(t => t.id === (id || activeTheme())) || THEMES[0]; }
function character(id) { return THEME_CHARACTER[id || activeTheme()] || THEME_CHARACTER.void; }

function accentHex() {
  if (prefs.accent === 'preset') return null;               // let the theme's own accent stand
  if (prefs.accent === 'custom') return normHex(prefs.accentCustom);
  const a = ACCENTS.find(x => x.id === prefs.accent);
  return a && a.hex ? a.hex : null;
}

/* ── Colour helpers ───────────────────────────────────────────────────────── */
function normHex(h) {
  if (typeof h !== 'string') return '#A78BFA';
  let s = h.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : '#A78BFA';
}
function rgbOf(hex) {
  const s = normHex(hex).slice(1);
  return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
}
/* WCAG relative luminance — used only to decide whether text drawn ON the accent
   should be the theme's ground or its foreground. */
function luminance(hex) {
  const [r,g,b] = rgbOf(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
const rgba = (hex, a) => { const [r,g,b] = rgbOf(hex); return `rgba(${r},${g},${b},${a})`; };

/* ── Font loading ─────────────────────────────────────────────────────────────
   One <link> for every face the current look needs, rebuilt whenever the pairing
   changes. Families already requested are not re-requested: the href is compared
   before the element is touched, so switching between two themes that share a
   face costs nothing. */
function resolvedDisplay() {
  const id = prefs.displayFont === 'auto' ? character().display : prefs.displayFont;
  return DISPLAY_FONTS.find(f => f.id === id) || DISPLAY_FONTS[0];
}
function resolvedMono() {
  const id = prefs.monoFont === 'auto' ? character().mono : prefs.monoFont;
  return MONO_FONTS.find(f => f.id === id) || MONO_FONTS[0];
}

let fontLink = null;
function loadFonts() {
  const fams = [resolvedDisplay().google, resolvedMono().google].filter(Boolean);
  // both faces on the device: drop the link outright. Setting href to '' does
  // not blank it — it resolves to the page itself, which is then fetched as a
  // stylesheet.
  if (!fams.length) { if (fontLink) { fontLink.remove(); fontLink = null; } return; }
  const href = 'https://fonts.googleapis.com/css2?' +
               fams.map(f => 'family=' + f).join('&') + '&display=swap';
  if (!fontLink) {
    fontLink = document.getElementById('root-fonts');
    if (!fontLink) {
      fontLink = document.createElement('link');
      fontLink.id = 'root-fonts';
      fontLink.rel = 'stylesheet';
      document.head.appendChild(fontLink);
    }
  }
  if (fontLink.href !== href) fontLink.href = href;
}

/* ── Apply ────────────────────────────────────────────────────────────────────
   The single place that writes to the DOM. Called on boot, on every set(), and
   when the OS colour scheme flips while `themeMode` is `system`. */
function apply() {
  const id   = activeTheme();
  const info = themeInfo(id);
  const ch   = character(id);
  const st   = root.style;

  // enumerated → attributes
  root.setAttribute('data-theme', id);
  root.setAttribute('data-mode',  info.mode);
  root.setAttribute('data-depth',   prefs.depth   === 'auto' ? ch.depth   : prefs.depth);
  root.setAttribute('data-texture', prefs.texture === 'auto' ? ch.texture : prefs.texture);
  root.setAttribute('data-motion',  prefs.motion);
  root.setAttribute('data-contrast',prefs.contrast);
  root.setAttribute('data-caps',    prefs.caps);
  root.setAttribute('data-nav',     prefs.navStyle);
  root.setAttribute('data-cards',   prefs.cardStyle);
  root.setAttribute('data-accent-use', prefs.accentUse);
  root.setAttribute('data-title',      prefs.titleSize);
  root.setAttribute('data-tab-labels', prefs.showTabLabels ? 'on' : 'off');
  root.setAttribute('data-glow',       prefs.accentGlow    ? 'on' : 'off');
  root.setAttribute('data-tnum',       prefs.monoNumbers   ? 'on' : 'off');
  root.setAttribute('data-color-tabs', prefs.colorfulTabs  ? 'on' : 'off');
  root.setAttribute('data-portrait', prefs.lockPortrait ? 'lock' : 'free');
  root.style.colorScheme = info.mode;

  // continuous → inline custom properties (null means "leave it to the theme")
  const radius = prefs.radius === null ? ch.radius : prefs.radius;
  const border = prefs.border === null ? ch.border : prefs.border;
  st.setProperty('--r-base',     radius + 'px');
  st.setProperty('--bw',         border + 'px');
  st.setProperty('--dens',        prefs.density);
  st.setProperty('--ui-scale',    prefs.uiScale);
  st.setProperty('--icon-stroke', prefs.iconStroke);
  // only claim the icons once the dial has actually been moved — see tokens.css
  root.setAttribute('data-icon-stroke',
    prefs.iconStroke === SCHEMA.iconStroke.def ? 'sprite' : 'custom');
  st.setProperty('--chrome-alpha',prefs.chromeAlpha);
  st.setProperty('--readable',    prefs.contentWidth + 'px');
  st.setProperty('--tex-mult',    prefs.textureAmount);

  // accent
  const acc = accentHex();
  /* Only the accent itself and the colour drawn on top of it: tokens.css mixes
     the three washes out of --y, so they follow automatically. */
  if (acc) {
    st.setProperty('--y', acc);
    st.setProperty('--on-y', luminance(acc) > 0.45 ? '#0b0b0b' : '#ffffff');
  } else {
    st.removeProperty('--y');
    st.removeProperty('--on-y');
  }

  // fonts
  const d = resolvedDisplay(), m = resolvedMono();
  st.setProperty('--mono', m.stack);
  st.setProperty('--head', d.stack);

  loadFonts();

  // native reduced-motion always wins over a "full" preference
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        prefs.motion === 'full') root.setAttribute('data-motion', 'reduced');
  } catch {}

  // address bar / status bar
  requestAnimationFrame(() => {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bg) meta.setAttribute('content', bg);
  });
}

/* Preview a theme without saving it — used by the picker so hovering a card
   shows the real thing. revert() puts the saved look back. */
function preview(id) {
  const info = THEMES.find(t => t.id === id);
  if (!info) return;
  root.setAttribute('data-theme', id);
  // the light-mode corrections and the form controls' colour scheme key off
  // the mode, so a light preset previewed from a dark one needs both to move
  root.setAttribute('data-mode', info.mode);
  root.style.colorScheme = info.mode;
  const ch = THEME_CHARACTER[id];
  if (prefs.radius === null) root.style.setProperty('--r-base', ch.radius + 'px');
  if (prefs.border === null) root.style.setProperty('--bw', ch.border + 'px');
  if (prefs.depth === 'auto')   root.setAttribute('data-depth', ch.depth);
  if (prefs.texture === 'auto') root.setAttribute('data-texture', ch.texture);
}
const revert = apply;

/* ── Haptics ──────────────────────────────────────────────────────────────────
   A no-op wherever the Vibration API is missing (every iOS browser), which is
   why it is off by default rather than advertised as working. */
function tap(ms = 8) {
  if (!prefs.haptics) return;
  try { navigator.vibrate && navigator.vibrate(ms); } catch {}
}

/* ── Formatting helpers, so the four modules format dates the same way ────── */
function formatDate(iso, style) {
  const s = style || prefs.dateFormat;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  if (s === 'iso')   return iso;
  if (s === 'short') return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
  return d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */
load();
apply();

// follow the OS when asked to
try {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onFlip = () => { if (prefs.themeMode === 'system') { apply(); notify('theme'); } };
  mq.addEventListener ? mq.addEventListener('change', onFlip) : mq.addListener(onFlip);
} catch {}

return { THEMES, ACCENTS, DISPLAY_FONTS, MONO_FONTS, SCHEMA, THEME_CHARACTER, APPS,
         get, set, setMany, all, reset, resetAll, subscribe,
         apply, preview, revert, activeTheme, themeInfo, character,
         resolvedDisplay, resolvedMono, accentHex, normHex, luminance,
         tap, formatDate, KEY };
})();
