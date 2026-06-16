'use strict';
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

// --- body weight --------------------------------------------------------------

// GET /api/body/weight
oRouter.get('/weight', wrap(async (tReq, tRes) => {
  const oRows = await oDb.many(
    `SELECT id, weight, unit, logged_at, notes
     FROM body_weight_logs WHERE user_id = $1
     ORDER BY logged_at ASC`,
    [tReq.iUserId]
  );
  tRes.json({ entries: oRows });
}));

// POST /api/body/weight
oRouter.post('/weight', wrap(async (tReq, tRes) => {
  const fWeight = Number(tReq.body.weight);
  if (!Number.isFinite(fWeight) || fWeight <= 0) throw httpError(400, 'Enter a valid weight');
  const oRow = await oDb.one(
    `INSERT INTO body_weight_logs (user_id, weight, unit, logged_at, notes)
     VALUES ($1, $2, $3, COALESCE($4, datetime('now','localtime')), $5) RETURNING *`,
    [tReq.iUserId, fWeight, tReq.body.unit || 'lb', tReq.body.loggedAt || null, tReq.body.notes || null]
  );
  tRes.status(201).json({ entry: oRow });
}));

// DELETE /api/body/weight/:id
oRouter.delete('/weight/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'DELETE FROM body_weight_logs WHERE id = $1 AND user_id = $2 RETURNING id',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Entry not found');
  tRes.json({ ok: true });
}));

// --- measurements -------------------------------------------------------------

// GET /api/body/measurement-types
oRouter.get('/measurement-types', wrap(async (tReq, tRes) => {
  const oTypes = await oDb.many('SELECT * FROM measurement_types ORDER BY id ASC', []);
  tRes.json({ types: oTypes });
}));

// GET /api/body/measurements  (optionally ?typeId=)
oRouter.get('/measurements', wrap(async (tReq, tRes) => {
  const iTypeId = tReq.query.typeId ? parseInt(tReq.query.typeId, 10) : null;
  const oRows = await oDb.many(
    `SELECT m.id, m.measurement_type_id, t.name AS type_name, m.value, m.unit, m.logged_at, m.notes
     FROM body_measurement_logs m
     JOIN measurement_types t ON t.id = m.measurement_type_id
     WHERE m.user_id = $1 AND ($2 IS NULL OR m.measurement_type_id = $2)
     ORDER BY m.logged_at ASC`,
    [tReq.iUserId, iTypeId]
  );
  tRes.json({ entries: oRows });
}));

// POST /api/body/measurements
oRouter.post('/measurements', wrap(async (tReq, tRes) => {
  const fValue = Number(tReq.body.value);
  if (!Number.isFinite(fValue)) throw httpError(400, 'Enter a valid measurement');
  const oRow = await oDb.one(
    `INSERT INTO body_measurement_logs (user_id, measurement_type_id, value, unit, logged_at, notes)
     VALUES ($1, $2, $3, $4, COALESCE($5, datetime('now','localtime')), $6) RETURNING *`,
    [
      tReq.iUserId,
      tReq.body.measurementTypeId,
      fValue,
      tReq.body.unit || 'in',
      tReq.body.loggedAt || null,
      tReq.body.notes || null,
    ]
  );
  tRes.status(201).json({ entry: oRow });
}));

// DELETE /api/body/measurements/:id
oRouter.delete('/measurements/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'DELETE FROM body_measurement_logs WHERE id = $1 AND user_id = $2 RETURNING id',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Entry not found');
  tRes.json({ ok: true });
}));

module.exports = oRouter;
