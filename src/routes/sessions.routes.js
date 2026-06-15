'use strict';
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

// --- ownership guards ---------------------------------------------------------
async function ownSession(tSessionId, tUserId) {
  return oDb.one(
    'SELECT * FROM workout_sessions WHERE id = $1 AND user_id = $2',
    [tSessionId, tUserId]
  );
}
async function ownSessionExercise(tSeId, tUserId) {
  return oDb.one(
    `SELECT se.* FROM session_exercises se
     JOIN workout_sessions s ON s.id = se.session_id
     WHERE se.id = $1 AND s.user_id = $2`,
    [tSeId, tUserId]
  );
}
async function ownSet(tSetId, tUserId) {
  return oDb.one(
    `SELECT st.* FROM exercise_sets st
     JOIN session_exercises se ON se.id = st.session_exercise_id
     JOIN workout_sessions s ON s.id = se.session_id
     WHERE st.id = $1 AND s.user_id = $2`,
    [tSetId, tUserId]
  );
}

// Build the full nested session payload.
async function loadSession(tSessionId) {
  const oSession = await oDb.one('SELECT * FROM workout_sessions WHERE id = $1', [tSessionId]);
  if (!oSession) return null;
  const oExercises = await oDb.many(
    `SELECT se.id, se.exercise_id, se.order_index, se.notes,
            se.target_sets, se.target_rep_low, se.target_rep_high, se.target_weight,
            e.name AS exercise_name, e.muscle_group, e.equipment, e.category
     FROM session_exercises se
     JOIN exercises e ON e.id = se.exercise_id
     WHERE se.session_id = $1
     ORDER BY se.order_index ASC, se.id ASC`,
    [tSessionId]
  );
  for (const oExercise of oExercises) {
    oExercise.sets = await oDb.many(
      `SELECT id, set_number, weight, reps, rest_seconds, rpe, is_completed, is_warmup, notes
       FROM exercise_sets WHERE session_exercise_id = $1 ORDER BY set_number ASC, id ASC`,
      [oExercise.id]
    );
  }
  return { ...oSession, exercises: oExercises };
}

// GET /api/sessions  -> recent sessions with summary stats
oRouter.get('/', wrap(async (tReq, tRes) => {
  const iLimit = Math.min(parseInt(tReq.query.limit || '50', 10), 200);
  const oSessions = await oDb.many(
    `SELECT s.*,
            COUNT(DISTINCT se.id)::int AS exercise_count,
            COUNT(st.id)::int AS set_count,
            COALESCE(SUM(st.weight * st.reps), 0)::numeric AS total_volume
     FROM workout_sessions s
     LEFT JOIN session_exercises se ON se.session_id = s.id
     LEFT JOIN exercise_sets st ON st.session_exercise_id = se.id AND st.is_warmup = false
     WHERE s.user_id = $1
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT $2`,
    [tReq.iUserId, iLimit]
  );
  tRes.json({ sessions: oSessions });
}));

// GET /api/sessions/calendar?month=YYYY-MM  -> sessions in a month, for the
// workout calendar. Lightweight: just id, name and timestamps.
oRouter.get('/calendar', wrap(async (tReq, tRes) => {
  const sMonth = /^\d{4}-\d{2}$/.test(String(tReq.query.month || ''))
    ? tReq.query.month : new Date().toISOString().slice(0, 7);
  const oRows = await oDb.many(
    `SELECT id, name, started_at, ended_at FROM workout_sessions
     WHERE user_id = $1
       AND started_at >= ($2 || '-01')::date
       AND started_at <  (($2 || '-01')::date + interval '1 month')
     ORDER BY started_at ASC`,
    [tReq.iUserId, sMonth]
  );
  tRes.json({ month: sMonth, sessions: oRows });
}));

// GET /api/sessions/:id
oRouter.get('/:id', wrap(async (tReq, tRes) => {
  if (!(await ownSession(tReq.params.id, tReq.iUserId))) throw httpError(404, 'Workout not found');
  tRes.json({ session: await loadSession(tReq.params.id) });
}));

// POST /api/sessions  -> start a workout, optionally seeded from a template
oRouter.post('/', wrap(async (tReq, tRes) => {
  const iTemplateId = tReq.body.templateId || null;
  let sName = String(tReq.body.name || '').trim() || null;

  if (iTemplateId) {
    const oTemplate = await oDb.one(
      'SELECT * FROM workout_templates WHERE id = $1 AND user_id = $2',
      [iTemplateId, tReq.iUserId]
    );
    if (!oTemplate) throw httpError(404, 'Template not found');
    if (!sName) sName = oTemplate.name;
  }

  const oSession = await oDb.one(
    'INSERT INTO workout_sessions (user_id, template_id, name) VALUES ($1, $2, $3) RETURNING *',
    [tReq.iUserId, iTemplateId, sName]
  );

  if (iTemplateId) {
    const oTplExercises = await oDb.many(
      'SELECT * FROM template_exercises WHERE template_id = $1 ORDER BY order_index ASC, id ASC',
      [iTemplateId]
    );
    for (let i = 0; i < oTplExercises.length; i += 1) {
      await oDb.query(
        'INSERT INTO session_exercises (session_id, exercise_id, order_index) VALUES ($1, $2, $3)',
        [oSession.id, oTplExercises[i].exercise_id, i]
      );
    }
  }
  tRes.status(201).json({ session: await loadSession(oSession.id) });
}));

// PUT /api/sessions/:id  -> rename / notes / set ended_at
oRouter.put('/:id', wrap(async (tReq, tRes) => {
  if (!(await ownSession(tReq.params.id, tReq.iUserId))) throw httpError(404, 'Workout not found');
  await oDb.query(
    `UPDATE workout_sessions
     SET name = COALESCE($1, name),
         notes = COALESCE($2, notes),
         ended_at = COALESCE($3, ended_at)
     WHERE id = $4`,
    [
      tReq.body.name != null ? String(tReq.body.name).trim() : null,
      tReq.body.notes != null ? tReq.body.notes : null,
      tReq.body.endedAt || null,
      tReq.params.id,
    ]
  );
  tRes.json({ session: await loadSession(tReq.params.id) });
}));

// POST /api/sessions/:id/finish
oRouter.post('/:id/finish', wrap(async (tReq, tRes) => {
  const oSession = await ownSession(tReq.params.id, tReq.iUserId);
  if (!oSession) throw httpError(404, 'Workout not found');
  const bWasEnded = !!oSession.ended_at;
  await oDb.query('UPDATE workout_sessions SET ended_at = now() WHERE id = $1', [tReq.params.id]);

  // Run program progression once, only on the first finish of a program workout.
  let oProgression = null;
  if (!bWasEnded && oSession.program_id) {
    const { applyProgression } = require('./programs.routes');
    oProgression = await applyProgression(oSession);
  }
  tRes.json({ session: await loadSession(tReq.params.id), progression: oProgression });
}));

// DELETE /api/sessions/:id
oRouter.delete('/:id', wrap(async (tReq, tRes) => {
  if (!(await ownSession(tReq.params.id, tReq.iUserId))) throw httpError(404, 'Workout not found');
  await oDb.query('DELETE FROM workout_sessions WHERE id = $1', [tReq.params.id]);
  tRes.json({ ok: true });
}));

// POST /api/sessions/:id/exercises  -> add an exercise to a live session
oRouter.post('/:id/exercises', wrap(async (tReq, tRes) => {
  if (!(await ownSession(tReq.params.id, tReq.iUserId))) throw httpError(404, 'Workout not found');
  const oNext = await oDb.one(
    'SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM session_exercises WHERE session_id = $1',
    [tReq.params.id]
  );
  const oRow = await oDb.one(
    'INSERT INTO session_exercises (session_id, exercise_id, order_index) VALUES ($1, $2, $3) RETURNING *',
    [tReq.params.id, tReq.body.exerciseId, oNext.next]
  );
  tRes.status(201).json({ sessionExercise: oRow });
}));

// PUT /api/sessions/exercises/:seId  -> set the per-workout note on an exercise
oRouter.put('/exercises/:seId', wrap(async (tReq, tRes) => {
  if (!(await ownSessionExercise(tReq.params.seId, tReq.iUserId))) throw httpError(404, 'Not found');
  const sNotes = tReq.body.notes != null ? String(tReq.body.notes).trim() : '';
  const oRow = await oDb.one(
    'UPDATE session_exercises SET notes = $1 WHERE id = $2 RETURNING *',
    [sNotes || null, tReq.params.seId]
  );
  tRes.json({ sessionExercise: oRow });
}));

// DELETE /api/sessions/exercises/:seId
oRouter.delete('/exercises/:seId', wrap(async (tReq, tRes) => {
  if (!(await ownSessionExercise(tReq.params.seId, tReq.iUserId))) throw httpError(404, 'Not found');
  await oDb.query('DELETE FROM session_exercises WHERE id = $1', [tReq.params.seId]);
  tRes.json({ ok: true });
}));

// POST /api/sessions/exercises/:seId/sets  -> log a set
oRouter.post('/exercises/:seId/sets', wrap(async (tReq, tRes) => {
  if (!(await ownSessionExercise(tReq.params.seId, tReq.iUserId))) throw httpError(404, 'Not found');
  const oNext = await oDb.one(
    'SELECT COALESCE(MAX(set_number) + 1, 1) AS next FROM exercise_sets WHERE session_exercise_id = $1',
    [tReq.params.seId]
  );
  const oSet = await oDb.one(
    `INSERT INTO exercise_sets
       (session_exercise_id, set_number, weight, reps, rest_seconds, rpe, is_completed, is_warmup, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      tReq.params.seId,
      oNext.next,
      tReq.body.weight ?? null,
      tReq.body.reps ?? null,
      tReq.body.restSeconds ?? null,
      tReq.body.rpe ?? null,
      tReq.body.isCompleted ?? true,
      tReq.body.isWarmup ?? false,
      tReq.body.notes || null,
    ]
  );
  tRes.status(201).json({ set: oSet });
}));

// PUT /api/sessions/sets/:setId
oRouter.put('/sets/:setId', wrap(async (tReq, tRes) => {
  if (!(await ownSet(tReq.params.setId, tReq.iUserId))) throw httpError(404, 'Set not found');
  const oSet = await oDb.one(
    `UPDATE exercise_sets SET
       weight = $1, reps = $2, rest_seconds = $3, rpe = $4,
       is_completed = $5, is_warmup = $6, notes = $7
     WHERE id = $8 RETURNING *`,
    [
      tReq.body.weight ?? null,
      tReq.body.reps ?? null,
      tReq.body.restSeconds ?? null,
      tReq.body.rpe ?? null,
      tReq.body.isCompleted ?? true,
      tReq.body.isWarmup ?? false,
      tReq.body.notes || null,
      tReq.params.setId,
    ]
  );
  tRes.json({ set: oSet });
}));

// DELETE /api/sessions/sets/:setId
oRouter.delete('/sets/:setId', wrap(async (tReq, tRes) => {
  if (!(await ownSet(tReq.params.setId, tReq.iUserId))) throw httpError(404, 'Set not found');
  await oDb.query('DELETE FROM exercise_sets WHERE id = $1', [tReq.params.setId]);
  tRes.json({ ok: true });
}));

module.exports = oRouter;
