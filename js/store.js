/* ── STORE ────────────────────────────────────────────────────────────────────
   Grocery list with auto-categorisation, in-store € counter with numpad and
   entry log, premade meals, trip history, and add-only Todoist union sync.
   Logic is unchanged from eat/index.html. Merge-only changes: one IIFE published
   as window.STORE, DOM lookups scoped to .ns-store, the slide scrolls instead of
   the window, toast() goes to the shell.
   Storage keys are untouched: store_state_v1, with the one-time read of the
   pre-rename eat_state_v1 still in place. */
window.STORE = (function () {
'use strict';

const SCOPE = '.ns-store ';
const view  = document.querySelector('#view-store .view-body');   // the scroll container (Shell wraps it)
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);

/* ─── Content ─────────────────────────────────────────────────────────────────
   The aisles and the premade meals used to be two literals here. They live in
   js/config.js now and are edited from Settings → content. Read once into
   module bindings — every render touches them repeatedly — and refreshed
   whenever an edit lands.

   `manual` is load-bearing: anything the categoriser cannot place goes there,
   so the editor pins it and this module falls back to it defensively. */
let CATEGORIES = Config.get('store.categories');
let MEALS      = Config.get('store.meals');

/* The currency mark is a preference, not a constant — STORE was hardcoded to €
   in nine places. */
const CUR = () => Prefs.get('currency') || '€';

// ─── Categorisation ──────────────────────────────────────────────────────────
/* Extra vocabulary on top of the CATEGORIES item lists: synonyms, plurals the
   stemmer won't reach, brands, and French names (the item lists already mix in
   "porc", "origan", "creme fraiche"). Multi-word terms win over single words,
   so "orange juice" lands in drinks rather than fruits. */
const CAT_WORDS = {
  vegetables: ['cherry tomato','sweet potato','spring onion','green onion','green bean','bell pepper',
    'courgette','aubergine','eggplant','capsicum','poivron','courge','lettuce','salad','salade','laitue',
    'cucumber','concombre','mushroom','champignon','leek','poireau','celery','celeri','cabbage','chou',
    'cauliflower','ginger','gingembre','radish','radis','beetroot','betterave','pumpkin','potiron',
    'asparagus','asperge','artichoke','artichaut','kale','arugula','rocket','roquette','turnip','navet',
    'endive','fennel','fenouil','squash','carotte','oignon','ail','echalote','epinard','pomme de terre',
    'haricot vert','brocoli','broccoli','zucchini','tomatoes','patate'],
  fruits: ['orange','lemon','citron','lime','grape','raisin','strawberry','fraise','raspberry','framboise',
    'blueberry','myrtille','blackberry','mure','cherry','cerise','pear','poire','pineapple','ananas',
    'mango','mangue','melon','watermelon','pasteque','apricot','abricot','plum','prune','fig','figue',
    'grapefruit','pamplemousse','clementine','mandarin','nectarine','papaya','passion fruit',
    'pomegranate','grenade','coconut','date','berry','berries','pomme','banane','peche','fruit'],
  meats: ['pork','boeuf','poulet','canard','poisson','oeuf','oeufs','turkey','dinde','lamb','agneau',
    'veal','veau','bacon','lardons','sausage','saucisse','merguez','ham','jambon','mince','ground beef',
    'hache','steak','salami','chorizo','prosciutto','pancetta','shrimp','crevette','prawn','scampi',
    'mussels','moules','scallop','coquille','liver','foie','meatball','boulette','nugget','schnitzel',
    'escalope','filet','breast','thigh','cuisse','ribs','brisket','tuna','thon','trout','truite',
    'seabass','bar','dorade','crab','crabe','lobster','homard','chicken breast'],
  snacks: ['crisps','biscuit','cookie','candy','bonbon','sweets','popcorn','pretzel','cracker','tuc',
    'granola bar','protein bar','gummy','haribo','oreo','pringles','doritos','lays','kinder',
    'chocolate bar','chocolat','snack','speculoos','madeleine','gaufre','waffle','donut','beignet',
    'cake','gateau','tarte','pie','muffin','crepe','biscotte','nachos','tortilla chips','peanuts',
    'cashew','almond','amande','pistachio','pistache','noisette','hazelnut','trail mix','dried fruit'],
  carbs: ['spaghetti','penne','fusilli','tagliatelle','linguine','farfalle','lasagna','lasagne','macaroni',
    'pate','pates','noodle','nouille','riz','pain','wrap','couscous','quinoa','bulgur','polenta','gnocchi',
    'flour','farine','pita','naan','bun','roll','toast','semolina','semoule','vermicelli','udon','soba',
    'orzo','risotto','sandwich bread','pain de mie','ciabatta','focaccia','crouton','breadcrumb',
    'chapelure','pizza dough','pate a pizza','puff pastry','pate feuilletee'],
  cans: ['canned','tinned','conserve','passata','coulis','concentre','puree','tomato paste','petit pois',
    'pois chiche','chickpea','haricot rouge','kidney bean','white bean','haricot blanc','butter bean',
    'baked beans','lentille','mais','sweetcorn','coconut milk','lait de coco','olive','pickle',
    'cornichon','caper','capre','soup','soupe','broth','bouillon','stock','tomato sauce','sauce tomate',
    'sardine','anchovy','anchois','jackfruit','beans','bean'],
  dairy: ['milk','lait','cream','creme','parmesan','feta','brie','camembert','comte','emmental','chevre',
    'goat cheese','ricotta','mascarpone','cottage cheese','cheese','fromage','skyr','kefir','sour cream',
    'chantilly','whipped cream','raclette','halloumi','babybel','philadelphia','laughing cow',
    'vache qui rit','petit suisse','fromage blanc','mozzarella','yaourt','beurre','margarine','ghee',
    'oat milk','almond milk','soy milk','lait vegetal'],
  frozen: ['ice cream','glace','sorbet','sorbet','surgele','congele','gyoza','potsticker','spring roll',
    'nem','frozen','frites','fish stick','baton de poisson','frozen peas','frozen veg','crevettes surgelees'],
  breakfast: ['cereal','cereales','honey','miel','granola','croissant','pain au chocolat','pancake',
    'syrup','sirop','maple','erable','peanut butter','beurre de cacahuete','marmalade','marmelade',
    'confiture','nutella','cafe','espresso','instant coffee','coffee beans','capsule','dosette',
    'flocons','avoine','porridge','weetabix','corn flakes','chocapic','miel'],
  condiments: ['huile','oil','mayo','mayonnaise','vinegar','vinaigre','balsamic','balsamique','bbq sauce',
    'hot sauce','sriracha','tabasco','harissa','pesto','hummus','houmous','tahini','sauce','dressing',
    'vinaigrette','wasabi','salsa','guacamole','aioli','curry paste','fish sauce','nuoc mam',
    'oyster sauce','worcestershire','teriyaki','tzatziki','moutarde','sauce soja','soja','sweet and sour',
    'peanut sauce','tapenade','relish','horseradish','raifort',
    'huile olive','huile tournesol','huile sesame','huile coco','huile colza'],
  spices: ['oregano','cinnamon','cannelle','nutmeg','muscade','turmeric','curcuma','chili powder',
    'cayenne','thyme','thym','rosemary','romarin','basil','basilic','bay leaf','laurier','coriander',
    'coriandre','parsley','persil','dill','aneth','mint','menthe','sesame seed','graines de sesame',
    'vanilla','vanille','saffron','safran','herbes de provence','ras el hanout','zaatar','sumac',
    'five spice','garam masala','spice','epice','seasoning','assaisonnement','stock cube','cube bouillon',
    'sel','poivre','black pepper','peppercorn','baking powder','levure','sugar','sucre','cardamom',
    'clove','girofle','fenugreek','anise','anis'],
  drinks: ['water','eau','sparkling','petillante','cola','coke','pepsi','sprite','fanta','soda','lemonade',
    'limonade','tonic','juice','jus','beer','biere','wine','vin','rose','champagne','prosecco','cider',
    'cidre','whisky','whiskey','vodka','rum','rhum','gin','tequila','aperol','spritz','martini','porto',
    'energy drink','smoothie','milkshake','tea','the','kombucha','iced tea','perrier','san pellegrino',
    'evian','badoit','orangina','schweppes','oasis','tropicana','coconut water',
    'jus orange','jus pomme','jus raisin','jus fruit','jus ananas'],
};

/* Plural stripping, deliberately shallow — it runs on both the query and the
   vocabulary, so it only has to be self-consistent, not linguistically right. */
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
/* Single letters are dropped so French elisions collapse: "huile d'olive"
   and "jus d'orange" tokenise the same as the phrases stored below. */
function stemTokens(s) {
  return tdKey(s).split(' ').filter(w => w.length > 1).map(stem);
}

/* Vocabulary is built once: every known item plus every keyword above, each
   pre-stemmed into tokens. Items get a small edge over keywords on a tie. */
let VOCAB = null;
function vocab() {
  if (VOCAB) return VOCAB;
  VOCAB = [];
  const add = (list, cat, bonus) => list.forEach(i => {
    const t = stemTokens(i);
    if (t.length) VOCAB.push({ t, cat, bonus });
  });
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    if (cat !== 'manual') add(def.items, cat, 3);
  }
  for (const [cat, words] of Object.entries(CAT_WORDS)) add(words, cat, 0);
  return VOCAB;
}

function lev(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
function fuzzyCap(w) { return w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0; }

/* Is `t` a run of consecutive tokens inside `n`? Returns the match position. */
function phraseAt(n, t) {
  outer:
  for (let i = 0; i + t.length <= n.length; i++) {
    for (let j = 0; j < t.length; j++) if (n[i + j] !== t[j]) continue outer;
    return i;
  }
  return -1;
}

/* Scores every vocabulary entry against the name and returns the best category.
   Later tokens score slightly higher, so "cherry tomatoes" reads as a tomato
   and "tomato soup" reads as a soup — English puts the head noun last. */
function classify(raw) {
  const learned = (state.learned || {})[tdKey(raw)];
  if (learned && CATEGORIES[learned]) return { cat: learned, score: 999, why: 'learned' };
  return classifyBase(raw);
}
function classifyBase(raw) {
  const n = stemTokens(raw);
  if (!n.length) return { cat: 'manual', score: 0 };

  let best = { cat: 'manual', score: 0 };
  for (const v of vocab()) {
    let score = 0;
    const at = phraseAt(n, v.t);
    if (at >= 0) {
      score = 50 + 40 * v.t.length          // longer phrases dominate
            + (at + v.t.length) * 10        // head-noun bias: later tokens win
            + (v.t.length === n.length ? 30 : 0)    // whole-name match
            + v.bonus;
    } else if (v.t.length === 1) {
      // typo tolerance, one token at a time — "chiken", "avacado", "yoghurt"
      for (let i = 0; i < n.length; i++) {
        const cap = fuzzyCap(n[i]);
        if (!cap) continue;
        const d = lev(n[i], v.t[0], cap);
        if (d <= cap) score = Math.max(score, 45 - d * 6 + i * 2 + v.bonus);
      }
    }
    if (score > best.score) best = { cat: v.cat, score };
  }
  return best.score >= 25 ? best : { cat: 'manual', score: best.score };
}

// ─── State ───────────────────────────────────────────────────────────────────
const SK = 'store_state_v1';
const SK_LEGACY = 'eat_state_v1';   // pre-rename key — read once, then migrate
const TD_DEFAULTS = { token:'', project:'04|life', section:'home|groceries',
                      projectId:null, sectionId:null, lastSync:null };
let state = { cart:0, budget:0, cartLog:[], list:[], history:[], currentCat:null,
              cwPin:false, todoist: { ...TD_DEFAULTS }, learned: {} };

function loadState() {
  try {
    let raw = localStorage.getItem(SK);
    if (raw === null) {
      // first run after the EAT → STORE rename: adopt the old data, leave it in place
      const legacy = localStorage.getItem(SK_LEGACY);
      if (legacy !== null) { raw = legacy; localStorage.setItem(SK, legacy); }
    }
    if (raw) {
      const s = JSON.parse(raw);
      state = Object.assign(state, s);
      state.cart = Number(state.cart) || 0;
      state.budget = Number(state.budget) || 0;
      state.list = Array.isArray(state.list) ? state.list : [];
      state.history = Array.isArray(state.history) ? state.history : [];
      state.cartLog = Array.isArray(state.cartLog) ? state.cartLog : [];
    }
  } catch {}
  // nested defaults survive an older save that predates these blocks
  state.todoist = Object.assign({ ...TD_DEFAULTS }, state.todoist || {});
  if (!state.learned || typeof state.learned !== 'object') state.learned = {};
}
/* The Todoist key lives in Creds now; it is mirrored back into this app's own
   record on every write so the standalone eat/ app keeps working off it. */
function saveState() {
  state.todoist.token = Creds.token();
  localStorage.setItem(SK, JSON.stringify(state));
}

// ─── Navigation ──────────────────────────────────────────────────────────────
function go(id) {
  $all('.scr').forEach(s => s.classList.remove('on'));
  $id('s-' + id).classList.add('on');
  if (view) view.scrollTop = 0;
  if (id === 'home')     renderHome();
  if (id === 'items')    renderCategories();
  if (id === 'cat')      renderCategoryItems();
  if (id === 'meals')    renderMeals();
  if (id === 'history')  renderHistory();
}

// ─── Cart counter ────────────────────────────────────────────────────────────
const CART_LOG_MAX = 200;   // plenty for one shop, and keeps the save small

/* Every change to the cart is logged so you can look back at what you punched
   in. `note` carries the numpad's breakdown, e.g. "2.50 ×3". */
function addCart(amt, note) {
  const before = state.cart;
  state.cart = Math.max(0, Math.round((state.cart + amt) * 100) / 100);
  const applied = Math.round((state.cart - before) * 100) / 100;   // honours the clamp at 0
  if (applied !== 0) {
    state.cartLog.push({ a: applied, t: Date.now(), n: note || '' });
    if (state.cartLog.length > CART_LOG_MAX) state.cartLog.shift();
  }
  saveState(); renderCart();
}
function resetCart() {
  if (state.cart === 0 && !state.cartLog.length) { toast('cart already at 0'); return; }
  Shell.confirm(`Reset cart counter to ${CUR()}0.00?`, () => {
    state.cart = 0; state.cartLog = [];
    saveState(); renderCart();
    toast('cart reset');
  });
}
/* ── The counter, pinned ───────────────────────────────────────────────────────
   In a shop the running total is the number you keep glancing at, and the list
   you are ticking is long enough to scroll it off the top. Pinned, the widget
   sticks to the top of the page (position:sticky — sticky, not fixed, because
   fixed inside #track is forbidden, §3) and the list scrolls under it.

   The pin is on the widget itself rather than in settings: it is the kind of
   thing you switch on in the aisle and off at the till. */
function togglePin() {
  state.cwPin = !state.cwPin;
  saveState(); paintPin(); paintBand(); Prefs.tap();
  toast(state.cwPin ? 'counter pinned' : 'counter unpinned');
}
function paintPin() {
  const cw = $id('cw'), btn = $id('cw-pin');
  if (cw) cw.classList.toggle('pinned', !!state.cwPin);
  if (btn) {
    btn.classList.toggle('on', !!state.cwPin);
    btn.setAttribute('aria-pressed', state.cwPin ? 'true' : 'false');
    btn.setAttribute('aria-label', state.cwPin ? 'unpin the counter' : 'pin the counter to the top');
  }
}

/* ── The band's right end ─────────────────────────────────────────────────────
   How much of the list is ticked, always; and what the trip has cost, only
   while the counter is pinned. Pinning is the signal that you are in a shop
   and the total is the number you keep glancing at, so that is exactly when it
   is worth the band's width — and when it is up there, the widget below stops
   drawing it (store.css) rather than showing it twice.

   The count and the cost share one flex end, so mounting the cost is what
   slides the count leftwards. Nothing tells it to move. */
/* What the band was last showing, so a repaint knows which way the number moved.
   Held here rather than read back off the element: the text carries a currency
   symbol and a fixed two decimals, and parsing a number back out of its own
   formatting to find out what it used to be is a way to be wrong later. `null`
   means "nothing has been shown yet", which is not a rise from zero. */
let costWas = null;
let costTimer = null;

function paintBand() {
  const cnt = $id('store-count');
  if (cnt) {
    const total = state.list.length;
    const checked = state.list.filter(i => i.checked).length;
    cnt.textContent = total ? `${checked}/${total} ${total === 1 ? 'item' : 'items'}` : '';
  }
  const cost = $id('store-cost');
  if (!cost) return;
  const on = !!state.cwPin;
  const wasOn = !cost.classList.contains('hidden');
  cost.classList.toggle('hidden', !on);
  if (!on) { costWas = null; return; }        // unpinned: the next mount is a first paint

  const now = +state.cart || 0;
  cost.innerHTML = `${esc(now.toFixed(2))}<span class="cu">${esc(CUR())}</span>`;

  /* Arriving is not a change. Pinning the counter mid-trip would otherwise
     flash green for the whole basket, which says "you just spent forty euros"
     about money that was already spent. */
  if (!wasOn || costWas === null) {
    cost.classList.remove('up', 'down');
    cost.classList.remove('mount'); void cost.offsetWidth; cost.classList.add('mount');
    costWas = now;
    return;
  }
  if (now === costWas) return;

  /* Green as it rises, red as it falls. The class is dropped after the run so
     the colour eases back to white through the transition rather than snapping,
     and it is restarted rather than added to — keying in a price a digit at a
     time fires this several times a second, and each one must replace the last
     rather than queue behind it. */
  const dir = now > costWas ? 'up' : 'down';
  costWas = now;
  cost.classList.remove('up', 'down', 'mount');
  void cost.offsetWidth;
  cost.classList.add(dir);
  clearTimeout(costTimer);
  costTimer = setTimeout(() => cost.classList.remove('up', 'down'), 620);
}

function renderCart() {
  paintPin();
  paintBand();
  $id('cw-cart').textContent = state.cart.toFixed(2);
  $all('.cu').forEach(el => { el.textContent = CUR(); });
  const logBtn = $id('cw-log-btn');
  if (logBtn) logBtn.textContent = state.cartLog.length ? `history ${state.cartLog.length}` : 'history';
  const bud = state.budget;
  const budEl = $id('cw-budget');
  const fill = $id('cw-fill');
  if (bud > 0) {
    const pct = Math.min(100, (state.cart / bud) * 100);
    fill.style.width = pct + '%';
    fill.style.background = colorFromPct(pct);
    const over = state.cart > bud;
    budEl.innerHTML = over
      ? `<span class="b-line over">over by ${CUR()}${(state.cart - bud).toFixed(2)}</span><span class="b-line">/ ${CUR()}${bud.toFixed(2)}</span>`
      : `<span class="b-line"><em>${CUR()}${(bud - state.cart).toFixed(2)}</em> left</span><span class="b-line">/ ${CUR()}${bud.toFixed(2)}</span>`;
  } else {
    fill.style.width = '0%';
    budEl.textContent = 'no budget set';
  }
}

// ─── Cart log ────────────────────────────────────────────────────────────────
function openCartLog() {
  renderCartLog();
  $id('clog-back').classList.add('on');
  $id('clog').classList.add('on');
}
function closeCartLog() {
  $id('clog-back').classList.remove('on');
  $id('clog').classList.remove('on');
}
function fmtClock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function renderCartLog() {
  const log = state.cartLog;
  const n = log.length;
  $id('clog-count').textContent = `${n} entr${n === 1 ? 'y' : 'ies'}`;
  $id('clog-total').textContent = state.cart.toFixed(2) + CUR();
  const box = $id('clog-list');
  if (!n) {
    box.innerHTML = '<div class="clog-empty">nothing added yet — amounts you punch in show up here</div>';
    return;
  }
  // newest first: the entry you just made is the one you're most likely checking
  box.innerHTML = log.map((en, i) => {
    const up = en.a > 0;
    return `<div class="clog-row">
      <span class="clog-i">${i + 1}</span>
      <span class="clog-a ${up ? 'up' : 'dn'}">${up ? '+' : '−'}${CUR()}${Math.abs(en.a).toFixed(2)}</span>
      <span class="clog-n">${en.n ? esc(en.n) : ''}</span>
      <span class="clog-t">${fmtClock(en.t)}</span>
    </div>`;
  }).reverse().join('');
}

// ─── Numpad ──────────────────────────────────────────────────────────────────
let padBuf = '';   // raw typed digits, e.g. "12.5"
let padN   = 1;    // how many of this item

function openPad() {
  padBuf = ''; padN = 1; renderPad();
  $id('pad-back').classList.add('on');
  $id('pad').classList.add('on');
}
function closePad() {
  $id('pad-back').classList.remove('on');
  $id('pad').classList.remove('on');
}
function padIsOpen() { return $id('pad').classList.contains('on'); }

function padKey(k) {
  if (k === '.') {
    if (padBuf.includes('.')) return;
    padBuf = (padBuf || '0') + '.';
  } else {
    const dot = padBuf.indexOf('.');
    if (dot >= 0 && padBuf.length - dot > 2) return;         // max 2 decimals
    if (dot < 0 && padBuf.replace('.','').length >= 6) return; // sane cap
    padBuf = (padBuf === '0' ? '' : padBuf) + k;
  }
  renderPad();
}
function padBack() { padBuf = padBuf.slice(0, -1); renderPad(); }
function padClear() { padBuf = ''; padN = 1; renderPad(); }
function padCount(d) { padN = Math.min(99, Math.max(1, padN + d)); renderPad(); }

function padValue() { return Math.round((parseFloat(padBuf) || 0) * 100) / 100; }
function padTotal() { return Math.round(padValue() * padN * 100) / 100; }

function renderPad() {
  const amt = $id('pad-amt');
  amt.innerHTML = (padBuf === '' ? '0.00' : esc(padBuf)) + `<span class="cu">${esc(CUR())}</span>`;
  amt.classList.toggle('empty', padBuf === '');
  $id('pad-count').textContent = '×' + padN;
  $id('pad-calc').innerHTML =
    padN > 1 ? `${padValue().toFixed(2)} × ${padN} = <em>${CUR()}${padTotal().toFixed(2)}</em>` : '';
}

function padApply(sign) {
  const total = padTotal();
  if (total === 0) { toast('enter an amount first'); return; }
  addCart(sign * total, padN > 1 ? `${padValue().toFixed(2)} × ${padN}` : '');
  toast(`${sign > 0 ? '+' : '−'}${CUR()}${total.toFixed(2)}${padN > 1 ? ` (${padN}×)` : ''}`);
  padBuf = ''; padN = 1; renderPad();
}

// physical keyboard, for when the app is open on a laptop
document.addEventListener('keydown', e => {
  if (!padIsOpen()) return;
  if (/^[0-9]$/.test(e.key)) { padKey(e.key); e.preventDefault(); }
  else if (e.key === '.' || e.key === ',') { padKey('.'); e.preventDefault(); }
  else if (e.key === 'Backspace') { padBack(); e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === '+') { padApply(1); e.preventDefault(); }
  else if (e.key === '-') { padApply(-1); e.preventDefault(); }
  else if (e.key === '*') { padCount(1); e.preventDefault(); }
  else if (e.key === '/') { padCount(-1); e.preventDefault(); }
  else if (e.key === 'Escape') { closePad(); e.preventDefault(); }
});

function colorFromPct(pct) {
  const p = Math.min(100, Math.max(0, pct));
  if (p <= 50) {
    return lerpColor([92,219,125], [224,160,96], p / 50);
  }
  return lerpColor([224,160,96], [224,96,96], (p - 50) / 50);
}
function lerpColor(c1, c2, t) {
  const r = Math.round(c1[0] + (c2[0]-c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1]-c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2]-c1[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// ─── Home ────────────────────────────────────────────────────────────────────
function renderHome() {
  // one date format for the whole app, set under Settings → behaviour
  $id('date-label').textContent = Prefs.formatDate(Shell.today()).toUpperCase();
  renderCart();
  renderList();
  $id('hist-count').textContent = state.history.length;
}

// ─── List ────────────────────────────────────────────────────────────────────
function addItem(name, cat) {
  const existing = state.list.find(i => i.name === name && i.cat === cat);
  if (existing) existing.qty = (existing.qty || 1) + 1;
  else state.list.push({ name, cat, qty: 1, checked: false });
  saveState();
  toast(`+ ${name}`);
}
function addItemSilent(name, cat) {
  const existing = state.list.find(i => i.name === name && i.cat === cat);
  if (existing) existing.qty = (existing.qty || 1) + 1;
  else state.list.push({ name, cat, qty: 1, checked: false });
}
function addManual() {
  const inp = $id('manual-input');
  const name = inp.value.trim();
  if (!name) return;
  const cat = classify(name).cat;
  addItemSilent(name, cat);
  inp.value = '';
  saveState();
  renderList();
  toast(cat === 'manual' ? `+ ${name}` : `+ ${name} → ${CATEGORIES[cat].label}`);
}
function toggleChecked(idx) {
  state.list[idx].checked = !state.list[idx].checked;
  saveState();
  renderList();
}
function setQty(idx, delta) {
  const it = state.list[idx];
  if (!it) return;
  it.qty = Math.min(99, Math.max(1, (it.qty || 1) + delta));
  saveState();
  renderList();
}
function deleteItem(idx) {
  state.list.splice(idx, 1);
  saveState();
  renderList();
}
function confirmClearList() {
  if (!state.list.length) { toast('list is empty'); return; }
  Shell.confirm(`Clear all ${state.list.length} items from list?`, () => {
    state.list = [];
    saveState();
    renderList();
    toast('list cleared');
  });
}
/* Saving and renaming share one sheet: renameIdx === null means "save the
   current list", otherwise it means "rename history[renameIdx]". */
let renameIdx = null;

function saveTrip() {
  if (!state.list.length) { toast('list is empty'); return; }
  openTripName(null);
}

function openTripName(idx) {
  renameIdx = idx;
  const inp = $id('trip-input');
  $id('trip-ttl').textContent = idx === null ? 'name this trip' : 'rename trip';
  $id('trip-ok').textContent = idx === null ? 'save trip' : 'rename';
  inp.value = idx === null ? '' : (state.history[idx]?.name || '');
  $id('trip-back').classList.add('on');
  $id('tripname').classList.add('on');
  inp.focus();   // kept inside the tap gesture so iOS opens the keyboard
}

function closeTripName() {
  renameIdx = null;
  $id('trip-back').classList.remove('on');
  $id('tripname').classList.remove('on');
  $id('trip-input').blur();
}

function confirmTripName() {
  const name = $id('trip-input').value.trim().slice(0, 60);
  if (renameIdx !== null) {
    const t = state.history[renameIdx];
    if (t) t.name = name;          // blank clears it, falling back to the date
    closeTripName();
    saveState();
    renderHistory();
    toast(name ? `renamed to ${name}` : 'name cleared');
    return;
  }
  if (!state.list.length) { closeTripName(); toast('list is empty'); return; }
  state.history.unshift({
    date: Shell.today(),        // local day — toISOString() dated a late shop tomorrow
    name,                                        // '' is fine — the date shows instead
    items: state.list.map(i => ({ ...i })),
    cart: state.cart,
    budget: state.budget,
  });
  state.list = [];
  state.cart = 0;
  state.cartLog = [];                            // fresh calculator for the next shop
  closeTripName();
  saveState();
  renderHome();
  toast(name ? `saved · ${name}` : 'trip saved');
}

function renderList() {
  const ul = $id('grocery-list');
  const countEl = $id('list-count');
  const banner = $id('all-checked-banner');
  const tripBtn = $id('trip-btn');

  paintBand();
  if (!state.list.length) {
    ul.innerHTML = '<div class="li-empty">no items yet</div>';
    countEl.textContent = '0 items';
    banner.classList.remove('show');
    tripBtn.style.display = 'none';
    return;
  }

  const total = state.list.length;
  const checked = state.list.filter(i => i.checked).length;
  countEl.textContent = `${checked}/${total} ${total === 1 ? 'item' : 'items'}`;
  banner.classList.toggle('show', checked === total && total > 0);
  tripBtn.style.display = '';

  // group by category for display order
  const order = Object.keys(CATEGORIES);
  const grouped = {};
  state.list.forEach((it, i) => {
    const c = it.cat in CATEGORIES ? it.cat : 'manual';
    (grouped[c] = grouped[c] || []).push({ ...it, idx: i });
  });

  ul.innerHTML = order
    .filter(c => grouped[c])
    .map(c => {
      const color = CATEGORIES[c].color;
      return grouped[c].map(it => `
        <div class="li-item${it.checked ? ' checked' : ''}" style="--cat-color:${color}" onclick="STORE.toggleChecked(${it.idx})">
          <button class="li-dot" title="change category"
                  onclick="event.stopPropagation();STORE.openCatPick(${it.idx})"></button>
          <span class="li-name">${esc(it.name)}</span>
          <span class="li-qty" onclick="event.stopPropagation()">
            <button class="li-qty-btn${(it.qty || 1) <= 1 ? ' off' : ''}" onclick="STORE.setQty(${it.idx},-1)">−</button>
            <span class="li-qty-n">×${it.qty || 1}</span>
            <button class="li-qty-btn" onclick="STORE.setQty(${it.idx},1)">+</button>
          </span>
          <button class="li-del" onclick="event.stopPropagation();STORE.deleteItem(${it.idx})">✕</button>
        </div>
      `).join('');
    }).join('');
}

// ─── Category picker ─────────────────────────────────────────────────────────
let cpIdx = null;
function openCatPick(idx) {
  const it = state.list[idx];
  if (!it) return;
  cpIdx = idx;
  $id('cp-name').textContent = it.name;
  $id('cp-grid').innerHTML = Object.entries(CATEGORIES).map(([key, cat]) => `
    <button class="cp-opt${it.cat === key ? ' on' : ''}" style="--cat-color:${cat.color}"
            onclick="STORE.setCat('${key}')">
      <svg><use href="#${cat.icon}"/></svg><span>${cat.label}</span>
    </button>`).join('');
  $id('cp-back').classList.add('on');
  $id('catpick').classList.add('on');
}
function closeCatPick() {
  cpIdx = null;
  $id('cp-back').classList.remove('on');
  $id('catpick').classList.remove('on');
}
/* A correction is remembered by name, so the same item files itself correctly
   next time it is typed or pulled in from Todoist. */
function setCat(key) {
  const it = state.list[cpIdx];
  if (!it || !CATEGORIES[key]) return closeCatPick();
  it.cat = key;
  const k = tdKey(it.name);
  if (k) {
    if (classifyBase(it.name).cat === key) delete state.learned[k];  // no override needed
    else state.learned[k] = key;
  }
  saveState();
  renderList();
  closeCatPick();
  toast(`${it.name} → ${CATEGORIES[key].label}`);
}

// ─── Categories ──────────────────────────────────────────────────────────────
function renderCategories() {
  const grid = $id('cat-grid');
  grid.innerHTML = Object.entries(CATEGORIES)
    .filter(([k]) => k !== 'manual')
    .map(([key, cat]) => {
      const inListCount = state.list.filter(i => i.cat === key)
        .reduce((s, i) => s + (i.qty || 1), 0);
      return `
        <div class="cat-card${inListCount > 0 ? ' has' : ''}" style="--cat-color:${cat.color}" onclick="STORE.openCategory('${key}')">
          <svg class="cat-ico"><use href="#${cat.icon}"/></svg>
          <div class="cat-name">${cat.label}</div>
          <div class="cat-meta">${cat.items.length} items${inListCount > 0 ? ` · <em>${inListCount} in list</em>` : ''}</div>
        </div>
      `;
    }).join('');
}

function openCategory(key) {
  state.currentCat = key;
  go('cat');
}

function renderCategoryItems() {
  const cat = CATEGORIES[state.currentCat];
  if (!cat) { go('items'); return; }
  $id('cat-title').textContent = cat.label;
  const grid = $id('cat-items');
  grid.style.setProperty('--cat-color', cat.color);
  grid.innerHTML = cat.items.map(item => {
    const inList = state.list.find(i => i.name === item && i.cat === state.currentCat);
    const qty = inList ? (inList.qty || 1) : 0;
    return `
      <button class="item-add${qty > 0 ? ' active' : ''}" onclick="STORE.addItemAndRefresh('${esc(item).replace(/'/g, "\\'")}','${state.currentCat}')">
        <span>${esc(item)}</span>
        ${qty > 0 ? `<span class="qty-badge">×${qty}</span>` : ''}
      </button>
    `;
  }).join('');
}

function addItemAndRefresh(name, cat) {
  addItem(name, cat);
  renderCategoryItems();
}

// ─── Meals ───────────────────────────────────────────────────────────────────
function renderMeals() {
  const list = $id('meal-list');
  list.innerHTML = Object.entries(MEALS).map(([key, meal]) => {
    const rows = meal.items.map(([n, c]) => `
      <div class="meal-row" style="--cat-color:${CATEGORIES[c]?.color || '#888'}">
        <span class="dot"></span>
        <span>${esc(n)}</span>
        <span class="ml-cat">${c}</span>
      </div>
    `).join('');
    return `
      <div class="meal-card" id="meal-${key}">
        <div class="meal-header" onclick="STORE.toggleMeal('${key}')">
          <div class="meal-name">${meal.label}</div>
          <span class="meal-count">${meal.items.length} items</span>
          <span class="meal-arrow">›</span>
        </div>
        <div class="meal-body">
          ${rows}
          <button class="meal-add" onclick="event.stopPropagation();STORE.addMeal('${key}')">+ add all to list</button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleMeal(key) {
  const card = $id('meal-' + key);
  const wasOpen = card.classList.contains('open');
  $all('.meal-card').forEach(c => c.classList.remove('open'));
  if (!wasOpen) card.classList.add('open');
}

function addMeal(key) {
  MEALS[key].items.forEach(([name, cat]) => addItemSilent(name, cat));
  saveState();
  toast(`+ ${MEALS[key].label}`);
}

// ─── History ─────────────────────────────────────────────────────────────────
function renderHistory() {
  const ul = $id('hist-list');
  if (!state.history.length) {
    ul.innerHTML = '<div class="li-empty" style="margin:8px 0">no trips saved yet — finish your list and tap "save trip" to archive it here</div>';
    return;
  }
  ul.innerHTML = state.history.map((t, i) => {
    const pills = t.items.map(it => {
      const color = CATEGORIES[it.cat]?.color || '#888';
      return `<span class="hist-pill" style="--cat-color:${color}"><span class="dot"></span>${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</span>`;
    }).join('');
    const over = t.budget > 0 && t.cart > t.budget;
    const budTxt = t.budget > 0 ? ` <span class="bud">/ ${CUR()}${t.budget.toFixed(2)}</span>` : '';
    return `
      <div class="hist-card">
        <div class="hist-head">
          <span class="hist-date">${t.name ? esc(t.name) : fmtDate(t.date)}</span>
          <span class="hist-amt${over ? ' over' : ''}">${CUR()}${(t.cart || 0).toFixed(2)}${budTxt}</span>
        </div>
        ${t.name ? `<div class="hist-sub">${fmtDate(t.date)}</div>` : ''}
        <div class="hist-items">${pills}</div>
        <div class="hist-actions">
          <button class="hist-act" onclick="STORE.openTripName(${i})">rename</button>
          <button class="hist-act" onclick="STORE.restoreTrip(${i})">re-add</button>
          <button class="hist-act del" onclick="STORE.deleteTrip(${i})">delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function fmtDate(iso) {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }).toUpperCase();
  } catch { return iso; }
}

function restoreTrip(i) {
  const t = state.history[i];
  if (!t) return;
  t.items.forEach(it => addItemSilent(it.name, it.cat));
  // ensure all re-added items start unchecked
  state.list.forEach(it => { it.checked = false; });
  saveState();
  toast('items re-added to list');
  go('home');
}

function deleteTrip(i) {
  Shell.confirm('Delete this trip from history?', () => {
    state.history.splice(i, 1);
    saveState();
    renderHistory();
  });
}

function clearHistory() {
  if (!state.history.length) { toast('history is empty'); return; }
  Shell.confirm(`Clear all ${state.history.length} past trips?`, () => {
    state.history = [];
    saveState();
    renderHistory();
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────
function renderSettings() {
  $id('budget-input').value = state.budget > 0 ? state.budget : '';
  renderTodoistSettings();
  renderTdButtons();
}
function saveBudget() {
  const inp = $id('budget-input');
  const v = parseFloat(inp.value);
  if (inp.value === '' || isNaN(v) || v < 0) {
    state.budget = 0;
  } else {
    state.budget = Math.round(v * 100) / 100;
  }
  saveState();
  toast(state.budget > 0 ? `budget set to ${CUR()}${state.budget.toFixed(2)}` : 'budget disabled');
}

// ─── Todoist sync ────────────────────────────────────────────────────────────
// REST v2 was retired 2026-02-10; everything below targets the unified v1 API.
const TD_BASE = 'https://api.todoist.com/api/v1';
let tdBusy = false;

/* Names are matched loosely so "Tomato  x2" and "tomato" are the same item:
   lowercase, strip a trailing quantity, collapse whitespace and punctuation. */
function tdParseQty(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*?)[\s,]*(?:[x×*]\s*(\d{1,2})|\((\d{1,2})\))$/i);
  if (m && m[1].trim()) {
    return { name: m[1].trim(), qty: Math.min(99, Math.max(1, parseInt(m[2] || m[3], 10))) };
  }
  return { name: s, qty: 1 };
}
function tdKey(name) {
  return String(name || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // drop accents
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function tdContent(item) {
  return (item.qty || 1) > 1 ? `${item.name} ×${item.qty}` : item.name;
}
function tdGuessCat(name) { return classify(name).cat; }

async function tdFetch(path, opts = {}) {
  const tok = Creds.token();
  if (!tok) throw new Error('no Todoist key saved — add one in settings');
  let res;
  try {
    res = await fetch(TD_BASE + path, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + tok,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
  } catch (e) {
    throw new Error(location.protocol === 'file:'
      ? 'blocked by the browser — open STORE over http(s), not as a local file'
      : 'network error — check your connection');
  }
  if (res.status === 401 || res.status === 403) throw new Error('token rejected by Todoist (401)');
  if (res.status === 429) throw new Error('rate limited by Todoist — wait a minute');
  if (!res.ok) throw new Error(`Todoist error ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

/* v1 paginates some collections as {results,next_cursor} and returns others as a
   bare array, so unwrap either and follow the cursor when there is one. */
async function tdGetAll(path, params = {}) {
  const out = [];
  let cursor = null;
  do {
    const q = new URLSearchParams({ ...params, limit: '200' });
    if (cursor) q.set('cursor', cursor);
    const page = await tdFetch(`${path}?${q}`);
    if (Array.isArray(page)) { out.push(...page); cursor = null; }
    else { out.push(...(page?.results || [])); cursor = page?.next_cursor || null; }
  } while (cursor);
  return out;
}

/* Resolves "04|life" / "home|groceries" to ids once, then caches them. */
async function tdResolveTarget(force = false) {
  const t = state.todoist;
  if (!force && t.projectId && t.sectionId) return t;

  const projects = await tdGetAll('/projects');
  const proj = projects.find(p => tdKey(p.name) === tdKey(t.project));
  if (!proj) {
    throw new Error(`project "${t.project}" not found (${projects.length} projects visible)`);
  }
  const sections = await tdGetAll('/sections', { project_id: proj.id });
  const sec = sections.find(s => tdKey(s.name) === tdKey(t.section));
  if (!sec) {
    const names = sections.map(s => s.name).join(', ') || 'none';
    throw new Error(`section "${t.section}" not found in ${proj.name} — has: ${names}`);
  }
  t.projectId = proj.id;
  t.sectionId = sec.id;
  saveState();
  return t;
}

async function testTodoist() {
  if (!Creds.token()) { tdStatus('add your Todoist key under settings → data first', 'bad'); return; }
  tdStatus('checking…', 'busy');
  try {
    const t = await tdResolveTarget(true);
    const tasks = await tdGetAll('/tasks', { project_id: t.projectId, section_id: t.sectionId });
    tdStatus(`connected — ${tasks.length} task${tasks.length === 1 ? '' : 's'} in ${t.section}`, 'good');
  } catch (e) {
    tdStatus(e.message, 'bad');
  }
}

/* Two-way union merge. Nothing is ever deleted or completed on either side:
   each side only gains the items the other side has and it is missing. */
async function syncTodoist() {
  if (tdBusy) return;
  if (!Creds.token()) { toast('add a Todoist key in settings'); Shell.settings('store'); return; }
  tdBusy = true;
  renderTdButtons();
  tdStatus('syncing…', 'busy');
  try {
    const t = await tdResolveTarget();
    const remote = await tdGetAll('/tasks', { project_id: t.projectId, section_id: t.sectionId });

    const remoteByKey = new Map();
    remote.forEach(task => {
      const { name, qty } = tdParseQty(task.content);
      const k = tdKey(name);
      if (k && !remoteByKey.has(k)) remoteByKey.set(k, { name, qty });
    });
    const localKeys = new Set(state.list.map(i => tdKey(i.name)).filter(Boolean));

    // ── Todoist → STORE
    let pulled = 0;
    remoteByKey.forEach((item, k) => {
      if (localKeys.has(k)) return;
      state.list.push({ name: item.name, cat: tdGuessCat(item.name), qty: item.qty, checked: false });
      localKeys.add(k);
      pulled++;
    });
    if (pulled) { saveState(); renderList(); }

    // ── STORE → Todoist (snapshot first: the pull above appended to state.list)
    const toPush = state.list.filter(i => {
      const k = tdKey(i.name);
      return k && !remoteByKey.has(k);
    });
    let pushed = 0, failed = 0;
    for (const item of toPush) {
      try {
        await tdFetch('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            content: tdContent(item),
            project_id: t.projectId,
            section_id: t.sectionId,
          }),
        });
        remoteByKey.set(tdKey(item.name), item);
        pushed++;
      } catch (e) { failed++; }
    }

    state.todoist.lastSync = Date.now();
    saveState();
    renderTodoistSettings();

    const parts = [];
    if (pulled) parts.push(`↓ ${pulled} added here`);
    if (pushed) parts.push(`↑ ${pushed} sent`);
    if (failed) parts.push(`${failed} failed`);
    const msg = parts.length ? parts.join(' · ') : 'already in sync';
    toast(msg);
    tdStatus(msg, failed ? 'bad' : 'good');
  } catch (e) {
    toast('sync failed');
    tdStatus(e.message, 'bad');
  } finally {
    tdBusy = false;
    renderTdButtons();
  }
}

function renderTdButtons() {
  $all('[data-td-btn]').forEach(b => {
    b.disabled = tdBusy;
    b.textContent = tdBusy ? 'syncing…' : b.dataset.tdBtn;
  });
}
function tdStatus(msg, kind) {
  const el = $id('td-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'td-status' + (kind ? ' ' + kind : '');
}

/* The key is set once in Settings › General; this only owns the target. */
function saveTodoist() {
  const proj = $id('td-project').value.trim();
  const sec  = $id('td-section').value.trim();
  const t = state.todoist;
  // a changed target invalidates the cached ids
  if (proj !== t.project || sec !== t.section) { t.projectId = null; t.sectionId = null; }
  t.project = proj || TD_DEFAULTS.project;
  t.section = sec || TD_DEFAULTS.section;
  saveState();
  renderTodoistSettings();
  toast('STORE target saved');
}

function renderTodoistSettings() {
  const t = state.todoist;
  if (!$id('td-project')) return;
  $id('td-project').value = t.project;
  $id('td-section').value = t.section;
  $id('td-last').textContent =
    t.lastSync ? 'last sync ' + new Date(t.lastSync).toLocaleString('en-GB',
      { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : 'never synced';
  $id('td-file-warn').classList.toggle('hidden', location.protocol !== 'file:');
}

// ─── Utils ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── Counter steps ───────────────────────────────────────────────────────────
   The +10/+5/+1/+.5/+.1 rows were ten hardcoded buttons. The amounts are a
   setting now; the two rows are drawn from it, largest first. `.5` rather than
   `0.5` on the face keeps the button narrow enough for five across a phone. */
function renderSteps() {
  const rows = $all('.cw-btns');
  if (!rows.length) return;
  const amts = (Config.get('store.quickAmounts') || [10,5,1,0.5,0.1])
    .slice().sort((a, b) => b - a);
  const face = n => String(n).replace(/^0\./, '.');
  rows[0].innerHTML = amts.map(n =>
    `<button class="cw-btn plus" onclick="STORE.addCart(${n})">+${face(n)}</button>`).join('');
  if (rows[1]) rows[1].innerHTML = amts.map(n =>
    `<button class="cw-btn minus" onclick="STORE.addCart(${-n})">−${face(n)}</button>`).join('');
}

// ─── Boot ────────────────────────────────────────────────────────────────────
loadState();
renderSteps();
renderHome();

/* An edited aisle, meal or step amount redraws the list and the tiles at once.
   Items already on the list keep the category they were filed under; only ones
   whose aisle no longer exists fall back to "other". */
Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('store.')) return;
  CATEGORIES = Config.get('store.categories');
  MEALS      = Config.get('store.meals');
  VOCAB = null;   // the categoriser's vocabulary is built from CATEGORIES; rebuild it
  let moved = false;
  state.list.forEach(it => { if (!CATEGORIES[it.cat]) { it.cat = 'manual'; moved = true; } });
  if (moved) saveState();
  renderSteps();
  renderHome();
});

// the currency mark reaches nine different readouts and the date label follows
// the date format; one redraw covers them all
Prefs.subscribe(k => { if (k === 'currency' || k === 'dateFormat' || k === '*') renderHome(); });

Shell.register('store', { home: () => go('home') });   // the STORE tab tapped while on STORE

return { go, addCart, resetCart, togglePin, openPad, closePad, padKey, padBack, padClear,
         padCount, padApply, openCartLog, closeCartLog,
         addManual, toggleChecked, setQty, deleteItem, confirmClearList,
         saveTrip, openTripName, closeTripName, confirmTripName,
         openCatPick, closeCatPick, setCat,
         openCategory, addItemAndRefresh, toggleMeal, addMeal,
         restoreTrip, deleteTrip, clearHistory,
         renderSettings, saveBudget, saveTodoist, testTodoist, syncTodoist };
})();
