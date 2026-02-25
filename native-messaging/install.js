#!/usr/bin/env node
'use strict';

// Parachord Native Messaging Host — Installer
//
// Registers the native messaging host manifest so Chrome (and other Chromium
// browsers) can find and launch the host when the extension connects.
//
// Called automatically by the Electron app on startup, or manually:
//   node native-messaging/install.js [--extension-id=ID]

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST_NAME = 'com.parachord.desktop';

// Default extension ID derived from the key in manifest.json.
// Override with --extension-id=<id> for development with a different key.
const DEFAULT_EXTENSION_ID = 'gffljdkpaclmggjjdkpanjddghmdogcb';

function getExtensionId() {
  const arg = process.argv.find(a => a.startsWith('--extension-id='));
  if (arg) return arg.split('=')[1];
  return DEFAULT_EXTENSION_ID;
}

// --- Platform-specific manifest paths ---
// Chrome and Chromium-based browsers share the same host lookup on most platforms.

function getManifestDir() {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
    case 'linux':
      return path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');
    case 'win32':
      return path.join(os.homedir(), 'AppData', 'Roaming', 'Parachord', 'NativeMessagingHosts');
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

// Additional browser-specific directories to also install the manifest in
function getAdditionalManifestDirs() {
  const dirs = [];
  switch (process.platform) {
    case 'darwin':
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'));
      break;
    case 'linux':
      dirs.push(path.join(os.homedir(), '.config', 'chromium', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), '.config', 'microsoft-edge', 'NativeMessagingHosts'));
      dirs.push(path.join(os.homedir(), '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'));
      break;
  }
  return dirs;
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

function registerWindowsHost(manifestPath) {
  const { execSync } = require('child_process');
  const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'ignore' });
    console.log(`  Registry: ${regKey}`);
  } catch (e) {
    console.error(`  Warning: failed to write registry key: ${e.message}`);
  }

  // Also register for Edge
  const edgeKey = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
  try {
    execSync(`reg add "${edgeKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'ignore' });
  } catch (e) {
    // Non-critical
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

  const extensionId = getExtensionId();
  const hostScriptPath = path.join(appPath, 'native-messaging', 'host.js');

  console.log(`Installing native messaging host: ${HOST_NAME}`);
  console.log(`  Extension ID: ${extensionId}`);
  console.log(`  Host script:  ${hostScriptPath}`);

  // Create launcher script
  const launcherPath = createLauncher(electronPath, hostScriptPath);
  console.log(`  Launcher:     ${launcherPath}`);

  // Build the native messaging host manifest
  const manifest = {
    name: HOST_NAME,
    description: 'Parachord Desktop — browser extension native messaging host',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [
      `chrome-extension://${extensionId}/`
    ]
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';

  // Install to primary Chrome directory
  const primaryDir = getManifestDir();
  const manifestFilename = `${HOST_NAME}.json`;

  function writeManifest(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const manifestPath = path.join(dir, manifestFilename);
      fs.writeFileSync(manifestPath, manifestJson);
      console.log(`  Manifest:     ${manifestPath}`);
      return manifestPath;
    } catch (e) {
      // Non-critical for additional directories
      return null;
    }
  }

  const primaryManifestPath = writeManifest(primaryDir);

  // Install to additional browser directories
  for (const dir of getAdditionalManifestDirs()) {
    writeManifest(dir);
  }

  // Windows: also register via registry
  if (process.platform === 'win32' && primaryManifestPath) {
    registerWindowsHost(primaryManifestPath);
  }

  console.log('  Done.');
  return { launcherPath, manifestPath: primaryManifestPath };
}

// Export for use from main.js
module.exports = { install };

// Allow running directly from CLI
if (require.main === module) {
  install();
}
