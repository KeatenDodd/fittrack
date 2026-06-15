'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const oConfig = require('./config');

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

oApp.get('/api/health', (tReq, tRes) => tRes.json({ ok: true }));

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

// Static SPA. no-cache = the browser must revalidate each load, so app updates
// (bug fixes) always take effect on a normal refresh instead of serving stale JS.
const sPublicDir = path.join(__dirname, '..', 'public');
oApp.use(express.static(sPublicDir, {
  setHeaders: (tRes) => tRes.setHeader('Cache-Control', 'no-cache'),
}));

// SPA fallback: any non-API GET returns index.html
oApp.get(/^\/(?!api\/).*/, (tReq, tRes) => {
  tRes.setHeader('Cache-Control', 'no-cache');
  tRes.sendFile(path.join(sPublicDir, 'index.html'));
});

// JSON error handler
// eslint-disable-next-line no-unused-vars
oApp.use((tErr, tReq, tRes, tNext) => {
  const iStatus = tErr.iStatus || 500;
  if (iStatus >= 500) console.error(tErr);
  tRes.status(iStatus).json({ error: tErr.message || 'Something went wrong' });
});

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
  console.warn('No certs found in ' + oConfig.sCertDir + ' — starting HTTP. Camera/barcode will not work until you add mkcert certs.');
  http.createServer(oApp).listen(oConfig.iPort, oConfig.sHost, () => {
    console.log(`FitTrack (HTTP) on http://${oConfig.sHost}:${oConfig.iPort}`);
  });
}
