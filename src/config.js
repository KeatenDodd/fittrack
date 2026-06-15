'use strict';
require('dotenv').config();

const oConfig = {
  sHost: process.env.HOST || '0.0.0.0',
  iPort: parseInt(process.env.PORT || '8443', 10),
  sDatabaseUrl:
    process.env.DATABASE_URL ||
    'postgres://fittrack:fittrack@localhost:5432/fittrack',
  sJwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  sAccessTtl: process.env.ACCESS_TTL || '30m',
  iRefreshDays: parseInt(process.env.REFRESH_DAYS || '60', 10),
  sCertDir: process.env.CERT_DIR || './certs',
  sOffBase: (process.env.OFF_BASE || 'https://world.openfoodfacts.org').replace(/\/+$/, ''),
};

module.exports = oConfig;
