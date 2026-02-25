#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'parachord-extension');
const OUT_DIR = path.join(ROOT, 'dist');

// Files that should not be included in the store packages
const EXCLUDE = [
  'README.md',
  '.DS_Store',
  '*/.DS_Store',
  '*.map',
];

// Firefox extension ID — must match what's registered with AMO and used in
// the native messaging host manifest's allowed_extensions.
const FIREFOX_EXTENSION_ID = 'parachord@parachord.com';

function fatal(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function validate() {
  const manifestPath = path.join(EXT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fatal('manifest.json not found in parachord-extension/');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    fatal(`Expected manifest_version 3, got ${manifest.manifest_version}`);
  }
  if (!manifest.version) {
    fatal('manifest.json is missing "version"');
  }
  if (!manifest.name) {
    fatal('manifest.json is missing "name"');
  }

  // Verify all referenced files exist
  const requiredFiles = new Set();

  // Icons from manifest
  for (const size of Object.values(manifest.icons || {})) {
    requiredFiles.add(size);
  }
  // Action icons
  if (manifest.action?.default_icon) {
    for (const icon of Object.values(manifest.action.default_icon)) {
      requiredFiles.add(icon);
    }
  }
  // Popup
  if (manifest.action?.default_popup) {
    requiredFiles.add(manifest.action.default_popup);
  }
  // Service worker
  if (manifest.background?.service_worker) {
    requiredFiles.add(manifest.background.service_worker);
  }
  // Content scripts
  for (const cs of manifest.content_scripts || []) {
    for (const js of cs.js || []) {
      requiredFiles.add(js);
    }
    for (const css of cs.css || []) {
      requiredFiles.add(css);
    }
  }

  const missing = [];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(EXT_DIR, file))) {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    fatal(`Missing files referenced in manifest.json:\n  ${missing.join('\n  ')}`);
  }

  console.log(`  Name:     ${manifest.name}`);
  console.log(`  Version:  ${manifest.version}`);
  console.log(`  Files:    ${requiredFiles.size} referenced in manifest`);

  return manifest;
}

// Transform the base manifest into a Firefox-compatible one
function toFirefoxManifest(manifest) {
  const fx = JSON.parse(JSON.stringify(manifest));

  // Remove Chrome-specific key
  delete fx.key;

  // Firefox uses background.scripts, not service_worker.
  // Replace service_worker with scripts pointing to the same file.
  if (fx.background?.service_worker) {
    fx.background.scripts = [fx.background.service_worker];
    delete fx.background.service_worker;
  }

  // Add Firefox-specific settings.
  // strict_min_version bumped to 140 — required for data_collection_permissions.
  fx.browser_specific_settings = {
    gecko: {
      id: FIREFOX_EXTENSION_ID,
      strict_min_version: '140.0',
      data_collection_permissions: {
        data_not_collected: true,
        required: false
      }
    }
  };

  return fx;
}

function buildZip(manifest, suffix, tempManifest) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const zipName = `parachord-extension-v${manifest.version}${suffix}.zip`;
  const zipPath = path.join(OUT_DIR, zipName);

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  const excludeFlags = EXCLUDE.map(p => `-x '${p}'`).join(' ');

  if (tempManifest) {
    // Write a temporary manifest, build zip, then restore original
    const originalManifest = path.join(EXT_DIR, 'manifest.json');
    const backup = fs.readFileSync(originalManifest);
    fs.writeFileSync(originalManifest, JSON.stringify(tempManifest, null, 2) + '\n');
    try {
      execSync(
        `cd "${EXT_DIR}" && zip -r "${zipPath}" . ${excludeFlags}`,
        { stdio: 'inherit' }
      );
    } finally {
      fs.writeFileSync(originalManifest, backup);
    }
  } else {
    execSync(
      `cd "${EXT_DIR}" && zip -r "${zipPath}" . ${excludeFlags}`,
      { stdio: 'inherit' }
    );
  }

  const stats = fs.statSync(zipPath);
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`  Output:   dist/${zipName} (${sizeKB} KB)`);

  return zipPath;
}

// --- Main ---

const target = process.argv[2]; // 'chrome', 'firefox', or omit for both

console.log('\nPackaging Parachord browser extension...\n');

const manifest = validate();

if (!target || target === 'chrome') {
  console.log('\n--- Chrome Web Store ---');
  buildZip(manifest, '-chrome');
}

if (!target || target === 'firefox') {
  console.log('\n--- Firefox Add-ons (AMO) ---');
  const fxManifest = toFirefoxManifest(manifest);
  buildZip(fxManifest, '-firefox', fxManifest);
}

console.log('\nDone.\n');
