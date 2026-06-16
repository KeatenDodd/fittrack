'use strict';
// Publish a new release so installed FitTrack.exe copies auto-update.
// Flow:  npm version patch     (bumps package.json + git tag)
//        npm run release       (builds the exe and uploads it to GitHub)
// Requires the GitHub CLI (`gh`) installed and authenticated (`gh auth login`),
// and a "repository" set in package.json.
const { execSync } = require('child_process');
const path = require('path');
const oPkg = require(path.join(__dirname, '..', 'package.json'));

const sTag = 'v' + oPkg.version;
const sRepo = typeof oPkg.repository === 'string' ? oPkg.repository : (oPkg.repository && oPkg.repository.url) || '';
if (!sRepo || sRepo.includes('YOUR_')) {
  console.error('Set "repository" in package.json to your GitHub repo first (e.g. "github:me/fittrack").');
  process.exit(1);
}

console.log('Building ' + sTag + '…');
execSync('npm run build:exe', { stdio: 'inherit' });

console.log('Publishing ' + sTag + ' to GitHub…');
execSync('gh release create ' + sTag + ' "dist/FitTrack.exe" --title "' + sTag + '" --notes "FitTrack ' + sTag + '"',
  { stdio: 'inherit' });

console.log('\nReleased ' + sTag + '. Installed apps will update on their next launch.');
