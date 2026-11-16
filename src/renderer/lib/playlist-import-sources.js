// src/renderer/lib/playlist-import-sources.js: what the Import playlist
// dialog says it accepts, from the plug-ins that can actually import a
// playlist link (#1019).
//
// A link imports through the plug-in registry (findResolverForUrl, then the
// plug-in's lookupPlaylist), so the list comes from the loaded plug-ins that
// implement lookupPlaylist, never a hard-coded set: the label used to say
// "Spotify, Apple Music, or hosted .xspf" while SoundCloud sets, YouTube and
// ListenBrainz playlists imported too. A new plug-in with lookupPlaylist
// shows up on its own. Hosted XSPF is the app's own importer, so it is always
// last. Pure; loads under plain Node.

const { CANONICAL_RESOLVER_ORDER } = require('./resolver-order');

// The plug-ins that import playlist links, in the app's usual service order
// (CANONICAL_RESOLVER_ORDER), then any others by name.
function playlistImportServices(resolvers) {
  const rank = (r) => {
    const i = CANONICAL_RESOLVER_ORDER.indexOf(r.id);
    return i < 0 ? CANONICAL_RESOLVER_ORDER.length : i;
  };
  const seen = new Set();
  return (resolvers || [])
    .filter((r) => r && typeof r.lookupPlaylist === 'function' && r.name && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)))
    .map((r) => r.name);
}

// "Spotify, Apple Music, SoundCloud, or a hosted XSPF playlist"
function playlistImportLabel(resolvers) {
  const names = playlistImportServices(resolvers);
  const xspf = 'a hosted XSPF playlist';
  if (names.length === 0) return `A link to ${xspf}`;
  return `${names.join(', ')}, or ${xspf}`;
}

module.exports = { playlistImportServices, playlistImportLabel };
