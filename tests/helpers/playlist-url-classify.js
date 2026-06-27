// SYNC MIRROR of app.js `window.classifyPlaylistUrl` (parachord#930).
// Keep the function BODY byte-identical with app.js. This is the test-side
// source of truth for the parachord://play/playlist?url= routing decision.

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

module.exports = { classifyPlaylistUrl };
