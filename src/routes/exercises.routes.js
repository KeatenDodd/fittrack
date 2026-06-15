'use strict';
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

// GET /api/exercises  -> system defaults + this user's custom exercises
oRouter.get('/', wrap(async (tReq, tRes) => {
  const oExercises = await oDb.many(
    `SELECT id, name, category, muscle_group, equipment, is_custom, created_by, notes
     FROM exercises
     WHERE created_by IS NULL OR created_by = $1
     ORDER BY name ASC`,
    [tReq.iUserId]
  );
  tRes.json({ exercises: oExercises });
}));

// POST /api/exercises  -> create a custom exercise
oRouter.post('/', wrap(async (tReq, tRes) => {
  const sName = String(tReq.body.name || '').trim();
  if (!sName) throw httpError(400, 'Name is required');
  const oExercise = await oDb.one(
    `INSERT INTO exercises (name, category, muscle_group, equipment, is_custom, created_by, notes)
     VALUES ($1, $2, $3, $4, true, $5, $6) RETURNING *`,
    [
      sName,
      tReq.body.category || null,
      tReq.body.muscleGroup || null,
      tReq.body.equipment || null,
      tReq.iUserId,
      tReq.body.notes || null,
    ]
  );
  tRes.status(201).json({ exercise: oExercise });
}));

// PUT /api/exercises/:id  -> update an owned custom exercise
oRouter.put('/:id', wrap(async (tReq, tRes) => {
  const oExercise = await oDb.one(
    `UPDATE exercises SET name = $1, category = $2, muscle_group = $3, equipment = $4, notes = $5
     WHERE id = $6 AND created_by = $7 RETURNING *`,
    [
      String(tReq.body.name || '').trim(),
      tReq.body.category || null,
      tReq.body.muscleGroup || null,
      tReq.body.equipment || null,
      tReq.body.notes || null,
      tReq.params.id,
      tReq.iUserId,
    ]
  );
  if (!oExercise) throw httpError(404, 'Exercise not found or not yours to edit');
  tRes.json({ exercise: oExercise });
}));

// DELETE /api/exercises/:id
oRouter.delete('/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'DELETE FROM exercises WHERE id = $1 AND created_by = $2 RETURNING id',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Exercise not found or not yours to delete');
  tRes.json({ ok: true });
}));

module.exports = oRouter;
