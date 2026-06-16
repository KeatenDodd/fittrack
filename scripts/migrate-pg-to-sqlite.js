'use strict';
// One-time migration: copy everything from the old PostgreSQL dev database into
// a fresh embedded SQLite database (the format the app + FitTrack.exe now use).
// Preserves primary keys so all foreign-key references stay intact, and copies
// the uploaded photo/video files too.
//
// Usage:
//   node scripts/migrate-pg-to-sqlite.js [--out <db file>] [--uploads <dir>]
//   DATABASE_URL=postgres://user:pass@host/db node scripts/migrate-pg-to-sqlite.js
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Client, types } = require('pg');

// Return DATE columns as 'YYYY-MM-DD' strings (not JS Dates) to avoid tz drift.
types.setTypeParser(1082, (v) => v);

const sRoot = path.join(__dirname, '..');
function arg(sName, sDefault) {
  const i = process.argv.indexOf(sName);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : sDefault;
}
const sPgUrl = process.env.DATABASE_URL || 'postgres://fittrack:fittrack@localhost:5432/fittrack';
const sOut = path.resolve(arg('--out', path.join(sRoot, 'dist', 'fittrack-data', 'fittrack.db')));
const sUploadsSrc = path.resolve(arg('--uploads', path.join(sRoot, 'uploads')));
const sUploadsDest = path.join(path.dirname(sOut), 'uploads');

// Tables in FK-friendly order (FK enforcement is off during the copy anyway).
// refresh_tokens is intentionally skipped (transient; users just re-pick a profile).
const TABLES = [
  'users', 'exercises', 'workout_templates', 'template_exercises',
  'programs', 'program_days', 'program_exercises',
  'workout_sessions', 'session_exercises', 'exercise_sets',
  'body_weight_logs', 'measurement_types', 'body_measurement_logs',
  'activity_logs', 'nutrients', 'foods', 'food_nutrients', 'food_log',
  'nutrition_goals', 'cycle_logs', 'progress_photos', 'exercise_media',
];

function pad(n) { return String(n).padStart(2, '0'); }
function fmtLocal(oDate) {
  return oDate.getFullYear() + '-' + pad(oDate.getMonth() + 1) + '-' + pad(oDate.getDate())
    + ' ' + pad(oDate.getHours()) + ':' + pad(oDate.getMinutes()) + ':' + pad(oDate.getSeconds());
}
function conv(tVal) {
  if (tVal === null || tVal === undefined) return null;
  if (typeof tVal === 'boolean') return tVal ? 1 : 0;
  if (tVal instanceof Date) return fmtLocal(tVal);
  return tVal; // string or number — SQLite affinity handles numeric strings
}

// Same Postgres->SQLite schema translation the app uses (schema only, no seed).
function translate(sSql) {
  return sSql
    .replace(/CREATE OR REPLACE FUNCTION[\s\S]*$/i, '')
    .replace(/\bSERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bBIGSERIAL\b/gi, 'INTEGER').replace(/\bSERIAL\b/gi, 'INTEGER')
    .replace(/\bTIMESTAMPTZ\b/gi, 'TEXT').replace(/\bBOOLEAN\b/gi, 'INTEGER')
    .replace(/DEFAULT\s+now\(\)/gi, "DEFAULT (datetime('now','localtime'))")
    .replace(/\bDEFAULT\s+true\b/gi, 'DEFAULT 1').replace(/\bDEFAULT\s+false\b/gi, 'DEFAULT 0');
}

async function main() {
  // fresh target db
  for (const sExt of ['', '-wal', '-shm']) { try { fs.unlinkSync(sOut + sExt); } catch (e) { /* ok */ } }
  fs.mkdirSync(path.dirname(sOut), { recursive: true });
  const oSql = new DatabaseSync(sOut);
  oSql.exec('PRAGMA foreign_keys = OFF');
  oSql.exec(translate(fs.readFileSync(path.join(sRoot, 'db', 'schema.sql'), 'utf8')));

  const oPg = new Client({ connectionString: sPgUrl });
  await oPg.connect();
  console.log('Connected to Postgres. Copying ' + TABLES.length + ' tables -> ' + sOut + '\n');

  oSql.exec('BEGIN');
  for (const sTable of TABLES) {
    const { rows } = await oPg.query('SELECT * FROM ' + sTable);
    if (!rows.length) { console.log('  ' + sTable.padEnd(22) + ' 0'); continue; }
    const aCols = Object.keys(rows[0]);
    const sStmt = 'INSERT INTO ' + sTable + ' (' + aCols.join(', ') + ') VALUES ('
      + aCols.map(() => '?').join(', ') + ')';
    const oStmt = oSql.prepare(sStmt);
    let iOk = 0;
    for (const oRow of rows) {
      try { oStmt.run(...aCols.map((c) => conv(oRow[c]))); iOk += 1; }
      catch (tErr) { console.warn('    skip row in ' + sTable + ': ' + tErr.message); }
    }
    console.log('  ' + sTable.padEnd(22) + iOk);
  }
  oSql.exec('COMMIT');
  await oPg.end();
  oSql.close();

  // copy uploaded files
  if (fs.existsSync(sUploadsSrc)) {
    fs.mkdirSync(sUploadsDest, { recursive: true });
    fs.cpSync(sUploadsSrc, sUploadsDest, { recursive: true });
    console.log('\nCopied uploads ' + sUploadsSrc + ' -> ' + sUploadsDest);
  } else {
    console.log('\nNo uploads folder at ' + sUploadsSrc + ' (skipped).');
  }
  console.log('\nMigration complete.');
}

main().catch((tErr) => { console.error('Migration failed:', tErr.message); process.exit(1); });
