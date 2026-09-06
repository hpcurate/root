/* A look at a screen, in words. jsdom has no layout, so this cannot say
   whether anything is the right size — what it can say is what is on the
   screen, in what order, and what it reads like, which is the half of "did
   that come out right" that does not need eyes. Run it the way the harness is
   run: `cd test && node peek.mjs`. Not part of the site. */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/',
  resources: undefined, pretendToBeVisual: true });
const w = dom.window, d = w.document;

/* the sheets are not loaded by jsdom, and nothing here needs them */
w.matchMedia = w.matchMedia || (q => ({ matches:false, media:q, addListener(){}, removeListener(){},
  addEventListener(){}, removeEventListener(){} }));
['prefs','config','shell','do','log','plan','store','tend','track','learn','cal','create','settings','search']
  .forEach(m => {
    const src = fs.readFileSync(path.join(ROOT, 'js/' + m + '.js'), 'utf8');
    w.eval(src);
  });

const today = w.Shell.today();
const day = n => { const t = new Date(today + 'T12:00:00'); t.setDate(t.getDate() + n);
  return t.toISOString().slice(0, 10); };

/* a shelf with something on it in both areas, and hours behind them */
w.localStorage.setItem('create_v1', JSON.stringify({
  v: 2,
  works: [
    { id:'w1', area:'production', name:'night bus', stage:'arrange', bpm:'124', key:'8A',
      tags:'', notes:'', added:day(-20), touched:day(-1), done:{ 'production|arrange|intro': day(-1) } },
    { id:'w2', area:'production', name:'slow signal', stage:'mix', bpm:'118', key:'',
      tags:'for the ep', notes:'', added:day(-40), touched:day(-6), done:{} },
    { id:'w3', area:'production', name:'half light', stage:'done', bpm:'', key:'',
      tags:'', notes:'', added:day(-90), touched:day(-30), done:{} },
    { id:'w4', area:'mixing', name:'friday warm-up', stage:'drill', bpm:'122', key:'',
      tags:'house', notes:'', added:day(-9), touched:today, done:{ 'mixing|drill|cue points set': today } },
    { id:'w5', area:'mixing', name:'sunday long one', stage:'crate', bpm:'', key:'',
      tags:'', notes:'', added:day(-3), touched:day(-2), done:{} },
  ],
  sessions: [
    { id:'s1', work:'w4', area:'mixing',     date: today,   hours: 2,   what:'practice · the hard one' },
    { id:'s2', work:'w1', area:'production', date: day(-1), hours: 1.5, what:'arranging' },
    { id:'s3', work:'w4', area:'mixing',     date: day(-2), hours: 0.75,what:'digging' },
    { id:'s4', work:'w2', area:'production', date: day(-6), hours: 3,   what:'mixing' },
  ],
  settings: { sort:null, showDone:true, area:'all' },
}));
w.CREATE.reload();
w.Shell.go('create');
w.CREATE.go('home');

const clean = el => String(el.textContent || '').replace(/[ \t]+/g, ' ').trim();
const line = s => s.replace(/\s*\n\s*/g, ' · ');

function show(title, sel) {
  const el = d.querySelector(sel);
  console.log('\n── ' + title + ' ' + '─'.repeat(Math.max(0, 60 - title.length)));
  if (!el) { console.log('  (nothing)'); return; }
  console.log('  ' + line(clean(el)) || '  (empty)');
}

console.log('════ CREATE · the shelf, combined ' + '═'.repeat(30));
show('hero',        '.ns-create #cr-hero');
show('area filter', '.ns-create #cr-areas');
show('stage strips','.ns-create #cr-stages');
show('heading',     '.ns-create #s-home .cr-sec');
show('sorts',       '.ns-create #cr-sorts');
console.log('\n── rows ' + '─'.repeat(54));
d.querySelectorAll('.ns-create #cr-list .cr-work').forEach(r =>
  console.log('  · ' + line(clean(r))));
show('add',         '.ns-create #cr-add');
show('finished',    '.ns-create #cr-released');
show('the week',    '.ns-create #cr-week');

console.log('\n\n════ narrowed to mixing ' + '═'.repeat(40));
w.CREATE.area('mixing');
show('hero',        '.ns-create #cr-hero');
show('stage strips','.ns-create #cr-stages');
console.log('\n── rows ' + '─'.repeat(54));
d.querySelectorAll('.ns-create #cr-list .cr-work').forEach(r =>
  console.log('  · ' + line(clean(r))));
show('add',         '.ns-create #cr-add');
w.CREATE.area('all');

console.log('\n\n════ one mix ' + '═'.repeat(51));
w.CREATE.open('w4');
show('the screen',  '.ns-create #cr-work');

console.log('\n\n════ the session log ' + '═'.repeat(43));
w.CREATE.go('sessions');
show('log',         '.ns-create #cr-sessions');
console.log('');
console.log("");
process.exit(0);
