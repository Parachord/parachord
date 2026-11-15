/**
 * lib/track-duration.js: the length a track row shows. The track's own
 * duration, else the best source's (highest confidence, then resolver order),
 * else nothing, never "0:00". Tracks imported from a URL (a hosted XSPF with
 * no durations) showed 0:00 in every list even after resolving.
 */
const fs = require('fs');
const path = require('path');
const {
  trackDuration,
  formatDuration,
  trackDurationLabel,
} = require('../../src/renderer/lib/track-duration');

const order = ['spotify', 'soundcloud', 'bandcamp'];

describe('trackDuration', () => {
  test("the track's own duration wins", () => {
    const track = { id: 'a', duration: 200, sources: { spotify: { duration: 199, confidence: 1 } } };
    expect(trackDuration(track, { resolverOrder: order })).toBe(200);
  });

  test('no duration on the track: the resolved source knows it (live trackSources)', () => {
    const track = { id: 'a', title: 'x' };
    const trackSources = { a: { spotify: { duration: 245, confidence: 1 } } };
    expect(trackDuration(track, { trackSources, resolverOrder: order })).toBe(245);
  });

  test('a zero, missing or non-numeric duration on the track falls through to the sources', () => {
    for (const duration of [0, null, undefined, NaN, '200']) {
      const track = { id: 'a', duration, sources: { soundcloud: { duration: 180, confidence: 1 } } };
      expect(trackDuration(track, { resolverOrder: order })).toBe(180);
    }
  });

  test('merges track.sources with trackSources, the live entry winning per resolver', () => {
    const track = { id: 'a', sources: { spotify: { duration: 100, confidence: 1 } } };
    const trackSources = { a: { spotify: { duration: 101, confidence: 1 } } };
    expect(trackDuration(track, { trackSources, resolverOrder: order })).toBe(101);
  });

  test('prefers the highest-confidence source with a duration', () => {
    const track = { id: 'a', sources: {
      spotify: { duration: 210, confidence: 0.95 },
      bandcamp: { duration: 212, confidence: 1 },
    } };
    expect(trackDuration(track, { resolverOrder: order })).toBe(212);
  });

  test('ties go to the resolver order; a resolver not in the order goes last', () => {
    const track = { id: 'a', sources: {
      other: { duration: 1, confidence: 1 },
      bandcamp: { duration: 3, confidence: 1 },
      soundcloud: { duration: 2, confidence: 1 },
    } };
    expect(trackDuration(track, { resolverOrder: order })).toBe(2);
    expect(trackDuration(track, {})).toBe(1); // no order: first key among equals
  });

  test('skips sources without a duration and no-match sentinels', () => {
    const track = { id: 'a', sources: {
      spotify: { noMatch: true, duration: 999 },
      soundcloud: { duration: 0, confidence: 1 },
      bandcamp: { duration: 230, confidence: 0.95 },
    } };
    expect(trackDuration(track, { trackSources: { a: { __noMatchAll: true } }, resolverOrder: order })).toBe(230);
  });

  test('null when nothing knows the length', () => {
    expect(trackDuration({ id: 'a' }, {})).toBeNull();
    expect(trackDuration({ id: 'a', sources: { spotify: { confidence: 1 } } }, { resolverOrder: order })).toBeNull();
    expect(trackDuration(null)).toBeNull();
  });
});

describe('formatDuration / trackDurationLabel', () => {
  test('m:ss for a known length', () => {
    expect(formatDuration(245)).toBe('4:05');
    expect(formatDuration(59.9)).toBe('0:59');
    expect(formatDuration(3600)).toBe('60:00');
  });

  test("blank, never '0:00', when the length is unknown", () => {
    for (const v of [null, undefined, 0, NaN, -1]) expect(formatDuration(v)).toBe('');
    expect(trackDurationLabel({ id: 'a' }, {})).toBe('');
  });

  test('labels a resolved imported track with its source length', () => {
    const track = { id: 'rp', title: 'Song', artist: 'Band' };
    const trackSources = { rp: { soundcloud: { duration: 301, confidence: 0.95 } } };
    expect(trackDurationLabel(track, { trackSources, resolverOrder: order })).toBe('5:01');
  });
});

// Every track list's duration cell goes through the helper: none reads
// track.duration straight into a formatter (that printed 0:00).
describe('call sites', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', rel), 'utf8');
  const files = [
    'components/track-lists.js',
    'components/playlist-view-page.js',
    'components/collection-page.js',
    'components/search-page.js',
    'components/cards.js',
    'app.js',
  ];

  test.each(files)('%s renders durations through trackDurationLabel', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/trackDurationLabel\(/);
    expect(src).not.toMatch(/formatTime\(track\.duration/);
    expect(src).not.toMatch(/Math\.floor\(track\.duration \/ 60\)/);
    expect(src).not.toMatch(/formatDuration\(track\.length\)/);
  });

  test('the queue row passes the live trackSources', () => {
    expect(read('components/track-lists.js')).toMatch(/trackDurationLabel\(track, \{ trackSources, resolverOrder \}\)/);
  });
});
