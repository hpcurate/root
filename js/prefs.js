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
  /* 2.25 — six more. Chosen to widen the *range* rather than lengthen the list:
     a condensed grotesque, a geometric, a slab, a high-contrast serif, a
     rounded face and an editorial one, so the wordmark can be narrow, friendly
     or literary rather than five shades of the same sans. Weights are the two
     the app uses (700/800, or the nearest a face has) — a face is not worth
     offering at a weight the titles cannot render. */
  { id:'oswald',   name:'Oswald',      stack:"'Oswald',Impact,sans-serif",                 google:'Oswald:wght@600;700' },
  { id:'poppins',  name:'Poppins',     stack:"'Poppins',system-ui,sans-serif",             google:'Poppins:wght@600;800' },
  { id:'chivo',    name:'Chivo',       stack:"'Chivo',system-ui,sans-serif",               google:'Chivo:wght@700;900' },
  { id:'playfair', name:'Playfair',    stack:"'Playfair Display',Georgia,serif",           google:'Playfair+Display:wght@700;900' },
  { id:'nunito',   name:'Nunito',      stack:"'Nunito',system-ui,sans-serif",              google:'Nunito:wght@700;900' },
  { id:'dmserif',  name:'DM Serif',    stack:"'DM Serif Display',Georgia,serif",           google:'DM+Serif+Display' },
  { id:'system',   name:'System',      stack:"system-ui,-apple-system,'Segoe UI',sans-serif", google:null },
  { id:'mono',     name:'Mono',        stack:"var(--mono)",                                google:null },
];

const MONO_FONTS = [
  { id:'jetbrains', name:'JetBrains', stack:"'JetBrains Mono','Courier New',monospace",  google:'JetBrains+Mono:wght@400;700' },
  { id:'plex',      name:'IBM Plex',  stack:"'IBM Plex Mono','JetBrains Mono',monospace", google:'IBM+Plex+Mono:wght@400;700' },
  { id:'spacemono', name:'Space',     stack:"'Space Mono','JetBrains Mono',monospace",    google:'Space+Mono:wght@400;700' },
  { id:'dm',        name:'DM Mono',   stack:"'DM Mono','JetBrains Mono',monospace",       google:'DM+Mono:wght@400;500' },
  /* 2.25 — three more, again for range: a wide typewriter face, a narrow one
     for dense screens, and a humanist that is easier to read at 9px than any
     of the geometric ones above. */
  { id:'courier',   name:'Courier',   stack:"'Courier Prime','Courier New',monospace",    google:'Courier+Prime:wght@400;700' },
  { id:'redhat',    name:'Red Hat',   stack:"'Red Hat Mono','JetBrains Mono',monospace",  google:'Red+Hat+Mono:wght@400;700' },
  { id:'sourcemono',name:'Source',    stack:"'Source Code Pro','JetBrains Mono',monospace", google:'Source+Code+Pro:wght@400;700' },
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
const APPS = ['do', 'log', 'plan', 'store', 'tend', 'track', 'learn', 'cal', 'create'];

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
  /* The bar's own motion, kept when everything else is switched off. Only does
     anything at Motion: none — see tokens.css. */
  navMotion:    { kind:'bool',   def:false, attr:'data-nav-motion' },
  contrast:     { kind:'enum',   def:'normal', values:['normal','more','max'],         attr:'data-contrast' },
  caps:         { kind:'enum',   def:'on',     values:['on','off'],                    attr:'data-caps' },
  navStyle:     { kind:'enum',   def:'pill',   values:['pill','bar','minimal'],        attr:'data-nav' },
  /* The three things the tab bar's active indicator can be asked about, kept
     apart because they are three questions and not one: what shape the mark
     around the tab is, how it arrives, and — once `colorfulTabs` is on — which
     set of hues the tabs wear. `colorfulTabs` stays the gate it always was, so
     an install that had colour-coded tabs before still has them, in the palette
     it already had (`app`). */
  navShape:     { kind:'enum',   def:'pill',   values:['pill','round','square','circle','ring','under'],
                                                                                attr:'data-nav-shape' },
  navAnim:      { kind:'enum',   def:'grow',   values:['grow','pop','fade','rise','none'], attr:'data-nav-anim' },
  tabPalette:   { kind:'enum',   def:'app',    values:['app','warm','cool','candy','neon','mono'],
                                                                                attr:'data-tab-palette' },
  cardStyle:    { kind:'enum',   def:'outline',values:['outline','fill','ghost','line'],attr:'data-cards' },
  accentUse:    { kind:'enum',   def:'normal', values:['subtle','normal','loud'],      attr:'data-accent-use' },
  titleSize:    { kind:'enum',   def:'m',      values:['xs','s','m','l','xl'],         attr:'data-title' },
  /* The sticky sub-screen header's title, on its own steps. Deliberately not
     the same dial as the wordmark: the wordmark is glanced at on the way past,
     this one is read at arm's length for as long as you are on that screen,
     and wanting one big and the other small is a real thing to want. Its box
     is derived from it, so a larger title gets a taller header (tokens.css). */
  hdTitleSize:  { kind:'enum',   def:'m',      values:['xs','s','m','l','xl'],         attr:'data-hd-title' },

  // appearance — continuous, written as inline custom properties
  /* How fast the motion runs, on top of whichever preset is picked. Stored as
     a *speed* because that is what it is called and what the readout says;
     --mo is a duration multiplier, so apply() writes 1/speed. */
  motionSpeed:  { kind:'range',  def:1,    min:0.5, max:3,   step:0.1 },
  radius:       { kind:'range',  def:null, min:0,   max:24,  step:1,    unit:'px',  cssVar:'--r-base' },
  border:       { kind:'range',  def:null, min:0,   max:3,   step:0.5,  unit:'px',  cssVar:'--bw' },
  density:      { kind:'range',  def:1,    min:0.78,max:1.35,step:0.02,             cssVar:'--dens' },
  iconStroke:   { kind:'range',  def:2,    min:1,   max:3,   step:0.1,              cssVar:'--icon-stroke' },
  chromeAlpha:  { kind:'range',  def:0.82, min:0.35,max:1,   step:0.01,             cssVar:'--chrome-alpha' },
  contentWidth: { kind:'range',  def:780,  min:560, max:1400,step:20,  unit:'px',   cssVar:'--readable' },
  textureAmount:{ kind:'range',  def:1,    min:0,   max:2,   step:0.1,              cssVar:'--tex-mult' },

  // appearance — flags
  showTabLabels:{ kind:'bool',   def:true,  attr:'data-tab-labels' },
  accentGlow:   { kind:'bool',   def:false, attr:'data-glow' },
  monoNumbers:  { kind:'bool',   def:true,  attr:'data-tnum' },
  colorfulTabs: { kind:'bool',   def:false, attr:'data-color-tabs' },
  chromeBlur:   { kind:'bool',   def:true,  attr:'data-chrome-blur' },
  /* The explanatory text under a control — the paragraph over a settings
     section and the grey line under a switch. On once, while the app is
     new; off once you know what everything does, and the panels halve in
     length. One attribute, so it reaches every hint at once and any future
     one for free. */
  tips:         { kind:'bool',   def:true,  attr:'data-tips' },

  // navigation — which apps have a tab, and in what order
  apps:         { kind:'list',   def:APPS.slice() },
  /* Every app this install has ever been offered. Not a setting — there is no
     control for it — but it lives here so it is stored, exported and restored
     with the rest. See the note on load(): it is what tells a brand-new app
     apart from one the user switched off. */
  appsSeen:     { kind:'list',   def:APPS.slice() },
  /* Not a setting and there is no control for it — it records that the 2.26.0
     Spacing fold has been undone, so the repair runs once. Stored, exported and
     restored with the rest, like `appsSeen`. */
  densRepair:   { kind:'bool',   def:false },

  // behaviour
  startTab:     { kind:'enum',   def:'last', values:['last', ...APPS, 'settings'] },
  swipe:        { kind:'bool',   def:true },
  swipeStrength:{ kind:'range',  def:0.22, min:0.1, max:0.5, step:0.01 },
  autoHideChrome:{kind:'bool',   def:true },
  haptics:      { kind:'bool',   def:false },
  confirmDestructive:{ kind:'bool', def:true },
  /* The in-app numpad on fields that only take a number. `auto` means "where
     the keyboard is a virtual one" — a laptop's number field is fine as it is,
     and a pad sheet over every settings dial there would be in the way. */
  numpad:       { kind:'enum',   def:'auto', values:['auto','always','off'] },
  toastMs:      { kind:'range',  def:1800, min:800, max:5000, step:100 },
  keyboardNav:  { kind:'bool',   def:true },
  lockPortrait: { kind:'bool',   def:true,  attr:'data-portrait' },

  // formatting
  dateFormat:   { kind:'enum',   def:'long', values:['long','short','iso'] },
  weekStart:    { kind:'enum',   def:'mon',  values:['mon','sun'] },
  currency:     { kind:'text',   def:'€' },

  /* CAL. `calHour` is the one place a pixel is a setting rather than a token:
     it is how tall an hour is drawn, which is a dial, not a shape. */
  calHour:      { kind:'range',  def:56,  min:28, max:120, step:4, unit:'px / hour' },
  calShowFixed: { kind:'bool',   def:true },
  calShowIdle:  { kind:'bool',   def:true },
  calCalNames:  { kind:'bool',   def:false },
  calAhead:     { kind:'range',  def:7,   min:1,  max:21,  step:1, unit:' days' },
  calKeep:      { kind:'range',  def:60,  min:7,  max:365, step:1, unit:' days' },
  /* The stepper is a wide bar across the bottom now, so it covers more of the
     day than the pill did: it steps aside on its own once you stop using it.
     0 pins it. */
  calStepsHide: { kind:'range',  def:5,   min:0,  max:30,  step:1, unit:'s idle' },
  /* Colour on the rows themselves, not only on the 3px rail. Two dials rather
     than one because the two kinds of row answer different questions: a block
     is work you chose and put somewhere, a template row is the shape of the
     day. Washing both at once is a rainbow; washing one is a highlight. */
  calColorBlocks:{ kind:'bool',  def:false },
  calColorOther: { kind:'bool',  def:false },
  /* LOG's morning wake-up time moves the day. Off keeps the day exactly as
     PLAN exported it. See CAL.setWake(). */
  calWakeShift: { kind:'bool',   def:true },

  /* DO's routine cards. `doHideDone` drops a finished routine off the grid
     rather than greying it; `doCardStyle` is how much of a card is drawn. */
  doHideDone:   { kind:'bool',   def:false },
  doCardStyle:  { kind:'enum',   def:'full', values:['full','minimal'] },
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

/* The apps an install was offered before `appsSeen` existed. A one-time
   migration constant, not a list to keep up to date: every install that boots
   from here on stores its own `appsSeen`, so this is read once per install and
   then never again. */
const APPS_BEFORE_SEEN = ['do', 'log', 'plan', 'store', 'tend', 'track', 'learn'];

/* ── A new app has to arrive on an install that already has an app list ───────
   `apps` is stored whole and replaces the default whole — the same rule Config
   uses for a branch — so an app added in a later version has no tab on any
   install that has ever opened the layout panel, which is every install that
   has been used. CAL would have shipped invisible, and an invisible tab is the
   one bug a new tab can actually have.

   `appsSeen` is what tells the two cases apart. An app in APPS this install has
   never been offered is *new*: it goes in, in its shipped position. An app
   missing from `apps` but present in `appsSeen` was switched off deliberately
   and stays off. The result is persisted immediately — without that, switching
   the new app straight back off would be undone on the next boot. */
function adoptNewApps(stored) {
  if (!Array.isArray(prefs.apps) || !prefs.apps.length) prefs.apps = APPS.slice();
  const seen  = Array.isArray(stored.appsSeen) ? stored.appsSeen : APPS_BEFORE_SEEN;
  const fresh = APPS.filter(a => !seen.includes(a));
  prefs.appsSeen = APPS.slice();
  if (!fresh.length) return fresh;
  // rebuilt from APPS so a new app lands where it ships, not on the end
  prefs.apps = APPS.filter(a => prefs.apps.includes(a) || fresh.includes(a));
  persist();
  return fresh;
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
  adoptNewApps(stored);
  dropUiScale(stored);
}

/* ── Interface scale, retired ─────────────────────────────────────────────────
   It was `zoom` on the root element, and document zoom multiplies every length
   in the page by a fraction — so at any value but 1 the app's whole-pixel type
   (8, 9.5, 10, 11.5, 15, 54) became fractional and every glyph in the app was
   resampled rather than drawn. That is what five reports of "the top of the
   sticky title is blurred" were, and why four correct rendering fixes each
   changed nothing: none of them was touching it. See the note in tokens.css.

   **2.26.0 folded a stored scale into Spacing, and that was wrong.** `--dens`
   multiplies every padding and gap in the app (`calc(18px * var(--dens))`), so
   at 1.1 an 18px padding becomes 19.8px and every box below it starts on a
   fractional offset — which puts the text inside it on a fractional baseline
   and softens it. It is the *same defect the retirement was meant to remove*,
   moved from one multiplier to another, and it was worse than the original
   because there was no longer a dial to put back to 100%.

   So the scale is now simply dropped, and an install that 2.26.0 folded is
   repaired: Spacing goes back to its default once, recorded so it happens once
   and never touches a later deliberate choice. Anyone who had genuinely set
   Spacing before 2.26.0 loses that one setting a single time, which is the
   right trade against leaving the app permanently soft. */
function dropUiScale(stored) {
  delete prefs.uiScale;
  if (stored.uiScale === undefined && prefs.densRepair) return;
  /* 2.26.0 is the only build that wrote a folded density, and it always wrote
     `uiScale` away in the same pass — so a stored density with no stored
     uiScale beside it, on an install that has not been repaired yet, is either
     that fold or a deliberate choice. Both go back to the default: a soft app
     is not worth preserving either of them. */
  if (!prefs.densRepair) {
    prefs.density = SCHEMA.density.def;
    prefs.densRepair = true;
    persist();
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
  root.setAttribute('data-nav-shape',   prefs.navShape);
  root.setAttribute('data-nav-anim',    prefs.navAnim);
  root.setAttribute('data-tab-palette', prefs.tabPalette);
  root.setAttribute('data-cards',   prefs.cardStyle);
  root.setAttribute('data-accent-use', prefs.accentUse);
  root.setAttribute('data-title',      prefs.titleSize);
  root.setAttribute('data-hd-title',   prefs.hdTitleSize);
  root.setAttribute('data-tab-labels', prefs.showTabLabels ? 'on' : 'off');
  root.setAttribute('data-glow',       prefs.accentGlow    ? 'on' : 'off');
  root.setAttribute('data-tnum',       prefs.monoNumbers   ? 'on' : 'off');
  root.setAttribute('data-color-tabs', prefs.colorfulTabs  ? 'on' : 'off');
  root.setAttribute('data-chrome-blur', prefs.chromeBlur   ? 'on' : 'off');
  root.setAttribute('data-tips',        prefs.tips         ? 'on' : 'off');
  root.setAttribute('data-nav-motion',  prefs.navMotion    ? 'on' : 'off');
  root.setAttribute('data-portrait', prefs.lockPortrait ? 'lock' : 'free');
  root.style.colorScheme = info.mode;

  // continuous → inline custom properties (null means "leave it to the theme")
  const radius = prefs.radius === null ? ch.radius : prefs.radius;
  const border = prefs.border === null ? ch.border : prefs.border;
  st.setProperty('--r-base',     radius + 'px');
  st.setProperty('--bw',         border + 'px');
  st.setProperty('--dens',        prefs.density);
  st.setProperty('--icon-stroke', prefs.iconStroke);
  // only claim the icons once the dial has actually been moved — see tokens.css
  root.setAttribute('data-icon-stroke',
    prefs.iconStroke === SCHEMA.iconStroke.def ? 'sprite' : 'custom');
  /* Speed in, duration multiplier out: 2× fast is half as long. Clamped away
     from zero so a pasted look carrying nonsense cannot divide by it. */
  const speed = Math.max(.1, +prefs.motionSpeed || 1);
  st.setProperty('--mo-scale', String(Math.round((1 / speed) * 1000) / 1000));
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
