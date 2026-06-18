'use strict';
// Builds a single self-contained FitTrack.exe using Node's Single Executable
// Application feature:
//   1. (re)generate the app icon
//   2. bundle the whole server (all requires) into one CJS file with esbuild
//   3. pack public/** and db/*.sql into assets.json (base64) embedded as an asset
//   4. generate the SEA blob, set the .exe icon + product info, inject the blob
// Run with:  npm run build:exe
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const esbuild = require('esbuild');
const { rcedit } = require('rcedit');

const sRoot = path.join(__dirname, '..');
const sDist = path.join(sRoot, 'dist');
fs.mkdirSync(sDist, { recursive: true });

// version + GitHub repo (for self-update), baked in from package.json
const oPkg = require(path.join(sRoot, 'package.json'));
function parseRepo(tRepo) {
  const sUrl = typeof tRepo === 'string' ? tRepo : (tRepo && tRepo.url) || '';
  let oM = sUrl.match(/github(?:\.com)?[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (!oM) oM = sUrl.match(/^([\w.-]+)\/([\w.-]+)$/);
  return oM ? oM[1] + '/' + oM[2] : '';
}
const sRepo = parseRepo(oPkg.repository);
// CI stamps an ever-increasing version (e.g. 1.0.<run#>) so each release is
// "newer" than installed copies; locally we fall back to package.json.
const sVersion = process.env.FITTRACK_VERSION || oPkg.version;

async function main() {
  // 0) (re)generate favicon.ico + the .exe icon
  console.log('1/6  Generating icons…');
  execFileSync(process.execPath, [path.join(__dirname, 'make-icon.js')], { stdio: 'inherit' });

  // 1) bundle the server (bake in version + repo for self-update)
  console.log('2/6  Bundling server with esbuild… (v' + sVersion + (sRepo ? ', repo ' + sRepo : ', no repo set') + ')');
  esbuild.buildSync({
    entryPoints: [path.join(sRoot, 'src', 'server.js')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(sDist, 'bundle.cjs'),
    external: ['node:sqlite', 'node:sea'],
    define: {
      'process.env.FITTRACK_VERSION': JSON.stringify(sVersion),
      'process.env.FITTRACK_REPO': JSON.stringify(sRepo),
    },
    legalComments: 'none',
    logLevel: 'warning',
  });

  // 2) pack static + sql assets into one base64 map
  console.log('3/6  Packing public/ and db/ assets…');
  const oAssets = {};
  const walk = (sAbsDir, sRel) => {
    for (const sEntry of fs.readdirSync(sAbsDir)) {
      const sAbs = path.join(sAbsDir, sEntry);
      const sKey = sRel + '/' + sEntry;
      if (fs.statSync(sAbs).isDirectory()) walk(sAbs, sKey);
      else oAssets[sKey] = fs.readFileSync(sAbs).toString('base64');
    }
  };
  walk(path.join(sRoot, 'public'), 'public');
  oAssets['db/schema.sql'] = fs.readFileSync(path.join(sRoot, 'db', 'schema.sql')).toString('base64');
  oAssets['db/seed.sql'] = fs.readFileSync(path.join(sRoot, 'db', 'seed.sql')).toString('base64');
  fs.writeFileSync(path.join(sDist, 'assets.json'), JSON.stringify(oAssets));
  console.log('     packed ' + Object.keys(oAssets).length + ' files');

  // 3) sea-config + blob
  const oSeaConfig = {
    main: path.join(sDist, 'bundle.cjs'),
    output: path.join(sDist, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: { 'assets.json': path.join(sDist, 'assets.json') },
  };
  fs.writeFileSync(path.join(sDist, 'sea-config.json'), JSON.stringify(oSeaConfig, null, 2));
  console.log('4/6  Generating SEA blob…');
  execFileSync(process.execPath, ['--experimental-sea-config', path.join(sDist, 'sea-config.json')],
    { stdio: 'inherit' });

  // 4) copy node.exe, set icon + product info, then inject the blob
  console.log('5/6  Copying runtime + setting icon/product info…');
  const sExe = path.join(sDist, 'FitTrack.exe');
  fs.copyFileSync(process.execPath, sExe);
  await rcedit(sExe, {
    icon: path.join(sRoot, 'build', 'FitTrack.ico'),
    'version-string': {
      ProductName: 'FitTrack',
      FileDescription: 'FitTrack — workout & nutrition tracker',
      CompanyName: 'FitTrack',
      OriginalFilename: 'FitTrack.exe',
    },
    'product-version': sVersion,
    'file-version': sVersion,
  });

  console.log('6/6  Injecting blob with postject…');
  execSync('npx --yes postject "' + sExe + '" NODE_SEA_BLOB "' + path.join(sDist, 'sea-prep.blob')
    + '" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', { stdio: 'inherit' });

  console.log('\nDone →  ' + sExe);
  console.log('Double-click it (or run it) and open http://localhost:8080');
}

main().catch((tErr) => { console.error('Build failed:', tErr.message); process.exit(1); });
