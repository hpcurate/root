# ROOT — manifest

> **Read this before editing anything in `root/`, and update the Changelog at the
> bottom in the same commit as every change. No exceptions, including one-line
> fixes.** This file is the map; if it goes stale it is worse than nothing.

---

## 1. What ROOT is

Seven small single-purpose tools that share one phone, one frame and one set of
storage keys. It is a static site — no build step, no framework, no dependencies,
no network except the Todoist calls you explicitly ask for (and, only when you
import an Anki deck, the three libraries LEARN needs to unpack it). Open
`index.html` over http(s) and it runs.

| Tab       | Does                                                                   |
| --------- | ---------------------------------------------------------------------- |
| **DO**    | Daily routine checklists + travel packing lists. Closes finished routines in Todoist. |
| **LOG**   | Morning/evening daily log → an Obsidian-shaped `.md` note, plus history and weekly/monthly reports. |
| **PLAN**  | Builds a queue of tasks against a project/section tree, then pushes the batch to Todoist. |
| **STORE** | Grocery list with auto-categorisation, an in-store spend counter, premade meals, trip history. |
| **TEND**  | Plant care: today's round by room, a shelf of every plant, an append-only care log that stretches intervals with the season. |
| **TRACK** | The CAP Électricien plan: 54 topics ticked with a date, a derived pace, and the trajectory against exam, internship and revision. |
| **LEARN** | Anki `.apkg` decks studied on the go: rate cards, read the scoreboard, drill what needs work. |
| **Settings** | A home menu (the apps kept out of the bar, then three categories), and behind it eleven panels: one per app (its settings, then its content editors), look / layout / behaviour, and data. |

Which of the seven get a tab, and in what order, is itself a setting
(appearance → layout → apps in the bar). Settings is always last. An app
switched off keeps its slide and opens from the settings home.

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
├── index.html         all markup for all eight views + the icon sprite
├── favicon.png
├── manifest.webmanifest   installable on Android/Chrome; iOS reads the apple-* metas
├── test/
│   ├── harness.mjs    jsdom boot + behaviour checks — see §7
│   └── package.json   its one dev dependency (jsdom); not part of the site
├── css/
│   ├── tokens.css     the token system + every global consequence of a dial
│   ├── themes.css     15 presets, depth ramps, card treatments, nav variants
│   ├── do.css         ┐
│   ├── log.css        │
│   ├── plan.css       │ per-app sheets, each scoped to its .ns-* namespace
│   ├── store.css      │
│   ├── tend.css       │
│   ├── track.css      │
│   ├── learn.css      ┘
│   ├── shell.css      the frame: slide track, floating chrome, responsive rules
│   └── settings.css   the settings view
└── js/
    ├── prefs.js       appearance + behaviour engine   (loaded from <head>)
    ├── config.js      the content layer
    ├── shell.js       Creds, Shell, the slide track, swipe, keyboard
    ├── do.js  log.js  plan.js  store.js  tend.js  track.js  learn.js
    └── settings.js    the settings view
```

### Load order — this is load-bearing

```
<head>   prefs.js          stamps the look on <html> before the first paint
         tokens.css → do → log → plan → store → tend → track → learn
                    → shell → settings → themes.css
<body>   config.js         content exists before any app reads it
         shell.js          defines Creds + Shell.toast, used by every module
         do / log / plan / store / tend / track / learn
         settings.js       needs every module to exist to render its panels
```

LEARN's three libraries (JSZip, sql.js, fzstd) are **not** in this list. They
are injected by `LEARN.ensureLibs()` the first time an `.apkg` import starts,
and never otherwise — ROOT stays a no-dependency page until you bring a deck in.

`themes.css` is last so its `[data-theme]` overrides beat the app sheets on equal
specificity. `settings.css` is after `shell.css` for the same reason.

---

## 3. Architecture

### Namespacing

Each app is one IIFE published as `window.DO` / `LOG` / `PLAN` / `STORE` /
`TEND` / `TRACK` / `LEARN`, and each does its DOM lookups through a scoped
helper:

```js
const SCOPE = '.ns-do ';
const $id = id => document.querySelector(SCOPE + '#' + id);
```

All seven apps use ids like `#s-home` and `#td-project`. The `.ns-*` prefix is
what keeps them from colliding. **Never query the document unscoped from inside
an app module.** Inline `onclick` handlers therefore read `DO.go(...)`, not
`go(...)`. TEND has no inline handlers at all: every button carries `data-act`
and one document-level listener, filtered on `.closest('.ns-tend')`, dispatches
— its markup is in three places (the slide, the overlays, the settings panel)
and that is the one listener that reaches all of them.

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
Shell.register(name, { onShow, onDayChange, home })
```

`onShow` fires on every visit to the tab. `home` fires when the app's own tab
is tapped while it is already showing (go to the home screen; LOG checks for
unsaved input first). `onDayChange(iso)` fires when the
calendar day changes while the app is open — the shell checks on
`visibilitychange`, on window focus, on every tab change and once a minute.
DO moves to the new day's record; LOG moves its selected day only if it was
"today" and no form is open (an evening written at 00:10 belongs to the day
that just ended). Nothing else captures "today" at boot any more.

Routes: `#do` … `#settings` pick a tab; `#settings/<panel>` lands on one
settings panel and is kept in the address bar as you switch panels.

### The slide track

`#track` holds up to eight slides **stacked**, and a tab change is a
cross-fade: `Shell.show()` sets `.cur` on the incoming slide and `.leaving`
on the outgoing one, plus `.morph` for a beat to play the incoming title in
(the wordmark, or the `.hd-title` of whichever sub-screen that slide was left
on). The track itself never moves. Each `.view` is a column: the home's
`.h-top` as a title band at the top (Shell moves it there at boot, before the
modules run) and `.view-body`, the scroll container holding every screen — so
every tab remembers where you left it, and the band never scrolls. A module
that resets or reads the scroll position uses the body
(`document.querySelector('#view-x .view-body')`), never the view.
**Nothing `position:fixed` may live inside `#track`** — a transformed ancestor
becomes the containing block for fixed descendants. The toast, the nav, the LOG
modal, TEND's sheets and undo pill, and all the STORE sheets are siblings of
`#views` for exactly that reason.

**Which slides exist, and in what order, is `Prefs.apps`.** `Shell.rebuild()`
reads it, re-orders the `.view` sections inside `#track` and the `.tab-b`
buttons inside `#nav` to match (each is addressed by `id="view-x"` /
`data-app="x"`, never by position), hides the ones switched off, and appends
settings. `Shell.TABS` is mutated in place so the reference stays live. A hidden
view is `display:none`, so the percentage transform still counts only visible
slides. The pill never grows past its phone width and the arrows are always
there; the settings home lists the apps that are out of the bar, and
`Shell.open(name)` puts one's slide back into the track just before settings
(no tab button) until you leave it, when `retire()` hides it again and re-parks
the track; while you are on it the settings button wears its icon. Keyboard
`1`–`9` jump by position in the current order. `rebuild()` re-appends the
`.view` nodes, which resets their scroll position, so it saves and restores
each slide's `scrollTop` around the move.

The left arrow is context-sensitive: on an app's home it is "previous tab";
inside a sub-screen (`.scr.on` other than `#s-home` carrying an `.hd-back`)
it becomes that back button. Tapping the tab you are already on calls the
module's `home` hook (`Shell.register(name, { home })`), else presses the
sub-screen's back button until there is none, and scrolls to the top once
home.

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

### Settings — a menu, three categories, two conventions

The settings view is two screens: `#s-home` (the menu: the apps out of the bar
as tappable tiles, then **apps** / **appearance** / **data**) and `#s-cat` (a
sticky back header, the pill bar of that category's panels, the panels).
`SET.CATS` says which panel sits where; `SET.panel(name)` opens the right
category with that pill lit, `SET.home()` goes back to the menu. `data` is a
single panel, so its pill bar is hidden. `#settings` is the menu,
`#settings/<panel>` a panel.

1. **Appearance and behaviour controls** carry `data-pref="<key>"` and are handled
   by one delegated listener. Adding a control is markup, not wiring.
2. **Content editors** live inside a `[data-group="<config path>"]` and are read
   back out of the DOM *wholesale* by that group's `read()`. No per-field state is
   tracked, so an editor cannot drift out of step with what is saved. There is
   no content panel: each app's editors are rendered into the
   `[data-content-for="<app>"]` box at the end of that app's own panel, chosen
   by the first segment of the editor's path.

To add a knob: one line in `Prefs.SCHEMA`, one builder call in the panel, and
whatever CSS reads the attribute or variable.
To add a content editor: one entry in `EDITORS` with `render()` / `read()` /
optionally `add()` / `del()`, and its path in `EDITOR_ORDER` — it lands in the
panel of the app its path starts with.

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
| `--title-scale` | Title size | `.view > .h-top .h-logo` in `shell.css`, times the one `--title-base` |
| `--t-fade` `--t-title-in` `--t-title-out` `--t-flip` | (not a dial) | the shell's own motion — the tab cross-fade, the title morph, PLAN's FLIPs — all multiplied by `--mo` |

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
| `do_todoist_v1` | DO | DO's Todoist target + a mirrored token, since 2.3 the today-tasks block's filter and its cached list for the day, since 2.5 the block tiles, since 2.8 the media tab's switch and cached list |
| `travel_state_v2` | DO | every packing checklist (`travel_state_v1` migrated once, on read) |
| `log_<YYYY-MM-DD>` | LOG | one logged day (`e.media` since 2.8: the titles finished on DO's media tab, `{ name, kind, sub }`) |
| `log-scale-v2` | LOG | the 1–3 → 1–5 rescale flag. **Deliberately not `log_`-prefixed** — `allLogKeys()` would treat it as a day |
| `plan_queue` / `plan_mappings` / `plan_projects` / `plan_token` | PLAN | |
| `plan_sent_v1` | PLAN | what was sent today (name, project, block, time) — LOG offers these as blocks; a new day starts it empty |
| `learn_daily_v1` | LEARN | per-day tally of cards rated / acquired / per deck, last 60 days — LOG's note reads it, the cards themselves are in IndexedDB |
| `store_state_v1` | STORE | list, cart, budget, history, Todoist target (`eat_state_v1` read once) |
| `tend.v3` | TEND | plants, the care-event log, season sensitivity and shelf sort (`tend.plants.v2` migrated once, on read) |
| `tend_todoist_v1` | TEND | Todoist target (project, section, label, priority), the push/show switches, and the ids of the tasks pushed today. **Not inside `tend.v3`**: both apps' `normalise()` rebuild that record from its known keys and would drop it |
| `capTracker.v2` | TRACK | ticks by topic id, the dates, which levels are open. `capTracker.weeks.v1` is surfaced and **never migrated** |
| `learn_settings` | LEARN | the shuffle flag. **Decks, cards and media are in IndexedDB `learn_v1`**, not localStorage — see §6 |
| `root_todoist_v1` | shell | **the** Todoist key, mirrored into the three legacy keys on save |
| `root_labels_v1` | shell | the Todoist label colours (`{ fetched, colors:{ name: hex } }`), filled by DO's fetches and `Todoist.labels()`, read by DO and PLAN |
| `root_tab` | shell | last tab, so a reload lands where you left |
| `root_theme` | shell | legacy; kept in step with the active theme for the standalone apps |
| **`root_prefs_v1`** | Prefs | every appearance and behaviour setting |
| **`root_config_v1`** | Config | content **overrides only** — absent on an untouched install |

Export writes **every** key on the origin, unfiltered. A backup that silently
drops a key is worse than one carrying a few bytes too many. It cannot carry
LEARN's decks, which are in IndexedDB; the data panel and the storage report
both say so, and a new device needs the `.apkg` imported again.

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
- **A sheet owns the keyboard.** The shell's shortcuts (`←` `→` `1–9` `/`) are
  suppressed while any `.sheet-back.on` or visible `.modal-overlay` exists, and
  Escape closes it by clicking its own backdrop/cancel button. A new overlay
  that does not use `.sheet-back` gets neither for free. TEND's two sheets use
  it, which is why they get both.
- **`data-sub` saves the whole branch it names, and must name the branch the
  module reads.** An override is stored whole-branch, so a field pointed at
  `log.curate.mix` with `sub=label` overrode `log.curate` with a one-slot
  fragment and the other two counters vanished from the evening form. Point it
  at `log.curate` with `sub=mix.label` (dotted subs are walked). Number and
  range inputs store numbers.
- **`tend.tasks` has three fixed keys and `track.curriculum` has fixed ids.**
  The care log is filed under water / feed / repot and the ticks under
  `t01`…`t54`; labels are free, identities are not. There is deliberately no
  curriculum editor — renumbering would orphan every tick.
- **A plant's `group` can name a type that no longer exists.** The editor lets
  you delete a type; TEND falls back to the default type (`tend.newPlant.group`)
  for the season maths and lists the plant under "other" on the shelf. Do not
  "fix" the plant's key on read — the type may come back.
- **LEARN without IndexedDB.** jsdom, some private modes and some managed
  browsers have none. `db()` rejects, `renderHome()` says so on the home screen,
  and nothing throws. Keep it that way: the harness boots without it.
- **TEND's `.tabs` are two fixed chips** and do not overflow. If they ever
  become Config-driven they need the same `touch-action:pan-x pan-y` and
  scroll treatment DO's strip got in 2.0.1.
- **The app list can hide the app you are on.** `Shell.rebuild()` is followed
  by `go()` to the same app if it is still shown, else to the first one, so no
  transform ever points at a hidden slide.
- **A decimal field is `type=text inputmode=decimal`, never `type=number`.**
  The French keypad offers a comma and iOS rejects it in a number field, so
  weight, sleep and km could not be typed on the phone. The shell turns the
  comma into a dot as you type (one capturing `input` listener), and LOG's
  save normalises again. A new decimal field gets both for free only if it is
  `type=text` with `inputmode="decimal"`.
- **Theme preview is mouse-only.** `pointerover` fires under a scrolling
  finger and `:hover` sticks after it lifts, so the touch preview applied a
  theme that was never chosen and never reverted. `pointerType` gates it.
- **DO's today block caches the day's tasks.** Todoist never returns a
  completed task, so a task closed here is kept in `do_todoist_v1` with
  `done:true` until midnight — that is the only way "untick → reopen" can
  exist. On every refresh the API's word wins: anything it returns is open,
  whatever we last did to it here.
- **LOG block chips match on `data-name`, not text.** A planned chip carries a
  caption, and the attribute has to be attribute-escaped (`attrEsc`): LOG's
  `esc()` leaves quotes alone, which is fine as text and fatal inside
  `data-name="…"`.
- **The `#### study` section of the note is conditional.** It appears only on
  a day with a ticked topic or a rated card. The parser looks rows up by key,
  so an extra section is additive and older notes are unaffected.
- **Every Todoist sync is single-flight and silently skipped while one runs.**
  DO and TEND both start a quiet sync from `onShow` when theirs is older than
  ten minutes, so a `syncTodoist()` called right after `Shell.go('tend')` may
  return at once as "busy". The harness waits it out; a user tapping "sync
  now" during an auto-sync gets the auto-sync's result a moment later.
- **DO's today block is two sources, deduplicated by task id.** TEND's rows
  come from `TEND.todayList()` directly (so they show even with push off) and
  carry `tend:` ids that route the tick back to `TEND.setDone()`; a fetched
  Todoist task whose id is in `TEND.pushedIds()` is dropped, or a pushed plant
  would appear twice. The block is visible when DO's fetch is on *or* a plant
  is due.
- **`Shell.badge(app, n)` is the only writer of `.tb-badge`.** DO calls it from
  `renderToday()` with the open count; TEND reaches it through `DO.renderToday()`
  (`notifyDo`). A new counting app should do the same, not touch the nav.
- **A new label says `text-transform:var(--caps)`, never `uppercase`.** The
  literal is invisible to the caps switch; 2.5 rewrote 113 of them.
- **`LOG.setBlock()` writes today's record even when another day is selected.**
  It edits the live record only if the selected day is the real today, and the
  stored one otherwise, so a tick on DO never changes which day LOG is showing.
- **TEND boots after DO.** DO draws its block before `window.TEND` exists, so
  TEND's boot schedules `notifyDo()` on the next tick and DO's `onShow` redraws
  it — otherwise the plants only appeared after the first interaction.
- **Re-appending a `.view` resets its scroll.** `Shell.rebuild()` moves the
  slides to re-order them, and it runs from the app list on the layout panel,
  which is well down the page: every switch used to land you at the top. It
  saves and restores each slide's `scrollTop`; settings' own re-render is
  wrapped in `keepScroll()` for the same reason. jsdom cannot prove either
  (its `scrollTop` is always 0), so this one is browser-only.
- **`do.tabs` may predate the media tab.** An override written by the routines
  editor before 2.8 has no `media` entry; DO's `readConfig()` splices one in
  at index 1 in memory rather than rewriting the override. Its id is fixed —
  `renderHome()` draws the grid on it instead of routine cards.
- **The media list is a backlog, not a day's list.** `td.media` keeps every
  open task whatever its date; a new day only drops the ones closed the day
  before (their untick window is over) rather than emptying the cache.
- **A sub-screen is `.scr` + `.hd-back`, and the shell relies on it.** The
  left arrow becomes "back" by finding `.scr.on:not(#s-home) .hd-back` in the
  current slide. A new sub-screen that names its home something other than
  `s-home`, or hides its back button, gets a dead left arrow.
- **Every home header is `.h-top`, and Shell lifts it out of the scroller.**
  At boot each view becomes band + `.view-body`; `#s-home > .h-top` is the
  band. A new app's header must be a `.h-top` directly under `#s-home` — its
  box (padding, height, the label row, the wordmark's size and the status-bar
  inset) belongs to `shell.css` and is shared by all eight, because the title
  morph only reads as one title becoming another if they are the same shape.
  Set type and colour in the app sheet; never the box, and never a
  `--title-base` of its own. A harness check enforces it.
- **Anything in the band that shares the wordmark's row needs a fixed
  height.** DO's tab strip is 32px by declaration, not by padding: at a high
  density a padded chip grew past the wordmark and made DO's band the odd one
  out, which is exactly what the shared rule exists to prevent.
- **The gap under the band is the shell's, and an app must not add to it.**
  `.view-body #s-home` sets it and zeroes the first child's top margin. A
  section that can be hidden breaks `:first-child` — DO's
  `markFirstSection()` marks the first one on screen instead, and its rule
  needs the specificity to beat `.tt.hidden + .tt`.
- **`position:fixed` inside `#track` is still forbidden**, for a new reason:
  the track no longer carries a transform, but the title morph animates one
  on `.h-logo` / `.hd-title` and PLAN's FLIP animates them on its tiles, and
  any of those becomes the containing block for a fixed descendant while it
  runs.
- **PLAN's expanded project is not state.** `openKey` and `openSub` live in
  the module and are deliberately not persisted or put in Config.
- **A `data-flip` key is an identity, and sharing one across two different
  elements is a bug.** The section rows once borrowed the keys of the tiles
  they replaced, to make the tiles look like they became the rows; what it
  actually did was fly each row in from that tile's position while squashing
  it to a tile's width, and the further the tile the worse it looked. Every
  element owns its key now (`p:` tiles, `sec:` rows, `form:` the panel,
  `queue`), so only genuinely persisting elements move and everything else is
  revealed. A harness check fails if a row carries a `p:` key again.
- **A box that changes shape must not show its text while it does.**
  `flip()` scales the box and holds its children at `opacity:0` until the
  scale has nearly resolved. Counter-scaling the children instead does not
  work here — the tile goes from a third of the width to full width, and the
  content would overflow the box it is supposedly inside for most of the way.
- **PLAN's form has no screen of its own.** It is drawn into the tile grid by
  `formPanel()` with the ids it has always had, so every handler is
  unchanged — but each row is optional (`plan.formFields`), so nothing may
  assume its element exists: `resetOpts`, `setSub`, `addSubtask`,
  `renderSubtasks` and `addToQueue` all guard. `paintForm()` restores the
  controls from `formState` on every draw, which is what makes it safe to
  re-render the grid while the form is open.
- **`optPick()` toggles.** Tapping the chip that is already on clears the
  field. The block row has no "none" chip because of it; the time row keeps
  one and works either way.
- **A hidden box must be emptied.** `renderBlocks()` used to return early
  when the section was hidden, leaving the old tiles in it; anything counting
  `.bk` (the harness, but also a future badge) saw ghosts. Hide *and* clear.
- **`html` carries the ground colour too.** The fixed body does not paint the
  strip under the home indicator; the root does, and with `color-scheme:dark`
  and no background it paints black.
- **A hidden app opened from settings is a transient slide.** `Shell.open()`
  splices it into `TABS` before settings and re-parks the track before
  animating, because settings' index moves by one; `retire()` does the same
  in reverse 340 ms after you leave it. `paintNav()` reads `TABS` by name for
  the same reason — a cached button list would be one off.

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

**Add an app tab** — a `<section class="view ns-x" id="view-x">` in
`index.html` whose `#s-home` starts with a `.h-top` (the title band Shell
lifts out; give the app a `--title-base` if 54px is wrong for its
wordmark), a `css/x.css` scoped to `.ns-x`, a module that calls
`Shell.register('x', …)`, a `.tab-b` with `data-app="x"` in the nav (plus a
`tab-x` sprite symbol — the settings home reuses it), `'x'` in `Prefs.APPS`, a
`data-panel="x"` settings panel ending in a `[data-content-for="x"]` box, `'x'`
in `SET.PANELS`, `CATS.apps.panels`, `SEG_NAMES` and `RENDERERS`, and a
`GROUPS` row for its storage keys. `startTab`, the app list and the shell's TABS all follow
`Prefs.APPS`. Use the `card` class on the app's raised surfaces so the depth
ramp and the card treatments reach them without a new class list in
`themes.css`.

**Test without a browser** — `test/harness.mjs` boots the real `index.html` in
jsdom (scripts loaded from disk, stylesheets and fonts skipped) and drives it
through DOM events: 202 checks covering boot, every theme and panel, the
behaviour fixed in 2.1, the three apps added in 2.2, the links and fixes of
2.3, the Todoist round-trips of 2.4, and the block and media tiles, the
settings menu, the back arrow, the title band, the cross-fade and PLAN's
in-place projects and form of 2.5–2.14. jsdom has no layout and no Web
Animations, so anything measured or animated is invisible to it unless the
harness stands in for both, as it does for PLAN's transition. Run it before
trusting any change:

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

### 2.14 — 2026-09-03 — PLAN's project morph, done properly

**Opening a project looked wrong, and the reason was the flip keys.** Each
section row borrowed the key of the project tile it replaced, so the rows did
not appear — they *flew in from wherever those tiles happened to sit*, being
squashed from a tile's width to the full width on the way. Row 1 came from
the tile beside the one you tapped and looked almost right; rows 2 and 3 came
from the middle of the grid and travelled diagonally while stretching, which
is exactly what read as rubbery. Opening a section's *form* looked clean only
by accident: its key matched nothing, so nothing animated at all.

`flip()` is now three explicit cases:

| the element | what happens |
| --- | --- |
| was there, same shape | translate only — the queue sliding to follow the grid's new height, with no scaling of a box that did not change shape |
| was there, changed shape | translate and scale the box, and hold its **contents** at `opacity:0` until 45% through, so text is never seen mid-scale |
| is new | fade up 7px into place, staggered 45ms down the list |

Rows own their keys (`sec:<i>`) and the form panel owns its own (`form:<i>`),
so neither pretends to be something else: the only thing that moves when a
project opens is the one thing that genuinely persists, its tile, growing.
The rows then open beneath it in sequence. Holding the contents back is what
makes the tile's growth clean — it goes from a third of the width to full
width, and no counter-scaling trick survives that; not drawing the text until
the box has nearly arrived does.

**The transition now has tests.** jsdom has neither layout nor Web
Animations, so `flip()` had been a complete no-op in every run to date and
none of its branches was ever reached. The harness stands in for both — a
scripted before/after layout and a recording `Element.animate` — and reads
back what was asked for.

**Verified** — `test/harness.mjs`, 202 checks, all green, including the five
new ones: the tile scaling from `(0.456, 0.742)` and no other element
scaling; its children held to `opacity:0` past the 45% mark; all three rows
revealed with a translate and no scale; their delays strictly increasing; the
queue translating by exactly its 40px displacement with no scale in the
keyframes. Plus the guard that a section row may never carry a `p:` key
again. **Not verified**: nothing in a browser. The one rough edge left is
that the tiles being replaced still vanish with the `innerHTML` swap rather
than fading — the staggered reveal covers it, but it is the thing to look at
first if the open still feels abrupt.

### 2.13 — 2026-09-02 — the title slides, the gap is the shell's, send when there is something to send

**The title morph is a slide.** The blur-and-scale settle is gone. The
incoming wordmark — or the sub-screen header the slide was left on — comes in
from the side you are moving towards while the outgoing one leaves the other
way, so the two read as one title being pushed along. `Shell.show()` takes
the direction from the move and writes `--dir` (+1 forward, −1 back) on both
slides; the keyframes are a translate and a fade, nothing else. The band is
`overflow:hidden` so nothing spills sideways mid-slide.

**The gap under the band belongs to the shell.** It used to be whatever
bottom margin each app had put on its own wordmark — 6px on TRACK, 28px on
DO — and 2.12 deleted those, which left the content flush. It is one rule
now (`.view-body #s-home`), with the first element's own top margin
cancelled so it cannot add to it. DO is the one app whose first section can
be switched off, so `markFirstSection()` marks the first one *actually on
screen* — CSS's `:first-child` would land on a `display:none` block — and
that one drops its top margin.

**The send button is absent, not faded.** It appears only once the queue has
something in it, names the count, and steps out of the way while the task
form is open rather than sitting under it (`PLAN.syncSend()`). The disabled
state and its style are gone.

**No "none" chip on the block row.** No block is the starting state, and
tapping the chip that is already on clears it — `optPick()` toggles now, so
the time row (which keeps its none chip) gained the same gesture for free.

**Verified** — `test/harness.mjs`, 197 checks, all green: `--dir` −1 moving
back through the tabs and +1 forward; the gap set once in `shell.css` and
DO marking the first visible section on both its tabs; the send button hidden
on an empty queue with no disabled attribute, appearing as "send 1 task to
todoist", and hidden again while the form is open; the block row with no
none chip, a pick selecting and a second tap clearing it. **Not verified**:
nothing in a browser. The slide's distance (34px) and the 18px gap are both
eyeball numbers that deserve one look on the phone.

### 2.12 — 2026-09-02 — one band shape, slower motion, PLAN's form in the grid

**Every title band is now the same box.** The morph in 2.11 read as a stumble
because the eight bands were eight different heights — each app had its own
padding, its own wordmark size (48 / 44 / 54) and its own bottom margin, and
DO's daily/media/other strip made its band taller again. `shell.css` sets the
rhythm once: a fixed-height label row, then the wordmark, bottom-aligned,
with the band sized off the wordmark alone. `--title-base` is one value at
`:root` (54px, still multiplied by the Title size dial), the per-app `.h-top`
/ `.h-logo` boxes are **deleted** from all eight sheets rather than left to
lose a specificity fight, and DO's tab chips are a fixed 32px tall so the
strip can never be what drives the height. A harness check reads the sheets
and fails if one starts setting its own again.

**The motion is doubled.** The cross-fade, the title morph and PLAN's FLIPs
were over before the eye caught them. They are tokens now — `--t-fade`,
`--t-title-in`, `--t-title-out`, `--t-flip` in `tokens.css`, all multiplied
by `--mo` so the Motion setting still governs them — at twice what 2.11
shipped with. `flipMs()` reads `--t-flip` so the Web Animations calls keep
step with the CSS.

**PLAN's task form is the third step of the same expansion.** Tapping a
section no longer leaves the home screen: the section rows become a panel two
tiles wide and four tall, morphing out of the row that was tapped, while the
project's title tile grows again above it (`.open.wide`). The `#s-form`
screen is gone from the markup — the panel carries the same ids, so
`optPick` / `prioPick` / `addToQueue` are untouched — and `paintForm()` puts
every control back from `formState` on each draw, so a re-render never loses
what has been typed. Adding to the queue folds the whole grid back up.

**Which form rows appear is a setting.** `plan.formFields` (block / time
estimate / priority / subtasks) with an editor under settings → apps → plan →
content. **The time estimate is off by default** — it is dead weight for a
day planned in blocks — but its chips are kept, so switching it back on costs
nothing. Every row's element is optional now, and the functions that touch
them all guard.

**The open project tile, properly.** The name is centred in the box with the
colour dot under it, both centred on both axes, and `fitTitle()` sizes it
from the tile's own height (up to 92px, shrinking only if it would overrun
the width) rather than the flat 34px it had. "n sections" is hidden while the
rows are showing, since the rows are what it was counting.

**One real bug found on the way.** PLAN's `onShow` only redrew when its home
screen was showing, to protect the form's chips from being wiped. The form
lives in the grid now and repaints itself from state, so the guard is gone —
and with it the case where arriving on PLAN after using another screen left
the tiles on a stale palette.

**Verified** — `test/harness.mjs`, 186 checks, all green: no app sheet
setting a band box or a wordmark size and one `--title-base` for all of them;
the form opening as a panel keyed to the row it came from with the title tile
`.wide` and the section named in its head; `#s-form` gone; the time row off
by default and following the setting both ways; the block chips in their
label's colour inside the panel; a Config edit mid-form keeping the typed
name and the picked block; cancel returning to the rows with the project
still open; add-to-queue filing under the right section and folding the grid.
**Not verified**: still nothing in a browser. The band height, the centred
title at its new size, the four-tile panel and the doubled timings are all
unseen — the timings especially are a judgement call worth one pass on the
phone.

### 2.11 — 2026-09-02 — the cross-fade, the title morph, PLAN opens in place

**The glider is gone.** 2.10's sliding, squashing shape under the active tab
is reverted: the filled pill is back to a `::before` per button that grows
into place. `themes.css` and `tokens.css` key off `.tab-b.on::before` again.

**Tabs cross-fade; the title morphs.** The slides are stacked rather than
laid side by side, and `#track` no longer moves at all. `Shell.show()` gives
the incoming slide `.cur` (opaque, and the only one that takes a tap) and the
outgoing one `.leaving` while it fades. The incoming slide also gets `.morph`
for a beat, which plays its title in from a blur and a slight scale while the
old one blurs away — its wordmark on a home, or the `.hd-title` of whichever
sub-screen that slide was left on, so a tab sitting in a sub-menu morphs that
header instead. `park()` does the same with `#track.still`, which suppresses
both. The swipe now only picks the next or previous tab once it is far or
fast enough; it no longer drags the slide under the finger, and the
rubber-band at the ends went with it.

**The pill sits on the safe area.** `--nav-gap` is 0, and everything that
parks itself above the pill (`#nav`, the arrows, PLAN's send button, TEND's
add bar and undo pill, the toast) uses `max(6px, gap + safe-area)`, so on a
phone it rides the home indicator and on a laptop it keeps 6px off the edge.

**PLAN opens a project in place.** The bottom sheet is gone from the markup.
Tapping a tile expands it across both columns with its name grown to the
largest size that still fits one line (`fitTitle`, measured in px), and the
other tiles become the project's section rows — full width, about half a tile
tall, in the project's colour. A FLIP does the movement: every `[data-flip]`
element's box is noted before the re-render and replayed from it after, and
each section row borrows the flip key of the tile it grows out of, so the
tiles visibly become the rows and the queue slides up or down to follow the
grid's new height. Tapping the open tile closes it; tapping another swaps;
picking a section opens the form and leaves the grid folded for the way back.
`openKey` is not persisted — it is a gesture, not state.

**Smaller.** The "nothing queued yet" block is gone: an empty queue already
says "empty" next to the QUEUE title. A tile's "n sections" line is drawn in
the tile's own colour rather than muted grey.

**Verified** — `test/harness.mjs`, 177 checks, all green: no glider and the
active tab carrying its own pill; a tab change marking the incoming slide
`.cur` + `.morph` and the outgoing one `.leaving`, the track's transform
never set, the leaving class cleared once the fade is over, and a slide left
on LOG's evening form morphing that header; the sheet gone from the markup;
no placeholder block with the count reading "empty"; a project expanding to
one open tile with the right number of section rows, the rows named and
coloured from the project and keyed to the tiles they grow from; the open
tile closing on a second tap, another project swapping in, and a section
opening the form with the grid folded. The section-count colour is read off
`plan.css` itself, since jsdom loads no stylesheets. **Not verified**: still
nothing in a browser — the Chrome extension remains unreachable — so the
cross-fade timing, the title morph, the FLIP into the section rows and the
pill's new resting place have not been seen.

### 2.10 — 2026-09-02 — the title band, the glider, blocks → tomorrow, PLAN in label colours

**The title is a fixed band, not a sticky element.** The fade under 2.9's
sticky header is gone, and so is the sticky. `Shell` now splits every slide
at boot into the home's `.h-top` — a band at the top, below the status bar,
outside the scroller — and `.view-body`, the scroll container holding every
screen. Content starts exactly under the band, nothing rides the rubber
band, and the scrollbar is hidden (`scrollbar-width:none` + the webkit
pseudo, which iOS honours). A sub-screen hides the band (`:has`) and brings
its own sticky `.hd`. The modules' `view` handles now point at the body, as
do the shell's scroll save/restore, the chrome watcher and tap-for-top. The
home screens' own `env(safe-area-inset-top)` padding is zeroed; the band
carries it. That is also what fixes the "other" tab (and the rest): the gap
under the title is the header's own bottom margin now, the same everywhere.

**The nav glider.** The active tab's filled shape is one `.nav-glider`
(made by Shell, `data-app` set to the active app) slid from tab to tab with
an overshoot curve and a squash-and-stretch keyframe mid-flight, instead of a
`::before` fading in and out per button. Measured from the button, so it
turns vertical on the desktop rail. Colour-coded tabs and the accent glow
key off the glider now; reduced motion stills it.

**Title size.** Settings → appearance → layout → "Title size": xs / s / m /
l / xl (`titleSize`, `data-title`, `--title-scale` 0.72–1.34) on the
wordmarks. Each app declares its base (`--title-base`: 54px, DO 48, settings
44) and `shell.css` multiplies.

**Blocks → tomorrow.** "→ tomorrow" on the blocks head (next to hide done)
switches the tiles from tick to select: a row of the block labels — b1 b2 b3,
each in its own Todoist colour — appears under the head, you tap the tiles
to move, then the slot. Each is rescheduled to tomorrow with that block label
replacing its current one (its other labels kept) in Todoist, and leaves the
list. "cancel" or an empty list ends the mode; the selection is a gesture,
not state. The cached block task keeps its full `labels` for this.

**PLAN in label colours.** `Todoist` (shell.js) gained a shared label-colour
cache, `root_labels_v1` — DO fills it as a side effect of its `/labels`
calls, `Todoist.labels()` refreshes it when older than an hour, single-flight
— and `Todoist.COLORS` is the one name → hex table. PLAN's project tiles
take their label's colour when the cache knows one (curate, home, edu … are
labels too, so a tile matches DO's block tiles) and the Settings colour
otherwise, drawn as the block tiles are: a wash of the colour, the colour on
the border, deeper when something is queued. The form's b1 / b2 / b3 chips
wear their label colour the same way. PLAN's `onShow` refreshes the cache
and redraws the home only, so an open form keeps its picks.

**Verified** — `test/harness.mjs`, 164 checks, all green: every slide a
band plus a body, DO's strip and date in the band, the screens in the body;
the glider keyed by app and following `go()`; the title dial's attribute and
default; a block task with "→ tomorrow" on its head, the slot row in violet /
teal / orange disabled until a tile is picked, a tap selecting rather than
closing, the slot posting `due_string: tomorrow` with `["curate","b2"]`, the
tile gone and the row folded; the colour cache filled; PLAN's curate tile in
grape and its b1 chip in violet. Two older checks moved from the home's
second child to its first, since the band left the screen. **Not verified**:
nothing in a browser — the extension is still unreachable — and this entry
is the most visual yet: the band's height, the `:has()` hide on sub-screens,
the glider's overshoot and squash, the hidden scrollbar on iOS and the PLAN
washes are all unseen.

### 2.9 — 2026-09-02 — the left arrow as back, sticky titles, → tomorrow

Six points from the first look at 2.8 on the phone.

**Media stays out of the forms.** The evening form's "media finished" row is
gone: a tick on the media tab closes the task in Todoist and lands in the
day's note, the weekly and monthly reports, and now LOG's history rows (a
`media: …` pill on a past day) — nothing else. `LOG.setMedia()` still writes
the record; `renderMedia` / `toggleMediaLocal` are removed.

**The left arrow is the back button.** Inside any sub-screen — a DO
checklist, LOG's evening form, a STORE category, a settings category — the
top-left "← back" is the far corner of a phone. The shell now watches the
track for `.scr` class changes (one `MutationObserver`, no per-app wiring):
whenever the current slide shows a `.scr.on` other than `#s-home` that has an
`.hd-back`, the left arrow turns into it (`.is-back`: the accent, an arrow
with a tail) and pressing it presses that button. Back home, it is the
previous-tab arrow again. **Tapping the tab you are on goes to that app's
home** — each module registered a `home` hook (`DO`/`PLAN`/`STORE` → `go('home')`,
LOG → `goBack()` with its unsaved check, LEARN leaves a study session
properly, settings → the menu); an app without one gets its back button
pressed until there is none. Already home, the tap scrolls to the top.

**Sticky titles.** Every home's `.h-top` (the date line, the logo, DO's tab
strip) is `position:sticky` on the page ground with a short gradient under
it, so what scrolls up fades behind the title and nothing runs under the
status bar any more. LOG's header gained the `.h-top` wrapper the others
already had, with its own safe-area padding. Sub-screen `.hd` headers were
already sticky.

**The strip under the home indicator.** It painted black under a near-black
theme: `<html>` had no background and `color-scheme:dark` makes the root
canvas black. `html{background:var(--bg)}`. The pill also sits lower —
`--nav-gap` 12px → 6px above the safe area; the arrows and the toast follow.

**The settings button wears the open app's icon.** On an app opened from the
settings home (out of the bar), the settings tab shows that app's sprite
icon and name and lights up; tapping it goes to the settings home and
retires the slide. `paintNav()` swaps the `<use>` href back on any other tab.

**"→ tomorrow" on the today list.** From 20:00, when the list has open
fetched tasks, a button on its head reschedules every one of them to
tomorrow in Todoist (`POST /tasks/{id}` with `due_string: "tomorrow"`) after a
confirm, and they drop off the list. Plants are not touched — TEND owns
those. The hour gates only the button; `DO.deferToday()` works whenever it is
called.

**Verified** — `test/harness.mjs`, 149 checks, all green: no media row on
the evening form, a past day's media pill in history; the arrow plain on a
home, `.is-back` and enabled inside a checklist, going back when pressed; the
DO tab tapped on a checklist landing home; a settings category counting as a
sub-screen and the settings tab returning to the menu; TEND opened from the
home putting `#tab-tend` and "tend" on the settings button, that button
going home and retiring the slide with `#tab-set` back; two tasks due today
moved to tomorrow with the right due string and gone from the list, the
button present exactly when the hour is 20 or later. **Not verified**:
nothing in a browser again (the extension is still unreachable). The sticky
titles and the gradient, the pill 6px lower, the root background under the
home indicator and the arrow's back icon are all visual and unseen; the
sticky DO header is ~120px tall with the tab strip in it, which is what was
asked for but worth a look.

### 2.8 — 2026-09-02 — the media tab, the settings menu, apps out of the bar

**A media tab on DO**, between daily and other (`do.tabs` gains a fixed
`media` id; an older override gets it spliced in on read). It fetches every
open Todoist task carrying one of `do.mediaLabels` (@movie @show @podcast
@music, editable under settings → apps → do → content), whatever its date,
and draws them as the block tiles — three across — grouped under the label,
the group head and the tiles in the label's own Todoist colour. A task's
second label (@album / @set / @track under @music) is a small chip on the
tile. Ticking fills the tile with the large tick, closes the task in Todoist
and writes the title into today's LOG record; unticking reopens it and takes
it back. A closed task stays, ticked, until midnight; the rest of the list
carries over. "hide done" and "refresh" sit in the section head; the switch
is under settings → apps → do. Not counted in the DO badge — it is a
backlog, not today's work.

**Media in LOG.** A new `e.media` list in the day record (`{ name, kind,
sub }`), a conditional `#### media` section in the daily note (`media_count`,
then one `media_<kind>` row per label, titles joined by `;`, the second label
in brackets), a `| media | n finished |` row under habits and a `## media`
section (count per type, then the titles) in the weekly and monthly reports,
and the parser reads the rows back so pasted notes feed them. The evening
form shows the day's media as chips under the blocks — DO's list for the real
today, ticked ones selected in the label colour, tapping goes through DO so
Todoist follows. Deliberately **not** a block: a title is not a focus block
and would eat the six-block cap.

**The settings page scrolled to the top on every app switch.** Two causes.
`Shell.rebuild()` re-appends every `.view` to re-order the track, and moving a
scroll container out of the document resets its scroll; the app list sits
well down the layout panel, so every toggle landed at the top. It saves and
restores each slide's `scrollTop` now, and the settings handler wraps its own
re-render in `keepScroll()`.

**The pill no longer takes the whole bottom.** `data-tabs="many"` is gone
from Prefs and `shell.css`; the pill stays at its phone width and the arrows
are always there. The apps that do not fit are switched off under appearance
→ layout and appear on the settings home as tiles (their tab icon, name and
hint); tapping one opens its slide — `Shell.open()` puts it into the track
just before settings with no tab button, and `retire()` takes it out again
once you have moved on. `#tend` in the address bar opens a hidden app the
same way.

**Settings is a menu now.** The home screen: the apps out of the bar, then
three categories. **apps** is the pill bar do / log / plan / store / tend /
track / learn, each panel ending with that app's content editors (the content
panel is gone — `do.routines` under do, `log.blocks` under log, and so on).
**appearance** is look / layout / behaviour. **data** is the one panel, no
pill bar. A category is a sub-screen with the same sticky back header the
apps use; `#settings/<panel>` still deep-links.

**Verified** — `test/harness.mjs`, 136 checks, all green: the media tab in
the right place, hidden on daily; three groups in red / blue / green with the
album chip on the music tile; tick → closed in Todoist, filled, in the log
with kind and sub-label, in the note as `media_music | Blonde (album)`, on
the evening form selected in green with its caption; untick reverses all of
it; the weekly and monthly rows and sections, parsed notes fed back, no
section on an empty day; the settings home with three categories; two apps
kept, five listed; opening TEND from the home puts it before settings with
no tab, leaving it retires the slide; the apps category with seven pills and
DO's editors in DO's panel; data without a pill bar; look under appearance;
back to the home. **Not verified**: nothing in a browser — the Chrome
extension was not reachable. The scroll fix in particular is browser-only
(jsdom's `scrollTop` is always 0), and the eight-app pill at 240px with the
arrows back deserves a look before deciding which apps to leave in it.

### 2.7 — 2026-09-02 — DO polish

**Space under the blocks.** A `.tt` section had a top margin and no bottom
one, fine while it was last; with the blocks first the routine grid sat flush
under the tiles. Both sections own their space below now, and the tile grid
wraps to as many rows as the day has tasks (three across on a phone).

**"hide done"** in the blocks header, where "refresh" sits on the today list.
Finished tiles drop out, the count stays, "all done" is said when nothing is
left. Persisted in `do_todoist_v1.blocksHideDone`.

**Progress bars tinted by progress.** Every DO bar — routine cards, the
checklist, the travel card, each travel list, each open list — runs from the
foreground colour at nothing done to green at everything done
(`color-mix(--gr N%, --tx)`, inline). The foreground rather than white so a
light theme's white card still shows the bar.

**Done tiles.** The small check box in the tile's corner sat on the text. Gone:
a finished tile fades its text back into the surface and draws one large tick
across the whole tile in the label's colour. CSS only; the markup and the
harness are unchanged.

**Verified** — `test/harness.mjs`, 111 checks, all green, including the
hide-done toggle both ways and the tinted bar. **Not verified**: the tint on
a light theme, and the full-tile tick.

### 2.6 — 2026-09-02 — DO's home, arranged

**Sections in any order.** DO's first tab has three sections — the block
tasks, the routine cards, the today list — and Settings → do → "home layout"
moves them up and down (`do.sections` in Config; blocks first by default).
The order is applied by moving the three real elements under the header, so
nothing else knows about it. **Only the first tab** shows the today list and
the blocks; "other" is for the odd routines.

**Block colour is the task's other label.** A planned task carries a slot
label (@b1…) and a subject label (@curate, @home…); the tile takes the
subject's Todoist colour and shows `@b1 · curate`. A task with no second label
keeps the slot label's colour.

**Section names on every today row, in the project's colour.** A
whole-project rule now fetches the project's sections and names each task's
own; the chip is tinted with the project's Todoist colour.

**The active tab's badge is the icon.** On the selected tab the count takes
the icon's place in the on-accent colour (`has-badge` on the button, set by
`Shell.badge`); on idle tabs it is the small pill as before.

**Verified** — `test/harness.mjs`, 108 checks, all green: blocks first in the
DOM by default and moved by `moveSection`; the today list and blocks hidden on
"other" and back on "daily"; the active DO tab carrying `has-badge` with the
count; a whole-project rule naming the section in `#4073ff`; a task labelled
@b1 + @curate drawn in grape (`#884dff`) with `@b1 · curate`. **Not verified**:
none of it on the phone; the count-as-icon in particular deserves a look with
tab names switched on.

### 2.5 — 2026-09-02 — the phone pass: what the first look on a real phone turned up

Four fixes from the phone, one removal, one addition.

**The caps switch did nothing.** 2.0 expressed "uppercase labels off" as an
override list of fourteen classes; the app sheets carry 113 `uppercase`
declarations. Every one now reads `text-transform:var(--caps)` (rewritten
mechanically, `tokens.css` sets `--caps:none` under `[data-caps="off"]`), and
the override list is gone. A new label must use the token.

**Fonts grew on rotation and stayed grown.** iOS Safari's text-size-adjust
inflates some text in landscape and keeps it on the way back.
`-webkit-text-size-adjust:100%` on `<html>` pins it. And since the app is not
meant to rotate at all: Settings → behaviour → "stay in portrait" (on by
default) draws a curtain over a phone-sized touch screen in landscape until
it is turned back, and calls `screen.orientation.lock` where a platform
honours it (Android, installed). iOS cannot be locked from a page; the
curtain is the lock there.

**The badge inverted badly on the active tab.** It sits on the ground colour
with an accent ring there now, instead of flipping to on-accent.

**Todoist label chips removed** from the today rows; priority, overdue date,
section and the tend tag stay.

**Block tasks on DO.** Under the today list, every open task due today that
carries one of PLAN's block labels (`plan.blocks`: @b1 @b2 @b3) is a tile in
the label's own Todoist colour (`/labels` gives the colour name; a table maps
Todoist's twenty names to hex). Ticking fills the tile with a check, closes the
task in Todoist and writes the task name into today's LOG record as a completed
block — straight to storage, so it is in the note whether or not the evening
form is opened — and LOG's evening form shows it selected, in the same colour,
among the planned chips. Unticking reopens the task and takes the block back.
Cached per day in `do_todoist_v1.blocks`, same rule as the today list; counted
in the badge; switchable under Settings → do.

**Verified** — `test/harness.mjs`, 102 checks, all green: the portrait and
caps attributes; a block task due today drawn as one tile in `#af38eb` with
its @b1 tag while a tomorrow one is not; no label chips; the tick closes the
task, fills the tile and lands in today's log; the evening form shows it
selected in the label colour; the untick reopens and deselects. **Not
verified**: the curtain, the badge on the active tab and the tiles have not
been seen; the caps switch has not been looked at on every screen.

### 2.4 — 2026-09-02 — TEND on Todoist and on DO, the open count, study in the reports

**TEND pushes today's round to Todoist.** Each plant due today becomes one
task — "water basil" — in a project and section set under Settings → tend
(default `04 | life` › `home | chores`), with a label (`home`), a priority (p2)
and today's due date. A tick anywhere closes it everywhere: TEND's round, the
detail sheet, DO's today block and Todoist itself. Undo, deleting today's
entry or unticking on DO reopens it. Todoist → TEND works on sync: a task
pushed today that is no longer open and that TEND did not close itself was
completed over there, so the care event is logged. The pushed ids live in
`tend_todoist_v1`, outside `tend.v3`, because `normalise()` would drop them.
Sync only ever adds and closes. It runs quietly from `onShow` when older than
ten minutes, and from the ⇅ button on TEND's home or "sync now" in its panel.
`Todoist` in `shell.js` is the shared client (call, getAll, resolve by name,
due date); DO keeps its own because of the proxy option.

**The plants are on DO's today block.** Drawn from TEND directly, with the
glyph, the label and priority as chips and a "tend" tag, pushed or not
(Settings → tend → "show due plants on DO"). A fetched task TEND pushed is
dropped by id, so nothing is listed twice. The block now shows when either
source has something.

**An open count on the DO tab.** `Shell.badge('do', n)` puts what is still
open today — Todoist tasks plus plants — on the tab button, and DO's date
line says "· n to do". Zero removes both. On the wide rail the badge sits at
the row's end.

**Study in the weekly and monthly reports.** A `| study | n topics · n cards |`
row under habits and a `## study` section (topics finished, cards rated and
acquired, the topic titles as a list). A day parsed from Obsidian uses its
note's `cap_*` / `anki_*` rows; a local day asks TRACK and LEARN directly.

**Verified** — `test/harness.mjs`, 93 checks, all green, including: the fern
due on TEND's list; one sync creates a task with the right project, section,
label, priority and due string against a scripted Todoist and records its id;
the plant on DO's block with `@home` and `p2`; the badge and date line at 1;
ticking on DO logs the watering and closes the task, the badge clears;
unticking removes it and reopens the task; a task completed in Todoist is
logged on the next sync and shows ticked on DO; the weekly and monthly reports
with the study row, section and a topic title from local data, and from a
pasted note. **Not verified**: nothing in a browser and nothing against real
Todoist. The badge and the plant rows have not been seen.

### 2.3 — 2026-09-02 — two phone bugs and three links between the apps

**Decimal fields could not be typed on the phone.** Weight, sleep hours and
the two km fields were `type=number inputmode=decimal`; the French keypad's
decimal key is a comma, and iOS refuses a comma in a number field, so the
value silently stayed empty. They are `type=text inputmode=decimal` now (STORE's
budget too), the shell swaps the comma for a dot as it is typed, and LOG's
save normalises again on the way to storage. The stored strings are unchanged
in shape, so the `.md` and the reports are untouched.

**Scrolling the theme gallery applied a theme.** A finger scrolling the look
panel fires `pointerover` on every card it crosses, which previewed each one,
and `:hover` sticks to the last card after the finger lifts, so the preview
was never reverted: the app changed to a theme that was neither saved nor
marked selected. Preview is mouse-only now (`pointerType`), `pointercancel`
reverts, and a tap still picks.

**Today's tasks from Todoist, on DO.** A block under the routine cards, not a
card: the open tasks due today (and overdue, switchable) in the projects and
sections listed under Settings → do, one per line as `project > section`.
Each row shows the priority (`p1`–`p3`), the labels and the section; overdue
rows are flagged. Ticking closes the task in Todoist, unticking reopens it,
both optimistic with a rollback on failure. The day's list is cached in
`do_todoist_v1` so a closed task stays visible, ticked, until midnight — the
API does not return completed tasks, and without the cache there would be
nothing to untick. It refetches silently when the tab comes back after ten
minutes, and drops the cache on the day rollover.

**PLAN's plans on LOG's evening form.** Whatever PLAN queued or sent today is
offered under the block buttons as extra blocks, in the project's colour, with
the project / time block / estimate as a caption. Ticking one records the task
name like any other block, so it lands in the `.md` block table and in the
reports' block counts. PLAN records what it sent under `plan_sent_v1` for the
current day; the queue counts as planned too. Only drawn for the real today.

**TRACK and LEARN in the daily note.** A `#### study` table at the end of the
`## data` section: `cap_topics` (how many ticked that day), `cap_done` (their
titles), `cap_progress` (n/54), `anki_rated`, `anki_acquired`, `anki_decks`.
It appears only on a day that had either. TRACK reads it straight from its
ticks, for any date; LEARN keeps a per-day tally in `learn_daily_v1` because
its cards are in IndexedDB and the note is built synchronously. The Output
screen tags the day with "n topics" / "n cards" as well.

**Verified** — `test/harness.mjs`, 80 checks, all green, including: a comma
typed into the sleep field becomes a dot and a comma pasted without an input
event is still saved as a dot; a touch `pointerover` on a theme card leaves the
theme alone while a mouse one previews it; the today block against a scripted
Todoist (due + overdue shown, future and dateless not; priority and label
rendered; close → reopen calls; a closed task kept ticked across a refresh;
the cache in `do_todoist_v1`; off hides it); a queued PLAN task offered and
recorded as a block; the study section with two topics and two ratings, its
tags, and its absence on a day with neither. The harness now rolls the clock
back to the real day after the midnight test. **Not verified**: none of it in a
browser; the today block has not been run against real Todoist; the comma fix
has not been typed on an actual iPhone keyboard, which is the only place it
matters.

### 2.2 — 2026-09-02 — TEND, TRACK and LEARN join the track

The three remaining standalone apps (`tend/`, `track/`, `learn/`) are in ROOT.
Same method as 1.0 — a port, not a rewrite: each is one IIFE under its own
`.ns-*` namespace, its storage keys untouched so the standalone copy keeps
working off the same data. The difference from 1.0 is that 2.0's rules applied
from the first line: every literal each app carried is a Config branch with an
editor, every stylesheet was written against the tokens, and each app's
settings screen became a settings panel.

**Eight slides do not fit a five-tab pill.** Rather than cram them in, which
apps have a tab and in what order is now a preference (`apps`, under layout →
"apps in the bar": a switch and up/down per app). The shell builds `TABS`, the
slide order and the nav from it — `Shell.rebuild()` re-orders the real DOM by
`id="view-x"` / `data-app="x"`, so nothing anywhere depends on position any
more: the tab click handlers, the colour-coded tabs in `themes.css` and the
start-tab chips were all positional and are keyed by app now. With seven or
more tabs Prefs stamps `data-tabs="many"` and the pill goes to the viewport
width with tighter labels and no arrows (they would sit on top of it; swipe,
tap and `1`–`9` cover the same ground). Six or fewer look exactly as before.

**TEND.** Its sheets moved out of the track onto the frame's `.sheet-back` /
`.sheet`, which is how they get Escape and the keyboard lock for free. The
fixed "add plant" bar became a sticky one inside the slide, the toast is
`Shell.toast`, the undo pill is a sibling of `#toast` at the same spot. Made
editable: the plant types (with their seasonal weight and note), the three care
tasks' names, the growth curve, the season names, the feeding cut-off, the
round thresholds (when a task is "coming up", how late is red, list length,
undo window, history depth), the new-plant defaults, and the shelf's default
sort. The starter list is Config too, used on a first-ever install and by
"reset to starter plants". Its date label follows the date-format preference.

**TRACK.** The 54-topic curriculum, the phase names, the level word, the PSE
row and the revision reminders are Config; the curriculum deliberately has no
editor (the ticks are filed under its ids). The start date, which the
standalone kept in state but never showed, is a setting now, alongside the
exam, the internship, the buffer, the lead and the pace factor; the pace window
and the "next up" count are new knobs. The chart's SVG text lost its hardcoded
font-family and follows `--mono`. Hardcoded 12–16px radii are ratios of
`--r-base`, so a "sharp" preset squares TRACK too.

**LEARN.** JSZip, sql.js and fzstd are fetched the first time an import starts
and never otherwise — ROOT stays dependency-free until you bring a deck in.
The four rating names are Config; the session shape (cap, card text size,
back-first, tags under the card) is Config and sits in the learn panel next to
the shuffle flag, which stays in `learn_settings` for the standalone app. Where
IndexedDB is missing the home screen says so instead of throwing. The data
panel, the storage report and the learn panel all say the decks are not in the
backup file, because they cannot be.

**A latent 2.1 bug, fixed while porting.** The content editors for LOG's curate
counters and scale endpoints pointed `data-cfg` at `log.curate.mix` with
`data-sub="label"`. Overrides are whole-branch, so the first keystroke overrode
`log.curate` with `{ mix: … }` and the other two counters vanished from the
evening form until a reset. `data-sub` walks dotted paths now (`mix.label`
against `log.curate`), the LOG editors use that shape, and TEND's task editor
was written against it. Number and range inputs bound this way store numbers.

**Smaller.** `Prefs` gained a `list` kind (known ids, deduplicated, never
empty) and copies array defaults so a list pref never aliases the schema.
`Prefs.reset()` goes through `defaultsOf()` for the same reason. A number field
inside a `.setting-row` is a small right-hand box rather than the full-width
form field. `data-numlist="all"` keeps zeros (the growth curve may have one);
`data-lines` splits a textarea into a list. Twelve panels in the segmented
control, which already scrolled. The manifest description names all seven.

**Verified** — `test/harness.mjs`, 63 checks, all green: everything from 2.1,
plus the three modules booting with no errors, the three panels, `5`/`7`
jumping to TEND/LEARN, the app list re-ordering the track and hiding a tab and
resetting, a plant saved through the real editor landing overdue on the round,
ticked, undone, its detail sheet closed by Escape, a round threshold read from
Config, a topic ticked into `capTracker.v2` under its id, the next-up count and
a panel date setting, LEARN's no-IndexedDB path, rating names from Config, and
no library `<script>` present without an import. **Not verified**: nothing has
been seen in a browser. Specifically unchecked by eye: the eight-tab pill at
phone width (the whole point of `data-tabs="many"`), TEND's sheets at 78vh with
the long editor, TRACK's chart at the five radius presets, LEARN's card face at
the scale extremes, and the three apps under the five light presets. An actual
`.apkg` import has not been run through the lazy loader.

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
