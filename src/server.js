'use strict';
// Hide the node:sqlite "experimental" notice (the API is stable enough for our
// use); keep all other warnings.
const oEmitWarning = process.emitWarning;
process.emitWarning = (tWarn, ...aRest) => {
  if (String(tWarn).includes('SQLite is an experimental')) return;
  return oEmitWarning.call(process, tWarn, ...aRest);
};

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const express = require('express');
const oConfig = require('./config');
const oAssets = require('./assets');

// --- background mode (packaged Windows exe) ----------------------------------
// So the server keeps running after you close the window: the first launch
// re-spawns the exe detached with NO console window, then this visible process
// exits. Closing the window therefore doesn't stop the server. Running the exe
// again (or double-clicking the tray icon) just opens the browser to the
// already-running server; "Quit FitTrack" in the tray is what actually stops it.
if (oConfig.bSea && process.platform === 'win32' && process.env.FITTRACK_BG !== '1') {
  launchInBackground();
  return; // don't start a server in this console process
}

function launchInBackground() {
  const sUrl = 'http://localhost:' + oConfig.iPort;
  const openBrowser = () => {
    try { spawn('cmd', ['/c', 'start', '', sUrl], { detached: true, stdio: 'ignore' }).unref(); }
    catch (tErr) { /* ignore */ }
  };
  const ping = () => new Promise((resolve) => {
    const oReq = http.get({ host: '127.0.0.1', port: oConfig.iPort, path: '/api/health', timeout: 1000 },
      (oRes) => { oRes.resume(); resolve(oRes.statusCode === 200); });
    oReq.on('error', () => resolve(false));
    oReq.on('timeout', () => { oReq.destroy(); resolve(false); });
  });
  (async () => {
    if (await ping()) { openBrowser(); process.exit(0); } // already running -> just reopen
    try {
      spawn(process.execPath, process.argv.slice(1), {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: Object.assign({}, process.env, { FITTRACK_BG: '1' }),
      }).unref();
    } catch (tErr) { /* ignore */ }
    for (let i = 0; i < 40 && !(await ping()); i += 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
    openBrowser();
    process.exit(0);
  })();
}

const oApp = express();

// Log every hit to the activity ingest path BEFORE body parsing, so failed
// wearable pushes (wrong URL, too large, bad content-type, missing key) are
// visible in the server console instead of vanishing silently.
oApp.use('/api/activity', (tReq, tRes, tNext) => {
  if (tReq.method === 'POST') {
    console.log('[activity] POST %s  type=%s  len=%s  apiKey=%s',
      tReq.originalUrl,
      tReq.headers['content-type'] || '-',
      tReq.headers['content-length'] || '?',
      tReq.headers['x-api-key'] ? 'yes' : 'no');
  }
  tNext();
});

// 10mb covers a large one-off Health/Apple export; daily pushes are tiny.
oApp.use(express.json({ limit: '10mb' }));

// API routes
oApp.use('/api/auth', require('./routes/auth.routes'));
oApp.use('/api/exercises', require('./routes/exercises.routes'));
oApp.use('/api/templates', require('./routes/templates.routes'));
oApp.use('/api/sessions', require('./routes/sessions.routes'));
oApp.use('/api/body', require('./routes/body.routes'));
oApp.use('/api/nutrition', require('./routes/nutrition.routes'));
oApp.use('/api/stats', require('./routes/stats.routes'));
oApp.use('/api/import', require('./routes/import.routes'));
oApp.use('/api/activity', require('./routes/activity.routes'));
oApp.use('/api/programs', require('./routes/programs.routes'));
oApp.use('/api/cycle', require('./routes/cycle.routes'));
oApp.use('/api/photos', require('./routes/photos.routes'));

oApp.get('/api/health', (tReq, tRes) => tRes.json({ ok: true }));

// Version + auto-update status (shown in Settings).
oApp.get('/api/version', (tReq, tRes) => {
  const oStatus = Object.assign({}, require('./updater').getStatus());
  if (!oStatus.version) {
    // dev run: read the version from package.json (dynamic path so it isn't
    // bundled into the exe, where FITTRACK_VERSION is set at build time instead)
    try { oStatus.version = require(path.join(__dirname, '..', 'package.json')).version; } catch (tErr) { /* n/a */ }
  }
  tRes.json(oStatus);
});

// Serve the mkcert root CA so a phone can install + trust it (needed for native
// apps like the watch's Health exporter, which won't accept an untrusted cert).
const sCaRoot = process.env.CAROOT
  || path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'mkcert');
oApp.get(['/rootCA.pem', '/rootCA.crt'], (tReq, tRes) => {
  const sFile = path.join(sCaRoot, 'rootCA.pem');
  if (!fs.existsSync(sFile)) return tRes.status(404).send('rootCA.pem not found on the server');
  tRes.setHeader('Content-Type', 'application/x-x509-ca-cert');
  tRes.setHeader('Content-Disposition', 'attachment; filename="FitTrack-rootCA.crt"');
  return tRes.send(fs.readFileSync(sFile));
});

// Uploaded media (progress photos, set videos). Random UUID filenames, cached
// long since they're immutable; express.static handles Range requests so video
// seeking works. Served before the SPA fallback so /uploads/* isn't swallowed.
const { sUploadsDir } = require('./upload');
oApp.use('/uploads', express.static(sUploadsDir, { maxAge: '30d', immutable: true }));

// Static SPA. In a packaged .exe the front-end is served from the embedded blob;
// in a normal run it's served from the public/ directory on disk. no-cache so
// app updates take effect on a normal refresh.
const sPublicDir = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

if (oAssets.isSea) {
  const oFiles = oAssets.publicFiles(); // { '/index.html': Buffer, ... }
  const sIndex = oFiles['/index.html'];
  const serveFile = (tRes, sPath, oBuf) => {
    tRes.setHeader('Content-Type', MIME[path.extname(sPath).toLowerCase()] || 'application/octet-stream');
    tRes.setHeader('Cache-Control', 'no-cache');
    tRes.end(oBuf);
  };
  oApp.use((tReq, tRes, tNext) => {
    if (tReq.method !== 'GET' && tReq.method !== 'HEAD') return tNext();
    const sPath = tReq.path === '/' ? '/index.html' : tReq.path;
    if (oFiles[sPath]) return serveFile(tRes, sPath, oFiles[sPath]);
    tNext();
  });
  oApp.get(/^\/(?!api\/).*/, (tReq, tRes) => serveFile(tRes, '/index.html', sIndex));
} else {
  oApp.use(express.static(sPublicDir, {
    setHeaders: (tRes) => tRes.setHeader('Cache-Control', 'no-cache'),
  }));
  oApp.get(/^\/(?!api\/).*/, (tReq, tRes) => {
    tRes.setHeader('Cache-Control', 'no-cache');
    tRes.sendFile(path.join(sPublicDir, 'index.html'));
  });
}

// JSON error handler
// eslint-disable-next-line no-unused-vars
oApp.use((tErr, tReq, tRes, tNext) => {
  const iStatus = tErr.iStatus || 500;
  if (iStatus >= 500) console.error(tErr);
  tRes.status(iStatus).json({ error: tErr.message || 'Something went wrong' });
});

// --- system tray icon (packaged .exe on Windows) ------------------------------
// Spawns a hidden PowerShell that shows a NotifyIcon with Open/Quit. The icon is
// written to the data dir so the PowerShell command stays small.
function trayScript(sIcoPath, sUrl, iPid) {
  const sIco = sIcoPath.replace(/'/g, "''");
  return `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = New-Object System.Drawing.Icon('${sIco}')
$ni.Text = 'FitTrack'
$ni.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add('Open FitTrack', $null, { Start-Process '${sUrl}' })
[void]$menu.Items.Add('Quit FitTrack', $null, { try { Stop-Process -Id ${iPid} -Force } catch {}; $ni.Visible=$false; [System.Windows.Forms.Application]::Exit() })
$ni.ContextMenuStrip = $menu
$ni.add_MouseDoubleClick({ Start-Process '${sUrl}' })
$ni.ShowBalloonTip(3000, 'FitTrack', 'Running in the tray - double-click to open.', [System.Windows.Forms.ToolTipIcon]::Info)
[System.Windows.Forms.Application]::Run()
$ni.Dispose()
`;
}

function startTray(sUrl) {
  if (process.platform !== 'win32') return;
  let sIcoPath;
  try {
    sIcoPath = path.join(oConfig.sDataDir, 'tray.ico');
    fs.writeFileSync(sIcoPath, oAssets.readBuffer('public/favicon.ico'));
  } catch (tErr) { return; }
  try {
    const sEnc = Buffer.from(trayScript(sIcoPath, sUrl, process.pid), 'utf16le').toString('base64');
    // Detached so the icon's message loop is independent of this windowless
    // background server's context; the icon stays put until you pick "Quit
    // FitTrack". -Sta keeps WinForms happy. (No health-check timer — it would
    // false-kill the icon when localhost resolves to IPv6.)
    const oTray = spawn('powershell', ['-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', sEnc], { detached: true, stdio: 'ignore', windowsHide: true });
    oTray.unref();
    // Remove the icon if the server exits cleanly (e.g. a crash with an exit handler).
    const killTray = () => { try { oTray.kill(); } catch (tErr) { /* gone */ } };
    process.on('exit', killTray);
    for (const sSig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
      process.on(sSig, () => { killTray(); process.exit(0); });
    }
  } catch (tErr) { /* tray is optional */ }
}

// --- start: prefer HTTPS (needed for the phone camera / barcode scanner) ------
function readCerts() {
  const sKey = path.join(oConfig.sCertDir, 'key.pem');
  const sCert = path.join(oConfig.sCertDir, 'cert.pem');
  if (fs.existsSync(sKey) && fs.existsSync(sCert)) {
    return { key: fs.readFileSync(sKey), cert: fs.readFileSync(sCert) };
  }
  return null;
}

const oCerts = readCerts();
if (oCerts) {
  https.createServer(oCerts, oApp).listen(oConfig.iPort, oConfig.sHost, () => {
    console.log(`FitTrack (HTTPS) on https://${oConfig.sHost}:${oConfig.iPort}`);
  });
  // Also a plain-HTTP listener (port+1) for native apps that can't trust the
  // local mkcert certificate — e.g. the watch's Health exporter. The browser
  // app keeps using HTTPS (the camera/barcode needs a secure context).
  const iHttpPort = parseInt(process.env.HTTP_PORT || String(oConfig.iPort + 1), 10);
  http.createServer(oApp).listen(iHttpPort, oConfig.sHost, () => {
    console.log(`FitTrack (HTTP, for device sync) on http://${oConfig.sHost}:${iHttpPort}`);
  });
} else {
  http.createServer(oApp).listen(oConfig.iPort, oConfig.sHost, () => {
    const sUrl = 'http://localhost:' + oConfig.iPort;
    if (oConfig.bSea) {
      console.log('FitTrack running in the background on ' + sUrl + ' (data in ' + oConfig.sDataDir + ')');
      // Open the browser only when this isn't the background relaunch (the
      // launcher process already opened it for the packaged exe).
      if (process.env.FITTRACK_BG !== '1') {
        try { spawn('cmd', ['/c', 'start', '', sUrl], { detached: true, stdio: 'ignore' }).unref(); }
        catch (tErr) { /* ignore */ }
      }
      startTray(sUrl);
      // Check GitHub for a newer build (applies on next launch). Fire-and-forget.
      try { require('./updater').checkForUpdate().catch(() => {}); } catch (tErr) { /* ignore */ }
    } else {
      console.warn('No certs found in ' + oConfig.sCertDir + ' — starting HTTP. Camera/barcode will not work until you add mkcert certs.');
      console.log('FitTrack (HTTP) on ' + sUrl);
    }
  });
}
