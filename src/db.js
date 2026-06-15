'use strict';
const { Pool } = require('pg');
const oConfig = require('./config');

const oPool = new Pool({ connectionString: oConfig.sDatabaseUrl });

oPool.on('error', (tErr) => {
  console.error('Postgres pool error:', tErr.message);
});

// Run a query, return the full result.
async function query(tSql, tParams) {
  return oPool.query(tSql, tParams || []);
}

// Return the first row or null.
async function one(tSql, tParams) {
  const oResult = await oPool.query(tSql, tParams || []);
  return oResult.rows[0] || null;
}

// Return all rows.
async function many(tSql, tParams) {
  const oResult = await oPool.query(tSql, tParams || []);
  return oResult.rows;
}

module.exports = { oPool, query, one, many };
