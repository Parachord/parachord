/**
 * The Recommendations page's provider answers survive a restart, and a slow
 * provider no longer holds back the others (#1328).
 *
 * Before: the per-provider cache lived in memory only, so every launch fetched
 * every provider again behind a skeleton, and the page applied all answers at
 * once, so Last.fm and ListenBrainz (a couple of seconds) waited on Amazon
 * (12s and more for an account whose music tab is refused). Now:
 *   - answers are saved as cache_recommendations after every fetch round and
 *     read back with the critical keys at launch;
 *   - a saved answer under CACHE_TTL.recommendations is used as is, one under
 *     CACHE_TTL.recommendationsStale shows while its provider refreshes;
 *   - an answer belongs to an account (a meta-service's username), so a
 *     changed Last.fm/ListenBrainz user never sees the old one's sections;
 *   - each answer goes on screen as it lands, and only the latest load does;
 *   - an answer after the per-provider bound is applied and saved, not dropped.
 * Also pinned here: recommended playlist cards carry the standard hover set.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const storeIpc = fs.readFileSync(path.join(__dirname, '..', '..', 'main-process', 'ipc', 'store.js'), 'utf8');

const load = app.slice(app.indexOf('const loadRecommendations = async (opts = {}) => {'), app.indexOf('// "Load more" for a titled section whose provider can paginate'));

describe('saved recommendations', () => {
  test('the key is allowlisted and read with the critical keys', () => {
    expect(storeIpc).toContain("'cache_recommendations'");
    const critical = app.slice(app.indexOf('const criticalKeys = ['), app.indexOf('];', app.indexOf('const criticalKeys = [')));
    expect(critical).toContain("'cache_recommendations'");
  });

  test('read back at launch only into an empty cache (a load this session wins)', () => {
    expect(app).toMatch(/const recsData = d\['cache_recommendations'\];[\s\S]{0,200}Object\.keys\(recommendationsCache\.current\.providers\)\.length === 0\)/);
  });

  test('saved after every fetch round, keeping only answers with sections young enough to show', () => {
    const save = app.slice(app.indexOf('const saveRecommendationsCache = () => {'), app.indexOf('const loadRecommendations = async'));
    expect(save).toMatch(/entry\.sections\.length > 0 && \(now - entry\.fetchedAt\) < CACHE_TTL\.recommendationsStale/);
    expect(save).toMatch(/window\.electron\.store\.set\('cache_recommendations', \{ providers, similarUsers, releaseDates, savedAt: now \}\)/);
    expect(load).toMatch(/recommendationsCache\.current\.timestamp = Date\.now\(\);\s*saveRecommendationsCache\(\);/);
  });

  test('album release dates are saved with the cache inside their week, newest 1500, and restored when fresh', () => {
    const save = app.slice(app.indexOf('const saveRecommendationsCache = () => {'), app.indexOf('const loadRecommendations = async'));
    expect(save).toContain('.filter(([, entry]) => entry && typeof entry.at === \'number\' && (now - entry.at) < RELEASE_DATE_TTL_MS)');
    expect(save).toContain('.slice(0, 1500)');
    expect(app).toContain('saveRecommendationsCacheRef.current = saveRecommendationsCache;');
    const restore = app.slice(app.indexOf('// Saved album release dates'), app.indexOf('// Load AI suggestions cache'));
    expect(restore).toContain("(Date.now() - entry.at) < RELEASE_DATE_TTL_MS");
    // Results save a few seconds after they settle (they arrive about once a second).
    const writer = app.slice(app.indexOf('const recommendationReleaseDatesWriterRef = useRef(null);'), app.indexOf('// Section collapse state'));
    expect(writer).toContain('setTimeout(() => saveRecommendationsCacheRef.current?.(), 5000)');
  });

  test('each album card\'s release date is looked up on MusicBrainz in the background, once a week, never stored on failure', () => {
    const effect = app.slice(app.indexOf('const recommendationReleaseDateFetchesRef = useRef(new Set());'), app.indexOf('// Fetch artist biography from Last.fm'));
    expect(effect).toContain("if (activeView !== 'recommendations') return;");
    expect(effect).toContain("if (item.type !== 'album' || !item.artist || !item.name) continue;");
    // A provider's own date (Apple Music) needs no lookup.
    expect(effect).toContain('if (item.releaseDate) continue;');
    expect(effect).toContain('if (known && (now - known.at) < RELEASE_DATE_TTL_MS) continue;');
    expect(effect).toContain('fetch(releaseGroupSearchUrl(item.artist, item.name), { mbBackground: true, queuedTimeoutMs: 15000 })');
    expect(effect).toContain('.catch(() => { /* nothing stored: a later visit asks again */ })');
    expect(effect).toContain('}, [activeView, recommendations.sections]);');
  });

  test('an album dated after today carries Fresh Drops\' cover badge with "Coming <date>"', () => {
    const card = app.slice(app.indexOf('const albumCard = (item, index) => {'), app.indexOf('const playlistCard = (item, index, section) => {'));
    expect(card).toContain('const entry = item.releaseDate');
    expect(card).toContain(": recommendationReleaseDates[releaseDateKey(item.artist || '', item.name)];");
    expect(card).toContain('const label = entry && upcomingLabel(entry.date);');
    expect(card).toContain("className: 'release-badge',");
    expect(card).toContain("style: { position: 'absolute', top: '8px', right: '8px', zIndex: 10 }");
  });

  test('fresh answers are used as is; stale ones show while their provider refreshes', () => {
    expect(load).toMatch(/if \(!forceRefresh && hasSections && \(now - cached\.fetchedAt\) < CACHE_TTL\.recommendations\) \{\s*fresh\[provider\.id\] = cached;/);
    expect(load).toMatch(/if \(hasSections && \(now - cached\.fetchedAt\) < CACHE_TTL\.recommendationsStale\) stale\[provider\.id\] = cached;/);
    expect(load).toMatch(/const entry = fresh\[provider\.id\] \|\| stale\[provider\.id\];/);
  });

  test('an answer belongs to its account: a different username never reuses it', () => {
    expect(load).toMatch(/const accountFor = \(provider\) => \(metaServiceConfigsRef\.current\?\.\[provider\.id\]\?\.username\) \|\| '';/);
    expect(load).toMatch(/return entry && \(entry\.account \|\| ''\) === accountFor\(provider\) \? entry : null;/);
    expect(load).toMatch(/account: accountFor\(provider\)/);
  });

  test('a not-ready answer drops the saved sections (on screen and on disk)', () => {
    expect(load).toMatch(/if \(error\?\.notReady\) \{[\s\S]{0,600}?delete stale\[provider\.id\];\s*delete recommendationsCache\.current\.providers\[provider\.id\];/);
  });
});

describe('saved similar users (the Friends row)', () => {
  const save = app.slice(app.indexOf('const saveRecommendationsCache = () => {'), app.indexOf('const loadRecommendations = async'));

  test('a cache without similarUsers loads', () => {
    // Read back as an object whatever the saved value holds (an old cache has
    // no field; anything malformed becomes {}), and every read in the load
    // tolerates a missing map (the uninstall path resets the whole cache).
    const readback = app.slice(app.indexOf("const recsData = d['cache_recommendations'];"), app.indexOf('// Load AI suggestions cache'));
    expect(readback).toMatch(/similarUsers: \(recsData\.similarUsers && typeof recsData\.similarUsers === 'object' && !Array\.isArray\(recsData\.similarUsers\)\)\s*\? \{ \.\.\.recsData\.similarUsers \}\s*: \{\}/);
    expect(save).toMatch(/Object\.entries\(recommendationsCache\.current\.similarUsers \|\| \{\}\)/);
    expect(load).toMatch(/const entry = \(recommendationsCache\.current\.similarUsers \|\| \{\}\)\[provider\.id\];/);
    // A saved entry must hold a users array to be used at all.
    expect(load).toMatch(/return entry && Array\.isArray\(entry\.users\) && \(entry\.account \|\| ''\) === accountFor\(provider\) \? entry : null;/);
  });

  test('similarUsers entries older than recommendationsStale are not saved; an empty answer is', () => {
    // A successful empty answer is a real answer (failures throw), so it is
    // saved with its fetchedAt like any other.
    expect(save).toMatch(/if \(entry && Array\.isArray\(entry\.users\) && \(now - entry\.fetchedAt\) < CACHE_TTL\.recommendationsStale\) similarUsers\[id\] = entry;/);
    expect(save).not.toMatch(/entry\.users\.length > 0/);
  });

  test('similar users are asked again only once their answer is stale (7 days), or on a forced refresh', () => {
    // Any young answer is fresh, an empty one too: an empty answer re-asked
    // on every visit re-ran Last.fm's paced lookup and flashed the skeleton.
    expect(load).toMatch(/const withinStale = !!\(cached && \(now - cached\.fetchedAt\) < CACHE_TTL\.recommendationsStale\);/);
    expect(load).toMatch(/if \(!forceRefresh && young\) \{\s*similarFresh\[provider\.id\] = cached;\s*continue;\s*\}/);
    expect(load).not.toMatch(/hasUsers && \(now - cached\.fetchedAt\) < CACHE_TTL\.recommendations\)/);
    // A forced refresh, or an answer saved in an older shape, still shows
    // its people while it asks again.
    expect(load).toMatch(/const hasUsers = withinStale && cached\.users\.length > 0;/);
    expect(load).toMatch(/if \(hasUsers\) similarStale\[provider\.id\] = cached;/);
  });

  test('an answer saved in an older shape is asked again once (3: inactive listeners dropped)', () => {
    expect(load).toContain('const SIMILAR_USERS_SHAPE = 3;');
    expect(load).toMatch(/const young = withinStale && cached\.shape === SIMILAR_USERS_SHAPE;/);
    const fetchBlock = load.slice(load.indexOf('const fetchSimilarUsers = async (provider) => {'), load.indexOf('await Promise.all(['));
    expect(fetchBlock).toMatch(/similarFresh\[provider\.id\] = \{ users: Array\.isArray\(users\) \? users : \[\], fetchedAt: Date\.now\(\), account, shape: SIMILAR_USERS_SHAPE \};/);
  });

  test('a provider whose last answer was empty stays out of the Friends skeleton (quiet, like providers)', () => {
    expect(load).toMatch(/if \(young && cached\.users\.length === 0\) recommendationsQuietRef\.current\.add\(`friends:\$\{provider\.id\}`\);/);
    const fetchBlock = load.slice(load.indexOf('const fetchSimilarUsers = async (provider) => {'), load.indexOf('await Promise.all(['));
    expect(fetchBlock).toMatch(/if \(similarFresh\[provider\.id\]\.users\.length > 0\) recommendationsQuietRef\.current\.delete\(`friends:\$\{provider\.id\}`\);\s*else recommendationsQuietRef\.current\.add\(`friends:\$\{provider\.id\}`\);/);
    expect(load).toMatch(/\.concat\(similarToFetch\s*\.filter\(p => !similarStale\[p\.id\] && !recommendationsQuietRef\.current\.has\(`friends:\$\{p\.id\}`\)\)/);
  });
});

describe('each provider applies as it lands', () => {
  test('only the latest load puts sections on screen', () => {
    expect(load).toMatch(/const generation = \+\+recommendationsLoadGenRef\.current;/);
    expect(load).toMatch(/const applyFresh = \(\) => \{\s*if \(!isLatest\(\)\) return;/);
  });

  test('every settled provider re-applies, not just the round\'s end', () => {
    expect(load).toMatch(/\/\/ Each answer goes on screen as it lands[^\n]*\n[^\n]*\n\s*applyFresh\(\);/);
  });

  test('an answer after the bound is applied and saved, not dropped', () => {
    expect(load).toMatch(/if \(raw === TIMED_OUT\) \{[\s\S]{0,900}?request\.then\(\(late\) => \{\s*if \(late == null\) return;\s*accept\(late\);\s*applyFresh\(\);\s*saveRecommendationsCache\(\);/);
    // ...and a late answer with sections replaces an empty-page message.
    expect(load).toMatch(/if \(isLatest\(\) && fresh\[provider\.id\]\.sections\.length > 0\) \{\s*setRecommendations\(prev => \(\{ \.\.\.prev, loading: false, error: null \}\)\);/);
  });
});

describe('recommended playlist cards', () => {
  const card = app.slice(app.indexOf('const playlistCard = (item, index, section) => {'), app.indexOf('// ── Weekly playlists (moved from Home)'));

  test('carry the standard playlist hover set: Add to Playlist, Play, Add to Queue', () => {
    const titles = [...card.matchAll(/title: '([^']+)'/g)].map(m => m[1]);
    expect(titles).toEqual(['Add to Playlist', 'Play', 'Add to Queue']);
    expect(card).toMatch(/addRecommendationPlaylistToPlaylist\(item\)/);
    expect(card).toMatch(/playRecommendationPlaylist\(item\)/);
    expect(card).toMatch(/queueRecommendationPlaylist\(item\)/);
    expect(card).not.toMatch(/handleImportPlaylistFromUrl\(item\.url\)/);
  });

  test('a recommended playlist keeps each track\'s service ids and ISRC, so it resolves on its own service at once', () => {
    // The lookup returns them (resolveProviderPlaylistUrl); dropping them made
    // every track of an Apple Music playlist search every service from scratch,
    // Apple included, one track at a time. resolveTrack marks a track carrying
    // appleMusicId (or spotifyUri + spotifyId) resolved on that service at once.
    const mapper = app.slice(app.indexOf('const recommendationPlaylistTracks = async (item) => {'), app.indexOf('const playRecommendationPlaylist = async'));
    expect(mapper).toContain('...(t.appleMusicId ? { appleMusicId: t.appleMusicId } : {}),');
    expect(mapper).toContain('...(t.spotifyId ? { spotifyId: t.spotifyId, spotifyUri: `spotify:track:${t.spotifyId}` } : {}),');
    expect(mapper).toContain('...(t.amazonAsin ? { amazonAsin: t.amazonAsin } : {}),');
    expect(mapper).toContain('...(t.isrc ? { isrc: t.isrc } : {})');
    // The shortcut those fields feed.
    expect(app).toMatch(/if \(track\.appleMusicId && currentActiveResolvers\.includes\('applemusic'\) && !persistedSources\.applemusic\)/);
    expect(app).toMatch(/if \(track\.spotifyUri && track\.spotifyId && currentActiveResolvers\.includes\('spotify'\) && !persistedSources\.spotify\)/);
  });

  test('every playlist action uses the same trackSlug-keyed tracks', () => {
    // Play, Add to Playlist and Add to Queue are the shared service-playlist
    // helpers Home's mixes use too.
    for (const fn of ['playServicePlaylist', 'addServicePlaylistToPlaylist', 'queueServicePlaylist']) {
      const at = app.indexOf(`const ${fn} = async`);
      expect(at).toBeGreaterThan(-1);
      expect(app.slice(at, at + 400)).toMatch(/await recommendationPlaylistTracks\(item\)/);
    }
    expect(app).toContain('const playRecommendationPlaylist = async (item) => playServicePlaylist(item);');
    expect(app).toContain('const queueRecommendationPlaylist = async (item) => queueServicePlaylist(item);');
    expect(app).toContain('const addRecommendationPlaylistToPlaylist = async (item) => addServicePlaylistToPlaylist(item);');
    // Open hands the same lookup to the playlist view, which fills in when it lands.
    const open = app.slice(app.indexOf('const openServicePlaylist = (item, sourceName) => {'));
    expect(open.slice(0, 900)).toContain('fetchTracks: () => recommendationPlaylistTracks(item)');
    expect(app).toMatch(/const recommendationPlaylistTracks = async \(item\) => \{[\s\S]{0,300}id: trackSlug\(t\.artist \|\| '', t\.title \|\| ''\)/);
  });
});
