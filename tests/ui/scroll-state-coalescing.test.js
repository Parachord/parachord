/**
 * Scroll stutter on Fresh Drops / Recommendations: the whole UI is one React
 * component, so every setState is a full render. These pin the three
 * mitigations: coalesced per-key state writes (track sources, artist images),
 * hover prefetch on dwell only, and header collapse with hysteresis + a
 * content guard. The helpers are module-scope in app.js; extracted here.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

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
    // 4th: the stale local-source reconcile after a library load (#1002).
    expect(flushes.length).toBe(4);
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

  const placeholderStart = app.indexOf('const showReleasePlaceholder = (');
  const placeholder = app.slice(placeholderStart, app.indexOf('\n  };', placeholderStart));

  test('the placeholder helper sets artist, partial release, loading state and navigates', () => {
    expect(placeholder).toMatch(/_isPartial: true/);
    expect(placeholder).toMatch(/setLoadingRelease\(true\)/);
    expect(placeholder).toMatch(/navigateTo\('artist'\)/);
    expect(placeholder).toMatch(/openingReleaseRef\.current = true/);
  });

  test('shows the placeholder before the first MusicBrainz request, and never navigates again', () => {
    const show = body.indexOf('showReleasePlaceholder({');
    const firstFetch = body.indexOf('musicbrainz.org/ws/2/');
    expect(show).toBeGreaterThan(-1);
    expect(firstFetch).toBeGreaterThan(-1);
    expect(show).toBeLessThan(firstFetch);
    expect(body).not.toMatch(/navigateTo\('artist'\)/);
  });

  test("Critic's Picks and Top Album openers delegate to the same opener", () => {
    expect(app).toMatch(/const openCriticsPicksAlbum = \(album\) => openChartsAlbum\(\{/);
    expect(app).toMatch(/const openTopAlbum = \(album\) => openChartsAlbum\(\{/);
    // the string-search path keeps the multi-artist fallback the two used to have
    expect(body).toMatch(/await searchMusicBrainzRelease\(album\.title, album\.artist\)/);
    expect(app).not.toMatch(/Error opening (Top Album|Critic)/);
  });

  test('the home Fresh Drops hero passes the release-group id instead of a string search', () => {
    // The Home page moved into its own module (Track 2b split).
    const homePage = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'home-page.js'), 'utf8');
    expect(homePage).toMatch(/openTopAlbum\(\{ \.\.\.newReleases\[0\][^\n]*releaseGroupId: newReleases\[0\]\.id/);
  });

  test('the playbar album link shows the release page before its MusicBrainz search', () => {
    const s = app.indexOf('const openAlbumForTrack = async (track) => {');
    const b = app.slice(s, app.indexOf('\n  };', s));
    const show = b.indexOf('showReleasePlaceholder({');
    const firstFetch = b.indexOf('musicbrainz.org/ws/2/');
    expect(show).toBeGreaterThan(-1);
    expect(show).toBeLessThan(firstFetch);
    // every failure path clears the placeholder it showed
    expect(b).toMatch(/const giveUp = \(message\) => \{/);
    expect((b.match(/giveUp\(/g) || []).length).toBe(2); // not-found and error paths
    expect(b).toMatch(/setCurrentRelease\(null\);\s*setLoadingRelease\(false\);\s*fetchArtistData\(track\.artist\)/);
  });

  test('remembers the release-group alias so a revisit needs no request', () => {
    expect(body).toMatch(/rememberReleaseGroupAlias\(album\.releaseGroupId, release\.id\)/);
    expect(body).toMatch(/releaseDetailsCache\.current\[album\.releaseGroupId\]/);
  });

  test('fallbacks clear the placeholder release and loading state', () => {
    const fallbacks = body.match(/setCurrentRelease\(null\);\s*setLoadingRelease\(false\);\s*fetchArtistData\(album\.artist\);/g) || [];
    expect(fallbacks.length).toBe(2);
  });

  test('every hover prefetch uses the background lane of the MusicBrainz limiter', () => {
    const prefetchers = [
      'const prefetchChartsTracks = async (album) => {',
      'const prefetchCriticsPicksTracks = async (album) => {',
      'const prefetchReleaseTracks = async (release, artist) => {',
      'const prefetchSearchAlbumTracks = (album) => {',
      'const prefetchTopAlbumTracks = (artistName, albumName, albumArt = null) => {'
    ];
    for (const marker of prefetchers) {
      const s = app.indexOf(marker);
      expect(s).toBeGreaterThan(-1);
      const b = app.slice(s, app.indexOf('\n  };', s));
      expect(b).toMatch(/mbBackground: true/);
      expect(b).toMatch(/fetchReleaseDetails\(releaseId, bgFetch\)/);
      expect(b).not.toMatch(/await fetch\(/);
      expect(b).not.toMatch(/fetchReleaseDetails\(releaseId\)/);
    }
    // the shared search helper carries the flag for the Top Albums prefetch
    expect(app).toMatch(/searchMusicBrainzRelease\(albumName, artistName, \{ background: true \}\)/);
    expect(app).toMatch(/mbBackground: !!opts\.background/);
  });

  test('a click cancels the pending hover prefetch on both grids', () => {
    expect((app.match(/cancelHoverPrefetch\(\); openChartsAlbum\(item\)/g) || []).length).toBe(1);
    expect(app).toMatch(/cancelHoverPrefetch\(\);\s*openChartsAlbum\(\{ artist: release\.artist/);
  });
});
