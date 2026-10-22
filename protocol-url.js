// @ts-check
// protocol-url.js — URL/protocol pure helpers shared by the renderer and jest.
//
// Contains (extracted from app.js, maintainability plan Track 2a):
//  - isPublicHttpUrl — the SSRF guard for user-supplied URLs in parachord://
//    commands (import, play-*). Rejects non-http(s) schemes; literal IPs in
//    loopback / RFC1918 / link-local / CGNAT / cloud-metadata ranges; mDNS
//    .local; IPv6 loopback / link-local / ULA / IPv4-mapped.
//    NOTE: Defends against literal-IP and well-known-hostname SSRF only.
//    Does NOT defend against DNS rebinding — a public hostname resolving to
//    127.0.0.1 is accepted. Callers in privileged contexts must additionally
//    fetch through a resolver that pins to the resolved IP, or accept this
//    risk.
//  - HOSTED_PLAYLIST_MAX_BYTES + hostedPlaylistFetchProblem — hosted-playlist
//    fetch limits (parachord#1011): both the requested URL and the URL the
//    response actually came from must be public, and the body is capped so a
//    runaway document can't be parsed on the main thread every five minutes.
//  - classifyPlaylistUrl (parachord#930) — classify a
//    parachord://play/playlist?url= target: achordion playlist page → its
//    public XSPF API, on.soundcloud.com → redirect-follow first, else
//    standard. Pure: no I/O, no resolver dependency.
//  - isProviderPlaylistUrl / isProviderImportedPlaylist — provider playlist
//    PAGES are snapshots, NOT hosted tracklist documents: the hosted-XSPF
//    machinery (startup reload list, 5-minute poller) must not touch them.
//  - buildPlaylistSavePayload — the record savePlaylistToStore writes. Start
//    from the WHOLE playlist and override only the computed fields; the
//    main-process playlists-save handler replaces the stored record outright,
//    so any field missing from the payload is deleted on disk.
//
// Dual-loaded: index.html loads this before app.js (window.* exposure); jest
// and the main process require() it. tests/helpers/{url-safety,
// playlist-url-classify}.js are thin re-exports of this module — the old
// byte-copy SYNC mirrors are gone.

(function () {
  function isPublicHttpUrl(urlString) {
    if (typeof urlString !== 'string' || !urlString) return false;
    let u;
    try { u = new URL(urlString); } catch { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === 'localhost.') return false;
    if (host.endsWith('.local') || host.endsWith('.local.')) return false;
    if (host === '[::1]') return false;
    if (host.startsWith('[') && host.endsWith(']')) {
      const v6 = host.slice(1, -1);
      if (v6 === '::' || v6 === '::1') return false;
      if (/^fe[89ab][0-9a-f]?:/i.test(v6)) return false;
      if (/^f[cd][0-9a-f]{2}:/i.test(v6)) return false;
      if (/^::ffff:/i.test(v6)) return false;
    }
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number);
      if ([a, b, c, d].some(n => n > 255)) return false;
      if (a === 0) return false;
      if (a === 127) return false;
      if (a === 10) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
    }
    return true;
  }

  // Hosted-playlist fetch limits (parachord#1011). The URL import path (modal,
  // Playlists-page drop, File menu, startup reload, 5-minute poller) fetches any
  // URL no resolver claims and parses the whole body as XSPF. Redirects are
  // followed because hosted XSPF commonly sits behind one (http->https, Dropbox
  // dl=1), so the guard checks both the requested URL and the URL the response
  // actually came from, and caps the body so a runaway document can't be parsed
  // on the main thread every five minutes. 5 MB is roughly 10k tracks of XSPF.
  // Returns a user-facing problem string, or null when the fetch is acceptable.
  const HOSTED_PLAYLIST_MAX_BYTES = 5 * 1024 * 1024;

  function hostedPlaylistFetchProblem(requestedUrl, finalUrl, bodyLength) {
    if (!isPublicHttpUrl(requestedUrl)) return 'Playlist URL must be a public http(s) address';
    if (finalUrl && finalUrl !== requestedUrl && !isPublicHttpUrl(finalUrl)) return 'Playlist URL redirected to a private address';
    if (typeof bodyLength === 'number' && bodyLength > HOSTED_PLAYLIST_MAX_BYTES) {
      return `Playlist is too large (max ${Math.round(HOSTED_PLAYLIST_MAX_BYTES / (1024 * 1024))} MB)`;
    }
    return null;
  }

  // Classify a parachord://play/playlist?url=<url> target so the protocol handler
  // knows how to turn it into tracks (parachord#930). Provider playlist *pages*
  // (Spotify / Apple Music / SoundCloud) are NOT tracklist documents — they have
  // to go through the resolver lookupPlaylist path — and two hosts need a special
  // pre-step. Pure: no I/O, no resolver dependency (the orchestrator does the
  // fetching/sniffing). Returns one of:
  //   { kind: 'achordion', xspfUrl }  — achordion.xyz/playlist/<mbid> → its public XSPF API
  //   { kind: 'soundcloud-short' }    — on.soundcloud.com/<id> → needs a redirect-follow first
  //   { kind: 'standard' }            — everything else: try resolver lookupPlaylist, else parse as a tracklist document
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
  function isProviderImportedPlaylist(playlist, loader) {
    if (!playlist || !playlist.sourceUrl) return false;
    if (typeof playlist.source === 'string' && playlist.source.endsWith('-import')) return true;
    return isProviderPlaylistUrl(playlist.sourceUrl, loader);
  }

  // The record savePlaylistToStore writes. Start from the WHOLE playlist and
  // override only the computed fields, instead of listing fields to keep: the
  // main-process `playlists-save` handler replaces the stored record outright,
  // so any field missing here is deleted on disk. The old hand-written list
  // omitted `localOnly` and `description`, so adding or removing a track on a
  // "Local only" playlist cleared the flag and the next sync pushed it to the
  // user's services. docs/architecture/sync.md lists the fields every save must carry.
  // UI-only flags that ride on selectedPlaylist (Weekly Jams, external views)
  // are stripped so they never reach disk.
  const PLAYLIST_UI_ONLY_FIELDS = ['isEphemeral', 'isExternal', 'tracksLoaded'];

  function buildPlaylistSavePayload(playlist, xspfContent, now) {
    const payload = { ...playlist };
    for (const key of PLAYLIST_UI_ONLY_FIELDS) delete payload[key];
    payload.filename = playlist.filename || `${playlist.id}.xspf`;
    payload.xspf = xspfContent;
    payload.createdAt = playlist.createdAt || now;
    payload.addedAt = playlist.addedAt || now;
    payload.lastModified = now;
    payload.isAiPlaylist = playlist.isAiPlaylist || false;
    return payload;
  }

  // Base64 -> UTF-8 JSON for parachord:// inline track payloads. The naive
  // atob() + JSON.parse treats decoded bytes as Latin-1 and silently mangles
  // every multi-byte character (U+2019 becomes a tilde-accented mess, non-Latin
  // scripts become unreadable) — round-trip the bytes through TextDecoder.
  function decodeBase64Utf8Json(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const text = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(text);
  }

  const api = {
    isPublicHttpUrl,
    HOSTED_PLAYLIST_MAX_BYTES,
    hostedPlaylistFetchProblem,
    classifyPlaylistUrl,
    isProviderPlaylistUrl,
    isProviderImportedPlaylist,
    buildPlaylistSavePayload,
    decodeBase64Utf8Json,
  };

  if (typeof window !== 'undefined') {
    /** @type {any} */ (window).isPublicHttpUrl = isPublicHttpUrl;
    /** @type {any} */ (window).HOSTED_PLAYLIST_MAX_BYTES = HOSTED_PLAYLIST_MAX_BYTES;
    /** @type {any} */ (window).hostedPlaylistFetchProblem = hostedPlaylistFetchProblem;
    /** @type {any} */ (window).classifyPlaylistUrl = classifyPlaylistUrl;
    /** @type {any} */ (window).isProviderPlaylistUrl = isProviderPlaylistUrl;
    /** @type {any} */ (window).isProviderImportedPlaylist = isProviderImportedPlaylist;
    /** @type {any} */ (window).buildPlaylistSavePayload = buildPlaylistSavePayload;
    /** @type {any} */ (window).decodeBase64Utf8Json = decodeBase64Utf8Json;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
