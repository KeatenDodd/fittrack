'use strict';
// Self-update for the packaged FitTrack.exe via GitHub Releases.
// On launch it asks GitHub for the latest release; if it's newer than this
// build, it downloads the new FitTrack.exe to fittrack-data/update/ and spawns a
// detached helper that waits for this app to close, then swaps the exe in place.
// The update therefore applies on the NEXT launch. Data is never touched.
//
// Version + repo are injected at build time (esbuild define). In a normal `node`
// run they're empty, so the updater is inert.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const oConfig = require('./config');

const sVersion = process.env.FITTRACK_VERSION || '';
const sRepo = process.env.FITTRACK_REPO || ''; // "owner/repo"

// Live status the app can show in Settings.
const oStatus = {
  version: sVersion,
  sea: oConfig.bSea,
  repoSet: !!sRepo && !sRepo.includes('YOUR_'),
  latest: null,
  staged: false, // a newer exe is downloaded and applies on next launch
};
// Reflect a previously-downloaded update even before the async check runs.
try {
  const sDir = path.join(oConfig.sDataDir, 'update');
  const sMk = path.join(sDir, 'staged-version.txt');
  if (fs.existsSync(path.join(sDir, 'FitTrack.exe')) && fs.existsSync(sMk)) {
    oStatus.staged = true;
    oStatus.latest = fs.readFileSync(sMk, 'utf8').trim();
  }
} catch (tErr) { /* ignore */ }

function getStatus() { return oStatus; }

function cmpVer(sA, sB) {
  const aA = String(sA).split('.').map((n) => parseInt(n, 10) || 0);
  const aB = String(sB).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(aA.length, aB.length); i += 1) {
    const d = (aA[i] || 0) - (aB[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate() {
  // Only meaningful for the packaged exe with a configured repo.
  if (!oConfig.bSea || !sRepo || sRepo.includes('YOUR_') || !sVersion) return;

  const sUpdateDir = path.join(oConfig.sDataDir, 'update');
  const sStaged = path.join(sUpdateDir, 'FitTrack.exe');
  const sMarker = path.join(sUpdateDir, 'staged-version.txt');

  let oRelease;
  try {
    const oRes = await fetch('https://api.github.com/repos/' + sRepo + '/releases/latest', {
      headers: { 'User-Agent': 'FitTrack-Updater', Accept: 'application/vnd.github+json' },
    });
    if (!oRes.ok) return;
    oRelease = await oRes.json();
  } catch (tErr) { return; }

  const sLatest = String(oRelease.tag_name || '').replace(/^v/i, '');
  oStatus.latest = sLatest || null;
  if (!sLatest || cmpVer(sLatest, sVersion) <= 0) {
    // up to date — clear any stale staged download
    try { fs.rmSync(sUpdateDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    oStatus.staged = false;
    return;
  }

  const oAsset = (oRelease.assets || []).find((a) => /FitTrack\.exe$/i.test(a.name));
  if (!oAsset) return;

  // If we already downloaded this version, just (re)arm the swap helper.
  let bHave = false;
  try { bHave = fs.existsSync(sStaged) && fs.readFileSync(sMarker, 'utf8').trim() === sLatest; } catch (e) { /* no */ }

  if (!bHave) {
    try {
      fs.mkdirSync(sUpdateDir, { recursive: true });
      const oRes = await fetch(oAsset.browser_download_url, { headers: { 'User-Agent': 'FitTrack-Updater' } });
      if (!oRes.ok || !oRes.body) return;
      await pipeline(Readable.fromWeb(oRes.body), fs.createWriteStream(sStaged + '.part'));
      fs.renameSync(sStaged + '.part', sStaged);
      fs.writeFileSync(sMarker, sLatest);
      console.log('[update] downloaded v' + sLatest + ' — it will apply when you close FitTrack.');
    } catch (tErr) {
      try { fs.unlinkSync(sStaged + '.part'); } catch (e) { /* ignore */ }
      return;
    }
  }

  oStatus.staged = true;
  armSwap(sStaged, process.execPath, process.pid);
}

// Detached PowerShell: wait for this process to exit, then replace the exe.
function armSwap(sStaged, sExe, iPid) {
  if (process.platform !== 'win32') return;
  const sPs = [
    "$ErrorActionPreference='SilentlyContinue'",
    'Wait-Process -Id ' + iPid + ' -ErrorAction SilentlyContinue',
    'Start-Sleep -Milliseconds 600',
    "Copy-Item '" + sStaged.replace(/'/g, "''") + "' '" + sExe.replace(/'/g, "''") + "' -Force",
    "Remove-Item '" + sStaged.replace(/'/g, "''") + "' -Force",
  ].join('\n');
  try {
    const sEnc = Buffer.from(sPs, 'utf16le').toString('base64');
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', sEnc], { detached: true, stdio: 'ignore' }).unref();
  } catch (tErr) { /* update will just retry next launch */ }
}

module.exports = { checkForUpdate, getStatus, version: sVersion, repo: sRepo };
