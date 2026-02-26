/**
 * After-sign hook: verify signatures and notarize the .app.
 *
 * electron-builder handles all code signing (including nested bundles like
 * MusicKitHelper.app).  This hook runs after signing to:
 *   1. Verify the overall signature is valid (diagnostic)
 *   2. Notarize the .app with Apple
 *   3. Verify stapling and Gatekeeper acceptance
 *
 * The DMG/ZIP artifacts are notarized separately in CI
 * (see scripts/notarize-artifacts.js).
 */

require('dotenv').config();
const { notarize } = require('@electron/notarize');
const { execSync } = require('child_process');
const path = require('path');

/**
 * Verify a code signature.  Returns true if valid, false otherwise.
 */
function verifySignature(targetPath) {
  try {
    execSync(
      `/usr/bin/codesign --verify --deep --strict "${targetPath}" 2>&1`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Print verbose signature info for debugging.
 */
function logSignatureInfo(targetPath, label) {
  try {
    const info = execSync(
      `/usr/bin/codesign -dvv "${targetPath}" 2>&1`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    console.log(`  [${label}] codesign -dvv:\n${info.split('\n').map(l => '    ' + l).join('\n')}`);
  } catch (err) {
    console.log(`  [${label}] codesign -dvv failed: ${err.message}`);
  }
}

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only process macOS builds
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping post-sign tasks: not macOS');
    return;
  }

  // Skip for pull request builds (code signing was skipped)
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    console.log('Skipping post-sign tasks: pull request build');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  // ── Step 1: Verify the app signature ──────────────────────────────
  if (verifySignature(appPath)) {
    console.log(`✓ ${appName}.app signature is valid`);
  } else {
    console.error(`✗ ${appName}.app signature is INVALID — notarization will likely fail`);
    logSignatureInfo(appPath, appName);
    // Also check nested MusicKitHelper for diagnostics
    const helperAppPath = path.join(
      appPath, 'Contents', 'Resources', 'bin', 'darwin', 'MusicKitHelper.app'
    );
    try {
      logSignatureInfo(helperAppPath, 'MusicKitHelper');
    } catch { /* ignore if helper doesn't exist */ }
  }

  // ── Step 2: Notarize the .app ─────────────────────────────────────
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization: missing Apple credentials');
    console.log('  APPLE_ID:', appleId ? '✓' : '✗');
    console.log('  APPLE_APP_SPECIFIC_PASSWORD:', appleIdPassword ? '✓' : '✗');
    console.log('  APPLE_TEAM_ID:', teamId ? '✓' : '✗');
    return;
  }

  console.log(`Notarizing ${appPath}...`);

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('✓ Notarization complete');
  } catch (error) {
    console.error('✗ Notarization failed:', error.message);
    throw error;
  }

  // ── Step 3: Verify stapling ───────────────────────────────────────
  try {
    execSync(`xcrun stapler validate "${appPath}" 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    console.log('✓ Staple validation passed');
  } catch (err) {
    console.warn('⚠ Staple validation failed:', err.message);
    // Not fatal — Gatekeeper can still check online
  }

  // ── Step 4: Gatekeeper assessment ─────────────────────────────────
  try {
    const output = execSync(
      `spctl --assess --type execute -vvv "${appPath}" 2>&1`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    console.log(`✓ spctl assessment passed`);
  } catch (err) {
    const output = err.stdout || err.stderr || err.message;
    console.warn(`⚠ spctl assessment failed (may be OK before DMG notarization):`);
    console.warn(`  ${output.trim()}`);
  }
};
