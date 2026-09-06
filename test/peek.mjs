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

/* ── 4.1 ─────────────────────────────────────────────────────────────────── */
console.log('\n\n════ CREATE · the curate tab ' + '═'.repeat(35));
w.Creds.save('a-token-for-peek');
w.fetch = async (url) => {
  const u = String(url);
  const body = /\/tasks\?/.test(u) ? [
    { id:'t3', content:'watch tutorial',    project_id:'p1', section_id:'s2', labels:['curate'], order:2 },
    { id:'t1', content:'IMANU patreon',     project_id:'p1', section_id:'s1', labels:['curate','purchase'], order:1 },
    { id:'t4', content:'plugins',           project_id:'p2', section_id:null, labels:['curate','quick'], order:1 },
    { id:'t2', content:'buunshin patreon',  project_id:'p1', section_id:'s1', labels:['curate','purchase'], order:2 },
    { id:'t5', content:'library full organization', project_id:'p1', section_id:'s3', labels:['curate','milestone'], order:1 },
  ] : /\/projects/.test(u) ? [
    { id:'p2', name:'inbox',  color:'grey',  order:2 },
    { id:'p1', name:'curate', color:'grape', order:1 },
  ] : /\/sections/.test(u) ? [
    { id:'s3', project_id:'p1', name:'library',  section_order:3 },
    { id:'s2', project_id:'p1', name:'watch',    section_order:2 },
    { id:'s1', project_id:'p1', name:'purchase', section_order:1 },
  ] : [];
  return { ok:true, status:200, text: async () => JSON.stringify(body) };
};
w.CREATE.area('curate');
w.CREATE.go('home');
await w.CREATE.refreshCurate();
show('hero',   '.ns-create #cr-hero');
show('strip',  '.ns-create #cr-areas');
d.querySelectorAll('.ns-create #cr-curate .cr-cgroup').forEach(g => {
  console.log('  ' + line(clean(g.querySelector('.cr-chead'))));
  g.querySelectorAll('.cr-ctask').forEach(t => console.log('      · ' + line(clean(t))));
});
w.CREATE.area('all');

console.log('\n\n════ CREATE · a mix has no key chip ' + '═'.repeat(28));
w.CREATE.open('w4');
console.log('  mix  : ' + [...d.querySelectorAll('.ns-create #cr-work .cr-mchip')]
  .map(b => clean(b)).join(' | '));
w.CREATE.open('w1');
console.log('  song : ' + [...d.querySelectorAll('.ns-create #cr-work .cr-mchip')]
  .map(b => clean(b)).join(' | '));

console.log('\n\n════ LOG · the evening blocks ' + '═'.repeat(34));
w.Shell.go('log');
w.LOG.go('evening');
const blkF = d.querySelector('.ns-log [data-field="blocks"]');
[...blkF.children].forEach(c => console.log(
  '  ' + (c.classList.contains('hidden') ? '[hidden] ' : '') + (c.id || '') +
  ' — ' + line(clean(c)).slice(0, 90)));

console.log('\n\n════ LOG · the fortnight, cycled ' + '═'.repeat(31));
/* A fortnight with something in every field the charts read, so the cycle can
   be looked at rather than guessed. Every value here is one the evening or the
   morning form actually writes. */
for (let i = 0; i < 14; i++) {
  const iso = day(-i);
  const r = 1 + ((i * 3) % 5);
  w.localStorage.setItem('log_' + iso, JSON.stringify({
    date: iso, scale: 5,
    m: { wt:'07:' + String(10 + (i % 5) * 6).padStart(2, '0'), sl: (6 + (i % 4) * 0.5).toFixed(1),
         nrg: r, mood: 1 + ((i * 2) % 5), cs_on: i % 3 === 0, cs:'2',
         wkg: (74 + (i % 3) * 0.4).toFixed(1), km: (i % 5).toFixed(1), wo: '', tkg:'', tmin:'' },
    e: { kme: ((i % 3) * 1.5).toFixed(1), nrg: 1 + ((i + 1) % 5), mood: 1 + ((i + 2) % 5),
         stress: 1 + ((i * 4) % 5), meals: ['1','2','3'].slice(0, 1 + (i % 3)),
         caf_c: i % 4, caf_ed: i % 2, cur_mix: i % 3, cur_prod: (i + 1) % 3, cur_cont: i % 2,
         blocks: ['mixing', 'admin'].slice(0, 1 + (i % 2)), blocksPlan: [], media: [] },
    entries: [],
  }));
}
w.Shell.go('log');
w.LOG.go('home');
w.LOG.renderMonth();
const seen = new Set();
for (let i = 0; i < 10; i++) {
  const t = d.querySelector('.ns-log .lc-trend');
  const k = t && t.querySelector('.lc-key');
  if (!k) { console.log('  (nothing to draw)'); break; }
  const name = String(t.dataset.chart || '—');
  if (seen.has(name)) break;
  seen.add(name);
  console.log('  ' + name.padEnd(8) + ' ' + line(clean(k)));
  w.LOG.cycleTrend();
}
console.log('\n  opened up (axis labels, top to bottom):');
w.LOG.toggleTrend();
console.log('    ' + [...d.querySelectorAll('.ns-log .lc-yax span')].map(x => x.textContent).join(' · ') +
  '   |  ' + (d.querySelector('.ns-log .lc-shut')?.textContent || '(no close)'));

console.log('');
process.exit(0);
