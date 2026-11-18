/**
 * A plug-in's cached "no match" for a track holds only for the plug-in
 * version that gave it (#1535). Bandcamp's track match read only the first 20
 * search results, so Radiohead's own "Nude" (row 31) never matched; 1.4.9
 * reads all 50, but a profile that had already cached the miss kept showing
 * Local Files only for up to 30 days. A miss now records the version, and a
 * miss from another version (or none) is asked again the next time the track
 * is resolved anyway; there is no sweep of the cache.
 */

const fs = require('fs');
const path = require('path');

const { isMiss, newMiss, missStillValid, isStaleMiss } = require('../../src/renderer/lib/cached-miss');
const { resolversToAskAgain, nextUnanswered } = require('../../src/renderer/lib/unanswered-resolvers');
const { skipsLocalFill } = require('../../src/renderer/lib/enrichment-gate');
const scoring = require('../../sync-providers/confidence-scoring');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const app = read('src/renderer/app.js');

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const TTL = 30 * DAY;

describe('missStillValid', () => {
  test('a miss from version A is stale under version B', () => {
    const miss = { noMatch: true, resolvedAt: NOW - DAY, version: '1.4.8' };
    expect(missStillValid(miss, '1.4.9', NOW, TTL)).toBe(false);
    expect(isStaleMiss(miss, '1.4.9', NOW, TTL)).toBe(true);
  });

  test('a miss from version B holds under version B', () => {
    const miss = { noMatch: true, resolvedAt: NOW - DAY, version: '1.4.9' };
    expect(missStillValid(miss, '1.4.9', NOW, TTL)).toBe(true);
    expect(isStaleMiss(miss, '1.4.9', NOW, TTL)).toBe(false);
  });

  test('a miss with no version (written before #1535) is stale', () => {
    expect(isStaleMiss({ noMatch: true, resolvedAt: NOW - DAY }, '1.4.9', NOW, TTL)).toBe(true);
    expect(isStaleMiss({ noMatch: true, resolvedAt: NOW - DAY, version: null }, '1.4.9', NOW, TTL)).toBe(true);
  });

  test('a miss past its TTL is stale, whatever the version', () => {
    const old = { noMatch: true, resolvedAt: NOW - TTL, version: '1.4.9' };
    expect(isStaleMiss(old, '1.4.9', NOW, TTL)).toBe(true);
    expect(isStaleMiss(old, undefined, NOW, TTL)).toBe(true);
    expect(isStaleMiss({ noMatch: true, version: '1.4.9' }, '1.4.9', NOW, TTL)).toBe(true);
  });

  test('a plug-in that has not loaded (version unknown) keeps its misses', () => {
    expect(missStillValid({ noMatch: true, resolvedAt: NOW - DAY }, undefined, NOW, TTL)).toBe(true);
    expect(missStillValid({ noMatch: true, resolvedAt: NOW - DAY, version: '1.0.0' }, null, NOW, TTL)).toBe(true);
  });

  test('found sources are not misses and are never stale', () => {
    const found = { id: 'bc-1', title: 'Nude', artist: 'Radiohead', resolvedAt: NOW - 100 * DAY, confidence: 1 };
    expect(isMiss(found)).toBe(false);
    expect(isStaleMiss(found, '9.9.9', NOW, TTL)).toBe(false);
    expect(missStillValid(found, '9.9.9', NOW, TTL)).toBe(false);
    expect(isStaleMiss(undefined, '1.0.0', NOW, TTL)).toBe(false);
  });
});

describe('newMiss', () => {
  test('records when and which plug-in version answered', () => {
    expect(newMiss({ id: 'bandcamp', version: '1.4.9' }, NOW)).toEqual({ noMatch: true, resolvedAt: NOW, version: '1.4.9' });
  });

  test('a fresh miss holds under its own version', () => {
    expect(missStillValid(newMiss({ version: '1.4.9' }, NOW), '1.4.9', NOW + DAY, TTL)).toBe(true);
  });
});

describe('resolversToAskAgain with a stale-miss rule', () => {
  const versions = { bandcamp: '1.4.9', spotify: '2.0.0' };
  const stale = (id, saved) => isStaleMiss(saved, versions[id], NOW, TTL);

  test('a stale miss is asked again; a current one and a found source are not', () => {
    const entry = { sources: {
      bandcamp: { noMatch: true, resolvedAt: NOW - DAY },
      spotify: { noMatch: true, resolvedAt: NOW - DAY, version: '2.0.0' },
      localfiles: { filePath: '/m/nude.flac', confidence: 1 },
    } };
    expect(resolversToAskAgain(entry, ['bandcamp', 'spotify', 'localfiles'], NOW, stale)).toEqual(['bandcamp']);
    // Without the rule (the old behaviour) every saved answer counts.
    expect(resolversToAskAgain(entry, ['bandcamp', 'spotify', 'localfiles'], NOW)).toEqual([]);
  });
});

describe('every miss records the plug-in version', () => {
  // Every file that resolves tracks and writes into track.sources or the
  // track-sources cache. A new write site must build its miss with newMiss.
  const files = [
    'src/renderer/app.js',
    'src/renderer/hooks/use-playback-engine.js',
    ...fs.readdirSync(path.join(ROOT, 'src/renderer/lib'))
      .filter(f => f.endsWith('.js') && f !== 'cached-miss.js' && !f.endsWith('.generated.js'))
      .map(f => `src/renderer/lib/${f}`),
  ];
  const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '');

  test.each(files)('%s builds no miss by hand', (rel) => {
    expect(code(rel)).not.toMatch(/noMatch\s*:\s*true/);
    expect(code(rel)).not.toMatch(/\.noMatch\s*=\s*true/);
  });

  test("resolveTrack's six miss writes go through newMiss(resolver)", () => {
    const start = app.indexOf('const resolveTrack = async');
    const body = app.slice(start, app.indexOf('// Keep resolveTrackRef in sync', start));
    expect((body.match(/newMiss\(resolver(, now)?\)/g) || []).length).toBe(6);
  });
});

describe('every "already said no" read goes through the rule', () => {
  const start = app.indexOf('const resolveTrack = async');
  const body = app.slice(start, app.indexOf('// Keep resolveTrackRef in sync', start));

  test('resolveTrack: the cache hit and the persisted-sources path', () => {
    expect(body).toMatch(/const missIsStale = \(id, saved\) => isStaleMiss\(saved, loadedVersionOf\(id\), now, CACHE_TTL\.persistedSources\);/);
    expect(body).toMatch(/resolversToAskAgain\(cachedData, askAgainIds, now, missIsStale\)/);
    expect(body).toMatch(/cachedResolverIds\.filter\(id => !missIsStale\(id, cachedData\.sources\[id\]\)\)/);
    expect(body).toMatch(/persistedResolverIds\.filter\(id => !missIsStale\(id, persistedSources\[id\]\)\)/);
  });

  test('the idle trickle picks a track whose only gap is a stale miss', () => {
    expect(app).toMatch(/const missing = enabled\.some\(r => !sources\[r\] \|\| isStaleMiss\(/);
  });

  test('queue and pool background resolution asks a stale miss again', () => {
    const bg = app.slice(app.indexOf('const resolveTracksInBackground = async'), app.indexOf('// Handle single track URL drop'));
    expect(bg).not.toMatch(/if \(track\.sources\[resolver\.id\]\) (return|continue);/);
    expect((bg.match(/if \(hasAnswer\(track, resolver\)\) (return|continue);/g) || []).length).toBe(2);
    expect(bg).toMatch(/isStaleMiss\(saved, resolver\.version/);
  });
});

// resolveTrack itself, run from app.js's source with its closure stubbed.
describe('resolveTrack with a stale miss', () => {
  const start = app.indexOf('const resolveTrack = async');
  const end = app.indexOf('// Keep resolveTrackRef in sync', start);
  const fnText = app.slice(start, end).replace(/^const resolveTrack = /, '').trim().replace(/;$/, '');

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => jest.restoreAllMocks());

  const NUDE = { id: 'Bandcamp-nude', title: 'Nude', artist: 'Radiohead', album: 'In Rainbows' };
  const FOUND = { id: 'bc-nude', title: 'Nude', artist: 'Radiohead', album: 'In Rainbows', bandcampUrl: 'https://radiohead.bandcamp.com/track/nude' };

  function harness({ bandcampVersion = '1.4.9', answer = FOUND, cache = {} } = {}) {
    const bandcamp = {
      id: 'bandcamp', name: 'Bandcamp', version: bandcampVersion,
      capabilities: { resolve: true }, play: () => true,
      resolve: jest.fn(async () => answer),
    };
    const localfiles = {
      id: 'localfiles', name: 'Local Files', version: '1.0.0',
      capabilities: { resolve: true, local: true }, play: () => true,
      resolve: jest.fn(async () => null),
    };
    const ids = ['localfiles', 'bandcamp'];
    const ref = (current) => ({ current });
    const scope = {
      trackSourcesCache: ref(cache),
      markTrackSourcesDirty: jest.fn(),
      isStaleLocalSource: () => false,
      withoutStaleLocalSource: (s) => s,
      libraryFilePathsRef: ref(new Set(['/m/nude.flac'])),
      getResolverSettingsHash: () => 'hash',
      activeResolversRef: ref(ids),
      resolverOrderRef: ref(ids),
      loadedResolversRef: ref([localfiles, bandcamp]),
      playbackResolversRef: ref(ids),
      isLocalResolver: (id) => id === 'localfiles',
      CACHE_TTL: { trackSources: 7 * DAY, persistedSources: TTL },
      CACHE_SCHEMA_VERSION: 2,
      resolversToAskAgain, nextUnanswered, isMiss, newMiss, isStaleMiss, skipsLocalFill,
      DEBUG_RESOLUTION: false,
      queueTrackSources: jest.fn(),
      confidenceForSource: () => 1,
      validateCachedSources: jest.fn(),
      collectionTracksRef: ref([]),
      queueCollectionSourceUpdate: jest.fn(),
      selectedPlaylistRef: ref(null),
      queuePlaylistSourceUpdate: jest.fn(),
      getResolverConfig: async () => ({}),
      calculateConfidence: scoring.calculateConfidence,
      MIN_CONFIDENCE_THRESHOLD: scoring.MIN_CONFIDENCE_THRESHOLD,
      sourceFromUrlHint: async () => null,
      resolverLoaderRef: ref(null),
      resolverBlocklistRef: ref([]),
      sourceBlockId: () => null,
      setCurrentQueue: jest.fn(),
      window: {},
    };
    // eslint-disable-next-line no-new-func
    const resolveTrack = new Function('scope', `with (scope) { return (${fnText}); }`)(scope);
    return { resolveTrack, bandcamp, cache: scope.trackSourcesCache.current };
  }

  const KEY = 'radiohead|nude';
  const recent = () => Date.now() - DAY;
  const localSource = { filePath: '/m/nude.flac', title: 'Nude', artist: 'Radiohead', confidence: 1 };

  test('on screen, an old-style Bandcamp miss on a local track is asked once and the match is cached', async () => {
    const { resolveTrack, bandcamp, cache } = harness();
    const track = { ...NUDE, sources: { localfiles: localSource, bandcamp: { noMatch: true, resolvedAt: recent() } } };
    const found = await resolveTrack(track, 'Radiohead', { onScreen: true });
    expect(bandcamp.resolve).toHaveBeenCalledTimes(1);
    expect(found.bandcamp).toMatchObject({ bandcampUrl: FOUND.bandcampUrl });
    expect(cache[KEY].sources.bandcamp.noMatch).toBeUndefined();
    // The next view is a cache hit: Bandcamp isn't asked again.
    await resolveTrack(track, 'Radiohead', { onScreen: true });
    expect(bandcamp.resolve).toHaveBeenCalledTimes(1);
  });

  test('off screen the local-file gate still holds: no burst over a library', async () => {
    const { resolveTrack, bandcamp } = harness();
    const track = { ...NUDE, sources: { localfiles: localSource, bandcamp: { noMatch: true, resolvedAt: recent() } } };
    await resolveTrack(track, 'Radiohead', {});
    expect(bandcamp.resolve).not.toHaveBeenCalled();
  });

  test('a cached miss from 1.4.8 is asked again under 1.4.9; a new miss records 1.4.9 and holds', async () => {
    const cache = { [KEY]: {
      sources: { localfiles: localSource, bandcamp: { noMatch: true, resolvedAt: recent(), version: '1.4.8' } },
      timestamp: Date.now() - 60 * 1000, resolverHash: 'hash', v: 2,
    } };
    const { resolveTrack, bandcamp } = harness({ answer: null, cache });
    await resolveTrack({ ...NUDE, sources: {} }, 'Radiohead', {});
    expect(bandcamp.resolve).toHaveBeenCalledTimes(1);
    expect(cache[KEY].sources.bandcamp).toEqual({ noMatch: true, resolvedAt: expect.any(Number), version: '1.4.9' });
    expect(cache[KEY].sources.localfiles).toEqual(localSource);
    await resolveTrack({ ...NUDE, sources: {} }, 'Radiohead', {});
    expect(bandcamp.resolve).toHaveBeenCalledTimes(1);
  });

  test('a cached miss from 1.4.9 is not asked again under 1.4.9', async () => {
    const cache = { [KEY]: {
      sources: { bandcamp: { noMatch: true, resolvedAt: recent(), version: '1.4.9' }, localfiles: localSource },
      timestamp: Date.now() - 60 * 1000, resolverHash: 'hash', v: 2,
    } };
    const { resolveTrack, bandcamp } = harness({ cache });
    await resolveTrack({ ...NUDE, sources: {} }, 'Radiohead', { onScreen: true });
    expect(bandcamp.resolve).not.toHaveBeenCalled();
  });

  test('a current-version miss past its TTL is asked again', async () => {
    const cache = { [KEY]: {
      sources: { bandcamp: { noMatch: true, resolvedAt: Date.now() - TTL - DAY, version: '1.4.9' }, localfiles: localSource },
      timestamp: Date.now() - 60 * 1000, resolverHash: 'hash', v: 2,
    } };
    const { resolveTrack, bandcamp } = harness({ cache });
    await resolveTrack({ ...NUDE, sources: {} }, 'Radiohead', {});
    expect(bandcamp.resolve).toHaveBeenCalledTimes(1);
    expect(cache[KEY].sources.bandcamp).toMatchObject({ bandcampUrl: FOUND.bandcampUrl });
  });

  test('a plug-in that fails on the re-ask leaves no entry, so the failure retry window applies', async () => {
    const cache = { [KEY]: {
      sources: { bandcamp: { noMatch: true, resolvedAt: recent() }, localfiles: localSource },
      timestamp: Date.now() - 60 * 1000, resolverHash: 'hash', v: 2,
    } };
    const { resolveTrack, bandcamp } = harness({ cache });
    bandcamp.resolve.mockImplementation(async () => { throw new Error('bandcamp down'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await resolveTrack({ ...NUDE, sources: {} }, 'Radiohead', {});
    expect(bandcamp.resolve).toHaveBeenCalledTimes(1);
    expect(cache[KEY].sources.bandcamp).toBeUndefined();
    expect(typeof cache[KEY].unanswered.bandcamp).toBe('number');
    await resolveTrack({ ...NUDE, sources: {} }, 'Radiohead', {});
    expect(bandcamp.resolve).toHaveBeenCalledTimes(1);
  });
});
