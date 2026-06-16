'use strict';
require('dotenv').config();
const path = require('path');

// Inside a Single Executable Application, keep data next to the .exe so the app
// is self-contained; in a normal `node` run, use the project's data/ directory.
let bSea = false;
try { const oSea = require('node:sea'); bSea = !!(oSea && oSea.isSea && oSea.isSea()); } catch (tErr) { /* n/a */ }
const sDataDir = process.env.DATA_DIR
  || (bSea ? path.join(path.dirname(process.execPath), 'fittrack-data') : path.join(__dirname, '..', 'data'));

const oConfig = {
  bSea,
  sDataDir,
  sDbFile: process.env.DB_FILE || path.join(sDataDir, 'fittrack.db'),
  sHost: process.env.HOST || '0.0.0.0',
  iPort: parseInt(process.env.PORT || (bSea ? '8080' : '8443'), 10),
  sJwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  sAccessTtl: process.env.ACCESS_TTL || '30m',
  iRefreshDays: parseInt(process.env.REFRESH_DAYS || '60', 10),
  sCertDir: process.env.CERT_DIR || './certs',
  sOffBase: (process.env.OFF_BASE || 'https://world.openfoodfacts.org').replace(/\/+$/, ''),
};

module.exports = oConfig;
