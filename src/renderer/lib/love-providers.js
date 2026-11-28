// src/renderer/lib/love-providers.js — loves as a plug-in capability
// (parachord#1559 step 2). One contract for every service a heart can reach,
// so the push, Send and Import (hooks/use-loves.js) never branch on a
// service's name.
//
// A plug-in declares loves in its manifest, as a top-level field beside
// `capabilities` (every client reads `capabilities` values as booleans):
//
//   "loves": { "contract": 1, "verb": "Love", "needs": "mbid", "canImport": true }
//
//   contract   the API level; an app that doesn't know it ignores the loves
//   verb       the word for the UI ("Love", "Like", "Thumbs up")
//   needs      what identifies a track there: 'mbid', 'name' or 'serviceId'
//   canImport  whether the service can list your loves (Import shows only then)
//
// A love provider implements:
//
//   isSignedIn() → boolean
//   loveTrack(track, config) → { ok: true, ref? } | { ok: false, reason: 'no-match' }
//     Throws on a failed or refused request, so a failure is never read as a
//     success (the push queues a retry). 'no-match' when it can't identify
//     the track confidently: it never loves a guess. `ref` is what the
//     service stored (ListenBrainz's recording MBID), kept on the push mark.
//   getLovedPage({ cursor, account }, config) → { items, next, total?, skipped?, returned? }
//     Only when canImport. Newest first; `cursor` is null for the first page
//     and then the previous page's `next` (null after the last). `account`
//     is the username whose loves to read (Last.fm and ListenBrainz publish
//     them, so Import needs no sign-in). Each item is
//     { artist, title, album?, mbid?, lovedAt (seconds), source? }; an item
//     with a recording MBID but no names is looked up by the app.
//
// There is no unlove: Parachord never removes a love on any service
// (docs/architecture/sync.md "Loved Tracks").
//
// Last.fm and ListenBrainz implement the contract here, over their
// scrobblers (scrobbler-loader.js): their writes stay inside the app, never
// in a marketplace .axe (docs/architecture/scrobbling.md). They register at
// startup (registerBuiltInLoveProviders); a plug-in that implements the
// methods itself joins in a later step.

const LoveImport = require('./love-import');

const LOVES_CONTRACT = 1;
const NEEDS = new Set(['mbid', 'name', 'serviceId']);
const isMbid = (m) => typeof m === 'string' && /^[a-f0-9-]{36}$/i.test(m);

// A manifest's `loves` field, validated, or null (absent, malformed, or a
// contract this app doesn't know).
function loveDescriptor(loves) {
  if (!loves || typeof loves !== 'object') return null;
  if (loves.contract !== LOVES_CONTRACT) return null;
  if (typeof loves.verb !== 'string' || !loves.verb.trim()) return null;
  if (!NEEDS.has(loves.needs)) return null;
  return { contract: LOVES_CONTRACT, verb: loves.verb.trim(), needs: loves.needs, canImport: loves.canImport === true };
}

// ── The registry ───────────────────────────────────────────────────────────

const providers = new Map();

function registerLoveProvider(provider) {
  if (!provider || typeof provider.id !== 'string' || typeof provider.loveTrack !== 'function'
    || typeof provider.isSignedIn !== 'function') {
    console.error('[Loves] Invalid love provider:', provider && provider.id);
    return;
  }
  providers.set(provider.id, provider);
}

function getLoveProvider(id) {
  return providers.get(id) || null;
}

function clearLoveProviders() {
  providers.clear();
}

// What a plug-in declares, from its meta-service entry: the manifest's own
// `loves` field, else — a Last.fm or ListenBrainz plug-in installed before
// the field shipped — the built-in provider's, when the manifest still says
// lovedTracks. Null when it isn't a love provider.
function lovesOf(service) {
  if (!service || !getLoveProvider(service.id)) return null;
  const declared = loveDescriptor(service.loves);
  if (declared) return declared;
  const provider = getLoveProvider(service.id);
  return service.capabilities && service.capabilities.lovedTracks && provider.defaultLoves
    ? loveDescriptor(provider.defaultLoves)
    : null;
}

// The love providers: every loaded plug-in that declares loves and has a
// provider, in the plug-ins' order.
function loveProviderIds(services) {
  return (Array.isArray(services) ? services : [])
    .filter((s) => s && lovesOf(s))
    .map((s) => s.id);
}

// ── Pages ──────────────────────────────────────────────────────────────────

// A provider's page in the shape the import walk reads (LoveImport's
// parsed pages): each item named for its service, with needsLookup when it
// has a recording MBID but no names. An item with neither is skipped.
function lovedPageForImport(page, serviceId) {
  const items = Array.isArray(page && page.items) ? page.items : [];
  const loves = [];
  let skipped = Number.isFinite(page && page.skipped) ? page.skipped : 0;
  for (const it of items) {
    const artist = typeof it?.artist === 'string' ? it.artist.trim() : '';
    const title = typeof it?.title === 'string' ? it.title.trim() : '';
    const mbid = isMbid(it?.mbid) ? it.mbid : null;
    if (!mbid && (!artist || !title)) { skipped++; continue; }
    const love = {
      artist,
      title,
      album: typeof it.album === 'string' ? it.album.trim() : '',
      mbid,
      lovedAt: typeof it.lovedAt === 'number' && Number.isFinite(it.lovedAt) && it.lovedAt > 0 ? Math.round(it.lovedAt) : null,
      service: serviceId,
    };
    if (it.source && typeof it.source === 'object') love.source = it.source;
    if (mbid && (!artist || !title)) love.needsLookup = true;
    loves.push(love);
  }
  // A provider may not know its total: 0 is "unknown", and the walk then
  // goes on until a page's `next` is null.
  const total = Number(page && page.total);
  return {
    loves,
    skipped,
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    returned: Number.isFinite(page && page.returned) ? page.returned : items.length,
    next: page && page.next !== undefined ? page.next : null,
  };
}

// ── Last.fm and ListenBrainz ───────────────────────────────────────────────

// Last.fm: identified by name (track.love takes artist and title; a valid
// recording MBID rides along). Its loves list pages by page number.
function lastfmLoveProvider(scrobbler) {
  const PAGE = 200;
  return {
    id: scrobbler.id,
    defaultLoves: { contract: LOVES_CONTRACT, verb: 'Love', needs: 'name', canImport: true },
    pageSize: PAGE,
    isSignedIn: () => scrobbler.isSignedIn(),
    async loveTrack(track) {
      await scrobbler.loveTrack({
        artist: track.artist, title: track.title,
        mbid: track.mbid && isMbid(track.mbid) ? track.mbid : undefined,
      });
      return { ok: true };
    },
    async getLovedPage({ cursor, account } = {}) {
      const page = typeof cursor === 'number' && cursor >= 1 ? cursor : 1;
      const parsed = LoveImport.parseLastfmLovedPage(await scrobbler.getLovedTracksPage({ page, count: PAGE, username: account }));
      const last = parsed.returned === 0 || (parsed.totalPages && page >= parsed.totalPages);
      return { items: parsed.loves, skipped: parsed.skipped, total: parsed.total, returned: parsed.returned, next: last ? null : page + 1 };
    },
  };
}

// ListenBrainz: identified by recording MBID. The provider finds it
// (resolveMbid: the track's own, then the mapper, ISRC and MusicBrainz;
// window.resolveMbidForLove), and a track it can't place is 'no-match'. Its
// loves list pages by offset.
function listenbrainzLoveProvider(scrobbler, { resolveMbid }) {
  const PAGE = 100;
  return {
    id: scrobbler.id,
    defaultLoves: { contract: LOVES_CONTRACT, verb: 'Love', needs: 'mbid', canImport: true },
    pageSize: PAGE,
    isSignedIn: () => scrobbler.isSignedIn(),
    async loveTrack(track) {
      const mbid = await resolveMbid(track);
      if (!mbid) return { ok: false, reason: 'no-match' };
      await scrobbler.loveTrack({ ...track, mbid });
      return { ok: true, ref: mbid };
    },
    async getLovedPage({ cursor, account } = {}) {
      const offset = typeof cursor === 'number' && cursor >= 0 ? cursor : 0;
      const parsed = LoveImport.parseListenbrainzFeedbackPage(await scrobbler.getLovedTracksPage({ offset, count: PAGE, username: account }));
      const seen = offset + parsed.returned;
      const last = parsed.returned === 0 || (parsed.total > 0 && seen >= parsed.total);
      return { items: parsed.loves, skipped: parsed.skipped, total: parsed.total, returned: parsed.returned, next: last ? null : seen };
    },
  };
}

// The app's own love providers, over the scrobblers scrobbler-loader.js put
// on `win` (window). Called once the scrobblers are initialized.
function registerBuiltInLoveProviders(win) {
  if (!win) return;
  if (win.lastfmScrobbler) registerLoveProvider(lastfmLoveProvider(win.lastfmScrobbler));
  if (win.listenbrainzScrobbler) {
    registerLoveProvider(listenbrainzLoveProvider(win.listenbrainzScrobbler, {
      resolveMbid: (track) => (typeof win.resolveMbidForLove === 'function' ? win.resolveMbidForLove(track) : null),
    }));
  }
}

module.exports = {
  LOVES_CONTRACT,
  loveDescriptor,
  registerLoveProvider,
  getLoveProvider,
  clearLoveProviders,
  lovesOf,
  loveProviderIds,
  lovedPageForImport,
  lastfmLoveProvider,
  listenbrainzLoveProvider,
  registerBuiltInLoveProviders,
};
