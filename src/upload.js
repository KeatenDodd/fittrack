'use strict';
// Minimal raw-body upload: stream the request directly to disk so large set
// videos never get buffered in memory or hit the JSON body limit. No multer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { httpError } = require('./util');
const oConfig = require('./config');

const sUploadsDir = process.env.UPLOAD_DIR || path.join(oConfig.sDataDir, 'uploads');
fs.mkdirSync(sUploadsDir, { recursive: true });

const EXT = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/heic': '.heic', 'image/heif': '.heif', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'video/x-matroska': '.mkv', 'video/3gpp': '.3gp',
};
function extFor(sMime) {
  if (EXT[sMime]) return EXT[sMime];
  return sMime.startsWith('video/') ? '.vid' : '.img';
}

// Reverse lookup so we can recover a media type from a filename extension when
// the browser sends a generic/empty content-type (common for camera clips).
const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.qt': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.3gp': 'video/3gpp', '.3gpp': 'video/3gpp',
};
function mimeFromName(sName) {
  const oM = String(sName || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
  return oM ? (MIME_BY_EXT[oM[1]] || '') : '';
}

// Stream req body to <uploads>/<sub>/<uuid>.<ext>. Validates the content-type
// prefix and enforces a byte cap. Resolves { relPath, mime, bytes }.
function saveUpload(tReq, sSub, aAllowedPrefixes, iMaxBytes) {
  return new Promise((resolve, reject) => {
    let sMime = String(tReq.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    // Recover the type from the filename when the content-type is missing or a
    // generic octet-stream (some phones label camera clips this way).
    if (!sMime || !aAllowedPrefixes.some((p) => sMime.startsWith(p))) {
      const sName = tReq.headers['x-file-name'] ? decodeURIComponent(tReq.headers['x-file-name']) : '';
      const sGuess = mimeFromName(sName);
      if (sGuess && aAllowedPrefixes.some((p) => sGuess.startsWith(p))) sMime = sGuess;
      else return reject(httpError(415, 'Unsupported file type'));
    }
    const sDir = path.join(sUploadsDir, sSub);
    fs.mkdirSync(sDir, { recursive: true });
    const sName = crypto.randomUUID() + extFor(sMime);
    const sAbs = path.join(sDir, sName);
    const oWrite = fs.createWriteStream(sAbs);

    let iBytes = 0;
    let bDone = false;
    const fail = (tErr) => {
      if (bDone) return; bDone = true;
      try { oWrite.destroy(); } catch (e) { /* ignore */ }
      fs.unlink(sAbs, () => {});
      reject(tErr);
    };

    tReq.on('data', (oChunk) => {
      iBytes += oChunk.length;
      if (iBytes > iMaxBytes) { tReq.unpipe(oWrite); tReq.destroy(); fail(httpError(413, 'File is too large')); }
    });
    tReq.on('error', () => fail(httpError(400, 'Upload interrupted')));
    oWrite.on('error', () => fail(httpError(500, 'Could not save the file')));
    oWrite.on('finish', () => {
      if (bDone) return;
      if (iBytes === 0) { bDone = true; fs.unlink(sAbs, () => {}); return reject(httpError(400, 'Empty upload')); }
      bDone = true;
      resolve({ relPath: sSub + '/' + sName, mime: sMime, bytes: iBytes });
    });

    tReq.pipe(oWrite);
  });
}

// Delete a stored file by its DB-relative path (best effort).
function removeUpload(sRelPath) {
  if (!sRelPath) return;
  const sAbs = path.join(sUploadsDir, sRelPath);
  // guard against path traversal: must resolve inside the uploads dir
  if (!sAbs.startsWith(sUploadsDir)) return;
  fs.unlink(sAbs, () => {});
}

module.exports = { sUploadsDir, saveUpload, removeUpload };
