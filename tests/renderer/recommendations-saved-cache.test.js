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
    expect(save).toMatch(/window\.electron\.store\.set\('cache_recommendations', \{ providers, similarUsers, savedAt: now \}\)/);
    expect(load).toMatch(/recommendationsCache\.current\.timestamp = Date\.now\(\);\s*saveRecommendationsCache\(\);/);
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

  test('similarUsers entries older than recommendationsStale are not saved', () => {
    expect(save).toMatch(/entry && Array\.isArray\(entry\.users\) && entry\.users\.length > 0 && \(now - entry\.fetchedAt\) < CACHE_TTL\.recommendationsStale\) similarUsers\[id\] = entry;/);
  });

  test('similar users follow the providers\' freshness rule (a fresh one is not asked again)', () => {
    expect(load).toMatch(/if \(!forceRefresh && hasUsers && \(now - cached\.fetchedAt\) < CACHE_TTL\.recommendations\) \{\s*similarFresh\[provider\.id\] = cached;\s*continue;\s*\}/);
    expect(load).toMatch(/if \(hasUsers && \(now - cached\.fetchedAt\) < CACHE_TTL\.recommendationsStale\) similarStale\[provider\.id\] = cached;/);
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
  const card = app.slice(app.indexOf('const playlistCard = (item, index, section) => {'), app.indexOf('const cardFor = (item, index, section) => ('));

  test('carry the standard playlist hover set: Add to Playlist, Play, Add to Queue', () => {
    const titles = [...card.matchAll(/title: '([^']+)'/g)].map(m => m[1]);
    expect(titles).toEqual(['Add to Playlist', 'Play', 'Add to Queue']);
    expect(card).toMatch(/addRecommendationPlaylistToPlaylist\(item\)/);
    expect(card).toMatch(/playRecommendationPlaylist\(item\)/);
    expect(card).toMatch(/queueRecommendationPlaylist\(item\)/);
    expect(card).not.toMatch(/handleImportPlaylistFromUrl\(item\.url\)/);
  });

  test('every playlist action uses the same trackSlug-keyed tracks', () => {
    for (const fn of ['playRecommendationPlaylist', 'addRecommendationPlaylistToPlaylist', 'queueRecommendationPlaylist', 'openRecommendationPlaylist']) {
      const at = app.indexOf(`const ${fn} = async`);
      expect(at).toBeGreaterThan(-1);
      expect(app.slice(at, at + 400)).toMatch(/await recommendationPlaylistTracks\(item\)/);
    }
    expect(app).toMatch(/const recommendationPlaylistTracks = async \(item\) => \{[\s\S]{0,300}id: trackSlug\(t\.artist \|\| '', t\.title \|\| ''\)/);
  });
});
