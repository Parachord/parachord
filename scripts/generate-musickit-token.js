#!/usr/bin/env node
/**
 * MusicKit Developer Token Generator
 *
 * Usage:
 *   node generate-musickit-token.js /path/to/AuthKey_437JVHZMMK.p8
 *
 * Or place the .p8 file in this directory and run:
 *   node generate-musickit-token.js
 *
 * The key ID is taken from the file name (AuthKey_<KEY_ID>.p8), which is how
 * Apple names downloaded keys, so rotating the key doesn't require editing
 * this file. MUSICKIT_KEY_ID in the environment overrides it; the constant
 * below is the last resort and must match MUSICKIT_KEY_ID in main.js.
 */

const fs = require('fs');
const path = require('path');

// Your Apple Developer credentials. KEY_ID must match main.js (parachord#968:
// this file used to say 7CLCZTCCQ6, the key that was rotated out, and minted
// tokens Apple silently rejected).
const TEAM_ID = 'YR3XETE537';
const KEY_ID = '437JVHZMMK';

// Prefer the key ID encoded in Apple's file name, then the environment, then the constant.
function resolveKeyId(privateKeyPath) {
  const fromName = (path.basename(privateKeyPath).match(/^AuthKey_([A-Z0-9]{10})\.p8$/i) || [])[1];
  return fromName || process.env.MUSICKIT_KEY_ID || KEY_ID;
}

// Token validity (max 6 months = 15777000 seconds)
const TOKEN_EXPIRY_DAYS = 180;

async function generateToken(privateKeyPath, keyId) {
  // Dynamic import for ES module
  const jose = await import('jose');

  // Read the private key
  let privateKeyContent;
  try {
    privateKeyContent = fs.readFileSync(privateKeyPath, 'utf8');
  } catch (err) {
    console.error('Error reading private key file:', err.message);
    process.exit(1);
  }

  // Import the private key
  const privateKey = await jose.importPKCS8(privateKeyContent, 'ES256');

  // Calculate expiry
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + (TOKEN_EXPIRY_DAYS * 24 * 60 * 60);

  // Generate the JWT
  const token = await new jose.SignJWT({})
    .setProtectedHeader({
      alg: 'ES256',
      kid: keyId
    })
    .setIssuer(TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(expiry)
    .sign(privateKey);

  return token;
}

// Find the .p8 file
function findPrivateKey() {
  // Check command line argument first
  if (process.argv[2]) {
    return process.argv[2];
  }

  // Look for .p8 files in current directory and scripts directory
  const searchDirs = [
    process.cwd(),
    __dirname,
    path.join(__dirname, '..')
  ];

  for (const dir of searchDirs) {
    try {
      const files = fs.readdirSync(dir);
      const p8File = files.find(f => f.endsWith('.p8'));
      if (p8File) {
        return path.join(dir, p8File);
      }
    } catch (e) {
      // Directory not accessible, skip
    }
  }

  return null;
}

async function main() {
  console.log('MusicKit Developer Token Generator');
  console.log('===================================');
  console.log(`Team ID: ${TEAM_ID}`);

  const keyPath = findPrivateKey();

  if (!keyPath) {
    console.error('Error: Could not find .p8 private key file.');
    console.error('');
    console.error('Usage:');
    console.error('  node generate-musickit-token.js /path/to/AuthKey_437JVHZMMK.p8');
    console.error('');
    console.error('Or place the .p8 file in the current directory.');
    process.exit(1);
  }

  const keyId = resolveKeyId(keyPath);
  console.log(`Key ID:  ${keyId}${keyId !== KEY_ID ? ' (from file name / env; main.js uses ' + KEY_ID + ')' : ''}`);
  console.log(`Using private key: ${keyPath}`);
  console.log('');

  try {
    const token = await generateToken(keyPath, keyId);

    console.log('Generated MusicKit Developer Token:');
    console.log('====================================');
    console.log('');
    console.log(token);
    console.log('');
    console.log(`Token expires in ${TOKEN_EXPIRY_DAYS} days.`);
    console.log('');
    console.log('Add this token to Parachord:');
    console.log('  Settings → Resolvers → Apple Music → MusicKit Developer Token');

  } catch (err) {
    console.error('Error generating token:', err.message);
    process.exit(1);
  }
}

main();
