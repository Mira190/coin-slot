// Shared bits for standalone (full-page) games under games/<id>/.
// Include with <script src="../../arcade/page.js" data-game="<id>"></script>
// Adds a "← Games" link back to the lobby and a shared high-score store the lobby reads.
(function () {
  'use strict';
  const me = document.currentScript;
  const id = me && me.dataset.game;
  const key = (g) => 'coinslot-best-' + g;
  const A = window.Arcade = window.Arcade || {};
  A.best = (g) => { try { return +localStorage.getItem(key(g || id)) || 0; } catch (e) { return 0; } };
  // higher is better; returns true on a new record
  A.saveBest = (n, g) => {
    n = Math.floor(n || 0);
    if (n <= A.best(g)) return false;
    try { localStorage.setItem(key(g || id), String(n)); } catch (e) { /* ignore */ }
    return true;
  };
  if (me && me.dataset.back === 'none') return;
  const a = document.createElement('a');
  a.href = '../../'; a.textContent = '← Games'; a.setAttribute('aria-label', 'Back to all games');
  a.style.cssText = 'position:fixed;z-index:9999;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));' +
    'padding:6px 12px;border-radius:999px;background:rgba(13,15,34,.72);color:#ECEAFF;font:600 13px system-ui,sans-serif;text-decoration:none;' +
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)';
  (document.body ? Promise.resolve() : new Promise((r) => addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(a));
})();
