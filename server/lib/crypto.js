const crypto = require('crypto');

/**
 * Generate a PKCE code verifier (random 32 bytes, base64url encoded)
 */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a PKCE code challenge from a verifier (SHA-256 hash, base64url encoded)
 */
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * MD5 hash helper (used by scrobblers for API signatures)
 */
function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

/**
 * Generate a random hex string for CSRF state parameters
 */
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { generateCodeVerifier, generateCodeChallenge, md5, generateState };
