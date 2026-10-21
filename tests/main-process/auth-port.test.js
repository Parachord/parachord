/**
 * Local server port (parachord#958). The port used to be hardcoded to 8888
 * in the listener, four redirect-URI sites and the settings copy. These
 * cover the pure helpers and pin that no hardcoded 8888 redirect URI comes
 * back in main or the renderer: a stray one would send a sign-in to a port
 * nothing listens on whenever the user picked another one.
 */

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_AUTH_PORT,
  normalizeAuthPort,
  resolveAuthPort,
  loopbackRedirectUri,
  soundCloudSignInAllowed,
} = require('../../main-process/auth-port');

describe('normalizeAuthPort', () => {
  test('accepts integers and numeric strings in 1024–65535', () => {
    expect(normalizeAuthPort(8890)).toBe(8890);
    expect(normalizeAuthPort('8890')).toBe(8890);
    expect(normalizeAuthPort(' 18888 ')).toBe(18888);
    expect(normalizeAuthPort(1024)).toBe(1024);
    expect(normalizeAuthPort(65535)).toBe(65535);
  });

  test('rejects privileged, out-of-range, fractional and junk values', () => {
    for (const bad of [0, 80, 1023, 65536, 70000, -1, 8888.5, '88a8', 'abc', NaN, Infinity, null, undefined, '', {}, []]) {
      expect(normalizeAuthPort(bad)).toBeNull();
    }
  });

  test('rejects 9876, the browser-extension server port', () => {
    expect(normalizeAuthPort(9876)).toBeNull();
    expect(normalizeAuthPort('9876')).toBeNull();
  });
});

describe('resolveAuthPort', () => {
  test('defaults to 8888 so an untouched install behaves exactly as before', () => {
    expect(DEFAULT_AUTH_PORT).toBe(8888);
    expect(resolveAuthPort({})).toBe(8888);
    expect(resolveAuthPort()).toBe(8888);
  });

  test('stored setting beats AUTH_SERVER_PORT, which beats the default', () => {
    expect(resolveAuthPort({ stored: 18888, env: '19999' })).toBe(18888);
    expect(resolveAuthPort({ stored: undefined, env: '19999' })).toBe(19999);
  });

  test('an invalid value falls through instead of stopping the server', () => {
    expect(resolveAuthPort({ stored: 80, env: '19999' })).toBe(19999);
    expect(resolveAuthPort({ stored: 'junk', env: 'also junk' })).toBe(8888);
    expect(resolveAuthPort({ stored: 9876 })).toBe(8888);
  });
});

describe('redirect URIs', () => {
  test('use the 127.0.0.1 literal the listener binds (Spotify rejects localhost)', () => {
    expect(loopbackRedirectUri(8888, '/callback')).toBe('http://127.0.0.1:8888/callback');
    expect(loopbackRedirectUri(18888, '/callback/soundcloud')).toBe('http://127.0.0.1:18888/callback/soundcloud');
  });

  test('SoundCloud sign-in on a custom port needs the user\'s own app', () => {
    expect(soundCloudSignInAllowed({ source: 'fallback', port: 8888 })).toBe(true);
    expect(soundCloudSignInAllowed({ source: 'env', port: 8888 })).toBe(true);
    expect(soundCloudSignInAllowed({ source: 'user', port: 18888 })).toBe(true);
    expect(soundCloudSignInAllowed({ source: 'fallback', port: 18888 })).toBe(false);
    expect(soundCloudSignInAllowed({ source: 'env', port: 18888 })).toBe(false);
  });
});

describe('no hardcoded port survives', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

  test('main.js binds and builds redirect URIs from the resolved port', () => {
    expect(main).not.toMatch(/listen\(8888/);
    expect(main).not.toMatch(/127\.0\.0\.1:8888/);
    expect(main).toMatch(/expressApp\.listen\(port, '127\.0\.0\.1'/);
  });

  test('the Spotify authorize request and token exchange share one redirect URI helper', () => {
    // Spotify rejects the token exchange unless both carry byte-identical URIs.
    const spotifyUses = main.match(/const redirectUri = spotifyRedirectUri\(\);/g) || [];
    const soundCloudUses = main.match(/const redirectUri = soundCloudRedirectUri\(\);/g) || [];
    expect(spotifyUses.length).toBe(2);
    expect(soundCloudUses.length).toBe(2);
  });

  test('the renderer shows the bound port in every redirect URI', () => {
    expect(renderer).not.toMatch(/(127\.0\.0\.1|\[::1\]):8888\//);
  });
});
