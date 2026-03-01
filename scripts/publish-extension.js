#!/usr/bin/env node

// Publish packaged browser extensions to the Chrome Web Store and Firefox
// Add-ons (AMO).  Expects the zip files to already exist in dist/ (run
// `npm run package:extension` first, or use `npm run publish:extension`
// which does both).
//
// Required environment variables:
//
//   Firefox / AMO:
//     WEB_EXT_API_KEY      — JWT issuer (from addons.mozilla.org/developers/addon/api/key/)
//     WEB_EXT_API_SECRET   — JWT secret
//
//   Chrome Web Store:
//     CLIENT_ID            — OAuth2 client ID
//     CLIENT_SECRET        — OAuth2 client secret
//     REFRESH_TOKEN        — OAuth2 refresh token
//
// Usage:
//   node scripts/publish-extension.js [chrome|firefox]
//
// Omit the argument to publish to both stores.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'parachord-extension', 'manifest.json'), 'utf8')
);
const version = manifest.version;

const target = process.argv[2]; // 'chrome', 'firefox', or omit for both

function run(cmd, env) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
}

// ── Firefox (AMO) ──────────────────────────────────────────────────────

function publishFirefox() {
  const key = process.env.WEB_EXT_API_KEY;
  const secret = process.env.WEB_EXT_API_SECRET;
  if (!key || !secret) {
    console.error('ERROR: WEB_EXT_API_KEY and WEB_EXT_API_SECRET must be set.');
    console.error('Generate them at https://addons.mozilla.org/en-US/developers/addon/api/key/');
    process.exit(1);
  }

  const zip = path.join(DIST, `parachord-extension-v${version}-firefox.zip`);
  if (!fs.existsSync(zip)) {
    console.error(`ERROR: ${zip} not found. Run "npm run package:extension" first.`);
    process.exit(1);
  }

  // Extract the Firefox zip to a temp directory for web-ext
  const tmp = path.join(DIST, '.firefox-tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execSync(`unzip -o "${zip}" -d "${tmp}"`, { stdio: 'inherit' });

  console.log('\n--- Submitting to Firefox Add-ons (AMO) ---');
  run(`npx web-ext sign --channel=listed --source-dir="${tmp}" --api-key="${key}" --api-secret="${secret}"`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Chrome Web Store ───────────────────────────────────────────────────

const CHROME_EXTENSION_ID = 'gibkgapadebfoillbakpgmgpnppjlnie';

function publishChrome() {
  const required = ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`ERROR: Missing environment variables: ${missing.join(', ')}`);
    console.error('See https://developer.chrome.com/docs/webstore/using-api/ for setup.');
    process.exit(1);
  }

  const zip = path.join(DIST, `parachord-extension-v${version}-chrome.zip`);
  if (!fs.existsSync(zip)) {
    console.error(`ERROR: ${zip} not found. Run "npm run package:extension" first.`);
    process.exit(1);
  }

  console.log('\n--- Uploading to Chrome Web Store ---');
  run(`npx chrome-webstore-upload-cli upload --source "${zip}"`, { EXTENSION_ID: CHROME_EXTENSION_ID });

  console.log('\n--- Publishing on Chrome Web Store ---');
  run('npx chrome-webstore-upload-cli publish', { EXTENSION_ID: CHROME_EXTENSION_ID });
}

// ── Main ───────────────────────────────────────────────────────────────

if (!target || target === 'firefox') publishFirefox();
if (!target || target === 'chrome') publishChrome();

console.log('\nDone.\n');
