#!/usr/bin/env node
'use strict';

// Parachord Native Messaging Host — Installer
//
// Registers the native messaging host manifest so Chrome, Chromium-based
// browsers, and Firefox can find and launch the host when the extension
// connects.
//
// Called automatically by the Electron app on startup, or manually:
//   node native-messaging/install.js [--extension-id=ID] [--firefox-id=ID]

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST_NAME = 'com.parachord.desktop';

// Chrome Web Store extension ID.
// Override with --extension-id=<id> for development with an unpacked extension.
const DEFAULT_EXTENSION_ID = 'gibkgapadebfoillbakpgmgpnppjlnie';

// Firefox extension ID — must match browser_specific_settings.gecko.id in the
// Firefox manifest variant.
const DEFAULT_FIREFOX_ID = 'parachord@parachord.com';

function getArg(name, fallback) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  if (arg) return arg.split('=')[1];
  return fallback;
}

// --- Platform-specific manifest paths ---

// Chromium browsers
function getChromeManifestDirs() {
  const dirs = [];
  switch (process.platform) {
    case 'darwin':
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'));
      break;
    case 'linux':
      dirs.push(path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), '.config', 'chromium', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), '.config', 'microsoft-edge', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'));
      break;
    case 'win32':
      dirs.push(path.join(os.homedir(), 'AppData', 'Roaming', 'Parachord', 'NativeMessagingHosts'));
      break;
  }
  return dirs;
}

// Firefox
function getFirefoxManifestDirs() {
  switch (process.platform) {
    case 'darwin':
      return [path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts')];
    case 'linux':
      return [path.join(os.homedir(), '.mozilla', 'native-messaging-hosts')];
    case 'win32':
      return [path.join(os.homedir(), 'AppData', 'Roaming', 'Parachord', 'NativeMessagingHosts', 'Firefox')];
    default:
      return [];
  }
}

// --- Launcher script ---
// Uses ELECTRON_RUN_AS_NODE so the Electron binary acts as a plain Node.js
// runtime — no window, no GPU process, just the relay script.

function createLauncher(electronPath, hostScriptPath) {
  const launcherDir = path.join(os.homedir(), '.parachord');
  fs.mkdirSync(launcherDir, { recursive: true });

  if (process.platform === 'win32') {
    const launcherPath = path.join(launcherDir, 'native-messaging-host.bat');
    const content = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${electronPath}" "${hostScriptPath}"\r\n`;
    fs.writeFileSync(launcherPath, content);
    return launcherPath;
  }

  // macOS / Linux
  const launcherPath = path.join(launcherDir, 'native-messaging-host');
  const content = `#!/bin/bash\nELECTRON_RUN_AS_NODE=1 exec "${electronPath}" "${hostScriptPath}"\n`;
  fs.writeFileSync(launcherPath, content, { mode: 0o755 });
  return launcherPath;
}

// --- Windows registry ---

function registerWindowsHost(manifestPath, browser) {
  const { execSync } = require('child_process');

  const regKeys = [];
  if (browser === 'chrome') {
    regKeys.push(`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`);
    regKeys.push(`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`);
  } else if (browser === 'firefox') {
    regKeys.push(`HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`);
  }

  for (const regKey of regKeys) {
    try {
      execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'ignore' });
      console.log(`  Registry: ${regKey}`);
    } catch (e) {
      console.error(`  Warning: failed to write registry key: ${e.message}`);
    }
  }
}

// --- Manifest writers ---

function writeManifest(dir, manifestJson) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const manifestPath = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, manifestJson);
    console.log(`  Manifest:     ${manifestPath}`);
    return manifestPath;
  } catch (e) {
    // Non-critical for additional directories
    return null;
  }
}

// --- Main ---

function install(electronPath, appPath) {
  // If called directly from CLI, infer paths
  if (!electronPath) {
    electronPath = process.execPath;
  }
  if (!appPath) {
    appPath = path.resolve(__dirname, '..');
  }

  const extensionId = getArg('extension-id', DEFAULT_EXTENSION_ID);
  const firefoxId = getArg('firefox-id', DEFAULT_FIREFOX_ID);
  const hostScriptPath = path.join(appPath, 'native-messaging', 'host.js');

  console.log(`Installing native messaging host: ${HOST_NAME}`);
  console.log(`  Chrome ext ID: ${extensionId}`);
  console.log(`  Firefox ID:    ${firefoxId}`);
  console.log(`  Host script:   ${hostScriptPath}`);

  // Create launcher script
  const launcherPath = createLauncher(electronPath, hostScriptPath);
  console.log(`  Launcher:      ${launcherPath}`);

  // --- Chrome / Chromium manifest ---
  const chromeManifest = JSON.stringify({
    name: HOST_NAME,
    description: 'Parachord Desktop — browser extension native messaging host',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [
      `chrome-extension://${extensionId}/`
    ]
  }, null, 2) + '\n';

  console.log('\n  Chromium browsers:');
  let primaryChromePath = null;
  for (const dir of getChromeManifestDirs()) {
    const p = writeManifest(dir, chromeManifest);
    if (!primaryChromePath && p) primaryChromePath = p;
  }

  // --- Firefox manifest ---
  const firefoxManifest = JSON.stringify({
    name: HOST_NAME,
    description: 'Parachord Desktop — browser extension native messaging host',
    path: launcherPath,
    type: 'stdio',
    allowed_extensions: [
      firefoxId
    ]
  }, null, 2) + '\n';

  console.log('\n  Firefox:');
  let primaryFirefoxPath = null;
  for (const dir of getFirefoxManifestDirs()) {
    const p = writeManifest(dir, firefoxManifest);
    if (!primaryFirefoxPath && p) primaryFirefoxPath = p;
  }

  // Windows: register via registry
  if (process.platform === 'win32') {
    if (primaryChromePath) registerWindowsHost(primaryChromePath, 'chrome');
    if (primaryFirefoxPath) registerWindowsHost(primaryFirefoxPath, 'firefox');
  }

  console.log('\n  Done.');
  return { launcherPath, chromeManifestPath: primaryChromePath, firefoxManifestPath: primaryFirefoxPath };
}

// Export for use from main.js
module.exports = { install };

// Allow running directly from CLI
if (require.main === module) {
  install();
}
