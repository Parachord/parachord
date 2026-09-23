/**
 * Build native helpers before packaging
 * This script compiles platform-specific native code
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');

function buildMusicKitHelper() {
  const helperDir = path.join(ROOT_DIR, 'native', 'musickit-helper');
  const buildScript = path.join(helperDir, 'build.sh');
  const outputDir = path.join(ROOT_DIR, 'resources', 'bin', 'darwin');
  const outputApp = path.join(outputDir, 'MusicKitHelper.app');

  // Check if we're on macOS
  if (process.platform !== 'darwin') {
    console.log('⏭️  Skipping MusicKit helper build: not on macOS');
    return;
  }

  // Check if build script exists
  if (!fs.existsSync(buildScript)) {
    console.error('❌ MusicKit helper build script not found:', buildScript);
    return;
  }

  // Check if already built (skip if up to date). Compare against the NEWEST
  // input, not just the Swift source — build.sh copies Info.plist and signs
  // with the entitlements, so an edit to either (e.g. the parachord#976
  // display-name rename) must trigger a rebuild. Previously only the .swift
  // mtime was checked, so a plist-only change was silently skipped locally.
  const inputs = [
    path.join(helperDir, 'Sources', 'MusicKitHelperApp.swift'),
    path.join(helperDir, 'Info.plist'),
    path.join(helperDir, 'MusicKitHelper.entitlements'),
    path.join(helperDir, 'Package.swift'),
    buildScript,
  ].filter((p) => fs.existsSync(p));
  if (fs.existsSync(outputApp)) {
    const newestInput = Math.max(...inputs.map((p) => fs.statSync(p).mtimeMs));
    const outputStats = fs.statSync(outputApp);
    if (outputStats.mtimeMs > newestInput) {
      console.log('✅ MusicKit helper already up to date');
      return;
    }
  }

  console.log('🔨 Building MusicKit helper...');

  try {
    execSync('bash build.sh', {
      cwd: helperDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Pass through signing identity if set
        APPLE_SIGNING_IDENTITY: process.env.APPLE_SIGNING_IDENTITY || '',
        // Pass through electron-builder's cert env vars so build.sh can
        // extract the identity from the .p12 if it's not in the keychain yet
        CSC_LINK: process.env.CSC_LINK || '',
        CSC_KEY_PASSWORD: process.env.CSC_KEY_PASSWORD || '',
      }
    });
    console.log('✅ MusicKit helper built successfully');
  } catch (error) {
    console.error('❌ Failed to build MusicKit helper:', error.message);
    // Don't throw - allow build to continue without native helper
    // Users can still use MusicKit JS or iTunes Search API
  }
}

// Main execution
console.log('');
console.log('=== Building Native Helpers ===');
console.log('');

buildMusicKitHelper();

console.log('');
console.log('=== Native Build Complete ===');
console.log('');
