// SYNC MIRROR of app.js `window.classifyPlaylistUrl` (parachord#930) and
// `window.isProviderPlaylistUrl` (hosted-XSPF vs provider-playlist-page
// discrimination). Keep the function BODIES byte-identical with app.js. This
// is the test-side source of truth for the parachord://play/playlist?url=
// routing decision and the hosted-playlist reload/poller filters.

function classifyPlaylistUrl(urlString) {
  let u;
  try { u = new URL(urlString); } catch { return { kind: 'standard' }; }
  const host = u.hostname.toLowerCase();

  // Achordion playlist page → its public, un-challenged XSPF endpoint. The MBID
  // in /playlist/<mbid> is the ListenBrainz playlist id Achordion mirrors.
  if (host === 'achordion.xyz' || host === 'www.achordion.xyz') {
    const m = u.pathname.match(/^\/playlist\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    if (m) return { kind: 'achordion', xspfUrl: `https://achordion.xyz/api/playlist/${m[1].toLowerCase()}/xspf` };
    return { kind: 'standard' };
  }

  // SoundCloud short link → 302s to the canonical /sets/ URL. getUrlType()
  // can't classify it (no /sets/ segment), so it must be resolved first.
  if (host === 'on.soundcloud.com') return { kind: 'soundcloud-short' };

  return { kind: 'standard' };
}

// A provider playlist URL — a playlist PAGE owned by a resolver (Spotify,
// Apple Music, Amazon, a SoundCloud set, …), not a hosted tracklist document.
// Provider imports are snapshots: the hosted-XSPF machinery (the startup
// reload list, the 5-minute poller) must not touch them. Fetching the page
// HTML to "compare content" never matches the stored XSPF (so every poll
// re-runs a full resolver import), and when resolvers have not finished
// loading the dispatch falls into the XSPF branch and reports "Failed to
// parse XSPF" for a playlist that imported fine.
function isProviderPlaylistUrl(url, loader) {
  if (!url || !loader) return false;
  try {
    const id = loader.findResolverForUrl(url);
    return !!(id && loader.getUrlType(url) === 'playlist');
  } catch {
    return false;
  }
}

// A saved playlist that came from a provider URL import (snapshot), as opposed
// to a hosted XSPF document. The source suffix is the signal that works before
// resolvers have loaded; the loader is the fallback when the suffix was lost.
// Same predicate as app.js window.isProviderImportedPlaylist — the inner call
// there is window.isProviderPlaylistUrl because app.js has no local binding.
function isProviderImportedPlaylist(playlist, loader) {
  if (!playlist || !playlist.sourceUrl) return false;
  if (typeof playlist.source === 'string' && playlist.source.endsWith('-import')) return true;
  return isProviderPlaylistUrl(playlist.sourceUrl, loader);
}

module.exports = { classifyPlaylistUrl, isProviderPlaylistUrl, isProviderImportedPlaylist };
