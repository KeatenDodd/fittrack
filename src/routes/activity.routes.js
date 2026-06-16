'use strict';
// Daily activity (steps + calories burned). Designed so a phone automation can
// push the numbers a Zepp watch puts into Apple Health / Health Connect:
//
//   POST /api/activity
//   Header: X-API-Key: <the user's ingest key>   (or a normal Bearer token)
//   Body:   { "date": "2026-06-14", "steps": 8421, "caloriesBurned": 540 }
//
// One row per user per day; a push upserts (partial pushes don't wipe the other
// field). Reads and key management require a normal signed-in session.
const express = require('express');
const crypto = require('crypto');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();

// Accept either an ingest API key (for unattended phone automations) or a
// normal access token (for the app itself).
async function authKeyOrJwt(tReq, tRes, tNext) {
  const sKey = tReq.headers['x-api-key'];
  if (sKey) {
    const oUser = await oDb.one('SELECT id FROM users WHERE ingest_key = $1', [String(sKey)]);
    if (!oUser) return tRes.status(401).json({ error: 'Invalid API key' });
    tReq.iUserId = oUser.id;
    return tNext();
  }
  return oAuth.requireAuth(tReq, tRes, tNext);
}

// Local calendar date (server runs in the household's timezone). Using UTC here
// made "today" wrong in the evening for western zones.
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Upsert one day. Partial updates (one of steps/calories) keep the other value.
async function upsertActivity(iUserId, sDay, iSteps, fCalories, sSource) {
  return oDb.one(
    `INSERT INTO activity_logs (user_id, day, steps, calories_burned, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, day) DO UPDATE SET
       steps = COALESCE(EXCLUDED.steps, activity_logs.steps),
       calories_burned = COALESCE(EXCLUDED.calories_burned, activity_logs.calories_burned),
       source = EXCLUDED.source,
       updated_at = datetime('now','localtime')
     RETURNING day, steps, calories_burned, source, updated_at`,
    [iUserId, sDay, iSteps, fCalories, sSource]
  );
}

// Parse the body even if the app sends an odd content-type (some send
// text/plain or no charset); global JSON parsing only handles application/json.
const oAnyJson = express.json({ type: () => true, limit: '10mb' });

function looksLikeHealthExport(oBody) {
  return !!oBody && ((oBody.data && Array.isArray(oBody.data.metrics)) || Array.isArray(oBody.metrics));
}

// Parse a "Health Auto Export" payload (Apple Health) and upsert each day.
async function ingestHealthExport(iUserId, oBody) {
  const aMetrics = (oBody.data && oBody.data.metrics) || oBody.metrics || [];
  console.log('[activity] health export: metrics=%d  names=%j',
    aMetrics.length, aMetrics.map((m) => m && m.name));
  if (!aMetrics.length) throw httpError(400, 'No Health metrics found (expected data.metrics[]).');

  const oByDay = {};
  function bump(sDay, sField, fQty) {
    if (!sDay || !Number.isFinite(fQty)) return;
    if (!oByDay[sDay]) oByDay[sDay] = { steps: null, calories: null };
    oByDay[sDay][sField] = (oByDay[sDay][sField] || 0) + fQty;
  }
  for (const oMetric of aMetrics) {
    const sName = String(oMetric.name || '').toLowerCase();
    const sUnits = String(oMetric.units || '').toLowerCase();
    const bSteps = sName.includes('step');
    const bEnergy = sName.includes('active_energy') || sName.includes('active energy') || sName === 'activeenergyburned';
    if (!bSteps && !bEnergy) continue;
    for (const oSample of (oMetric.data || [])) {
      const sDay = String(oSample.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sDay)) continue;
      let fQty = Number(oSample.qty);
      if (!Number.isFinite(fQty)) continue;
      if (bEnergy && sUnits === 'kj') fQty = fQty / 4.184; // kJ -> kcal
      bump(sDay, bSteps ? 'steps' : 'calories', fQty);
    }
  }
  const aDays = Object.keys(oByDay).sort();
  for (const sDay of aDays) {
    const o = oByDay[sDay];
    await upsertActivity(iUserId, sDay,
      o.steps != null ? Math.round(o.steps) : null,
      o.calories != null ? Math.round(o.calories * 10) / 10 : null,
      'apple_health');
  }
  console.log('[activity] health export: upserted %d day(s): %j', aDays.length, aDays);
  return { daysUpdated: aDays.length, days: aDays };
}

// POST /api/activity  -> upsert a day's steps / calories burned.
// Also accepts a Health Auto Export payload here (so it works even if the watch
// app is pointed at this URL instead of /health-auto-export).
oRouter.post('/', oAnyJson, authKeyOrJwt, wrap(async (tReq, tRes) => {
  const oBody = tReq.body || {};
  if (looksLikeHealthExport(oBody)) {
    return tRes.json(Object.assign({ ok: true }, await ingestHealthExport(tReq.iUserId, oBody)));
  }
  const sDay = /^\d{4}-\d{2}-\d{2}$/.test(String(oBody.date || '')) ? oBody.date : today();
  const iSteps = oBody.steps != null && oBody.steps !== '' ? Math.round(Number(oBody.steps)) : null;
  const fCalories = oBody.caloriesBurned != null && oBody.caloriesBurned !== '' ? Number(oBody.caloriesBurned) : null;
  if (iSteps != null && !Number.isFinite(iSteps)) throw httpError(400, 'steps must be a number');
  if (fCalories != null && !Number.isFinite(fCalories)) throw httpError(400, 'caloriesBurned must be a number');
  const sSource = String(oBody.source || 'manual').slice(0, 30);
  const oRow = await upsertActivity(tReq.iUserId, sDay, iSteps, fCalories, sSource);
  tRes.json({ activity: oRow });
}));

// POST /api/activity/health-auto-export  -> dedicated endpoint for the app.
oRouter.post('/health-auto-export', oAnyJson, authKeyOrJwt, wrap(async (tReq, tRes) => {
  tRes.json(Object.assign({ ok: true }, await ingestHealthExport(tReq.iUserId, tReq.body || {})));
}));

// GET /api/activity?from=&to=  -> range (defaults to last 30 days)
oRouter.get('/', oAuth.requireAuth, wrap(async (tReq, tRes) => {
  const sTo = /^\d{4}-\d{2}-\d{2}$/.test(String(tReq.query.to || '')) ? tReq.query.to : today();
  let sFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(tReq.query.from || '')) ? tReq.query.from : null;
  if (!sFrom) {
    const o = new Date(); o.setDate(o.getDate() - 30); sFrom = o.toISOString().slice(0, 10);
  }
  const aRows = await oDb.many(
    `SELECT day, steps, calories_burned, source FROM activity_logs
     WHERE user_id = $1 AND day BETWEEN $2 AND $3 ORDER BY day DESC`,
    [tReq.iUserId, sFrom, sTo]
  );
  tRes.json({ days: aRows });
}));

// GET /api/activity/today
oRouter.get('/today', oAuth.requireAuth, wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'SELECT day, steps, calories_burned, source FROM activity_logs WHERE user_id = $1 AND day = $2',
    [tReq.iUserId, today()]
  );
  tRes.json({ activity: oRow || { day: today(), steps: null, calories_burned: null, source: null } });
}));

// GET /api/activity/key  -> the user's ingest key (created on first request)
oRouter.get('/key', oAuth.requireAuth, wrap(async (tReq, tRes) => {
  let oRow = await oDb.one('SELECT ingest_key FROM users WHERE id = $1', [tReq.iUserId]);
  if (!oRow.ingest_key) {
    const sKey = crypto.randomBytes(24).toString('hex');
    oRow = await oDb.one(
      'UPDATE users SET ingest_key = $1 WHERE id = $2 RETURNING ingest_key',
      [sKey, tReq.iUserId]
    );
  }
  tRes.json({ key: oRow.ingest_key });
}));

// POST /api/activity/key/rotate  -> issue a new ingest key (invalidates the old)
oRouter.post('/key/rotate', oAuth.requireAuth, wrap(async (tReq, tRes) => {
  const sKey = crypto.randomBytes(24).toString('hex');
  await oDb.query('UPDATE users SET ingest_key = $1 WHERE id = $2', [sKey, tReq.iUserId]);
  tRes.json({ key: sKey });
}));

module.exports = oRouter;
