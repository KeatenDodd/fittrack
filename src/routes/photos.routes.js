'use strict';
// Progress photos: body shots tagged with a date + angle, for side-by-side
// comparison over time. Image bytes are streamed straight to disk.
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');
const { saveUpload, removeUpload } = require('../upload');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

const ANGLES = ['front', 'side', 'back', 'other'];
const MAX_PHOTO = 25 * 1024 * 1024; // 25 MB
const sDateRe = /^\d{4}-\d{2}-\d{2}$/;

function publicRow(tRow) {
  return {
    id: tRow.id, takenOn: tRow.taken_on, angle: tRow.angle,
    mime: tRow.mime, url: '/uploads/' + tRow.file_path,
  };
}

// GET /api/photos -> all of this user's progress photos (newest first)
oRouter.get('/', wrap(async (tReq, tRes) => {
  const aRows = await oDb.many(
    `SELECT id, to_char(taken_on, 'YYYY-MM-DD') AS taken_on, angle, file_path, mime
     FROM progress_photos WHERE user_id = $1
     ORDER BY taken_on DESC, id DESC`,
    [tReq.iUserId]
  );
  tRes.json({ photos: aRows.map(publicRow) });
}));

// POST /api/photos?date=YYYY-MM-DD&angle=front  (raw image body)
oRouter.post('/', wrap(async (tReq, tRes) => {
  const sDate = sDateRe.test(String(tReq.query.date || '')) ? tReq.query.date
    : new Date().toISOString().slice(0, 10);
  const sAngle = ANGLES.includes(String(tReq.query.angle)) ? tReq.query.angle : 'front';

  const oSaved = await saveUpload(tReq, 'progress', ['image/'], MAX_PHOTO);
  const oRow = await oDb.one(
    `INSERT INTO progress_photos (user_id, taken_on, angle, file_path, mime)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, to_char(taken_on, 'YYYY-MM-DD') AS taken_on, angle, file_path, mime`,
    [tReq.iUserId, sDate, sAngle, oSaved.relPath, oSaved.mime]
  );
  tRes.status(201).json({ photo: publicRow(oRow) });
}));

// DELETE /api/photos/:id
oRouter.delete('/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'DELETE FROM progress_photos WHERE id = $1 AND user_id = $2 RETURNING file_path',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Photo not found');
  removeUpload(oRow.file_path);
  tRes.json({ ok: true });
}));

module.exports = oRouter;
