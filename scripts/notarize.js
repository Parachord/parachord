/**
 * After-sign hook: verify nested bundle signatures and notarize.
 *
 * electron-builder's signing step can break nested .app bundles that live in
 * extraResources (like MusicKitHelper.app).  It re-signs the inner Mach-O
 * binary with entitlementsInherit but may not re-seal the nested .app bundle's
 * CodeResources, leaving an internally-inconsistent signature that Gatekeeper
 * rejects as "damaged."
 *
 * This hook runs after electron-builder's signing step.  It verifies the
 * signature, re-signs if necessary (innermost → outermost), and then submits
 * the .app for notarization.  The DMG is notarized separately in the CI
 * workflow (see scripts/notarize-artifacts.js).
 */

require('dotenv').config();
const { notarize } = require('@electron/notarize');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Find the Developer ID signing identity from the keychain.
 */
function findSigningIdentity() {
  try {
    const output = execSync('security find-identity -v -p codesigning', {
      encoding: 'utf-8',
      timeout: 10000,
    });
    const match = output.match(/"(Developer ID Application[^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

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
 * Run spctl --assess to check Gatekeeper acceptance.
 * Returns { accepted: bool, output: string }.
 */
function assessGatekeeper(targetPath) {
  try {
    const output = execSync(
      `spctl --assess --type execute -vvv "${targetPath}" 2>&1`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    return { accepted: true, output };
  } catch (err) {
    return { accepted: false, output: err.stdout || err.stderr || err.message };
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

  // ── Step 1: Verify and fix nested MusicKitHelper.app signature ──────
  const helperAppPath = path.join(
    appPath, 'Contents', 'Resources', 'bin', 'darwin', 'MusicKitHelper.app'
  );

  if (fs.existsSync(helperAppPath)) {
    const helperValid = verifySignature(helperAppPath);

    if (helperValid) {
      console.log('✓ MusicKitHelper.app signature is valid');
    } else {
      console.log('⚠ MusicKitHelper.app signature is invalid — re-signing...');
      logSignatureInfo(helperAppPath, 'MusicKitHelper (before fix)');

      const identity = findSigningIdentity();
      if (!identity) {
        console.error('✗ Cannot re-sign: no Developer ID identity found');
      } else {
        // Use the helper's own entitlements, not the main app's
        const helperEntitlements = path.join(
          __dirname, '..', 'native', 'musickit-helper', 'MusicKitHelper.entitlements'
        );
        // Fallback to main app entitlements if helper-specific ones don't exist
        const entitlements = fs.existsSync(helperEntitlements)
          ? helperEntitlements
          : path.join(__dirname, '..', 'build', 'entitlements.mac.plist');

        console.log(`  Entitlements: ${path.basename(entitlements)}`);

        // Re-sign the nested helper bundle (innermost first)
        console.log(`  Signing MusicKitHelper.app with: ${identity}`);
        execSync(
          `/usr/bin/codesign --force --sign "${identity}" ` +
          `--entitlements "${entitlements}" --options runtime ` +
          `--timestamp "${helperAppPath}"`,
          { stdio: 'inherit', timeout: 60000 }
        );

        // Re-sign the main app (outermost — seals the updated helper)
        const mainEntitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
        console.log(`  Re-signing ${appName}.app...`);
        execSync(
          `/usr/bin/codesign --force --sign "${identity}" ` +
          `--entitlements "${mainEntitlements}" --options runtime ` +
          `--timestamp "${appPath}"`,
          { stdio: 'inherit', timeout: 60000 }
        );

        // Final verification
        if (verifySignature(appPath)) {
          console.log('✓ Re-signed and verified successfully');
        } else {
          console.error('✗ Signature still invalid after re-signing');
          logSignatureInfo(appPath, 'Parachord (after re-sign)');
          logSignatureInfo(helperAppPath, 'MusicKitHelper (after re-sign)');
        }
      }
    }
  } else {
    console.log('ℹ No MusicKitHelper.app found (skipping nested bundle check)');
  }

  // ── Step 2: Verify the overall app signature ────────────────────────
  if (verifySignature(appPath)) {
    console.log(`✓ ${appName}.app signature is valid`);
  } else {
    console.error(`✗ ${appName}.app signature is INVALID — notarization will likely fail`);
    logSignatureInfo(appPath, appName);
  }

  // ── Step 3: Notarize the .app ───────────────────────────────────────
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

  // ── Step 4: Verify stapling ─────────────────────────────────────────
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

  // ── Step 5: Gatekeeper assessment ───────────────────────────────────
  const assessment = assessGatekeeper(appPath);
  if (assessment.accepted) {
    console.log(`✓ spctl assessment passed`);
  } else {
    console.warn(`⚠ spctl assessment failed (may be OK before DMG notarization):`);
    console.warn(`  ${assessment.output.trim()}`);
  }
};
