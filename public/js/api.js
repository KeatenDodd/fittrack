'use strict';
import { oStore } from './store.js';

let oRefreshing = null;

async function rawFetch(tPath, tOptions, tRetry) {
  const oHeaders = Object.assign({ 'Content-Type': 'application/json' }, tOptions.headers || {});
  const sToken = oStore.accessToken;
  if (sToken) oHeaders.Authorization = 'Bearer ' + sToken;

  const oResponse = await fetch('/api' + tPath, { ...tOptions, headers: oHeaders });

  if (oResponse.status === 401 && !tRetry && oStore.refreshToken) {
    const didRefresh = await tryRefresh();
    if (didRefresh) return rawFetch(tPath, tOptions, true);
  }

  const sText = await oResponse.text();
  const oData = sText ? JSON.parse(sText) : {};
  if (!oResponse.ok) {
    const oErr = new Error(oData.error || ('Request failed (' + oResponse.status + ')'));
    oErr.iStatus = oResponse.status;
    throw oErr;
  }
  return oData;
}

async function tryRefresh() {
  if (!oRefreshing) {
    oRefreshing = (async () => {
      try {
        const oResponse = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: oStore.refreshToken }),
        });
        if (!oResponse.ok) return false;
        const oData = await oResponse.json();
        oStore.setAccess(oData.accessToken, oData.refreshToken);
        return true;
      } catch (tErr) {
        return false;
      } finally {
        oRefreshing = null;
      }
    })();
  }
  return oRefreshing;
}

// Raw binary upload (image/video). Streams the File as the request body with
// its own content-type; metadata travels in the query string.
async function rawUpload(tPath, tFile) {
  const oHeaders = { 'Content-Type': tFile.type || 'application/octet-stream' };
  const sToken = oStore.accessToken;
  if (sToken) oHeaders.Authorization = 'Bearer ' + sToken;
  const oResponse = await fetch('/api' + tPath, { method: 'POST', headers: oHeaders, body: tFile });
  const sText = await oResponse.text();
  const oData = sText ? JSON.parse(sText) : {};
  if (!oResponse.ok) throw new Error(oData.error || ('Upload failed (' + oResponse.status + ')'));
  return oData;
}

function get(tPath) { return rawFetch(tPath, { method: 'GET' }); }
function post(tPath, tBody) { return rawFetch(tPath, { method: 'POST', body: JSON.stringify(tBody || {}) }); }
function put(tPath, tBody) { return rawFetch(tPath, { method: 'PUT', body: JSON.stringify(tBody || {}) }); }
function del(tPath) { return rawFetch(tPath, { method: 'DELETE' }); }

export const api = {
  // auth
  profiles: () => get('/auth/profiles'),
  register: (tBody) => post('/auth/register', tBody),
  selectProfile: (tUserId) => post('/auth/select', { userId: tUserId }),
  logout: () => post('/auth/logout', { refreshToken: oStore.refreshToken }),
  me: () => get('/auth/me'),
  updateProfile: (tBody) => put('/auth/me', tBody),

  // menstrual cycle
  cycle: () => get('/cycle'),
  saveCycleDay: (tDate, tBody) => put('/cycle/' + tDate, tBody),
  saveCyclePeriod: (tBody) => post('/cycle/range', tBody),

  // progress photos
  progressPhotos: () => get('/photos'),
  uploadProgressPhoto: (tFile, tDate, tAngle) =>
    rawUpload('/photos?date=' + encodeURIComponent(tDate) + '&angle=' + encodeURIComponent(tAngle), tFile),
  deleteProgressPhoto: (tId) => del('/photos/' + tId),

  // exercises
  exercises: () => get('/exercises'),
  createExercise: (tBody) => post('/exercises', tBody),
  deleteExercise: (tId) => del('/exercises/' + tId),

  // templates
  templates: () => get('/templates'),
  template: (tId) => get('/templates/' + tId),
  createTemplate: (tBody) => post('/templates', tBody),
  updateTemplate: (tId, tBody) => put('/templates/' + tId, tBody),
  deleteTemplate: (tId) => del('/templates/' + tId),

  // sessions
  sessions: () => get('/sessions'),
  sessionCalendar: (sMonth) => get('/sessions/calendar' + (sMonth ? '?month=' + sMonth : '')),
  session: (tId) => get('/sessions/' + tId),
  startSession: (tBody) => post('/sessions', tBody),
  updateSession: (tId, tBody) => put('/sessions/' + tId, tBody),
  finishSession: (tId) => post('/sessions/' + tId + '/finish', {}),
  deleteSession: (tId) => del('/sessions/' + tId),
  addSessionExercise: (tId, tExerciseId) => post('/sessions/' + tId + '/exercises', { exerciseId: tExerciseId }),
  removeSessionExercise: (tSeId) => del('/sessions/exercises/' + tSeId),
  setSessionExerciseNote: (tSeId, tNotes) => put('/sessions/exercises/' + tSeId, { notes: tNotes }),
  addExerciseMedia: (tSeId, tFile) => rawUpload('/sessions/exercises/' + tSeId + '/media', tFile),
  deleteExerciseMedia: (tMediaId) => del('/sessions/media/' + tMediaId),
  addSet: (tSeId, tBody) => post('/sessions/exercises/' + tSeId + '/sets', tBody),
  updateSet: (tSetId, tBody) => put('/sessions/sets/' + tSetId, tBody),
  deleteSet: (tSetId) => del('/sessions/sets/' + tSetId),

  // programs / mesocycles
  activeProgram: () => get('/programs/active'),
  program: (tId) => get('/programs/' + tId),
  createProgram: (tBody) => post('/programs', tBody),
  startNextProgramDay: (tId) => post('/programs/' + tId + '/start-next', {}),
  restartProgram: (tId) => post('/programs/' + tId + '/restart', {}),
  deleteProgram: (tId) => del('/programs/' + tId),

  // body
  weight: () => get('/body/weight'),
  addWeight: (tBody) => post('/body/weight', tBody),
  deleteWeight: (tId) => del('/body/weight/' + tId),
  measurementTypes: () => get('/body/measurement-types'),
  measurements: (tTypeId) => get('/body/measurements' + (tTypeId ? '?typeId=' + tTypeId : '')),
  addMeasurement: (tBody) => post('/body/measurements', tBody),
  deleteMeasurement: (tId) => del('/body/measurements/' + tId),

  // nutrition
  nutrients: () => get('/nutrition/nutrients'),
  searchFoods: (tQuery) => get('/nutrition/foods/search?q=' + encodeURIComponent(tQuery)),
  food: (tId) => get('/nutrition/foods/' + tId),
  foodByBarcode: (tCode) => get('/nutrition/foods/barcode/' + encodeURIComponent(tCode)),
  saveFood: (tBody) => post('/nutrition/foods', tBody),
  foodLog: (tDate) => get('/nutrition/log' + (tDate ? '?date=' + tDate : '')),
  logFood: (tBody) => post('/nutrition/log', tBody),
  updateLog: (tId, tBody) => put('/nutrition/log/' + tId, tBody),
  deleteLog: (tId) => del('/nutrition/log/' + tId),
  summary: (tDate) => get('/nutrition/summary' + (tDate ? '?date=' + tDate : '')),
  trend: (tFrom, tTo) => get('/nutrition/trend?from=' + (tFrom || '') + '&to=' + (tTo || '')),
  goals: () => get('/nutrition/goals'),
  setGoals: (tGoals) => put('/nutrition/goals', { goals: tGoals }),

  // stats
  exercisesWithHistory: () => get('/stats/exercises'),
  exerciseStats: (tId) => get('/stats/exercise/' + tId),
  overview: () => get('/stats/overview'),

  // activity (steps + calories burned)
  activityToday: () => get('/activity/today'),
  activityRange: (tFrom, tTo) => get('/activity?from=' + (tFrom || '') + '&to=' + (tTo || '')),
  saveActivity: (tBody) => post('/activity', tBody),
  activityKey: () => get('/activity/key'),
  rotateActivityKey: () => post('/activity/key/rotate', {}),

  // import (raw CSV text body, not JSON)
  importStrong: async (tCsvText) => {
    const oHeaders = { 'Content-Type': 'text/plain' };
    const sToken = oStore.accessToken;
    if (sToken) oHeaders.Authorization = 'Bearer ' + sToken;
    const oResponse = await fetch('/api/import/strong', { method: 'POST', headers: oHeaders, body: tCsvText });
    const sText = await oResponse.text();
    const oData = sText ? JSON.parse(sText) : {};
    if (!oResponse.ok) throw new Error(oData.error || ('Import failed (' + oResponse.status + ')'));
    return oData;
  },
};
