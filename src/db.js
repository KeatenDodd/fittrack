'use strict';
// Embedded SQLite backend (node:sqlite). Keeps the same one/many/query async
// API the routes already use, so the rest of the app is unchanged. A small
// adapter rewrites Postgres-style "$1" placeholders to "?" and coerces JS
// booleans, and the Postgres schema.sql is translated to SQLite on first run.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const oConfig = require('./config');
const oAssets = require('./assets');

fs.mkdirSync(path.dirname(oConfig.sDbFile), { recursive: true });
const oSqlite = new DatabaseSync(oConfig.sDbFile);
oSqlite.exec('PRAGMA journal_mode = WAL');
oSqlite.exec('PRAGMA foreign_keys = ON');

ensureSchema();

// --- schema bootstrap ---------------------------------------------------------
function translate(sSql) {
  return sSql
    // drop the plpgsql updated_at trigger helper + its triggers (to EOF)
    .replace(/CREATE OR REPLACE FUNCTION[\s\S]*$/i, '')
    .replace(/\bSERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bBIGSERIAL\b/gi, 'INTEGER')
    .replace(/\bSERIAL\b/gi, 'INTEGER')
    .replace(/\bTIMESTAMPTZ\b/gi, 'TEXT')
    .replace(/\bBOOLEAN\b/gi, 'INTEGER')
    .replace(/DEFAULT\s+now\(\)/gi, "DEFAULT (datetime('now','localtime'))")
    .replace(/\bDEFAULT\s+true\b/gi, 'DEFAULT 1')
    .replace(/\bDEFAULT\s+false\b/gi, 'DEFAULT 0');
}

function ensureSchema() {
  const oRow = oSqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get();
  if (oRow) return;
  oSqlite.exec(translate(oAssets.readText('db/schema.sql')));
  oSqlite.exec(translate(oAssets.readText('db/seed.sql')));
  console.log('Initialized SQLite database at ' + oConfig.sDbFile);
}

// --- query adapter ------------------------------------------------------------
function coerce(tVal) {
  if (tVal === undefined || tVal === null) return null;
  if (typeof tVal === 'boolean') return tVal ? 1 : 0;
  if (tVal instanceof Date) return tVal.toISOString();
  return tVal;
}

// Rewrite $1,$2,... to ? in order of appearance (supports reuse), building a
// flat positional params array to match.
function adapt(sSql, aParams) {
  const aOut = [];
  const sOut = sSql.replace(/\$(\d+)/g, (tMatch, sNum) => {
    aOut.push(coerce((aParams || [])[Number(sNum) - 1]));
    return '?';
  });
  return [sOut, aOut];
}

function run(sSql, aParams) {
  // transaction control statements run directly
  if (/^\s*(begin|commit|rollback)\b/i.test(sSql)) { oSqlite.exec(sSql); return { rows: [] }; }
  const [sAdapted, aBound] = adapt(sSql, aParams);
  const oStmt = oSqlite.prepare(sAdapted);
  if (/^\s*(select|with|pragma)\b/i.test(sAdapted) || /\breturning\b/i.test(sAdapted)) {
    return { rows: oStmt.all(...aBound) };
  }
  const oRes = oStmt.run(...aBound);
  return { rows: [], changes: oRes.changes, lastInsertRowid: oRes.lastInsertRowid };
}

async function query(sSql, aParams) { return run(sSql, aParams); }
async function one(sSql, aParams) { return run(sSql, aParams).rows[0] || null; }
async function many(sSql, aParams) { return run(sSql, aParams).rows; }

// pg-compatible pool shim so the import transaction code works unchanged.
// node:sqlite is a single in-process connection, so a "client" is just db.
const oPool = {
  connect: async () => ({
    query: async (sSql, aParams) => run(sSql, aParams),
    release: () => {},
  }),
};

module.exports = { query, one, many, raw: oSqlite, oPool };
