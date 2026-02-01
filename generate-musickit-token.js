#!/usr/bin/env node
/**
 * MusicKit Developer Token Generator
 *
 * Usage:
 *   1. Download your MusicKit private key (.p8 file) from Apple Developer Portal
 *   2. Set the environment variables or edit the values below
 *   3. Run: node generate-musickit-token.js
 *
 * Required values:
 *   - MUSICKIT_KEY_PATH: Path to your .p8 private key file
 *   - MUSICKIT_KEY_ID: Your MusicKit Key ID (10 characters)
 *   - MUSICKIT_TEAM_ID: Your Apple Developer Team ID (10 characters)
 */

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Configuration - edit these or use environment variables
const KEY_PATH = process.env.MUSICKIT_KEY_PATH || './AuthKey_XXXXXXXXXX.p8';
const KEY_ID = process.env.MUSICKIT_KEY_ID || 'XXXXXXXXXX';   // Your Key ID from Apple Developer
const TEAM_ID = process.env.MUSICKIT_TEAM_ID || 'XXXXXXXXXX'; // Your Team ID from Apple Developer

// Token expiration (max 6 months = 180 days)
const EXPIRATION_DAYS = 180;

function generateToken() {
  // Check if key file exists
  const keyPath = path.resolve(KEY_PATH);
  if (!fs.existsSync(keyPath)) {
    console.error(`\nError: Private key file not found at: ${keyPath}\n`);
    console.log('To generate a MusicKit token:');
    console.log('1. Go to Apple Developer Portal → Certificates, Identifiers & Profiles → Keys');
    console.log('2. Create a new key with MusicKit enabled');
    console.log('3. Download the .p8 file (you can only download it once!)');
    console.log('4. Place the .p8 file in this directory or set MUSICKIT_KEY_PATH');
    console.log('5. Set your Key ID and Team ID below or via environment variables\n');
    console.log('Environment variables:');
    console.log('  MUSICKIT_KEY_PATH=/path/to/AuthKey_XXXXXX.p8');
    console.log('  MUSICKIT_KEY_ID=your_key_id');
    console.log('  MUSICKIT_TEAM_ID=your_team_id\n');
    process.exit(1);
  }

  // Validate Key ID and Team ID
  if (KEY_ID === 'XXXXXXXXXX' || KEY_ID.length !== 10) {
    console.error('\nError: Invalid Key ID. Please set MUSICKIT_KEY_ID to your 10-character Key ID.\n');
    process.exit(1);
  }

  if (TEAM_ID === 'XXXXXXXXXX' || TEAM_ID.length !== 10) {
    console.error('\nError: Invalid Team ID. Please set MUSICKIT_TEAM_ID to your 10-character Team ID.\n');
    process.exit(1);
  }

  // Read the private key
  const privateKey = fs.readFileSync(keyPath);

  // Generate the JWT
  const token = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    expiresIn: `${EXPIRATION_DAYS}d`,
    issuer: TEAM_ID,
    header: {
      alg: 'ES256',
      kid: KEY_ID
    }
  });

  // Calculate expiration date
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + EXPIRATION_DAYS);

  console.log('\n=== MusicKit Developer Token ===\n');
  console.log(token);
  console.log('\n================================\n');
  console.log(`Key ID: ${KEY_ID}`);
  console.log(`Team ID: ${TEAM_ID}`);
  console.log(`Expires: ${expirationDate.toDateString()}`);
  console.log('\nCopy the token above and paste it into the Apple Music resolver settings.');
  console.log('(Settings → Resolvers → Apple Music → Developer Token)\n');

  return token;
}

generateToken();
