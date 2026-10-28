/* qurOS — what the records mean.
   Entry  { id, kind:'dump'|'evening', day, at, end, edited, secs, src:'voice'|'typed'|'mixed',
            lang, topic, text, sent }
          topic: null | { sec, item?, label } (a map section or item) | { label } (free tag)
   Day    { date, bad, wake, bed, goals[], chain{}, hyg{}, focus{}, prep{}, scales{}, meals[],
            gym, touched, sent }
          goals[i] { id, text, state:'open'|'done'|'carried'|'dropped', from? }
          chain{stepId: 'full'|'min'}  — a minimum is done, the same as full
   kv     map, mapState{itemKey: 'partial'|'done'}, week:YYYY-Www → goals[], sends[]
   "Unsent" is anything changed since it last went out: an entry with no
   `sent` or edited after it, a day touched after its `sent`. */
(() => {
const Q = window.Q, { uid, slug, norm, dayOf, words } = Q.u;
const db = () => Q.db;

/* ── entries ── */
const entries = () => db().all('entries').sort((a, b) => b.at - a.at);
function saveEntry(o) {
  const have = db().get('entries', o.id);
  const now = Date.now();
  const e = Object.assign({}, have || {}, o, {
    day: (have && have.day) || dayOf(o.at || now),
    at: o.at || now,
    end: (have && have.end) || now,
    sent: have ? have.sent || null : null,
  });
  if (have) e.edited = now;
  e.words = words(e.text);
  const out = db().put('entries', e);
  if (Q.brain) Q.brain.queue(e.id);   // 5.1: inside ROOT, it goes to BRAIN on the PC (js/brain.js)
  return out;
}
function editEntry(id, patch) {
  const e = db().get('entries', id);
  if (!e) return null;
  Object.assign(e, patch, { edited: Date.now() });
  if ('text' in patch) e.words = words(e.text);
  return db().put('entries', e);
}
const delEntry = id => { const e = db().get('entries', id); if (e) db().del('entries', id); return e; };
const unsentEntry = e => !e.sent || (e.edited || 0) > e.sent;

/* ── days ── */
const blankDay = date => ({ date, bad: false, wake: '', bed: '', goals: [], chain: {}, hyg: {}, focus: {}, prep: {},
  scales: {}, meals: [], gym: null, touched: 0, sent: 0 });
/* never stored until something is written to it */
function day(date) {
  const d = db().get('days', date);
  return d ? Object.assign(blankDay(date), d) : blankDay(date);
}
function saveDay(d) { d.touched = Date.now(); return db().put('days', d); }
function hasData(d) {
  if (!d) return false;
  const any = o => o && Object.values(o).some(Boolean);
  return !!(d.bad || d.wake || d.bed || (d.goals && d.goals.length) || any(d.chain) || any(d.hyg) || any(d.focus) ||
    any(d.prep) || any(d.scales) || (d.meals && d.meals.length) || gymLogged(d.gym));
}
const unsentDay = d => hasData(d) && (d.touched || 0) > (d.sent || 0);
function gymLogged(g) {
  if (!g) return false;
  return !!(g.warm || g.minDone || (g.ex || []).some(x => (x.sets || []).some(s => s.done)));
}

/* ── weekly goals ── */
const weekGoals = wk => db().kv('week:' + wk, []);
const setWeekGoals = (wk, list) => db().setKv('week:' + wk, list);

/* ── the map ───────────────────────────────────────────────────────────────
   A markdown file read as data: headings are sections, list items are the
   things to talk through, a heading that says "Tier N" sets the tier for it
   and what follows. States are filed under the item's key — section and item
   text, slugged — so re-importing an edited map keeps every state whose item
   was not reworded. `[x]` in the file marks done, `[~]` or `[/]` partial. */
function parseMap(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let title = '', tier = 99, cur = null;
  const sections = [], seed = {}, seen = new Set();
  const tierOf = s => { const m = /\btier\s*(\d{1,2})\b/i.exec(s); return m ? +m[1] : null; };
  // a map that ticks its items ("- [ ] **Sleep** — …") keeps notes in bold bullets with no box ("- **Order:** …", his
  // life-dump map's "How to use this map"): notes, not things to talk through — as BRAIN reads it (5.1.1)
  const boxed = lines.some(l => /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX~/-]\]/.test(l));
  lines.forEach(raw => {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) {
      const t = h[2].trim(), tn = tierOf(t);
      if (h[1].length === 1 && !title && tn == null) { title = t; return; }
      if (tn != null) tier = tn;
      const name = t.replace(/[-–—:·|(]*\s*\btier\s*\d{1,2}\b\s*\)?\s*[-–—:·|]*/i, ' ').replace(/\s+/g, ' ').trim() || t;
      let key = slug(name);
      while (seen.has(key)) key += '-2';
      seen.add(key);
      cur = { key, title: name, tier: tn != null ? tn : tier, items: [] };
      sections.push(cur);
      return;
    }
    const li = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX~/-])\]\s*)?(.+)$/.exec(raw);
    if (li && li[2].trim() && !(boxed && li[1] == null && /^\*\*/.test(li[2]))) {
      if (!cur) { cur = { key: 'general', title: title || 'general', tier, items: [] }; sections.push(cur); seen.add('general'); }
      const itext = li[2].trim();
      const key = itemKey(cur.title, itext);
      if (cur.items.some(x => x.key === key)) return;
      cur.items.push({ key, text: itext });
      if (/[xX]/.test(li[1] || '')) seed[key] = 'done';
      else if (/[~/-]/.test(li[1] || '')) seed[key] = 'partial';
    }
  });
  const list = sections.filter(s => s.items.length);
  return list.length ? { map: { title: title || 'life dump map', sections: list, loaded: Date.now() }, seed } : null;
}
const itemKey = (secTitle, text) => slug(secTitle) + '/' + slug(text);
const map = () => db().kv('map', null);
const setMap = m => { const r = db().setKv('map', m); if (Q.brain) Q.brain.mapChanged(); return r; };
const states = () => db().kv('mapState', {});
const itemState = k => states()[k] || 'empty';
function setItemState(k, s) {
  const st = Object.assign({}, states());
  if (s === 'empty') delete st[k]; else st[k] = s;
  db().setKv('mapState', st);
  if (Q.brain) Q.brain.mapChanged();
}
function loadMapText(text, o = {}) {
  const r = parseMap(text);
  if (!r) return null;
  const old = map();
  /* 5.2.0: BRAIN's map (js/brain.js pulls it from Todoist): its marks are the answer — BRAIN took this phone's before it wrote
     them — and it is not sent back (no mapChanged) */
  if (o.from === 'pc') {
    db().setKv('map', Object.assign({}, r.map, { from: 'pc', at: o.at || Date.now() }));
    const st = Object.assign({}, states());
    r.map.sections.forEach(s => s.items.forEach(x => { if (r.seed[x.key]) st[x.key] = r.seed[x.key]; else delete st[x.key]; }));
    db().setKv('mapState', st);
    return { map: r.map, replaced: !!old };
  }
  setMap(r.map);
  /* the app's answer is newer than the file's: [x] only fills an item with no state yet */
  const st = Object.assign({}, states());
  Object.keys(r.seed).forEach(k => { if (!st[k]) st[k] = r.seed[k]; });
  db().setKv('mapState', st);
  return { map: r.map, replaced: !!old };
}
const sections = () => (map() ? map().sections.slice().sort((a, b) => a.tier - b.tier) : []);
function mapNext(skip = []) {
  for (const s of sections()) {
    const it = s.items.find(x => itemState(x.key) === 'empty' && !skip.includes(x.key));
    if (it) return { section: s, item: it };
  }
  return null;
}
function mapStats() {
  const all = sections().flatMap(s => s.items);
  const st = states();
  return { items: all.length, done: all.filter(x => st[x.key] === 'done').length,
    partial: all.filter(x => st[x.key] === 'partial').length };
}
function mapToMd() {
  const m = map();
  if (!m) return '';
  const st = states();
  const out = ['# ' + m.title, ''];
  sections().forEach(s => {
    out.push(`## ${s.title}${s.tier < 99 ? ` — Tier ${s.tier}` : ''}`);
    s.items.forEach(x => out.push(`- [${st[x.key] === 'done' ? 'x' : st[x.key] === 'partial' ? '~' : ' '}] ${x.text}`));
    out.push('');
  });
  return out.join('\n');
}
/* editing keeps states and dump topics pointing at the right item */
function mapEdit(fn) {
  const m = JSON.parse(JSON.stringify(map() || { title: 'life dump map', sections: [], loaded: Date.now() }));
  fn(m);
  setMap(m);
  return m;
}
function rekey(oldKey, newKey) {
  if (oldKey === newKey) return;
  const st = Object.assign({}, states());
  if (st[oldKey]) { st[newKey] = st[oldKey]; delete st[oldKey]; db().setKv('mapState', st); }
  db().all('entries').forEach(e => {
    if (e.topic && e.topic.item === oldKey) { e.topic = Object.assign({}, e.topic, { item: newKey }); db().put('entries', e); }
  });
}
/* 5.2.0 (r261027-f9vm "brain desktop and the brain module in root have the new map as default"): BRAIN 0.2.0's questions
   (its core/life.js, Life.mapMd with { generic: true }) — 14 areas, 73 sections, no name of anyone: ROOT is public. His own map,
   with the people, places and things of his life in it, comes from BRAIN through Todoist (js/brain.js, pullMap). */
const STARTER = `# Life map

## Me › Identity — Tier 1
- **Who you are in one breath** — how you'd describe yourself to a stranger, and honestly
- **Your names** — given names, nicknames, DJ names, handles
- **Birth** — date, place, what you were told about it
- **Languages** — which, how well, where you use them
- **Where you're from** — the countries and cities that made you

## Me › Personality — Tier 1
- **Your known patterns** — freezing, withdrawing, all-or-nothing, what triggers them, what breaks them
- **Strengths** — what you're genuinely good at
- **Weak spots** — what keeps tripping you up
- **How you make decisions** — gut vs. analysis, where you get stuck

## Me › Values and beliefs — Tier 1
- **What matters** — the few things you'd never trade
- **Mottos** — the lines you live by
- **Politics and beliefs** — only if you want them on file
- **What you're proud of** — and what you regret

## Me › What works on you — Tier 1
- **What works on you** — when you've been at your best, what was different
- **How you want me to talk to you** — when to push, when to back off, what makes you shut down
- **Comfort** — what helps on a bad day

## Me › Goals — Tier 1
- **Right now** — what this chapter is, what's good, what's bad, what you want out of
- **The next 12 months** — what has to happen, what you want to happen
- **The 5–10 year picture** — where you'd live, what you'd do, with whom
- **What a good life looks like** — concretely, a normal Tuesday in it
- **What scares you** — outcomes you're trying to avoid

## Me › Mood and inner world — Tier 1
- **Mood** — how the last months have felt, whether it's new or a pattern
- **Nostalgia** — the times you miss
- **Social energy** — when you want people, when you need solitude

## People › Partner — Tier 1
- **The relationship as a whole** — history, what works, what doesn't
- **How you met** — when, where, through whom
- **Living together** — space, chores, money, schedules
- **What you need to decide** — and by when

## People › Family — Tier 1
- **Mum** — the relationship, what she knows, what you'd want it to be
- **Dad** — same
- **Brothers** — one at a time, who's closest
- **Extended family** — uncles, cousins, grandparents
- **Family patterns** — roles, old fights, what's unsaid

## People › Friends — Tier 1
- **Close friends** — the inner circle
- **Friends from before** — the wider group, who you miss, who you've drifted from
- **Friends you've lost** — and why

## People › Partner's circle — Tier 1
- **Your partner's people** — who's yours vs. theirs
- **Their family** — the ones you see

## People › Music people — Tier 1
- **DJs, producers, promoters, crews** — who you know
- **Online contacts** — the ones who answer

## People › School people — Tier 1
- **School friends** — every school, university
- **Teachers or classmates who still matter**

## People › Work people — Tier 1
- **Colleagues and bosses** — past and present

## People › Practical people — Tier 1
- **Therapists, psychiatrists, doctors**
- **School contacts, coaches**
- **Landlord, agency, admin contacts**

## People › Neighbours and local — Tier 1
- **Local people** — anyone where you live, even loose ties
- **Neighbours** — the good ones, the difficult ones

## People › Past people — Tier 1
- **Exes, lost friends, anyone who still takes up space in your head**

## People › Key dates — Tier 1
- **Birthdays and anniversaries for everyone above**

## Pets › Pets — Tier 1
- **Your animal** — age, routine, health, needs, who looks after them when you can't
- **Training** — what they know, what you're teaching
- **Vet and food** — who, what, how much

## Home and daily life › Homes — Tier 1
- **The apartment** — layout, what's where, what's broken, what bugs you
- **Every place you've lived** — and what each was like
- **The move** — the plan, criteria (garden, space, price), timeline, blockers

## Home and daily life › Neighbourhood — Tier 1
- **Shops, gym, walks, transport**
- **Feeling safe** — day and night

## Home and daily life › A real day — Tier 1
- **A real day** — walk through yesterday honestly, hour by hour
- **A good day** — the last one you remember and why it worked
- **A bad day** — what it looks like and what tips you into it

## Home and daily life › Routines — Tier 1
- **Routines** — which ones stick, which ones you've abandoned
- **Chores** — what gets done, what doesn't
- **Mornings and evenings** — the anchors

## Home and daily life › Screens — Tier 1
- **Phone, YouTube, games, scrolling** — how much and when
- **What you've blocked** — and whether it worked

## Body and mind › Health overview — Tier 1
- **Health overview** — conditions, diagnoses, anything ongoing
- **Doctors** — who, for what, when last
- **Checks to do** — what's overdue

## Body and mind › Mental health — Tier 1
- **ADHD** — the diagnosis, how it shows up for you specifically
- **Anxiety and depression** — what it's like, what helps
- **Therapy** — who, how often, what you work on

## Body and mind › Medication — Tier 1
- **What you take** — name, dose, when
- **What it does for you** — and the side effects
- **Getting it** — prescriptions, pharmacy, reimbursements

## Body and mind › Sleep — Tier 1
- **Sleep** — when you actually sleep and wake, what wrecks it
- **What helps** — mask, earplugs, rules

## Body and mind › Food — Tier 1
- **Food** — what you eat on a normal day, cooking skill, likes, dislikes, intolerances
- **What you'd want to change**

## Body and mind › Fitness — Tier 1
- **Fitness** — gym routine, what you train, goals, injuries
- **Walking and breathing** — the km walked, breathing practice

## Body and mind › Body and weight — Tier 1
- **Weight** — where it is, where you want it
- **Look and style** — hair, piercings, clothes

## Body and mind › Substances — Tier 1
- **Weed** — how much, when, why, what you want, what's happened when you stopped before
- **Other substances** — alcohol, caffeine, nicotine, anything else
- **Your rules** — what you allow yourself, and when

## History › The arc — Tier 2
- **The arc** — the main chapters of your life so far, one sentence each
- **Turning points** — the 5–10 moments that changed your direction

## History › Childhood — Tier 2
- **Childhood by city** — every city: years, school, what each gave you
- **Your family then** — what home was like

## History › Places lived — Tier 2
- **Every city and country** — when, why, what you kept

## History › Year by year — Tier 2
- **Each year in a few lines** — what happened, how it felt

## Education › Schools — Tier 2
- **Every school** — what it was like, what it left
- **High school** — where, with whom, what that period was
- **University** — every one, what you studied, why each ended

## Education › CAP Électricien — Tier 2
- **Why this path** — why electrician, what you want it to lead to
- **The program** — school, platform, structure, exam format, the deadline
- **Progress** — what's done, what you remember, where you stalled and why
- **The school contact** — who calls, how often, what they expect
- **Practical side** — internship / alternance, tools, workspace

## Education › Skills and learning — Tier 2
- **Skills** — what you're genuinely good at, including the unofficial stuff
- **Learning** — how you learn best, courses you've done

## Work and income › Jobs — Tier 2
- **Work history** — every job and gig, what you liked, why it ended

## Work and income › Job search — Tier 2
- **The alternance** — where you've applied, what's next
- **What work you'd take** — and what you won't

## Work and income › Ideas and side projects — Tier 2
- **Ideas** — channels, businesses, things you've wanted to start

## Money › Monthly picture — Tier 2
- **Monthly picture** — income in, fixed costs out (rent, subscriptions, phone, insurance), what's left
- **Who pays what** — between you, your partner, your parents

## Money › Savings and debts — Tier 2
- **Savings and debts** — roughly where you stand, what you owe and to whom

## Money › Money habits — Tier 2
- **Money habits** — where it leaks, what stresses you
- **Money goals** — the move, gear, trips, a buffer

## Admin › Paperwork map — Tier 2
- **CAF, CPAM, CFE, mutuelle, taxes, France Travail, bank** — what you have, what's pending
- **Where documents live** — physical and digital

## Admin › Driving licence — Tier 2
- **Licence follow-up** — the prefecture requirements and dates

## Admin › Ongoing disputes — Tier 2
- **Ongoing disputes** — the agency, anything else open

## Admin › Recurring deadlines — Tier 2
- **Renewals, declarations, bills** — what comes back every year

## Music › The story — Tier 2
- **The story** — how you got into the music, key moments, why the project
- **Names** — every artist name you've used, and what each one was

## Music › The project — Tier 2
- **What the project is** — the identity, the sound, the vibe, what you want people to feel
- **Visual identity** — artwork, colours, fonts

## Music › Taste — Tier 2
- **Taste map** — subgenres you love and hate, top artists, labels, the tracks that define you
- **References** — the artists you learn from: what exactly you want to take from each

## Music › Mixing — Tier 2
- **DJ skills** — what you're solid on, what's weak, how you prep a mix
- **Blocks** — how you record and sort them
- **Promo mixes** — every one, where it lives

## Music › Production — Tier 2
- **Production skills** — DAW, what you can do now, the gap to where you want to be
- **Courses** — what you've followed
- **Your sounds** — patches, sketches, templates

## Music › Gear and library — Tier 2
- **Gear** — controllers, decks, headphones, monitors, interface, plugins, sample packs
- **Library** — Rekordbox setup, where files live, how you tag, where you buy

## Music › Works — Tier 2
- **Unfinished work** — every mix, track, idea in progress and where it's stuck

## Music › Events and raves — Tier 2
- **Festivals and raves** — favourites, ones you want to hit, budget for them
- **Scene** — the cities around you: events, crews, promoters

## Music › Gigs and competitions — Tier 2
- **Gigs** — every one, how it went
- **Competitions** — entries, results, upcoming ones

## Music › Online presence — Tier 2
- **Online presence** — SoundCloud, Instagram, Mixcloud, Twitch, and the content plan

## Music › Music goals — Tier 2
- **Goals** — 6 months, 2 years, dream outcome; hobby vs. career, honestly

## Systems and tech › Your apps — Tier 2
- **The apps you built** — what each does, what you use daily
- **Where this memory fits** — what you want it to replace, connect to, or stay out of

## Systems and tech › Tools — Tier 2
- **Todoist** — projects, labels, how you capture tasks
- **Obsidian** — vault structure, what you log, morning and evening flow
- **Google Calendar** — calendars and colour logic
- **Other apps** — habits, money, notes, music, AI

## Systems and tech › Devices — Tier 2
- **Devices** — phone, computers, specs, builds, peripherals, what needs fixing

## Systems and tech › Accounts and storage — Tier 2
- **Which email for what, cloud drives, backups, GitHub**

## Systems and tech › What's failed before — Tier 2
- **Systems you built and dropped, and the reason each one broke**

## Systems and tech › Look and feel — Tier 2
- **Fonts, themes, how you want screens to look**

## Taste › Food — Tier 3
- **Favourite dishes, restaurants, cuisines, what you cook well**

## Taste › Films, series, books — Tier 3
- **Films, series, YouTube channels, books, podcasts**

## Taste › Games — Tier 3
- **Games** — what you play, with whom, what hooks you

## Taste › Style — Tier 3
- **Style** — clothes, brands, sizes, perfume

## Taste › Places and travel — Tier 3
- **Favourite cities, trips taken, travel wishlist**

## Possessions › Big items — Tier 3
- **Furniture, car, bike, anything you'd move or sell**

## Possessions › Tools and kit — Tier 3
- **Electrical and DIY tools** — what you own, what the CAP needs you to buy
- **Kitchen** — equipment that limits or enables cooking
- **Clothing and sports kit** — what you have, what's worn out

## Possessions › Wishlist — Tier 3
- **What you want to buy, rough price, priority**`;

/* ── topics ── */
function findItem(key) {
  for (const s of sections()) { const it = s.items.find(x => x.key === key); if (it) return { section: s, item: it }; }
  return null;
}
const findSection = key => sections().find(s => s.key === key) || null;
function topicFor(sec, item) {
  if (item) return { sec: sec.key, item: item.key, label: `${sec.title} › ${item.text}` };
  return { sec: sec.key, label: sec.title };
}
/* an item as said: "**Sleep** — when you sleep" is a name in bold and a note (his life-dump map); the key stays the line */
function itemParts(text) {
  const t = String(text || '').trim(), m = /^\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?(.*)$/.exec(t);
  return m ? { name: m[1].trim(), note: m[2].trim() } : { name: t.replace(/\*\*/g, '').trim(), note: '' };
}
const itemName = text => itemParts(text).name;
function topicLabel(t, kind) {
  if (kind === 'evening' && !t) return 'evening dump';
  if (!t) return 'free dump';
  if (t.item) { const f = findItem(t.item); if (f) return `${f.section.title} › ${itemName(f.item.text)}`; }
  if (t.sec && !t.item) { const s = findSection(t.sec); if (s) return s.title; }
  return t.label || 'free dump';
}
/* what to talk through, shown under the topic while recording */
function topicPrompt(t, kind) {
  if (kind === 'evening') return ['how did today go?', 'what is still on your mind?', 'what is tomorrow\'s first step?'];
  if (!t || !t.sec || t.item) return [];
  const s = findSection(t.sec);
  return s ? s.items.filter(x => itemState(x.key) !== 'done').slice(0, 6).map(x => x.text + (itemState(x.key) === 'partial' ? ' (started)' : '')) : [];
}
const dumpsFor = key => db().all('entries').filter(e => e.topic && (e.topic.item === key || (e.topic.sec === key && !e.topic.item)));

Q.m = { entries, saveEntry, editEntry, delEntry, unsentEntry, blankDay, day, saveDay, hasData, unsentDay, gymLogged,
  weekGoals, setWeekGoals, parseMap, itemKey, map, setMap, states, itemState, setItemState, loadMapText, sections,
  mapNext, mapStats, mapToMd, mapEdit, rekey, STARTER, findItem, findSection, topicFor, topicLabel, topicPrompt, dumpsFor, norm, itemParts, itemName };
})();
