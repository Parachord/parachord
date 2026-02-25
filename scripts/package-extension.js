#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'parachord-extension');
const OUT_DIR = path.join(ROOT, 'dist');

// Files that should not be included in the Chrome Web Store package
const EXCLUDE = [
  'README.md',
  '.DS_Store',
  '*.map',
];

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

function build(manifest) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const zipName = `parachord-extension-v${manifest.version}.zip`;
  const zipPath = path.join(OUT_DIR, zipName);

  // Remove previous build if it exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // Build the exclude flags for zip
  const excludeFlags = EXCLUDE.map(p => `-x '${p}'`).join(' ');

  execSync(
    `cd "${EXT_DIR}" && zip -r "${zipPath}" . ${excludeFlags}`,
    { stdio: 'inherit' }
  );

  const stats = fs.statSync(zipPath);
  const sizeKB = (stats.size / 1024).toFixed(1);

  console.log(`\n  Output:   dist/${zipName} (${sizeKB} KB)`);

  return zipPath;
}

console.log('\nPackaging Parachord browser extension...\n');

const manifest = validate();
const zipPath = build(manifest);

console.log('\nDone. Upload this file to the Chrome Web Store Developer Dashboard.\n');
