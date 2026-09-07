# ROOT — manifest

> **Read this before editing anything in `root/`, and update the Changelog at the
> bottom in the same commit as every change. No exceptions, including one-line
> fixes.** This file is the map; if it goes stale it is worse than nothing.

---

## 1. What ROOT is

Nine small single-purpose tools that share one phone, one frame and one set of
storage keys. It is a static site — no build step, no framework, no dependencies,
no network except the Todoist calls you explicitly ask for (and, only when you
import an Anki deck, the three libraries LEARN needs to unpack it). Open
`index.html` over http(s) and it runs.

| Tab       | Does                                                                   |
| --------- | ---------------------------------------------------------------------- |
| **DO**    | Daily routine checklists + travel packing lists. Closes finished routines in Todoist. Also the `@quick` cards, the block tiles (how far back "show done" reaches is a dial), the consistency strip, and the media tab — a watchlist, drawn as rows since 2.24, with kind chips, find, sort and *surprise me*. Its cards can be minimal, and a finished routine can be hidden. |
| **LOG**   | Morning/evening daily log → an Obsidian-shaped `.md` note, plus history and weekly/monthly reports. Its home is one screen: a month of days by how much of each was written, a fortnight of energy, mood and stress (tap it and it opens over the month, with axes), then the doors — and since 4.1 the fortnight is **six** charts, cycled by tapping the key row under it (the day, morning vs evening, sleep, walking, output, intake), each on its own single-unit axis. Its tab wears a `!` while a half of the day is unwritten. |
| **PLAN**  | Builds a queue of tasks against a project/section tree, then pushes the batch to Todoist. A queue can be saved as a preset. Picked rows of the sent history export back out as one day's schedule — see §8. |
| **STORE** | Grocery list with auto-categorisation, an in-store spend counter (pinnable to the top of the page), premade meals, trip history. Since 2.25 the band carries how much of the list is ticked, and — while the counter is pinned — what the trip has cost: white, with a hard offset shadow, and a `+` or `−` at its head for a moment when it moves (3.0.2; it went green and red until then). |
| **TEND**  | Plant care: today's round by room, a shelf of every plant, an append-only care log that stretches intervals with the season. |
| **TRACK** | The CAP Électricien plan: 54 topics ticked with a date, a derived pace, and the trajectory against exam, internship and revision. |
| **LEARN** | Anki `.apkg` decks studied on the go: rate cards, read the scoreboard, drill what needs work. |
| **CREATE** | The work being made, in **areas**: `production` is the songs, `mixing` is the DJ sets. Same machine for both — a thing sits on a stage, the stage asks its own checklist of it, and the hours at the desk are written down as sessions — so an area is only its own name, colour, noun, stages and session words, and a third one is a block in Config. Three screens: the shelf, one piece of work, the session log. The shelf is **combined**, with the areas as its filter (4.0): what is on the desk is one question and it stops being answerable the moment the answer is split across two screens. The shelf has no network: a song is not a task and a shelf of unfinished things is the normal state of the room, not a backlog to clear. Since 4.1 the areas are DO's tab strip rather than pills, an area says which meta chips it asks for (a mix has no key), and a fourth chip — **curate** — reads a whole Todoist **project** and lists it under its own sections, subtasks nested. That tab is the one networked thing in the app; since 4.2 a row can be ticked off, which closes it in Todoist, and that is the only thing CREATE writes anywhere. The day's hours also reach LOG's note and both reports. Since 4.1.1 the in-progress count is a number at the right end of the wordmark's row rather than a 74px block under the band — the same box and the same shuffle LOG's and DAY's day numbers have — and a work's progress is one tick per checklist item instead of a rail with a ratio printed beside it. |
| **DAY**   | The day PLAN exported, drawn as a calendar: the template resolved to clock times, the picked tasks in their slots, each row in its project's colour. A line across it at the hour it is now, and every row tickable. Stepped left and right through the days that are planned. Written at export time, and since 2.23 its slots can also be filled from the blocks DO is holding — see §9. Since 2.24 a row can be deleted (closing the gap or leaving the hour free), LOG's morning wake-up time moves the whole day, and the blocks and the template hours can each be given their colour. Since 2.24.1 a day PLAN never sent can be started here from the day's own shape — it is marked **not sent** for as long as that is true. Since 2.25 it carries the same big shuffling date LOG does. Since 3.0.4 a completed task leaves a **mark** on it at the minute it was ticked — a green dot, the time and the name — whether it was ticked here, on DO's blocks or on DO's today list; since 3.1.0 a completion that has a row of its own is written **into that row** instead of floated across it, and only the ones with nowhere to sit still float. Its id is `cal` everywhere that is an identity; **DAY** is only what it is called. |
| **Settings** | A home menu (search, the apps kept out of the bar, then three categories), and behind it eleven panels: one per app (its settings, then its content editors), look / layout / behaviour, and data. |
| **Search** | Not a tab: one sheet over the lot, opened with `/` or from the settings menu. Apps, Config content, each app's own data, and every settings dial by name — see §3. |

Which of the nine get a tab, and in what order, is itself a setting
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
   editable in Settings       15 presets + 42 dials      one delegated reader
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
├── index.html         all markup for all nine views + the icon sprite
├── favicon.png
├── manifest.webmanifest   installable on Android/Chrome; iOS reads the apple-* metas
├── test/
│   ├── harness.mjs    jsdom boot + behaviour checks — see §7
│   ├── peek.mjs       prints a screen as words: what is on it and in what
│   │                  order. jsdom has no layout, so it cannot say whether
│   │                  anything is the right size — it answers the half of
│   │                  "did that come out right" that does not need eyes,
│   │                  which is the half you still have without a browser
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
│   ├── cal.css        │
│   ├── create.css     ┘
│   ├── shell.css      the frame: slide track, floating chrome, responsive rules
│   └── settings.css   the settings view
└── js/
    ├── prefs.js       appearance + behaviour engine   (loaded from <head>)
    ├── config.js      the content layer
    ├── shell.js       Creds, Shell, the slide track, swipe, keyboard
    ├── do.js  log.js  plan.js  store.js  tend.js  track.js  learn.js  cal.js
    ├── create.js       the songs being made
    ├── settings.js    the settings view
    └── search.js      the search sheet — reads SET's index and every module's hook
```

### Load order — this is load-bearing

```
<head>   prefs.js          stamps the look on <html> before the first paint
         tokens.css → do → log → plan → store → tend → track → learn → cal
                    → create → shell → settings → themes.css
<body>   config.js         content exists before any app reads it
         shell.js          defines Creds + Shell.toast, used by every module
         do / log / plan / store / tend / track / learn / cal / create
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
`TEND` / `TRACK` / `LEARN` / `CAL` / `CREATE`, and each does its DOM lookups
through a scoped helper:

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
get wrong. CREATE is the third, for the third time the same reason: the name of
a song or a mix is the user's own text and it is in three screens and a
settings panel.

Any *user-editable* value that is interpolated into an inline handler —
`onclick="LOG.toggleBlock(this,'…')"` — goes through the module's `attr()`,
which escapes it as a JS string literal and then as an HTML attribute. `esc()`
alone is not enough: a block called `it's` was a syntax error in every handler
on the evening form.

### What the shell gives every module

```js
Shell.toast(msg)                       // the one toast — and the one place a message makes a sound
Shell.undo(label, restore)             // the one undo pill — offered *instead of* a toast
Shell.hideUndo()                       // take it back down early
Shell.rollNum(box, text, sort)         // a number in a .h-daynum box, shuffled
Shell.dayNum(box, iso)                 // …the day of the month, which is rollNum with the date as its sort
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

**Sound is the shell's, and no module has a line of it.** `Prefs.sound(voice)`
plays one of three synthesised notes — `tap`, `nav`, `ok` — and it is called from
exactly three places, all in `shell.js`: one capture-phase `pointerdown` listener
on the document that fires for anything that looks pressable, `Shell.go` when the
slide actually changes, and `Shell.toast`. Nothing is downloaded and no
`AudioContext` exists while the setting is off; the first one is built inside the
gesture that plays the first note, which is the only moment a browser allows it.
A second play within 55 ms is dropped, so a tab press — a pointerdown *and* a nav
— is one sound rather than two. Adding a sound to an app is therefore never the
answer: if a press should sound, it should be a control.

**Asking is not synchronous.** `Shell.confirm` opens `#ask` and returns; what to
do next is the second argument, or the promise it answers with when there is no
second argument. A `confirm()` or `prompt()` anywhere in a module is a bug — see
§6 — and a harness check reads every module and fails on one.

**`Shell.undo` is what a clear does instead of toasting.** The module takes a
copy of what it is about to clear, clears it, and hands the way back as a
closure; the pill lives for the "Undo window" dial (behaviour; 0 pins it until
it is tapped or the next clear replaces it) and then the closure is dropped. It
is never shown *as well as* a toast — they occupy the same spot — and there is
deliberately only one at a time, because a stack of undo pills on a phone is a
stack of pills and the second clear is the one you meant. Nothing about it is
stored: an undo that survived a reload would be an edit history, which this is
not. Seven modules offer it (STORE, PLAN, DO, LOG, CAL, TRACK, CREATE) and a
harness check fails if one stops.

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
| `--title-cap` | (not a dial) | Syne's cap height as a fraction of the em, **measured** (35.1px of box at 54px). Only ever sizes boxes around `text-box`-trimmed text — the wordmark's row, the day number. A different display face is one number |
| `--band-row` | (not a dial) | the wordmark's row, and the floor under it: the trimmed title or this, whichever is taller, for **every** app. DO's tab strip sets the number |
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
| `do_todoist_v1` | DO | DO's Todoist target + a mirrored token, since 2.3 the today-tasks block's filter and its cached list for the day, since 2.5 the block tiles, since 2.8 the media tab's switch and cached list, since 2.19 the quick cards' switch and their cached tasks with subtasks, since 2.24 the media tab's kind filter and sort order (`mediaKind`, `mediaSort` — the find box is deliberately not stored) |
| `travel_state_v2` | DO | every packing checklist (`travel_state_v1` migrated once, on read) |
| `log_<YYYY-MM-DD>` | LOG | one logged day (`e.media` since 2.8: the titles finished on DO's media tab, `{ name, kind, sub }`; `e.blocksPlan` since 4.1: which of `e.blocks` were ticked on the *planned* strip rather than the standing one — a marker over the same names, never a second list, and never exported. See §6) |
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
| `cal_days_v1` | CAL | the exported days, `{ days: { iso: { start, template, mode, notes, written, events } } }`, plus since 2.24 `localEdit` and `wakeShift` on a day that has been changed here and since 2.24.1 `localOnly` on a day started in DAY that PLAN never sent (all three dropped on re-export, which is correct — a re-exported day is a fresh, sent day). Since 3.0.4 it also holds `marks` — `{ iso: [{ at:'HH:MM', name }] }`, the completions of that day, kept **beside** `days` rather than inside one because a completion is a fact about the afternoon and not a claim about what was sent. Swept on the same keep window. Written by PLAN's export, and since 2.24 edited in place by a row deletion or a logged wake-up time; swept behind by the keep dial and never ahead. **Deliberately not `plan_`-prefixed**: the storage report files it under CAL and PLAN's own clears must not reach it |
| `create_v1` | CREATE | `works` — every song and every mix (area, name, stage, tempo, key, tags, notes and every tick) — the session log, the shelf's own three switches, and since 4.1 `curate` — a *cache* of the last Todoist read (the project's name and colour and its groups), which is the only thing in this record the app did not author and costs one network call to lose. A tick is filed under `<areaKey>\|<stageKey>\|<item text>` — see §6. The record carries its own `v`; `v:1` is the pre-4.0 shape (`songs`, two-segment tick keys) and is lifted on read — see §6. The key itself never changed, and the `_v1` in its name is the key's, not the record's. Underscore-suffixed like `store_state_v1`; nothing sweeps it, so there is no `do_`-style collision to dodge |
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
- **An overlay owns the page until it closes, and the tap that closes it is
  spent.** The pad's backdrop stopped taking pointer events the instant its
  class came off, so the tap that dismissed it also pressed whatever was
  underneath — one tap, two actions, and the second one never asked for. The
  pointerdown that closes the pad is `preventDefault`ed *and*
  `stopPropagation`ed, and the click it would have synthesised is swallowed by
  a document-level capture listener (`padSwallowUntil`, cleared by the next
  pointerdown so it can never eat a later tap). Anything new that draws over
  the page owes the same three things.
- **`padOpen` blurs whatever is focused, and that is not tidiness.** A live
  system keyboard has already shrunk the visual viewport; a `position:fixed`
  pad drawn against a viewport that has moved under it has its keys somewhere
  other than where they look. 2.22 hit this by focusing the pad's own field and
  fixed it by not focusing it — but a field answered *earlier* on the same form
  was still focused, and its keyboard was still up. Nothing may be focused
  while the pad is drawn.
- **A tap outside a focused field blurs it, everywhere.** The platform's own
  selection callout (paste / select / select all / autofill) has no dismissal of
  its own: it stays up, anchored where the field was rather than where the field
  now is, over whatever has scrolled into that space. Blurring is the only thing
  that closes it, and until 2.23 nothing was blurring. One shell listener, so it
  is every app's for free — a per-field fix would be one app remembering and
  seven forgetting.
- **A gesture that travelled is not a press.** 2.22.3 took the press *wash* off
  a row scrolled under a finger; the press itself still fired on the way up. A
  pointer that moves more than `TAP_SLOP` (12px) from where it landed — or a
  touch the browser has already claimed for a scroll, which stops sending
  `pointermove` and is caught on `touchmove` instead — marks the gesture, and
  the click at the end of it is swallowed. The pad's own keys are exempt,
  because they fire on `pointerdown` and have already happened.
- **A pad-owned field says its unit with `data-unit`, and nothing is inferred.**
  The field is never focused while the pad is up, so the pad's own label and the
  number are all that is on screen — and the label the pad covers is often the
  only place the unit was written down. A unit guessed from a label is a unit
  that is wrong on the one field nobody checked, and a number under the wrong
  unit is worse than a bare number. `duration` and `clock` ignore it: 7h20m and
  09:30 are already units.
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
- **A block-labelled task is the blocks section's, not the today list's.** The
  two are separate questions asked of Todoist and a task due today carrying
  `@b1` answered both, so it was drawn twice, counted twice in the badge, and
  tickable in one place while the other still showed it open. `todayRows()`
  drops it while `blocksOn` is set — at *draw* time, not at fetch time, so
  switching the section off hands it straight back with no refetch.
- **DO's done-blocks window past today comes from LOG, and is names only.**
  `td.blocks` is one day deep by design and starts empty every morning; the
  names survive because DO's tick calls `LOG.setBlock`. `LOG.blocksBefore(n)` is
  the read side. Those rows carry no id, no colour and no Todoist state — they
  are drawn as a list under a date, never as tiles, because a tile offers a tick
  that cannot exist.
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
- **"Written" means someone wrote it, and there is a stamp for it.**
  `morningLogged` / `eveningLogged` used to ask "does this half hold any value
  at all", which was right while every value came from the form and stopped
  being right when `setBlock` arrived: a block ticked on DO writes itself into
  the real today's `e.blocks` without the evening form being opened, so one tick
  turned the card green, cleared LOG's "!" and extended the streak. `m.saved` /
  `e.saved` are written by `saveMorning` / `saveEvening` and are authoritative
  when present; a record from before them falls back to the old field scan, with
  `blocks` taken out of the evening's. Anything else that can write a day
  without a person filling a form in must keep off both.
- **Discard has to undo, not merely decline to save.** The forms do not hold
  their answers in the DOM: the scales, the meds, the meals, the counters, the
  cold-shower toggle and the blocks all write straight into `data` as they are
  tapped, and `save()` only copies the text fields across and flushes the
  object. So "go back without saving" left every one of those edits in the live
  record, and the next write from *anywhere* committed them — an entry, a block
  ticked on DO (`setBlock` persists the same object), the other half of the day.
  `discard()` re-reads the day from storage, which also keeps whatever was
  legitimately written while the form was open.
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
  before (their untick window is over) rather than emptying the cache. Since
  2.24 it is drawn as rows rather than tiles, with a kind filter and a sort
  that persist and a find box that does not — a narrowing you chose is worth
  keeping, a half-typed query two hours old only looks like a broken list.
- **A sub-screen is `.scr` + `.hd-back`, and the shell relies on it.** The
  left arrow becomes "back" by finding `.scr.on:not(#s-home) .hd-back` in the
  current slide. A new sub-screen that names its home something other than
  `s-home`, or hides its back button, gets a dead left arrow.
- **A box trimmed with `text-box` must not be clipped on both axes.** 3.0.3
  trimmed the wordmark, the day number and STORE's counter to their cap height
  *for layout* — but their children still lay out in full line boxes, and both
  the day number and the counter carry `overflow:hidden`, which clips both axes.
  Measured in Chrome: 9.4px off the top of the day number and 10px off the
  bottom of the counter. The clip either one actually wanted is horizontal (a
  digit slides sideways; a long total must not run into the wordmark), so both
  are `overflow:visible` with `clip-path:inset(-100% 0)` — unbounded top and
  bottom, cut at the box edges left and right. Anything that trims a box it also
  clips owes the same.
- **A completion mark is grouped by the minute, and inset past two columns.**
  Marks drawn one per completion land on the same pixel when two things are
  ticked in the same minute and print over each other — which the first version
  did. They are grouped by `at` and their names joined. They are also inset from
  the left past the time column (≈53px) and the now line's own badge
  (≈36px), and from the right past the row's delete and tick, all measured:
  today is the only day either a mark or the now line appears on, so without it
  they overlap every time.
- **A band centres its ink, not its line boxes.** A wordmark is all caps, and
  caps in a `line-height:1` box leave the descender space empty underneath —
  8.5px of a 54px box, measured in Chrome. The band had no slack to redistribute
  either (14 top + 82 content + 12 bottom was exactly its 108px floor), so
  `justify-content` had nothing to do and every one of those 8.5px read as a gap
  under the title. Since 3.0.3 the titles carry
  `text-box:trim-both cap alphabetic` so their boxes *are* the caps, the band is
  `justify-content:center`, and its floor is measured in the trimmed title. The
  day number cannot be trimmed with it — its digits are absolutely positioned so
  one can slide out while the next slides in, and an absolute child has no line
  box — so it is given `--title-cap * 1em` by hand and its digits are pulled up
  by the half-leading it no longer has. Anything new that sits on the wordmark's
  row owes the same, or it centres 8.5px below the letters beside it.
- **Every home header is `.h-top`, and Shell lifts it out of the scroller.**
  At boot each view becomes band + `.view-body`; `#s-home > .h-top` is the
  band. A new app's header must be a `.h-top` directly under `#s-home` — its
  box (padding, height, the label row, the wordmark's size and the status-bar
  inset) belongs to `shell.css` and is shared by all nine, because the title
  morph only reads as one title becoming another if they are the same shape.
  Set type and colour in the app sheet; never the box, and never a
  `--title-base` of its own. A harness check enforces it.
- **Anything in the band that shares the wordmark's row needs a fixed
  height** — and since 3.0.3 the row itself has one, `--band-row`, which is what
  actually enforces it. DO's chips are 32px by declaration rather than by
  padding, but the *rail* around them is 40px once its border and its
  density-scaled padding are counted, and the moment the wordmark was trimmed
  from 54px to its 35px of caps that rail became the tallest thing in the row and
  made DO's band 2px taller than the other nine. The row is now
  `max(--band-row, trimmed title)` for every app and DO's rail is pinned to
  `--band-row`, so density cannot push one band out of step with the rest.
- **The gap under the band is the shell's, and an app must not add to it.**
  `.view-body #s-home` sets it and zeroes the first child's top margin. A
  section that can be hidden breaks `:first-child` — DO's
  `markFirstSection()` marks the first one on screen instead, and its rule
  needs the specificity to beat `.tt.hidden + .tt`.
  **It zeroes the margin and not the padding, which is the hole STORE fell
  through**: every other app's `.cnt` is horizontal padding only, STORE's padded
  all four sides, and on its home screen that box is the first thing under the
  band — 18px from the shell plus 18px of its own, which is the gap between the
  wordmark and the counter widget that anyone would notice first. Padding cannot
  be zeroed blanketly (LEARN's drop zone is 22px of padding that is the control's
  own shape, not a gap), so it is `§`-rule and a check rather than a stylesheet
  sweep: `.ns-store #s-home > .cnt{padding-top:0}`.
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
- **A day filled from DO is no longer what was sent, and says so.** Everything
  else on DAY is a drawing of what PLAN resolved and handed to Todoist;
  `applySched()` breaks that for one day, so the record gains `localEdit` and
  the head reads "edited here" from then on. Anything else that ever edits a
  stored day owes the same mark — a drawing that quietly claims to be the plan
  is the one thing this app must not be.
- **Filling a day's slots reads the slots off the record, never off a
  template.** `slotsOf(rec)` walks the stored events. CAL does not resolve
  `plan.dayTemplates` and is not going to: a day drawn from a template that was
  never sent anywhere would be a day this app is not allowed to claim, which is
  why the action is not offered on a day that does not exist.
- **A tick on DAY is a mark on the drawing and nothing else.** CAL has no
  network by contract (§8), so it cannot close anything in Todoist — and it
  could not anyway, since a stored event carries a resolved name and no task id.
  An `idle` row is not tickable: it is the absence of an event.
- **CAL is written on success, never on the attempt.** `doExport()` builds the
  day *before* it clears the panel's state, but hands it over only after the
  Todoist task lands. A day drawn for an export that failed is a day that is
  not actually scheduled, and telling those two apart at a glance is the whole
  point of the view.

- **A custom property that references another one bakes it where it is
  *declared*, not where it is used.** This is the single most expensive thing in
  this file's history: it cost five versions and three "fixes" that changed
  nothing. `--title-sh` was `var(--title-sh-x) 0 0 var(--title-sh-c)` on
  `:root`, so `var(--title-sh-c)` was substituted **on `:root`** — the accent —
  and what inherited down the tree was a finished string with no property left
  in it to override. Every `--title-sh-c` override in the app was a no-op: the
  wordmark's dot, STORE's currency mark, and the green/red flash on the running
  total. **Lengths behave the opposite way** — they stay as tokens and resolve
  against whoever uses them — which is why the offset was correctly 3px on the
  54px wordmark and 1px on the 0.4em currency mark while the colour was the
  accent on both. That split is exactly what made it look like it worked.
  There is no composed `--title-sh` any more: the shadow is written out at the
  point of use, `text-shadow:var(--title-sh-x) 0 0 var(--title-sh-c)`, which is
  the only form where the element's own colour is the one that counts. A check
  fails if any stylesheet reaches for the old token again.
- **jsdom does not cascade, so a stylesheet regex is the whole test — and it
  will happily assert the half that does nothing.** Three checks passed against
  the broken shadow because they read the declaration that was present rather
  than the behaviour it was supposed to produce. What broke the loop was
  launching headless Chrome over the devtools protocol and reading
  `getComputedStyle` off the real page. **When a visual fix is reported as "still
  not fixed", stop reading the stylesheet and go and measure it** —
  `--remote-debugging-port` plus node's global `WebSocket` is about sixty lines
  and needs nothing installed.
- **The pinned total does not fit beside `STORE.` and is clipped, badly.**
  Measured in Chrome at 412×915: the row is 376px, the wordmark takes 326 of it
  at the default title size, and the counter is left 36px for content that needs
  267 — 231px of the number is cut off. It is clipped at *every* one of the five
  title sizes (at `xs` it still needs 193 and gets 126). The 2.25.1 note claiming
  it "still fits beside `STORE.` at the largest title size" was never true;
  `font-size:min(var(--title-px), 14vw)` never binds, because 14vw at any phone
  width is larger than 54px. Nothing can fix this without something getting
  materially smaller — the wordmark while the counter is pinned, or the counter
  itself — and that is a look, not a bug fix, so it is Hugo's call and it is
  **still open**. Anything added to the head of the counter (3.0.2's sign) makes
  the clipping worse while this stands.
- **An element rebuilt on every paint cannot transition.** A replaced node has
  no previous computed value, so it arrives at its final one — instantly, while
  everything around it eases. STORE's total was one `innerHTML =` per repaint,
  which threw the currency mark away and built a new one: the digits eased into
  green over `--dur-3` and the mark *snapped* to it, one signal arriving twice
  at two speeds. The number is cells now and the mark is moved across a rebuild
  rather than recreated. The digits carry no colour of their own on purpose —
  an inherited value follows the parent's transition frame by frame, so they
  are linked to `.h-cost` for free and cannot drift from it.
- **CREATE files a tick under `areaKey|stageKey|item text`.** Reordering a
  checklist in the editor keeps every tick; rewording a line drops that one
  line's. The alternative was a key column in the editor, which is worse to
  live with than the thing it protects. Stage *keys* are identities and are
  shown but never edited — a work's stage is filed under one. The area segment
  is what lets a stage key be unique inside its area rather than across the
  app: both areas ship an `idea`-shaped first stage, and neither has to know
  about the other to add one.
- **CREATE's finished stage is found by `terminal`, never by its key or its
  position** — and there is one per area. Work on it is filed under the
  "finished" fold rather than in progress, and is asked for no checklist. The
  editor preserves the flag across a rename and hands it to the last stage of
  that area if the one carrying it is deleted — without that, deleting one row
  would leave a shelf with no way to finish anything.
- **A stage a work sits on can be deleted out from under it, and so can its
  whole area.** CREATE falls back to the first stage, and to the first area,
  for *drawing*, and leaves the work's own `stage` and `area` strings alone —
  the way TEND leaves a plant's group key alone: either may come back, and
  rewriting it on read would be the one edit that cannot be undone. The editor
  refuses to delete the last area for the same reason it hands `terminal` on: a
  shelf with nowhere to put anything is not a state the app can draw.
- **CREATE's v1 → v2 lift runs in the reader, not behind a repair flag.**
  `normalise()` reads a pre-4.0 record — `songs` instead of `works`, tick keys
  of two segments instead of three — and lifts it every time, because reading
  is idempotent and a migration that runs on read cannot be skipped by an
  install that never opens Settings. It must read the shape off the **raw**
  parse and never off the object merged onto `blank()`: `blank()` supplies an
  empty `works`, so asking the merge whether it has one always says yes, and a
  v1 shelf is then read as an empty v2 one — which is to say, silently thrown
  away. That was a real bug for the length of one harness run. `load()` writes
  the lifted record straight back so the old shape does not sit on disk for as
  long as the shelf goes untouched.
- **A production song's stage `mix` is labelled "mixdown".** The key is `mix`
  and never changes — every tick ever filed is under it — but the word moved in
  4.0, because there is now an *area* called mixing and that one is DJ mixing.
  A stage and an area reading as the same thing is the confusion 4.0 exists to
  remove, so do not "tidy" the label back.

---

- **Two `function` declarations of one name in a module: the later one wins,
  silently.** 4.1 added a `hourOf` to `log.js` beside one that had been there
  since the alert rules, and the two answered the same-looking question in
  different units — an hour of the day against minutes since midnight. Nothing
  complained, no check failed, and the sleep chart drew an average wake-up time
  of 441. `test/peek.mjs` printed the number and it was obvious in a second,
  which is exactly the half of "did that come out right" the tool exists for.
  There is a harness check over every module now.
- **`.ns-create .cr-areas` is a copy of `.ns-do .tabs`.** The tab strip — the
  rail, the flat chips, the sliding glider — is written twice, once in `do.css`
  for the title band and once in `create.css` for the content. They are the same
  control and they have to keep looking like it, so a change to one is a change
  to both **unless it is one of the two places they deliberately differ**, and
  both are about the room each one has:
  DO's lives in the wordmark's row, so its height is `--band-row` and its chips
  are a fixed 32px (§4); CREATE's takes its height from its own padding.
  DO's chips are `flex:0 0 auto` — sized to their own text, because the strip
  shares its row with a wordmark and has no width of its own to share out;
  CREATE's are `flex:1 1 0` with `min-width:max-content`, so they split the rail
  evenly when there is room and it scrolls when there is not.
- **A strip rebuilt on every tap has a glider that cannot slide.** The glider
  is an element that travels by CSS transition, so it has to be *the same
  element* before and after — and 4.1 rewrote `.cr-areas`'s innerHTML on every
  selection, which handed it a brand-new node already at its destination. The
  one element whose entire job is to move did not move, and nothing failed.
  Both strips (the shelf's and the session log's) keep a `data-sig` of their
  chips now and only rewrite the markup when *that* changes; a selection moves
  the `.active` class and asks the glider to travel. DO's `setTab` has always
  worked this way. Anything else animated across a re-render owes the same
  care: check whether the node survived.
- **A block styled by class and marked up by id alone is styled by nothing.**
  `#cr-hero` and `#cr-sorts` had rules written for `.cr-hero` and `.cr-sorts`
  and neither class was ever in the markup, so the shelf's number was never
  centred and the sort chips were never a row with a gap in it — for two whole
  versions. That is what "the spacing is off" turned out to be. A harness check
  now asserts every generated block on that screen carries the class its rules
  are written for.
- **CREATE's shelf is offline; its curate tab reads, and closes.** Since 4.1 the
  module reaches the network through the shared `Todoist` client and nothing
  else. Through 4.1 it only ever *read*, on the grounds that a third app with an
  opinion about the same list is how two of them end up disagreeing. 4.2 narrowed
  that rather than dropping it: a curate row can be **closed and reopened**, and
  that is the whole of what CREATE writes. It still never moves, reschedules,
  renames or creates a task — filing one is PLAN's job. Two harness checks hold
  the line: no `fetch(` and no `api.todoist.com` in the module, and **exactly
  one** `Todoist.call(`, whose path is `/close` or `/reopen` and whose method is
  the only one in the file. A new call is a decision, not an edit.
- **`e.blocks` says what was done; it cannot say where it was ticked.** It is a
  flat list of names and the Obsidian side parses that shape, so it stays one.
  A planned task called "mixing" and the standing block called "mixing" are the
  same name, which is why ticking either used to light both. `e.blocksPlan` is
  the marker that separates them — the subset of `e.blocks` that was ticked on
  the planned strip — and it is UI state: never exported, absent on every day
  written before 4.1 (which reads as all-own, which is what it was), and reset
  to empty by the note parser. A name is still only in the record once, so
  ticking it on the other strip *moves* the light rather than counting it twice:
  "mixing" done once is one block however many places offered it.
- **An area's `fields` is "not asked", never "deleted".** `create.areas[].fields`
  says which of the three meta chips an area's work carries — a song has a
  musical key, a DJ set has one every four minutes — and switching one off
  removes the chip *and* its handler, so there is no hidden button with a live
  editor behind it. What is already written stays in the record and comes back
  the moment the field is switched on again. Exactly the rule `log.fields` has
  followed since 2.0, for exactly the same reason.

- **A throw inside a module's IIFE at boot deletes the whole app.** Each module
  is `window.X = (function(){ … })()`, and the boot sequence runs at the bottom
  of it — so anything that throws in there means the assignment never happens
  and `window.X` is `undefined`. There is no partial app and no error on screen:
  the slide is simply empty, and every other file that guards with
  `window.X && X.something()` — `settings.js` does, for every panel — silently
  does nothing. 4.1.1 read `t.subs.length` off a curate row cached by 4.1, which
  had no `subs`, and CREATE stopped existing. **A record read at boot is the
  most dangerous input in the app**, and the rule that follows is the one
  `normalise()` was always supposed to keep: rebuild it from its known keys,
  prove every array is one, and drop what the shape cannot account for.
- **A cache is the part of a record whose shape changes most and is checked
  least.** `create_v1.curate` is the only thing in that record the app did not
  author, and it changed row shape between two versions an hour apart. Nothing
  is lost by dropping a cache — a refetch costs one network call — so it is
  always cheaper to be strict with it than to be trusting. The harness boots an
  install holding the previous version's shape.
- **`Config.get()` on a branch whose shape changed hands back the old shape.**
  Overrides are stored **whole-branch** (§3), so an install that overrode
  `create.curate` while it was `{ label, maxAgeMin }` kept exactly that, and
  `project` read as undefined the moment 4.1.1 renamed the key: no chip on the
  strip, an empty field in Settings. Any branch with a fixed set of keys and no
  deletion to express is read *through* the shipped defaults —
  `Object.assign({}, Config.defaults(path), Config.get(path))` — which is what
  `log.meds`, `log.medsOn` and `plan.formFields` have always done. **The
  fallback is on the key being absent, never on its value being falsy**: a key
  that is present and empty is a choice ("blank switches the tab off") and
  taking it away is a different bug.

- **An optimistic write has to be able to be put back exactly.** CREATE's curate
  tick draws itself before the call lands, which is the only way a list this long
  feels answerable — but the way back is the *previous* state captured before the
  change, never "the opposite of what it is now". A parent carries its subtasks,
  so the row that was already ticked and the row that was not must each land back
  where they were; assuming the inverse would silently open a subtask nobody
  touched. The harness refuses a close and checks the record, not just the class.

- **A browser will not make a sound outside a gesture.** An `AudioContext`
  constructed at boot is born `suspended` and stays that way, and everything
  played through it is silence with no error anywhere. So the context is built
  **inside the first press that needs it**, and never at all while the setting is
  off — which also means an install that never turns sound on has no audio graph
  to pay for. `resume()` is asked for every time and its promise ignored: if it
  is refused there is simply no sound, which is the correct outcome.

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
assuming a new tab appears: for CAL it did not. CREATE is the worked example —
3.0 added it and touched exactly the list above and nothing else. Use the `card` class on the app's raised surfaces so the depth
ramp and the card treatments reach them without a new class list in
`themes.css`.

**Make something findable in search** — nothing, if it is in Config: add its
path to `CONTENT` in `search.js` (one line: the path, the app, and how a row
reads) and it is found from then on. For data an app keeps in its own key,
register a `search(q)` hook with `Shell.register` returning `{ title, sub, go }`
rows. Settings controls need nothing at all.

**Test without a browser** — `test/harness.mjs` boots the real `index.html` in
jsdom (scripts loaded from disk, stylesheets and fonts skipped) and drives it
through DOM events: 896 checks covering boot, every theme and panel, the
behaviour fixed in 2.1, the three apps added in 2.2, the links and fixes of
2.3, the Todoist round-trips of 2.4, and the block and media tiles, the
settings menu, the back arrow, the title band, the cross-fade and PLAN's
in-place projects, form, sent history, day export and due dates of 2.5–2.18,
and search, DO's quick cards and folded history, PLAN's presets and LOG's tab
alert in 2.19, CAL and the new-app migration in 2.20, the multi-slot
export, the stepped day and the new transition in 2.20.1, and the app's own
dialog, the numpad's four readings, LOG's month and fortnight, DAY's stepper and
STORE's pin in 2.22, and CREATE's stages, ticks, sessions and editors in 3.0, and in 4.1 the shared
undo pill, CREATE's tab strip, its per-area fields, its curate tab against a
stubbed Todoist, LOG's folded and unlinked blocks, the fortnight's six charts,
and the two invariants those left behind — nothing on PLAN clips its own text
against a line-height of 1, and no module declares one function name twice. jsdom has no
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

### Now, and what is left of the day

Two things a day-shaped drawing is uniquely good at carrying, and neither was on
it: where the clock has got to, and what is already done.

**The line.** One hairline across the day at the height the hour has reached,
drawn only on today and only while today is still running. Its offset is summed
from the same durations the rows are drawn from rather than measured off the
DOM, so it lands on the boundary it names whatever `calHour` is set to, and a
row hidden by a dial contributes no height to either. Before the first row and
after the last one it is simply not drawn: a line pinned to an edge says "the
day has not started" in the most ambiguous way available. It rides the shell's
own minute tick (`onMinute` → `paintNow`), which moves the line and nothing
else — a full redraw once a minute would throw away the scroll position and the
schedule panel with it.

**The ticks.** A `task` or `fixed` row is a `<button>`; an `idle` row is a
`<div>`, because it is the absence of an event and there is nothing there to
have finished. A tick is stored on the event (`done`) and is a mark on the
drawing and nothing else — CAL has no network by contract (§8) and a stored
event carries a resolved name, not a task id. Ticking the same task on DO is
what closes it. Re-exporting the day resets them, because re-exporting replaces
the day.

### The day's slots, filled from DO

PLAN builds a day and sends it, and that is still how a day gets here. But the
day PLAN sent is the day as it looked the night before, and by the morning the
blocks on DO are the ones actually happening — re-exporting the whole day to
move two of them is a great deal of ceremony for a small correction.

So: **the slots this day already has, filled from the block tasks DO is holding
now.** Only the slots — a `fixed` template row is the shape of the day — and
only on a day that exists, because `slotsOf(rec)` walks the stored events. CAL
does not resolve `plan.dayTemplates` and is not going to.

The slot rules are PLAN's, deliberately (§8): a slot another task holds is
refused **by name** rather than taken away in silence, tapping the slot a task
already holds gives that hour back, and a task moving to a new slot gives up its
old one. What is different is the ending — this overwrites every slot on the
day, so it asks first, and the slots nobody filled go back to `idle`.

**And the day says it was edited here, permanently.** `localEdit` on the record,
"edited here" in the head. Everywhere else on this screen what is drawn is what
PLAN resolved and handed over; this breaks that for one day, and a drawing that
quietly claims to be the plan is the one thing DAY must not be. Nothing is sent:
the tasks stay as they are in Todoist and the calendar keeps whatever PLAN
already told it.

`sched` is a gesture, not state — module-level, never persisted, dropped on any
day change. Same rule as PLAN's `openKey` and DO's move selections.

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

### 4.2 — 2026-09-07 — the curate list can be ticked off, labels get their colours, and the app makes a sound

Six requests, one batch. Three of them are shapes in CREATE, two open the curate
tab up, and one is new behaviour under the whole app.

**The curate list ticks off, subtasks included.** Through 4.1 this tab was
strictly read-only, and the reasoning was written down in three files: a third
app with an opinion about the same list is how two of them end up disagreeing.
That argument does not cover the tick. A record you have gone and found is
*done*, and walking to DO to say so is the errand that ends with a list nobody
trusts. So a row now has two targets — the box on the left closes it, the body
still opens it in Todoist — and closing is the whole of what CREATE writes. It
still never moves, reschedules, renames or creates a task.

The write is `/tasks/<id>/close`, the same call DO and TEND make, and the same
one in reverse puts it back. **The tick is drawn before the call lands**, because
a list this long stops feeling answerable if every tap waits on a network; if the
call does not land, the row goes back to *exactly* what it was — the previous
state, captured, not "the opposite of now", which would open a subtask nobody
touched. A ticked row stays where it is, struck through, rather than vanishing:
a row that disappeared would take the only evidence of a mis-tap with it. It
stops being counted at once, in its group's number and in the band.

A parent carries its subtasks both ways, because Todoist does — closing a task
closes what is under it, and reopening brings them back — so the screen and the
account say the same thing until the next refetch drops the row entirely.

The invariant in ROOT.md §6 narrowed rather than went away, and so did the
harness check that holds it: there must be **exactly one** `Todoist.call(` in the
module, its path `/close` or `/reopen`, and its method the only one in the file.
A second call is now a decision someone has to make on purpose.

**Labels in their own colours, behind a switch.** `create.curate.labelColors`
draws each task's labels in the colour Todoist gives them, out of `root_labels_v1`
— the label cache DO fills and PLAN refreshes — so a label is the same colour in
every app that draws one. A colour that is not cached yet is not invented: that
label is drawn plain. The switch is in settings → create, and it is the panel's
static markup rather than a generated content editor, so `Config.subscribe` is
what redraws it.

**Three shapes.** The hours on a session row are pushed to the right edge,
right-aligned in a box with a floor width and set in tabular figures, so they
read as a column instead of ending wherever the sentence beside them stopped.
Content under a sticky header gets top padding — `.hd + .cnt` — which is the
padding DO, LEARN, LOG, PLAN and STORE already have on all four sides; the shelf
is untouched, because it has a wordmark up there and not a header. And the sort
chips, the meta chips, the stage stepper and the session kinds take `--r3`
instead of `--r-pill`: rounded squares, not pills. The dots, the rails and the
progress bar keep `--r-pill`, because a circle is not a button.

**The interface has a voice.** Three notes — a control under a finger, a slide
arriving, a message — **synthesised**, a sine through a gain envelope, none
longer than a twentieth of a second. Nothing is downloaded, so there is no asset,
no cache and no licence for a click.

It is wired in three places in `shell.js` and nowhere else: one capture-phase
`pointerdown` listener on the document that fires for anything that looks
pressable, `Shell.go` when the slide actually changes, and `Shell.toast`. No app
carries a line of it and none can end up with its own idea of what a button
sounds like — if a press should sound, it should be a control.

Two rules keep it out of the way. **Nothing exists until it is asked for**: no
`AudioContext` is constructed while the setting is off, and the first one is
built inside the gesture that plays the first note, which is the only moment a
browser allows it — one made at boot is born suspended and plays silence with no
error anywhere (§6). And **one sound per gesture**: a tab press is a pointerdown
*and* a nav, and hearing both is the difference between "smooth" and "cheap", so
a play within 55 ms of the last is dropped rather than layered.

Off by default, with a level dial beside it in behaviour — sound is the one
setting that can embarrass someone in a quiet room, which is why haptics is off
by default too.

**Verified** with `test/harness.mjs`, **930 checks, all green** (896 at 4.1.2),
34 new. The curate tick is driven through the real DOM against a scripted
Todoist: the call that goes out, the row and its two subtasks going down
together, the counts dropping, the record on disk, the reopen, a refused call put
back, and a tap with no key saved sending nothing. The sound is driven against a
stubbed `AudioContext` — nothing built while it is off, one context built inside
the first press, the second press inside the gap dropped, the next one not, a
press on a heading silent, a toast and a slide each sounding once, and a re-tap
on the tab already shown sounding not at all.

**Not looked at** — still no browser this session. The three shape fixes are
asserted as rules, not as pixels: jsdom does not lay out, so "the hours line up
in a column" is `margin-left:auto` + `text-align:right` + tabular figures being
present, and nothing more. **They want an eye on a phone.** So does the sound,
which no test can hear: what the harness proves is that the right graph is built
at the right moment and torn down to silence when it is switched off, not that
660 Hz for 32 ms is pleasant.

### 4.1.2 — 2026-09-07 — CREATE stopped existing, and two reasons why

> the tab is there but can't see anything. also the settings don't have a
> default

Both symptoms, one cause, and a second cause hiding behind it.

**CREATE was not drawing nothing. It was not there at all.** Each module is
`window.X = (function(){ … })()` with its boot at the bottom, so anything that
throws inside runs before the assignment: `window.CREATE` was `undefined`. There
is no partial app and nothing on screen to say so — the slide is empty, and
every `window.CREATE && CREATE.…` guard elsewhere quietly does nothing, which is
why the settings panel's fields were blank as well. `settings.js` fills them by
calling `CREATE.renderSettings()`.

What threw: **a curate list cached by 4.1**. 4.1 cached rows from a label query
and they had no `subs`; 4.1.1 caches project rows that do, and draws
`t.subs.length`. One undefined array in a cache that exists only to save a
network call took out an entire tab, on every install that had opened that tab
once.

`normalise()` rebuilds the cache from its known keys now, which is what its own
comment always claimed it did: every field read through a default, every array
proved to be one, subtasks lifted recursively, and a group the shape cannot
account for dropped rather than drawn half-built. Nothing is lost by dropping a
cache — the next visit fetches it again.

**And behind that, the settings field really was empty.** `create.curate` was
`{ label, maxAgeMin }` for the one version 4.1.0 was current, and a Config
override is stored **whole-branch** (§3) — so an install that had touched that
field kept the old object and `project` read as undefined the moment the key was
renamed. No chip on the strip, a blank field in Settings.

The branch is read through the shipped defaults now —
`Object.assign({}, Config.defaults(path), Config.get(path))` — which is the
merge `log.meds`, `log.medsOn` and `plan.formFields` have always used, and is
safe for the same reason: a fixed set of keys with no deletion to express, so a
missing one means "not answered" rather than "gone". The stale `label` is
dropped; a label is not a project, so there is nothing in the old value that
answers the new question.

**The fallback is on the key being absent, never on the value being falsy.** A
project that is present and empty is a *choice* — "blank switches the tab off" —
and the first version of this fix took that choice away by resurrecting the
default whenever the string was empty. The two blanks are not the same thing.

**A filter that no longer exists now falls back, the way a deleted area already
did.** This is what turned a config mismatch into a blank screen rather than a
missing chip: the strip had dropped `curate`, but the shelf's own filter still
said `curate`, so everything stayed hidden and there was nothing left on the
page to tap. `areaSel()` had that fallback for an area the editor deleted and
not for this. Anything that can be *selected* has to be able to stop existing.

**And the field says what it goes back to.** The project input carries the
shipped value as its placeholder, so an empty one reads as a choice rather than
as something missing.

**Verified** — `test/harness.mjs`, **896 checks, all green** (885 at 4.1.1), 11
new, and five of them boot a whole second window holding the exact state that
broke: an install with 4.1's cached row shape (the module survives, the list is
lifted and drawn, every row has the arrays the drawing walks, and the settings
panel fills), an install with a cached group too broken to lift (dropped, module
alive), an install with 4.1's Config override (the chip is back, the field shows
the project, the stale key is not kept), an install that blanked the project on
purpose (still off), and a shelf left on a filter that has since gone (falls
back to the shelf rather than to nothing).

Three §6 notes: a throw at boot deletes the whole app; a cache is the part of a
record whose shape changes most and is checked least; and `Config.get()` on a
branch whose shape changed hands back the old shape.

**Not looked at** — still no browser this session. But this one did not need
eyes: the failure reproduced in jsdom from a seeded record, which is what the
harness is for.

### 4.1.1 — 2026-09-06 — the glider slides, the count moves into the band, and curate is a whole project

Six things, all asked for in one message, all on CREATE.

**CURATE is the whole project now, not a label.** `create.curate.project` —
`02 | curate` — read in the order it is arranged in over there: section order,
then each task's own order inside its section, with **subtasks nested** under
the task they belong to. A section with nothing open in it is not drawn, because
an empty heading is a row of furniture saying "nothing here"; a task with no
section gets its project's own unsectioned group, which sorts first, because
that is where Todoist puts it. The project name is matched folded, the way PLAN
matches every project it sends to, so the punctuation in `02 | curate` is not
load-bearing — and the chip wears what is after the last pipe, since the number
and the pipe are how it sorts in a sidebar and neither is worth a chip's width.

Still read-only, and the harness still holds that line.

**The glider actually slides, which was a real bug.** 4.1 rewrote the rail's
`innerHTML` on every selection, so the glider was a brand-new element already at
its destination — it had nothing to transition *from*. The one element whose
entire job is to move did not move, and nothing failed. Both strips keep a
signature of their chips now and only rewrite the markup when *that* changes; a
selection moves the `.active` class and asks the glider to travel. §6 carries
it, because anything animated across a re-render can make the same mistake.

The session log's strip moved out of the body it filters into a box of its own
(`#cr-log-tabs`) for the same reason — it was being rebuilt with the sessions
under it.

**The chips are even and centred.** `flex:1 1 0` gives every chip the same share
of the rail whatever its label is, and `min-width:max-content` is the floor that
stops the share squashing a word — so four chips split the width when there is
width to split and the rail scrolls when there is not. Sized to their own text
they were four different widths with the words hard against the left of each.

DO's copy deliberately does *not* do this: it shares the title band with a
wordmark and has no width of its own to share out. That is now one of the two
places the two strips are allowed to differ, and §6 names both.

**The count moved into the band.** It was a 74px block under it — most of a
phone screen spent on one digit, on the screen whose job is to list what is on
the shelf. It is a number at the right end of the wordmark's row now, in the
same `.h-daynum` box LOG's and DAY's big day numbers live in: same size, same
shadow, and **the same shuffle**, which is what was asked for. The label above
the wordmark says what it is counting — `in progress`, or the area it is
narrowed to, or the curate project.

`Shell.dayNum` was the only thing that could do that roll, and it only knew
about dates. It is `Shell.rollNum(box, text, sort)` now, unchanged in every
other respect, and `dayNum` is one line on top of it. Three boxes, one function.

The total the hero also carried is not lost: the "Finished" fold below says how
many are done, which is the same subtraction.

**Progress is ticks, not a bar.** It was a full-width 4px rail with `1 / 7`
printed beside it on a line of its own — three shapes saying one thing, and the
widest of them carrying the least. A rail can only say *what fraction*; the
number next to it existed because the fraction was not enough.

One segment per checklist item says both at once and needs no number: how far
along, and out of how many. It is also the shape the stage strip at the top of
the shelf already uses, so the screen has one way of drawing "some of these, not
all of them" instead of two. The count is still there for a screen reader
(`aria-label="1 of 7 done"`), which is what the ratio was actually for. Past
sixteen items the segments would be thinner than the gaps between them, so it
falls back to a rail — a checklist that long is a fraction again.

The week's split bars went to the same 5px, so the two bars on that screen are
one weight rather than two. They stay continuous, because a share of the week is
a proportion and not a count of anything.

**And the band is redrawn on every screen**, not only the shelf. It belongs to
the slide — the shell lifts it out of `#s-home` at boot — and moving a work to
its finished stage happens on the work screen and changes the number.

**Verified** — `test/harness.mjs`, **885 checks, all green** (865 at 4.1), 20
new: the glider surviving a selection and being rebuilt only when the chips
change; the chips' flex; the count in the band, in the shared box, shuffling
when it changes, saying which area it counts; the progress ticks, their count,
their `aria-label` and the long fallback; and the curate tab against a stubbed
Todoist — a whole project, sections in their order, an empty section not drawn,
subtasks nested in their own order, the group count including them, the folded
project match, and a missing project saying so.

Read back through `test/peek.mjs` as well: the band, the tab strip, the curate
tab printed as an indented tree, and the progress of every row on the shelf
drawn as `█░░░`.

**Not looked at.** The browser extension was still not connected, so the glider
sliding — the one thing here that is purely an animation — has been reasoned
about and its cause fixed, but not *watched*.

### 4.1 — 2026-09-06 — the areas become a real tab strip, CREATE reaches Todoist and LOG, and clearing can be taken back

Ten Todoist tasks labelled `@claude`, one batch, one version. The eleventh was
an `@idea` and is listed at the bottom, unbuilt.

**The areas are DO's selector now, and there are four of them.** `all ·
production · mixing · curate` in one bordered rail with a sliding glider under
the live chip — the DAILY / MEDIA / OTHER control from DO, in CREATE. The
session log uses the same strip rather than the second, different one it had.
The shape is written twice, in `do.css` and in `create.css`; §6 names the pair
so a change to one is known to be a change to both.

**CURATE: the Todoist label, grouped by section.** Every open task carrying
`create.curate.label` under the section it sits in, in Todoist's own order —
project order, then section order, then the task's own order inside the section.
Three calls, not one per project. Cached in `create_v1` so the tab draws before
the network answers, refreshed behind that when it is older than the window
(a dial), and refreshable by hand.

**It reads and never writes.** CREATE does not close, move, reschedule or create
a task: closing a curate task is DO's job and filing one is PLAN's. This does
end the module's "no network at all" rule and the header, the settings panel and
§6 all say so; what replaced it is the narrower promise that is still true and
still worth protecting, and two harness checks hold it.

**A mix has no key.** `create.areas[].fields` says which of the three meta chips
an area asks for. Production asks for tempo, key and tags; mixing asks for tempo
and tags, because a DJ set's key changes every four minutes. Switching a field
off takes away the chip *and* its handler and touches nothing already written —
`log.fields`' rule, since 2.0. There is a checkbox per field in the area editor.

**The spacing, and what it actually was.** `#cr-hero` and `#cr-sorts` had rules
written for `.cr-hero` and `.cr-sorts` and neither class was in the markup, so
the shelf's big number was never centred and the sort chips were never a row
with a gap in them. Two versions of that. Fixed, and a check now asserts every
generated block on the shelf carries the class its rules are written for.
Separately, every literal pixel margin in `create.css` became a ratio of
`--dens`: the Spacing dial moved every pad on the page and left the gaps
*between* the sections where they were, so the screen got denser and looser at
once — which is the other half of what "the spacing is off" looks like.

**CREATE reaches LOG.** `CREATE.dayStats(iso)` and `CREATE.rangeStats(days)` are
synchronous readers over `create_v1`, the shape `TRACK.doneOn` and
`LEARN.dailyStats` already have. The note gains a `#### create` section on a day
with sessions — hours, sessions, the split by area, what was worked on and what
was done to it — and the parser reads it back into `d.c`. Both reports gain an
"at the desk" line and a `## create` section. LOG stores nothing of CREATE's; it
asks at note time and at report time.

**The undo pill.** Clearing is the destructive act you do on purpose and still
regret, so it does not toast any more: `Shell.undo(label, restore)` offers the
way back, on a "Undo window" dial in behaviour (default 5s; 0 pins it). Seven
modules use it — STORE's list, cart and history, PLAN's queue and sent history,
DO's day, LOG's day and its two counters, DAY's stored days, TRACK's ticks,
CREATE's shelf. It wears the title: the display face at the wordmark's weight
with the same hard offset copy behind it, and the arrow — a sprite symbol, not a
typed character — takes the same offset as a drop-shadow.

**The navigation arrows wear the title too.** LOG's date arrows and PLAN's day
stepper are the same control doing the same job, and they were thin mono glyphs
a few pixels under a heavy display wordmark. They are `800 … var(--head)` in
title ink with the title's shadow now, composed at the point of use — never
through a token that pre-resolves its colour, which is the bug 3.0.1 spent a
version on. One caveat, written into the sheet: `←` and `→` are typed
characters, so a display face without them falls back per glyph. The weight, the
ink and the shadow all land regardless — those are not the font's to refuse.

**LOG's evening: what was planned comes first.** The standing nine blocks moved
*under* the planned ones and folded away behind a tap, closed by default, opening
itself if one of them is already ticked. Most evenings are made of what was
planned; the nine were a list to scroll past.

**And the two strips stopped lighting each other.** A planned task called
"mixing" and the standing block called "mixing" are the same name, and `e.blocks`
— which is the export's shape and stays it — can only say the name is in the
list. `e.blocksPlan` is the marker that says which strip put it there. A name is
still in the record once, so ticking it on the other strip moves the light
rather than counting it twice.

**The fortnight is six charts.** Tapping the key row underneath moves to the
next; the plot still opens over the month, on every chart. The day (energy,
mood, stress), morning vs evening, sleep (hours slept and the hour you woke),
walking, output (blocks and the three curate counters) and intake (coffee,
energy drinks, meals). Every series is a field the record already holds and
nothing new is stored. **One unit per chart, always** — a shared y-axis is a
claim that two numbers are comparable, and hours are not counts — which is why
there are six rather than two crowded ones. A chart with nothing in it is
dropped from the cycle rather than shown empty. The axis is the chart's own now,
and its gridlines and its labels come from one call so they cannot disagree.

**PLAN's clipped descenders, checked again.** The 3.1.0 fix is in place — the
five boxes that hide their overflow all carry a real line-height — and there is
an invariant over the sheet now: nothing on PLAN may combine `overflow:hidden`
with a `/1` font shorthand, so a sixth box cannot bring it back. It was still
not *looked at*, so the task stays open.

**A real bug, caught by `test/peek.mjs`.** The sleep chart read a wake-up time
through a `hourOf` that already existed in `log.js` for the alert rules and
answers *minutes since midnight*. Two `function` declarations of one name is the
later one winning in silence: nothing complained, no check failed, and the chart
said the average wake-up was 441. Renamed, and there is a harness check over
every module for a duplicate declaration now — §6 carries it, because it is the
shape of mistake any file this long can make.

**Parked, not built:** "bring content down: triple tap screen to bring elements
down 50% to make it more reachable from my hands on the screen" (`@idea`).

**Verified** — `test/harness.mjs`, **865 checks, all green** (816 at 4.0), 49
new. And read back through `test/peek.mjs`: the curate tab's groups in Todoist's
order, a mix's chips beside a song's, the evening's block field in its new order
with the fold closed, and all six charts' key rows one after another — which is
what turned up the `hourOf` collision.

**Not looked at.** The browser extension was not connected in this session, so
nothing here was seen on a real screen — no version since 3.0 has shipped that
way. The tab strip's glider, the undo pill, the title-weight arrows, the folded
block field and the six charts have all been reasoned about, tested and printed,
but not *looked at*.

### 4.0 — 2026-09-06 — CREATE holds two kinds of work, and the shelf holds both

> add a mixing section for root, i'm talking a major update new tab. you did a
> good job with create. i think it would be good if you also changed the "in
> flight" text and actually redo the home page.
>
> — and then, on being asked what MIX should be: *mix is for dj mixing not
> actual track mixing, that's production* · *i want to be able to log my
> sessions when mixing, what i did, how much time, make it function like
> CREATE. but now that i think of it could be just a slide in "CREATE"
> something unified maybe a combined view and then a per area view*

**Not a tenth tab.** The brief started as one and changed inside the same
message, which is the better answer and is the one built. A DJ set and a song
are the same object: a thing that sits on a stage, gets asked a checklist by
that stage, and eats hours at a desk. Two tabs running that machine twice would
have been two shelves, two session logs and two answers to "what am I working
on" — and the second one is a question with only one true answer.

So CREATE holds **areas**. `production` is the songs being made; `mixing` is the
DJ sets being built. An area is its name, its colour, the noun for one of its
things, the stages it walks and the words its sessions are called — and that is
the whole of it. Nothing in `create.js` is written for two of them: it walks
`AREAS`, whatever is in it, and a harness check greps the module for the string
`production` or `mixing` and fails if either appears outside a comment. A third
area is a block in Config and no code at all.

#### mixing

Five stages, and they are a DJ's, not a mix engineer's: **crate** (tracks
pulled, keys and tempos written down, the ones that do not fit cut, something in
it you have not played), **order** (opener chosen, the arc drawn, the peak
placed, the way out written), **drill** (every transition tried once, cue points
set, the hard one drilled, played end to end), **record**, and **played**, which
is its terminal stage. Its session chips are *digging · practice · recording ·
playing out · listening back*.

*The word that had to move.* Production's fourth stage was called `mix`, which
next to an area called mixing reads as the same thing and is the exact confusion
this version exists to remove. Its label is **mixdown** now. Its key is still
`mix`, because every tick ever filed is filed under it, and §6 says so in as
many words so nobody tidies it back.

#### the home page, redone

One shelf, with the areas as its filter — the "combined view and then a per
area view" the brief asked for, done as one screen rather than three.

- A pill per area with `all` in front of them. `all` is the default and the
  point: what is on the desk is one question.
- **One stage strip per area on screen.** On `all` that is both of them, one
  under the other — two shapes in one glance, which is the thing a combined
  view is *for* and the thing two tabs could never have done.
- The list is every area's work together, each row wearing a dot in its area's
  colour in front of its name. The rail down its left edge stays the *stage's*
  colour: on a shelf of things at different points, the stage is what you scan
  for.
- **One add button per area on screen**, so starting a mix is never something
  you change screens to do.
- The week's hours are split by area underneath the three tiles — hours only,
  because three numbers per area is a table and a glance at the week is not a
  table. The bars are relative to the biggest of them rather than to the total:
  the question is which of the two got the time, and a pair of slivers against a
  24-hour scale answers nothing.
- The session log carries the same filter, and totals per area. "Where did the
  week go" now has an answer with two halves.
- Picking an area is remembered, because it is where you were working.

**"In flight" is gone**, and not only from the heading it was a heading for: it
was CREATE's name for work that was not released and it never said anything the
plain word does not. It is **in progress**, the fold is **finished** rather than
**released**, and a harness check greps the module, the sheet and the markup so
it cannot creep back in.

#### what a v1 shelf becomes

A record written before this version is a list of `songs` whose ticks are filed
under `stageKey|item` — there was only one area to file them under. `normalise()`
lifts both: every song becomes a work in the first area, and every tick key
gains its area segment. Nothing is unticked by upgrading and nothing is thrown
away.

It runs in the **reader**, not behind a repair flag, because reading is
idempotent and a migration that runs on read cannot be skipped by an install
that never opens Settings — and `load()` writes the lifted record straight back
so the old shape does not sit on disk for as long as the shelf goes untouched.

*The one real bug in this version, caught by its own test.* The lift read the
shape off the object already merged onto `blank()`. `blank()` supplies an empty
`works`, so the question "does this record have a `works`?" always answered yes,
and a v1 shelf was read as an empty v2 one — which is to say, silently deleted.
§6 carries it, because it is the shape of mistake any future migration in this
codebase can make.

#### the editor

`create.stages` and `create.sessionKinds` are gone; there is one editor,
`create.areas`, and it edits a tree: an area's name, colour, singular and
plural, its session chips, and then its stages nested inside it. Two editors
would have meant picking which area you were editing in one panel in order to
see its stages in another. `+ add a stage` carries the area whose button it is;
the button at the bottom adds a whole area. The last area cannot be deleted —
a shelf with nowhere to put anything is not a state the app can draw.

Search reaches the whole tree, and every row says which area it belongs to,
because a stage label is ambiguous across areas by design.

#### a second thing in `test/`

`test/peek.mjs` prints a screen as words: what is on it, in what order, and
what it reads like. jsdom has no layout, so it cannot say whether anything is
the right size — it answers the half of "did that come out right" that does not
need eyes, which is the half you still have when there is no browser. It is what
caught `mix` sitting next to `mixing` on a row.

**Verified** — `test/harness.mjs`, **816 checks, all green**, 44 new across
CREATE: two areas out of Config with a terminal stage each; mixing being a DJ
set and not a mixdown; a tick filed under all three segments and surviving a
reorder; a session carrying its work's area; the area's own session chips; the
combined shelf drawing both areas, one strip each, one add button each; the
filter narrowing list, strip and button together and being remembered; a work
whose stage *or whole area* was deleted falling back without throwing; the log's
filter and its empty state; the v1 lift, its tick keys, its sessions and its
write-back; the editor's tree, its per-area add, its terminal hand-off, its
whole-area add and its refusal to delete the last one; an area colour being one
variable rather than a rule per area; and "in flight" being gone from all three
files. Also read back through `test/peek.mjs`: the combined shelf, the shelf
narrowed to mixing, one mix, and the session log.

**Not looked at.** The browser was not available in this session, so nothing
here was seen on a real screen — no version since 3.0 has shipped that way, and
the area pills, the stacked strips, the paired add buttons and the week's split
bars are all new shapes that have been read but not *looked at*.

### 3.1 — 2026-09-06 — the finish time moves onto its row, and the tab bar gets three dials

> text in section boxes is clipped at the bottom · when a task is completed, the
> completed time overlaps the scheduled tat name. fix that. · tasks completed on
> the schedule should have their completed time / name on the schedule · add more
> colour palette options for tab icon logos (in the pill/bottom bar). also add
> options for the shape of the circle around selected tabs. also animation options.

**PLAN's boxes were cutting the tails off their own text.** Every box on that
screen hides its overflow, which is what keeps a long section name from pushing
its row wider than the grid it sits in. Set against `line-height:1` that clip
lands on the baseline, so the descender of a g, p, y or q was sliced off flat at
the bottom of the box: the row fitted, the word inside it did not. The five
elements that hide their overflow carry a real line-height now — the section
row and its count, the project tile's name, the open project's heading and the
date stepper's two lines. Nothing got taller for it, because the height of those
rows was never the text: they are sized by `min-height: var(--tile-h)` and their
own padding, and the tallest of the five now measures 34.8px inside a 46px row.

This is the same defect as 3.0.4's clipped day number, arriving from the other
direction — there a box was trimmed under text that still laid out in full line
boxes, here the text was trimmed under a box that was already the right size.
Both are `overflow:hidden` cutting an axis nobody was thinking about.

**A completion is written on its row now, not floated across it.** 3.0.4 drew
every completion as a mark at the minute it happened. For a task ticked off the
day itself that minute is, almost by definition, *inside its own row* — so the
dot, the time and the name printed straight over the name already sitting
there, and the one row you had just finished was the one row you could no longer
read. The two requests above are one change read from both ends: the collision
is the bug, and the answer is not to drop the time but to put it where it
belongs.

So a completion that matches a row on the day is stamped **into that row**: the
time, in the completion green with the same small dot the floating mark wears,
on the row's meta line beside what the row already says it is. Same fact, in the
place that already names it, with nothing left to collide with — and a row
carrying its own finish time is what "when did I actually get that done" was
asking in the first place. The meta line is a flex row rather than one clipped
box, so what the row *is* shrinks and ellipses while the time never does: four
characters, and half a time is not a time.

Matched by name, newest first, one mark to a row — the same routine finished
twice is still two things that happened, and two rows of that name take one each
rather than both claiming the later time.

*What still floats.* A completion with no row of its own: a block ticked on DO,
a `@quick` card, anything finished that the day was not drawing. Those are the
ones the rail was always for, and they by definition cross a row that is about
something else — so the mark is a **band** now rather than loose words. It used
to be `height:0` with each chip carrying its own background, which meant the
row's text showed through the gaps between them and read as two things printed
on top of each other. It is 13px of the page's own ground, centred on the
minute, with a hairline in the completion colour along its top edge: a note
written *across* the day rather than words dropped onto it.

**The mark around the selected tab is three dials, in appearance → layout →
Navigation.** *Selected tab* — pill (what it has always been), rounded, square,
circle, ring, underline. *How it arrives* — grow, pop, fade, rise, none. *Tab
palette* — app (the hues it already had), warm, cool, candy, neon, mono. All
three default to exactly what the bar looked like yesterday.

*One drawing, eight variables.* The indicator is drawn once, in `shell.css`,
from `--tab-c`, `--tab-ink`, `--tab-r`, `--tab-t`, `--tab-s0`, `--tab-y0`,
`--tab-dur` and `--tab-ease`. Every option is a value swapped into those, so
adding a palette is ten custom properties and adding a shape is one rule —
`shell.css` never learns which shape or which palette won. That is §4's rule
about tokens rather than literals, applied to a component that had grown
eighteen literal declarations.

*mono is the interesting one.* Colour-coding without colour: a nine-step ramp
cut from `--tx` with `color-mix`, so the tabs still differ — by weight rather
than by hue — and it is the one palette as legible on a light theme as at night.
Its `--tab-on-c` is `var(--bg)`, so it flips with the theme rather than being a
hex that happens to work on one of them.

*A bug found on the way.* An alerting tab is supposed to wear the warning
colour, and with colour-coding on it did not — it alerted in its own app hue,
which is the one moment its own hue is not what the bar is trying to say. The
palette claimed `background` on `::before` from a selector naming one app in one
bar, which outweighs `.tab-b.has-alert` and always will; no amount of
re-weighting the alert fixes that. The palette writes `--tab-app-c` instead and
`--tab-c` falls back to it, so the two stopped competing: the palette answers
"what colour is this app", the alert answers "what colour is this mark", and the
mark is drawn from the second. It also means the warning reaches ring and
underline, which draw their colour as a border rather than a fill.

*Two shapes do not survive the side rail.* On a wide window a tab is a wide box,
not an icon-sized square — a 50% radius on one is an ellipse, and an underline
is a rule down the middle of nothing. Circle and underline fall back to the box
the other four already are above 880px; ring is the outline of whatever box it
is given and needs nothing. `none` answers the "keep the bar moving" exception
with its own `!important`, or the one option that asks for stillness would be
the one option that could not have it.

**Verified** — `test/harness.mjs`, **791 checks, all green**, 17 new: the
descenders and that the rows did not grow for them; the stamp on its row and no
floating mark for it; the band for one that has no row; the eight variables; all
six shapes present and the two that fall back on the rail; all five animations
and `none`'s `!important`; every palette defining all ten properties; mono
carrying no hex at all; the three controls on the layout panel and in the
appearance reset; and the alert outranking the palette.

**Not looked at.** The browser was not available in this session, so unlike
every version since 3.0 nothing here was seen on a real screen. Everything above
is verified at the source and DOM level and nowhere else. That matters most for
the PLAN clip: a descender being cut off is a thing you can only *see*, so its
Todoist task is left open for Hugo to confirm rather than closed on a
line-height that ought to be enough.

### 3.0.4 — 2026-09-06 — nothing is cut any more, and the day records what was finished

Two regressions from 3.0.3, and a feature.

**The day number and the counter were being cut off, top and bottom.** 3.0.3
trimmed those boxes to their cap height for layout — but their children still lay
out in full line boxes, and both boxes carry `overflow:hidden`, which clips *both*
axes. Measured in Chrome: 9.4px off the top of the day number and 10px off the
bottom of the counter's digits. The clip either one actually wanted is
horizontal — a digit slides sideways out of the day number, and a long total must
not run into the wordmark — so both are `clip-path:inset(-100% 0)` now:
unbounded top and bottom, cut at the box edges left and right. §6 carries the
rule, because anything that trims a box it also clips will hit this.

**A completed task now leaves a mark on the calendar, at the minute it was
finished.** A green dot on the rail, the time, and the name.

*Why it is not a row.* Everything else on DAY is the day as it was **planned**;
a mark is the day as it **happened**. Keeping the two visually distinct is the
whole point — §6 has said since 2.23 that a drawing which quietly claims to be
the plan is the one thing this app must not be. So marks are stored beside
`days` rather than inside one, and drawn over the rows rather than among them.

*Who can leave one.* Anything that finishes a task: DAY's own rows, DO's block
tiles and DO's today list. DO's two calls sit next to the `LOG.setBlock` and
`TEND.setDone` calls already there, are optimistic like the tick itself, and are
taken back if Todoist refuses. Unticking removes the mark — the newest one of
that name, not all of them, because the same routine finished twice in a day is
two things that happened.

*Only today can take one*, because a completion has a clock time by virtue of
happening now. And a mark on a day that was never exported is kept but has
nothing to be drawn on until one is; it is not thrown away for it.

*Two things the first version got wrong, both caught by looking at it.* Marks
drawn one per completion landed on the same pixel when two things were ticked in
the same minute and printed over each other — they are grouped by minute and
their names joined. And the mark sat exactly on top of the now line's badge,
because today is the only day either of them appears on — it is inset past the
time column and the badge on the left, and past the row's controls on the right,
from measurements rather than guesses.

**Verified** — `test/harness.mjs`, **774 checks, all green**, 9 new; and in
headless Chrome: the `6` on LOG and the `3` on STORE's total drawn whole, a tick
on DAY leaving a mark at the right y, two completions in one minute drawn as one
mark, and screenshots of all three looked at.

### 3.0.3 — 2026-09-06 — the bands centre on their ink, and the counter travels

> center the elements in the sticky titles on every tab … there is a big gap
> between the title card and the calculator … also add the slide right/left
> animation that the titles / dates have. add it to the counter.

Measured in Chrome before touching anything, which turned up **two** causes for
one gap.

**The titles were centring their line boxes, not their letters.** A wordmark is
all caps, and caps in a `line-height:1` box leave the descender space empty
underneath: `STORE.` is 35.1px of ink in a 54px box. The band had no slack to
redistribute either — 14 top + 82 content + 12 bottom was exactly its 108px
floor — so `justify-content:flex-end` had nothing to do and all of that empty
space sat under the title. The titles now carry
`text-box:trim-both cap alphabetic` so their boxes *are* the caps, the band is
`justify-content:center`, and the floor is measured in the trimmed title. Every
band went from 108px to 94px, and what is centred is what you can see.

**And STORE was adding a second gap under its own band.** §6 has said since 2.19
that the gap under the band is the shell's and an app must not add to it — the
rule zeroes the first child's top *margin*, and STORE's `.cnt` was *padding*, on
all four sides. Every other app's `.cnt` is horizontal padding only. So the
counter widget sat 18px from the shell plus 18px of STORE's own: the gap between
the title card and the calculator, exactly as reported. Wordmark to widget is
32px now rather than 56px.

**One row height for every band.** Trimming the wordmark had a consequence worth
naming: DO's tab rail is 40px once its border and density-scaled padding are
counted, and the moment the title stopped being 54px that rail became the tallest
thing in the row and made DO's band 2px taller than the other nine. One band
shape for every app is what makes the title morph read as one title being pushed
along, so the row is now `max(--band-row, trimmed title)` everywhere and DO's
rail is pinned to `--band-row`. All ten bands are 94px at every title size.

**The counter travels with the titles.** `.h-cost` joins `.h-logo`, `.hd-title`
and `.h-daynum` in the morph: it slides in from the side you are moving towards
and the outgoing one leaves the other way, instead of appearing where the last
one left. Reduced motion takes it off with the rest.

**Verified** — `test/harness.mjs`, **765 checks, all green**, 8 new; and measured
in headless Chrome rather than argued from the stylesheet:

```
before   every band 108px   ink 8.5px above the bottom padding   store: 18+18 under the band
after    every band  94px   content centred, ink trimmed          store: 18
         wordmark sits at the same y on all ten tabs
         .h-cost animation: title-out leaving, title-in entering
```

One of the new checks was written with `[\s\S]*?` and passed against the wrong
rule three lines further down — the trap §6 already warns about, caught here by
the check failing rather than by luck. All five in this batch are bounded with
`[^}]` now.

### 3.0.2 — 2026-09-06 — the total says which way it went, with a sign

> replace the green/red animation to a + or - that appear for increase/decrease. in "store"

**The colour is gone.** The running total went green on a rise and red on a fall;
it now puts a `+` or a `−` at its head for a moment instead. Colour asked the eye
to decode a hue into a direction — on a number that already carries the accent in
its shadow, and against a palette the theme picker can move out from under it. A
sign does not need decoding and cannot collide with a theme.

**Where it goes.** At the head of the number, `display:none` between changes so
it reserves nothing on a band that has none to spare. The counter has the right
end of the row to itself (`justify-content:space-between`), so when the sign
appears the box grows *leftwards* and the digits stay where they are — measured:
the box gained exactly the sign's 28.4px and the number did not move.

**What it wears.** What the number wears — title colour, accent shadow. Its job
is done by appearing, not by being another colour, and 3.0.1 had just finished
taking the last two inversions out of this band.

**Its life is one animation.** It turns in like one of the digit cells, holds
while the total is read, and fades. `−` is U+2212, the typographic minus, which
is a digit wide in tabular figures rather than the stubby hyphen.

**The nudge stays.** A fraction of a millimetre up on a rise and down on a fall.
It is not a colour, it says the same thing the sign says, and it was already
there — easy to drop if it is one signal too many.

**Verified** — `test/harness.mjs`, 757 checks, all green (7 rewritten from the
green/red flash, 5 new), and driven in headless Chrome: `+` on a rise, `−` on a
fall, gone at rest, nothing green or red left in the counter's rules.

**Found on the way, and still open: the pinned total does not fit.** At 412px
the wordmark takes 326px of a 376px row and the counter gets 36px for 267px of
content — 231px cut off, at every title size. It is a 2.25.1 defect, not a new
one, but it means this sign is largely unseeable until it is dealt with, and
dealing with it means making the wordmark or the number materially smaller while
the counter is pinned. That is a look rather than a fix, so it is Hugo's to
choose. §6 carries the measurement.

### 3.0.1 — 2026-09-06 — the title shadow was never overridable, and both "fixes" proved it

Hugo, for the third time: *"the dot is still not fixed. same with the animation
for the store total, the shadow is still staying red it needs to be accent
shadow, title text colour it's not hard to understand."*

He was right three times, and the reason all three attempts failed is one line
in `tokens.css`.

**`--title-sh` baked its colour at `:root`.** It was
`var(--title-sh-x) 0 0 var(--title-sh-c)`, declared on `:root` — and a custom
property's own `var()` references are substituted when *it* is computed, on the
element it is declared on. So `var(--title-sh-c)` resolved to the accent *there*,
and every element below inherited a finished string with nothing left in it to
override. **Every `--title-sh-c` override in the app was doing nothing**: the
wordmark's dot, STORE's currency mark, and the green/red flash on the total.

Lengths are the opposite — they stay lazy and resolve against whoever uses them —
so the offset *was* correctly 3px on the 54px wordmark and 1px on the 0.4em
currency mark. Half of it worked, which is why nobody caught the other half for
five versions.

The shadow is composed at the point of use now —
`text-shadow:var(--title-sh-x) 0 0 var(--title-sh-c)` — in all twelve places
that wear it. There is no composed token to reach for, and a check fails if one
comes back.

**The dot is the word.** Title text colour, accent shadow, exactly like the
letters in front of it. 2.26.2 and 3.0 both tried to make it the *inverse* of
the word — accent glyph, title-coloured shadow — and 3.0 finally succeeded at
applying an effect nobody had asked for, which is how it ended up further from
what was wanted than the version that did nothing. The rule for it is deleted
from `shell.css` and the `color:var(--y)` is deleted from all ten app sheets:
it inherits both now, and there is nothing left to invert.

**STORE's total is one signal again.** With the token fixed, the digits, the
decimal point, the shadow and the currency mark all move to green or red
together and ease back together — measured in Chrome, not inferred: during a
change every one of them reports the same `rgb()`, and the shadow tracks the
text frame for frame. The currency mark also stops being the inverse of the
number beside it, for the same reason the dot did.

**Measured, not argued.** 3.0 shipped two shadow fixes reasoned entirely from
the stylesheet, because jsdom does not cascade and a regex on a CSS file will
cheerfully assert the half that does nothing. This one was found by launching
headless Chrome over the devtools protocol and reading `getComputedStyle` off
the real page — sixty lines, node's global `WebSocket`, nothing installed. The
before/after is unambiguous:

```
before   dot   color rgb(167,139,250)  shadow rgb(167,139,250)   <- accent on accent
after    dot   color rgb(222,222,222)  shadow rgb(167,139,250)   <- title on accent
before   total color mid-red           shadow rgb(167,139,250)   <- shadow never moved
after    total color mid-red           shadow mid-red            <- linked
```

§6 carries both lessons: what a custom property bakes and when, and to go and
measure a visual fix rather than read the stylesheet again.

**Verified** — `test/harness.mjs`, 755 checks, all green; the nine checks that
had been asserting the old token were rewritten to assert the behaviour, plus
two new guards (nothing reaches for `var(--title-sh)`, and no sheet paints the
dot). And this time, looked at: the wordmark rendered at 3× in Chrome.

### 3.0 — 2026-09-06 — CREATE, and two things that were the same mistake twice

A ninth app, and two fixes that turned out to share a root cause.

---

#### CREATE — the songs being made

A tenth tab. The brief was one line — *"new tab CREATE for music production and
mixing, do what you think is best first then we will adjust"* — so the shape of
it is a decision, and this is the decision:

**A song sits on a stage, a stage asks a checklist of it, and every hour at the
desk is written down.** Three screens — the shelf, one song, the session log —
and no network at all.

*Why that and not a task list.* ROOT already has four ways to track work that is
due, and none of them fit a song: a song has no date, it is never late, and
having six of them open at once is the normal state of the craft rather than a
backlog to clear. What is actually hard to hold in your head is **which of them
is at which point**, and what "mix" means at four in the morning when you have
already listened to it two hundred times. So the stage is the state, and the
checklist is the app remembering the discipline you are too close to the track
to remember. Nothing here is due, nothing badges the tab, and nothing is ever
overdue.

*What is Config's.* The stages, their colours and their checklists — the whole
path a song walks is editable from Settings → create, including adding stages
and rewriting every list. The module holds no list of its own; the strip on the
shelf, the stepper and the checklist are all drawn from Config, so a stage added
in the editor needs no code and no CSS.

*What is the app's.* The songs, their ticks, their notes and every session, in
`create_v1`.

**Identities, and the one trade.** A stage's `key` is what a song's stage and
every one of its ticks is filed under, so it is shown in the editor and never
edited. A tick is filed under `stageKey|item text`: reordering a checklist keeps
every tick, rewording a line drops that one line's. A key column in the editor
would have protected the rename, and it would have been worse to live with than
the thing it protects — the same call DO's routine items already make.

The finished stage is found by `terminal`, never by its key or its position, so
"released" can be renamed to anything and the shelf still knows where a song
stops. Delete the row carrying it and the last stage inherits it, because a
shelf with no way to finish a song is not a shelf.

**The shelf.** How many songs are in flight, a strip of one segment per stage as
wide as the songs sitting on it, the songs themselves (sorted by last worked on,
by stage, or by name), and the last seven days' hours. Released songs are behind
a fold: a good thing to have and a bad thing to scroll past every time.

**One song.** Its tempo, key and tags as chips that open the app's own dialog;
the stage stepper; that stage's checklist; notes saved as you type; and the log
form — hours through the numpad's `duration` kind (130 is 1h30), a word about
what you did, and the session kinds as chips that fill the field rather than
replacing it.

**The session log.** Every session, newest first, under the day it happened on,
with the week and the all-time totals.

*Wired the way §7 says and nowhere else:* a slide whose `#s-home` starts with a
`.h-top`, `css/create.css` scoped to `.ns-create`, `Shell.register('create')`, a
`.tab-b` and a `tab-create` sprite symbol, `'create'` in `Prefs.APPS`, a settings
panel ending in its content box, `SET.PANELS` / `CATS.apps` / `SEG_NAMES` /
`RENDERERS` / `APP_NAMES` / `APP_HINTS` / `GROUPS`, two `EDITORS` entries, and
two `CONTENT` rows plus a `search` hook so both the stages and the songs are
findable. The `appsSeen` migration carries it onto an install that already has
an app list, which is the trap CAL walked into and there is a check for.

*The icon is a waveform — five bars and nothing else.* A fader would have been
the settings sliders again; the harness takes a signature of each `tab-*`
symbol's shapes and fails on a repeat, and five bars is a shape no other tab
icon is built from.

---

#### The dot's shadow, properly this time

2.26.2 said the dot after a wordmark takes the title colour as its shadow. It
did not. `.h-logo em{--title-sh-c:var(--tx)}` was the whole fix, on the
reasoning that `text-shadow` is inherited so restating the colour was enough.

**A `var()` is substituted on the declaration that uses it, on the element that
declaration applies to.** `.h-logo`'s `text-shadow` had already resolved to the
accent; what the dot inherited was that finished value, with no custom property
left in it to override. So the dot went on wearing an accent shadow behind an
accent glyph — not a shadow, just a slightly fatter dot, which is the exact
non-effect 2.26.2 was written to remove. Two versions of it.

The rule re-declares `text-shadow` beside the property now. STORE's counter and
its currency mark have always done both, which is why those two worked and this
one did not, and §6 now says so in the general form: anything that re-points
`--title-sh-c` owes itself a `text-shadow`.

**The check that passed was reading the custom property alone.** jsdom does not
cascade, so a regex on the stylesheet is all there is — and this one asserted
the half that was there rather than the half that made it work. It reads the
declaration beside it now.

---

#### STORE's total: one signal, one speed, and a board

Same root cause, one level along. The counter was rebuilt with an
`innerHTML =` on every repaint, which threw the currency mark away and built a
new one. **A replaced element has no previous computed value, so it cannot
transition:** the digits eased into green over `--dur-3` while the mark *snapped*
to it. One signal arriving twice, at two speeds, which is what reads as a
rendering fault rather than as a total going up.

The number is cells now — one per character, the decimal point included — and
they are updated in place; the mark is moved across a rebuild rather than
recreated. The cells declare no colour and no shadow of their own on purpose: an
inherited value follows the parent's transition frame by frame, so the digits,
the point and the shadow move with `.h-cost` for free and cannot drift from it.
The mark is the single exception, because it is deliberately the other colour,
and it carries a matching transition so it arrives with them rather than after.

**And the cards turn over.** A character that changes flips in from the top edge
in a short perspective, each cell a beat behind the one to its left — a
departure board. Only the characters that actually changed get it, so 4.50 →
4.90 turns one card rather than four, which is what makes a board read as fast
as it does. It rides `--mo` like every other animation, so "no motion" stops it
dead. Arriving is still not a change: pinning the counter mid-trip mounts, and
the cells do not also flip — two entrances at once is neither.

---

#### Also

**The colour-coded tab list had no entry for DAY.** Adding CREATE's meant
writing the line next to the gap; DAY was the only app whose pill fell back to
nothing with colour-coded tabs on. One line, and called out here because it was
not asked for.

**A harness check failed for one hour every night.** DAY's now-line fixture
built its day from `hour - 1` modulo 24, so between 00:00 and 00:59 it wrote a
day starting at 23:00 — an hour before the date it was filed under — and then
asked CAL where midnight fell in a day that had not started. CAL was right both
times; the fixture was wrong. The window slides to fit now instead of wrapping,
and what it expects moves with it. Found by running the suite at 00:14.

---

**Verified** — `test/harness.mjs`, **755 checks, all green**, 31 new: CREATE's
wiring, its Config-driven stages and checklists, the tick that survives a
reorder, a stage deleted from under a song, the session log, the released fold,
the delete that takes its sessions with it, both content editors, the terminal
flag surviving an edit; the dot's re-declared shadow; and the counter's
surviving mark, its cells, and the flip that only touches what changed.

**Not verified by eye.** jsdom does not lay out or paint, and the browser
extension was not connected this session, so nothing here has been seen on a
screen: CREATE's whole appearance, the dot's shadow, and the flip board are
argued from the stylesheet rather than looked at. The three Todoist tasks are
completed because each was built and is covered by checks; if any of it looks
wrong on the phone, that is the adjusting the CREATE task already said would
come.

### 2.26.2 — 2026-09-05 — the shadow stops clipping, the dot inverts, QUICK gets its heading back

Four adjustments to the title shadow, three of them things the last two releases
put there.

**The shadow needs room, so the offset is its own token.** `--title-sh-x`.
`.h-daynum` has to clip — that is what stops a number on its way out making the
row taller — and the shadow is the one part of the glyph that sticks out to the
right, so it was the part being cut off. The box is now a shadow-width wider and
the digits sit a shadow-width off its right edge. STORE's total reserves the
same. One value, so the reservation cannot drift from the thing it reserves for.

**The dot after a wordmark is the inverse of the word.** `DO<em>.</em>` — the
word is title-coloured with an accent shadow, so the dot, already the accent,
was an accent shape behind an accent shape: not a shadow, just a slightly fatter
dot. It takes the title colour as its shadow and keeps the accent as its own
colour, which reads as the same treatment seen from the other side.

**STORE's total flashes as one object.** The `€` sat at a fixed accent while the
digits went green and red, and half a number changing colour reads as a
rendering fault rather than as a signal. The mark and both shadows go with it
now. It also gained the shadow it had been opted out of: that exemption existed
because at `.4em` the un-rounded `.055em` came out sub-pixel and doubled into
mush, and with 2.26.1's whole-pixel offset there is nothing left to avoid. Like
the wordmark's dot, it wears it inverted.

**DO's QUICK heading had been wearing a task row's font.** Not a shadow, despite
appearances. `.tt-name` was declared twice in `do.css` — once for QUICK's fold
button and once, later and at the same specificity, for a task row's name
(12.5px mono in the foreground colour). The row's rule won every time, so QUICK
was set in a task row's type while BLOCKS, TODAY and MEDIA used the head's own
10px letter-spaced accent caps. The two names had nothing to do with each other
and only ever collided; the fold button is `.tt-fold` now, and a check fails if
`.tt-name` is ever declared twice again.

**Parked, not built:** the triple-tap reachability idea (`@idea`).

**Verified** — `test/harness.mjs`, **720 checks, all green** (713 at 2.26.1).
New coverage: the offset as its own token with its floor and fallback; the
daynum reserving it and offsetting its digits by it; the inverted dot; the
inverted currency mark; the whole unit flashing together; the total reserving
its own shadow; `.tt-name` declared exactly once; QUICK's heading inheriting the
head's type; and no section head carrying a shadow at all.

### 2.26.1 — 2026-09-05 — the shadow was the blur, and the fold was the other one

Both of 2.26.0's regressions, and the wordmark it forgot.

**The shadow was a sub-pixel smear.** `--title-sh` was `.055em`, which is 2.97px
on the 54px wordmark — a proper offset copy — and **0.825px on a 15px sticky
title**. A glyph copied less than a pixel sideways is not a shadow; it is the
same glyph drawn twice, half a pixel apart, which is the textbook way to make
text look out of focus. 2.26.0 put that on every sticky title in the app and
called it a treatment.

It is `max(1px, round(.055em, 1px))` now: a whole pixel at every size it is used
at, 1px on a sticky title and 3px on a wordmark, with a plain `1px` fallback for
a browser without `round()`.

**And the fold was the other regression.** 2.26.0 retired Interface scale
because document zoom put the whole page on fractional pixels — then folded the
stored scale into **Spacing**, which multiplies every padding and gap in the app
(`calc(18px * var(--dens))`). At 1.1 an 18px padding becomes 19.8px, every box
below it starts on a fractional offset, and the text inside it sits on a
fractional baseline. That is *the same defect, moved from one multiplier to
another* — and worse than the original, because the dial that could be put back
to 100% no longer existed.

The scale is dropped now rather than folded, and an install that 2.26.0 folded
is repaired: Spacing goes back to its default once, recorded in `densRepair` so
it happens once and never touches a Spacing chosen afterwards. The Spacing dial
carries a note saying what it does to text at anything but 100%, because it has
always had this property and nothing had ever said so.

**The wordmarks wear the shadow.** 2.26.0 put it on the sticky sub-screen
headers and the big dates and left out the one thing in the app most obviously a
title — `DO.`, `STORE.`, `LOG.` Set once in shell.css with the rest of the
band's shared shape, not in eight app sheets.

**Verified** — `test/harness.mjs`, **713 checks, all green** (710 at 2.26.0).
New coverage: the shadow offset rounded with a 1px floor and a fallback; the
wordmark wearing it; a stored scale dropped rather than folded; the repair
recorded so it runs once; a Spacing chosen after the repair left alone; and no
control for the repair flag, which is a record and not a setting.

### 2.26 — 2026-09-05 — the blur was `zoom`, and the shadow goes on every title

**It was Interface scale.** `html{zoom:var(--ui-scale)}`. Hugo found it by
moving the dial.

Document zoom multiplies every length in the page by a fraction. The app's type
is written in whole pixels — 8, 9, 9.5, 10, 11.5, 15, 54 — so at any scale but 1
every one of those becomes a fraction, and a fraction of a CSS pixel is a
fraction of a device pixel at any DPR. The glyphs are then resampled rather than
drawn, worst on the smallest type: which is exactly why it showed on the band's
10px date line and not on the 54px wordmark beside it, and why it was identical
on every theme, every screen and every build.

That last part is what four releases failed to read. Snapping the wordmark
(2.24.0), snapping the safe-area inset (2.24.1), taking the scroller off iOS's
legacy compositing path (2.25.0) and handing the status bar back to iOS (2.25.1)
each fixed a real defect and **none of them could have changed this**, because a
document-wide zoom sits above all of them. Four fixes that changed nothing were
four pieces of evidence pointing at a cause that applied to the whole document,
and the search stayed local instead.

**The dial is gone rather than tuned**, because no arrangement of steps is
sharp: for a 9.5px label to land whole at 3× DPR the scale would have to be a
multiple of ⅔, which is not a dial. What it was for is already covered by three
controls that are whole-pixel by construction — **Spacing**, **Title size** and
**Sub-screen title size**. An install that had moved it keeps the size it chose:
the stored scale is folded into Spacing on first load, clamped to Spacing's
range, and the key is deleted so it can never be applied twice. `tokens.css`
carries the whole story so nobody re-adds it.

**The title shadow is a shared treatment now.** It started on STORE's running
total in 2.25.1 and is one token (`--title-sh`) from here on, worn by every
sticky sub-screen title and by the big dates on LOG and DAY. Three copies of the
same offset in three stylesheets is three chances for them to drift.

**STORE's total is the wordmark's own size** — `min(--title-px, 14vw)`, so it
matches `STORE.` exactly at the default and only gives way at the title sizes
where it genuinely would not fit. Its currency mark reads in the accent.

**LOG's caffeine counters had a frozen accent.** The label under a selected
coffee or energy drink was `rgba(167,139,250,.6)` — VOID's violet, written in as
a literal — so on every other preset it stayed violet while its own border and
number had already gone to the theme's colour. It takes `var(--y)` now, the same
shape the currency counters two rules below had always used.

**Parked, not built:** the triple-tap reachability idea (`@idea`).

**Verified** — `test/harness.mjs`, **710 checks, all green** (698 at 2.25.2),
braces balanced, every touched module parsed, site served over http. New
coverage: no zoom and no `--ui-scale` anywhere; the dial gone from the schema,
the panel and the reset list; the three replacement dials present; a stored
scale folded into Spacing, folded *once*, and clamped; the shadow token and
every title and date wearing it; the total at the wordmark's size with an accent
currency mark; and no hardcoded violet left in LOG's rules.

### 2.25.2 — 2026-09-05 — the blur was the contrast

**It was never a rendering artefact.** `--mu` is `#4a4a4a` on a `#0e0e0e`
ground — a contrast ratio of **2.18:1**, under half the minimum for body text.
It is the *placeholder* colour, named as such in tokens.css, and the title
band's date line was using it as a **label** colour at 10px, bold, uppercase,
with .16em of letter-spacing.

Small text at 2:1 does not read as faint. It reads as **out of focus**. That is
what "the top of the sticky title is blurred" was, through five reports and four
wrong fixes — and it is exactly why pixel-snapping, a compositing path and the
status bar each changed nothing at all: none of them was ever touching the thing
that was wrong.

The screenshot said so plainly and it took too long to read it: *every* soft
thing in it was `--mu` — the date, `sync`, the day number, the inactive tab
chips — and *every* crisp thing was not: `DO.`, `ROUTINE P1`, `chores`. Four
fixes that each changed nothing were four pieces of evidence that the model was
wrong.

The band's label rows take `--tx-2` (**6.86:1**), and so do the actions sitting
in the same band — DO's and TEND's `sync`, LOG's date arrows and its "today"
chip, STORE's settings link. `--mu` itself is unchanged and still the
placeholder colour; it now carries a note saying that is all it is for.

**All four earlier fixes are kept.** Each was a real defect found on the way and
each is worth having: the wordmark still snaps to a whole pixel (2.24.0), so
does the status-bar inset (2.24.1), no scroller is on iOS's legacy accelerated
path (2.25.0), and the app no longer runs under the system status bar (2.25.1).
None of them was reverted to get here.

**Verified** — `test/harness.mjs`, **698 checks, all green** (693 at 2.25.1),
with the new ones asserting that no band draws its label row in `--mu`, that
they take `--tx-2`, that the actions beside them followed, that `--mu` is
unchanged and documented, and that none of the four earlier fixes was undone.

### 2.25.1 — 2026-09-05 — the status bar goes back to iOS, and STORE's total gets a face

**The blurred band was the status bar, and the page was asking for it.**
`apple-mobile-web-app-status-bar-style: black-translucent` hands the page the
whole screen, status bar included, and lets iOS draw its own material over that
strip. Everything the band put up there was therefore *underneath* something the
app does not control and cannot opt out of from inside the page — which is
exactly where the title band's top row was sitting, and why it read as blurred
while identical type twenty pixels lower did not.

Three releases went looking for the cause in CSS: a fractional wordmark
(2.24.0), a fractional status-bar inset (2.24.1), a legacy iOS compositing
opt-in (2.25.0). **All three were real defects, all three are fixed and staying
fixed, and none of them was this.** Four reports of an unchanged screen is
enough evidence that the thing drawing over the band was never ours.

`black` gives the strip back. iOS reserves it, paints it black, and
`env(safe-area-inset-top)` becomes 0 — so the app starts below the bar and
nothing of ours is under the system's material. The cost is that ROOT no longer
runs edge-to-edge at the top: near-invisible on the dark presets, whose ground
is `#0e0e0e`, and a black bar above a pale app on a light one. Reverting is one
word in one meta tag; everything else is written against `env()` and follows
either value without a change.

**STORE's total moved out of the fight it was in.** 2.25 put the item count and
the total at the same end of the same row, and two big things at one end of a
phone-wide band is how the total ran off the edge. The count reads on the date
line now — `SAT 5 SEP · 3/11 ITEMS`, DO's shape — and the total has the
wordmark's row to itself. Its size is the wordmark's scaled down *and* capped
against the viewport, so a four-figure basket at the largest title size still
fits beside `STORE.`; `min-width:0` and the band's own `overflow:hidden` are the
backstop.

**It is white, with a hard offset copy of itself behind it.** White because it
is the loudest number in the app while it is up and the pinned widget already
speaks in accent — two accents arguing at the top of the screen is worse than
one plain number. The shadow is a `text-shadow` with **zero blur**, one
twentieth of an em to the right, so it reads as the number's own shape displaced
rather than as depth; on a near-black ground a dark shadow is invisible, so it
takes the accent, which is also what stops a white number looking like it came
from the operating system.

**And it says which way it went.** Green as it rises, red as it falls, easing
back to white when it settles. The colour is the whole signal, so the movement
under it is a nudge — five hundredths of an em up on a rise, down on a fall —
enough to catch the direction without the number appearing to jump. The shadow
takes the colour with it, so the two never disagree. Arriving is deliberately
*not* a change: pinning the counter mid-trip mounts the number rather than
flashing it green, because "you just spent forty euros" is not true of money
that was already spent.

**Parked, not built:** the triple-tap reachability idea (`@idea`), unchanged
from 2.25.

**Verified** — `test/harness.mjs`, **693 checks, all green** (679 at the end of
2.25), braces balanced, every touched module parsed, site served over http. New
coverage: the meta tag changed and the bottom inset still claimed; every header
still measuring from `env()` so either status-bar value works unchanged; all
three earlier fixes still in place; the count on the date line with the total
alone on the wordmark row; the total sized against the viewport as well as the
title; the shadow being hard, offset and not doubled on the currency mark;
mounting not flashing; green on a rise, red on a fall, the shadow following, the
nudge being a nudge, the ease back to white, and a no-op repaint not re-firing.

**Not verified** — the blur, for the fourth time and the last time this way. It
cannot be seen from jsdom. What is different is that this is no longer a guess
at a CSS defect: it is the one candidate that was always outside CSS, and it is
now simply not asking iOS to draw over the app any more.

### 2.25 — 2026-09-05 — the blur is found, the date shuffles, STORE's counter comes up top

**The blurred title band was `-webkit-overflow-scrolling:touch`, and it took
three releases to find because it cannot be seen anywhere but on a phone.** That
property opts a scroller into iOS's legacy accelerated path, where the scroller
and everything composited over it are rasterised into layers and re-scaled
rather than redrawn — and text on a re-scaled layer is resampled. `.h-top` sits
directly over `.view-body` at z-index 20, which is exactly why the softness
landed on the band and nowhere else on the page, and why the date line (10px,
letter-spaced, muted) was the first thing to show it.

2.24.0 and 2.24.1 both went looking for a fractional pixel — `--title-px` for
the wordmark, `--sat` for the status-bar inset. Both of those were real, both
are kept, and neither was this: the offsets were never the problem, the
compositing path was. Hugo pasting the screenshot and saying "nothing changed"
after two attempts is what ruled the whole class out. The property has done
nothing since iOS 13 — momentum scrolling is the default — and is deprecated;
all seven uses are gone. The sideways strips keep their `touch-action:pan-x`,
which is the rule that actually makes them draggable.

**The big date is a shuffle now, and DAY has one too.** A vertical roll says
"the next one along", which is right for a counter and wrong for a date:
stepping through days is riffling a deck. The number that leaves is flicked to
one side, tilted seven degrees and blurred as it goes, while the next drops in
from the other side and settles. `--dn-dir` carries the direction you moved, so
forward throws the old one left and back throws it right — the animation and the
gesture agree about which way time went. It lives in `Shell.dayNum()` rather
than twice in two modules, because the point of DAY's being "the same big date
as in LOG" is that they are the same object; two copies would be two things to
keep in step. Two bugs fell out of writing it once: the cleanup timer was
module-level, so whichever box shuffled second cancelled the other's cleanup and
left its digits piling up behind the live number; and a fast burst of steps
stacked one outgoing digit per step. There is exactly one number on its way out
now, per box, ever.

**LOG's date arrows step aside like DAY's stepper**, on the same dial
(`calStepsHide`) rather than a second one — they are the same control doing the
same job, and "how long before a stepper gets out of the way" is one question.
They fade rather than being removed: taking them out of the row would move the
date sideways under them every time.

**STORE's band carries the list total, and the trip's cost while the counter is
pinned.** The two share one flex end deliberately — mounting the cost is what
pushes the item count leftwards, so nothing has to be told to move and the two
cannot get out of step. They are the same information at two scales, so they are
drawn as different kinds of thing: the count is the band's small type, the cost
is the big-number treatment LOG and DAY use for the date, in the accent and
carrying its currency, going red when the budget is. With the price up in the
band the widget stops drawing it and keeps what the band cannot carry — the
budget line, the bar and the keys. And it locks flush: `top:0`, not
`top:-1px`, which had been tucking its own top border out of sight at exactly
the moment it became the topmost thing on the page.

**More faces, and the sticky sub-screen title gets a size of its own.** Six
display and three mono, chosen to widen the range rather than lengthen the list
— a condensed grotesque, a geometric, a slab, a high-contrast serif, a rounded
face, an editorial one. And `.hd-title` had its 15px written into six
stylesheets as a literal, so the Title size dial reached the eight home
wordmarks and nothing else: the header you actually sit under while working was
the one piece of type in the app with no say over it. `--hd-title-px` is its own
five-step dial, and the bar's padding is derived from the size, so a bigger
title gets a proportionally taller header instead of a big word crammed into a
small box.

**Parked, not built:** "bring content down: triple tap screen to bring elements
down 50%" (`@idea`). The `@idea` label is the protocol's new parking place — a
thought written down where it will be seen again, not a request. It is listed
and left alone, never completed, because closing it would throw away the idea.

**Verified** — `test/harness.mjs`, **679 checks, all green** (657 at the end of
2.24.1), plus braces balanced across twelve stylesheets, every touched module
parsed, and the site served over http. New coverage: no sheet left on the legacy
scroll path while the pan-x claims survive; both earlier snapping fixes kept;
LOG's arrows idling, waking on touch and waking on a step; the shuffle's
sideways travel, blur, tilt and direction; DAY carrying the same number from the
same helper; neither box's cleanup cancelling the other's under a burst; STORE's
count and cost sharing a flex end, the cost mounting only when pinned, the
widget dropping the price and keeping the bar, and the pin locking flush; the
font lists' size and weights; and the sub-screen dial claiming the root, every
header measuring from it, the bar growing with it, and the appearance reset
knowing about it.

**Not verified** — the blur, again, for the same reason as twice before: it is a
rendering artefact on a device this session cannot reach. What is different this
time is that the cause is a named, deprecated, iOS-specific compositing opt-in
that was sitting directly under the one element that showed the symptom, rather
than an arithmetic term that ought to have mattered and did not.

### 2.24.1 — 2026-09-05 — the date moves to LOG, a day can be started from nothing

Six `@claude` tasks, all `@fix`, and four of them 2.24.0's fault an hour after
it shipped.

**The day number is LOG's, not DO's.** It was the wrong home twice over. On DO
it shared the wordmark's row with the daily/media/other strip and took the width
that strip needed — which is the "display issue" on the tab bar, same task, same
cause. And on DO the number only ever changes at midnight, so the roll, which is
the entire reason for drawing it big, was something you would see once a day and
only if you happened to be looking. LOG is the app that *moves* through days: the
arrows above the wordmark step the date, so the number changes whenever they are
used and the roll says which way you went. It reads in the title's own colour
now rather than the muted one — it is the second half of that line, not a
caption beside it.

**A day can be started when PLAN never sent one.** DAY could only draw a day
that had been exported, so a morning with nothing planned offered exactly one
route: leave for PLAN, queue tasks, send them. That is right when there is
something to send, and wrong when the blocks are already on DO — labelled @b1 /
@b2, fetched, sitting there — and all that is missing is a day-shape to drop
them into. The empty card now offers "schedule from do", which builds that shape
and opens the slot panel in one tap.

**§9 is not bent to do it.** CAL still resolves no template: `PLAN.blankDay()`
resolves it — the same `resolved()` an export uses, given a start time rather
than reading the form — and hands the finished record over through `write()`,
which remains the only way into that store. What *is* different from an export
is that nothing was sent: no Todoist task, no 22:00 agent, no Google. So the day
is marked `localOnly` and the head says **not sent**, permanently, and ahead of
"edited" because it is the larger of the two claims. A real export for the same
date replaces the record whole and the marker goes with it, which is correct —
that day *is* sent.

**The routines full/minimal control had no styling at all.** 2.24.0 invented
`.opts > .opt` for it; the app's shape for a choice is `.chips > .chip`, which
is what `chips()` generates for the built panels and what every static panel
writes by hand. No stylesheet had ever heard of the class it was given, so it
rendered as two bare buttons.

**PLAN's project title resizes faster, and its rule stops popping.** The move
owned .58 of the flip budget — near 400ms of watching a word change size, and
the name growing 13px → 24px is the one part of that gesture where the scale is
what you see rather than the travel. A slow translate reads as weight; a slow
scale reads as text struggling to settle. It is .34 now, so the reveal starts
sooner and the whole gesture is shorter as well. The rule under the open
project's name was an `::after`, and `el.animate()` cannot touch a
pseudo-element — so while every real element around it was held at zero by the
reveal wave, the rule snapped in on the first frame. It is a real child of the
tile now, holds no mover, and comes down with the section rows in their stagger.

**The blur: the other half of the arithmetic.** 2.24.0 found that the band's
vertical metrics were fractional and snapped the wordmark. The blur stayed,
because there are *two* fractional inputs and the wordmark is only one of them.
The other is the status-bar inset: a notched iPhone reports
`env(safe-area-inset-top)` as 47.33px, and that number lands in the band's
padding-top *and* its min-height — so with `justify-content:flex-end` every row
inside was still being pushed to a third of a pixel, and the smallest text in
the band was still being resampled rather than drawn. `--sat` is that value
snapped with `round(up, …)` — up, never down, because it is clearance from a
physical notch and a header ending a fraction high is a header with the clock on
it. All thirteen uses across seven stylesheets now measure from it.

**Verified** — `test/harness.mjs`, **652 checks, all green** (640 before). New
coverage: the day number on LOG in the title colour and gone from DO, and the
roll firing on a real date step; the empty day's two actions and their
weighting; `blankDay` returning the template with every slot empty and writing
nothing on its own; the `not sent` marker and its removal by a real export; CAL
still reading no `plan.*` config; the `ph-rule` being a real element outside any
mover; the move fraction being well under half the budget; and `--sat` being
snapped, rounded up, and used in place of every raw inset.

**Not verified** — whether the blur is gone. It is a rendering artefact, jsdom
cannot see one, the browser extension would not connect, and the image attached
to the task was not reachable through the Todoist API. The fix above is a real
remaining fractional term in the same defect, found by reading; it is not a
confirmation. Two other candidates remain if it persists: the
`black-translucent` status-bar style with `viewport-fit=cover`, which lets iOS
composite its own translucent bar over the top strip, and `html{zoom}` from a
non-default Interface scale. The task is left open in Todoist for that reason.

### 2.24 — 2026-09-05 — the media tab rebuilt, the day gets an editor, and the title stops being soft

First release taken straight from Todoist: eleven tasks labelled `@claude`,
carrying their own type and target (see `_git-push/PROTOCOL.md`).

**The media tab is a list now, not a grid of tiles.** 2.8 drew media as the
block tiles — three across, 64px boxes — which is the right shape for a block
(a word standing for an hour) and the wrong one for a *title*, because titles
are long. Three-across at 11px meant four wrapped lines or an ellipsis on
anything longer than "Dune", so the tab stopped being readable at exactly the
length a backlog reaches. It is one row per title now: the label's colour as a
rail down the left edge, the name at two lines before it gives up, the kind and
the second label as a meta line under it, and the tick on the right where every
tickable row in ROOT keeps it. Four things came with it, all drawn from data
that was already being fetched: **kind chips** with the open count on each, so
"what films have I got" is a tap; a **find** box (only once the list passes
eight, below which it is furniture); a **sort** — by kind, a → z, or by
priority, which had been fetched from Todoist since 2.8 and shown nowhere; and
**surprise me**, which picks one open title from whatever is filtered. That
last one is the honest answer to what a watchlist is for — the problem with
forty films is never finding one, it is choosing. The kind and the sort persist
(`td.mediaKind`, `td.mediaSort`); the find box does not, because a query you
come back to two hours later is a list that looks broken. A stored kind whose
label has since been deleted from Config falls back to "all" rather than
hiding the list behind a chip that is no longer drawn.

**Rows on the day can be deleted, and the prompt asks what to do with the
hour.** A day arrives from PLAN whole, and until now correcting one meant
re-exporting it — a great deal of ceremony for "that meeting is off". There are
exactly two honest things to do with the time a deleted row leaves, so it asks
rather than choosing: **close the gap** moves every row after it earlier by its
duration (the day is genuinely shorter, and you finish sooner), or **leave it
free** turns the row into an unclaimed slot and leaves the rest of the day
exactly where it was planned. The second is the right answer more often than it
sounds — a train at six is still at six whether or not the morning emptied out.
Either way the day is marked `localEdit`, same as filling it from DO: it no
longer matches what was sent. An idle row has no delete, because there is
nothing in it to remove. This is the first three-answer question in the app, so
`Shell.ask` gained an optional `alt` button (settling as the string `'alt'`) and
the action row stacks when there are three of them — three verbs across a phone
leaves each of them two words.

**LOG's morning wake-up time moves the day.** PLAN resolves a day against a
start time chosen the night before; the morning then happens, and the real
answer is rarely the one PLAN guessed, so every row was off by the difference
and the now-line crossed a schedule that stopped being true before breakfast.
Saving the morning form now shifts the whole day by `wake − start`. The day
keeps its shape — that is the thing this app draws — and only its position on
the clock changes. `rec.wakeShift` records what has already been applied, which
makes it idempotent and reversible: correcting 08:10 to 07:50 moves the day by
twenty minutes and not by another two hours, and clearing the field puts it back
where PLAN wrote it. Switchable off under settings → apps → cal, and CAL owns
all the arithmetic — LOG only says what the time was.

**Colourful events, as two switches.** Every row already carried its colour on
its rail; these lift it into the row as a 12% wash. Two dials rather than one
because the two kinds of row are two different claims — the blocks you filed
into slots, and the template hours around them — and washing both at once is a
rainbow. A wash and not a fill, so the *name* stays the highest-contrast thing
in the row. An unclaimed slot is never lit: there is nothing in it to have a
colour.

**The day's head no longer breaks its own words.** It was one run of text with
`·` typed into it, so a line could break at any space — and did, in the worst
place: "5 tasks" and "3 done" came apart, a number stranded above its noun.
Each fact is its own inline element now with the separator drawn by CSS, so a
break can only fall *between* facts. The head also stacks — meta on one row,
actions on the next — because on a phone the facts wanted the full width and
`schedule from do`, the longest label on the screen for a panel used a few times
a month, was taking it. That button is `+ do` now: same accent, quarter of the
length.

**Nothing on the day answers a finger that is scrolling.** 2.22.3 took the press
*wash* off anything scrolled under a finger and 2.23 swallowed the click that
ends a drag; both are about the tap that follows. The day is the one screen
where that was not enough, because its rows are as tall as the hours they stand
for — a scroll down a full day is a finger crossing five or six live controls.
For the length of the gesture the day is a picture: `pointer-events:none` on
`.cal-day` and `.cal-head` under `[data-scrolling]`. The scroller is the
ancestor and keeps its own, so the scroll itself is untouched.

**The top of the title band was soft, and it was arithmetic.** Four of the five
title sizes multiply out to a fraction (54 × .86 = 46.44), and the band is
`justify-content:flex-end`, so that fraction became the offset every row inside
it was pushed down by. Text that lands on a half pixel is resampled rather than
drawn — and it showed first on the *smallest* text in the band, the date line at
the top, which is why the bug read as "the top of the title is blurred" rather
than "the title is blurred". `--title-px` is the wordmark's size snapped with
`round()`, and the band is measured in it; the unrounded value stays as the
fallback for a browser without `round()`. The other half was `.morph`, added on
every tab change and never taken off, which left the title's `both`-filled
animation applied for the life of the session — holding the wordmark on a
compositing layer, where text is drawn with grayscale antialiasing instead of
subpixel. It now comes off with `.leaving`, on the same timer.

**DO's date sits opposite the wordmark.** The day of the month at the right end
of the `DO.` row, cut from the same type at the same size (`--title-px`, so it
follows the Title size dial and snaps with it), and muted — the wordmark is what
the row *is*, the number is what it is *about*. When the day changes the old
number leaves upward and the new one arrives from below: a checklist that resets
at midnight has exactly one moment where the number matters, and a digit that
changes without moving is a digit you do not notice has changed. It is
`aria-hidden` — the date line above it already says the date in words.

**Routine cards can be minimal, and can hide once finished.** Minimal is the
name and the ratio on one row, no bar, one column: about a third of the height,
so a tab with six routines is a screen rather than a scroll. What is dropped is
only the *drawing* of the progress — the ratio is the same number the bar was
showing. Hiding a finished routine never touches its state; switching the dial
back off brings the card straight back, ticks and all. A tab with nothing left
says "all done" and where to get the cards back, rather than leaving a hole
where the grid was.

**PLAN: the other projects stay on screen.** Opening a project used to clear the
grid of every other one, so the way to the next project was back out through the
one you were in — close, find, open, and the grid rebuilt twice for what is one
thought. The others are a strip of chips under the open header now, each with
its queued count, and one tap moves between them with the FLIP carrying the
section rows out and the new ones in. They are deliberately `.proj-jump` and not
`.proj-tile`: exactly one full project box is open at a time and the rest of the
file counts on it. The section rows lost their wash — three rows each filled
with the same project colour read as three identical slabs, with the name, the
only thing that differs, competing with all of it — and gained the rail, plus
the count of what is already queued into each. The open header keeps a rule in
the project's colour under its name, so opening a project no longer drains the
colour off the screen.

**A hints switch.** Settings → behaviour → "Explain the controls": the paragraph
over a section and the grey line under a switch, off in one attribute. They are
what makes the app legible on the first pass and what makes it long to scroll on
the hundredth, so they are a dial rather than a decision. Never hidden: a
control's own name, a section heading, and the home menu's sub-labels, which say
what is *inside* a category rather than explaining it — losing those is losing
the map, not the commentary.

**A latent bug found on the way.** The app panels are static markup in
`index.html`, and their `data-pref` switches were written with the shipped
default on them and then never painted again — so CAL's three had been showing
the default rather than the setting since they shipped, and flipping one moved
the value without moving the dot. `syncStatic()` paints a static panel from
Prefs after it renders. It is scoped away from look / layout / behave, which
rebuild their own markup and where two dials (`radius`, `border`) default to
`null` meaning "leave it to the theme" — painting those this way would put NaN
where the readout says `auto`.

**Verified** — `test/harness.mjs`, **632 checks, all green** (572 before), and
the site served over http. New coverage: the media rows, chips, find, sort and
surprise-me; the head's unbreakable facts; deleting a row both ways and
cancelling; the wake shift being idempotent, correctable, clearable and
switchable off; both colour dials; the scroll-inert day; `--title-px` and the
`@supports` fallback; `.morph` coming off; the hints attribute and what it does
*not* hide; a static panel's switch following its pref; minimal cards, hiding a
finished routine and the empty-tab message; the day number and its roll; and
PLAN's jump chips. Two 2.8 checks were rewritten rather than deleted — they
asserted the media *tile* markup that this release replaces, and the behaviour
they were guarding (the second label shown, ticking closing the task in Todoist)
is still checked on the new row.

**Not verified** — the blur itself, which is a rendering artefact and cannot be
seen from jsdom. Both causes are fixed and both are demonstrable in the source;
whether the phone still shows it is a question for the phone.

### 2.23 — 2026-09-05 — every overlay lets go, DAY runs during the day, and a half of the day is written when someone writes it

**Three bugs that read as three bugs and were one rule: an overlay owns the page
until it closes.** The pad's backdrop stopped taking pointer events the instant
its class came off, so the tap that dismissed it also pressed whatever was
underneath — one tap doing two things, and the second never asked for. The pad
was drawn without dismissing the system keyboard, so on a form where a text
field had been answered first it arrived over a keyboard against a visual
viewport iOS had already shrunk, and a fixed element measured against a viewport
that has moved has its keys somewhere other than where they look — which is the
"the calculator makes the whole page bug out and the taps are misaligned"
report. And the platform's own selection callout (paste / select / select all /
autofill) had nothing at all that would dismiss it: it stayed up, anchored where
the field had been rather than where the field now is, over whatever had
scrolled into that space.

One shell section answers all three. The tap that closes the pad is prevented
*and* stopped, and the click it would have synthesised is swallowed on its way
in. `padOpen` blurs whatever is focused before the pad is drawn, so nothing is
moving by the time it is. And a tap outside a focused field blurs it, on every
screen in every app — because blurring is the only thing that closes the
callout, and nothing was blurring. A per-field fix would have been one app
remembering and seven forgetting.

**A gesture that travelled is not a press.** 2.22.3 took the press *wash* off a
row scrolled under a finger; the press itself still fired when the finger
lifted. A pointer that moves more than 12px from where it landed — or a touch
the browser has already claimed for a scroll, which stops sending `pointermove`
and is caught on `touchmove` instead — marks the gesture, and the click at the
end of it never reaches the page.

**The pad says what the number is in.** A pad-owned field is never focused, so
while you answer it the only things on screen are the pad's label and a number —
and the label the pad covers is often the only place the unit was written down.
Cold shower reads `45 s`, weight `64.5 kg`, the walk `4 km`. Declared per field
with `data-unit` and never inferred: a unit guessed from a label is a unit that
is wrong on the one field nobody checked. `duration` and `clock` ignore it —
7h20m and 09:30 are already units.

**LOG's discard now undoes.** The forms do not hold their answers in the DOM:
the scales, the meds, the meals, the counters, the cold-shower toggle and the
blocks all write straight into the live record as they are tapped, and `save()`
only copies the text fields across and flushes the object. So "go back without
saving" left every one of those edits sitting in the record, and the next write
from *anywhere* committed them — an entry, a block ticked on DO, the other half
of the day. The form was discarded and the data was not, which is exactly "I
went back without saving and it saved anyway", just delayed until something else
touched the day. Discard re-reads the day from storage, which also keeps
whatever was legitimately written while the form was open.

**And a half of the day is written when someone wrote it.** `setBlock` files a
block ticked on DO into the real today's record without the evening form ever
being opened, and `blocks` counted as evidence that the evening had been filled
in — so one tick on DO turned the card green, cleared LOG's "!" and extended the
streak. `saveMorning` / `saveEvening` leave a stamp now, which is authoritative;
records written before it fall back to the old field scan with `blocks` taken
out of the evening's. The trade is deliberate and small: an old evening whose
only content was ticked blocks reads as unwritten. Nothing is deleted — the
blocks are still in the record, still in the `.md`, still in the reports.

**DAY during the day.** A line across today at the hour it is, summed from the
same durations the rows are drawn from rather than measured off the DOM, riding
the shell's existing minute tick. And every `task` or `fixed` row can be ticked
off — an `idle` row cannot, because it is the absence of an event. A tick is a
mark on the drawing and nothing else: CAL has no network by contract, and a
stored event carries a resolved name rather than a task id.

**DAY's slots can be filled from DO.** PLAN builds a day and sends it, and that
is still how a day gets here — but the day PLAN sent is the day as it looked
last night, and by morning the blocks on DO are the ones actually happening.
Re-exporting the whole day through PLAN to move two of them is a lot of ceremony
for a small correction. So the slots this day already has, filled from the block
tasks DO is holding now, with PLAN's own slot rules (a slot another task holds
is refused by name; tapping the one it holds gives that hour back). It
overwrites every slot, so it asks first, and it marks the day `localEdit` —
"edited here" in the head, permanently. Everywhere else on this screen what is
drawn is what PLAN resolved and handed over, and a drawing that quietly claims
to be the plan is the one thing DAY must not be. Nothing is sent anywhere.

**A block task is the blocks section's, not also a today row.** The two are
separate questions asked of Todoist, and a task due today carrying `@b1`
answered both — so it was drawn twice, counted twice in the tab badge, and
tickable in one place while the other still showed it open. Dropped at draw
time, not fetch time, so switching the blocks section off hands it straight back
with no refetch.

**How far back "show done" reaches is a setting.** Day (what it always did),
week or month. DO's own cache is one day deep and always was; the earlier days
come from LOG, where the tick already files the name. They are names under a
date rather than tiles — a tile would offer a tick that cannot exist, since
reopening a block finished last Tuesday is Todoist's job.

**LOG's selected day is inverted rather than ringed**, and the day numbers are
bold. A ring was a third border weight in a grid that already has a hairline and
today's accent, and at 5mm across the difference between 1px and 1.5px is not a
difference you can see. Swapping the ground for the ink is unmistakable at any
size and cannot be confused with the written-day tints, because it is not a tint
of anything.

**STORE**: an empty list says "no items yet" and stops; the field says "add
item".

**Verified** — `test/harness.mjs`, 572 checks, all green, 48 new. The unit
appearing per field and only where declared, and a duration left alone. The
three overlay rules present in the shell rather than in one app. Discard leaving
the record untouched and a later write from elsewhere unable to resurrect it,
cancel keeping you on the form. A blocks-only evening reading as unwritten and
saving the form stamping it, with the blocks themselves untouched. The now line
landing inside the hour it names and absent on a day that is not today; a task
row and a template row tickable and an idle row not; the tick persisting. The
schedule panel listing DO's blocks against the day's own slots, refusing a taken
slot by name, giving an hour back, asking before it overwrites, rewriting every
slot, leaving the template's hours alone, marking the day edited — and CAL still
containing no URL, no `fetch(` and no `XMLHttpRequest`. A block-labelled task
kept out of the today list and handed back when the section is switched off. The
done window at day / week / month, reaching into LOG's records, drawn as names
and not as buttons, and persisted.

**Still not verified by me**: how any of it looks or feels under a finger. The
Chrome extension is still not connected, so the touch behaviours in particular —
the swallowed tap, the blur, the 12px slop — are argued from the platform's
semantics and held in place by structural checks, not driven under a thumb.

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
