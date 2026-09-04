# ROOT — manifest

> **Read this before editing anything in `root/`, and update the Changelog at the
> bottom in the same commit as every change. No exceptions, including one-line
> fixes.** This file is the map; if it goes stale it is worse than nothing.

---

## 1. What ROOT is

Eight small single-purpose tools that share one phone, one frame and one set of
storage keys. It is a static site — no build step, no framework, no dependencies,
no network except the Todoist calls you explicitly ask for (and, only when you
import an Anki deck, the three libraries LEARN needs to unpack it). Open
`index.html` over http(s) and it runs.

| Tab       | Does                                                                   |
| --------- | ---------------------------------------------------------------------- |
| **DO**    | Daily routine checklists + travel packing lists. Closes finished routines in Todoist. Also the `@quick` cards and the consistency strip. |
| **LOG**   | Morning/evening daily log → an Obsidian-shaped `.md` note, plus history and weekly/monthly reports. Its home is one screen: a month of days by how much of each was written, a fortnight of energy, mood and stress (tap it and it opens over the month, with axes), then the doors. Its tab wears a `!` while a half of the day is unwritten. |
| **PLAN**  | Builds a queue of tasks against a project/section tree, then pushes the batch to Todoist. A queue can be saved as a preset. Picked rows of the sent history export back out as one day's schedule — see §8. |
| **STORE** | Grocery list with auto-categorisation, an in-store spend counter (pinnable to the top of the page), premade meals, trip history. |
| **TEND**  | Plant care: today's round by room, a shelf of every plant, an append-only care log that stretches intervals with the season. |
| **TRACK** | The CAP Électricien plan: 54 topics ticked with a date, a derived pace, and the trajectory against exam, internship and revision. |
| **LEARN** | Anki `.apkg` decks studied on the go: rate cards, read the scoreboard, drill what needs work. |
| **DAY**   | The day PLAN exported, drawn as a calendar: the template resolved to clock times, the picked tasks in their slots, each row in its project's colour. Stepped left and right through the days that are planned. Written at export time and read from nowhere else — see §9. Its id is `cal` everywhere that is an identity; **DAY** is only what it is called. |
| **Settings** | A home menu (search, the apps kept out of the bar, then three categories), and behind it eleven panels: one per app (its settings, then its content editors), look / layout / behaviour, and data. |
| **Search** | Not a tab: one sheet over the lot, opened with `/` or from the settings menu. Apps, Config content, each app's own data, and every settings dial by name — see §3. |

Which of the eight get a tab, and in what order, is itself a setting
(appearance → layout → apps in the bar). Settings is always last. An app
switched off keeps its slide and opens from the settings home.

That list is stored whole, so a *new* app needs `Prefs.appsSeen` to reach an
install that already has one — see §6, which is the trap CAL walked into.

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
│   ├── learn.css      │
│   ├── cal.css        ┘
│   ├── shell.css      the frame: slide track, floating chrome, responsive rules
│   └── settings.css   the settings view
└── js/
    ├── prefs.js       appearance + behaviour engine   (loaded from <head>)
    ├── config.js      the content layer
    ├── shell.js       Creds, Shell, the slide track, swipe, keyboard
    ├── do.js  log.js  plan.js  store.js  tend.js  track.js  learn.js  cal.js
    ├── settings.js    the settings view
    └── search.js      the search sheet — reads SET's index and every module's hook
```

### Load order — this is load-bearing

```
<head>   prefs.js          stamps the look on <html> before the first paint
         tokens.css → do → log → plan → store → tend → track → learn → cal
                    → shell → settings → themes.css
<body>   config.js         content exists before any app reads it
         shell.js          defines Creds + Shell.toast, used by every module
         do / log / plan / store / tend / track / learn / cal
         settings.js       needs every module to exist to render its panels
         search.js         reads SET.searchIndex() and the modules' search hooks
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
`TEND` / `TRACK` / `LEARN` / `CAL`, and each does its DOM lookups through a
scoped helper:

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
and that is the one listener that reaches all of them. CAL is built the same
way and for the same reason — its markup is in the slide and in the settings
panel, and a day name interpolated into an inline handler is one more thing to
get wrong.

Any *user-editable* value that is interpolated into an inline handler —
`onclick="LOG.toggleBlock(this,'…')"` — goes through the module's `attr()`,
which escapes it as a JS string literal and then as an HTML attribute. `esc()`
alone is not enough: a block called `it's` was a syntax error in every handler
on the evening form.

### What the shell gives every module

```js
Shell.toast(msg)                       // the one toast
Shell.today()                          // local YYYY-MM-DD — the only definition of "today"
Shell.confirm(msg, onOk)               // the app's own dialog; honours "confirm before clearing"
Shell.confirm(msg)                     // …the same question as a promise, for async callers
Shell.prompt(msg, value, onOk)         // the same dialog with a field in it
Shell.ask({ title, body, input, yes, no, danger, done })   // the dialog itself
Shell.settings(panel)                  // jump to a settings panel ('general' still maps to 'data')
Shell.badge(name, n)                   // a count on a tab button
Shell.alert(name, on, why)             // the app's icon replaced by a "!" — LOG uses it
Shell.register(name, { onShow, onDayChange, onMinute, home, search })
```

**Asking is not synchronous.** `Shell.confirm` opens `#ask` and returns; what to
do next is the second argument, or the promise it answers with when there is no
second argument. A `confirm()` or `prompt()` anywhere in a module is a bug — see
§6 — and a harness check reads every module and fails on one.

`Shell.ask` is the dialog underneath both, for the questions that are **not**
about clearing and so must be asked whatever "confirm before clearing" says:
LOG's "go back without saving?", its import, the data panel's restore, PLAN's
unmapped project. `Shell.confirm` is only for the ones that setting is allowed
to wave through.

`onShow` fires on every visit to the tab. `home` fires when the app's own tab
is tapped while it is already showing (go to the home screen; LOG checks for
unsaved input first). `onDayChange(iso)` fires when the
calendar day changes while the app is open — the shell checks on
`visibilitychange`, on window focus, on every tab change and once a minute.
DO moves to the new day's record; LOG moves its selected day only if it was
"today" and no form is open (an evening written at 00:10 belongs to the day
that just ended). Nothing else captures "today" at boot any more.

`onMinute` rides the same tick as that day check — one timer, not one per app —
for anything that has to notice the clock moving without being on screen. LOG's
alert is the only user: it turns on as 10:00 and 21:00 pass, whichever tab you
are on. `search(q)` answers with what that app holds outside Config, as
`{ title, sub, go }` rows; `q` arrives folded (lower case, accents dropped).

### Search

`js/search.js` — a `.sheet-back` sheet, a sibling of `#views`, opened with `/`
or from the row at the top of the settings menu. Four sources, in the order
they are offered:

| Source | Comes from | Tapping it |
| --- | --- | --- |
| the apps | `Shell.APPS` | opens the tab, or `Shell.open()` if it is out of the bar |
| each app's own data | the modules' `search` hooks — DO's travel lists, TEND's plants, LEARN's decks | opens that thing |
| content | `CONTENT` in search.js, one line per Config path | the panel whose editor owns that path |
| settings | `SET.searchIndex()` | `Shell.settings(panel)` |

**Nothing in it is a second list of what exists.** The settings index is built
by rendering the three generated panels into a detached node and reading the
labels off the controls themselves (`lookHTML()` / `layoutHTML()` /
`behaveHTML()` exist for that reason), and walking the app panels where they
stand; content comes out of `Config.get()` on the spot. A dial added to
`Prefs.SCHEMA` and a routine renamed this morning are both findable without a
line being added here — which is the only way an index like this survives
contact with the next six months.

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
| `--mo` | Motion + Animation speed | `--dur-1/2/3` all multiply by it. It is `--mo-base` (the preset, an attribute) times `--mo-scale` (the speed dial, an inline property) — split so the two compose, and because a *speed* runs the opposite way to a *duration*: Prefs writes 1/speed |
| `--press` | (not a dial) | the wash under a finger. One token so `[data-scrolling]` can take it to transparent for the length of a scroll — see §6 |
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
| `do_<YYYY-MM-DD>` | DO | one day's routine ticks (older days are swept on the first load of a new day — folded into `do-stats-v1` first) |
| `do-stats-v1` | DO | the rolling routine tally, `{ days: { iso: { routineKey: [done, total] } } }`, capped at 400 days. **Deliberately hyphenated**: the day sweep matches `do_`, and a summary the sweep can reach lasts one day. Same reasoning as `log-scale-v2` |
| `do_todoist_v1` | DO | DO's Todoist target + a mirrored token, since 2.3 the today-tasks block's filter and its cached list for the day, since 2.5 the block tiles, since 2.8 the media tab's switch and cached list, since 2.19 the quick cards' switch and their cached tasks with subtasks |
| `travel_state_v2` | DO | every packing checklist (`travel_state_v1` migrated once, on read) |
| `log_<YYYY-MM-DD>` | LOG | one logged day (`e.media` since 2.8: the titles finished on DO's media tab, `{ name, kind, sub }`) |
| `log-scale-v2` | LOG | the 1–3 → 1–5 rescale flag. **Deliberately not `log_`-prefixed** — `allLogKeys()` would treat it as a day |
| `log-alert-seen-v1` | LOG | `{ plan: <iso> }` — the day PLAN's "nothing planned for tomorrow" prompt was last dismissed by opening PLAN. The only alert state that is stored rather than derived; hyphenated for the same reason as `log-scale-v2` |
| `plan_queue` / `plan_mappings` / `plan_projects` / `plan_token` | PLAN | |
| `plan_sent_v1` | PLAN | what was sent **for today** (name, project, block, time) — LOG offers these as blocks; a new day starts it empty. Since 2.18 a task sent for another day is deliberately absent |
| `plan_history_v1` | PLAN | the standing sent history behind PLAN's "sent" list — every task ever pushed, newest first, capped at 200, each filed under the day it is *due*. **Deliberately not `plan_sent_v1`**, which is emptied every morning |
| `plan_export_v1` | PLAN | the day start time the export last used, and nothing else. The date, template, mode, notes and slots are deliberately *not* kept: each export is its own day, and only the start time is the same one every time |
| `learn_daily_v1` | LEARN | per-day tally of cards rated / acquired / per deck, last 60 days — LOG's note reads it, the cards themselves are in IndexedDB |
| `store_state_v1` | STORE | list, cart, budget, history, Todoist target (`eat_state_v1` read once) |
| `tend.v3` | TEND | plants, the care-event log, season sensitivity and shelf sort (`tend.plants.v2` migrated once, on read) |
| `tend_todoist_v1` | TEND | Todoist target (project, section, label, priority), the push/show switches, and the ids of the tasks pushed today. **Not inside `tend.v3`**: both apps' `normalise()` rebuild that record from its known keys and would drop it |
| `capTracker.v2` | TRACK | ticks by topic id, the dates, which levels are open. `capTracker.weeks.v1` is surfaced and **never migrated** |
| `learn_settings` | LEARN | the shuffle flag. **Decks, cards and media are in IndexedDB `learn_v1`**, not localStorage — see §6 |
| `cal_days_v1` | CAL | the exported days, `{ days: { iso: { start, template, mode, notes, written, events } } }`. Written only by PLAN's export; swept behind by the keep dial and never ahead. **Deliberately not `plan_`-prefixed**: the storage report files it under CAL and PLAN's own clears must not reach it |
| `root_todoist_v1` | shell | **the** Todoist key, mirrored into the three legacy keys on save |
| `root_labels_v1` | shell | the Todoist label colours (`{ fetched, colors:{ name: hex } }`), filled by DO's fetches and `Todoist.labels()`, read by DO and PLAN |
| `root_tab` | shell | last tab, so a reload lands where you left |
| `root_theme` | shell | legacy; kept in step with the active theme for the standalone apps |
| **`root_prefs_v1`** | Prefs | every appearance and behaviour setting, plus `appsSeen` — every app this install has ever been offered, which is what lets a new app arrive (§6) |
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
- **LOG's field names are frozen.** `cur_mix`, `cur_prod`, `cur_cont` and the two
  caffeine counters are fixed slots with *editable labels*. Renaming the label
  changes what you see; the record and the `.md` are untouched.
- **The medication slots are `log.meds`'s keys, and the keys are the contract.**
  The record writes `meds_<key>` and the `.md` exports one row per key, in the
  order Config holds them. A key is never renamed and never removed; a label is
  free. **Adding one is additive** — a note written before it simply has no row
  for it, the parser looks rows up by name, and `medsOf()` reads a missing slot
  as false. `m3` was added that way in 2.21. Nothing may go back to naming
  `lam` and `rit` by hand: the form, the export, the parser, the history pills
  and both reports all walk `medKeys()`.
- **`log.medsOn` hides a slot from the form and from nothing else.** Since 2.22
  a slot can be switched off (`m3` ships off), and `medsShown()` is what the
  evening form walks. Every other reader still walks `medKeys()` — exactly the
  rule "turning a LOG field off never deletes data" already states. Do not be
  tempted to filter the export by it: a `.md` whose columns come and go is a
  `.md` the Obsidian side cannot parse.
- **A med's colour is `log.medColors`, written as `--med-c`.** There is one CSS
  rule for `.med-b.on`, not one per key. A slot with no colour falls back to the
  accent, so a fourth slot needs no stylesheet change at all.
- **The `.md` block table has a floor of six columns.** Lowering the block cap
  keeps the table identical (extra cells come out empty, as they always did on a
  light day); only deliberately raising it past six widens the table. The parser
  already reads a variable column count, so it round-trips.
- **Turning a LOG field off never deletes data.** The input keeps its value, save
  still reads it, the export still writes the column.
- **A tab icon is only doing its job if it is not another tab's icon.** 2.21
  gave DAY a sun — a circle with eight radiating strokes — which is exactly
  what the settings gear was. At 19px they were one mark. Settings wears
  sliders now; the sun belongs to the app that is about a day. A harness check
  takes a signature of each `tab-*` symbol's shapes and fails on a duplicate,
  which is what catches this without anyone having to look at the bar.
- **An arrow in this app is drawn, never typed.** `←` and `→` as text are at
  the mercy of whichever font is loaded, sit off the optical centre, and ignore
  the Icon weight dial. DAY's stepper uses `#ico-chev-l` / `#ico-chev-r` — the
  same pair the nav's own arrows use, at the same 17px.
- **Never open a selector inside the `:root` block.** An override of a token
  goes after the block closes, beside `[data-caps="off"]`. 2.21 added the blur
  override inside it, which closed `:root` early and left every token below
  `--chrome-blur` — `--title-base` and `--caps` among them — applying only
  while blur was off; the whole app went lower case with miniscule wordmarks.
  **jsdom does not cascade**, so all 411 checks passed against it. The three
  checks that catch this read the file's shape: every shell token inside the
  `:root` block, an override being a rule of its own, and the braces balancing.
- **`color-mix()` and `zoom` are both used unpolyfilled.** Baseline in every
  browser that matters since 2023/2024. Where `zoom` is unsupported the page
  simply renders at 100%.
- **"Today" can change under you.** DO's `TODAY`/`SK` and LOG's `REAL_TODAY` are
  `let`, re-derived by `rollDay()` when the shell's day check fires. Never copy
  them into another module-level constant, and never build a day key from
  `new Date().toISOString()` — that is UTC, and in France it is yesterday until
  01:00 or 02:00. Use `Shell.today()`.
- **A `confirm()` or `prompt()` in an app module is a bug**, and since 2.22 so is
  one anywhere else: they are the *system's* dialogs, in the platform's
  typeface, ignoring every dial in Settings. `Shell.confirm` / `Shell.prompt` /
  `Shell.ask` are the app's own. Two harness checks enforce it — one greps every
  module, one counts anything that reaches `window.confirm` during the whole
  run and fails if it is not zero.
- **`Shell.confirm` takes what to do, it does not answer.** The dialog is an
  overlay, so the answer arrives on a tap, not on the call. `if (!Shell.confirm(…))
  return;` is the shape that no longer works; it is
  `Shell.confirm(msg, () => { … })`, or `await Shell.confirm(msg)` where the
  caller is already async (DO's defer, LEARN's four). Getting this wrong is
  silent: the guard is falsy, the function returns, and the action simply never
  happens.
- **A numeric field is answered by the app's numpad, not the keyboard.** The
  shell claims any `input` that is `type=number`, `inputmode=numeric` or
  `inputmode=decimal` (see "The numpad" in `shell.js`). `data-pad` overrides the
  inference: `duration` (720 → 7h20m → 7.33), `clock` (930 → 09:30) and `off`.
  A field that takes text is untouched, which is the whole distinction. The
  first digit after the pad opens *replaces* the value; backspace continues it.
- **The field the pad owns is never focused, and that is load-bearing.** 2.22
  focused it and suppressed the keyboard with `inputmode="none"` — a *hint*,
  which iOS honours for drawing the keyboard and not for the rest of what it
  does about a focused field: it still scrolls the field into view and still
  shrinks the visual viewport for a keyboard that never comes. A
  `position:fixed` pad drawn against a viewport that has moved under it has its
  keys somewhere other than where they look, and 2.22 shipped exactly that — you
  tapped a key and got the one above it. The tap that opens the pad is
  `preventDefault`ed instead: no focus, no keyboard, no scroll, nothing moves.
  `inputmode="none"` is still set for a field reached by Tab, and the original
  lives in `data-pad-im` so switching the pad off hands it back.
- **The pad's keys fire on `pointerdown`, not on `click`.** A click on touch is
  synthesised, can be suppressed by anything that prevented a default earlier in
  the sequence, and arrives late. The `click` handler is kept only for a
  keyboard user pressing Enter on a focused key and is de-duplicated against the
  pointerdown by timestamp.
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
- **A press wash says `var(--press)`, never `var(--s2)`.** On a touch screen
  `:active` is applied the moment the finger lands and is not cleared until it
  lifts, so a touch that turns into a scroll lights up whatever row it started
  on and keeps it lit as the list moves under it. The shell sets
  `data-scrolling` on `<html>` while any slide is moving (and for 160ms after,
  plus on any `touchmove`), and `[data-scrolling="on"]{--press:transparent}`
  takes the wash out. One token, so it reaches every `:active` in every app and
  any future one for free; 2.22.3 rewrote 22 of them. A tap that is a tap still
  lights up, because a tap does not scroll.
  The press rules that mix a *project's* colour (PLAN's tiles, DO's block
  tiles) are not on this token — their resting value differs per rule — so they
  can still light up under a drag. They are not in long scrollers, which is why
  it has not been worth the duplication.
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
- **Opening a project moves exactly two elements, and hides everything else.**
  Four releases were spent making this smoother by animating *more* of it —
  faster border fades, staggered rows, ghosts of the tiles that left — and every
  one was the same mistake in a different place. A screen where eight things
  move at once has no subject, and a gesture with no subject reads as a stutter
  however well each part is timed. The grid clears to the project's **name and
  its colour dot**, those travel and grow, and the new content appears after
  them. Three groups in `flip()`, and every element is in exactly one:
  the **movers** (`[data-flip-text]`, present in both snapshots), the
  **carrier** (the box they live in), and everything else. What leaves is simply
  gone on the first frame — which is right *because* everything that stays is
  invisible on that frame too, so the screen clears in one go rather than
  half-cutting and half-fading.
- **A mover carries its full delta; `data-flip-text` no longer subtracts.** The
  attribute used to name the box so the box's own slide could be taken off the
  text's. The box does not slide any more, so the text carries the whole
  distance; the attribute still names the carrier, which is what it is read for
  now.
- **A carrier is held *unpainted*, never faded.** `opacity` on a parent takes
  its children with it, and its children are the two things that must stay
  visible. Its border and background are animated from `transparent` with
  `fill:'backwards'` and a delay instead, so the box arrives with the rest of
  the screen. Its other children (`.proj-meta`) are held back like anything
  else — anything that *wraps* a mover is not.
- **No move when nothing travels.** Opening a section's form leaves the heading
  where it is; holding the screen blank for 400ms while nothing moves is a
  pause, not a transition. `travels` decides, and `moveMs` is 0 when it is false.
- **A `data-flip` key is an identity, and sharing one across two different
  elements is a bug.** The section rows once borrowed the keys of the tiles
  they replaced, to make the tiles look like they became the rows; what it
  actually did was fly each row in from that tile's position while squashing
  it to a tile's width, and the further the tile the worse it looked. Every
  element owns its key now (`p:` tiles, `sec:` rows, `form:` the panel,
  `queue`), so only genuinely persisting elements move and everything else is
  revealed. A harness check fails if a row carries a `p:` key again.
- **A box is never scaled.** Scaling a box scales its border, its radius and its
  padding with it and stretches everything inside; counter-scaling the children
  cannot fix that while the box itself is scaled. Since 2.22.2 the box is not
  animated at all — it is drawn at its new size and simply not painted until the
  move is over. (2.20.1–2.22.1 slid it and crossfaded its border under the move.
  That was better than scaling it and still one thing too many on screen.)
- **Text carries its own flip key and is never faded.** `.proj-name` and
  `.proj-dot` are `data-flip` elements in their own right and are the only
  things that move. The name you tapped stays on screen the whole way, which is
  what stops the two states reading as two different screens.
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
- **PLAN's history binding is `sentLog`, not `history`.** A module-level
  `history` inside the IIFE shadows `window.history` for the whole file,
  which is the sort of thing that breaks a `replaceState` added months later.
- **The `rest` template has four block slots, not six.** `b3a` and `b3b` do
  not exist on a rest day — those hours are `free time` — so the panel refuses
  a b3 assignment while `rest` is picked, and switching to `rest` drops any b3
  already given out, both with a toast. Anything that reads the slots takes
  them off the template (`slotsOf`), never from a list of six written down in
  code. The two templates otherwise differ only by the hour of gym, which is
  why every offset after it is exactly an hour earlier on a rest day.
- **A task holds a list of slots, not a slot.** Since 2.20.1 `expSlots` maps a
  task to an *array*: a job that runs over b1a and b1b is one task given two
  hours, and the description writes one line per slot — the same name twice.
  Tapping a slot the task already holds gives back that hour alone. A slot is
  still exclusive: another task is refused it, by name. Anything reading the
  assignment takes `r.slots`, never `r.slot`.
- **A slot is assigned, never derived.** Until 2.16 the `a`/`b` half of a
  block was inferred from the order the two tasks were sent in, and the task's
  own `@b1` label decided which block. Neither is true now: the six slots are
  named and tapped, and the label a task was sent with has no say in where it
  lands. `toggleSent()` therefore no longer caps two per block — the cap is
  the number of slots a day has, and the panel refuses a slot another task
  already holds rather than taking it away in silence.
- **The sent selection is keyed by `ts`, not by row index.** The list is
  unshifted on every send, so an index-keyed selection would quietly slide
  onto a different task. `renderSent()` also drops any key whose row has gone
  (a clear, or the 200 cap), or "export" would count what is not on screen —
  and `expRows()` drops that key's slot with it.
- **The export panel repaints itself from `expForm` on every draw**, the way
  the task form does — a Config edit or an arriving label fetch re-renders the
  whole grid under it. The three text fields are the exception in the other
  direction: they must *not* trigger a full redraw, or the caret leaves the
  field mid-word, so `expField()` repaints only the preview and the button.
- **A hidden box must be emptied.** `renderBlocks()` used to return early
  when the section was hidden, leaving the old tiles in it; anything counting
  `.bk` (the harness, but also a future badge) saw ghosts. Hide *and* clear.
- **`html` carries the ground colour too.** The fixed body does not paint the
  strip under the home indicator; the root does, and with `color-scheme:dark`
  and no background it paints black.
- **A queued task carries its own due date, and the queue can outlive the
  day it was built on.** `startSending()` sends `due_date`, the day picked on
  the form — never `due_string:'today'` resolved at send time. A task queued
  before 2.18 has no `date` and falls back to `Shell.today()`.
- **"Sent today" is now "due today".** `recordSent()` keeps a task out of
  `plan_sent_v1` unless its day *is* today, and `plannedToday()` filters the
  queue the same way, or planning tomorrow's morning would fill tonight's
  evening form. The history takes every task either way, filed under its due
  day — which is the day the row names.
- **A `formFields` key that is missing is "not asked", not "off".** An
  override is stored whole-branch, so one written before a row existed has no
  answer for it. `formFields()` in `plan.js` reads it through
  `Config.defaults()`, the editor renders the same merge, and the settings
  toggle flips what it is *showing* — without that last part the first tap on
  a never-seen switch sets it to what it already said. Safe for this branch
  because it is a fixed set of booleans: there is no deletion to express. Any
  other branch keeps the whole-branch rule.
- **The date stepper repaints itself, and only itself.** `stepDate()` /
  `resetDate()` call `paintDate()` rather than `renderProjects()` — a full
  redraw would run a FLIP on the whole grid for a one-word change. `paintForm()`
  calls it too, so a Config edit landing under the open form keeps the day.
- **DO's day sweep is where the history comes from, so it folds before it
  deletes.** `loadState()` calls `foldDay()` on every `do_` key it is about to
  remove. The fold uses the routine's length *as it is now* — the ticks are all
  that survive a sweep — so a routine that has since grown makes an old day look
  worse than it was, and a routine that has been deleted drops out of the tally
  entirely. `statsFor()` prefers the live record for today and falls back to a
  folded row, which is what makes a restored backup show up on the strip.
- **A DO key that is not a day must not be `do_`-prefixed.** `do-stats-v1` is
  hyphenated for exactly that reason; `do_todoist_v1` is the exception, and it
  is the exception because it is named in the sweep's filter by hand. Anything
  new goes the hyphenated way.
- **A quick task's subtasks are fetched by project, not by parent.** Subtasks do
  not carry `@quick` themselves, so `fetchQuick()` asks each distinct project a
  quick task sits in for all its tasks and files the children by `parent_id`.
  One call in practice. A quick task with no `project_id` at all gets no
  children — nothing in the v1 API returns them without one.
- **A subtask closed here is not returned by the API again, and is carried over
  by hand.** Without that, a card would shrink as it was ticked and `3 / 5`
  would never be reachable. Same rule as the media tiles, one level deeper.
- **Ticking the last subtask closes the parent.** Todoist does not, so a quick
  task would otherwise have to be finished twice; unticking one reopens it.
  Two requests, and the second only when the parent's state actually changed.
- **The quick cards are one column.** A card with subtasks is a checklist and a
  checklist at half width wraps every row, so the two shapes share a single
  column rather than the routine grid's two.
- **The quick cards do not feed the tab badge.** It counts what is due today —
  the today list and the block tiles. Quick is a backlog with no date, like the
  media tab, and a badge that counted it would never reach zero.
- **`Shell.alert()` is the only writer of a tab's icon**, the way `Shell.badge()`
  is the only writer of `.tb-badge`. It swaps the `<use href>` to `#tab-alert`
  and back to `#tab-<app>`; nothing else may write that attribute for an app
  button, and `paintNav()` deliberately only ever touches the settings button's.
  An app opened transiently from settings wears its icon on the settings button,
  where the alert does not follow it.
- **The alert is LOG's, but the "!" is not always LOG's.** Since 2.21 an
  unwritten morning or evening flags **LOG** and an unplanned tomorrow flags
  **PLAN** — a "!" on LOG that means "go and use the other app" pointed at the
  wrong door. LOG still owns all three rules, the hours, the preview and the
  only calls to `Shell.alert`; `alertReasons()` returns every rule that is
  firing (they are independent now) and `alertReason()` is the first of them,
  which is what the settings line reports.
- **LOG's alert is derived on a tick, never stored — with one exception.**
  `alertReason()` is recomputed from the real today's record, the clock and
  PLAN, so there is no state to go stale. `alertTest`, the settings preview, is
  the one thing that can make it lie, and it stays pinned until it is switched
  off and says so in the panel.
  The exception is **`plan`, which can be dismissed**. LOG's two rules clear
  themselves — writing the morning is what makes "morning not written" false —
  but "nothing planned for tomorrow" is a *prompt*, and the honest answer is
  often "I looked, and there is nothing to plan". So PLAN's `onShow` calls
  `LOG.dismissAlert('plan')` and the flag goes out for that day. It is the only
  stored alert state, it is keyed by the day it was dismissed on (so tomorrow's
  prompt is a new prompt), and it lives in **`log-alert-seen-v1`** —
  hyphenated, for the same reason `log-scale-v2` is: `allLogKeys()` matches
  `log_`. `alertReasons()` still answers whether a rule is *true*;
  `alertShown()` is what the tabs wear, and only that one is filtered.
- **"Planned for tomorrow" means PLAN's own queue and history.** `plannedOn()`
  counts tasks carrying a block and filed under that day. A block moved to
  tomorrow from DO's "→ tomorrow" is a Todoist edit ROOT keeps no local record
  of, so it does not count — which is worth knowing before wondering why the
  flag is still up.
- **A preset carries tasks, never a day.** `plan.presets` is a shape of day:
  `applyPreset()` dates every task from the form's own floor and re-resolves the
  project id from the current mapping, so a preset saved in September still
  lands correctly in March.
- **A control search can find is a control search can render.** `SET.searchIndex()`
  renders `lookHTML()` / `layoutHTML()` / `behaveHTML()` into a detached node, so
  those three must stay pure string builders — the moment one of them writes to
  the document again, indexing it moves the page. `sectionOf()` is iterative and
  depth-capped: the recursive version walked in a circle on `.set-panel` and blew
  the stack.
- **A hidden app opened from settings is a transient slide.** `Shell.open()`
  splices it into `TABS` before settings and re-parks the track before
  animating, because settings' index moves by one; `retire()` does the same
  in reverse 340 ms after you leave it. `paintNav()` reads `TABS` by name for
  the same reason — a cached button list would be one off.
- **A new app does not reach an install that already has an app list.**
  `Prefs.apps` is stored whole and replaces the default whole — the same rule
  Config uses for a branch — so adding `'cal'` to `Prefs.APPS` gave it a tab on
  a fresh install and *nothing at all* on any install that had ever opened the
  layout panel, which is every install that has been used. `appsSeen` is what
  tells the two cases apart: an app in `APPS` this install has never been
  offered is new and goes in, in its shipped position; an app missing from
  `apps` but present in `appsSeen` was switched off on purpose and stays off.
  The result is persisted at once, or switching the new app straight back off
  would be undone on the next boot. `APPS_BEFORE_SEEN` is the one-time fallback
  for installs written before any of this existed — a historical fact, not a
  list to keep up to date. Two harness checks boot a second jsdom window with
  prefs already in localStorage, which is the only way to run `load()` twice.
- **A stored calendar day is a record, not a live query.** Each event in
  `cal_days_v1` carries its own resolved clock time, calendar name and colour,
  so CAL never reads `plan.types`. Renaming or recolouring a project in March
  must not repaint a day planned in September — the day says what was planned,
  and there is a check for exactly that.
- **CAL stores the whole template, not what the export wrote.** `mode: blocks`
  sends the assigned slots alone, but the day still has the shape the template
  gives it. The rows the export left out are stored as `fixed` (a template
  event) or `idle` (a slot nobody claimed) and each can be switched off. A view
  built from the exported lines only would show a day with holes in it.
- **DAY's stepper is the newest thing `position:fixed` inside `#track` would
  have broken.** It is a sibling of `#views` with `.ns-cal` on it — so cal.js's
  one delegated listener still reaches it — and CSS shows it only while
  `#view-cal` carries `.cur`. Its arrows are therefore *not* inside the slide,
  and `paintSteps()` finds it with `getElementById`, not the scoped `$id`.
- **TRACK's pace counts from `trackFrom`, not from the first tick.** Ticks
  dated before it are the progress you already had when you set the app up:
  counted as done, kept out of the pace and drawn as the trend's starting
  height rather than a cliff in week one. Null falls back to `startDate`, so an
  install that never touches it behaves exactly as before, and `baselineNow()`
  moves the date to *tomorrow* rather than rewriting any tick's date — which is
  what makes it safe to press twice.
- **CAL is written on success, never on the attempt.** `doExport()` builds the
  day *before* it clears the panel's state, but hands it over only after the
  Todoist task lands. A day drawn for an export that failed is a day that is
  not actually scheduled, and telling those two apart at a glance is the whole
  point of the view.

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
`GROUPS` row for its storage keys, and its display name in `APP_NAMES` /
`APP_HINTS` (settings **and** `search.js` keep their own copy). `startTab`, the
app list and the shell's TABS all follow `Prefs.APPS` — and because `apps` is
stored whole, `appsSeen` is what actually gets the new tab onto an install that
already has an app list. That is automatic, but read the §6 note before
assuming a new tab appears: for CAL it did not. Use the `card` class on the app's raised surfaces so the depth
ramp and the card treatments reach them without a new class list in
`themes.css`.

**Make something findable in search** — nothing, if it is in Config: add its
path to `CONTENT` in `search.js` (one line: the path, the app, and how a row
reads) and it is found from then on. For data an app keeps in its own key,
register a `search(q)` hook with `Shell.register` returning `{ title, sub, go }`
rows. Settings controls need nothing at all.

**Test without a browser** — `test/harness.mjs` boots the real `index.html` in
jsdom (scripts loaded from disk, stylesheets and fonts skipped) and drives it
through DOM events: 524 checks covering boot, every theme and panel, the
behaviour fixed in 2.1, the three apps added in 2.2, the links and fixes of
2.3, the Todoist round-trips of 2.4, and the block and media tiles, the
settings menu, the back arrow, the title band, the cross-fade and PLAN's
in-place projects, form, sent history, day export and due dates of 2.5–2.18,
and search, DO's quick cards and folded history, PLAN's presets and LOG's tab
alert in 2.19, CAL and the new-app migration in 2.20, the multi-slot
export, the stepped day and the new transition in 2.20.1, and the app's own
dialog, the numpad's four readings, LOG's month and fortnight, DAY's stepper and
STORE's pin in 2.22. jsdom has no
layout and no Web Animations, so anything measured or animated is invisible to
it unless the harness stands in for both, as it does for PLAN's transition. A
throw part-way through prints every result that ran before it rather than
losing the lot. Run it before trusting any change:

```
cd root/test && npm install && node harness.mjs
```

jsdom does not lay out or paint, so it proves the DOM is built and the logic
runs, and proves nothing about how anything looks. Add a check for every
behaviour you fix; a bug that has a check does not come back.

---

## 8. The PLAN export

### Where ROOT stops

```
ROOT / PLAN            Todoist                22:00 cloud agent      Google Calendar
─────────────          ──────────             ─────────────────      ───────────────
[ export ] ──────────► task "@import"  ──────► reads description ───► writes events
 picked rows            description =          resolves times         then deletes
 + day options          the day spec           from the template      the task
```

**ROOT never touches a calendar.** It is a static page with no Google auth and
it is not getting any: no OAuth, no calendar API, no calendar ids. It writes
one Todoist task and stops. `plan.calendars` holds calendar *names*, which are
passed through verbatim for the agent to resolve. A harness check reads every
URL in `js/plan.js` and fails if one of them is not Todoist.

**CAL does not change that**, and §9 says so at more length: it is a local
drawing of what PLAN resolved before it sent the task, not a second window onto
Google. A harness check reads `js/cal.js` and fails on any URL, any `fetch(`
and any `XMLHttpRequest` at all — a stricter rule than PLAN's, because CAL has
no reason to talk to anything.

### The description — a contract

Frozen the way LOG's `.md` is frozen: the field names and the shape are not
user-editable, not renameable, and a downstream agent parses them.

```
day: YYYY-MM-DD
start: HH:MM
template: normal|rest
mode: blocks|full

<slot> | <project> | <task name>
…

notes:
- <one per line>
```

- `b1a | home | chores` means an event named **`b1a|chores`** on whichever
  calendar `plan.calendars` maps `home` to.
- `<project>` is the key ROOT resolved, so it is `curate > mixing` where the
  project splits across calendars and `home` where it does not. The agent
  looks that key up; it never sees an id.
- **Unassigned slots are absent.** No placeholder lines.
- **The whole `notes:` section is omitted** when there are none — never left
  as a bare header.
- The sections are separated by one blank line and there is no trailing
  newline. A harness check compares a mixed export byte for byte.

`mode: blocks` writes the picked tasks only. `mode: full` writes the whole
template and replaces the day; whatever is already on it is archived to
`00B | schedule 2` first, not deleted. That calendar name is the **agent's**,
not ROOT's — it appears once, in the warning text, deliberately not in Config,
because making it editable here would let it drift out of step with the side
that actually does the archiving.

### The two templates

`plan.dayTemplates`, editable under settings → apps → plan → content. Every
row is `at` minutes from the day's start and a duration in minutes, and is
either a fixed event (`cal` + `event`) or a block slot (`slot`). **Nothing is a
wall-clock time**, so one number — the start — moves the whole day.

| | `normal` | `rest` |
| --- | --- | --- |
| span | 17h00 | 16h00 |
| rows | 20 | 18 |
| block slots | b1a b1b b2a b2b **b3a b3b** | b1a b1b b2a b2b |
| gym | 1h, at +1:45 | — |

The two differ by exactly two things: the hour of gym, and the b3 pair. Losing
gym is why every offset after +1:45 is an hour earlier on a rest day, and the
b3 hours are `free time` there instead. `normal` and `rest` are identities —
the description writes the name down — so rename them and the agent stops
recognising the day.

### The panel

Drawn into PLAN's tile grid by `renderProjects()`, exactly the way the task
form is: no `.scr` of its own, opened from the sent list's title row once a row
is picked. Eight fields — date (tomorrow), start (the only thing persisted,
in `plan_export_v1`), template, mode, one slot row per picked task, notes,
preview, and one export button that names the count. Everything else resets on
each open: an export is one day, not a document.

Every refusal is loud, because the only alternative is dropping a task in
silence when the description is written:

| the tap | what happens |
| --- | --- |
| a seventh row picked | refused — a day has six slots |
| a slot the task already holds | given back, that hour alone |
| a slot another task holds | refused, naming the task that holds it |
| b3 while `rest` is picked | refused — those hours are free time |
| switching to `rest` with b3 given out | the b3s are dropped, with a toast |
| export with a picked task unassigned | there is no button; the panel says how many |

---

## 9. DAY (`cal`) — the day, drawn

### Its name is not its id

The tab wears **DAY**. The app's id is `cal`, and stays `cal` everywhere it is
an identity: `cal_days_v1`, `.ns-cal`, `Prefs.APPS`, `appsSeen`,
`data-panel="cal"`, the `p:`-style flip keys, the storage group's `match`. Only
the *labels* changed — the wordmark, the tab caption, `APP_NAMES`, `SEG_NAMES`
and the storage report's row. Renaming the id would have churned a storage key,
a namespace and the app migration for a word. Same split as
`plan.types[].key`: a label is editable, an identity is not.

### What it is, and what it is not

```
PLAN / export ──┬──► Todoist task "@import" ──► 22:00 agent ──► Google Calendar
                │
                └──► cal_days_v1 ──► CAL          (local, offline, read-only)
```

One action, two destinations. The right-hand branch never leaves the browser:
CAL has no network of its own, and unlike PLAN — which is *allowed* Todoist —
it is allowed nothing at all. It draws the day PLAN had already resolved a
moment earlier, which is why it costs no extra request and works with the phone
in flight mode.

**It is not a calendar client.** It cannot tell you what is really on your
Google calendar, only what ROOT asked for. If the agent failed at 22:00, CAL
still shows the day as planned — the same way PLAN's sent list shows what was
sent, not what survived.

### The record

`write(day)` is the only way in, and PLAN's `doExport()` is its only caller,
after the Todoist task lands. One entry per ISO day; re-exporting replaces it
whole, because re-exporting is how a day is corrected.

Each event carries its own resolved values — clock times from the one start
time, the calendar name, and the colour — so a stored day never has to ask PLAN
anything and is unaffected by later edits to `plan.types`. The three kinds:

| kind | is | drawn |
| --- | --- | --- |
| `task` | a picked task in the slot it was given | the project's colour, bold |
| `fixed` | a template event (routine, kamo, gym, break) | the calendar's colour from `cal.eventColors`, quiet |
| `idle` | a block slot nobody claimed | dashed and dimmed, named by `cal.idleLabel` |

`fixed` and `idle` are stored even in `mode: blocks`, where the export does not
write them: the day has that shape whether or not Google is told about it.
Each can be switched off — which is the one state where the drawing is empty
and has to say *which dial did it* rather than "nothing planned".

### The date up top, the arrows down below

The day's name sits in the **title band**, beside the wordmark, where every
other app puts its date — at a declared 32px height, because anything sharing
the wordmark's row that could grow past it makes this band the odd one out and
the title morph stumble.

The **stepper** is a fixed bar just above the nav, sharing the nav's chrome
treatment and hiding with it. Being fixed, it is a sibling of `#views` and not
part of the slide (§3, §6). Stepping walks the days that **exist** — the
planned ones plus today — not the calendar, so "next" never lands on a run of
empty days to click through. An arrow with nowhere to go is dimmed and disabled
*in place*: a control that disappears at the edge moves the one beside it.

It fades out after `calStepsHide` seconds idle (5 by default, 0 pins it) and
comes back on the first touch anywhere on DAY — `wakeSteps()` in `cal.js`. 2.22
also made it span the screen with two half-width arrows; 2.22.1 put it back to
the size it was, because that is a great deal of chrome for two controls and an
arrow whose edges you cannot see does not read as a button. It is **square**
now rather than a pill — `--r2`, the radius every other box in the app uses.
It is chrome, so it looked like the nav; it is a pair of controls, so it should
look like a pair of controls.

Both replaced a horizontal strip of day chips, which as a sideways scroller
inside `#track` needed its own `touch-action` to work under a finger at all.

**It opens on today.** `pickDefault()` used to return the nearest day that had
something on it, so a morning with nothing planned answered a question nobody
asked — "here is Thursday" — and you had to step back to find out that today was
empty. An app called DAY opens on the day it is; the stepper is one tap from
everything else. A day can also be cleared from its own head (`clearDay()`,
behind a confirmation), for a plan that was abandoned or exported to the wrong
date; the Todoist task it wrote is not ROOT's to withdraw and the question says
so.

### Lower case, deliberately — and the one thing that is not

DAY is the one app that reads lower case throughout. `Prefs.formatDate()` is
shared and capitalises, so it is folded in `cal.js` rather than changed there,
and `.cw-date`, `.cw-rel` and `.ch-meta` set `text-transform:none` **by name** —
the one deliberate exception to the "a new label says `var(--caps)`, never
`uppercase`" rule in §6. Written down here so it reads as a choice, not a miss.

The exception to the exception is `.ce-go`, the **OPEN PLAN** button on an
otherwise empty day: it is the only action on that screen, and the only thing
here that has to be *found* rather than read. Upper case, deliberately, and for
the opposite reason to everything around it.

### The dials

`calHour` (how tall an hour is drawn — the one place a pixel is a setting rather
than a token), `calShowFixed`, `calShowIdle`, `calCalNames`, `calAhead` (how far
ahead a planned day is still offered), `calKeep` (how long a passed day is
kept) and `calStepsHide` (how long the stepper waits before getting out of the
way). The keep window sweeps behind only; a day planned three weeks out is the
point of the thing.

---

## Changelog

*Newest first. Every change to `root/` gets an entry — what changed, and why if
the why is not obvious from the what.*

### 2.22.3 — 2026-09-04 — nothing is pressed while you scroll, and a chart that opens

**A row lit up under a finger on the way down a list.** `:active` on a touch
screen is applied the moment the finger lands and is not cleared until it lifts,
so a touch that turns into a scroll lights up whatever it started on and keeps
it lit as the list moves under it. The fix is one token: the 22 press washes
that said `background:var(--s2)` say `var(--press)` now, the shell raises
`data-scrolling` on `<html>` while any slide is moving, and
`[data-scrolling="on"]{--press:transparent}` takes the wash out for the length
of the gesture. It reaches every `:active` in every app at once and any future
one for free, and a tap that is a tap still lights up — because a tap does not
scroll. The rules that press with a *project's* colour are not on the token
(their resting value differs per rule) and are noted in §6 as the exception.

**DO's quick section folds from its own title.** Tapping "quick" hides the cards
and leaves the head — the count is still there, and so is the way back. A
section you have finished with should be able to get out of the way without
being switched off in settings, which is a different and more permanent thing.
The title had to keep looking like the heading it replaced: a heading that is
also a button is only obvious once, so the only tell is a caret.

**LOG's fortnight opens over the month.** At the height it has beside the
calendar it can carry three lines and no labels, and labels are most of what
makes a chart answerable — a line that rose is worth less than a line that rose
from 2 to 4 on the ninth. Tapping it puts it where the month was, with a 1–5
scale, a date under every point and gridlines; tapping it again gives the month
back. The axes are **HTML, not SVG `<text>`**: the viewBox is stretched to fill
the width, so text inside it would be stretched with it. Each label is placed at
the same fraction the plot draws with, so they line up by construction rather
than by eye — which is also why the plot gained a 4% inset at each end, where
half of the first and last dot used to hang over the edge.

**Two motion dials.** `--mo` is now `--mo-base` (the preset) times `--mo-scale`
(a new **Animation speed** slider, 0.5×–3×), split so the two compose — "reduced,
and half again" is a real thing to want — and because a speed runs the opposite
way to a duration, so Prefs writes 1/speed. And **"keep the bar moving"**: an
opt-in exception that leaves the tab pill animating at Motion: none. The pill
growing into place under the tab you picked is feedback rather than decoration —
without it the only confirmation that the tap landed is that the page has
already changed, which is not the same thing. Off by default: someone who asks
for no motion should get none until they say otherwise.

**Verified** — `test/harness.mjs`, 524 checks, all green, 25 new. The token
existing and no sheet still pressing with the literal; the flag raised by a real
scroll event and lowered 160ms later. The quick title folding, keeping its
count, persisting, and unfolding. The chart opening over the month, carrying
exactly 5 y labels / 14 x labels / 5 gridlines only when open, those placed at
0/25/50/75/100% and 4%…96% — the same fractions the plot uses — and being HTML
rather than `<text>`. `--mo` composing from the two parts, speed 2× writing a
0.5 scale and 0.5× writing 2, `navMotion` off by default and scoped to `#nav`
and `.nav-arrow` when on, both controls on the layout panel, and the appearance
reset knowing about them.

**Still not verified by me**: how it looks. The Chrome extension is still not
connected.

### 2.22.2 — 2026-09-04 — one thing moves, and a hairline

**PLAN's transition, at the fourth attempt, and this time by being told what to
do rather than by guessing.** 2.21 made the border fade faster. 2.22 made it
faster again. 2.22.1 found that the tiles which *left* were never animated at
all and gave them ghosts. Each was a genuine improvement to a thing that was
still wrong, because the diagnosis underneath all three was wrong: they all
assumed the answer was to animate *more* of the screen better. It is not. A
screen where eight things move at once has no subject, and a gesture with no
subject reads as a stutter however well each part is timed.

So the instruction was: hide everything except the name and the colour dot,
move those. That is what it does. The grid clears on the first frame, the
project's name and dot travel and grow from where you tapped to where the
heading goes, and the section rows appear under them afterwards. Three groups
in `flip()` and every element is in exactly one of them — the **movers**, the
**carrier** box they live in, and everything else. The ghosts are gone: what
leaves is hidden, which is now consistent rather than a cut, because everything
that stays is hidden on that frame too.

Two things fell out of it worth writing down. A carrier cannot be faded —
`opacity` on a parent takes its children with it, and its children are the two
things that must stay visible — so its *paint* is held transparent instead and
comes back with the rest. And there is no move at all when the name does not
actually travel: opening a section's form leaves the heading exactly where it
is, and 400ms of blank screen while nothing moves is a pause, not a transition.

**A hairline round a day in LOG's month.** Forty-two boxes at the full border
weight is a lattice, and the lattice was the loudest thing on that screen. Half
of `--bw`, floored at .5px — one physical pixel on any phone — so it is ruling
rather than a grid of buttons. Still a ratio of the dial and not a literal, so
Border weight still reaches it (§4). The selected day's ring came down from 2px
to 1.5px with it: it can be the one heavy line in the grid, because there is
exactly one of it.

**Verified** — `test/harness.mjs`, 499 checks, all green. The scripted-layout
transition test rewritten for the new shape: the tile unpainted for the whole
move and painted in after it with `fill:backwards`, the name the only thing
moving, the rows held back and revealed in order, the queue outside the grid
still sliding. Plus the source assertions — movers and carriers separated, the
mover carrying its full delta, no ghosts left, no move when nothing travels, and
the arithmetic that move plus reveal still fits one `--t-flip`. The hairline
asserted as a ratio of `--bw` and not a literal.

**Still not verified by me**: how it looks. The Chrome extension is still not
connected.

### 2.22.1 — 2026-09-04 — what the first look on a real screen turned up

Seven things, reported directly rather than through the template. Two of them
are 2.22 shipping something that could not have worked, and both are worth
reading as cautionary notes rather than as tweaks.

**The numpad's keys were not where they were drawn.** Tapping a key registered
the one above it. The cause is the thing 2.22 was pleased with: the field was
focused and the keyboard suppressed with `inputmode="none"`. That is a *hint*,
and iOS honours it for drawing the keyboard and for nothing else it does about a
focused field — it still scrolls the field into view, and it still shrinks the
visual viewport for a keyboard that never arrives. A `position:fixed` pad drawn
against a viewport that has moved under it has its hit boxes somewhere other
than its pixels. **The field is never focused now**: the tap that opens the pad
is `preventDefault`ed, so there is no focus, no keyboard, no scroll and nothing
to move. The field says which one it is with a class instead of a caret. The
keys also fire on `pointerdown` rather than on `click` — a click on touch is
synthesised, arrives late, and can be suppressed by anything that prevented a
default earlier in the sequence.

**PLAN's transition, diagnosed properly at the third attempt.** 2.21 and 2.22
both made the border fade faster and neither fixed it, because the border was
never the problem. `flip()` walks what is on screen *now*, and opening a project
replaces the grid's `innerHTML` — so the seven tiles you did not tap were
already detached and were **never animated at all**. Most of the screen cut on
the first frame while one heading glided for two thirds of a second, and that
mismatch is what reads as a stutter. `snap()` keeps the nodes now (a detached
node is still a node) and `ghostOut()` puts each back as an absolutely
positioned ghost at the rect it had and fades it, gone by a third of the move.
The rows arriving were retimed to match: they used to start at 30% and run 60%
with 45ms between them, so the fourth row was still arriving 110ms *after* the
heading had settled. They now land just inside the move, which is what makes
them read as the consequence of the tap rather than as an afterthought.

**PLAN's flag can be answered by looking.** LOG's two alert rules clear
themselves — writing the morning is what makes "morning not written" false. The
third does not: "nothing planned for tomorrow" is a prompt, and the honest
answer is often "I know, I looked". Opening PLAN dismisses it for that day. It
is the only piece of alert state that is stored rather than derived, keyed by
the day so tomorrow's prompt is a new one.

**The rest.** The pinned calculator keeps its buttons — 2.22 folded the ± rows
away on the theory that a pinned counter is a readout, and it is not; the
buttons are why you pinned it. DAY's stepper is back to the size it was, square
with `--r2` rather than a pill: a full-width bar is a lot of chrome for two
controls. A written day in LOG's month is a **tint** rather than a fill — a
solid accent block was the brightest thing on the screen and a month of them
read as a warning. And the fortnight grew: **stress joins energy and mood**, the
graph is nearly twice as tall, and every day with a value carries a dot in its
series' colour. The dots are not decoration — a bare line says which way it
went, a line of dots also says how often you actually answered, and a fortnight
with four readings draws the same line as one with fourteen. Each dot is a
zero-length path with a round cap, because the box is stretched to fill the
width and a `<circle>` in it would be drawn as an ellipse.

**Verified** — `test/harness.mjs`, 494 checks, all green, 27 new. The pad
opening without focus and its keys registering on pointerdown, once and not
twice; `auto` still leaving a fine pointer alone. `snap()` keeping the nodes,
`ghostOut()` existing and being called, a ghost's `data-flip` stripped from
itself and its descendants, and the arithmetic that the last row lands inside
the move. The pinned calculator's ± rows still in the DOM. The stepper's square
radius. The month's tint. Three lines, three dot colours, the round-cap dots,
the taller box, and a key naming all three. PLAN's flag clearing on arrival,
staying cleared, and coming back when the day does.

One harness check was **wrong in the other direction** and is fixed: the
stepper's shape check used an unbounded lazy `[\s\S]*?` between a selector and a
declaration, which matches into the *next* rule and so asserts nothing about the
one it names. Bounded with `[^}]*` now.

**Still not verified by me**: how it looks. The Chrome extension is still not
connected. Everything above is a fix to something seen on a real screen, so the
report is real; the fix is verified as specified.

### 2.22 — 2026-09-04 — the app asks its own questions, and answers its own numbers

Two things had been quietly making ROOT feel like a web page rather than an app,
and they turn out to be the same thing: the platform's chrome landing in the
middle of it.

**Every question is the app's own now.** `window.confirm` arrives in the
platform's typeface at the top of the screen, ignores all thirty-nine appearance
dials, and reads as the browser interrupting rather than as the app asking.
There were 28 of them in ROOT and there are none any more: one `#ask` overlay
does confirm and prompt both, built from the same tokens as everything else.

The cost was real and is worth naming. **Asking cannot be synchronous** once it
is an overlay, so `if (!Shell.confirm(…)) return;` — the shape at every one of
those call sites — had to go. `Shell.confirm(msg, () => { … })` takes what to do
instead; the five places that were already `async` take `await Shell.confirm(msg)`
and read almost exactly as they did. Getting this wrong is *silent* — the guard
is falsy, the function returns, the action never happens — which is why §6 now
says so twice, and why one harness check greps every module for a bare
`confirm(` and another counts anything reaching `window.confirm` across the whole
run. Both must be zero.

The questions split into two kinds on the way, which they never had been.
`Shell.confirm` is for the ones "confirm before clearing" is allowed to wave
through. `Shell.ask` is for the ones it is not: LOG's "go back without saving?",
its import, the data panel's restore, PLAN's unmapped project. Those were
already the odd ones out; now they say so.

**A field that only takes a number gets a numpad, not a keyboard.** Two thirds
of the system keyboard are letters, it covers half the screen, and for sleep it
was not even asking the right question — the field wants 7.33 and the answer in
your head is "seven hours twenty". So the pad reads what you type: `720` is
7h20m and 7.33 lands in the field, `930` in an alert hour is 09:30, and
everything else is the number you typed. It claims any `type=number`,
`inputmode=numeric` or `inputmode=decimal` input across all eight apps and
settings, suppresses the keyboard with `inputmode="none"` set on *pointerdown* —
before focus, the only moment early enough — and hands the field back untouched
if you switch the pad off. A field that takes **text** still gets the system
keyboard, which is the whole distinction. On a laptop it stays out of the way by
default (`numpad: auto`), because a number field with a real keyboard beside it
was never the problem.

**LOG's home is one screen, and most of it is about you rather than about
navigation.** It was a streak line and eight cards, and the cards are the least
interesting thing on it — they are doors, and you already know where they go.
The doors moved down and got smaller, the two full-width utilities now share a
row, and the space that freed up holds a month of days drawn by how much of each
was written, and a fortnight of energy and mood as two lines. A cell is a
control: tapping one selects that day, which used to be twenty taps on the
band's arrow. The layout is height-driven and does not scroll — below 560px of
viewport it goes back to flowing, because "one screen" is a promise about a
phone held upright, not a reason to clip content on a laptop.

**DAY opens on today.** It opened on the nearest day that had something on it,
so a morning with nothing planned answered a question nobody asked — "here is
Thursday" — and you had to step back to learn that today was empty. Its stepper
spans the screen instead of floating over the middle of it as an 80px pill: each
arrow is half the width, a thumb-sized target on either side. Being that wide it
covers the bottom of the day, so it fades out after five idle seconds
(`calStepsHide`) and comes back on the first touch. The empty day's **OPEN
PLAN** is upper case — the one thing on that screen that has to be found rather
than read, in the one app that is otherwise lower case throughout. And a day can
be cleared from its own head.

**The rest.** The third medication slot ships **off**: it exists, the record and
the `.md` still carry it, the form simply does not ask until you say so — the
same rule `log.fields` has always followed. Every slot is highlighted in its own
colour from `log.medColors`, through one CSS rule rather than one selector per
key, so a fourth costs nothing. A quick card is drawn in its label's colour like
a block tile, and the label it takes is the **other** one: `@quick` is on every
one of them by definition, so colouring by it says nothing. Finished quick cards
can be cleared early rather than waiting for midnight, the way PLAN's sent list
can. STORE's counter has a pin on it and sticks to the top of the page while you
work down the list — sticky, not fixed, because nothing fixed may live inside
`#track`. And PLAN's project border fade is a fifth of the move rather than 42%
of it: 2.21 made it faster and it still was not fluid, because the border was
still visibly resolving after the box had landed.

**Verified** — `test/harness.mjs`, 467 checks, all green, 50 new. Not one system
dialog raised across the whole run, and no module carrying a bare `confirm(` or
`prompt(`. The dialog splitting one message into a question and its detail,
Escape closing it, cancelling running nothing, a cancelled question staying
cancelled afterwards, and the pref bypassing it entirely. The pad classifying
five kinds of field and declining the sixth; 720 → 7.33, 930 → 09:30, 9309
refused rather than written, the dot key disabled on an integer field. LOG's
month drawing, marking today, refusing tomorrow, and selecting a day on tap; the
fortnight's two lines; the home's no-scroll rule asserted in the sheet that
holds it. DAY landing on today, the stepper's width and its idle rule, the empty
day's upper case, and clearing one day cancelling and then confirming. The quick
card's colour rule and the label it comes from. The fade at 22%. STORE's pin
sticking, persisting and unpinning.

One check that had nothing to do with this release was **wrong and is fixed**:
"the → tomorrow button shows from 20:00 only" was left behind when 2.19 made
that button pick its tasks and dropped the hour gate. It asserted the old
behaviour and passed only by accident, at any hour before 20:00.

**Still not verified by me**: how it looks. The Chrome extension is still not
connected, so every appearance change here is verified as *specified* — the
rules asserted in the stylesheets that hold them — and not as seen. Same caveat
as 2.21, and it is the one thing a harness cannot buy.

### 2.21.2 — 2026-09-04 — two icons that were one icon, and arrows that were characters

DAY's new sun was a circle with eight radiating strokes. So was the settings
gear. At 19px, in a bar where they sit four apart, they were the same mark —
which is the whole failure of an icon. The sun stays with DAY, where it means
something; **settings wears sliders**, which is what forty dials and a pile of
toggles actually are. Two rails, a knob on each, each rail drawn as two
segments with a gap where the knob sits so nothing shows through a shape with
no fill.

**DAY's stepper arrows are drawn now, not typed.** They were `←` and `→` as
text in the mono face: at the mercy of whichever font is loaded, off the
optical centre, and invisible to the Icon weight dial. They are
`#ico-chev-l` / `#ico-chev-r` from the sprite — the same pair the nav's own
arrows have always used, at the same 17px — so the three arrows on that edge of
the screen finally read as one family.

**Verified** — 417 checks, all green, 3 new. The one worth keeping takes a
signature of every `tab-*` symbol's shapes and fails on a duplicate: the gear
and the sun were both `circle+path`, so it catches this class of mistake
without anyone having to look at the bar. Plus settings' symbol being lines and
knobs rather than a circle and a ray path, and the stepper's two buttons
carrying `<use>` of the two chevrons with no arrow character anywhere in them.

### 2.21.1 — 2026-09-04 — the :root block 2.21 split in half

The blur override was added by opening its selector *inside* `:root`, which
closed the block early: every token below `--chrome-blur` — the shell metrics,
`--title-base`, `--caps`, the motion durations — ended up in a rule that only
matches while blur is off. With blur on, which is the default, they were
undefined, so `text-transform:var(--caps)` resolved to nothing and the wordmarks
had no base size. The whole app went lower case with miniscule titles.

`:root` is whole again and the override is a standalone rule beside
`[data-caps="off"]`. No font, size or caps declaration was touched — none ever
had been.

**All 411 checks passed against the broken file**, which is the lesson worth
keeping: jsdom does not cascade, so a structurally broken stylesheet is
invisible to every behavioural check in the harness. Three new ones read the
file's shape instead — every shell token inside the `:root` block, an override
of one of them being a rule of its own, and the braces balancing — and they
fail against the broken version. 414 checks, all green. The other eleven
stylesheets were checked for the same fault and balance.

### 2.21 — 2026-09-04 — twelve fixes, three of which were not fixes

The first release driven by looking at the thing on a real screen rather than
by the harness, and it shows: half of this is gaps, colours and a button that
belonged to another app.

**TRACK counts from the day you start, not from the day you set it up.**
Ticking off what you had already done made the first week read as a sprint and
the projected finish read as a fantasy. `trackFrom` splits the two: ticks
before it are *banked* — still done, still on the count, drawn as the trend's
starting height — and only what comes after moves the pace. "Everything ticked
is my start" moves the date to tomorrow rather than rewriting any tick's date,
which is what makes it safe to press twice and what keeps the record of when
each topic was actually finished.

**The "!" moved to the tab it is about.** LOG's three rules were all flagging
LOG, including the one that means "nothing is planned for tomorrow" — a
signpost pointing at the wrong door. That one flags **PLAN** now. LOG still
owns all three, and `alertReasons()` returns every rule that is firing, because
they are independent once they are not sharing a tab. And an alerting tab wears
a **filled pill** the way the active tab does: a thin "!" in a bar of thin
marks read as just another icon.

**A third medication slot — and the last time that will need code.** The two
were named by hand in a dozen places: the form, the record, the export, the
parser, the history pills and both reports. They are `log.meds`'s keys now and
everything walks them. The keys stay the contract (`meds_<key>`, one `.md` row
each, in Config's order); adding one is additive, so a note written yesterday
has no row for it and reads exactly as it always did.

**A setting for the blur behind the bar.** It is the most expensive thing the
chrome does, and on a tired phone it is what makes the bar smear as the page
moves.

**DAY, seen properly for the first time.** The date moved into the title band
beside the wordmark, at a declared height so it cannot grow the band. The
arrows moved out of the slide entirely and became a fixed pill above the nav —
which they had to, since nothing `position:fixed` may live inside `#track`; the
stepper is a sibling of `#views` carrying `.ns-cal` so the one delegated
listener still reaches it. The tab icon became a sun: the agenda mark it
replaced was three bars on a rail, which at 19px is indistinguishable from
PLAN's month grid, and 19px is the only size that matters. And the empty day's
"open plan" is one of DAY's own controls rather than a form button stretched
across a card.

**The rest.** PLAN's border fade now finishes at 42% of the move — the border
is the thing you notice last, so it has to finish first for the gesture to read
as fluid. A quick card's second line takes the card's colour, like a block
tile's tag. A status box has a gap above it as well as below. The content
editors carry their own top gap, so they never butt onto a danger button again.

**Verified** — `test/harness.mjs`, 411 checks, all green, 23 new. Banking the
ticks and the pace refusing to count them; the panel saying how much is banked.
The plan rule flagging PLAN while LOG stays clear, the preview moving it, and
planning one block clearing it. Three med buttons drawn from Config, `meds_m3`
in the record, and the note writing one row per slot in Config's order, each
matching the record. The blur attribute going off and back on. The stepper
being a sibling of `#views` and shown only on DAY's slide, its two arrows not
in the scrolling day, and the empty day offering `.ce-go` rather than a `.btn`.
The sun icon carrying a circle and no rects. The fade's duration under 300ms
against a 680ms move. And the four appearance rules asserted in the sheets that
hold them.

**Still not verified by me**: how it looks. The Chrome extension is still not
connected, so every appearance fix here is verified as *specified*. The
difference this time is that the specification came from your screenshots
rather than from my guess.

### 2.20.1 — 2026-09-04 — a task over several hours, a day you step through, and a transition that stops zooming

Seven small things, three of which turned out not to be small.

**A task can take more than one hour.** `expSlots` maps a task to a *list* of
slots now, not one. A job that runs over b1a and b1b is one task given two
hours instead of the same task sent and picked twice, the description writes
one line per slot — the same name twice, in the day's order — and DAY draws it
as two blocks in the one project's colour. Tapping a slot the task already
holds gives back that hour alone rather than clearing the lot. A slot is still
exclusive: another task asking for it is refused by name.

**The transition stops being a zoom.** Opening a project used to scale the tile
into its heading, which scaled its border, its radius and its padding with it —
and it was only because the box was being stretched that its contents had to be
held at `opacity:0` until the scale resolved. The box is not scaled any more:
it is drawn at its new size, slid from its old position, and its border and
background *fade* between the two treatments. The name and its dot carry their
own flip keys and are FLIPped properly, translating and scaling from where they
were to where they are, never faded — with `data-flip-text` naming their box so
its slide is subtracted from theirs instead of compounding. §6 said counter-
scaling the children could not work here; that was true while the box itself
was scaled, and the note has been rewritten rather than deleted.

**The project tiles are one row.** Half the height, the name and its dot at the
left, "3 sections" / "2 queued" at the right end of the same row instead of
underneath. `--tile-h` is 46px now, and the open heading, the section rows and
the form were re-expressed in it so all three keep the exact height they had.

**DAY.** The wordmark reads DAY and the tab says `day`; the id stays `cal`
everywhere it is an identity — the storage key, the namespace, `Prefs.APPS`,
the settings panel — because renaming that would churn all four for a word, and
re-running the app migration for nothing. The day strip of chips is gone,
replaced by ← and → stepping through the days that exist, each arrow dimmed and
disabled in place when there is nowhere further to go. Dropping the strip also
dropped a sideways scroller inside `#track`, which needed its own
`touch-action` to be usable under a finger. And the dates read lower case:
`Prefs.formatDate()` is folded in `cal.js` and three rules opt out of the caps
switch by name — the one deliberate exception to that rule, written down in §9
so it reads as a choice.

**DO's today list gets the blocks section's gesture.** "→ tomorrow" turns the
rows from tick to select, you pick what is moving, one button sends it, and
"all" is still one tap. It is no longer gated on 20:00 — the old button moved
*everything* open, which only made sense late in the evening; choosing what
moves makes sense at any hour. A plant row is not selectable, TEND owns those.
`DO.deferToday()` called with nothing selected still moves every open task,
which is what it always did and what the ROOT.md entry promised.

**Verified** — `test/harness.mjs`, 388 checks, all green, 22 of them new. A
task taking two slots and saying so, the description writing its name twice in
the day's order, one slot handed back without the other, another task still
refused it, and the pair arriving on DAY as two blocks of one colour. The tile
fading its border with no scale anywhere, the name moving and growing under its
own key with no opacity in the frames, and no child animation left in the run
at all. The day stepped both ways with the far arrow disabled at each end, a
disabled arrow doing nothing, the date lower case in the DOM and the three
`text-transform:none` rules in the sheet. DAY worn and `cal` kept, found by the
name it wears. And DO's list turning selectable, the button armed only by a
selection, a plant refused, and exactly the picked task moved.

**Still not verified**: how any of it looks. Same reason as 2.20 — jsdom does
not paint, and no browser was available to drive.

### 2.20 — 2026-09-04 — the day you planned, drawn where you can see it

**CAL, an eighth app.** Everything needed to draw the day was already being
computed at export time — PLAN resolves the template against one start time,
puts the picked tasks in their slots and works out which calendar each belongs
on, and then threw all of it away the moment the Todoist task was written. It
is kept now, in `cal_days_v1`, and CAL draws it: a strip of the days that have
been planned, and the chosen one as proportional blocks, an hour drawn an hour
tall. The tasks wear their projects' colours — the very values PLAN paints its
own tiles with, so the two views agree rather than merely resembling each other.

It costs no request and no permission. **ROOT still never touches a calendar**
(§8): CAL is a local drawing of what ROOT *asked for*, not a window onto what
Google did with it, and it will show a day as planned even if the 22:00 agent
never ran. The harness reads `js/cal.js` and fails on any URL, any `fetch(` and
any `XMLHttpRequest` — a stricter rule than PLAN's, which is at least allowed
Todoist.

Three decisions worth writing down. **The whole template is stored, not the
exported lines**: `mode: blocks` sends the assigned slots alone, but the day
still has the shape the template gives it, so the unclaimed slots and the
routine hours are kept and each can be switched off. **A stored day is a
record, not a live query**: every row carries its own clock time, calendar name
and colour, so renaming a project in March cannot repaint a day planned in
September. **The day is written on success, never on the attempt** — a drawn
day is a scheduled day, and telling those apart at a glance is the point.

**And the trap underneath it: a new app does not reach an existing install.**
`Prefs.apps` is stored whole and replaces the default whole, the same rule
Config uses for a branch — so adding `'cal'` to `Prefs.APPS` gave it a tab on a
fresh install and *nothing at all* on any install that had ever opened the
layout panel, which is every install that has ever been used. CAL would have
shipped invisible, which is the one bug a new tab can actually have. `appsSeen`
now records every app an install has been offered: an app in `APPS` it has
never seen is new and goes in, in its shipped position, while an app missing
from `apps` but present in `appsSeen` was switched off on purpose and stays
off. It persists immediately, or switching the new tab straight back off would
be undone on the next boot.

**Verified** — `test/harness.mjs`, 366 checks, all green, 38 of them new. CAL
reaching for nothing; the export writing the day under the day it is for and
carrying the whole template, two slots as tasks, four as idle and fourteen as
fixed; every row at the clock time PLAN resolved; a task's colour being the
same value as its PLAN tile's, and a recoloured project repainting the tile but
not the day already stored; an hour drawn 56px and a 90-minute block 84px; the
strip offering today with nothing on it; each dial really changing the drawing;
a failed export writing no day at all; a re-export replacing rather than
merging; the keep window sweeping behind and never ahead; the task findable by
name with its day on the row; and `cal_days_v1` filed under CAL in the storage
report. The migration is proved by booting a *second* jsdom window with prefs
already in localStorage — the only way to run `Prefs.load()` twice — once as an
install from before CAL, which gains the tab in its shipped position while the
apps it had switched off stay off, and once as an install that had already been
offered CAL and turned it down, which keeps it off.

**Not verified**: how any of it looks. jsdom does not lay out or paint, and the
browser this was built on had no extension connected to drive it, so the visual
pass is still owed.

### 2.19 — 2026-09-04 — one field over the lot, the quick cards, the history the sweep ate, and a tab that says something

**Search, and `/` finally means something.** The key used to open settings —
a shortcut to a menu rather than to a thing. It opens one field now, over a
sheet, that reaches the apps, everything Config holds (routines and their
items, packing lists, aisles and groceries, meals, PLAN's projects and
sections, its presets and calendars, TEND's plant types, all 54 TRACK topics),
whatever each app keeps in its own storage (DO's travel checklists, TEND's
plants by name, species *or* room, LEARN's decks) and **every settings dial by
the label it actually wears**. Eleven panels and about forty dials had made
"where do I change X" the longest walk in the app.

Nothing in it is a second list of what exists, which is the whole design: the
settings index is built by rendering the three generated panels into a detached
node and reading the labels off the real controls, and content comes straight
out of `Config.get()`. A routine renamed a second ago is findable a second
later — there is a check for exactly that. `lookHTML()` / `layoutHTML()` /
`behaveHTML()` were split out of their `render*` functions so this is possible
without drawing anything; apps answer for their own data through a `search`
hook on `Shell.register`. The sheet is a sibling of `#views`, not a child of
`#track` — the old rule — and being a `.sheet-back` sheet it gets Escape and
the suppression of the shell's own shortcuts for free, which is what lets you
type "b" in it without landing on another tab. It is reached from a row at the
top of the settings menu on a phone, where there is no `/` to press.

**DO: `@quick`.** A refresh now also fetches every open task carrying
`do.quickLabel`, and draws them as cards under the routine cards — read like a
routine card, because that is what they are. Two shapes, and the second is the
point: a task with no subtasks is one card and the card is the tick; a task
*with* subtasks becomes a checklist, its rows ticked one at a time, the head
counting `2 / 5` over a progress bar. One column rather than the routine grid's
two — a checklist at half width wraps every row.

Ticking the last row closes the parent in Todoist as well, and unticking one
reopens it. Todoist leaves a parent open under finished children, so without
that a quick task would have to be finished twice. The subtasks are found by
project, not by parent: they do not carry the label themselves, and one call
per distinct project (nearly always one) is more honest than leaning on a
filter the v1 API does not really offer. Same cache rule as the media tiles —
a task closed here stays, ticked, until midnight, and a *subtask* closed here
is carried over by hand, or a card would shrink as it was ticked and `3 / 5`
would never be reachable.

**DO kept no history at all, and threw one away every morning.** `loadState()`
deleted every `do_<date>` record on the first load of a new day. Each one is
folded into a rolling tally first — per routine, done and total — and the home
screen grows a strip of the last fourteen days, one flexed cell each, filled by
how much of that day got ticked, with the average and the number of full days
on its head. LOG's weekly and monthly reports grow a `routines` row out of the
same tally.

The key is **`do-stats-v1`, hyphenated**: the sweep matches `do_`, and a summary
the sweep can reach is a summary that lasts one day. That is the same reasoning
`log-scale-v2` was named under, and the third time this file has recorded that
trap. Today is read live out of the record being written and falls back to the
folded row, so a restored backup still draws. `total` is the routine's length
as it is now — the ticks are all that survive a sweep — so a routine that has
since grown makes an old day look slightly worse than it was. It starts empty
and fills in from here; nothing before today can be recovered, and the panel
says so.

**PLAN: queue presets.** A day that is the same five tasks every week was five
trips through the form every week. "save as preset" on the queue row keeps them
under a name in `plan.presets`, and a chip on the queue refills it with one tap.
A preset carries tasks and never a day — it is a shape of day, so applying one
dates every task from the form's own floor and re-resolves the project id from
the current mapping. Rename or delete one in settings → apps → plan, like every
other piece of content.

**LOG's tab says something now.** Its icon becomes a `!` when the morning is
still unwritten past 10:00, when the evening is past 21:00, or when nothing is
planned for tomorrow past 21:00 — all three hours editable, and an empty one
switches that rule off. The state is derived on the shell's own minute tick
(`onMinute`, one timer for the app rather than one per module), never stored,
so there is nothing to dismiss and nothing to go stale: write the morning and
the flag moves to the evening on its own. "Planned" means a task PLAN has
queued or sent for tomorrow carrying a block — `plannedOn()`. A block moved to
tomorrow from DO's "→ tomorrow" is a Todoist edit ROOT keeps no record of, and
deliberately does not count.

The nav belongs to the shell, so this is `Shell.alert(app, on, why)` next to
`Shell.badge()` — an app that reaches into the tab bar itself is an app that
fights `paintNav()`. And because an alert you cannot see is an alert you cannot
judge, settings → apps → log has four buttons that pin it to one rule: the tab
really does change, and stays changed until it is switched back off.

**Verified** — `test/harness.mjs`, 328 checks, all green, 41 of them new: `/`
opening search rather than settings and the sheet holding the keyboard while it
is up; a grocery item found through its aisle, a PLAN section through its
project, a dial by its rendered label, an app by its name, and a routine
renamed one line earlier; a plant found by its room and labelled with the app
it came from; picking a dial landing on its panel; Escape closing it; the sheet
sitting outside `#track`. Two quick tasks fetched from one label,
the childless one ticking itself and the one with subtasks refusing to, its
rows closing the subtask alone and then the parent with the last of them,
unticking reopening both, and a refetch keeping both the closed card and the
closed subtask. Today's ticks read live, the strip drawing one cell per day
asked for, the day surviving its own sweep as a folded row under a key `do_`
cannot reach, and the weekly report growing the row. A queue saved with no day
on it, its chip naming the count, one tap refilling it dated from today, the
editor rendering it and deleting it taking the chip with it. And the alert
walking morning → evening → plan as each is answered, going out when a block is
queued for tomorrow, the preview pinning and unpinning it, and the switch
holding it off whatever the hour.

**Not verified**: nothing in a browser — the Chrome extension is still
unreachable from here, which makes this the sixth entry in a row that has not
been looked at. On the phone: whether a quick card with five subtasks reads as
one card or as a wall, whether the fourteen-cell strip is legible at the
default density (the cells are about 18px wide on a phone), whether the search
sheet's field clears the keyboard on iOS with results under it, and whether a
`!` in the tab bar reads as urgent or merely as broken.

### 2.18 — 2026-09-03 — a task has a day, and it is picked with two arrows

**Everything PLAN sent was due today. Full stop, in code.** `startSending()`
wrote `due_string:'today'` on every task and every subtask, so planning
tomorrow morning meant sending the batch tomorrow morning. The task form has a
date row now — `←` the day in words `→` — sitting directly under the task name:

```
   ←        tomorrow          →
           FRI, 4 SEP
```

A stepper rather than a date field, and the same three parts LOG's date header
already has. A day is nearly always today or the next one or two; a native
picker is four taps and a keyboard for something a nudge should do. The middle
says `today` / `tomorrow` / the weekday while it is still this coming week and
the short date past that, with the resolved date always underneath, and it is
itself the way back to today — tapping it is the reset, the way tapping a
picked chip clears it. It wears the accent while it is on any other day.

**Nothing steps into the past.** Todoist would take an overdue date happily
enough, but there is no reason to plan backwards, and a floor is what gives the
left arrow's disabled state a meaning. The floor is re-derived from
`Shell.today()` on every paint, never captured — the form can be opened either
side of midnight.

**The day is sticky between tasks, and is not state.** Queueing a day's work is
one gesture with five tasks in it, so the next form opens on the day the last
one was queued for (`lastDate`, held in the module beside `openKey`, never
persisted and re-floored against the real today on every open — a day left over
from last night falls back on its own). The queue row wears a pill for it, but
only when the day is not today: most tasks still are, and saying so on every
row is noise.

**What Todoist is told is now an explicit `due_date`**, the day picked when the
task was queued — not the word "today" resolved whenever the send happens. A
queue can outlive the day it was built on, and subtasks take their parent's
day. A task queued before this version has no `date` and falls back to today.

**"Sent today" became "due today", which matters to LOG.** `plan_sent_v1` is
what the evening form offers as extra blocks, so a task sent *for tomorrow* has
no business in it; `recordSent()` keeps it out and `plannedToday()` filters the
queue the same way. The standing history takes every task either way, but files
each under the day it is **due** rather than the day it was pushed — that is
the day the row names, and the day the export is built out of.

**One row, one toggle** — `plan.formFields.date`, on by default. Which meant
fixing something the toggles had latent all along: an override is stored
whole-branch, so one written before a row existed has no key for it, and a
missing key was read as "off". PLAN and the editor both read that branch
through `Config.defaults()` now, and the toggle flips what the switch is
*showing* rather than what the override happens to hold — otherwise the first
tap on a never-seen switch set it to what it already said and did nothing.
Narrow to a fixed set of booleans: everywhere else the whole-branch rule
stands, because a list needs deletions to be expressible.

**Verified** — `test/harness.mjs`, 287 checks, all green, 22 of them new: the
row's three parts, starting on today with the left arrow dead; a tap right
reading `tomorrow` with the short date under it and the middle marking itself
moved; a second tap naming the weekday; the left arrow walking back; the floor
refusing two steps past today; the middle returning to it; a Config edit
landing under the open form keeping the day the way it keeps the name; the
queued task carrying the day it was *given* and the queue row pilling it (and
not pilling today); the next form opening on the same day; the POST bodies
carrying `due_date` per task with no `due_string` anywhere, and the subtask on
its parent's day; only the today task reaching `plan_sent_v1` and
`plannedToday()`; the history filing both under their due days and the row
naming it; an override predating the row still showing it, its switch reading
on, and one tap — not two — turning it off.

**Not verified**: nothing in a browser — the Chrome extension is still
unreachable from here, which makes this the fifth entry in a row that has not
been looked at. On the phone the things to check are whether the two arrows are
a comfortable thumb target at the default density, whether the word and the
date under it stay on one line each at the largest interface scale, and whether
the accent fill on the middle reads as "this is not today" rather than as a
selected chip.

### 2.17 — 2026-09-03 — the export: a day, written down for something else to build

**"+ cal" copied text into a chat. It sends a task now.** The picked rows of
the sent history become one Todoist task labelled `import` whose description is
a spec for one day; a 22:00 agent reads it, writes the calendar and deletes the
task. ROOT's half ends at the POST — it is a static page with no Google auth
and it is not getting any, so there is no OAuth here, no calendar API and no
calendar ids, only names passed through for something else to resolve. A
harness check reads every URL in `js/plan.js` and fails if one is not Todoist.

**Two new Config branches**, both editable under settings → apps → plan →
content. `plan.calendars` maps a project — or `project > section` where one
splits, which only `curate` does — to a calendar name; its editor splits on the
*first* pipe only, because every name has one of its own (`02A1 | curate
project mixing`). `plan.dayTemplates` holds `normal` and `rest`, each row being
minutes from the day's start plus a duration, so **the whole day comes off one
number** and nothing in it is a wall-clock constant.

**`rest` has four block slots, not six**, and that is the thing most likely to
catch someone out. `b3a`/`b3b` do not exist on a rest day — those hours are
free time — so assigning one is refused with a word, and switching to `rest`
with a b3 already given out drops it loudly rather than losing it later when
the description is written. The two templates otherwise differ only by the hour
of gym, which is why every offset after it is exactly an hour earlier there.

**Slots are assigned, not inferred.** `calLinesFor()` read `a`/`b` off the
order two tasks happened to be sent in, and the `@b1` label a task carried
decided its block. Both are gone: six named slots, tapped. Which means
`toggleSent()` no longer caps two per block — three b1 tasks going to b1a, b1b
and b2a is a perfectly good day — and the cap is now the six slots themselves.
A slot another task holds is refused by name; a task's own slot clears on a
second tap.

**The panel opens in the tile grid**, like the task form and for the same
reason: `#s-form` was deleted in 2.12 and no new `.scr` should replace it. Date
(tomorrow), start (persisted, in `plan_export_v1`, and the only thing that is),
template, mode, a slot row per picked task, notes, a preview at real resolved
clock times, and one button naming the count. In `full` mode the preview
carries the warning that the day will be replaced and that what is there now is
archived to `00B | schedule 2` — worded as what *will* happen, since ROOT
cannot see the calendar to say what is there. The export button is simply
absent while a picked task has no slot, which is the only state where the
description could drop one silently.

The three text fields repaint the preview alone rather than the whole panel —
a full redraw pulls the caret out of the field mid-word — while everything else
redraws the grid and `paintExport()` puts the fields back, so a Config edit or
an arriving label fetch never loses what has been typed.

**Verified** — `test/harness.mjs`, 265 checks, all green, 42 of them new: both
templates resolving at 07:00 *and* 09:30 (one start time proves nothing about
an offset model), including a 17-hour day ending past midnight and marked `+1`;
`rest` carrying four slots and `normal` six, with every row butting onto the
next; a b3 assignment refused on `rest` with the toast, the b3 chips marked
not-on-offer, and the switch to `rest` dropping a b3 already given; a slot
another task holds refused by name; a seventh pick refused; the description
byte-exact for a five-task mixed export across four calendars, with `notes:`
absent when empty and one dash per line when not; a `plan.calendars` edit
reaching the preview and the description mid-panel while the notes textarea
keeps what was typed, and the reset putting the shipped calendar back; the
preview counting one line per picked row in `blocks` and the whole template in
`full`; the POST going to `api.todoist.com/api/v1/tasks` with `["import"]` and
the description verbatim; a toast on success *and* on a 500, which leaves the
panel up with its button back. Plus the eight shipped calendars, both editors
rendering in the plan panel, and the templates round-tripping through their
text form (with `1h30` read as ninety minutes). The harness also prints its
results now when something throws part-way, instead of losing every one.

**Not verified**: nothing in a browser — the Chrome extension is still
unreachable from here, so this is the fourth entry in a row that has not been
looked at. The panel is a tall one and the things to check on the phone are
whether five slot rows of six chips each read as a grid or as a wall, whether
the preview's three columns hold at a narrow width, and whether opening the
panel from the sent list — which jumps the page to the top — reads as arriving
somewhere or as losing your place.

### 2.16 — 2026-09-03 — one calendar from several sent tasks, and the open tile stops being a box

**"+ cal" is one button for a whole day, not one per row.** 2.15 gave every
sent row its own "+ 📅", which could only ever guess at the block's other
half by looking it up in the history. Tapping a row now *picks* it — the row
fills with its project's colour, the way a queued tile does — and a single
"+ cal" on the sent title row copies one template covering everything picked:

```
b1a : curate > mix the track
b1b : curate > master it
b2a : home > dishes
b2b : home > dishes
```

One template per block, the blocks in the order the form's chips are in
(`plan.blocks`) whatever order the rows were tapped in, anything unknown after
them, and blockless tasks last as bare `project > task` lines. Within a block
the two halves still split in send order (`ts`), and one picked task still
fills both halves.

**Two per block is the ceiling.** A block has an `a` and a `b` and nothing
else, so a third tap on a b2 row is refused with `b2 is full — two per block`
rather than being accepted and silently dropped at copy time. Blockless tasks
have no half to name, so nothing caps them.

The selection is a gesture, not state: held in the module, never persisted,
and keyed by each task's `ts` rather than its row index — the list is
unshifted on every send, and an index would slide onto a different task.
`renderSent()` drops any key whose row has gone. The button is absent until
something is picked, and names the count, which is the rule the send button
already followed.

**The open project tile stops being a box.** No wash, no border, half a tile
tall: just the name at 24px with its colour dot beside it, so it reads as the
heading over the section rows instead of a banner competing with them. Its
horizontal padding stays, so the name lines up with the rows' own text. The
same is now true with the form open under it — `.open.wide` no longer grows
the heading, and is kept only as the state marker `aria-expanded` and the
harness read. Two rules exist purely to stop the box being painted back in:
`:active` is more specific than `.open`, and `.has` is as specific and
declared earlier.

**Verified** — `test/harness.mjs`, 223 checks, all green, ten of them new:
five tasks sent into b1 ×3, b2 and no block, each row a `<button>` with
`aria-pressed` and no per-row +cal; a tap selecting one and bringing "+ cal"
out with its count; a second of the same block joining; a third refused with
the toast saying why; a tap letting one go and freeing the block again; two
tasks splitting a block a-then-b whichever order they were tapped in; one
filling both halves; a blockless one copying bare; three blocks coming out in
the form's order with the blockless line last; the clipboard getting the
whole thing; clear emptying the list, the key *and* the selection. Plus three
reading the open tile's rules off `plan.css`, since jsdom loads no
stylesheets. **Not verified**: nothing in a browser. The picked row's 14%
wash, the "+ cal" chip's size on the title row and the heading at half a
tile all want one look on the phone.

### 2.15 — 2026-09-03 — the sent history, and the open tile as a heading

**The open project tile is a heading, not a banner.** Its name sits where an
unopened tile has it — top left, the colour dot to its left — at 24px rather
than the up-to-92px centred slab 2.12 gave it, shrinking only if a long name
would not fit the row. The tile is one tile tall again (1.15 with the form
open, so the growth is still there to see). Both it and the section rows are
filled exactly as DO's block tiles are: a 10% wash of the label's colour with
the colour itself on the border.

**A sent history.** Everything PLAN has ever pushed, newest first, in a new
section under the queue: the task, its project, its block and the day, with
"clear all" on the title row. It is its own key (`plan_history_v1`, capped at
200) rather than an extension of `plan_sent_v1` — that one is today's only,
is emptied each morning and is read by LOG, so it cannot be allowed to grow
a past.

**"+ 📅" copies a task's block as calendar lines.** Each row has one, and it
puts on the clipboard exactly what the day's template wants:

```
b1a : curate > mix the track
b1b : curate > master it
```

A block is two halves, `a` and `b`. Two tasks in a block split it in the
order they were sent — `ts` is nudged by the position in the batch so a
single send of several tasks keeps its order. **One** task in a block fills
both halves with itself, which is the case the format exists for. A task sent
with no block has no half to name and copies the bare `project > task`.
`navigator.clipboard` first, with the old hidden-textarea path behind it for
where that is refused.

**Verified** — `test/harness.mjs`, 213 checks, all green: three tasks sent
into two blocks landing newest-first with a +cal button each, named for
project, block and day, counted on the title row; two tasks in b1 copying one
line each in send order, either row of that block copying the same pair; one
task in b2 filling both halves; a blockless task copying the bare line; the
button reaching the clipboard; clear emptying the list and its key while
leaving today's `plan_sent_v1` alone. **Not verified**: nothing in a browser.
The 24px heading and the +cal button's size are both worth an eye, and the
clipboard write has not been exercised against a real permission prompt.

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

**"→ tomorrow" on the today list.** When the list has open fetched tasks, a
button on its head reschedules them to tomorrow in Todoist
(`POST /tasks/{id}` with `due_string: "tomorrow"`) after a confirm, and they
drop off the list. Plants are not touched — TEND owns those. *(Since 2.20.1
this is a select-then-move gesture like the blocks section's, and no longer
gated on the hour — see that entry. `DO.deferToday()` with nothing selected
still moves every open task, which is what it always did.)*

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
