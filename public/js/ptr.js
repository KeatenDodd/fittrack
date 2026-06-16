'use strict';
// Pull-to-refresh for the installed/home-screen app. In iOS standalone mode
// there's no browser chrome, so a normal pull doesn't reload. This adds a custom
// pull-down-at-the-top gesture that reloads the page. Only active when running
// standalone (a normal browser tab already has native pull-to-refresh).
export function initPullToRefresh() {
  const bStandalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  if (!bStandalone) return;

  const oEl = document.createElement('div');
  oEl.className = 'ptr';
  oEl.innerHTML = '<div class="ptr-spinner"></div>';
  document.body.appendChild(oEl);

  const THRESH = 70;   // px to pull before it refreshes
  const MAX = 110;
  let fStartY = 0;
  let bPulling = false;
  let fDist = 0;

  function reset(bSmooth) {
    oEl.style.transition = bSmooth ? 'transform .25s ease, opacity .2s' : 'none';
    oEl.style.transform = 'translateY(-44px)';
    oEl.style.opacity = '0';
    oEl.classList.remove('ready');
  }
  reset(false);

  window.addEventListener('touchstart', (tEvent) => {
    if (window.scrollY <= 0 && tEvent.touches.length === 1) {
      fStartY = tEvent.touches[0].clientY; bPulling = true; fDist = 0;
    } else { bPulling = false; }
  }, { passive: true });

  window.addEventListener('touchmove', (tEvent) => {
    if (!bPulling) return;
    fDist = tEvent.touches[0].clientY - fStartY;
    if (fDist > 0 && window.scrollY <= 0) {
      tEvent.preventDefault();                 // take over from the rubber-band
      const fShown = Math.min(fDist, MAX);
      oEl.style.transition = 'none';
      oEl.style.transform = 'translateY(' + (fShown - 14) + 'px)';
      oEl.style.opacity = String(Math.min(fShown / THRESH, 1));
      oEl.classList.toggle('ready', fShown >= THRESH);
    } else {
      bPulling = false;
      reset(true);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (!bPulling) return;
    bPulling = false;
    if (fDist >= THRESH) {
      oEl.classList.add('refreshing');
      oEl.style.transition = 'transform .2s ease';
      oEl.style.transform = 'translateY(24px)';
      oEl.style.opacity = '1';
      setTimeout(() => window.location.reload(), 150);
    } else {
      reset(true);
    }
    fDist = 0;
  });
}
