/**
 * Engine-wiring structural guards — the blockers a render-smoke probe can't
 * see. dartSlice-3's straight-move passed early gates while its wiring layer
 * was broken four ways (found in review round 1). These tests assert the
 * invariants directly:
 *
 * 1. Every DIRECT ctx literal slot member (a name that is NOT a ref-bridge,
 *    i.e. doesn't end in `Ref`) resolves to a declaration ABOVE the ctx
 *    literal in src/renderer/app.js. A literal evaluating a shorthand name
 *    declared below its line is a temporal-dead-zone ReferenceError on the
 *    first render — the class that escaped all prior gates (browser-only,
 *    invisible to eslint/jest/esbuild).
 * 2. The engine call passes every app-side value/ref the hook's signature
 *    requires (streamingPlaybackActiveRef, spotifyToken, extensionConnected,
 *    audioContext) — the "engine writes a ref never passed" class.
 * 3. The volume-hook call passes isPlayingRef (the volume panic path reads
 *    it without optional chaining; dropped from the call → TypeError).
 *
 * Marker practice for hooks never parses the whole engine constructor — the
 * input-destructure probes handle that side (use-playback-engine.test.js).
 */

const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const lines = appSrc.split('\n');
const lineNo = (needle, after = 0) => {
  const idx = appSrc.indexOf(needle, after);
  if (idx === -1) throw new Error('marker not found: ' + needle);
  return appSrc.slice(0, idx).split('\n').length;
};

const ctxLine = lineNo('  const ctx = {');
const engineCallLine = lineNo('} = usePlaybackEngine({');
const volumeCallLine = lineNo('  const volumeDomain = useVolume({');

function declaredAbove(name, line) {
  const patterns = [
    new RegExp(`^ {2}const \\[${name}, \\w+\\] = useState`, 'm'),
    new RegExp(`^ {2}const \\[\\w+, ${name}\\] = useState`, 'm'), // state setters
    new RegExp(`^  const ${name} = `, 'm'),
    new RegExp(`^  const ${name} = useRef`, 'm'),
    new RegExp(`^  const ${name} = (?:async )?(?:\\(|useCallback)`, 'm'),
  ];
  for (const re of patterns) {
    const m = appSrc.match(re);
    if (m) {
      const declLine = appSrc.slice(0, m.index).split('\n').length;
      if (declLine < line) return true;
    }
  }
  return false;
}

describe('engine ctx literal ordering (TDZ guards)', () => {
  // DIRECT shorthand members of the ctx literal — everything not ending in
  // `Ref` must have a declaration STRICTLY above the literal.
  const DIRECT_SLOTS = {
    resolvers: [
      'loadedResolversRef', 'activeResolversRef', 'resolverOrderRef', 'resolverBlocklistRef',
      'resolverConfigCache', 'isHtml5StreamResolver', 'findLoadedResolver', 'usesSharedAudio',
      'resolveTracksInBackground', 'buildProtocolFetchHeaders', 'lastfmFetch', 'getLastfmApiKey',
    ],
    enrichment: [
      'trackSources', 'queueTrackSources', 'lookupMbidMapper', 'enrichTrackWithMbid',
      'fetchArtworkViaMbid', 'forgetMissingLocalFile',
    ],
    ui: ['showConfirmDialog', 'setActiveView', 'setSettingsTab', 'setProgress'],
  };

  test.each(Object.entries(DIRECT_SLOTS).flatMap(([slot, names]) => names.map((n) => [slot, n])))(
    'ctx.%s.%s is declared above the ctx literal',
    (slot, name) => {
      expect(declaredAbove(name, ctxLine)).toBe(true);
    },
  );

  // The REF-bridge members (`...Ref` — refs synced post-declaration by design)
  // must each have a useRef declaration ANYWHERE (shape never positions).
  const REF_SLOTS = [
    'getResolverConfigRef', 'resolveTrackRef', 'confidenceForSourceRef',
    'getAlbumArtRef', 'getCachedAlbumArtRef', 'showExternalTrackPromptUIRef',
    'showToastRef', 'updateSchedulerVisibilityRef', 'abortSchedulerContextRef',
    'registerPoolContextRef', 'setSchedulerPlaybackIndexRef',
    'getArtistTopTracksRef', 'keyForSpinoffDedupRef', 'refreshSpotifyTokenRef', 'startAutoAdvancePollingRef',
  ];
  test.each(REF_SLOTS)('%s has a useRef declaration and a per-render sync', (name) => {
    expect(appSrc).toMatch(new RegExp(`const ${name} = useRef\\(null\\);`));
    // Synced on at least one no-dep every-render line; the cluster nests the
    // assignment inside a larger effect in a few places, so tolerate any
    // 'name.current = fn' line rather than one exact effect shape.
    const fnName = name.replace(/Ref$/, '');
    expect(appSrc).toMatch(new RegExp(`${name}\\.current = ${fnName};`));
  });
});

describe('engine + volume call-surface completeness', () => {
  test('engine call passes the app-side values/refs the hook requires', () => {
    const callIdx = appSrc.indexOf('} = usePlaybackEngine({');
    const argArea = appSrc.slice(callIdx, callIdx + 2200);
    for (const name of ['streamingPlaybackActiveRef', 'spotifyToken', 'extensionConnected', 'audioContext', 'isPlayingRef', 'handlePlayRef']) {
      expect(argArea).toContain(name + ',');
    }
  });

  test('volume-hook call passes isPlayingRef (fatal regression class)', () => {
    const volumeArgs = appSrc.slice(appSrc.indexOf('const volumeDomain = useVolume({'), appSrc.indexOf('const volumeDomain = useVolume({') + 400);
    expect(volumeArgs).toContain('isPlayingRef,');
  });
});
