/**
 * Scroll stutter on Fresh Drops / Recommendations: the whole UI is one React
 * component, so every setState is a full render. These pin the three
 * mitigations: coalesced per-key state writes (track sources, artist images),
 * hover prefetch on dwell only, and header collapse with hysteresis + a
 * content guard. The helpers are module-scope in app.js; extracted here.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

function extract(startMarker, endMarker) {
  const s = app.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const e = app.indexOf(endMarker, s);
  expect(e).toBeGreaterThan(s);
  return app.slice(s, e);
}

const win = {};
new Function('window', extract('window.createCoalescedUpdater = ', '// Resolver match validation + minimum confidence threshold.'))(win);
const { createCoalescedUpdater, applyCoalescedOps, headerCollapseDecision } = win;

describe('createCoalescedUpdater', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const applied = () => {
    const calls = [];
    const u = createCoalescedUpdater((batch) => calls.push(batch), 100);
    return { u, calls };
  };

  test('many writes within the window become one apply', () => {
    const { u, calls } = applied();
    for (let i = 0; i < 25; i++) u.queue('t' + i, { spotify: { id: i } });
    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(99);
    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].size).toBe(25);
    expect(u.pendingCount()).toBe(0);
  });

  test('ops for one key apply in order: write then merge merges, merge then write replaces', () => {
    const { u, calls } = applied();
    u.queue('a', { spotify: 1 });
    u.queue('a', { applemusic: 2 }, { merge: true });
    u.queue('b', { youtube: 1 }, { merge: true });
    u.queue('b', { spotify: 9 });
    jest.runOnlyPendingTimers();
    const batch = calls[0];
    expect(applyCoalescedOps({ old: true }, batch.get('a'))).toEqual({ spotify: 1, applemusic: 2 });
    expect(applyCoalescedOps({ old: true }, batch.get('b'))).toEqual({ spotify: 9 });
  });

  test('a merge with nothing queued before it merges onto the previous value', () => {
    expect(applyCoalescedOps({ spotify: 1 }, [{ value: { applemusic: 2 }, merge: true }])).toEqual({ spotify: 1, applemusic: 2 });
    expect(applyCoalescedOps(undefined, [{ value: { applemusic: 2 }, merge: true }])).toEqual({ applemusic: 2 });
  });

  test('immediate flushes synchronously, in order with what was queued', () => {
    const { u, calls } = applied();
    u.queue('a', { cached: true });
    u.queue('a', { fresh: true }, { immediate: true });
    expect(calls).toHaveLength(1);
    expect(applyCoalescedOps(undefined, calls[0].get('a'))).toEqual({ fresh: true });
    jest.runOnlyPendingTimers();
    expect(calls).toHaveLength(1);
  });

  test('flush() with nothing pending is a no-op', () => {
    const { u, calls } = applied();
    u.flush();
    expect(calls).toHaveLength(0);
  });
});

describe('headerCollapseDecision', () => {
  const tall = { scrollHeight: 3000, clientHeight: 600 };
  const short = { scrollHeight: 800, clientHeight: 600 };

  test('collapses past 100px, expands only back at or under 50px (hysteresis)', () => {
    expect(headerCollapseDecision({ ...tall, scrollTop: 101, collapsed: false })).toBe(true);
    expect(headerCollapseDecision({ ...tall, scrollTop: 80, collapsed: false })).toBeNull();
    expect(headerCollapseDecision({ ...tall, scrollTop: 80, collapsed: true })).toBeNull();
    expect(headerCollapseDecision({ ...tall, scrollTop: 50, collapsed: true })).toBe(false);
  });

  test('never collapses when the content is too short to stay scrolled (the flip-flop)', () => {
    expect(headerCollapseDecision({ ...short, scrollTop: 150, collapsed: false })).toBeNull();
  });

  test('no change when already in the requested state', () => {
    expect(headerCollapseDecision({ ...tall, scrollTop: 500, collapsed: true })).toBeNull();
    expect(headerCollapseDecision({ ...tall, scrollTop: 0, collapsed: false })).toBeNull();
  });
});

describe('the pages use the mitigations', () => {
  test('no per-track whole-entry setTrackSources write remains in the resolution paths', () => {
    expect(app).not.toMatch(/setTrackSources\(prev => \(\{\s*\.\.\.prev,\s*\[trackKey\]/);
    expect(app).not.toMatch(/setTrackSources\(prev => \(\{\s*\.\.\.prev,\s*\[trackOrSource\.id\]/);
    expect((app.match(/queueTrackSources\(/g) || []).length).toBeGreaterThanOrEqual(10);
  });

  test('bulk trackSources rewrites flush the queue first', () => {
    const bulk = app.match(/setTrackSources\(prev => \{/g) || [];
    const flushes = app.match(/flushTrackSources\(\); \/\//g) || [];
    expect(bulk.length).toBeGreaterThanOrEqual(4);
    expect(flushes.length).toBe(3);
  });

  test('hover prefetch is dwell-timed on both card grids and cancelled on leave', () => {
    expect(app).not.toMatch(/onMouseEnter: \(\) => prefetchChartsTracks\(/);
    expect((app.match(/onMouseEnter: \(\) => scheduleHoverPrefetch\(/g) || []).length).toBe(2);
    expect((app.match(/onMouseLeave: cancelHoverPrefetch,/g) || []).length).toBe(2);
    expect(app).toMatch(/const HOVER_PREFETCH_DWELL_MS = 250;/);
  });

  test('both hero headers use the shared collapse decision', () => {
    expect((app.match(/window\.headerCollapseDecision\(\{ scrollTop, scrollHeight, clientHeight, collapsed: (newReleases|recommendations)HeaderCollapsed \}\)/g) || []).length).toBe(2);
  });

  test('recommendation artist images are written through the coalescer', () => {
    const start = app.indexOf('const resolveRecommendationArtistImages = async (artists) => {');
    const body = app.slice(start, app.indexOf('\n  };', start));
    expect(body).toMatch(/recArtistImageWriterRef\.current\.queue\(artist\.id/);
    expect(body).not.toMatch(/setRecommendations\(/);
  });
});

// A card click used to wait on a MusicBrainz lookup before changing views.
// Every MB request is serialized at 1 req/s, and hover prefetches queued in
// the same foreground lane, so the click showed nothing for seconds.
describe('card click opens the release page before the lookup', () => {
  const start = app.indexOf('const openChartsAlbum = async (album) => {');
  const body = app.slice(start, app.indexOf('\n  };', start));

  test('navigates and shows a partial release before the first MusicBrainz request', () => {
    const navigate = body.indexOf("navigateTo('artist')");
    const partial = body.indexOf('_isPartial: true');
    const firstFetch = body.indexOf('musicbrainz.org/ws/2/');
    expect(navigate).toBeGreaterThan(-1);
    expect(partial).toBeGreaterThan(-1);
    expect(firstFetch).toBeGreaterThan(-1);
    expect(navigate).toBeLessThan(firstFetch);
    expect(partial).toBeLessThan(firstFetch);
    expect((body.match(/navigateTo\('artist'\)/g) || []).length).toBe(1);
  });

  test('remembers the release-group alias so a revisit needs no request', () => {
    expect(body).toMatch(/rememberReleaseGroupAlias\(album\.releaseGroupId, release\.id\)/);
    expect(body).toMatch(/releaseDetailsCache\.current\[album\.releaseGroupId\]/);
  });

  test('fallbacks clear the placeholder release and loading state', () => {
    const fallbacks = body.match(/setCurrentRelease\(null\);\s*setLoadingRelease\(false\);\s*fetchArtistData\(album\.artist\);/g) || [];
    expect(fallbacks.length).toBe(2);
  });

  test('hover prefetches use the background lane of the MusicBrainz limiter', () => {
    for (const name of ['prefetchChartsTracks', 'prefetchCriticsPicksTracks']) {
      const s = app.indexOf(`const ${name} = async (album) => {`);
      const b = app.slice(s, app.indexOf('\n  };', s));
      expect(b).toMatch(/mbBackground: true/);
      expect(b).toMatch(/await bgFetch\(/);
      expect(b).toMatch(/fetchReleaseDetails\(releaseId, bgFetch\)/);
      expect(b).not.toMatch(/await fetch\(/);
    }
  });

  test('a click cancels the pending hover prefetch on both grids', () => {
    expect((app.match(/cancelHoverPrefetch\(\); openChartsAlbum\(item\)/g) || []).length).toBe(1);
    expect(app).toMatch(/cancelHoverPrefetch\(\);\s*openChartsAlbum\(\{ artist: release\.artist/);
  });
});
