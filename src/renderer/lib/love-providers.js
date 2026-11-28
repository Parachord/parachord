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
// startup (registerBuiltInLoveProviders). A plug-in that implements
// loveTrack (and getLovedPage) in its own .axe is one too: the host wraps it
// (pluginLoveProvider), with its own config, and for `needs: 'serviceId'`
// finds the track's source on that service first (Subsonic's stars, #1559
// step 3).

const LoveImport = require('./love-import');
const { pickTrackMatch } = require('../../../sync-providers/track-match');
const { MIN_CONFIDENCE_THRESHOLD } = require('../../../sync-providers/confidence-scoring');

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
  // The service's page size when it lists loves (Amazon replays its page's
  // own request, firstLimit 50, live-verified): the provider's pageSize, so
  // the import walk's cap reporting is honest. null when absent or not a
  // sane number.
  const pageSize = Number.isInteger(loves.pageSize) && loves.pageSize > 0 && loves.pageSize <= 1000 ? loves.pageSize : null;
  return { contract: LOVES_CONTRACT, verb: loves.verb.trim(), needs: loves.needs, canImport: loves.canImport === true, pageSize };
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

// What a plug-in declares, from its meta-service entry or its loaded
// resolver: the manifest's own `loves` field, else — a Last.fm or
// ListenBrainz plug-in installed before the field shipped — the built-in
// provider's, when the manifest still says lovedTracks. Null when it isn't a
// love provider: no registered provider, and no loveTrack of its own.
// canImport also needs a way to list them.
function lovesOf(service) {
  if (!service) return null;
  const registered = getLoveProvider(service.id);
  const ownMethods = typeof service.loveTrack === 'function';
  if (!registered && !ownMethods) return null;
  let declared = loveDescriptor(service.loves);
  if (!declared && registered && registered.defaultLoves && service.capabilities && service.capabilities.lovedTracks) {
    declared = loveDescriptor(registered.defaultLoves);
  }
  if (!declared) return null;
  const canList = registered ? typeof registered.getLovedPage === 'function' : typeof service.getLovedPage === 'function';
  return declared.canImport && !canList ? { ...declared, canImport: false } : declared;
}

// The provider for a service: the registered one, else a plug-in's own
// methods wrapped (pluginLoveProvider; `getConfig` reads its saved config).
function loveProviderFor(service, { getConfig } = {}) {
  if (!service || !lovesOf(service)) return null;
  return getLoveProvider(service.id)
    || pluginLoveProvider(service, { getConfig: getConfig || (async () => ({})) });
}

// The love providers: every loaded plug-in that declares loves and has a
// provider, in the plug-ins' order, each once (a plug-in can be both a
// meta-service and a loaded resolver; one love is one push).
function loveProviderIds(services) {
  return [...new Set((Array.isArray(services) ? services : [])
    .filter((s) => s && lovesOf(s))
    .map((s) => s.id))];
}

// ── A plug-in's own loves ──────────────────────────────────────────────────

// A source the app already verified for this plug-in: a real record (not a
// noMatch marker) at or above the confidence floor.
function verifiedSource(track, pluginId) {
  const source = track && track.sources && !Array.isArray(track.sources) ? track.sources[pluginId] : null;
  if (!source || typeof source !== 'object' || source.noMatch) return null;
  return typeof source.confidence === 'number' && source.confidence < MIN_CONFIDENCE_THRESHOLD ? null : source;
}

// The track on a plug-in's service, for `needs: 'serviceId'`: its verified
// source there, else the plug-in's search, picked by pickTrackMatch (the
// same choice a play makes: validate, then sort; null when nothing is the
// track). A search that fails throws, so the push retries it later.
async function findLoveSource(plugin, track, config) {
  const own = verifiedSource(track, plugin.id);
  if (own) return own;
  if (typeof plugin.search !== 'function' || !track || !track.artist || !track.title) return null;
  const results = await plugin.search(`${track.artist} ${track.title}`, config);
  return pickTrackMatch(Array.isArray(results) ? results : [], track.artist, track.title, { mbid: track.mbid, isrc: track.isrc }) || null;
}

// A plug-in implementing the contract in its own .axe. Signed in is its own
// isSignedIn(config) when it has one (Apple Music asks its account), else
// set up (its isConfigured over its config). Its loveTrack gets the track with
// its source on that service in `track.sources[id]` when it needs a service
// id, and anything but { ok: true } reads as no-match.
function pluginLoveProvider(plugin, { getConfig }) {
  const declared = loveDescriptor(plugin.loves);
  const configured = (config) => (typeof plugin.isConfigured === 'function' ? !!plugin.isConfigured(config || {}) : true);
  return {
    id: plugin.id,
    fromPlugin: true,
    // The manifest's declared page size (Amazon's page's own request, 50),
    // else the provider's default.
    pageSize: (declared && declared.pageSize) || 500,
    isSignedIn: async () => {
      const config = await getConfig();
      return typeof plugin.isSignedIn === 'function' ? !!(await plugin.isSignedIn(config)) : configured(config);
    },
    importAccount: async () => {
      const config = await getConfig();
      return configured(config) ? (config && config.username) || plugin.id : null;
    },
    importAccountHint: (name) => `Set up ${name} first`,
    async loveTrack(track) {
      const config = await getConfig();
      let given = track;
      if (declared && declared.needs === 'serviceId') {
        const source = await findLoveSource(plugin, track, config);
        if (!source) return { ok: false, reason: 'no-match' };
        given = { ...track, sources: { ...(track.sources && !Array.isArray(track.sources) ? track.sources : {}), [plugin.id]: source } };
      }
      const result = await plugin.loveTrack(given, config);
      if (result && result.ok === true) return result.ref !== undefined ? { ok: true, ref: result.ref } : { ok: true };
      return { ok: false, reason: (result && result.reason) || 'no-match' };
    },
    getLovedPage: typeof plugin.getLovedPage === 'function'
      ? async (args) => plugin.getLovedPage(args || {}, await getConfig())
      : undefined,
  };
}

// What the Settings rows show for a love provider (components/plugin-extras.js
// LovedTracks), from what the dialog already holds: `signedIn` (Push and
// Send need it), `importReady` (Import needs an account to read) and the
// line each says when it can't yet. A built-in provider answers from its
// scrobbler's config; a plug-in's own, from whether it's set up.
//   signedIn  what the app knows of a plug-in's own sign-in (app.js
//             pluginAccounts, #1614: Apple Music's, Amazon Music's), when it
//             knows: a plug-in that signs in is ready when signed in, not when
//             set up.
function loveRowState(service, { name, scrobblerConfig, pluginConfig, needsSetup, signedIn } = {}) {
  const provider = service ? getLoveProvider(service.id) : null;
  const label = name || (service && service.id) || '';
  if (provider && typeof provider.rowState === 'function') return provider.rowState({ name: label, scrobblerConfig, pluginConfig });
  if (typeof signedIn === 'boolean') {
    return { signedIn, importReady: signedIn, signedOutHint: `Sign in to ${label} first`, importHint: `Sign in to ${label} first`, offLabel: 'Signed out' };
  }
  const ready = service && typeof service.isConfigured === 'function' ? !!service.isConfigured(pluginConfig || {}) : !needsSetup;
  return { signedIn: ready, importReady: ready, signedOutHint: `Set up ${label} first`, importHint: `Set up ${label} first`, offLabel: 'Not set up' };
}

// The words a plug-in's verb makes in the Settings rows: "Push loves to X",
// "Import loved tracks". Every provider says "Love" today; a "Like" or a
// "Star" reads as itself.
const VERB_WORDS = {
  love: { plural: 'loves', past: 'loved' },
  like: { plural: 'likes', past: 'liked' },
  star: { plural: 'stars', past: 'starred' },
  favorite: { plural: 'favorites', past: 'favorited' },
};
function loveWords(verb) {
  const v = typeof verb === 'string' && verb.trim() ? verb.trim().toLowerCase() : 'love';
  const words = VERB_WORDS[v] || { plural: `${v}s`, past: v.endsWith('e') ? `${v}d` : `${v}ed` };
  // The row's noun ("loved tracks"), whole: it names the kind, not a count.
  return { verb: v.charAt(0).toUpperCase() + v.slice(1), ...words, tracksNoun: [words.past, 'tracks'].join(' ') };
}

// ── Loves in sync (#1445) ──────────────────────────────────────────────────

// Is a service's love push paused with its sync? The Collection's Sync menu
// switch pauses everything that service syncs, its loves included: its sync
// settings exist and say enabled: false. Settings' "Remove sync" (stopped)
// ends its library sync, not its loves, and a service that never set up
// sync has nothing to pause. The import is a one-off you start, so it
// never asks this.
function lovesPausedBySync(syncSettings) {
  return !!(syncSettings && syncSettings.enabled === false && !syncSettings.stopped);
}

// The Sync menu's loves-only rows: every love provider that has no library
// sync of its own (Last.fm, a server's stars), each with its push switch and
// whether it can push (loveRowState). A service with library sync keeps its
// sync row, and its loves are a switch in its sync dialog.
//   services         the loaded plug-ins (meta-services and resolvers)
//   syncProviderIds  the ids with a sync row
function loveSyncRows(services, { syncProviderIds = [], scrobblerConfigs = {}, pluginConfigs = {}, pushEnabled = {}, signedInMap = {} } = {}) {
  const synced = new Set(syncProviderIds);
  // The first entry for each id (a plug-in can be listed as a meta-service
  // and as a loaded resolver).
  const byId = new Map();
  for (const s of Array.isArray(services) ? services : []) if (s && !byId.has(s.id)) byId.set(s.id, s);
  return loveProviderIds([...byId.values()])
    .filter((id) => !synced.has(id))
    .map((id) => {
      const service = byId.get(id);
      const name = service.name || id;
      const state = loveRowState(service, { name, scrobblerConfig: scrobblerConfigs[id], pluginConfig: pluginConfigs[id], signedIn: (signedInMap || {})[id] });
      return {
        id, name, color: service.color || null, words: loveWords(lovesOf(service).verb),
        signedIn: !!state.signedIn, pushOn: !!pushEnabled[id], signedOutHint: state.signedOutHint, offLabel: state.offLabel,
      };
    });
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

// Their account, the same for both: the scrobbling sign-in pushes; a
// username (the sign-in's, else the plug-in account's) is enough to import,
// since each service publishes a user's loves.
const SCROBBLER_ACCOUNT = {
  importAccount: ({ scrobblerConfig, pluginConfig } = {}) =>
    (scrobblerConfig && scrobblerConfig.username) || (pluginConfig && pluginConfig.username) || null,
  importAccountHint: (name) => `Add your ${name} username first`,
  rowState: ({ name, scrobblerConfig, pluginConfig } = {}) => ({
    signedIn: !!(scrobblerConfig && (scrobblerConfig.sessionKey || scrobblerConfig.userToken)),
    importReady: !!((scrobblerConfig && scrobblerConfig.username) || (pluginConfig && pluginConfig.username)),
    signedOutHint: 'Sign in to scrobble first',
    importHint: `Add your ${name} username first`,
    offLabel: 'Signed out',
  }),
};

// Last.fm: identified by name (track.love takes artist and title; a valid
// recording MBID rides along). Its loves list pages by page number.
function lastfmLoveProvider(scrobbler) {
  const PAGE = 200;
  return {
    id: scrobbler.id,
    defaultLoves: { contract: LOVES_CONTRACT, verb: 'Love', needs: 'name', canImport: true },
    pageSize: PAGE,
    isSignedIn: () => scrobbler.isSignedIn(),
    ...SCROBBLER_ACCOUNT,
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
    ...SCROBBLER_ACCOUNT,
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
  loveWords,
  lovesPausedBySync,
  loveSyncRows,
  loveProviderFor,
  loveProviderIds,
  loveRowState,
  findLoveSource,
  pluginLoveProvider,
  lovedPageForImport,
  lastfmLoveProvider,
  listenbrainzLoveProvider,
  registerBuiltInLoveProviders,
};
