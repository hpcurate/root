# ROOT — manifest

> **Read this before editing anything in `root/`, and update the Changelog at the
> bottom in the same commit as every change. No exceptions, including one-line
> fixes.** This file is the map; if it goes stale it is worse than nothing.

---

## 1. What ROOT is

Four small single-purpose tools that share one phone, one frame and one set of
storage keys. It is a static site — no build step, no framework, no dependencies,
no network except the Todoist calls you explicitly ask for. Open `index.html`
over http(s) and it runs.

| Tab       | Does                                                                   |
| --------- | ---------------------------------------------------------------------- |
| **DO**    | Daily routine checklists + travel packing lists. Closes finished routines in Todoist. |
| **LOG**   | Morning/evening daily log → an Obsidian-shaped `.md` note, plus history and weekly/monthly reports. |
| **PLAN**  | Builds a queue of tasks against a project/section tree, then pushes the batch to Todoist. |
| **STORE** | Grocery list with auto-categorisation, an in-store spend counter, premade meals, trip history. |
| **Settings** | Nine panels: the whole appearance engine, behaviour, and editors for all four apps' content. |

### The vision (2.0)

ROOT 1.0 was four apps merged into one shell. The shell was shared; almost
nothing else was. Personal data — routine items, block names, aisle vocabulary,
project trees — sat inside program logic, and the four "themes" could only
repaint a layout whose shape was hardcoded in five stylesheets.

**2.0 separates the three things that were tangled together:**

```
       CONTENT                  APPEARANCE                 BEHAVIOUR
   what the app is about     what the app looks like    how the app responds
   ────────────────────      ──────────────────────     ─────────────────────
      js/config.js               js/prefs.js               js/prefs.js
   editable in Settings       15 presets + 39 dials      one delegated reader
   → content panel            → look / layout panels     → behave panel
```

Nothing that is personal to one person is written into program logic any more.
The default content is still Hugo's, but it is *data with a default*, not a
constant — so ROOT is now a thing someone else could pick up, or that its owner
can reshape entirely without touching a line of code.

Two rules that fall out of the vision, and that every future change must respect:

1. **A theme sets the whole character, not just the palette.** Corner radius,
   border weight, depth, texture and the type pairing are all part of a preset.
   That is only possible because the app stylesheets reference tokens rather than
   literal pixel values — see §4.
2. **The export format is a contract.** LOG's `.md` output is parsed by an
   Obsidian workflow. Field *names* in the day record and in the exported table
   are never user-editable and never renamed. Everything the user *sees* is.

---

## 2. Files

```
root/
├── ROOT.md            this file — read first, update last
├── index.html         all markup for all five views + the icon sprite
├── favicon.png
├── manifest.webmanifest   installable on Android/Chrome; iOS reads the apple-* metas
├── test/
│   ├── harness.mjs    jsdom boot + behaviour checks — see §7
│   └── package.json   its one dev dependency (jsdom); not part of the site
├── css/
│   ├── tokens.css     the token system + every global consequence of a dial
│   ├── themes.css     15 presets, depth ramps, card treatments, nav variants
│   ├── do.css         ┐
│   ├── log.css        │ per-app sheets, each scoped to its .ns-* namespace
│   ├── plan.css       │
│   ├── store.css      ┘
│   ├── shell.css      the frame: slide track, floating chrome, responsive rules
│   └── settings.css   the settings view
└── js/
    ├── prefs.js       appearance + behaviour engine   (loaded from <head>)
    ├── config.js      the content layer
    ├── shell.js       Creds, Shell, the slide track, swipe, keyboard
    ├── do.js  log.js  plan.js  store.js
    └── settings.js    the settings view
```

### Load order — this is load-bearing

```
<head>   prefs.js          stamps the look on <html> before the first paint
         tokens.css → do → log → plan → store → shell → settings → themes.css
<body>   config.js         content exists before any app reads it
         shell.js          defines Creds + Shell.toast, used by every module
         do / log / plan / store
         settings.js       needs every module to exist to render its panels
```

`themes.css` is last so its `[data-theme]` overrides beat the app sheets on equal
specificity. `settings.css` is after `shell.css` for the same reason.

---

## 3. Architecture

### Namespacing

Each app is one IIFE published as `window.DO` / `LOG` / `PLAN` / `STORE`, and
each does its DOM lookups through a scoped helper:

```js
const SCOPE = '.ns-do ';
const $id = id => document.querySelector(SCOPE + '#' + id);
```

All four apps use ids like `#s-home` and `#td-project`. The `.ns-*` prefix is
what keeps them from colliding. **Never query the document unscoped from inside
an app module.** Inline `onclick` handlers therefore read `DO.go(...)`, not
`go(...)`.

Any *user-editable* value that is interpolated into an inline handler —
`onclick="LOG.toggleBlock(this,'…')"` — goes through the module's `attr()`,
which escapes it as a JS string literal and then as an HTML attribute. `esc()`
alone is not enough: a block called `it's` was a syntax error in every handler
on the evening form.

### What the shell gives every module

```js
Shell.toast(msg)                       // the one toast
Shell.today()                          // local YYYY-MM-DD — the only definition of "today"
Shell.confirm(msg)                     // window.confirm, unless "confirm before clearing" is off
Shell.settings(panel)                  // jump to a settings panel ('general' still maps to 'data')
Shell.register(name, { onShow, onDayChange })
```

`onShow` fires on every visit to the tab. `onDayChange(iso)` fires when the
calendar day changes while the app is open — the shell checks on
`visibilitychange`, on window focus, on every tab change and once a minute.
DO moves to the new day's record; LOG moves its selected day only if it was
"today" and no form is open (an evening written at 00:10 belongs to the day
that just ended). Nothing else captures "today" at boot any more.

Routes: `#do` … `#settings` pick a tab; `#settings/<panel>` lands on one
settings panel and is kept in the address bar as you switch panels.

### The slide track

`#track` is a five-slide flexbox moved with a transform. Each `.view` is its own
scroll container, so every tab remembers where you left it. **Nothing
`position:fixed` may live inside `#track`** — a transformed ancestor becomes the
containing block for fixed descendants. The toast, the nav, the LOG modal and all
the sheets are siblings of `#views` for exactly that reason.

### Prefs — the appearance engine

Two mechanisms, deliberately split:

| Mechanism | Used for | Wins over |
| --- | --- | --- |
| `data-*` attributes on `<html>` | enumerated choices whose effect is more than one value (theme, depth ramp, texture, nav style) | stylesheet defaults |
| inline custom properties on `<html>` | continuous choices (radius, border weight, density, scale, custom accent) | *everything*, including the preset |

So a preset can set a whole character and each part of it stays individually
overridable. `Prefs.apply()` is the only function that writes to the DOM.

A preset's character (its default radius, border, depth, texture and font
pairing) lives in `THEME_CHARACTER` in `prefs.js`, **not** in `themes.css`. The
stylesheet holds only colours. This is why adding a theme is ~12 colour values
plus one line of character.

Loaded from `<head>`, before the stylesheets, so nothing flashes on a cold start.
It touches only `document.documentElement`, never `document.body`.

### Config — the content layer

```js
Config.get(path)        // merged: user override if present, else the shipped default
Config.set(path, value) // persist an override and notify subscribers
Config.reset(path)      // drop the override
Config.isCustom(path)   // has this branch been overridden?
Config.subscribe(fn)    // fn(path) after any set / reset / import
```

Overrides are stored **whole-branch, not deep-merged**. Deep-merging a user's
edits into a shipped list makes deletion impossible to express, and deletion is
the one thing an editor must be able to do. Only overrides are persisted, so an
untouched install stores nothing at all.

`get()` returns a structured copy — a caller mutating what it got back cannot
corrupt `DEFAULTS` or the override tree.

Every app module subscribes and re-renders on a matching path:

```js
Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('do.')) return;
  readConfig(); renderTabs(); renderHome();
});
```

### Settings — two conventions, no per-control wiring

1. **Appearance and behaviour controls** carry `data-pref="<key>"` and are handled
   by one delegated listener. Adding a control is markup, not wiring.
2. **Content editors** live inside a `[data-group="<config path>"]` and are read
   back out of the DOM *wholesale* by that group's `read()`. No per-field state is
   tracked, so an editor cannot drift out of step with what is saved.

To add a knob: one line in `Prefs.SCHEMA`, one builder call in the panel, and
whatever CSS reads the attribute or variable.
To add a content editor: one entry in `EDITORS` with `render()` / `read()` /
optionally `add()` / `del()`, and its path in `EDITOR_ORDER`.

---

## 4. The token system

`--r-base` is the single shape anchor; every radius is a ratio of it.

```css
--r-base:4px;                        /* a preset sets it; the Corners dial overrides */
--r1:calc(var(--r-base) * .75);      /* controls, rows, inputs */
--r2:var(--r-base);                  /* cards */
--r3:calc(var(--r-base) * 1.75);     /* segmented controls, tiles */
--r-sheet:calc(var(--r-base) * 2.5);
```

The four app stylesheets were **mechanically normalised** in 2.0 so the tokens
actually reach them:

| was | became |
| --- | --- |
| `border-radius:4px` | `border-radius:var(--r2)` |
| `1px solid var(--bd)` | `var(--bw) solid var(--bd)` |
| `padding:18px` | `padding:calc(18px * var(--dens))` |

**When you write new CSS in an app sheet, follow the same rule.** A literal
`4px` radius is a bug: it makes one control immune to the whole theme system.

Other anchors, and the single rule that makes each dial real:

| Token | Dial | Where it bites |
| --- | --- | --- |
| `--bw` | Border weight | every `var(--bw) solid` |
| `--dens` | Spacing | every padding/gap in the app sheets |
| `--ui-scale` | Interface scale | `html{zoom:var(--ui-scale)}` — native, scales boxes, text, borders and fixed positioning together |
| `--icon-stroke` | Icon weight | CSS beats the sprite's `stroke-width` presentation attribute — but gated on `[data-icon-stroke="custom"]`, which Prefs sets only once the dial has moved, so the sprite's deliberate 1.8/2.0/2.2 mix survives at the default |
| `--mo` | Motion | `--dur-1/2/3` all multiply by it |
| `--tex-mult` | Texture strength | `body::before`, a `pointer-events:none` fixed overlay |
| `--chrome-alpha` | Chrome opacity | `--chrome-bg` mixes it with `--chrome-rgb` |
| `--readable` | Max content width | the `min-width:560px` cap |

Colour: a preset states only `--y` (accent) and `--on-y` (what reads on top of
it). `--yd` / `--yb` / `--y-fade` are `color-mix`ed from `--y`, so a custom accent
stays consistent without three hand-written `rgba()` values.

---

## 5. Storage keys

Nothing here is namespaced under a single prefix, for history's sake — the four
apps were once four separate sites and the keys are kept so their standalone
versions still work off the same data.

| Key | Owner | Holds |
| --- | --- | --- |
| `do_<YYYY-MM-DD>` | DO | one day's routine ticks (older days are swept on the first load of a new day) |
| `do_todoist_v1` | DO | DO's Todoist target + a mirrored token |
| `travel_state_v2` | DO | every packing checklist (`travel_state_v1` migrated once, on read) |
| `log_<YYYY-MM-DD>` | LOG | one logged day |
| `log-scale-v2` | LOG | the 1–3 → 1–5 rescale flag. **Deliberately not `log_`-prefixed** — `allLogKeys()` would treat it as a day |
| `plan_queue` / `plan_mappings` / `plan_projects` / `plan_token` | PLAN | |
| `store_state_v1` | STORE | list, cart, budget, history, Todoist target (`eat_state_v1` read once) |
| `root_todoist_v1` | shell | **the** Todoist key, mirrored into the three legacy keys on save |
| `root_tab` | shell | last tab, so a reload lands where you left |
| `root_theme` | shell | legacy; kept in step with the active theme for the standalone apps |
| **`root_prefs_v1`** | Prefs | every appearance and behaviour setting |
| **`root_config_v1`** | Config | content **overrides only** — absent on an untouched install |

Export writes **every** key on the origin, unfiltered. A backup that silently
drops a key is worse than one carrying a few bytes too many.

---

## 6. Things that will bite you

- **`#track` and `position:fixed`** — see §3. This has caused two bugs already.
- **`touch-action`** — the track claims horizontal gestures via `pan-y`, but
  `#track input,textarea,[contenteditable]{touch-action:auto}` gives them back
  inside a field. Without it a sideways drag steals caret placement and the paste
  callout, which made the Todoist key impossible to paste on a phone.
- **Anything inside `#track` that scrolls sideways must say so itself.** A
  gesture is resolved by intersecting `touch-action` up the ancestor chain, so
  the track's `pan-y` reaches every descendant and `overflow-x:auto` alone buys a
  scroller that works with a mouse and is dead under a finger. Every such element
  needs `touch-action:pan-x pan-y` of its own. Four have it: DO's `.tabs`, the
  settings `.set-seg`, and LOG's `.out-pre` / `.rep-pre`.
- **Anything built from Config has no fixed width.** A strip drawn for the two
  entries it shipped with breaks the moment the editor adds a third — and the
  editor is the whole point of 2.0. Wrap it, or scroll it; DO's tab strip was
  neither and lost its tabs off the right edge.
- **The toast fades, it does not slide.** A fixed `translateY` is shorter than the
  resting offset once `env(safe-area-inset-bottom)` is non-zero, which parked a
  sliver of the pill at the bottom of a phone screen permanently.
- **`SET.renderToken()` only refills the field when it holds nothing unsaved.**
  `onShow` re-renders the panel on every visit; without the check, leaving the tab
  and returning wiped a key that had been pasted but not saved.
- **DO's day sweep must skip `do_todoist_v1`.** It is `do_`-prefixed but it is
  settings, not a day. Sweeping it cleared the token on the first load of every
  new day.
- **`store.categories.manual` is load-bearing.** Uncategorised items land there.
  The editor pins it, `read()` restores it if it goes missing, and STORE re-files
  orphaned items to it when an aisle is deleted.
- **`plan.types[].key` is an identity, not a label.** `plan_mappings` is filed
  under it, so the editor preserves it across a rename.
- **LOG's field names are frozen.** `meds_lam`, `meds_rit`, `cur_mix`, `cur_prod`,
  `cur_cont` and the two caffeine counters are fixed slots with *editable labels*.
  Renaming the label changes what you see; the record and the `.md` are untouched.
- **The `.md` block table has a floor of six columns.** Lowering the block cap
  keeps the table identical (extra cells come out empty, as they always did on a
  light day); only deliberately raising it past six widens the table. The parser
  already reads a variable column count, so it round-trips.
- **Turning a LOG field off never deletes data.** The input keeps its value, save
  still reads it, the export still writes the column.
- **`color-mix()` and `zoom` are both used unpolyfilled.** Baseline in every
  browser that matters since 2023/2024. Where `zoom` is unsupported the page
  simply renders at 100%.
- **"Today" can change under you.** DO's `TODAY`/`SK` and LOG's `REAL_TODAY` are
  `let`, re-derived by `rollDay()` when the shell's day check fires. Never copy
  them into another module-level constant, and never build a day key from
  `new Date().toISOString()` — that is UTC, and in France it is yesterday until
  01:00 or 02:00. Use `Shell.today()`.
- **A `confirm()` in an app module is a bug.** Route it through `Shell.confirm()`
  so Settings → behaviour → "confirm before clearing" means something. The one
  exception is LOG's "go back without saving?", which guards unsaved input, not
  a clear.
- **STORE's classifier caches its vocabulary in `VOCAB`.** It is built from
  `CATEGORIES`; the Config subscriber sets it to `null` so an aisle edit is
  picked up. Anything else that changes what the categoriser should know must
  do the same.
- **DO's Todoist name map is built per call**, not at boot (`tdRoutineBySlug()`),
  because routines are editable. Do not cache it.
- **A sheet owns the keyboard.** The shell's shortcuts (`←` `→` `1–5` `/`) are
  suppressed while any `.sheet-back.on` or visible `.modal-overlay` exists, and
  Escape closes it by clicking its own backdrop/cancel button. A new overlay
  that does not use `.sheet-back` gets neither for free.

---

## 7. How to do the common things

**Add a theme** — one entry in `Prefs.THEMES` (id, name, mode, group, desc, four
swatch colours), one line in `THEME_CHARACTER`, one colour block in `themes.css`.
Nothing else. It appears in the picker automatically.

**Add an appearance or behaviour setting** — one line in `Prefs.SCHEMA`; add
`attr:` for an enum that CSS keys off, or `cssVar:` for a continuous one. Write it
in `Prefs.apply()`, render it with `chips()` / `slider()` / `toggle()` in the
relevant panel, and add the rule that makes it real.

**Make something hardcoded editable** — move the literal into `DEFAULTS` in
`config.js`, replace the module's `const` with a `let` read through
`Config.get()`, add a `Config.subscribe()` that re-reads and re-renders, and add
an `EDITORS` entry plus its path in `EDITOR_ORDER`.

**Add an app tab** — a `<section class="view ns-x">` in `index.html`, a
`css/x.css` scoped to `.ns-x`, a module that calls `Shell.register('x', …)`, and
`'x'` in `Shell.TABS`, the nav markup, and `Prefs.SCHEMA.startTab.values`.

**Test without a browser** — `test/harness.mjs` boots the real `index.html` in
jsdom (scripts loaded from disk, stylesheets and fonts skipped) and drives it
through DOM events: 35 checks covering boot, every theme and panel, and the
behaviour fixed in 2.1. Run it before trusting any change:

```
cd root/test && npm install && node harness.mjs
```

jsdom does not lay out or paint, so it proves the DOM is built and the logic
runs, and proves nothing about how anything looks. Add a check for every
behaviour you fix; a bug that has a check does not come back.

---

## Changelog

*Newest first. Every change to `root/` gets an entry — what changed, and why if
the why is not obvious from the what.*

### 2.1 — 2026-09-01 — the audit: what 2.0 left dangling

A read-through of every file against the vision in §1, looking for settings
that existed but did nothing, constants that 2.0 had made editable in one place
and left cached in another, and the phone-app cases (midnight, quotes, a flaky
request) that a jsdom boot pass cannot see. Nothing here changes a storage key,
a day-record field or the `.md` export.

**Settings that were decorative are real now.** Three preferences were written
by the settings view and read by nothing: *confirm before clearing* (only the
settings view's own buttons honoured it; every reset/clear in the four apps
called `confirm()` directly — they go through `Shell.confirm()` now), *week
starts on* (nothing read it; the km chart honours it, reports stay ISO/Monday
and the chip says so), and `log.streakRequires` (in Config, no editor, never
read; the streak uses it and Settings → content → LOG has a select for it).

**Midnight with the app open.** Every module captured "today" once at boot, so
a phone that keeps ROOT open — which is how it is used — filed ticks made after
midnight into yesterday's record until someone reloaded. Worse, DO and STORE
derived the day from `toISOString()`, which is UTC: the checklist did not reset
until 01:00 (winter) or 02:00 (summer), and a tick in that window went to the
wrong day. `Shell.today()` is now the only definition of the local day, and the
shell re-checks it on visibility, focus, tab change and once a minute, calling
each module's `onDayChange`. DO rolls to the new record; LOG follows only when
the selected day was today and no form is open, because an evening logged at
00:10 belongs to the day that just ended. STORE's trip date is local too.

**Editable in one place, cached in another.** DO's Todoist name→routine map was
built once at boot from `ROUTINES` — rename a routine in Settings and sync
stopped matching it until a reload. STORE's classifier vocabulary (`VOCAB`)
was built once from `CATEGORIES` — add a word to an aisle and the categoriser
never saw it. LOG's note parser capped meals at 4 while the meal count goes to
8, so meals 5–8 vanished from every pasted-notes report. LOG's daily km target
was still a constant (`log.kmTarget`, editable now, next to the streak rule).
PLAN's and STORE's home dates ignored the date-format preference that DO and
LOG already followed.

**A quote in an editable value broke its button.** Block names, workout types,
PLAN's chips and DO's checklist items are interpolated into inline `onclick`
strings; `esc()` handles `<>&` but not `'` or `\`, so a block called `it's` was
a syntax error and could not be toggled. Every such site goes through `attr()`
(JS-string escape, then attribute escape). See §3.

**Streak and "done" cards depended on two specific fields.** Morning counted as
logged only with a wake time, evening only with an evening km — and 2.0 made
both fields switchable off, after which the card could never turn green and
the streak was stuck at zero. Any recorded value in that half of the day counts
now. The streak also no longer resets to zero every morning: if today is not
finished it counts back from yesterday.

**PLAN re-sent tasks after a partial failure.** The queue was cleared only when
every task went through; one failed request kept all of them, and the next
"send" created duplicates in Todoist for the ones that had succeeded. Only the
failed tasks stay queued, and the log says so.

**Keyboard and sheets.** STORE's numpad reads digit keys; so did the shell's
tab shortcuts, on the same document, so typing `3` into the numpad on a laptop
also jumped to PLAN, and `/` decremented the count *and* opened settings. All
shortcuts are suppressed while a sheet or modal is up, and Escape closes it
(the shell clicks the overlay's own backdrop, so it knows nothing about who
owns which sheet).

**Smaller.** `Shell.settings('general')` was called from PLAN in three places
and matched no panel (the key lives under *data*) — every "add your key under
General" message pointed at a panel that does not exist. `Prefs.preview()` set
`data-theme` but not `data-mode`, so hovering a light preset from a dark one
previewed it without the light-mode corrections. `loadFonts()` set the font
link's `href` to `''` when both faces were system faces, which resolves to the
page itself and fetched `index.html` as a stylesheet; the link is removed
instead. A pasted "look" can now no longer inject a non-string currency or a
malformed accent (`coerce()` covers `text` and `color`). The meal count is
clamped to 1–12 on render, since the editor's number field is empty mid-edit.
`#settings/<panel>` deep-links to a settings panel. `manifest.webmanifest`
makes the site installable as a standalone app on Android; iOS was already
covered by the apple-* metas.

**Verified** — `test/harness.mjs`, 35 checks, all green: boot with no console
errors, all 15 presets, all nine panels, and one check per behaviour above
(the day rollover is driven by shimming `Date` a day forward and calling
`Shell.checkDay()`; the partial send by a scripted `fetch`). Before the changes
the same harness failed 22 of them, which is the diagnosis in numbers. **Not
verified**: nothing above has been seen in a browser, and the manifest has not
been installed on a phone. The rollover in particular deserves one real night
with the app open before it is trusted.

### 2.0.1 — 2026-09-01 — the horizontal scrollers inside the track

Reported as "my tabs are no longer centred and some I can't even access", blamed
on the swipe. The swipe was implicated, but it was the CSS half of it.

**DO's home tab strip could not hold more than the two tabs it shipped with.**
2.0 made `do.tabs` editable and built the strip from Config, but `.ns-do .tabs`
was still `inline-flex` with no shrink and no overflow — drawn for exactly
`daily` / `other`. Add a third or fourth tab in Settings and the strip outgrows
`.h-logo-row`, which is `flex-wrap:wrap`, so it drops onto its own line (there
goes the alignment against the logo) and runs off the right edge with no way to
reach what is past it. It now shrinks to the row (`min-width:0; max-width:100%`)
and scrolls sideways, `.tab` chips no longer squash (`flex:0 0 auto;
white-space:nowrap`), and `DO.positionGlider()` nudges the strip's own
`scrollLeft` so the active tab is never off the edge — its own `scrollLeft`, not
`scrollIntoView()`, which would drag the whole slide back to the top and break
"every tab remembers where you left it". The glider's inset was `3px` against a
`calc(3px * var(--dens))` padding; it is a `--dens` calc now too.

**`#track{touch-action:pan-y}` had frozen every horizontal scroller inside it.**
A gesture is resolved by intersecting `touch-action` up the ancestor chain, so
the track's claim on horizontal reaches every descendant. 2.0 wrote the one
exemption it knew it needed (`#track input,textarea,[contenteditable]`) and
nothing else, which left three scrollers that work with a mouse and are dead
under a finger: the settings segmented control — the very thing added in 2.0
because nine panels no longer fit — and LOG's two `.md` preview panes, which
`js/shell.js` explicitly steps aside for in `scrollsSideways()`. Between the two
halves the gesture did nothing at all: the shell declined it and the browser was
not allowed to act on it. All four scrollers now state
`touch-action:pan-x pan-y` for themselves, and the rule in `shell.css` says why,
because the next one added will hit the same wall.

The swipe interaction falls out of the fix rather than needing one: once the
strip genuinely overflows, `scrollsSideways()` sees it and refuses the app-level
swipe, so dragging the tabs moves the tabs instead of sliding the app to LOG.

**Verified** in jsdom (§7): all eight modules load with no console errors, the
strip renders the shipped two tabs, grows to five through `Config.set`, keeps its
glider across the re-render, activates a far tab, hides itself at one tab, and
restores on reset. **Not verified** — jsdom does not lay out or paint, so none of
the CSS above has been seen. The overflow, the wrap and the scroll are exactly
the kind of thing that only a real viewport proves; open DO with four or five
tabs on a phone before trusting this entry.

### 2.0 — 2026-09-01 — the customisation rewrite

**New files**

- `ROOT.md` — this manifest.
- `js/prefs.js` — appearance + behaviour engine. 15 presets (10 dark, 5 light),
  13 accent swatches + a custom colour, 8 display faces, 5 mono faces, 39
  settings in total (18 enums, 10 sliders, 9 toggles, 1 colour, 1 text). Loaded
  from `<head>` so the look is stamped before the first paint.
- `js/config.js` — the content layer. Every literal the four apps used to hold is
  now an editable branch under `do.` / `log.` / `plan.` / `store.`.
- `js/settings.js` — the settings view, extracted from `shell.js`.
- `css/settings.css` — the settings stylesheet, extracted from `shell.css`.

**Rewritten**

- `css/tokens.css` — full token system: one shape anchor with four derived radii,
  density and scale multipliers, a motion multiplier, a depth ramp, a texture
  overlay, and the single global rule behind each dial.
- `css/themes.css` — was 4 themes, one of which (`paper`) needed a hundred lines
  of shape overrides. Now 15 presets that are pure colour, because shape moved
  into `THEME_CHARACTER` + tokens. Light-mode corrections are keyed off
  `[data-mode]` rather than a theme id, so all five light presets get them.
- `js/shell.js` — settings removed; toast duration, swipe on/off, swipe
  threshold, chrome auto-hide and the opening tab all read from Prefs live rather
  than being captured at boot, so a setting takes effect without a reload.

**Mechanically normalised** (`do/log/plan/store.css`) — 92 hardcoded
`border-radius` px values → radius tokens (108 radius declarations now resolve to
a token), 85 hairline borders → `var(--bw)`, and 329 padding/gap values →
`calc(… * var(--dens))`. Before this, a theme could recolour
the app but never reshape it, and the density and corner dials would have been
decoration. There are now **zero** hardcoded `border-radius` px values in the app
sheets.

**Made editable** — DO's routines, the tab layout and the packing categories;
LOG's blocks (name + colour), block cap, med labels, meal count and name,
caffeine labels, curate labels and colours, scale endpoints, workout types, and
which fields appear at all; PLAN's project/section tree, block chips, time chips
and default priority; STORE's aisles (label, colour, icon, vocabulary), premade
meals and counter step amounts.

**Other fixes**

- Keyboard navigation added (← → between tabs, 1–5 to jump, `/` to settings),
  ignored while a field has focus. ROOT ran on a laptop with no keyboard route.
- STORE's `€` was hardcoded in eleven places; it is a preference now.
- Date formatting was duplicated in DO and LOG with different calls; both go
  through `Prefs.formatDate()`.
- `LOG.buildNote()` built the block table from six hardcoded cells; it is built
  from the array, so raising the cap widens the table instead of dropping blocks.
- The settings segmented control scrolls the active chip into view — at nine
  panels it used to leave the current one off the edge.
- Storage report gained a usage meter against the ~5 MB budget.
- Appearance + content can be exported as a small "look" JSON, separate from the
  full backup.

**Verified** with two jsdom harnesses: a boot/render pass (all modules load, all
15 themes apply, every panel renders, every Config-driven control is built with
the right cardinality) and an interaction pass (26 checks driving the real
editors and dials through DOM events, plus a `.md` export round-trip at both the
default and a raised block cap). All green, no console errors.

**Not verified — open risk.** No browser was available during the rewrite, so
2.0 has never been *seen*. jsdom does not lay out or paint: it proves the DOM is
built and the logic runs, and proves nothing about how any of it looks. Unchecked
by eye, in rough order of how likely they are to be wrong:

- the five light presets, which now inherit the `[data-mode="light"]` corrections
  that were written for `paper` alone;
- the loud presets — `synth` (glow + grid), `carbon` (2px rules, white accent),
  `dune` and `bloom` (16px and 14px radii on a layout drawn for 4px);
- the mechanically normalised spacing at density extremes (0.78 and 1.35);
- the texture overlays at their default strengths;
- `[data-nav="bar"]` and `[data-cards="line"]`, both new and neither seen.

None of this is known-broken. It is simply untested in the only way that counts
for a visual change. **Anyone picking this up should open all 15 presets on a
phone before trusting the changelog above.**

**Not changed, deliberately** — every storage key, the day-record field names,
the `.md` export schema, the Todoist sync semantics (DO only ever completes,
STORE only ever adds), and the standalone `complete/` `plan/` `eat/` apps' shared
keys.

### 1.0 — before 2026-09-01

The four standalone apps (`complete/`, `log/`, `plan/`, `eat/`) merged into one
five-slide shell with a shared Todoist credential, a shared toast, one settings
view and four themes. Storage keys were preserved throughout so the standalone
apps kept working.
