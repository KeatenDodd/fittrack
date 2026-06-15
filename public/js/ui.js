'use strict';

// Tiny hyperscript helper. h('div.card', { onclick }, [children])
export function h(tSpec, tAttrs, tChildren) {
  const aParts = tSpec.split(/(?=[.#])/);
  const sTag = aParts[0] || 'div';
  const oEl = document.createElement(sTag);
  for (const sPart of aParts.slice(1)) {
    if (sPart[0] === '.') oEl.classList.add(sPart.slice(1));
    else if (sPart[0] === '#') oEl.id = sPart.slice(1);
  }
  const oAttrs = tAttrs || {};
  for (const sName of Object.keys(oAttrs)) {
    const oVal = oAttrs[sName];
    if (sName === 'class') oEl.className += ' ' + oVal;
    else if (sName === 'html') oEl.innerHTML = oVal;
    else if (sName === 'text') oEl.textContent = oVal;
    else if (sName.startsWith('on') && typeof oVal === 'function') {
      oEl.addEventListener(sName.slice(2).toLowerCase(), oVal);
    } else if (oVal != null && oVal !== false) {
      oEl.setAttribute(sName, oVal === true ? '' : oVal);
    }
  }
  appendChildren(oEl, tChildren);
  return oEl;
}

function appendChildren(tEl, tChildren) {
  if (tChildren == null) return;
  const aItems = Array.isArray(tChildren) ? tChildren : [tChildren];
  for (const oItem of aItems) {
    if (oItem == null || oItem === false) continue;
    tEl.appendChild(oItem instanceof Node ? oItem : document.createTextNode(String(oItem)));
  }
}

export function clear(tEl) { while (tEl.firstChild) tEl.removeChild(tEl.firstChild); }

export function mount(tEl, tChildren) { clear(tEl); appendChildren(tEl, tChildren); }

// ---- formatting --------------------------------------------------------------
export function num(tValue, tDigits) {
  if (tValue == null || tValue === '') return '–';
  const fValue = Number(tValue);
  if (!Number.isFinite(fValue)) return '–';
  return fValue.toLocaleString(undefined, {
    minimumFractionDigits: tDigits || 0,
    maximumFractionDigits: tDigits != null ? tDigits : 0,
  });
}

export function fmtDate(tIso) {
  const oDate = new Date(tIso);
  return oDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDay(tIso) {
  const oDate = new Date(tIso);
  return oDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Local calendar date (YYYY-MM-DD). NOT toISOString() — that returns the UTC
// date, which is a day ahead in the evening for western time zones and made
// logged food/activity land on the wrong day.
export function todayISO() {
  const oDate = new Date();
  return oDate.getFullYear() + '-'
    + String(oDate.getMonth() + 1).padStart(2, '0') + '-'
    + String(oDate.getDate()).padStart(2, '0');
}

export function clock(tSeconds) {
  const iMin = Math.floor(tSeconds / 60);
  const iSec = tSeconds % 60;
  return iMin + ':' + String(iSec).padStart(2, '0');
}

// ---- toast -------------------------------------------------------------------
let oToastTimer = null;
export function toast(tMessage) {
  const oEl = document.getElementById('toast');
  oEl.textContent = tMessage;
  oEl.classList.add('show');
  clearTimeout(oToastTimer);
  oToastTimer = setTimeout(() => oEl.classList.remove('show'), 2200);
}

// ---- modal / bottom sheet ----------------------------------------------------
// tOnClose (optional) runs once when the sheet is dismissed — for cleanup such
// as stopping a camera. It runs before the DOM is torn down.
export function openSheet(tTitle, tBuildBody, tOnClose) {
  const oRoot = document.getElementById('modal-root');
  let bClosed = false;
  const oClose = () => {
    if (bClosed) return;
    bClosed = true;
    if (tOnClose) { try { tOnClose(); } catch (tErr) { /* ignore */ } }
    clear(oRoot);
  };

  const oBody = h('div');
  const oSheet = h('div.sheet', {}, [
    h('h2', {}, [tTitle, h('button.close', { type: 'button', text: '\u00d7', onclick: oClose })]),
    oBody,
  ]);
  const oScrim = h('div.scrim', {
    onclick: (tEvent) => { if (tEvent.target === oScrim) oClose(); },
  }, [oSheet]);

  mount(oRoot, oScrim);
  tBuildBody(oBody, oClose);
  return oClose;
}

export function confirmAction(tMessage, tOnYes) {
  openSheet('Confirm', (tBody, tClose) => {
    mount(tBody, [
      h('p.muted', { text: tMessage, style: 'margin-top:0' }),
      h('div.btn-row', {}, [
        h('button.btn.btn-ghost', { type: 'button', text: 'Cancel', onclick: tClose }),
        h('button.btn', { type: 'button', text: 'Delete', style: 'background:var(--danger)',
          onclick: () => { tClose(); tOnYes(); } }),
      ]),
    ]);
  });
}

// thin wrapper so views can catch + surface API errors consistently
export async function guard(tPromise) {
  try { return await tPromise; }
  catch (tErr) { toast(tErr.message || 'Something went wrong'); throw tErr; }
}
