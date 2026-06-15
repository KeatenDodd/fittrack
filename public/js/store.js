'use strict';

const sKey = 'fittrack.auth';

function read() {
  try { return JSON.parse(localStorage.getItem(sKey)) || {}; }
  catch (tErr) { return {}; }
}

export const oStore = {
  get accessToken() { return read().accessToken || null; },
  get refreshToken() { return read().refreshToken || null; },
  get user() { return read().user || null; },

  setSession(tAccess, tRefresh, tUser) {
    const oCurrent = read();
    const oNext = {
      accessToken: tAccess,
      refreshToken: tRefresh != null ? tRefresh : oCurrent.refreshToken,
      user: tUser != null ? tUser : oCurrent.user,
    };
    localStorage.setItem(sKey, JSON.stringify(oNext));
  },

  setAccess(tAccess, tRefresh) {
    const oCurrent = read();
    oCurrent.accessToken = tAccess;
    if (tRefresh) oCurrent.refreshToken = tRefresh;
    localStorage.setItem(sKey, JSON.stringify(oCurrent));
  },

  clear() { localStorage.removeItem(sKey); },

  // current active workout session id (persists across navigation)
  get activeSessionId() { return localStorage.getItem('fittrack.activeSession') || null; },
  set activeSessionId(tId) {
    if (tId) localStorage.setItem('fittrack.activeSession', String(tId));
    else localStorage.removeItem('fittrack.activeSession');
  },
};
