'use strict';
// Importer for Strong (strong.app) CSV exports.
//
// Strong exports one row per set with columns:
//   Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps,
//   Distance, Seconds, Notes, Workout Notes, RPE
//
// Rows sharing a Date are one workout; within that, rows sharing an Exercise
// Name are one exercise; each row is a set. "Rest Timer" rows are not sets —
// their Seconds is the rest taken after the previous set. Set Order "W" marks a
// warm-up; numbers / "F" (failure) are working sets. Cardio rows (e.g. Running)
// carry Distance/Seconds instead of weight×reps and are kept as notes.
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);
// CSV comes in as a raw text body (exports can be ~1MB+).
oRouter.use(express.text({ type: '*/*', limit: '15mb' }));

// --- tiny CSV parser (handles quoted fields, "" escapes, CRLF) ---------------
function parseCsv(sText) {
  const aRows = [];
  let aRow = [];
  let sField = '';
  let isQuoted = false;
  const s = sText.charCodeAt(0) === 0xfeff ? sText.slice(1) : sText; // strip BOM
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (isQuoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { sField += '"'; i += 1; }
        else isQuoted = false;
      } else sField += c;
    } else if (c === '"') {
      isQuoted = true;
    } else if (c === ',') {
      aRow.push(sField); sField = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      aRow.push(sField); sField = '';
      if (aRow.length > 1 || aRow[0] !== '') aRows.push(aRow);
      aRow = [];
    } else sField += c;
  }
  if (sField !== '' || aRow.length) { aRow.push(sField); aRows.push(aRow); }
  return aRows;
}

// "1h 3m", "26m", "22s", "1h" -> seconds (null if unparseable / absurd)
function parseDuration(sText) {
  if (!sText) return null;
  let iSec = 0;
  let bMatched = false;
  const oRe = /(\d+)\s*(h|m|s)/g;
  let oMatch;
  while ((oMatch = oRe.exec(sText)) !== null) {
    bMatched = true;
    const iVal = parseInt(oMatch[1], 10);
    if (oMatch[2] === 'h') iSec += iVal * 3600;
    else if (oMatch[2] === 'm') iSec += iVal * 60;
    else iSec += iVal;
  }
  if (!bMatched) return null;
  // Strong occasionally exports a bogus multi-day duration; drop those.
  if (iSec > 86400) return null;
  return iSec;
}

function fmtClock(iSeconds) {
  const iMin = Math.floor(iSeconds / 60);
  const iSec = Math.round(iSeconds % 60);
  return iMin + ':' + String(iSec).padStart(2, '0');
}

function toNum(sText) {
  const f = parseFloat(sText);
  return Number.isFinite(f) ? f : 0;
}

// Infer equipment from a trailing "(Barbell)" / "(Cable)" etc.
function inferEquipment(sName) {
  const oMatch = sName.match(/\(([^)]+)\)\s*$/);
  if (!oMatch) return null;
  const s = oMatch[1].toLowerCase();
  if (s.includes('barbell')) return 'barbell';
  if (s.includes('dumbbell')) return 'dumbbell';
  if (s.includes('cable')) return 'cable';
  if (s.includes('machine')) return 'machine';
  if (s.includes('bodyweight') || s.includes('assisted')) return 'bodyweight';
  return null;
}

// POST /api/import/strong  -> import a Strong CSV for the current user.
oRouter.post('/strong', wrap(async (tReq, tRes) => {
  const sCsv = typeof tReq.body === 'string' ? tReq.body : '';
  if (!sCsv.trim()) throw httpError(400, 'No CSV data received');

  const aRows = parseCsv(sCsv);
  if (aRows.length < 2) throw httpError(400, 'CSV looks empty');

  const aHeader = aRows[0].map((s) => s.trim().toLowerCase());
  const col = (sName) => aHeader.indexOf(sName);
  const iDate = col('date');
  const iName = col('workout name');
  const iDur = col('duration');
  const iExercise = col('exercise name');
  const iOrder = col('set order');
  const iWeight = col('weight');
  const iReps = col('reps');
  const iDistance = col('distance');
  const iSeconds = col('seconds');
  const iNotes = col('notes');
  const iWorkoutNotes = col('workout notes');
  if (iDate < 0 || iExercise < 0 || iOrder < 0) {
    throw httpError(400, "This doesn't look like a Strong export (missing expected columns).");
  }

  // Group rows -> sessions (by Date) -> exercises (by name) -> sets.
  const oSessions = new Map();
  for (let r = 1; r < aRows.length; r += 1) {
    const aRow = aRows[r];
    const sDate = (aRow[iDate] || '').trim();
    if (!sDate) continue;
    const sExercise = (aRow[iExercise] || '').trim();
    if (!sExercise) continue;

    if (!oSessions.has(sDate)) {
      oSessions.set(sDate, {
        date: sDate,
        name: (aRow[iName] || '').trim() || 'Workout',
        duration: parseDuration(aRow[iDur]),
        notes: iWorkoutNotes >= 0 ? (aRow[iWorkoutNotes] || '').trim() : '',
        exercises: new Map(),
      });
    }
    const oSession = oSessions.get(sDate);
    if (!oSession.exercises.has(sExercise)) oSession.exercises.set(sExercise, []);
    const aSets = oSession.exercises.get(sExercise);

    const sSetOrder = (aRow[iOrder] || '').trim();
    const fDistance = iDistance >= 0 ? toNum(aRow[iDistance]) : 0;
    const fSeconds = iSeconds >= 0 ? toNum(aRow[iSeconds]) : 0;

    // Rest Timer rows annotate the previous set's rest, they aren't sets.
    if (sSetOrder.toLowerCase() === 'rest timer') {
      if (aSets.length && fSeconds > 0) aSets[aSets.length - 1].rest = Math.round(fSeconds);
      continue;
    }

    const fWeight = iWeight >= 0 ? toNum(aRow[iWeight]) : 0;
    const fReps = iReps >= 0 ? toNum(aRow[iReps]) : 0;
    const isCardio = fDistance > 0 || (fSeconds > 0 && fReps === 0);
    const aNoteBits = [];
    if (iNotes >= 0 && (aRow[iNotes] || '').trim()) aNoteBits.push((aRow[iNotes]).trim());
    if (isCardio) {
      if (fDistance > 0) aNoteBits.push(fDistance.toFixed(2) + ' dist');
      if (fSeconds > 0) aNoteBits.push(fmtClock(fSeconds));
    }

    aSets.push({
      isWarmup: sSetOrder.toLowerCase() === 'w',
      weight: isCardio ? null : fWeight,
      reps: isCardio ? null : Math.round(fReps),
      rest: null,
      notes: aNoteBits.join(' · ') || null,
    });
  }

  // --- write everything in one transaction ----------------------------------
  const oClient = await oDb.oPool.connect();
  const oExerciseCache = new Map(); // lower(name) -> exercise id
  let iSessionsAdded = 0;
  let iSessionsSkipped = 0;
  let iSetsAdded = 0;
  const oNewExercises = new Set();

  async function resolveExercise(sExerciseName) {
    const sKey = sExerciseName.toLowerCase();
    if (oExerciseCache.has(sKey)) return oExerciseCache.get(sKey);
    const oFound = await oClient.query(
      `SELECT id FROM exercises
       WHERE lower(name) = $1 AND (created_by IS NULL OR created_by = $2)
       ORDER BY created_by NULLS FIRST LIMIT 1`,
      [sKey, tReq.iUserId]
    );
    let iId;
    if (oFound.rows[0]) {
      iId = oFound.rows[0].id;
    } else {
      const oNew = await oClient.query(
        `INSERT INTO exercises (name, equipment, is_custom, created_by)
         VALUES ($1, $2, 1, $3) RETURNING id`,
        [sExerciseName, inferEquipment(sExerciseName), tReq.iUserId]
      );
      iId = oNew.rows[0].id;
      oNewExercises.add(sKey);
    }
    oExerciseCache.set(sKey, iId);
    return iId;
  }

  try {
    await oClient.query('BEGIN');
    for (const oSession of oSessions.values()) {
      // Skip if a workout already exists at this exact start (re-import safe).
      const oExisting = await oClient.query(
        'SELECT id FROM workout_sessions WHERE user_id = $1 AND started_at = $2',
        [tReq.iUserId, oSession.date]
      );
      if (oExisting.rows[0]) { iSessionsSkipped += 1; continue; }

      const sEndedAt = oSession.duration != null
        ? new Date(new Date(oSession.date).getTime() + oSession.duration * 1000).toISOString()
        : null;
      const oSessionRow = await oClient.query(
        `INSERT INTO workout_sessions (user_id, name, started_at, ended_at, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tReq.iUserId, oSession.name, oSession.date, sEndedAt, oSession.notes || null]
      );
      const iSessionId = oSessionRow.rows[0].id;

      let iOrderIndex = 0;
      for (const [sExerciseName, aSets] of oSession.exercises) {
        const iExerciseId = await resolveExercise(sExerciseName);
        const oSeRow = await oClient.query(
          `INSERT INTO session_exercises (session_id, exercise_id, order_index)
           VALUES ($1, $2, $3) RETURNING id`,
          [iSessionId, iExerciseId, iOrderIndex]
        );
        const iSeId = oSeRow.rows[0].id;
        iOrderIndex += 1;

        let iSetNumber = 0;
        for (const oSet of aSets) {
          const iNum = oSet.isWarmup ? 0 : (iSetNumber += 1);
          await oClient.query(
            `INSERT INTO exercise_sets
               (session_exercise_id, set_number, weight, reps, rest_seconds, is_warmup, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [iSeId, iNum, oSet.weight, oSet.reps, oSet.rest, oSet.isWarmup, oSet.notes]
          );
          iSetsAdded += 1;
        }
      }
      iSessionsAdded += 1;
    }
    await oClient.query('COMMIT');
  } catch (tErr) {
    await oClient.query('ROLLBACK');
    throw tErr;
  } finally {
    oClient.release();
  }

  tRes.json({
    ok: true,
    workoutsImported: iSessionsAdded,
    workoutsSkipped: iSessionsSkipped,
    setsImported: iSetsAdded,
    newExercises: oNewExercises.size,
  });
}));

module.exports = oRouter;
