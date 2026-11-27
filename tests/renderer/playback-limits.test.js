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
const ResolverLoader = require('../../resolver-loader');
const {
  appleMusicPlaybackLimit,
  pluginStatusLimit,
  pluginStatusLimits,
  signedOutPlaybackLimit,
  isSignedOutLimit,
  pluginStatusRow,
  planBlockedIds,
  playbackResolverIds,
  tileStatus,
  limitMessage,
  limitTransition,
  limitStorageKey
} = require('../../src/renderer/lib/playback-limits');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages moved out of it (#1451)
const engine = read('src/renderer/hooks/use-playback-engine.js');

const between = (src, start, end) => {
  const i = src.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  const j = src.indexOf(end, i + start.length);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};

// Amazon's status reply since #1356 M10 is the plugin's (capabilities.status):
// the plugin carries its plan, the tile labels and the wording itself, and the
// renderer maps it with the generic pluginStatusLimit — the per-service
// amazonPlaybackLimit mapper and the IPC status it fed are deleted (the
// plugin's reply mapping is pinned in
// tests/resolver/amazon-music-plugin-session.test.js).
// Every Amazon plan but Music Unlimited plays only the account's bought
// tracks (#1494): unblocked, ownedOnly. The blocked cases are another
// service's (otherLimit below).
const PRIME_MESSAGE = "Amazon Prime: Parachord plays the songs you've bought from Amazon. Playing anything else from Amazon needs Music Unlimited.";
const UNKNOWN_MESSAGE = "Parachord plays the songs you've bought from Amazon. Playing anything else from Amazon needs Music Unlimited, which Parachord couldn't find on your account.";
const amazonReply = (plan) => ({
  signedIn: true,
  playbackLimit: plan === 'unlimited'
    ? { blocked: false, planKey: 'unlimited', label: null, message: null, searchesHeldBack: true }
    : plan === 'prime'
      ? { blocked: false, ownedOnly: true, planKey: 'prime', label: 'Prime: purchases only', message: PRIME_MESSAGE, searchesHeldBack: true }
      : { blocked: false, ownedOnly: true, planKey: plan, label: 'Purchases only', message: UNKNOWN_MESSAGE, searchesHeldBack: true },
  statusLabel: null,
  statusMessage: plan === 'unlimited' ? null : plan === 'prime' ? PRIME_MESSAGE : UNKNOWN_MESSAGE
});
const amazonLimit = (plan) => pluginStatusLimit(amazonReply(plan));
// A second service with a free tier that can't play on demand and whose
// searches work on every plan: the shape a future mapper returns.
const OTHER_MESSAGE = 'Other Free: Other is used for search and links. Playing Other tracks in Parachord needs Other Premium.';
const otherLimit = (blocked) => ({ blocked, planKey: blocked ? 'free' : 'premium', label: blocked ? 'Free: no playback' : null, message: blocked ? OTHER_MESSAGE : null });

describe('Apple Music: signed out leaves playback until it connects (2026-11)', () => {
  test('no verdict until the startup sign-in check has finished', () => {
    expect(appleMusicPlaybackLimit({ checked: false, connected: false })).toBeNull();
    expect(appleMusicPlaybackLimit({ checked: false, connected: true })).toBeNull();
  });
  test('checked and not connected blocks, says so, and holds no searches back', () => {
    expect(appleMusicPlaybackLimit({ checked: true, connected: false })).toMatchObject({
      blocked: true, planKey: 'signed-out', label: 'Not connected', searchesHeldBack: false,
    });
    expect(appleMusicPlaybackLimit({ checked: true, connected: false }).message).toMatch(/Connect/);
  });
  test('connected plays', () => {
    expect(appleMusicPlaybackLimit({ checked: true, connected: true })).toMatchObject({ blocked: false, label: null });
  });
  test('the app feeds it the startup check and the connection', () => {
    const map = between(app, 'const playbackLimits = useMemo(() => ({', '}), [');
    expect(map).toMatch(/applemusic: PlaybackLimits\.appleMusicPlaybackLimit\(\{ checked: appleMusicAuthChecked, connected: appleMusicConnected \}\)/);
    expect(app).toMatch(/\}\), \[appleMusicAuthChecked, appleMusicConnected, pluginStatuses, pluginsSignedOut\]\);/);
    // The check marks itself finished whatever it decided.
    const check = between(app, 'const checkMusicKitAvailable = async () => {', 'checkMusicKitAvailable();');
    expect(check).toMatch(/finally \{\s*setAppleMusicAuthChecked\(true\);/);
  });
  // A plan that can't play keeps a signed-in tile in full colour (it is on).
  // A signed-out one reads as off instead (#1614: a plug-in that needs a
  // sign-in never shows as enabled until it's signed in).
  test('a tile that can\'t play stays in full colour (it is on), unnumbered, with its warning line; signed out, it reads as off', () => {
    const card = read('src/renderer/components/settings-cards.js');
    expect(card).toMatch(/const isEnabled = isActive === true && !signInNeeded;/);
    expect(card).toMatch(/const isGrayed = !isEnabled && !isInstalling;/);
    expect(app).toMatch(/priorityNumber: index < playingInOrder\.length \? index \+ 1 : null,/);
  });
});

describe('what the map drives', () => {
  const limits = {
    amazonmusic: amazonLimit('prime'),
    other: otherLimit(true),
    soundcloud: null
  };

  test('the blocked ids, and the resolvers that play', () => {
    expect(planBlockedIds(limits)).toEqual(['other']);
    expect(planBlockedIds({ other: otherLimit(false) })).toEqual([]);
    const active = ['other', 'amazonmusic', 'bandcamp'];
    expect(playbackResolverIds(active, ['amazonmusic', 'other'])).toEqual(['bandcamp']);
    // Nothing blocked: the same array, so a memo on it stays stable.
    expect(playbackResolverIds(active, [])).toBe(active);
  });

  test('the tile label and tooltip, and the panel message', () => {
    expect(tileStatus(limits, 'other')).toEqual({ statusLabel: 'Free: no playback', statusTitle: OTHER_MESSAGE });
    expect(tileStatus(limits, 'amazonmusic')).toEqual({ statusLabel: 'Prime: purchases only', statusTitle: PRIME_MESSAGE });
    expect(tileStatus(limits, 'soundcloud')).toEqual({ statusLabel: null, statusTitle: null });
    expect(tileStatus({ other: otherLimit(false) }, 'other')).toEqual({ statusLabel: null, statusTitle: null });
    expect(limitMessage(limits, 'other')).toBe(OTHER_MESSAGE);
    expect(limitMessage(limits, 'bandcamp')).toBeNull();
  });

  test('an upgrade searches again only where searches were held back', () => {
    // Amazon Prime -> Unlimited: search again (the plugin's reply says
    // searchesHeldBack even when unblocked — that is what re-triggers).
    expect(limitTransition('1', amazonLimit('unlimited'))).toEqual({ reresolve: true, purge: false, store: '0' });
    // A service whose searches ran all along: nothing to search again.
    expect(limitTransition('1', otherLimit(false))).toEqual({ reresolve: false, purge: false, store: '0' });
    // Still blocked, first sighting, or no reading: nothing to do.
    expect(limitTransition('1', otherLimit(true))).toEqual({ reresolve: false, purge: false, store: '1' });
    expect(limitTransition(null, amazonLimit('unlimited'))).toEqual({ reresolve: false, purge: false, store: '0' });
    expect(limitTransition('1', null)).toEqual({ reresolve: false, purge: false, store: null });
    expect(limitStorageKey('amazonmusic')).toBe('playback_limit_blocked:amazonmusic');
  });
});

describe('plugins that report their own status (capabilities.status, #1356)', () => {
  test('a valid playbackLimit becomes the limit entry, validated field by field', () => {
    expect(pluginStatusLimit({
      signedIn: true,
      playbackLimit: { blocked: true, planKey: 'free', label: 'Free: no playback', message: 'Playing needs Awesome Premium.', searchesHeldBack: true },
      statusLabel: 'Free plan', statusMessage: 'Playing needs Awesome Premium.'
    })).toEqual({ blocked: true, planKey: 'free', label: 'Free: no playback', message: 'Playing needs Awesome Premium.', searchesHeldBack: true });
    // A playable reply is an unblocked entry, like Amazon's unlimited.
    expect(pluginStatusLimit({ playbackLimit: { blocked: false, planKey: 'premium', searchesHeldBack: false } }))
      .toEqual({ blocked: false, planKey: 'premium', label: null, message: null, searchesHeldBack: false });
    // Fields that aren't strings (or are missing) degrade to null, never a
    // crash or a guess; searchesHeldBack is true only when the plugin says so.
    expect(pluginStatusLimit({ playbackLimit: { blocked: true, planKey: 7, label: {}, message: null, searchesHeldBack: 'yes' } }))
      .toEqual({ blocked: true, planKey: null, label: null, message: null, searchesHeldBack: false });
  });

  test('no verdict: a null status, a reply without a playbackLimit, or a malformed one', () => {
    expect(pluginStatusLimit(null)).toBeNull();
    expect(pluginStatusLimit(undefined)).toBeNull();
    expect(pluginStatusLimit('signed-in')).toBeNull();
    // Signed in with nothing to say: no limit, like Amazon before the status loads.
    expect(pluginStatusLimit({ signedIn: true, playbackLimit: null, statusLabel: 'Signed in', statusMessage: null })).toBeNull();
    // Malformed playbackLimit: no verdict, never a guess — a status outage
    // must not unplug playback (resolver-loader.js getStatus answers its
    // failed marker for a throwing plugin; this is the same rule for a
    // shaped one).
    expect(pluginStatusLimit({ playbackLimit: { blocked: 'yes' } })).toBeNull();
    expect(pluginStatusLimit({ playbackLimit: 'blocked' })).toBeNull();
    expect(pluginStatusLimit({ playbackLimit: {} })).toBeNull();
  });

  test('the Settings sign-in row: the reply\u2019s own two lines, signedIn and loading as fallbacks', () => {
    expect(pluginStatusRow({ statusLabel: 'Free plan', statusMessage: 'Playing needs Awesome Premium.' }))
      .toEqual({ label: 'Free plan', message: 'Playing needs Awesome Premium.' });
    // No label of its own: signedIn carries the line (null: not known yet).
    expect(pluginStatusRow({ signedIn: true }).label).toBe('Signed in');
    expect(pluginStatusRow({ signedIn: false }).label).toBe('Not signed in');
    expect(pluginStatusRow({ signedIn: null }).label).toBe('Checking…');
    // No reply yet — still loading — and a malformed reply: the row degrades,
    // never a crash in the panel.
    expect(pluginStatusRow(undefined)).toEqual({ label: 'Checking…', message: '' });
    expect(pluginStatusRow(null)).toEqual({ label: 'Checking…', message: '' });
    expect(pluginStatusRow('signed-in')).toEqual({ label: 'Checking…', message: '' });
    expect(pluginStatusRow({ statusLabel: 'Signed in', statusMessage: 42 })).toEqual({ label: 'Signed in', message: '' });
  });

  test('the Settings sign-in row: a failed read says what happened and what to do, not \u201cChecking\u2026\u201d forever', () => {
    // The loader's failed-read marker (resolver-loader.js STATUS_READ_FAILED):
    // the plugin threw, answered nothing shaped, or ran past the read budget.
    // No verdict for the limit map — but the row is honest about the failure.
    expect(pluginStatusRow(ResolverLoader.STATUS_READ_FAILED)).toEqual({
      label: "Couldn’t check",
      message: "Parachord couldn’t check this plug-in’s status. Try opening this panel again."
    });
  });
});

describe('plugin entries: a plugin wins only when it actually gives a verdict', () => {
  // Finding 1 of the #1433 review: app.js spreads these entries AFTER the
  // per-service mappers, so a null entry would REPLACE a mapper's verdict —
  // an amazonmusic plugin with a failed read would un-block a Prime account.
  // The drop is the rule: no verdict, no entry.
  test('a no-verdict reply is dropped — null, the loader\u2019s failed marker, a reply without a playbackLimit', () => {
    const noVerdict = {
      hung: ResolverLoader.STATUS_READ_FAILED,
      threw: ResolverLoader.STATUS_READ_FAILED,
      unsigned: null,
      nothingToSay: { signedIn: true, playbackLimit: null, statusLabel: 'Signed in', statusMessage: null },
      malformed: { playbackLimit: { blocked: 'yes' } }
    };
    expect(pluginStatusLimits(noVerdict)).toEqual({});
    expect(pluginStatusLimits(undefined)).toEqual({});
  });

  test('a verdict stays, keyed by the resolver that gave it', () => {
    const blocked = { blocked: true, planKey: 'free', label: 'Free: no playback', message: 'Needs Premium.', searchesHeldBack: true };
    const entries = pluginStatusLimits({
      awesomemusic: { playbackLimit: blocked },
      applemusic: { playbackLimit: { blocked: false, planKey: 'connected' } }
    });
    expect(entries).toEqual({
      awesomemusic: { blocked: true, planKey: 'free', label: 'Free: no playback', message: 'Needs Premium.', searchesHeldBack: true },
      applemusic: { blocked: false, planKey: 'connected', label: null, message: null, searchesHeldBack: false }
    });
  });

  test('a mapper\u2019s own block survives a plugin that can\u2019t answer', () => {
    // The migration window: the host still owns the verdict
    // (appleMusicPlaybackLimit — Amazon's own mapper died with its IPC
    // status, #1356 M10) while the plugin's read is down — the map stays
    // blocked.
    const limits = {
      applemusic: appleMusicPlaybackLimit({ checked: true, connected: false }),
      ...pluginStatusLimits({ applemusic: ResolverLoader.STATUS_READ_FAILED })
    };
    expect(limits.applemusic.blocked).toBe(true);
    expect(planBlockedIds(limits)).toEqual(['applemusic']);
  });
});

describe('app wiring', () => {
  test('one map, fed by each service, decides what plays', () => {
    const map = between(app, 'const playbackLimits = useMemo(() => ({', '}), [');
    expect(map).not.toMatch(/amazonmusic:/); // Amazon's entry is the plugin's reply
    // The plugin entries spread after the mappers through the
    // null-dropping helper (a no-verdict reply never lands over a mapper).
    expect(map).toMatch(/\.\.\.PlaybackLimits\.pluginStatusLimits\(pluginStatuses, pluginName, pluginsSignedOut\)/);
    expect(app).toMatch(/const planBlockedResolverIds = useMemo\(\(\) => PlaybackLimits\.planBlockedIds\(playbackLimits\), \[playbackLimits\]\);/);
    expect(app).toMatch(/PlaybackLimits\.notPlayingIds\(planBlockedResolverIds, playbackOffResolvers\)/);
    expect(app).toMatch(/PlaybackLimits\.playbackResolverIds\(activeResolvers, notPlayingResolverIds\)/);
    // No service is special-cased in the derivation any more.
    expect(app).not.toMatch(/\? \['amazonmusic'\] : \[\]/);
  });

  test('blocked resolvers are left out of playback, icons and priority, but stay active', () => {
    // The engine plays only from playbackResolvers.
    expect(app).toMatch(/activeResolversRef: playbackResolversRef,/);
    // Source icons: every badge filter in app.js, the playbar picker and the pages.
    expect(app).not.toMatch(/\.filter\(\(\[resolverId\]\) => activeResolvers\.includes\(resolverId\)\)/);
    // app.js's track lists are the shared TrackRow, which runs the shared
    // rule (lib/visible-sources) on the sources it is given; every one is
    // given playbackResolvers, and none filters on its own any more.
    expect(app).not.toMatch(/sourceRowState\(/);
    expect(app.match(/sources: \{ trackSources, playbackResolvers, resolverOrder \}/g)).toHaveLength(6);
    expect(app).not.toMatch(/\.filter\(\(\[resolverId\]\) => playbackResolvers\.includes\(resolverId\)\)/);
    // The queue drawer gets playbackResolvers too.
    expect(between(app, 'React.createElement(VirtualizedQueueList, {', '})')).toMatch(/^\s+playbackResolvers,$/m);
    expect(app).toMatch(/if \(!playbackResolvers\.includes\(resId\)\) return false;/);
    expect(app.match(/^\s+activeResolvers: playbackResolvers, /gm)).toHaveLength(4);
    // Settings: numbered first, then blocked with no number (display only;
    // resolverOrder keeps their slot); blocked tiles can't be dragged or
    // dropped on.
    expect(app).toMatch(/\[\.\.\.playingInOrder, \.\.\.planBlockedInOrder\]\.forEach\(\(resolverId, index\) => \{/);
    expect(app).toMatch(/priorityNumber: index < playingInOrder\.length \? index \+ 1 : null,/);
    expect(app).toMatch(/const reorderable = isActive && !signInNeeded && !notPlayingResolverIds\.includes\(resolver\.id\);/);
    expect(app).toMatch(/draggable: reorderable,/);
    expect(app).toMatch(/onDrop: reorderable \? /);
    expect(app).not.toMatch(/setResolverOrder\([^)]*planBlocked/);
    // Amazon stays in activeResolvers — the plugin-status sweep reads it there.
    expect(app).toMatch(/\.filter\(r => activeResolvers\.includes\(r\.id\)\)/);
  });

  test('the tile and the panel read the map and the plugin reply', () => {
    expect(app).toMatch(/const planStatus = isActive \? PlaybackLimits\.tileStatus\(playbackLimits, resolver\.id, playbackOffResolvers\) : \{ statusLabel: null, statusTitle: null \};/);
    expect(app).toMatch(/statusLabel: planStatus\.statusLabel,\s*statusTitle: planStatus\.statusTitle,/);
    // The Settings row is the generic status-capable plugin row (the old
    // Amazon section died with the IPC status): the plugin's own two lines,
    // plus the signIn/signOut triggers.
    expect(app).toMatch(/PlaybackLimits\.pluginStatusRow\(pluginStatuses\[selectedResolver\.id\]\)/);
    expect(app).toMatch(/typeof selectedResolver\.signOut === 'function'/);
    expect(app).toMatch(/typeof selectedResolver\.signIn === 'function'/);
    expect(app).not.toMatch(/limitMessage\(playbackLimits, 'amazonmusic'\)/);
  });

  test('an upgrade searches again, remembered per resolver across restarts', () => {
    const effect = between(app, 'for (const [resolverId, limit] of Object.entries(playbackLimits)) {', '}, [playbackLimits]);');
    expect(effect).toMatch(/PlaybackLimits\.limitTransition\(last, limit\)/);
    expect(effect).toMatch(/if \(reresolve\) \{[\s\S]*clearResolverMisses\(resolverId\);/);
    // Entering a plan that plays only owned tracks drops the saved sources (#1494).
    expect(effect).toMatch(/if \(purge\) \{[\s\S]*clearResolverMisses\(resolverId, \{ sources: true \}\);[\s\S]*\} else if \(reresolve\) \{/);
    expect(effect).toMatch(/localStorage\.setItem\(key, store\)/);
    // The Amazon-only key is gone; the clear is per resolver.
    expect(app).not.toMatch(/amazonmusic_last_plan/);
    expect(app).toMatch(/const clearResolverMisses = \(resolverId, \{ sources: dropFound = false \} = \{\}\) => \{/);
    // A sign-in clears the signed-in plug-in's misses, whichever it is, and
    // puts it back in playback (#1624).
    const onSignedIn = between(app, 'onSignedIn: (id) => {', '\n      },');
    expect(onSignedIn).toMatch(/setPluginsSignedOut\(prev => \(prev\.includes\(id\) \? prev\.filter\(x => x !== id\) : prev\)\);/);
    expect(onSignedIn).toMatch(/clearResolverMisses\(id\);/);
    const clear = between(app, 'const clearResolverMisses = (resolverId, { sources: dropFound = false } = {}) => {', '\n  };');
    expect(clear).not.toMatch(/amazonmusic/);
  });

  test('a plan refusal reports to the app, which re-reads the refusing plugin and supplies no wording of its own', () => {
    const note = between(app, 'window.__parachordNotePlanRefusal = (resolverId, planKey) => {', '\n  };');
    expect(note).toMatch(/refreshPluginStatus\(resolverId\);/);
    expect(note).toMatch(/return null;\s*$/);
    // Amazon is a status-capable plugin since M10 — the same path covers it,
    // no special case left.
    expect(note).not.toMatch(/amazonmusic/);
  });

  test('Spotify: no plan tracking; setup says the app owner needs Premium', () => {
    expect(app).not.toMatch(/spotifyProduct|__parachordNotePlanPlays/);
    expect(engine).not.toMatch(/__parachordNotePlanPlays/);
    // The setup text is the plug-in's manifest (settings.clientKeys.help, #1498).
    const spotify = require('../../plugins-src/spotify/manifest.json');
    expect(spotify.settings.clientKeys.help).toMatch(/The Spotify account that creates the app needs Spotify Premium, and the app stops working if that Premium lapses\./);
  });
});

describe('engine: a play refused for the plan', () => {
  const fn = between(engine, 'const handlePlanRefusal = (err, refusedId, label) => {', '\n    };');
  // The fallback is shared with a signed-out refusal (#1624).
  const fallback = between(engine, 'const playOtherSource = (refusedId, explain, action = null) => {', '\n    };');

  test('is shared by every resolver, recorded with the app, and falls back to another source', () => {
    expect(fn).toMatch(/err\.reason !== 'plan-ineligible'/);
    expect(fn).toMatch(/window\.__parachordNotePlanRefusal\(refusedId, err\.planKey\)/);
    expect(fn).toMatch(/if \(playOtherSource\(refusedId, \(fallbackName\) => `\$\{message\} Playing via \$\{fallbackName\}\.`\)\) return true;/);
    expect(fallback).toMatch(/handlePlay\(\{\s*\.\.\.trackOrSource,\s*sources: Object\.fromEntries\(Object\.entries\(trackOrSource\.sources\)\.filter\(\(\[id\]\) => id !== refusedId\)\)/);
    // The fallback toast is explained once per resolver per session.
    expect(fallback).toMatch(/if \(!planRefusalExplained\.has\(refusedId\)\)/);
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

describe('a plan that plays only owned tracks (Amazon on Prime, #1494)', () => {
  const prime = amazonLimit('prime');

  test('the plugin\'s ownedOnly entry keeps the resolver in playback', () => {
    expect(prime).toEqual({
      blocked: false, ownedOnly: true, planKey: 'prime', label: 'Prime: purchases only', message: PRIME_MESSAGE, searchesHeldBack: true
    });
    expect(planBlockedIds({ amazonmusic: prime })).toEqual([]);
    const active = ['amazonmusic', 'bandcamp'];
    expect(playbackResolverIds(active, planBlockedIds({ amazonmusic: prime }))).toBe(active);
  });

  test('ownedOnly is only ever an unblocked entry\'s, and only when said', () => {
    expect(pluginStatusLimit({ playbackLimit: { blocked: true, ownedOnly: true } })).not.toHaveProperty('ownedOnly');
    expect(pluginStatusLimit({ playbackLimit: { blocked: false, ownedOnly: 'yes' } })).not.toHaveProperty('ownedOnly');
    expect(amazonLimit('unlimited')).not.toHaveProperty('ownedOnly');
  });

  test('the tile says what still plays', () => {
    expect(tileStatus({ amazonmusic: prime }, 'amazonmusic')).toEqual({ statusLabel: 'Prime: purchases only', statusTitle: PRIME_MESSAGE });
    expect(tileStatus({ amazonmusic: { blocked: false, ownedOnly: true } }, 'amazonmusic').statusLabel).toBe('Purchases only');
    expect(limitMessage({ amazonmusic: prime }, 'amazonmusic')).toBeNull();
  });

  test('entering it drops the saved sources and searches again; leaving it for Unlimited searches again', () => {
    // Unlimited -> Prime: sources found on Unlimited may not be owned.
    expect(limitTransition('0', prime)).toEqual({ reresolve: true, purge: true, store: 'owned' });
    // The old whole-resolver block -> Prime, and a first sighting: the same.
    expect(limitTransition('1', prime)).toEqual({ reresolve: true, purge: true, store: 'owned' });
    expect(limitTransition(null, prime)).toEqual({ reresolve: true, purge: true, store: 'owned' });
    // Still on Prime: nothing.
    expect(limitTransition('owned', prime)).toEqual({ reresolve: false, purge: false, store: 'owned' });
    // Prime -> Unlimited: the searches answered only owned tracks.
    expect(limitTransition('owned', amazonLimit('unlimited'))).toEqual({ reresolve: true, purge: false, store: '0' });
    // Prime -> a plan that isn't read: still purchases only.
    expect(limitTransition('owned', amazonLimit('unknown'))).toEqual({ reresolve: false, purge: false, store: 'owned' });
    // Owned-only -> blocked (another service's plan): it leaves playback whole.
    expect(limitTransition('owned', otherLimit(true))).toEqual({ reresolve: false, purge: false, store: '1' });
  });
});

describe('the user\'s "Play from" choice joins the plan limits (#1505)', () => {
  const PL = require('../../src/renderer/lib/playback-limits');
  test('notPlayingIds: plan-blocked and switched-off, once each', () => {
    expect(PL.notPlayingIds(['amazonmusic'], ['youtube', 'amazonmusic'])).toEqual(['amazonmusic', 'youtube']);
    const blocked = ['amazonmusic'];
    expect(PL.notPlayingIds(blocked, [])).toBe(blocked);
  });
  test('tileStatus: the plan\'s label wins; a switched-off one says what\'s left', () => {
    const limits = { amazonmusic: { blocked: true, label: 'Prime: no playback', message: 'm' } };
    expect(PL.tileStatus(limits, 'amazonmusic', ['amazonmusic']).statusLabel).toBe('Prime: no playback');
    expect(PL.tileStatus(limits, 'youtube', ['youtube']).statusLabel).toBe('Search and links only');
    expect(PL.tileStatus(limits, 'spotify', ['youtube']).statusLabel).toBe(null);
  });
});

// A plug-in that needs a sign-in and is signed out leaves playback like a
// signed-out Apple Music (#1624): a source it found while signed in is never
// picked only to be refused.
describe('a signed-out plug-in leaves playback', () => {
  test('a status reply saying signedIn: false is the signed-out entry, named', () => {
    const limit = pluginStatusLimit({ signedIn: false, playbackLimit: null, cdm: true }, 'Amazon Music');
    expect(limit).toEqual(signedOutPlaybackLimit('Amazon Music'));
    expect(limit).toMatchObject({ blocked: true, planKey: 'signed-out', label: 'Not signed in', searchesHeldBack: false });
    expect(limit.message).toBe('Amazon Music isn’t signed in, so Parachord won’t play from it. Sign in to it in Settings › Plug-Ins › Amazon Music.');
    expect(isSignedOutLimit(limit)).toBe(true);
  });

  test('a failed read is never signed out, and the plug-in\'s own verdict wins', () => {
    expect(pluginStatusLimit({ failed: true, signedIn: false })).toBeNull();
    expect(pluginStatusLimit({ signedIn: true })).toBeNull();
    expect(pluginStatusLimit({ signedIn: false, playbackLimit: { blocked: false, planKey: 'free', searchesHeldBack: false } }, 'X'))
      .toMatchObject({ blocked: false, planKey: 'free' });
  });

  test('the map takes each plug-in\'s name, and a refusal\'s verdict over a signed-in status', () => {
    const limits = pluginStatusLimits(
      { amazonmusic: { signedIn: true, playbackLimit: null }, other: { signedIn: false } },
      (id) => ({ amazonmusic: 'Amazon Music', other: 'Other Player' }[id]),
      ['amazonmusic']
    );
    expect(limits.amazonmusic).toEqual(signedOutPlaybackLimit('Amazon Music'));
    expect(limits.other.message).toMatch(/^Other Player isn’t signed in/);
    expect(planBlockedIds(limits)).toEqual(['amazonmusic', 'other']);
    expect(playbackResolverIds(['spotify', 'amazonmusic', 'other'], planBlockedIds(limits))).toEqual(['spotify']);
  });

  test('signing out and back in keeps the plan it left: no purge, nothing remembered', () => {
    const out = signedOutPlaybackLimit('Amazon Music');
    expect(limitTransition('owned', out)).toEqual({ reresolve: false, purge: false, store: null });
    expect(limitTransition('0', out)).toEqual({ reresolve: false, purge: false, store: null });
    // Apple Music's signed-out entry is the same kind.
    expect(isSignedOutLimit(appleMusicPlaybackLimit({ checked: true, connected: false }))).toBe(true);
    expect(isSignedOutLimit(amazonLimit('prime'))).toBe(false);
  });

  test('the app feeds the map the names and the refusals, and the flow keeps the refusals', () => {
    const flow = between(app, '  const promptPluginSignIn = (() => {', '  window.__parachordPromptPluginSignIn = promptPluginSignIn;');
    expect(flow).toMatch(/onSignedOut: \(id\) => setPluginsSignedOut\(prev => \(prev\.includes\(id\) \? prev : \[\.\.\.prev, id\]\)\),/);
    expect(flow).toMatch(/prompt\.isSignedOut = \(resolverId\) => PlaybackLimits\.isSignedOutLimit\(playbackLimitsRef\.current\[resolverId\]\)\s*&& flow\.canPrompt\(resolverId\);/);
  });
});

describe('engine: a play refused as signed out (#1624)', () => {
  const widevine = between(engine, "if (error && error.reason === 'not-signed-in' && typeof window.__parachordPromptPluginSignIn === 'function'", '// Sign-in closed without signing in: Play asks again.');
  const pastSignedOut = between(engine, 'const playPastSignedOut = (refusedId) => {', '\n    };');

  test('with another source it asks nothing and plays that one, with Sign in on the toast', () => {
    expect(widevine).toMatch(/const hasOtherSource = otherPlayableSources\(resolverId\)\.length > 0;/);
    expect(widevine).toMatch(/ask: !hasOtherSource/);
    expect(widevine).toMatch(/if \(!ok && hasOtherSource && playPastSignedOut\(resolverId\)\) return;/);
    // The quiet retry refused again moves on too.
    expect(widevine).toMatch(/retryError\.reason === 'not-signed-in' && hasOtherSource\s*&& playPastSignedOut\(resolverId\)\) return;/);
    expect(pastSignedOut).toMatch(/`You’re signed out of \$\{name\}\. Playing via \$\{fallbackName\}\.`/);
    expect(pastSignedOut).toMatch(/label: 'Sign in',/);
    expect(pastSignedOut).toMatch(/forcePrompt: true/);
  });

  test('a track only a signed-out plug-in has asks to sign in to it, never while the queue advances', () => {
    const noSource = between(engine, "if (autoSkipIfAdvancing('no enabled source matches')) return;", "reportUnplayable('No enabled source'");
    expect(noSource).toMatch(/availableResolvers\.find\(id => promptSignIn\.isSignedOut\(id\)\)/);
    expect(noSource).toMatch(/promptSignIn\(signedOutId, \{ explicit: true, reason: 'not-signed-in', forcePrompt: true, refused: true \}\)/);
    expect(noSource).toMatch(/if \(ok && await backInPlayback\(signedOutId\)\) \{[\s\S]*handlePlay\(trackOrSource\);/);
    expect(noSource).toMatch(/holdFailedTrack\(\);/);
  });
});
