'use strict';
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');
const { saveUpload, removeUpload } = require('../upload');

const MAX_VIDEO = 250 * 1024 * 1024; // 250 MB per set clip
const SET_TYPES = ['normal', 'warmup', 'myo', 'drop'];

// Resolve a set's type from an explicit setType, falling back to legacy isWarmup.
function normSetType(tSetType, tIsWarmup) {
  if (SET_TYPES.includes(tSetType)) return tSetType;
  return tIsWarmup ? 'warmup' : 'normal';
}

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
    `SELECT se.id, se.exercise_id, se.order_index, se.notes, se.superset_group,
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
      `SELECT id, set_number, weight, reps, rest_seconds, rpe, is_completed, is_warmup, set_type, notes, performed_at
       FROM exercise_sets WHERE session_exercise_id = $1 ORDER BY set_number ASC, id ASC`,
      [oExercise.id]
    );
    const aMedia = await oDb.many(
      'SELECT id, file_path, mime FROM exercise_media WHERE session_exercise_id = $1 ORDER BY id ASC',
      [oExercise.id]
    );
    oExercise.media = aMedia.map((m) => ({ id: m.id, mime: m.mime, url: '/uploads/' + m.file_path }));
  }
  return { ...oSession, exercises: oExercises };
}

// GET /api/sessions  -> recent sessions with summary stats
oRouter.get('/', wrap(async (tReq, tRes) => {
  const iLimit = Math.min(parseInt(tReq.query.limit || '50', 10), 200);
  const oSessions = await oDb.many(
    `SELECT s.*,
            COUNT(DISTINCT se.id) AS exercise_count,
            COUNT(st.id) AS set_count,
            COALESCE(SUM(st.weight * st.reps), 0) AS total_volume
     FROM workout_sessions s
     LEFT JOIN session_exercises se ON se.session_id = s.id
     LEFT JOIN exercise_sets st ON st.session_exercise_id = se.id AND st.is_warmup = 0
     WHERE s.user_id = $1
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT $2`,
    [tReq.iUserId, iLimit]
  );
  tRes.json({ sessions: oSessions });
}));

// GET /api/sessions/calendar?month=YYYY-MM  -> sessions in a month, for the
// workout calendar. Includes a light synopsis (counts, volume, exercise names)
// so the calendar can show a hover preview without opening each workout.
oRouter.get('/calendar', wrap(async (tReq, tRes) => {
  const sMonth = /^\d{4}-\d{2}$/.test(String(tReq.query.month || ''))
    ? tReq.query.month : new Date().toISOString().slice(0, 7);
  const oRows = await oDb.many(
    `SELECT s.id, s.name, s.started_at, s.ended_at,
            COUNT(DISTINCT se.id) AS exercise_count,
            COUNT(st.id) AS set_count,
            COALESCE(SUM(st.weight * st.reps), 0) AS total_volume,
            (SELECT group_concat(nm, '|') FROM (
               SELECT e.name AS nm FROM session_exercises se2
               JOIN exercises e ON e.id = se2.exercise_id
               WHERE se2.session_id = s.id
               ORDER BY se2.order_index ASC, se2.id ASC)) AS exercises
     FROM workout_sessions s
     LEFT JOIN session_exercises se ON se.session_id = s.id
     LEFT JOIN exercise_sets st ON st.session_exercise_id = se.id AND st.is_warmup = 0
     WHERE s.user_id = $1
       AND date(s.started_at) >= date($2 || '-01')
       AND date(s.started_at) <  date($2 || '-01', '+1 month')
     GROUP BY s.id
     ORDER BY s.started_at ASC`,
    [tReq.iUserId, sMonth]
  );
  for (const oRow of oRows) {
    oRow.exercises = oRow.exercises ? String(oRow.exercises).split('|') : [];
  }
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
  await oDb.query("UPDATE workout_sessions SET ended_at = datetime('now','localtime') WHERE id = $1", [tReq.params.id]);

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

// PUT /api/sessions/exercises/:seId/superset  -> link/unlink as a superset
// body: { withSeId } to group with another exercise, or { unlink: true }
oRouter.put('/exercises/:seId/superset', wrap(async (tReq, tRes) => {
  const oSe = await ownSessionExercise(tReq.params.seId, tReq.iUserId);
  if (!oSe) throw httpError(404, 'Not found');

  if (tReq.body.unlink) {
    await oDb.query('UPDATE session_exercises SET superset_group = NULL WHERE id = $1', [oSe.id]);
    return tRes.json({ ok: true });
  }

  const oOther = await ownSessionExercise(tReq.body.withSeId, tReq.iUserId);
  if (!oOther) throw httpError(404, 'Other exercise not found');
  if (oOther.session_id !== oSe.session_id) throw httpError(400, 'Exercises are in different workouts');
  if (oOther.id === oSe.id) throw httpError(400, 'Cannot superset an exercise with itself');

  // reuse an existing group if either side already has one, else start a new one
  const iGroup = oSe.superset_group || oOther.superset_group || oSe.id;
  await oDb.query('UPDATE session_exercises SET superset_group = $1 WHERE id = $2 OR id = $3',
    [iGroup, oSe.id, oOther.id]);
  return tRes.json({ ok: true });
}));

// POST /api/sessions/exercises/:seId/media  -> attach a set video (raw body)
oRouter.post('/exercises/:seId/media', wrap(async (tReq, tRes) => {
  if (!(await ownSessionExercise(tReq.params.seId, tReq.iUserId))) throw httpError(404, 'Not found');
  const oSaved = await saveUpload(tReq, 'exercise', ['video/', 'image/'], MAX_VIDEO);
  const oRow = await oDb.one(
    `INSERT INTO exercise_media (session_exercise_id, file_path, mime)
     VALUES ($1, $2, $3) RETURNING id, file_path, mime`,
    [tReq.params.seId, oSaved.relPath, oSaved.mime]
  );
  tRes.status(201).json({ media: { id: oRow.id, mime: oRow.mime, url: '/uploads/' + oRow.file_path } });
}));

// PUT /api/sessions/media/:mediaId/move  -> reassign a clip to another exercise
// (e.g. you filmed it on the wrong exercise). body: { toSeId }
oRouter.put('/media/:mediaId/move', wrap(async (tReq, tRes) => {
  const oMedia = await oDb.one(
    `SELECT em.id, se.session_id FROM exercise_media em
     JOIN session_exercises se ON se.id = em.session_exercise_id
     JOIN workout_sessions s ON s.id = se.session_id
     WHERE em.id = $1 AND s.user_id = $2`,
    [tReq.params.mediaId, tReq.iUserId]
  );
  if (!oMedia) throw httpError(404, 'Clip not found');
  const oTarget = await ownSessionExercise(tReq.body.toSeId, tReq.iUserId);
  if (!oTarget) throw httpError(404, 'Target exercise not found');
  if (oTarget.session_id !== oMedia.session_id) throw httpError(400, 'Pick an exercise in this workout');
  await oDb.query('UPDATE exercise_media SET session_exercise_id = $1 WHERE id = $2',
    [oTarget.id, oMedia.id]);
  tRes.json({ ok: true });
}));

// DELETE /api/sessions/media/:mediaId
oRouter.delete('/media/:mediaId', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    `SELECT em.id, em.file_path FROM exercise_media em
     JOIN session_exercises se ON se.id = em.session_exercise_id
     JOIN workout_sessions s ON s.id = se.session_id
     WHERE em.id = $1 AND s.user_id = $2`,
    [tReq.params.mediaId, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Not found');
  await oDb.query('DELETE FROM exercise_media WHERE id = $1', [oRow.id]);
  removeUpload(oRow.file_path);
  tRes.json({ ok: true });
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
  const sType = normSetType(tReq.body.setType, tReq.body.isWarmup);
  const oSet = await oDb.one(
    `INSERT INTO exercise_sets
       (session_exercise_id, set_number, weight, reps, rest_seconds, rpe, is_completed, is_warmup, set_type, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      tReq.params.seId,
      oNext.next,
      tReq.body.weight ?? null,
      tReq.body.reps ?? null,
      tReq.body.restSeconds ?? null,
      tReq.body.rpe ?? null,
      tReq.body.isCompleted ?? true,
      sType === 'warmup',
      sType,
      tReq.body.notes || null,
    ]
  );
  tRes.status(201).json({ set: oSet });
}));

// PUT /api/sessions/sets/:setId
oRouter.put('/sets/:setId', wrap(async (tReq, tRes) => {
  if (!(await ownSet(tReq.params.setId, tReq.iUserId))) throw httpError(404, 'Set not found');
  const sType = normSetType(tReq.body.setType, tReq.body.isWarmup);
  const oSet = await oDb.one(
    `UPDATE exercise_sets SET
       weight = $1, reps = $2, rest_seconds = $3, rpe = $4,
       is_completed = $5, is_warmup = $6, set_type = $7, notes = $8
     WHERE id = $9 RETURNING *`,
    [
      tReq.body.weight ?? null,
      tReq.body.reps ?? null,
      tReq.body.restSeconds ?? null,
      tReq.body.rpe ?? null,
      tReq.body.isCompleted ?? true,
      sType === 'warmup',
      sType,
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
