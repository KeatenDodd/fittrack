'use strict';
import { oStore } from './store.js';
import { api } from './api.js';
import { h, mount, clear, toast } from './ui.js';
import { initPullToRefresh } from './ptr.js';

import * as viewAuth from './views/auth.js';
import * as viewDashboard from './views/dashboard.js';
import * as viewWorkout from './views/workout.js';
import * as viewTemplates from './views/templates.js';
import * as viewHistory from './views/history.js';
import * as viewBody from './views/body.js';
import * as viewNutrition from './views/nutrition.js';
import * as viewRecipes from './views/recipes.js';
import * as viewProgress from './views/progress.js';
import * as viewImport from './views/import.js';
import * as viewActivity from './views/activity.js';
import * as viewSettings from './views/settings.js';
import * as viewProgram from './views/program.js';
import * as viewCycle from './views/cycle.js';

// route key -> { label, icon (svg path), view, nav (show in bars) }
const oRoutes = {
  dashboard: { label: 'Home', icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', view: viewDashboard, nav: true },
  program:   { label: 'Program', icon: 'M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12', view: viewProgram, nav: true },
  nutrition: { label: 'Food', icon: 'M6 3v8a3 3 0 006 0V3M9 3v18M17 3c-1.5 1-2 3-2 6s.5 4 2 4v8', view: viewNutrition, nav: true },
  body:      { label: 'Body', icon: 'M12 5a2 2 0 100-4 2 2 0 000 4zM6 9l6-2 6 2M12 7v7m0 0l-3 7m3-7l3 7', view: viewBody, nav: true },
  progress:  { label: 'Progress', icon: 'M4 19V5m0 14h16M8 15l3-4 3 2 4-6', view: viewProgress, nav: true },
  workout:   { label: 'Workout', icon: '', view: viewWorkout, nav: false },
  templates: { label: 'Templates', icon: '', view: viewTemplates, nav: false },
  history:   { label: 'History', icon: '', view: viewHistory, nav: false },
  import:    { label: 'Import', icon: '', view: viewImport, nav: false },
  activity:  { label: 'Activity', icon: '', view: viewActivity, nav: false },
  settings:  { label: 'Settings', icon: '', view: viewSettings, nav: false },
  cycle:     { label: 'Cycle', icon: '', view: viewCycle, nav: false },
  recipes:   { label: 'Recipes', icon: '', view: viewRecipes, nav: false },
};

function currentRoute() {
  const sHash = (location.hash || '#/dashboard').replace(/^#\//, '');
  const aParts = sHash.split('/');
  return { sKey: aParts[0] || 'dashboard', aArgs: aParts.slice(1) };
}

function icon(sPath) {
  const sNs = 'http://www.w3.org/2000/svg';
  const oSvg = document.createElementNS(sNs, 'svg');
  oSvg.setAttribute('viewBox', '0 0 24 24');
  const oPath = document.createElementNS(sNs, 'path');
  oPath.setAttribute('d', sPath);
  oPath.setAttribute('stroke-linecap', 'round');
  oPath.setAttribute('stroke-linejoin', 'round');
  oSvg.appendChild(oPath);
  return oSvg;
}

function renderNav(sActiveKey) {
  const oTopNav = document.getElementById('topNav');
  const oTabBar = document.getElementById('tabBar');
  clear(oTopNav); clear(oTabBar);

  for (const sKey of Object.keys(oRoutes)) {
    const oRoute = oRoutes[sKey];
    if (!oRoute.nav) continue;
    const isActive = sKey === sActiveKey;

    const oTop = h('a', { href: '#/' + sKey, text: oRoute.label });
    if (isActive) oTop.classList.add('active');
    oTopNav.appendChild(oTop);

    const oTab = h('a', { href: '#/' + sKey }, [icon(oRoute.icon), h('span', { text: oRoute.label })]);
    if (isActive) oTab.classList.add('active');
    oTabBar.appendChild(oTab);
  }
}

// Middle-earth line-art icons for the header's secondary links.
const ICON_HISTORY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h10a2 2 0 0 1 2 2 2 2 0 0 1-2 2H8"/><path d="M6 4a2 2 0 0 0-2 2v11a2.5 2.5 0 0 0 2.5 2.5H15"/><path d="M8 11h6M8 14h4"/><path d="M20.5 12.5 14 19l-2.6.6.6-2.6 6.5-6.5a1.35 1.35 0 0 1 1.9 0 1.35 1.35 0 0 1 0 1.9z"/></svg>';
const ICON_SETTINGS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.4"/><path d="M10 4.6V3M10 17v-1.6M4.6 10H3M17 10h-1.6M6.2 6.2 5 5M15 15l-1.2-1.2M13.8 6.2 15 5M5 15l1.2-1.2"/><circle cx="17.5" cy="17.5" r="1.7"/><path d="M17.5 14.6v-1M17.5 20.4v-1M14.6 17.5h-1M20.4 17.5h-1"/></svg>';
const ICON_CYCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';

function hdrIcon(sHref, sLabel, sSvg) {
  return h('a.hdr-icon', { href: sHref, title: sLabel, 'aria-label': sLabel, html: sSvg });
}

function renderHeaderUser() {
  const oEl = document.getElementById('headerUser');
  const oUser = oStore.user;
  clear(oEl);
  if (!oUser) return;
  if (oUser.sex === 'female') oEl.appendChild(hdrIcon('#/cycle', 'Cycle', ICON_CYCLE));
  oEl.appendChild(hdrIcon('#/history', 'History', ICON_HISTORY));
  oEl.appendChild(hdrIcon('#/settings', 'Settings', ICON_SETTINGS));
  oEl.appendChild(h('button', { type: 'button', text: 'Switch Accounts', onclick: signOut }));
  oEl.appendChild(h('span.who', { text: oUser.displayName || oUser.username }));
}

async function signOut() {
  try { await api.logout(); } catch (tErr) { /* ignore */ }
  oStore.clear();
  oStore.activeSessionId = null;
  location.hash = '#/dashboard';
  boot();
}

async function route() {
  const oView = document.getElementById('view');
  if (!oStore.accessToken) { return; }

  const { sKey, aArgs } = currentRoute();
  const oRoute = oRoutes[sKey] || oRoutes.dashboard;
  // A live workout / template editor belongs to the Program tab; other non-tab
  // pages (History, Cycle, Settings, …) are header links and highlight no tab.
  renderNav(oRoutes[sKey] && oRoutes[sKey].nav ? sKey
    : (['workout', 'templates'].includes(sKey) ? 'program'
      : (sKey === 'recipes' ? 'nutrition' : sKey)));

  clear(oView);
  try {
    await oRoute.view.render(oView, aArgs, { navigate });
  } catch (tErr) {
    if (tErr.iStatus === 401) { return boot(); }
    mount(oView, h('div.empty', {}, [h('p', { text: tErr.message || 'Could not load this page.' })]));
  }
  window.scrollTo(0, 0);
}

export function navigate(sPath) {
  if (location.hash === '#' + sPath) route();
  else location.hash = sPath;
}

function showChrome(isVisible) {
  document.getElementById('appHeader').classList.toggle('hidden', !isVisible);
  document.getElementById('tabBar').classList.toggle('hidden', !isVisible);
}

async function boot() {
  const oView = document.getElementById('view');
  if (!oStore.accessToken) {
    showChrome(false);
    return viewAuth.render(oView, [], { onAuthed: boot });
  }
  // validate session; refresh user
  try {
    const oData = await api.me();
    oStore.setSession(oStore.accessToken, oStore.refreshToken, oData.user);
  } catch (tErr) {
    oStore.clear();
    showChrome(false);
    return viewAuth.render(oView, [], { onAuthed: boot });
  }
  showChrome(true);
  renderHeaderUser();
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

window.addEventListener('hashchange', route);
initPullToRefresh();
boot();
