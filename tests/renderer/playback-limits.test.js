/**
 * Playback limits: resolvers that are set up but can't play on the account's
 * plan (Amazon off Music Unlimited, #1220; Spotify Free). One map
 * (src/renderer/lib/playback-limits.js) drives what the app leaves out of
 * playback, the Settings tile and panel, and the re-search after an upgrade;
 * the engine handles a play refused for the plan the same way for any
 * resolver.
 */

const fs = require('fs');
const path = require('path');
const {
  amazonPlaybackLimit,
  spotifyPlaybackLimit,
  planBlockedIds,
  playbackResolverIds,
  tileStatus,
  limitMessage,
  limitTransition,
  limitStorageKey,
  SPOTIFY_FREE_MESSAGE
} = require('../../src/renderer/lib/playback-limits');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const app = read('src/renderer/app.js');
const engine = read('src/renderer/hooks/use-playback-engine.js');
const main = read('main.js');

const between = (src, start, end) => {
  const i = src.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  const j = src.indexOf(end, i + start.length);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};

const PRIME_MESSAGE = 'Amazon Prime: Amazon is used for album art, artist photos and links. Playing Amazon tracks in Parachord needs Music Unlimited.';
const amazonStatus = (plan, signedIn = true) => ({
  success: true, web: { cdm: true, signedIn }, plan, planMessage: plan && plan !== 'unlimited' ? PRIME_MESSAGE : null
});

describe('per-service limits', () => {
  test('Amazon: only Music Unlimited plays; Prime and unknown block, and both held their searches back', () => {
    expect(amazonPlaybackLimit(amazonStatus('unlimited'))).toEqual({ blocked: false, planKey: 'unlimited', label: null, message: null, searchesHeldBack: true });
    expect(amazonPlaybackLimit(amazonStatus('prime'))).toEqual({ blocked: true, planKey: 'prime', label: 'Prime: no playback', message: PRIME_MESSAGE, searchesHeldBack: true });
    expect(amazonPlaybackLimit(amazonStatus('unknown'))).toMatchObject({ blocked: true, label: 'Plan not confirmed' });
  });

  test('Amazon: nothing to say while signed out or before the status loads', () => {
    expect(amazonPlaybackLimit(null)).toBeNull();
    expect(amazonPlaybackLimit(amazonStatus('prime', false))).toBeNull();
    expect(amazonPlaybackLimit(amazonStatus(null))).toBeNull();
  });

  test('Spotify: Premium plays; Free and open block; unknown does not block', () => {
    expect(spotifyPlaybackLimit('premium')).toEqual({ blocked: false, planKey: 'premium', label: null, message: null });
    expect(spotifyPlaybackLimit('free')).toEqual({ blocked: true, planKey: 'free', label: 'Free: no playback', message: SPOTIFY_FREE_MESSAGE });
    expect(spotifyPlaybackLimit('open')).toMatchObject({ blocked: true });
    expect(spotifyPlaybackLimit(null)).toBeNull();
    expect(SPOTIFY_FREE_MESSAGE).toBe('Spotify Free: Spotify is used for search, playlists and links. Playing Spotify tracks in Parachord needs Spotify Premium.');
  });
});

describe('what the map drives', () => {
  const limits = {
    amazonmusic: amazonPlaybackLimit(amazonStatus('prime')),
    spotify: spotifyPlaybackLimit('free'),
    soundcloud: null
  };

  test('the blocked ids, and the resolvers that play', () => {
    expect(planBlockedIds(limits)).toEqual(['amazonmusic', 'spotify']);
    expect(planBlockedIds({ spotify: spotifyPlaybackLimit('premium') })).toEqual([]);
    const active = ['spotify', 'amazonmusic', 'bandcamp'];
    expect(playbackResolverIds(active, ['amazonmusic', 'spotify'])).toEqual(['bandcamp']);
    // Nothing blocked: the same array, so a memo on it stays stable.
    expect(playbackResolverIds(active, [])).toBe(active);
  });

  test('the tile label and tooltip, and the panel message', () => {
    expect(tileStatus(limits, 'spotify')).toEqual({ statusLabel: 'Free: no playback', statusTitle: SPOTIFY_FREE_MESSAGE });
    expect(tileStatus(limits, 'amazonmusic')).toEqual({ statusLabel: 'Prime: no playback', statusTitle: PRIME_MESSAGE });
    expect(tileStatus(limits, 'soundcloud')).toEqual({ statusLabel: null, statusTitle: null });
    expect(tileStatus({ spotify: spotifyPlaybackLimit('premium') }, 'spotify')).toEqual({ statusLabel: null, statusTitle: null });
    expect(limitMessage(limits, 'spotify')).toBe(SPOTIFY_FREE_MESSAGE);
    expect(limitMessage(limits, 'bandcamp')).toBeNull();
  });

  test('an upgrade searches again only where searches were held back', () => {
    // Amazon Prime -> Unlimited: search again.
    expect(limitTransition('1', amazonPlaybackLimit(amazonStatus('unlimited')))).toEqual({ reresolve: true, store: '0' });
    // Spotify Free -> Premium: its searches ran all along.
    expect(limitTransition('1', spotifyPlaybackLimit('premium'))).toEqual({ reresolve: false, store: '0' });
    // Still blocked, first sighting, or no reading: nothing to do.
    expect(limitTransition('1', amazonPlaybackLimit(amazonStatus('prime')))).toEqual({ reresolve: false, store: '1' });
    expect(limitTransition(null, amazonPlaybackLimit(amazonStatus('unlimited')))).toEqual({ reresolve: false, store: '0' });
    expect(limitTransition('1', null)).toEqual({ reresolve: false, store: null });
    expect(limitStorageKey('amazonmusic')).toBe('playback_limit_blocked:amazonmusic');
  });
});

describe('app wiring', () => {
  test('one map, fed by each service, decides what plays', () => {
    const map = between(app, 'const playbackLimits = useMemo(() => ({', '}), [');
    expect(map).toMatch(/amazonmusic: PlaybackLimits\.amazonPlaybackLimit\(amazonMusicStatus\)/);
    expect(map).toMatch(/spotify: spotifyConnected \? PlaybackLimits\.spotifyPlaybackLimit\(spotifyProduct\) : null/);
    expect(app).toMatch(/const planBlockedResolverIds = useMemo\(\(\) => PlaybackLimits\.planBlockedIds\(playbackLimits\), \[playbackLimits\]\);/);
    expect(app).toMatch(/PlaybackLimits\.playbackResolverIds\(activeResolvers, planBlockedResolverIds\)/);
    // No service is special-cased in the derivation any more.
    expect(app).not.toMatch(/\? \['amazonmusic'\] : \[\]/);
  });

  test('blocked resolvers are left out of playback, icons and priority, but stay active', () => {
    // The engine plays only from playbackResolvers.
    expect(app).toMatch(/activeResolversRef: playbackResolversRef,/);
    // Source icons: every badge filter in app.js, the playbar picker and the pages.
    expect(app).not.toMatch(/\.filter\(\(\[resolverId\]\) => activeResolvers\.includes\(resolverId\)\)/);
    expect(app.match(/\.filter\(\(\[resolverId\]\) => playbackResolvers\.includes\(resolverId\)\)/g)).toHaveLength(6);
    expect(app).toMatch(/if \(!playbackResolvers\.includes\(resId\)\) return false;/);
    expect(app.match(/^\s+activeResolvers: playbackResolvers, /gm)).toHaveLength(4);
    // Settings: numbered first, then blocked with no number (display only;
    // resolverOrder keeps their slot); blocked tiles can't be dragged or
    // dropped on.
    expect(app).toMatch(/\[\.\.\.playingInOrder, \.\.\.planBlockedInOrder\]\.forEach\(\(resolverId, index\) => \{/);
    expect(app).toMatch(/priorityNumber: index < playingInOrder\.length \? index \+ 1 : null,/);
    expect(app).toMatch(/const reorderable = isActive && !planBlockedResolverIds\.includes\(resolver\.id\);/);
    expect(app).toMatch(/draggable: reorderable,/);
    expect(app).toMatch(/onDrop: reorderable \? /);
    expect(app).not.toMatch(/setResolverOrder\([^)]*planBlocked/);
    // Metadata still asks every active resolver.
    expect(app).toMatch(/const amazonMusicEnabled = activeResolvers\.includes\('amazonmusic'\);/);
  });

  test('the tile, the Amazon panel and the Spotify panel read the map', () => {
    expect(app).toMatch(/const planStatus = isActive \? PlaybackLimits\.tileStatus\(playbackLimits, resolver\.id\) : \{ statusLabel: null, statusTitle: null \};/);
    expect(app).toMatch(/statusLabel: planStatus\.statusLabel,\s*statusTitle: planStatus\.statusTitle,/);
    expect(app).toMatch(/\? \(PlaybackLimits\.limitMessage\(playbackLimits, 'amazonmusic'\) \|\| ''\)/);
    // The Spotify line no longer claims Premium for every account.
    expect(app).toMatch(/\|\| \(spotifyProduct === 'premium' \? 'Spotify Premium connected' : 'Spotify connected'\)\)/);
    expect(app).not.toMatch(/React\.createElement\('span', null, 'Spotify Premium connected'\)/);
  });

  test('an upgrade searches again, remembered per resolver across restarts', () => {
    const effect = between(app, 'for (const [resolverId, limit] of Object.entries(playbackLimits)) {', '}, [playbackLimits]);');
    expect(effect).toMatch(/PlaybackLimits\.limitTransition\(last, limit\)/);
    expect(effect).toMatch(/if \(reresolve\) \{[\s\S]*clearResolverMisses\(resolverId\);/);
    expect(effect).toMatch(/localStorage\.setItem\(key, store\)/);
    // The Amazon-only key is gone; the clear is per resolver.
    expect(app).not.toMatch(/amazonmusic_last_plan/);
    expect(app).toMatch(/const clearResolverMisses = \(resolverId\) => \{/);
    expect(app).toMatch(/window\.__parachordClearAmazonNoMatch = \(\) => clearResolverMisses\('amazonmusic'\);/);
    const clear = between(app, 'const clearResolverMisses = (resolverId) => {', "window.__parachordClearAmazonNoMatch = ");
    expect(clear).not.toMatch(/amazonmusic/);
  });

  test('Spotify: the plan is learned from playback, expires when free, and a disconnect forgets it', () => {
    // Spotify stopped reporting `product` on /v1/me (Feb 2026), so nothing asks.
    expect(app).not.toMatch(/api\.spotify\.com\/v1\/me'/);
    expect(main).not.toMatch(/'user-read-private'/);
    const note = between(app, 'window.__parachordNotePlanRefusal = (resolverId, planKey) => {', '\n  };');
    expect(note).toMatch(/setSpotifyProduct\(product\);/);
    expect(note).toMatch(/refreshAmazonMusicStatus\(\);/);
    expect(app).toMatch(/window\.__parachordNotePlanPlays = \(resolverId\) => \{\s*if \(resolverId === 'spotify' && spotifyProduct !== 'premium'\) setSpotifyProduct\('premium'\);/);
    expect(engine).toMatch(/if \(typeof window\.__parachordNotePlanPlays === 'function'\) window\.__parachordNotePlanPlays\(resolverId\);/);
    // A 'free' reading expires: a blocked Spotify is never tried.
    expect(app).toMatch(/const SPOTIFY_FREE_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000;/);
    expect(app).toMatch(/if \(saved\.product !== 'premium' && Date\.now\(\) - \(saved\.at \|\| 0\) > SPOTIFY_FREE_TTL_MS\) return null;/);
    // The panel's Check again clears it.
    const button = between(app, "PlaybackLimits.limitMessage(playbackLimits, 'spotify') && React.createElement('button', {", "'Check again')");
    expect(button).toMatch(/onClick: \(\) => \{\s*setSpotifyProduct\(null\);/);
    const disconnect = between(app, 'const disconnectSpotify = async () => {', '\n  };');
    expect(disconnect).toMatch(/setSpotifyProduct\(null\);/);
  });
});

describe('engine: a play refused for the plan', () => {
  const fn = between(engine, 'const handlePlanRefusal = (err, refusedId, label) => {', '\n    };');

  test('is shared by every resolver, recorded with the app, and falls back to another source', () => {
    expect(fn).toMatch(/err\.reason !== 'plan-ineligible'/);
    expect(fn).toMatch(/window\.__parachordNotePlanRefusal\(refusedId, err\.planKey\)/);
    expect(fn).toMatch(/handlePlay\(\{\s*\.\.\.trackOrSource,\s*sources: Object\.fromEntries\(Object\.entries\(trackOrSource\.sources\)\.filter\(\(\[id\]\) => id !== refusedId\)\)/);
    // The fallback toast is explained once per resolver per session.
    expect(fn).toMatch(/if \(!planRefusalExplained\.has\(refusedId\)\)/);
  });

  test('Widevine (Amazon): before the sign-in path, and after a sign-in retry', () => {
    const branch = between(engine, 'if (isWidevineResolver(resolverId)) {', '// Check if another play request superseded this one while loading');
    const planCheck = branch.indexOf('if (handlePlanRefusal(error, resolverId, streamLabel)) return;');
    expect(planCheck).toBeGreaterThan(-1);
    expect(planCheck).toBeLessThan(branch.indexOf("error.reason === 'not-signed-in'"));
    expect(branch).toMatch(/if \(handlePlanRefusal\(retryError, resolverId, streamLabel\)\) return;/);
  });

  test('resolver.play (Spotify): instead of the re-resolve dialog, dropped when superseded', () => {
    expect(engine).toMatch(/if \(error && error\.reason === 'plan-ineligible'\) \{\s*if \(playbackGenerationRef\.current === thisGeneration\) handlePlanRefusal\(error, resolverId, resolver\.name\);\s*return;\s*\}\s*console\.error\(`❌ Error playing with/);
  });
});

describe('spotify.axe play(): PREMIUM_REQUIRED is the plan', () => {
  const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'plugins', 'spotify.axe'), 'utf8'));
  const play = new Function('return ' + axe.implementation.play)();
  const track = { spotifyUri: 'spotify:track:abc', title: 'Hard to Explain' };
  const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body || {}) });
  const PREMIUM_REQUIRED = { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } };
  const device = (isActive) => ({ id: 'dev1', name: 'DESKTOP', type: 'Computer', is_active: isActive, is_restricted: false });

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // A host with the playback-limits hook (desktop 0.9.12+).
    global.window = { __parachordNotePlanRefusal: () => null };
  });
  afterEach(() => { jest.restoreAllMocks(); delete global.fetch; delete global.window; });

  test('a play refused with PREMIUM_REQUIRED throws plan-ineligible (free)', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith('/me/player/devices')) return json(200, { devices: [device(true)] });
      if (url.includes('/me/player/play')) return json(403, PREMIUM_REQUIRED);
      throw new Error('unexpected ' + url);
    });
    await expect(play(track, { token: 't' })).rejects.toMatchObject({ reason: 'plan-ineligible', planKey: 'free' });
  });

  test('a transfer refused with PREMIUM_REQUIRED is the plan too', async () => {
    global.fetch = jest.fn(async (url, opts = {}) => {
      if (url.endsWith('/me/player/devices')) return json(200, { devices: [device(false)] });
      if (url.endsWith('/me/player') && opts.method === 'PUT') return json(403, PREMIUM_REQUIRED);
      throw new Error('unexpected ' + url);
    });
    await expect(play(track, { token: 't' })).rejects.toMatchObject({ reason: 'plan-ineligible' });
  });

  test('an older host (no hook) gets the plain false it always handled', async () => {
    delete global.window;
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith('/me/player/devices')) return json(200, { devices: [device(true)] });
      if (url.includes('/me/player/play')) return json(403, PREMIUM_REQUIRED);
      throw new Error('unexpected ' + url);
    });
    await expect(play(track, { token: 't' })).resolves.toBe(false);
  });

  test('the plugin needs desktop 0.9.12 for this, and says so', () => {
    expect(axe.manifest.minAppVersion).toEqual({ desktop: '0.9.12' });
  });

  test('another 403 is a plain failure, not the plan', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith('/me/player/devices')) return json(200, { devices: [device(true)] });
      if (url.includes('/me/player/play')) return json(403, { error: { status: 403, message: 'Restriction violated', reason: 'UNKNOWN' } });
      throw new Error('unexpected ' + url);
    });
    await expect(play(track, { token: 't' })).resolves.toBe(false);
  });
});
