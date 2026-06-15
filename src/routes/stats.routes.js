'use strict';
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

// GET /api/stats/exercise/:id  -> per-session progress for one exercise.
// Returns date, top weight, estimated 1RM (Epley), and working-set volume.
oRouter.get('/exercise/:id', wrap(async (tReq, tRes) => {
  const oRows = await oDb.many(
    `SELECT s.id AS session_id, s.started_at::date AS day,
            MAX(st.weight) AS top_weight,
            MAX(st.weight * (1 + st.reps / 30.0)) AS est_one_rm,
            SUM(st.weight * st.reps) FILTER (WHERE st.is_warmup = false) AS volume,
            SUM(st.reps) FILTER (WHERE st.is_warmup = false) AS total_reps,
            COUNT(*) FILTER (WHERE st.is_warmup = false)::int AS total_sets,
            MAX(st.reps) FILTER (WHERE st.is_warmup = false) AS top_reps,
            string_agg(DISTINCT NULLIF(se.notes, ''), ' · ') AS note
     FROM workout_sessions s
     JOIN session_exercises se ON se.session_id = s.id
     JOIN exercise_sets st ON st.session_exercise_id = se.id
     WHERE s.user_id = $1 AND se.exercise_id = $2 AND st.weight IS NOT NULL
     GROUP BY s.id, day
     ORDER BY s.started_at ASC`,
    [tReq.iUserId, tReq.params.id]
  );
  tRes.json({ history: oRows });
}));

// GET /api/stats/exercises  -> only exercises the user has logged weighted sets
// for (so the Progress picker doesn't list empty exercises).
oRouter.get('/exercises', wrap(async (tReq, tRes) => {
  const oRows = await oDb.many(
    `SELECT DISTINCT e.id, e.name
     FROM exercises e
     JOIN session_exercises se ON se.exercise_id = e.id
     JOIN workout_sessions s ON s.id = se.session_id
     JOIN exercise_sets st ON st.session_exercise_id = se.id
     WHERE s.user_id = $1 AND st.weight IS NOT NULL
     ORDER BY e.name ASC`,
    [tReq.iUserId]
  );
  tRes.json({ exercises: oRows });
}));

// GET /api/stats/overview  -> headline counts for the dashboard
oRouter.get('/overview', wrap(async (tReq, tRes) => {
  const oWorkouts = await oDb.one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE started_at > now() - interval '7 days')::int AS this_week
     FROM workout_sessions WHERE user_id = $1`,
    [tReq.iUserId]
  );
  const oWeight = await oDb.one(
    `SELECT weight, unit, logged_at FROM body_weight_logs
     WHERE user_id = $1 ORDER BY logged_at DESC LIMIT 1`,
    [tReq.iUserId]
  );
  const oVolume = await oDb.one(
    `SELECT COALESCE(SUM(st.weight * st.reps), 0)::numeric AS volume
     FROM workout_sessions s
     JOIN session_exercises se ON se.session_id = s.id
     JOIN exercise_sets st ON st.session_exercise_id = se.id AND st.is_warmup = false
     WHERE s.user_id = $1 AND s.started_at > now() - interval '7 days'`,
    [tReq.iUserId]
  );
  tRes.json({
    workouts: oWorkouts,
    latestWeight: oWeight,
    weekVolume: oVolume ? Number(oVolume.volume) : 0,
  });
}));

module.exports = oRouter;
