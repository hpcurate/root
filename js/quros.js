/* qurOS inside ROOT (ROOT 5.0, the last phase of ROOT 5; the BRAIN request
   r261027-qo06, phase 1). The tab is qurOS itself — a copy of qurOS 2.x in
   quros/, opened in a frame on the same site with ?embed=root — so its records
   (IndexedDB `qurOS`, `qos_*` keys), its recorder, its tabs and its screens are
   exactly the app's: nothing is moved, nothing re-implemented, never lose words.
   This module only owns the frame: loading it the first time the tab shows,
   ROOT's colours carried in, and ROOT's chrome stepping aside while the
   recorder is up. */
window.QUROS = (function () {
'use strict';

const frame = document.querySelector('.ns-quros #qos-frame');
const root  = document.documentElement;
let loaded = false, recObs = null;

/* the app inside, once it has booted (same origin: its window is ROOT's to reach) */
const inner = () => { try { const w = frame && frame.contentWindow; return w && w.Q && w.Q.app ? w.Q : null; } catch { return null; } };

/* The frame is loaded on first sight rather than at ROOT's start: qurOS boots
   its records and offers a dump to recover, which belongs to opening qurOS, not
   to opening ROOT. `pad` is the dock's height, so its last line clears it. */
function load() {
  if (loaded || !frame) return;
  loaded = true;
  const navH = parseInt(getComputedStyle(root).getPropertyValue('--nav-fh'), 10) || 58;
  frame.addEventListener('load', watch, { once: true });
  frame.src = 'quros/index.html?embed=root&pad=' + (navH + 30);
}

/* While qurOS's recorder is open (its <html> wears rec-open), ROOT's dock, its
   arrows and the band step aside: a locked recorder takes no touch but its slider. */
function watch() {
  let d = null;
  try { d = frame.contentDocument && frame.contentDocument.documentElement; } catch {}
  if (!d) return;
  const sync = () => root.classList.toggle('qos-rec', d.classList.contains('rec-open'));
  if (recObs) recObs.disconnect();
  recObs = new MutationObserver(sync);
  recObs.observe(d, { attributes: true, attributeFilter: ['class'] });
  sync();
}

function show(id) { const Q = inner(); if (Q) Q.app.show(id); }

/* settings → apps → qurOS: its own settings screen, in its own tab — the frame
   loaded first if it is not yet, and asked again until qurOS has booted */
function openSettings() {
  Shell.go('quros');
  load();
  let tries = 0;
  const ask = () => {
    const Q = inner();
    if (Q && Q.settingsUI) { Q.settingsUI.open(); return; }
    if (++tries < 40) setTimeout(ask, 150);
  };
  ask();
}

/* ROOT's colours changed (a theme, the ground, a palette): carry them in */
if (window.Prefs) Prefs.subscribe(() => { const Q = inner(); if (Q && Q.app.theme) Q.app.theme(); });

Shell.register('quros', {
  onShow: () => { load(); const Q = inner(); if (Q) { if (Q.app.theme) Q.app.theme(); Q.app.refresh(); } },
  // the qurOS tab tapped while on it: back to its first tab
  home: () => show('dump'),
});

return { show, load, inner, openSettings };
})();
