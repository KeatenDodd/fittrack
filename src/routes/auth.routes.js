'use strict';
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const { wrap, httpError } = require('../util');
const oConfig = require('../config');

const oRouter = express.Router();

function publicUser(tRow) {
  return {
    id: tRow.id,
    username: tRow.username,
    email: tRow.email,
    displayName: tRow.display_name,
    sex: tRow.sex || null,
  };
}

// Normalize a sex input to 'male' | 'female' | null.
function normSex(tVal) {
  const s = String(tVal || '').trim().toLowerCase();
  return s === 'male' || s === 'female' ? s : null;
}

// Issue an access + refresh token for a user (no password — this is a
// local, trusted-network app where accounts are just profiles you pick).
async function issueSession(tUser, tDevice) {
  const sAccess = oAuth.signAccessToken(tUser);
  const oRefresh = oAuth.newRefreshToken();
  const oExpires = new Date(Date.now() + oConfig.iRefreshDays * 86400000);
  await oDb.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [tUser.id, oRefresh.sHash, String(tDevice || 'web').slice(0, 100), oExpires]
  );
  return { accessToken: sAccess, refreshToken: oRefresh.sRaw, user: publicUser(tUser) };
}

// GET /api/auth/profiles — list everyone so the picker can show them. Public.
oRouter.get('/profiles', wrap(async (tReq, tRes) => {
  const aRows = await oDb.many(
    'SELECT id, username, email, display_name, sex FROM users ORDER BY created_at'
  );
  tRes.json({ profiles: aRows.map(publicUser) });
}));

// POST /api/auth/register — add a profile (just a name, no password).
oRouter.post('/register', wrap(async (tReq, tRes) => {
  const sUsername = String(tReq.body.username || '').trim().toLowerCase();
  const sDisplayName = String(tReq.body.displayName || '').trim() || sUsername;
  const sEmail = tReq.body.email ? String(tReq.body.email).trim() : null;

  if (!sUsername) throw httpError(400, 'Enter a name');

  const oExisting = await oDb.one('SELECT id FROM users WHERE username = $1', [sUsername]);
  if (oExisting) throw httpError(409, 'A profile with that name already exists');

  const oUser = await oDb.one(
    `INSERT INTO users (username, email, password_hash, display_name, sex)
     VALUES ($1, $2, NULL, $3, $4) RETURNING *`,
    [sUsername, sEmail, sDisplayName, normSex(tReq.body.sex)]
  );
  // New profile is signed in immediately.
  tRes.status(201).json(await issueSession(oUser, tReq.body.device));
}));

// POST /api/auth/select — pick an existing profile (no password).
oRouter.post('/select', wrap(async (tReq, tRes) => {
  const iUserId = parseInt(tReq.body.userId, 10);
  if (!iUserId) throw httpError(400, 'Pick a profile');

  const oUser = await oDb.one('SELECT * FROM users WHERE id = $1', [iUserId]);
  if (!oUser) throw httpError(404, 'That profile no longer exists');

  tRes.json(await issueSession(oUser, tReq.body.device));
}));

// POST /api/auth/refresh
oRouter.post('/refresh', wrap(async (tReq, tRes) => {
  const sRaw = String(tReq.body.refreshToken || '');
  if (!sRaw) throw httpError(401, 'Missing refresh token');
  const sHash = oAuth.hashRefresh(sRaw);

  const oToken = await oDb.one(
    `SELECT rt.*, u.username FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.expires_at > now()`,
    [sHash]
  );
  if (!oToken) throw httpError(401, 'Session expired, pick your profile again');

  // Rotate: delete old, issue new.
  await oDb.query('DELETE FROM refresh_tokens WHERE id = $1', [oToken.id]);
  const oRefresh = oAuth.newRefreshToken();
  const oExpires = new Date(Date.now() + oConfig.iRefreshDays * 86400000);
  await oDb.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [oToken.user_id, oRefresh.sHash, oToken.device, oExpires]
  );
  const sAccess = oAuth.signAccessToken({ id: oToken.user_id, username: oToken.username });
  tRes.json({ accessToken: sAccess, refreshToken: oRefresh.sRaw });
}));

// POST /api/auth/logout
oRouter.post('/logout', wrap(async (tReq, tRes) => {
  const sRaw = String(tReq.body.refreshToken || '');
  if (sRaw) {
    await oDb.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [oAuth.hashRefresh(sRaw)]);
  }
  tRes.json({ ok: true });
}));

// GET /api/auth/me
oRouter.get('/me', oAuth.requireAuth, wrap(async (tReq, tRes) => {
  const oUser = await oDb.one('SELECT * FROM users WHERE id = $1', [tReq.iUserId]);
  if (!oUser) throw httpError(404, 'User not found');
  tRes.json({ user: publicUser(oUser) });
}));

// PUT /api/auth/me — update this profile's display name / sex
oRouter.put('/me', oAuth.requireAuth, wrap(async (tReq, tRes) => {
  const sName = tReq.body.displayName != null ? String(tReq.body.displayName).trim() : null;
  const oUser = await oDb.one(
    `UPDATE users SET
       display_name = COALESCE($1, display_name),
       sex = $2
     WHERE id = $3 RETURNING *`,
    [sName || null, normSex(tReq.body.sex), tReq.iUserId]
  );
  if (!oUser) throw httpError(404, 'User not found');
  tRes.json({ user: publicUser(oUser) });
}));

module.exports = oRouter;
