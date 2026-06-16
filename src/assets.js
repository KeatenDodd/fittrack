'use strict';
// Asset access that works both in normal `node` runs (read from disk) and inside
// a Single Executable Application (read from the embedded assets.json blob).
// The build script packs db/*.sql and public/** into assets.json as base64.
const fs = require('fs');
const path = require('path');

let oSea = null;
try { oSea = require('node:sea'); } catch (tErr) { /* not available */ }
const bSea = !!(oSea && oSea.isSea && oSea.isSea());

let oMap = null;
function map() {
  if (oMap) return oMap;
  oMap = {};
  if (bSea) {
    const oRaw = JSON.parse(oSea.getAsset('assets.json', 'utf8'));
    for (const sKey of Object.keys(oRaw)) oMap[sKey] = Buffer.from(oRaw[sKey], 'base64');
  }
  return oMap;
}

function readBuffer(sRel) {
  if (bSea) {
    const oBuf = map()[sRel];
    if (!oBuf) throw new Error('Embedded asset missing: ' + sRel);
    return oBuf;
  }
  return fs.readFileSync(path.join(__dirname, '..', sRel));
}

function readText(sRel) { return readBuffer(sRel).toString('utf8'); }

// For SEA static serving: returns { '/index.html': Buffer, '/js/app.js': Buffer, ... }
function publicFiles() {
  const oOut = {};
  if (!bSea) return oOut;
  for (const sKey of Object.keys(map())) {
    if (sKey.startsWith('public/')) oOut[sKey.slice('public'.length)] = map()[sKey];
  }
  return oOut;
}

module.exports = { isSea: bSea, readBuffer, readText, publicFiles };
