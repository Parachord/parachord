/**
 * Post-build: notarize and staple distribution artifacts (DMG, ZIP).
 *
 * On macOS Sequoia (15+), Gatekeeper checks the downloaded artifact itself
 * (DMG/ZIP), not just the .app inside.  If the DMG is not notarized,
 * Gatekeeper shows "damaged and can't be opened" even though the .app
 * inside is properly signed and notarized.
 *
 * This script runs AFTER electron-builder finishes creating the DMG/ZIP.
 * The .app is already notarized by the afterSign hook (scripts/notarize.js).
 * This script notarizes the outer DMG so Gatekeeper accepts it on Sequoia.
 *
 * Usage:
 *   node scripts/notarize-artifacts.js
 *
 * Required environment variables:
 *   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 */

require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DIST_DIR = path.join(__dirname, '..', 'dist');

async function main() {
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping artifact notarization: missing Apple credentials');
    return;
  }

  // Find DMG files to notarize
  const files = fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.dmg'));

  if (files.length === 0) {
    console.log('No DMG files found in dist/ — nothing to notarize');
    return;
  }

  for (const file of files) {
    const filePath = path.join(DIST_DIR, file);
    console.log(`Notarizing ${file}...`);

    try {
      // Submit for notarization and wait
      execSync(
        `xcrun notarytool submit "${filePath}" ` +
        `--apple-id "${appleId}" ` +
        `--password "${appleIdPassword}" ` +
        `--team-id "${teamId}" ` +
        `--wait`,
        { stdio: 'inherit', timeout: 600000 }
      );
      console.log(`✓ ${file} notarization accepted`);

      // Staple the ticket to the DMG
      execSync(`xcrun stapler staple "${filePath}"`, {
        stdio: 'inherit',
        timeout: 60000,
      });
      console.log(`✓ ${file} stapled`);

      // Validate
      try {
        execSync(`xcrun stapler validate "${filePath}" 2>&1`, {
          encoding: 'utf-8',
          timeout: 30000,
        });
        console.log(`✓ ${file} staple validation passed`);
      } catch {
        console.warn(`⚠ ${file} staple validation failed (non-fatal)`);
      }
    } catch (error) {
      console.error(`✗ Failed to notarize ${file}:`, error.message);
      // Log the notarization log for debugging
      try {
        // Get the submission ID from the error output to fetch the log
        console.log('Fetching notarization log...');
        execSync(
          `xcrun notarytool log "${filePath}" ` +
          `--apple-id "${appleId}" ` +
          `--password "${appleIdPassword}" ` +
          `--team-id "${teamId}" 2>&1`,
          { stdio: 'inherit', timeout: 60000 }
        );
      } catch {
        // log fetch failed — not critical
      }
      throw error;
    }
  }

  console.log('✓ All artifacts notarized');
}

main().catch(err => {
  console.error('Artifact notarization failed:', err.message);
  process.exit(1);
});
