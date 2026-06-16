'use strict';
// Programs / mesocycles with double-progression + auto-deload.
//
// Double progression: each exercise has a rep range and a working weight. When
// you hit the TOP of the range on all target sets, the weight goes up by its
// increment next time (and you start back at the bottom of the range). Until
// then the weight holds and you chase reps. The last week of the block is an
// automatic deload (lighter weight, fewer sets). Position is tracked by
// current_week / current_day_index and advances when a program workout finishes.
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

function roundTo5(f) { return Math.max(0, Math.round(f / 5) * 5); }

// --- local-date helpers for scheduling ---------------------------------------
function pad(n) { return String(n).padStart(2, '0'); }
function todayLocalIso() { const n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()); }
function toLocalDate(s) { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }
function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function addDays(s, n) { const d = toLocalDate(s); d.setDate(d.getDate() + n); return isoOf(d); }
function diffDays(a, b) { return Math.round((toLocalDate(b) - toLocalDate(a)) / 86400000); }
function weekdayOf(s) { return toLocalDate(s).getDay(); }

// Is today a workout day, a rest day, or already done — given the schedule.
async function scheduleStatus(oProgram) {
  const sType = oProgram.schedule_type || 'none';
  if (sType === 'none') return { type: 'none' };
  const sToday = todayLocalIso();
  const oLast = await oDb.one(
    "SELECT date(started_at) AS d FROM workout_sessions WHERE program_id = $1 AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1",
    [oProgram.id]
  );
  const sLast = oLast ? oLast.d : null;
  const bDoneToday = sLast === sToday;

  let bWorkoutDay = false;
  let sNext = null;
  if (sType === 'interval') {
    const iN = Math.max(1, oProgram.schedule_interval || 2);
    const sAnchor = oProgram.schedule_anchor || sToday;
    if (bDoneToday) {
      sNext = addDays(sLast, iN);
    } else {
      const sRef = sLast ? addDays(sLast, iN) : sAnchor;
      if (diffDays(sRef, sToday) >= 0) bWorkoutDay = true; // due or overdue
      else sNext = sRef;
    }
  } else if (sType === 'weekdays') {
    const aWd = String(oProgram.schedule_weekdays || '').split(',').map(Number).filter((n) => n >= 0 && n <= 6);
    if (!bDoneToday && aWd.includes(weekdayOf(sToday))) {
      bWorkoutDay = true;
    } else {
      for (let k = 1; k <= 7; k += 1) { const s = addDays(sToday, k); if (aWd.includes(weekdayOf(s))) { sNext = s; break; } }
    }
  }
  let sStatus = 'rest';
  if (bDoneToday) sStatus = 'done';
  else if (bWorkoutDay) sStatus = 'workout';
  return { type: sType, status: sStatus, doneToday: bDoneToday, nextDate: sNext };
}

// Normalize a schedule from a request body into stored fields.
function normSchedule(oSched) {
  const oS = oSched || {};
  const sType = ['interval', 'weekdays'].includes(oS.type) ? oS.type : 'none';
  if (sType === 'interval') {
    return { type: 'interval', interval: Math.min(Math.max(parseInt(oS.interval, 10) || 2, 1), 14),
      weekdays: null, anchor: todayLocalIso() };
  }
  if (sType === 'weekdays') {
    const aWd = (Array.isArray(oS.weekdays) ? oS.weekdays : [])
      .map((n) => parseInt(n, 10)).filter((n) => n >= 0 && n <= 6);
    return { type: 'weekdays', interval: null, weekdays: [...new Set(aWd)].sort().join(','), anchor: null };
  }
  return { type: 'none', interval: null, weekdays: null, anchor: null };
}

async function ownProgram(tId, tUserId) {
  return oDb.one('SELECT * FROM programs WHERE id = $1 AND user_id = $2', [tId, tUserId]);
}

// Full nested program: days -> exercises (with exercise names).
async function loadProgram(tProgramId) {
  const oProgram = await oDb.one('SELECT * FROM programs WHERE id = $1', [tProgramId]);
  if (!oProgram) return null;
  const aDays = await oDb.many(
    'SELECT * FROM program_days WHERE program_id = $1 ORDER BY order_index ASC, id ASC',
    [tProgramId]
  );
  for (const oDay of aDays) {
    oDay.exercises = await oDb.many(
      `SELECT pe.*, e.name AS exercise_name, e.muscle_group
       FROM program_exercises pe JOIN exercises e ON e.id = pe.exercise_id
       WHERE pe.program_day_id = $1 ORDER BY pe.order_index ASC, pe.id ASC`,
      [oDay.id]
    );
  }
  const bDeloadWeek = oProgram.deload_enabled && oProgram.current_week === oProgram.weeks;
  return {
    ...oProgram,
    days: aDays,
    is_deload_week: bDeloadWeek,
    next_day: aDays[oProgram.current_day_index] || aDays[0] || null,
    today: await scheduleStatus(oProgram),
  };
}

// Compute the targets for a given program exercise this week (applies deload).
function targetsFor(oPe, bDeload) {
  const fWeight = oPe.current_weight != null ? Number(oPe.current_weight) : null;
  if (bDeload) {
    return {
      sets: Math.max(1, Math.round(oPe.target_sets * 0.6)),
      repLow: oPe.rep_low,
      repHigh: oPe.rep_high,
      weight: fWeight != null ? roundTo5(fWeight * 0.9) : null,
    };
  }
  return { sets: oPe.target_sets, repLow: oPe.rep_low, repHigh: oPe.rep_high, weight: fWeight };
}

// GET /api/programs/active  -> the current active program (or null)
oRouter.get('/active', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'SELECT id FROM programs WHERE user_id = $1 AND active = 1 ORDER BY created_at DESC LIMIT 1',
    [tReq.iUserId]
  );
  tRes.json({ program: oRow ? await loadProgram(oRow.id) : null });
}));

// GET /api/programs/:id
oRouter.get('/:id', wrap(async (tReq, tRes) => {
  if (!(await ownProgram(tReq.params.id, tReq.iUserId))) throw httpError(404, 'Program not found');
  tRes.json({ program: await loadProgram(tReq.params.id) });
}));

// PUT /api/programs/:id/schedule  -> set the calendar schedule
// body: { type: 'none'|'interval'|'weekdays', interval, weekdays: [0-6] }
oRouter.put('/:id/schedule', wrap(async (tReq, tRes) => {
  if (!(await ownProgram(tReq.params.id, tReq.iUserId))) throw httpError(404, 'Program not found');
  const oS = normSchedule(tReq.body);
  await oDb.query(
    `UPDATE programs SET schedule_type = $1, schedule_weekdays = $2,
       schedule_interval = $3, schedule_anchor = $4 WHERE id = $5`,
    [oS.type, oS.weekdays, oS.interval, oS.anchor, tReq.params.id]
  );
  tRes.json({ program: await loadProgram(tReq.params.id) });
}));

// POST /api/programs  -> create a program (and make it the active one)
// body: { name, weeks, deloadEnabled, days: [ { name, exercises: [
//   { exerciseId, sets, repLow, repHigh, weight, increment, restSeconds } ] } ] }
oRouter.post('/', wrap(async (tReq, tRes) => {
  const sName = String(tReq.body.name || '').trim();
  if (!sName) throw httpError(400, 'Name your program');
  const aDays = Array.isArray(tReq.body.days) ? tReq.body.days : [];
  if (!aDays.length) throw httpError(400, 'Add at least one training day');
  const iWeeks = Math.min(Math.max(parseInt(tReq.body.weeks || '5', 10) || 5, 2), 12);
  const bDeload = tReq.body.deloadEnabled !== false;

  const oSched = normSchedule(tReq.body.schedule);
  await oDb.query('UPDATE programs SET active = 0 WHERE user_id = $1', [tReq.iUserId]);
  const oProgram = await oDb.one(
    `INSERT INTO programs (user_id, name, weeks, deload_enabled,
       schedule_type, schedule_weekdays, schedule_interval, schedule_anchor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [tReq.iUserId, sName, iWeeks, bDeload,
     oSched.type, oSched.weekdays, oSched.interval, oSched.anchor]
  );

  for (let d = 0; d < aDays.length; d += 1) {
    const oDay = aDays[d];
    const oDayRow = await oDb.one(
      'INSERT INTO program_days (program_id, order_index, name) VALUES ($1, $2, $3) RETURNING id',
      [oProgram.id, d, String(oDay.name || ('Day ' + (d + 1))).slice(0, 100)]
    );
    const aExercises = Array.isArray(oDay.exercises) ? oDay.exercises : [];
    for (let i = 0; i < aExercises.length; i += 1) {
      const oEx = aExercises[i];
      await oDb.query(
        `INSERT INTO program_exercises
           (program_day_id, exercise_id, order_index, target_sets, rep_low, rep_high, current_weight, weight_increment, rest_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [oDayRow.id, oEx.exerciseId, i,
         Math.max(1, parseInt(oEx.sets || '3', 10) || 3),
         Math.max(1, parseInt(oEx.repLow || '8', 10) || 8),
         Math.max(1, parseInt(oEx.repHigh || '12', 10) || 12),
         oEx.weight != null && oEx.weight !== '' ? Number(oEx.weight) : null,
         oEx.increment != null && oEx.increment !== '' ? Number(oEx.increment) : 5,
         oEx.restSeconds != null && oEx.restSeconds !== '' ? parseInt(oEx.restSeconds, 10) : null]
      );
    }
  }
  tRes.status(201).json({ program: await loadProgram(oProgram.id) });
}));

// POST /api/programs/:id/start-next  -> generate the next day's workout session
oRouter.post('/:id/start-next', wrap(async (tReq, tRes) => {
  const oProgram = await ownProgram(tReq.params.id, tReq.iUserId);
  if (!oProgram) throw httpError(404, 'Program not found');
  const aDays = await oDb.many(
    'SELECT * FROM program_days WHERE program_id = $1 ORDER BY order_index ASC, id ASC',
    [oProgram.id]
  );
  if (!aDays.length) throw httpError(400, 'This program has no days');
  const oDay = aDays[Math.min(oProgram.current_day_index, aDays.length - 1)];
  const bDeload = oProgram.deload_enabled && oProgram.current_week === oProgram.weeks;

  const aExercises = await oDb.many(
    'SELECT * FROM program_exercises WHERE program_day_id = $1 ORDER BY order_index ASC, id ASC',
    [oDay.id]
  );

  const sName = oDay.name + ' · Week ' + oProgram.current_week + (bDeload ? ' (deload)' : '');
  const oSession = await oDb.one(
    `INSERT INTO workout_sessions (user_id, name, program_id, program_day_id, program_week)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tReq.iUserId, sName, oProgram.id, oDay.id, oProgram.current_week]
  );
  for (let i = 0; i < aExercises.length; i += 1) {
    const oT = targetsFor(aExercises[i], bDeload);
    await oDb.query(
      `INSERT INTO session_exercises
         (session_id, exercise_id, order_index, target_sets, target_rep_low, target_rep_high, target_weight)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [oSession.id, aExercises[i].exercise_id, i, oT.sets, oT.repLow, oT.repHigh, oT.weight]
    );
  }
  tRes.status(201).json({ sessionId: oSession.id });
}));

// Run double-progression after a program workout finishes. Returns a summary.
// Exported so the sessions route can call it on /finish.
async function applyProgression(oSession) {
  const oProgram = await oDb.one('SELECT * FROM programs WHERE id = $1', [oSession.program_id]);
  if (!oProgram) return null;
  const bWasDeload = oProgram.deload_enabled && oSession.program_week === oProgram.weeks;

  const aSe = await oDb.many(
    `SELECT se.*, e.name AS exercise_name FROM session_exercises se
     JOIN exercises e ON e.id = se.exercise_id WHERE se.session_id = $1`,
    [oSession.id]
  );
  const aSummary = [];
  for (const oSe of aSe) {
    if (oSe.target_sets == null) continue;
    const oPe = await oDb.one(
      'SELECT * FROM program_exercises WHERE program_day_id = $1 AND exercise_id = $2 ORDER BY id ASC LIMIT 1',
      [oSession.program_day_id, oSe.exercise_id]
    );
    if (!oPe) continue;
    if (bWasDeload) continue; // deloads don't progress weight

    const aSets = await oDb.many(
      'SELECT weight, reps FROM exercise_sets WHERE session_exercise_id = $1 AND is_warmup = 0',
      [oSe.id]
    );
    const fTargetW = oSe.target_weight != null ? Number(oSe.target_weight)
      : (oPe.current_weight != null ? Number(oPe.current_weight) : 0);
    const iHit = aSets.filter((s) =>
      Number(s.reps) >= oSe.target_rep_high && Number(s.weight || 0) >= fTargetW).length;

    if (iHit >= oSe.target_sets) {
      const fInc = Number(oPe.weight_increment) || 5;
      const fNew = (oPe.current_weight != null ? Number(oPe.current_weight) : fTargetW) + fInc;
      await oDb.query('UPDATE program_exercises SET current_weight = $1 WHERE id = $2', [fNew, oPe.id]);
      aSummary.push({ exercise: oSe.exercise_name, action: 'up', weight: fNew, delta: fInc });
    } else {
      aSummary.push({ exercise: oSe.exercise_name, action: 'hold',
        weight: oPe.current_weight != null ? Number(oPe.current_weight) : fTargetW });
    }
  }

  // advance position: next day; wrap -> next week; past last week -> new block
  const iDayCount = (await oDb.one(
    'SELECT COUNT(*) AS n FROM program_days WHERE program_id = $1', [oProgram.id])).n;
  let iNextDay = oProgram.current_day_index + 1;
  let iNextWeek = oProgram.current_week;
  let bNewBlock = false;
  if (iNextDay >= iDayCount) { iNextDay = 0; iNextWeek += 1; }
  if (iNextWeek > oProgram.weeks) { iNextWeek = 1; bNewBlock = true; }
  await oDb.query(
    'UPDATE programs SET current_day_index = $1, current_week = $2 WHERE id = $3',
    [iNextDay, iNextWeek, oProgram.id]
  );

  return { summary: aSummary, wasDeload: bWasDeload, newBlock: bNewBlock, nextWeek: iNextWeek };
}

// POST /api/programs/:id/restart  -> begin a fresh block (week 1), keep weights
oRouter.post('/:id/restart', wrap(async (tReq, tRes) => {
  if (!(await ownProgram(tReq.params.id, tReq.iUserId))) throw httpError(404, 'Program not found');
  await oDb.query('UPDATE programs SET active = 0 WHERE user_id = $1', [tReq.iUserId]);
  await oDb.query(
    'UPDATE programs SET active = 1, current_week = 1, current_day_index = 0 WHERE id = $1',
    [tReq.params.id]
  );
  tRes.json({ program: await loadProgram(tReq.params.id) });
}));

// DELETE /api/programs/:id
oRouter.delete('/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one('DELETE FROM programs WHERE id = $1 AND user_id = $2 RETURNING id',
    [tReq.params.id, tReq.iUserId]);
  if (!oRow) throw httpError(404, 'Program not found');
  tRes.json({ ok: true });
}));

module.exports = oRouter;
module.exports.applyProgression = applyProgression;
