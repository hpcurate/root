/* WALK: a loop for the dog, asked for by distance or by time at a pace.

   The route comes from the public OSRM foot router at routing.openstreetmap.de
   — no key, no account. A loop is three points on a circle that passes through
   the start, routed start → three points → start, and the circle is grown or
   shrunk until the walk comes out at the length asked for. A street network is
   not a circle, so that takes a few asks (about three, never more than six),
   and when one bearing keeps missing, the circle is swung round to another.

   Two things make the loops walkable rather than merely the right length.
   `continue_straight` forbids a U-turn at the three points, which is what used
   to send the route up a dead end and back to touch one. And whatever
   out-and-back the router still makes is cut off before the length is
   measured (`unspur`), so the number on screen is the walk you will do.

   Nothing is fetched until a loop is asked for. The map is Leaflet, loaded the
   first time there is a route or a pin to draw — the way LEARN loads its three
   libraries only when a deck comes in — and if it cannot load, the loop is
   still drawn, as its shape. walk_v1 holds the dials, home, the pin and the
   last loop; Config holds the pace, the quick lengths and the dog's name. */
window.WALK = (function () {
'use strict';

const SCOPE = '.ns-walk ';
const $id   = id => document.querySelector(SCOPE + '#' + id);
const view  = document.getElementById('view-walk');
const toast = msg => Shell.toast(msg);
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const KEY     = 'walk_v1';
const ROUTER  = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
/* OpenStreetMap's own tiles: keyless, and the data the router walks on. They
   are only drawn light; a dark theme inverts them in walk.css, because a white
   street map under a dark app is a torch in the face at 7am. (CARTO's dark
   basemap was the first choice and now answers without a key with a
   watermark across every tile.) */
const TILES  = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const LIMITS = {
  km:   { min: 0.5, max: 30,  step: 0.5 },
  min:  { min: 5,   max: 300, step: 5 },
  pace: { min: 5,   max: 40,  step: 0.5 },
};

/* The loop's geometry. VIA points on the circle, so SIDES sides to the
   polygon; PERIM is that polygon's perimeter in radii. DETOUR is how much
   longer a walk along streets is than the straight polygon — only the first
   guess, since every ask after it is corrected by what the last one measured.
   TOL is "close enough": within 7% of what was asked. */
const VIA = 3, SIDES = VIA + 1;
const PERIM  = SIDES * 2 * Math.sin(Math.PI / SIDES);
const DETOUR = 1.3;
const TOL    = 0.07;

const ICONS = {
  minus: 'M5 12h14',
  plus:  'M12 5v14M5 12h14',
  again: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  out:   'M7 17 17 7M9 7h8v8',
  save:  'M12 4v11M7 10l5 5 5-5M5 20h14',
};
const ico = k => `<svg class="wk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[k]}"/></svg>`;

/* Store */
function blank() {
  return { v: 1, mode: 'min', km: 3, min: 45, from: 'here', home: null, pin: null, route: null };
}
let DB = blank();

const isPt = p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && isFinite(n)) &&
                  Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
/* five decimals is a metre, which is as well as a phone knows where it is */
const pt = p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  DB = Object.assign(blank(), s && typeof s === 'object' ? s : {});
  if (!['km', 'min'].includes(DB.mode)) DB.mode = 'min';
  if (!['here', 'home', 'pin'].includes(DB.from)) DB.from = 'here';
  DB.km  = snap(DB.km, LIMITS.km, 3);
  DB.min = snap(DB.min, LIMITS.min, 45);
  if (!isPt(DB.home)) DB.home = null;
  if (!isPt(DB.pin))  DB.pin  = null;
  const r = DB.route;
  if (!r || !Array.isArray(r.coords) || r.coords.length < 2 || !r.coords.every(isPt)) DB.route = null;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch { toast('could not save — storage is full'); }
}

function snap(v, lim, dflt) {
  const n = parseFloat(v);
  if (!isFinite(n)) return dflt;
  const s = Math.round(n / lim.step) * lim.step;
  return Math.min(lim.max, Math.max(lim.min, Math.round(s * 100) / 100));
}

/* Config */
let CFG = { dog: 'kamo', pace: 15, km: [], min: [] };
function chipList(v, lim) {
  const seen = new Set();
  return (Array.isArray(v) ? v : []).map(Number)
    .filter(n => isFinite(n) && n >= lim.min && n <= lim.max && !seen.has(n) && seen.add(n))
    .sort((a, b) => a - b).slice(0, 6);
}
function readConfig() {
  const pace = parseFloat(Config.get('walk.pace'));
  CFG = {
    dog:  String(Config.get('walk.dog') || '').trim() || 'the dog',
    /* bounded, not snapped: 12.25 typed in settings is a pace somebody measured */
    pace: isFinite(pace) ? Math.min(LIMITS.pace.max, Math.max(LIMITS.pace.min, pace)) : 15,
    km:   chipList(Config.get('walk.km'),  LIMITS.km),
    min:  chipList(Config.get('walk.min'), LIMITS.min),
  };
}

/* What is being asked for, in metres, whichever way it was asked */
const targetM = () => Math.round((DB.mode === 'km' ? DB.km : DB.min / CFG.pace) * 1000);

/* Formatting */
const kmTxt   = m => (m / 1000).toFixed(m < 10000 ? 2 : 1);
const minsOf  = m => Math.round(m / 1000 * CFG.pace);
const durTxt  = n => n < 60 ? n + ' min' : Math.floor(n / 60) + ' h ' + String(n % 60).padStart(2, '0');
function paceTxt(p) {
  let m = Math.floor(p), s = Math.round((p - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return m + '′' + String(s).padStart(2, '0') + '″';
}
const numTxt = n => String(Math.round(n * 100) / 100);

/* Geometry — [lat, lon] pairs throughout, which is also Leaflet's order */
const RE  = 6371008.8;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function dest(p, bearing, dist) {
  const d = dist / RE, t = rad(bearing), f1 = rad(p[0]), l1 = rad(p[1]);
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [deg(f2), ((deg(l2) + 540) % 360) - 180];
}
function hav(a, b) {
  const df = rad(b[0] - a[0]), dl = rad(b[1] - a[1]);
  const h = Math.sin(df / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dl / 2) ** 2;
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(h)));
}
const pathLen = cs => cs.reduce((s, p, i) => i ? s + hav(cs[i - 1], p) : 0, 0);

/* Cut every out-and-back: a point the path returns to straight after leaving
   it. The router comes back down a dead end over exactly the nodes it went up,
   so equality is enough. Only an *immediate* return is cut — the street you
   leave home by and come back along is not one, and stays. */
function unspur(cs) {
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const out = [];
  for (const p of cs) {
    if (out.length && same(out[out.length - 1], p)) continue;
    if (out.length >= 2 && same(out[out.length - 2], p)) { out.pop(); continue; }
    out.push(p);
  }
  return out;
}

/* The same dead end where the way out and the way back are not the same nodes
   — the two pavements of a quay. A stretch that leaves a point and comes back
   to within 15 m of it, never further than 25 m from its own way out, goes
   too. Up to 600 m round, and the 25 m is what keeps a block: walking round
   one comes back to the corner, but along the far side of it. */
const NEAR = { back: 15, wide: 25, run: 600 };
function unspurNear(cs) {
  if (cs.length < 4) return cs;
  const kx = Math.cos(rad(cs[0][0])) * RE * Math.PI / 180, ky = RE * Math.PI / 180;
  const P = cs.map(p => [p[1] * kx, p[0] * ky]);
  const dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const off = (k, a, b) => {           // P[k] from the polyline P[a..b]
    let m = Infinity;
    for (let x = a; x < b; x++) m = Math.min(m, segDist(P[k], P[x], P[x + 1]));
    return m;
  };
  const thin = (i, j) => {
    let far = i;
    for (let k = i; k <= j; k++) if (dd(P[i], P[k]) > dd(P[i], P[far])) far = k;
    for (let k = far + 1; k <= j; k++) if (off(k, i, far) > NEAR.wide) return false;
    for (let k = i; k < far; k++) if (off(k, far, j) > NEAR.wide) return false;
    return true;
  };
  const keep = [0];
  let i = 0;
  while (i < P.length - 1) {
    let cut = -1, run = 0;
    for (let j = i + 1; j < P.length && run <= NEAR.run; j++) {
      run += dd(P[j - 1], P[j]);
      if (j > i + 1 && run > 2 * NEAR.back && dd(P[i], P[j]) < NEAR.back && thin(i, j)) cut = j;
    }
    i = cut > 0 ? cut : i + 1;
    keep.push(i);
  }
  return keep.map(k => cs[k]);
}

/* Douglas–Peucker in local metres. A full-detail loop is several hundred
   points; walk_v1 travels with sync and a record too big for one Todoist task
   is left behind, so the stored loop keeps only what moves the line by more
   than `tol` metres. */
function simplify(cs, tol) {
  if (cs.length < 3) return cs.slice();
  const kx = Math.cos(rad(cs[0][0])) * RE * Math.PI / 180, ky = RE * Math.PI / 180;
  const P = cs.map(p => [p[1] * kx, p[0] * ky]);
  const keep = new Uint8Array(cs.length);
  keep[0] = keep[cs.length - 1] = 1;
  const stack = [[0, cs.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(P[i], P[a], P[b]);
      if (d > dmax) { dmax = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return cs.filter((_, i) => keep[i]);
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function pointAt(cs, d) {
  for (let i = 1; i < cs.length; i++) {
    const seg = hav(cs[i - 1], cs[i]);
    if (d <= seg && seg > 0) {
      const t = d / seg;
      return [cs[i - 1][0] + (cs[i][0] - cs[i - 1][0]) * t, cs[i - 1][1] + (cs[i][1] - cs[i - 1][1]) * t];
    }
    d -= seg;
  }
  return cs[cs.length - 1];
}

/* The router */
function fail(msg, fatal) { const e = new Error(msg); e.fatal = !!fatal; return e; }

async function through(start, bearing, dir, r) {
  const c = dest(start, bearing, r), back = (bearing + 180) % 360;
  const via = [];
  for (let i = 1; i <= VIA; i++) via.push(dest(c, back + dir * i * 360 / SIDES, r));
  const url = ROUTER + [start, ...via, start].map(p => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(';') +
              '?overview=full&geometries=geojson&continue_straight=true';
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), 15000);
  let res, j;
  try { res = await fetch(url, ctl ? { signal: ctl.signal } : undefined); }
  catch { throw fail('could not reach the route finder', true); }
  finally { clearTimeout(timer); }
  if (!res || !res.ok) {
    const st = res ? res.status : 0;
    throw fail(st === 429 ? 'the route finder is busy — try again in a minute'
                          : 'the route finder said no (' + st + ')', true);
  }
  try { j = await res.json(); } catch { throw fail('the route finder answered nonsense', true); }
  const g = j && j.code === 'Ok' && j.routes && j.routes[0] && j.routes[0].geometry;
  if (!g || !Array.isArray(g.coordinates)) throw fail('no path from here that way');
  const coords = unspurNear(unspur(g.coordinates.filter(c2 => Array.isArray(c2) && c2.length >= 2).map(([lo, la]) => [la, lo])));
  return { coords, dist: pathLen(coords) };
}

/* Up to three asks on one bearing, each one's radius corrected by how far the
   last came out; then the circle swung 120° round for three more. A bearing
   that leads nowhere — the sea, a motorway, a fenced estate — just moves on.
   The best of everything asked is kept, so a sparse village still gets the
   nearest loop there is rather than nothing. */
async function findLoop(start, target, bearing, dir) {
  let best = null, lastErr = null;
  for (let turn = 0; turn < 2; turn++) {
    const b = (bearing + turn * 120) % 360;
    let r = target / (PERIM * DETOUR);
    for (let i = 0; i < 3; i++) {
      let got;
      try { got = await through(start, b, dir, r); }
      catch (e) { if (e.fatal) throw e; lastErr = e; break; }
      const err = Math.abs(got.dist / target - 1);
      if (got.coords.length > 2 && (!best || err < best.err)) best = Object.assign(got, { err });
      if (best && best.err <= TOL) return best;
      r *= Math.min(2, Math.max(0.5, target / Math.max(got.dist, 1)));
    }
  }
  if (!best) throw lastErr || fail('no loop from here');
  return best;
}

/* Where it starts */
function here() {
  return new Promise((res, rej) => {
    const g = navigator.geolocation;
    if (!g) { rej(fail('this device cannot say where it is')); return; }
    g.getCurrentPosition(
      p => res(pt([p.coords.latitude, p.coords.longitude])),
      e => rej(fail(e && e.code === 1 ? 'location is blocked for this page' : 'could not find where you are')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}
async function startPoint() {
  if (DB.from === 'home') {
    if (!DB.home) throw fail('no home saved yet');
    return DB.home;
  }
  if (DB.from === 'pin') {
    if (!DB.pin) throw fail('hold the map where you want to start');
    return DB.pin;
  }
  return here();
}

/* Asking for a loop */
let busy = false;
async function generate() {
  if (busy) return;
  busy = true; render();
  try {
    const start  = await startPoint();
    const target = targetM();
    const got = await findLoop(start, target, Math.random() * 360, Math.random() < 0.5 ? 1 : -1);
    DB.route = { at: Date.now(), from: DB.from, start, target, dist: Math.round(got.dist),
                 coords: simplify(got.coords, 3).map(pt) };
    save();
    if (got.err > 0.15) toast(`closest loop from here is ${kmTxt(got.dist)} km`);
  } catch (e) {
    toast(e && e.message ? e.message : 'no loop this time');
  } finally {
    busy = false;
    render(); renderSettings(); drawMap();
  }
}

async function saveHome() {
  try {
    const p = DB.from === 'pin' && DB.pin ? DB.pin : await here();
    DB.home = p; DB.from = 'home';
    save(); render(); renderSettings(); drawMap();
    toast('home saved');
  } catch (e) { toast(e.message); }
}
function forgetHome() {
  if (!DB.home) return;
  Shell.confirm('Forget home?\nWALK will start from where you are until you save one again.', () => {
    DB.home = null;
    if (DB.from === 'home') DB.from = 'here';
    save(); render(); renderSettings(); drawMap();
    toast('home forgotten');
  });
}
function setPin(p) {
  DB.pin = pt(p); DB.from = 'pin';
  save(); render(); drawMap();
  toast('the loop starts here now');
}

/* Leaving the app with it */
/* Google's walking directions through three points of the loop. Three because
   that is what a phone browser honours; the app takes more, but a link that
   works in one and not the other is a link that breaks on the day it matters.
   The GPX is the exact line, for anything that follows a track. */
function mapsURL(r) {
  const cs = r.coords, L = pathLen(cs);
  const ll = p => p[0].toFixed(5) + ',' + p[1].toFixed(5);
  return 'https://www.google.com/maps/dir/?api=1&travelmode=walking' +
         '&origin=' + ll(cs[0]) + '&destination=' + ll(cs[0]) +
         '&waypoints=' + [0.25, 0.5, 0.75].map(f => ll(pointAt(cs, L * f))).join('%7C');
}
function gpxText(r) {
  const x = s => String(s).replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[c]));
  const name = `${CFG.dog} · ${kmTxt(r.dist)} km`;
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="ROOT WALK" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `  <metadata><name>${x(name)}</name><time>${new Date(r.at).toISOString()}</time></metadata>\n` +
    `  <trk><name>${x(name)}</name><trkseg>\n` +
    r.coords.map(p => `    <trkpt lat="${p[0]}" lon="${p[1]}"/>`).join('\n') +
    '\n  </trkseg></trk>\n</gpx>\n';
}
function saveGPX() {
  if (!DB.route) return;
  const blob = new Blob([gpxText(DB.route)], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `walk-${String(CFG.dog).replace(/[^\w-]+/g, '-')}-${Shell.today()}-${kmTxt(DB.route.dist)}km.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* The map */
let leafletP = null;
function ensureLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    if (!document.querySelector('link[data-walk-leaflet]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = LEAFLET + 'leaflet.min.css'; l.dataset.walkLeaflet = '1';
      document.head.appendChild(l);
    }
    const s = document.createElement('script');
    s.src = LEAFLET + 'leaflet.min.js';
    s.onload  = () => (window.L && window.L.map) ? res(window.L) : rej(fail('the map did not load'));
    s.onerror = () => rej(fail('the map did not load'));
    document.head.appendChild(s);
  }).catch(e => { leafletP = null; throw e; });
  return leafletP;
}

let map = null, line = null, dot = null, pinDot = null;
const cssVar = n => (getComputedStyle(view).getPropertyValue(n) || '').trim();
const accent = () => cssVar('--y')  || '#A78BFA';
const ground = () => cssVar('--bg') || '#0e0e0e';
const wantsMap = () => !!DB.route || DB.from === 'pin';

async function drawMap() {
  const box = $id('wk-map-box'), el = $id('wk-map');
  if (!box || !el) return;
  box.classList.toggle('has-map', wantsMap());
  box.classList.toggle('busy', busy);
  if (!wantsMap()) return;
  let L;
  try { L = await ensureLeaflet(); }
  catch { box.classList.add('flat'); el.innerHTML = shapeSVG(); return; }
  box.classList.remove('flat');
  if (!map) {
    el.innerHTML = '';
    map = L.map(el, { zoomControl: false, attributionControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIB }).addTo(map);
    /* a long press on a phone, a right click on a desk — never a tap, which is
       how you pan, and moving the start by accident is a walk somewhere else */
    map.on('contextmenu', e => setPin([e.latlng.lat, e.latlng.lng]));
  }
  [line, dot, pinDot].forEach(x => x && x.remove());
  line = dot = pinDot = null;
  if (DB.route) {
    line = L.polyline(DB.route.coords, { weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(map);
    dot  = L.circleMarker(DB.route.coords[0], { radius: 7, weight: 3, fillOpacity: 1 }).addTo(map);
  }
  if (DB.from === 'pin' && DB.pin) {
    pinDot = L.circleMarker(DB.pin, { radius: 6, weight: 2, fillOpacity: 0.35, dashArray: '3 3' }).addTo(map);
  }
  restyle();
  map.invalidateSize();
  if (line) map.fitBounds(line.getBounds(), { padding: [22, 22] });
  else map.setView(DB.pin || DB.home || [30, 0], DB.pin || DB.home ? 15 : 2);
}

/* Colours are read off the page, not kept: the accent is whichever tab you
   are on. */
function restyle() {
  if (!map) return;
  const c = accent(), g = ground();
  if (line)   line.setStyle({ color: c });
  if (dot)    dot.setStyle({ color: g, fillColor: c });
  if (pinDot) pinDot.setStyle({ color: c, fillColor: c });
}

/* No map library: the loop as a shape, which is still enough to know which
   way you are going and roughly how far. */
function shapeSVG() {
  const cs = DB.route ? DB.route.coords : null;
  if (!cs) return `<div class="wk-flat-note">the map could not load</div>`;
  const k = Math.cos(rad(cs[0][0]));
  const xs = cs.map(p => p[1] * k), ys = cs.map(p => -p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const X = x => (8 + ((x - x0) + (span - (x1 - x0)) / 2) / span * 84).toFixed(2);
  const Y = y => (8 + ((y - y0) + (span - (y1 - y0)) / 2) / span * 84).toFixed(2);
  return `<svg class="wk-shape" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-label="the loop's shape">
    <polyline points="${xs.map((x, i) => X(x) + ',' + Y(ys[i])).join(' ')}"/>
    <circle cx="${X(xs[0])}" cy="${Y(ys[0])}" r="3"/></svg>
    <div class="wk-flat-note">the map could not load — this is the loop's shape</div>`;
}

/* Drawing the screen */
function paintBand() {
  const lab = $id('wk-label');
  if (lab) lab.textContent = `a loop for ${CFG.dog}`;
}

function routeHTML() {
  const r = DB.route;
  if (!r) return '';
  return `
    <div class="wk-route-row">
      <div class="wk-stats">
        <div class="wk-stat"><b>${kmTxt(r.dist)}</b><em>km</em></div>
        <div class="wk-stat"><b>${minsOf(r.dist)}</b><em>min</em></div>
        <div class="wk-stat"><b>${esc(r.from)}</b><em>start</em></div>
      </div>
      <button class="wk-again" data-act="go" aria-label="another loop"${busy ? ' disabled' : ''}>${ico('again')}</button>
    </div>
    <div class="wk-acts">
      <a class="wk-act" href="${esc(mapsURL(r))}" target="_blank" rel="noopener">${ico('out')}open in maps</a>
      <button class="wk-act" data-act="gpx">${ico('save')}gpx</button>
    </div>`;
}

function formHTML() {
  const mode = DB.mode, val = DB[mode];
  const chips = CFG[mode];
  const equiv = mode === 'min' ? `≈ ${kmTxt(targetM())} km` : `≈ ${durTxt(minsOf(targetM()))}`;
  const fromNote = DB.from === 'home'
      ? (DB.home ? `<span>starts at home</span><button class="wk-link" data-act="home-forget">forget</button>`
                 : `<span>no home saved yet</span><button class="wk-link" data-act="home-save">save here as home</button>`)
    : DB.from === 'pin'
      ? (DB.pin ? `<span>hold the map to move the pin</span><button class="wk-link" data-act="home-save">make it home</button>`
                : `<span>hold the map where the loop should start</span>`)
      : `<span>starts wherever the phone says you are</span>` +
        (DB.home ? '' : `<button class="wk-link" data-act="home-save">save as home</button>`);
  return `
    <div class="wk-sec"><span>how long</span><em>${esc(equiv)}</em></div>
    <div class="wk-seg" role="tablist">
      <button class="${mode === 'min' ? 'on' : ''}" data-act="mode" data-v="min" role="tab" aria-selected="${mode === 'min'}">time</button>
      <button class="${mode === 'km' ? 'on' : ''}" data-act="mode" data-v="km" role="tab" aria-selected="${mode === 'km'}">distance</button>
    </div>
    <div class="wk-len">
      <button class="wk-step" data-act="len" data-d="-1" aria-label="shorter">${ico('minus')}</button>
      <div class="wk-len-v"><b>${numTxt(val)}</b><em>${mode === 'km' ? 'km' : 'min'}</em></div>
      <button class="wk-step" data-act="len" data-d="1" aria-label="longer">${ico('plus')}</button>
    </div>
    ${chips.length ? `<div class="wk-chips">${chips.map(n =>
      `<button class="wk-chip${n === val ? ' on' : ''}" data-act="set" data-v="${n}">${numTxt(n)}</button>`).join('')}</div>` : ''}
    <div class="wk-pace">
      <span class="wk-pace-l">pace<em>${esc(CFG.dog)}'s, per km</em></span>
      <button class="wk-step sm" data-act="pace" data-d="-1" aria-label="faster">${ico('minus')}</button>
      <b class="wk-pace-v">${paceTxt(CFG.pace)}</b>
      <button class="wk-step sm" data-act="pace" data-d="1" aria-label="slower">${ico('plus')}</button>
    </div>
    <div class="wk-sec"><span>from</span></div>
    <div class="wk-seg" role="tablist">
      ${['here', 'home', 'pin'].map(f =>
        `<button class="${DB.from === f ? 'on' : ''}" data-act="from" data-v="${f}" role="tab" aria-selected="${DB.from === f}">${f}</button>`).join('')}
    </div>
    <div class="wk-note">${fromNote}</div>
    <button class="wk-go" data-act="go"${busy ? ' disabled' : ''}>${busy ? 'finding a loop…' : DB.route ? 'another loop' : 'find a loop'}</button>`;
}

function render() {
  paintBand();
  const route = $id('wk-route'), form = $id('wk-form'), box = $id('wk-map-box');
  if (box) { box.classList.toggle('has-map', wantsMap()); box.classList.toggle('busy', busy); }
  if (route) {
    route.innerHTML = routeHTML();
    route.hidden = !DB.route;
  }
  if (form) form.innerHTML = formHTML();
}

function fill(id, v) {
  const el = document.querySelector('.ns-walk #' + id);
  if (el && el !== document.activeElement) el.value = v;
}
function renderSettings() {
  const st = document.querySelector('.ns-walk #wk-status');
  if (st) {
    const r = DB.route;
    st.className = 'settings-status ' + (r ? 'ok' : 'idle');
    st.textContent = r ? `last loop ${kmTxt(r.dist)} km from ${r.from} · ${new Date(r.at).toLocaleDateString()}`
                       : 'no loop yet';
  }
  fill('wk-set-dog',  Config.get('walk.dog') || '');
  fill('wk-set-pace', CFG.pace);
  fill('wk-set-km',   CFG.km.join(', '));
  fill('wk-set-min',  CFG.min.join(', '));
  const hn = document.querySelector('.ns-walk #wk-home-note');
  if (hn) hn.textContent = DB.home ? `saved at ${DB.home[0].toFixed(4)}, ${DB.home[1].toFixed(4)}`
                                   : 'not saved — set it from WALK’s own screen';
  const hb = document.querySelector('.ns-walk #wk-home-forget');
  if (hb) hb.disabled = !DB.home;
}

function resetAll() {
  Shell.confirm('Reset WALK?\nThe last loop, home and the pin go. The pace, the quick lengths and the name are settings and stay.', () => {
    DB = blank();
    save(); render(); renderSettings(); drawMap();
    toast('walk reset');
  });
}

/* The delegated listener — the slide and the settings panel both */
document.addEventListener('click', ev => {
  if (!ev.target.closest || !ev.target.closest('.ns-walk')) return;
  const t = ev.target.closest('[data-act]');
  const act = t && t.dataset.act;
  if (!act || t.disabled) return;

  if (act === 'go')    { generate(); return; }
  if (act === 'mode')  { DB.mode = t.dataset.v === 'km' ? 'km' : 'min'; save(); render(); return; }
  if (act === 'len')   {
    const lim = LIMITS[DB.mode];
    DB[DB.mode] = snap(DB[DB.mode] + (+t.dataset.d || 0) * lim.step, lim, DB[DB.mode]);
    save(); render(); return;
  }
  if (act === 'set')   { DB[DB.mode] = snap(t.dataset.v, LIMITS[DB.mode], DB[DB.mode]); save(); render(); return; }
  if (act === 'pace')  {
    Config.set('walk.pace', snap(CFG.pace + (+t.dataset.d || 0) * LIMITS.pace.step, LIMITS.pace, CFG.pace));
    return;
  }
  if (act === 'from')  { DB.from = t.dataset.v; save(); render(); drawMap(); return; }
  if (act === 'home-save')   { saveHome(); return; }
  if (act === 'home-forget') { forgetHome(); return; }
  if (act === 'gpx')   { saveGPX(); return; }
  if (act === 'reset') { resetAll(); return; }
});

load();
readConfig();

Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('walk')) return;
  readConfig(); render(); renderSettings();
});
Prefs.subscribe(() => restyle());

Shell.register('walk', {
  onShow: () => { render(); drawMap(); },
});

render();

return { render, renderSettings, resetAll, generate,
         /* re-read what is stored — only the harness has a reason to ask */
         reload: () => { load(); readConfig(); render(); renderSettings(); },
         state: () => JSON.parse(JSON.stringify(DB)),
         target: targetM,
         gpx: () => DB.route ? gpxText(DB.route) : '',
         mapsURL: () => DB.route ? mapsURL(DB.route) : '',
         geo: { dest, hav, pathLen, unspur, unspurNear, simplify, pointAt } };
})();
