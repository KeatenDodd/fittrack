'use strict';
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

async function loadTemplate(tTemplateId, tUserId) {
  const oTemplate = await oDb.one(
    'SELECT * FROM workout_templates WHERE id = $1 AND user_id = $2',
    [tTemplateId, tUserId]
  );
  if (!oTemplate) return null;
  const oExercises = await oDb.many(
    `SELECT te.*, e.name AS exercise_name, e.muscle_group, e.equipment
     FROM template_exercises te
     JOIN exercises e ON e.id = te.exercise_id
     WHERE te.template_id = $1
     ORDER BY te.order_index ASC, te.id ASC`,
    [tTemplateId]
  );
  return { ...oTemplate, exercises: oExercises };
}

// Replace the full exercise list of a template (used on create + update).
async function setTemplateExercises(tTemplateId, tExercises) {
  await oDb.query('DELETE FROM template_exercises WHERE template_id = $1', [tTemplateId]);
  const aRows = Array.isArray(tExercises) ? tExercises : [];
  for (let i = 0; i < aRows.length; i += 1) {
    const oItem = aRows[i];
    await oDb.query(
      `INSERT INTO template_exercises
        (template_id, exercise_id, order_index, target_sets, target_reps, target_weight, target_rest_seconds, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tTemplateId,
        oItem.exerciseId,
        i,
        oItem.targetSets || null,
        oItem.targetReps || null,
        oItem.targetWeight || null,
        oItem.targetRestSeconds || null,
        oItem.notes || null,
      ]
    );
  }
}

// GET /api/templates  -> list with exercise counts
oRouter.get('/', wrap(async (tReq, tRes) => {
  const oTemplates = await oDb.many(
    `SELECT t.*, COUNT(te.id)::int AS exercise_count
     FROM workout_templates t
     LEFT JOIN template_exercises te ON te.template_id = t.id
     WHERE t.user_id = $1
     GROUP BY t.id
     ORDER BY t.updated_at DESC`,
    [tReq.iUserId]
  );
  tRes.json({ templates: oTemplates });
}));

// GET /api/templates/:id
oRouter.get('/:id', wrap(async (tReq, tRes) => {
  const oTemplate = await loadTemplate(tReq.params.id, tReq.iUserId);
  if (!oTemplate) throw httpError(404, 'Template not found');
  tRes.json({ template: oTemplate });
}));

// POST /api/templates
oRouter.post('/', wrap(async (tReq, tRes) => {
  const sName = String(tReq.body.name || '').trim();
  if (!sName) throw httpError(400, 'Template name is required');
  const oTemplate = await oDb.one(
    'INSERT INTO workout_templates (user_id, name, notes) VALUES ($1, $2, $3) RETURNING *',
    [tReq.iUserId, sName, tReq.body.notes || null]
  );
  await setTemplateExercises(oTemplate.id, tReq.body.exercises);
  tRes.status(201).json({ template: await loadTemplate(oTemplate.id, tReq.iUserId) });
}));

// PUT /api/templates/:id
oRouter.put('/:id', wrap(async (tReq, tRes) => {
  const oTemplate = await oDb.one(
    `UPDATE workout_templates SET name = $1, notes = $2
     WHERE id = $3 AND user_id = $4 RETURNING *`,
    [String(tReq.body.name || '').trim(), tReq.body.notes || null, tReq.params.id, tReq.iUserId]
  );
  if (!oTemplate) throw httpError(404, 'Template not found');
  if (tReq.body.exercises) await setTemplateExercises(oTemplate.id, tReq.body.exercises);
  tRes.json({ template: await loadTemplate(oTemplate.id, tReq.iUserId) });
}));

// DELETE /api/templates/:id
oRouter.delete('/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'DELETE FROM workout_templates WHERE id = $1 AND user_id = $2 RETURNING id',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Template not found');
  tRes.json({ ok: true });
}));

module.exports = oRouter;
