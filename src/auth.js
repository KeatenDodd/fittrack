'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const oConfig = require('./config');

async function hashPassword(tPlain) {
  return bcrypt.hash(tPlain, 12);
}

async function verifyPassword(tPlain, tHash) {
  return bcrypt.compare(tPlain, tHash);
}

function signAccessToken(tUser) {
  return jwt.sign(
    { sub: tUser.id, username: tUser.username },
    oConfig.sJwtSecret,
    { expiresIn: oConfig.sAccessTtl }
  );
}

// Returns the raw token (sent to client once) and the hash (stored in DB).
function newRefreshToken() {
  const sRaw = crypto.randomBytes(48).toString('hex');
  const sHash = crypto.createHash('sha256').update(sRaw).digest('hex');
  return { sRaw, sHash };
}

function hashRefresh(tRaw) {
  return crypto.createHash('sha256').update(tRaw).digest('hex');
}

// Express middleware: require a valid access token.
function requireAuth(tReq, tRes, tNext) {
  const sHeader = tReq.headers.authorization || '';
  const sToken = sHeader.startsWith('Bearer ') ? sHeader.slice(7) : null;
  if (!sToken) {
    return tRes.status(401).json({ error: 'Not signed in' });
  }
  try {
    const oPayload = jwt.verify(sToken, oConfig.sJwtSecret);
    tReq.iUserId = oPayload.sub;
    tReq.sUsername = oPayload.username;
    return tNext();
  } catch (tErr) {
    return tRes.status(401).json({ error: 'Session expired' });
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signAccessToken,
  newRefreshToken,
  hashRefresh,
  requireAuth,
};
