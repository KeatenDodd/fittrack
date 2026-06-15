'use strict';
// Applies db/schema.sql then db/seed.sql to the configured DATABASE_URL.
// Safe to run on a fresh database. Re-running will error on existing tables
// unless you drop them first (see README).
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const oConfig = require('../src/config');

async function main() {
  const oClient = new Client({ connectionString: oConfig.sDatabaseUrl });
  await oClient.connect();
  try {
    const sSchema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    const sSeed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
    console.log('Applying schema...');
    await oClient.query(sSchema);
    console.log('Applying seed data...');
    await oClient.query(sSeed);
    console.log('Database ready.');
  } finally {
    await oClient.end();
  }
}

main().catch((tErr) => {
  console.error('db:init failed:', tErr.message);
  process.exit(1);
});
