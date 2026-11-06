// Merging measured facts into the playing track. A track played from a link,
// a chat link or the AI's play tool comes straight from a search result: its
// `sources` is an array of resolver ids (["bandcamp"]), and the flat track is
// itself the source record. Those plays used to lose every measurement.

const {
  pickStreamQuality,
  withStreamQualityFacts,
} = require('../../stream-quality');

const facts = { bitrate: 128, origin: 'measured' };

describe('withStreamQualityFacts', () => {
  describe('a track with keyed sources', () => {
    const track = {
      id: 'a',
      _activeResolver: 'subsonic',
      sources: { subsonic: { url: 'u' }, bandcamp: { bandcampUrl: 'b' } },
    };

    test('writes the record on the playing resolver\'s entry', () => {
      const next = withStreamQualityFacts(track, 'subsonic', facts);
      expect(next.sources.subsonic).toEqual({ url: 'u', streamQuality: facts });
      expect(next.sources.bandcamp).toEqual({ bandcampUrl: 'b' });
      expect(next.streamQuality).toBeUndefined();
      expect(pickStreamQuality(next, 'subsonic')).toEqual(facts);
    });

    test('never writes to a resolver that isn\'t playing', () => {
      expect(withStreamQualityFacts(track, 'bandcamp', facts)).toBe(track);
    });
  });

  describe('a track from a search result (sources is an array)', () => {
    const track = {
      id: 'a',
      bandcampUrl: 'b',
      _activeResolver: 'bandcamp',
      sources: ['bandcamp'],
    };

    test('keeps the record readable through pickStreamQuality', () => {
      const next = withStreamQualityFacts(track, 'bandcamp', facts);
      expect(next).not.toBe(track);
      expect(pickStreamQuality(next, 'bandcamp')).toEqual(facts);
    });

    test('leaves sources an array, which replay and the source menu branch on', () => {
      const next = withStreamQualityFacts(track, 'bandcamp', facts);
      expect(next.sources).toEqual(['bandcamp']);
      expect(Array.isArray(next.sources)).toBe(true);
    });

    test('never writes to a resolver that isn\'t playing', () => {
      expect(withStreamQualityFacts(track, 'subsonic', facts)).toBe(track);
    });

    test('a small move in a later measurement keeps the same track object', () => {
      const once = withStreamQualityFacts(track, 'bandcamp', facts);
      const twice = withStreamQualityFacts(once, 'bandcamp', { bitrate: 130, origin: 'measured' });
      expect(twice).toBe(once);
    });

    test('a large move replaces the record', () => {
      const once = withStreamQualityFacts(track, 'bandcamp', facts);
      const twice = withStreamQualityFacts(once, 'bandcamp', { bitrate: 320, origin: 'measured' });
      expect(pickStreamQuality(twice, 'bandcamp').bitrate).toBe(320);
    });
  });

  test('a track with no sources at all is its own record', () => {
    const track = { id: 'a', _activeResolver: 'bandcamp' };
    const next = withStreamQualityFacts(track, 'bandcamp', facts);
    expect(pickStreamQuality(next, 'bandcamp')).toEqual(facts);
  });

  test('keyed sources with no entry for the playing resolver gain no bare entry', () => {
    // A bare { streamQuality } entry would look like a playable source to
    // handlePlay and the source menu.
    const track = { id: 'a', _activeResolver: 'bandcamp', sources: { subsonic: { url: 'u' } } };
    const next = withStreamQualityFacts(track, 'bandcamp', facts);
    expect(next.sources).toEqual({ subsonic: { url: 'u' } });
    expect(pickStreamQuality(next, 'bandcamp')).toEqual(facts);
  });

  test('ignores nonsense input', () => {
    const track = { id: 'a', _activeResolver: 'bandcamp', sources: ['bandcamp'] };
    expect(withStreamQualityFacts(null, 'bandcamp', facts)).toBeNull();
    expect(withStreamQualityFacts(track, null, facts)).toBe(track);
    expect(withStreamQualityFacts(track, 'bandcamp', null)).toBe(track);
  });
});

describe('pickStreamQuality on the flat track', () => {
  test('only answers for the resolver actually playing', () => {
    const track = { _activeResolver: 'bandcamp', sources: ['bandcamp'], streamQuality: facts };
    expect(pickStreamQuality(track, 'bandcamp')).toEqual(facts);
    expect(pickStreamQuality(track, 'subsonic')).toBeNull();
  });

  test('a keyed entry wins over a flat record', () => {
    const keyed = { bitrate: 320, origin: 'measured' };
    const track = {
      _activeResolver: 'bandcamp',
      streamQuality: facts,
      sources: { bandcamp: { streamQuality: keyed } },
    };
    expect(pickStreamQuality(track, 'bandcamp')).toEqual(keyed);
  });

  test('a noMatch entry still answers nothing', () => {
    const track = {
      _activeResolver: 'bandcamp',
      streamQuality: facts,
      sources: { bandcamp: { noMatch: true } },
    };
    expect(pickStreamQuality(track, 'bandcamp')).toBeNull();
  });
});
