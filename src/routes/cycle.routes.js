'use strict';
// Menstrual cycle tracking. One row per logged day; period starts and
// predictions (next period, fertile window, ovulation) are DERIVED from the
// logged bleed days rather than stored, so editing history re-predicts cleanly.
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

const FLOWS = ['spotting', 'light', 'medium', 'heavy'];
const sDateRe = /^\d{4}-\d{2}-\d{2}$/;

// --- date-only helpers (UTC math, no timezone drift) -------------------------
function toDate(s) { const a = s.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); }
function toIso(dt) { return dt.toISOString().slice(0, 10); }
function addDays(s, n) { const dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return toIso(dt); }
function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function todayLocalIso() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}
function mean(aNums) { return aNums.length ? aNums.reduce((s, n) => s + n, 0) / aNums.length : 0; }

// Derive cycle statistics + predictions from the logged days.
function computeStats(aLogs) {
  const sToday = todayLocalIso();
  const oBleed = new Set(aLogs.filter((r) => r.flow).map((r) => r.date));
  const aBleedDates = [...oBleed].sort();

  // period starts = a bleed day whose previous calendar day was dry
  const aStarts = aBleedDates.filter((d) => !oBleed.has(addDays(d, -1)));

  // cycle lengths between consecutive starts (drop implausible values)
  const aCycle = [];
  for (let i = 1; i < aStarts.length; i += 1) {
    const iLen = diffDays(aStarts[i - 1], aStarts[i]);
    if (iLen >= 15 && iLen <= 60) aCycle.push(iLen);
  }
  // period lengths = run of consecutive bleed days from each start
  const aPeriod = aStarts.map((sStart) => {
    let iLen = 1; while (oBleed.has(addDays(sStart, iLen))) iLen += 1; return iLen;
  });

  const iAvgCycle = aCycle.length ? Math.round(mean(aCycle)) : 28;
  const iAvgPeriod = aPeriod.length ? Math.round(mean(aPeriod)) : 5;
  const sLastStart = aStarts.length ? aStarts[aStarts.length - 1] : null;
  const bHasData = aStarts.length > 0;

  let sPredNext = null, sOvulation = null, sFertileStart = null, sFertileEnd = null, iCycleDay = null, sPhase = null;
  if (sLastStart) {
    iCycleDay = diffDays(sLastStart, sToday) + 1;
    if (iCycleDay < 1) iCycleDay = null;
    sPredNext = addDays(sLastStart, iAvgCycle);
    sOvulation = addDays(sPredNext, -14);
    sFertileStart = addDays(sOvulation, -5);
    sFertileEnd = addDays(sOvulation, 1);

    if (oBleed.has(sToday)) sPhase = 'menstrual';
    else if (iCycleDay != null && iCycleDay <= iAvgPeriod) sPhase = 'menstrual';
    else if (sToday === sOvulation) sPhase = 'ovulation';
    else if (sToday >= sFertileStart && sToday <= sFertileEnd) sPhase = 'fertile';
    else if (sToday < sOvulation) sPhase = 'follicular';
    else sPhase = 'luteal';
  }

  return {
    hasData: bHasData,
    avgCycle: iAvgCycle, avgPeriod: iAvgPeriod,
    lastStart: sLastStart, cycleDay: iCycleDay, phase: sPhase,
    predictedNext: sPredNext, ovulation: sOvulation,
    fertileStart: sFertileStart, fertileEnd: sFertileEnd,
  };
}

// Load all of a user's cycle days (used by every response).
async function loadLogs(tUserId) {
  return oDb.many(
    `SELECT strftime('%Y-%m-%d', date) AS date, flow, symptoms, mood, notes
     FROM cycle_logs WHERE user_id = $1 ORDER BY date ASC`,
    [tUserId]
  );
}

// GET /api/cycle  -> all logs + derived stats
oRouter.get('/', wrap(async (tReq, tRes) => {
  const aLogs = await loadLogs(tReq.iUserId);
  tRes.json({ logs: aLogs, stats: computeStats(aLogs) });
}));

// POST /api/cycle/range  body: { start, end, flow } -> mark every day in the
// range as a bleed day in one shot. Consecutive days then read as one period.
oRouter.post('/range', wrap(async (tReq, tRes) => {
  const sStart = String(tReq.body.start || '');
  const sEnd = String(tReq.body.end || '');
  if (!sDateRe.test(sStart) || !sDateRe.test(sEnd)) throw httpError(400, 'Pick a start and end date');
  if (sEnd < sStart) throw httpError(400, 'End date is before the start date');
  const sFlow = FLOWS.includes(tReq.body.flow) ? tReq.body.flow : 'medium';
  const iLen = diffDays(sStart, sEnd) + 1;
  if (iLen > 21) throw httpError(400, 'That period range looks too long (max 21 days)');

  let sDay = sStart;
  for (let i = 0; i < iLen; i += 1) {
    // only touch flow, so any existing symptoms/notes on a day are preserved
    await oDb.query(
      `INSERT INTO cycle_logs (user_id, date, flow) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET flow = $3`,
      [tReq.iUserId, sDay, sFlow]
    );
    sDay = addDays(sDay, 1);
  }
  const aLogs = await loadLogs(tReq.iUserId);
  tRes.json({ logs: aLogs, stats: computeStats(aLogs) });
}));

// PUT /api/cycle/:date  -> upsert a day; clearing all fields deletes the row
oRouter.put('/:date', wrap(async (tReq, tRes) => {
  const sDate = String(tReq.params.date);
  if (!sDateRe.test(sDate)) throw httpError(400, 'Bad date');

  const sFlow = FLOWS.includes(tReq.body.flow) ? tReq.body.flow : null;
  const aSym = Array.isArray(tReq.body.symptoms) ? tReq.body.symptoms : [];
  const sSymptoms = aSym.map((s) => String(s).trim()).filter(Boolean).join(',') || null;
  const sMood = tReq.body.mood ? String(tReq.body.mood).slice(0, 20) : null;
  const sNotes = tReq.body.notes ? String(tReq.body.notes).trim().slice(0, 500) : null;

  if (!sFlow && !sSymptoms && !sMood && !sNotes) {
    await oDb.query('DELETE FROM cycle_logs WHERE user_id = $1 AND date = $2', [tReq.iUserId, sDate]);
  } else {
    await oDb.query(
      `INSERT INTO cycle_logs (user_id, date, flow, symptoms, mood, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, date) DO UPDATE
         SET flow = $3, symptoms = $4, mood = $5, notes = $6`,
      [tReq.iUserId, sDate, sFlow, sSymptoms, sMood, sNotes]
    );
  }
  const aLogs = await loadLogs(tReq.iUserId);
  tRes.json({ logs: aLogs, stats: computeStats(aLogs) });
}));

module.exports = oRouter;
