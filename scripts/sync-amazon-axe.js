// One-shot: rewrite the amazonmusic .axe lookupPlaylist (sign-in prompt only
// for not-signed-in; trackCount passthrough), bump its version, and sync the
// marketplace manifest + the app.js FALLBACK_RESOLVERS copy.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const lookupPlaylist = `async function(url, config) {
  var mapResult = function(p) {
    return {
      id: 'amazonmusic-playlist-' + (p.id || ''),
      name: p.name || 'Amazon Music Playlist',
      owner: p.owner || null,
      albumArt: p.albumArt || null,
      // The bridge reports the playlist's own trackCount; keep it so a
      // server-truncated import is visible instead of silently complete.
      trackCount: p.trackCount || p.tracks.length,
      url: url,
      tracks: p.tracks.map(function(t) {
        return {
          id: 'amazonmusic-' + t.asin,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration || 0,
          sources: ['amazonmusic'],
          amazonAsin: t.asin,
          albumAsin: t.albumAsin || null
        };
      })
    };
  };
  var loaded = function(result) {
    return !!(result && result.success && result.playlist && result.playlist.tracks && result.playlist.tracks.length > 0);
  };
  var result = null;
  try {
    if (!window.electron || !window.electron.amazonMusic) {
      console.warn('Amazon Music: bridge not available');
      return null;
    }
    result = await window.electron.amazonMusic.lookupPlaylist(url);
    console.log('[Amazon] resolver playlist lookup', url, result && result.success, result && result.reason, result && result.playlist && result.playlist.tracks && result.playlist.tracks.length);
    if (loaded(result)) return mapResult(result.playlist);
    // Only a sign-in problem is fixed by sign-in. load-failed is a network
    // condition and no-cdm is a playback problem - importing needs neither -
    // and prompting for sign-in on either points the user at the wrong fix.
    if (result && result.reason === 'not-signed-in') {
      console.log('Amazon Music: not signed in, asking you to sign in...');
      var managed = false;
      if (typeof window.__parachordManageAmazonMusic === 'function') {
        managed = await window.__parachordManageAmazonMusic({ explicit: true, reason: 'not-signed-in' });
      }
      if (managed) {
        result = await window.electron.amazonMusic.lookupPlaylist(url);
        if (loaded(result)) return mapResult(result.playlist);
      }
      var err = new Error('Amazon Music is not signed in - sign in from Settings to import playlists');
      err.notReady = true;
      err.code = 'not-signed-in';
      throw err;
    }
  } catch (error) {
    if (error && error.notReady) throw error;
    console.error('Amazon Music playlist lookup error:', error);
    return null;
  }
  // Outside the try so the catch does not swallow these.
  // Transient/wiring failures first: a stalled load must not be reported as a
  // missing playlist (or offered a sign-in prompt) - it is a network condition.
  var reason = result && result.reason;
  if (reason === 'load-failed' || reason === 'no-cdm' || reason === 'not-ready') {
    var transientErr = new Error('Amazon Music is not reachable right now - check your connection and try again');
    transientErr.notReady = true;
    transientErr.code = reason;
    throw transientErr;
  }
  if (result && result.success && result.playlist === null) {
    throw new Error('Playlist not found on Amazon Music. It may have been deleted or made private.');
  }
  if (result && result.error) {
    throw new Error('Amazon Music playlist import failed: ' + result.error);
  }
  if (result && result.success) {
    throw new Error('Playlist not found on Amazon Music. It may have been deleted or made private.');
  }
  return null;
}`;

const axePath = path.join(ROOT, 'plugins/amazonmusic.axe');
const axe = JSON.parse(fs.readFileSync(axePath, 'utf8'));
axe.manifest.version = '1.4.2';
axe.implementation.lookupPlaylist = lookupPlaylist;
fs.writeFileSync(axePath, JSON.stringify(axe, null, 2) + '\n');

const manifestPath = path.join(ROOT, 'marketplace-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entry = manifest.plugins.find(p => p.id === 'amazonmusic');
if (!entry) throw new Error('no amazonmusic entry in marketplace manifest');
entry.version = axe.manifest.version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const appPath = path.join(ROOT, 'app.js');
const lines = fs.readFileSync(appPath, 'utf8').split('\n');
const idx = lines.findIndex(l => l.startsWith('  {"manifest":{"id":"amazonmusic"'));
if (idx === -1) throw new Error('amazonmusic fallback line not found in app.js');
lines[idx] = '  ' + JSON.stringify(axe) + ',';
fs.writeFileSync(appPath, lines.join('\n'));

console.log('axe →', axe.manifest.version, '| manifest →', entry.version, '| app.js fallback line', idx + 1, 'regenerated');
