/**
 * Playback limits: resolvers that are set up but can't play on the account's
 * plan (Amazon off Music Unlimited, #1220). One map
 * (src/renderer/lib/playback-limits.js) drives what the app leaves out of
 * playback, the Settings tile and panel, and the re-search after an upgrade;
 * the engine handles a play refused for the plan the same way for any
 * resolver.
 */

const fs = require('fs');
const path = require('path');
const {
  amazonPlaybackLimit,
  planBlockedIds,
  playbackResolverIds,
  tileStatus,
  limitMessage,
  limitTransition,
  limitStorageKey
} = require('../../src/renderer/lib/playback-limits');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const app = read('src/renderer/app.js');
const engine = read('src/renderer/hooks/use-playback-engine.js');

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
// A second service with a free tier that can't play on demand and whose
// searches work on every plan: the shape a future mapper returns.
const OTHER_MESSAGE = 'Other Free: Other is used for search and links. Playing Other tracks in Parachord needs Other Premium.';
const otherLimit = (blocked) => ({ blocked, planKey: blocked ? 'free' : 'premium', label: blocked ? 'Free: no playback' : null, message: blocked ? OTHER_MESSAGE : null });

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
});

describe('what the map drives', () => {
  const limits = {
    amazonmusic: amazonPlaybackLimit(amazonStatus('prime')),
    other: otherLimit(true),
    soundcloud: null
  };

  test('the blocked ids, and the resolvers that play', () => {
    expect(planBlockedIds(limits)).toEqual(['amazonmusic', 'other']);
    expect(planBlockedIds({ other: otherLimit(false) })).toEqual([]);
    const active = ['other', 'amazonmusic', 'bandcamp'];
    expect(playbackResolverIds(active, ['amazonmusic', 'other'])).toEqual(['bandcamp']);
    // Nothing blocked: the same array, so a memo on it stays stable.
    expect(playbackResolverIds(active, [])).toBe(active);
  });

  test('the tile label and tooltip, and the panel message', () => {
    expect(tileStatus(limits, 'other')).toEqual({ statusLabel: 'Free: no playback', statusTitle: OTHER_MESSAGE });
    expect(tileStatus(limits, 'amazonmusic')).toEqual({ statusLabel: 'Prime: no playback', statusTitle: PRIME_MESSAGE });
    expect(tileStatus(limits, 'soundcloud')).toEqual({ statusLabel: null, statusTitle: null });
    expect(tileStatus({ other: otherLimit(false) }, 'other')).toEqual({ statusLabel: null, statusTitle: null });
    expect(limitMessage(limits, 'other')).toBe(OTHER_MESSAGE);
    expect(limitMessage(limits, 'bandcamp')).toBeNull();
  });

  test('an upgrade searches again only where searches were held back', () => {
    // Amazon Prime -> Unlimited: search again.
    expect(limitTransition('1', amazonPlaybackLimit(amazonStatus('unlimited')))).toEqual({ reresolve: true, store: '0' });
    // A service whose searches ran all along: nothing to search again.
    expect(limitTransition('1', otherLimit(false))).toEqual({ reresolve: false, store: '0' });
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

  test('the tile and the Amazon panel read the map', () => {
    expect(app).toMatch(/const planStatus = isActive \? PlaybackLimits\.tileStatus\(playbackLimits, resolver\.id\) : \{ statusLabel: null, statusTitle: null \};/);
    expect(app).toMatch(/statusLabel: planStatus\.statusLabel,\s*statusTitle: planStatus\.statusTitle,/);
    expect(app).toMatch(/\? \(PlaybackLimits\.limitMessage\(playbackLimits, 'amazonmusic'\) \|\| ''\)/);
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

  test('a plan refusal reports to the app, which records Amazon and supplies no wording of its own', () => {
    const note = between(app, 'window.__parachordNotePlanRefusal = (resolverId, planKey) => {', '\n  };');
    expect(note).toMatch(/refreshAmazonMusicStatus\(\);/);
    expect(note).toMatch(/return null;\s*$/);
  });

  test('Spotify: no plan tracking; setup says the app owner needs Premium', () => {
    expect(app).not.toMatch(/spotifyProduct|__parachordNotePlanPlays/);
    expect(engine).not.toMatch(/__parachordNotePlanPlays/);
    expect(app).toMatch(/The Spotify account that creates the app needs Spotify Premium, and the app stops working if that Premium lapses\./);
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

  test('resolver.play (any plugin): instead of the re-resolve dialog, dropped when superseded', () => {
    expect(engine).toMatch(/if \(error && error\.reason === 'plan-ineligible'\) \{\s*if \(playbackGenerationRef\.current === thisGeneration\) handlePlanRefusal\(error, resolverId, resolver\.name\);\s*return;\s*\}\s*console\.error\(`❌ Error playing with/);
  });
});

describe('spotify.axe: unchanged by playback limits', () => {
  test('no plan-ineligible refusal and no minAppVersion', () => {
    const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'plugins', 'spotify.axe'), 'utf8'));
    expect(axe.implementation.play).not.toMatch(/plan-ineligible/);
    expect(axe.manifest.minAppVersion).toBeUndefined();
  });
});
