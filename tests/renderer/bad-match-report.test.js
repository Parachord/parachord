/**
 * "Report Bad Match" acts on the reported track's own source. It used to read
 * the source from a mount-time (always empty) copy of trackSources, so the
 * blocklist entry was saved with sourceId null and blocked nothing, and its
 * cleanup removed that service's source from every track.
 */

const fs = require('fs');
const path = require('path');
const { sourceBlockId, withoutTrackSource } = require('../../src/renderer/lib/bad-match-report');

describe('sourceBlockId', () => {
  test('the id resolution compares against, per source shape', () => {
    expect(sourceBlockId({ id: 'amazonmusic-B09R9RR8HY', amazonAsin: 'B09R9RR8HY' })).toBe('amazonmusic-B09R9RR8HY');
    expect(sourceBlockId({ spotifyUri: 'spotify:track:1', id: 'x' })).toBe('spotify:track:1');
    expect(sourceBlockId({ youtubeId: 'yt1' })).toBe('yt1');
    expect(sourceBlockId({ filePath: '/m/a.flac' })).toBe('/m/a.flac');
    expect(sourceBlockId(null)).toBeNull();
    expect(sourceBlockId({})).toBeNull();
  });
});

describe('withoutTrackSource', () => {
  const sources = {
    t1: { amazonmusic: { id: 'amazonmusic-A' }, spotify: { spotifyUri: 's1' } },
    t2: { amazonmusic: { id: 'amazonmusic-B' } },
  };

  test('drops only the reported track\'s source for that resolver', () => {
    const next = withoutTrackSource(sources, 't1', 'amazonmusic');
    expect(next.t1).toEqual({ spotify: { spotifyUri: 's1' } });
    expect(next.t2).toBe(sources.t2); // other tracks keep their Amazon source
    expect(sources.t1.amazonmusic).toBeDefined(); // no mutation
  });

  test('nothing to drop returns the same object', () => {
    expect(withoutTrackSource(sources, 't9', 'amazonmusic')).toBe(sources);
    expect(withoutTrackSource(sources, 't2', 'spotify')).toBe(sources);
    expect(withoutTrackSource(sources, undefined, 'amazonmusic')).toBe(sources);
  });
});

describe('app.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = src.indexOf("data.action === 'report-bad-match'");
  const handler = src.slice(start, src.indexOf('setPlaybarSourceDropdownOpen(false);', start));

  test('the report uses the source id the menu sent, not a lookup across all tracks', () => {
    expect(start).toBeGreaterThan(-1);
    expect(handler).toMatch(/const sourceId = data\.track\.sourceId \|\| null;/);
    expect(handler).not.toMatch(/Object\.keys\(trackSources\)\.find/);
  });

  test('the cleanup is scoped to the reported track', () => {
    expect(handler).toMatch(/setTrackSources\(prev => withoutTrackSource\(prev, data\.track\.id, data\.resolverId\)\)/);
    expect(handler).not.toMatch(/for \(const key of Object\.keys\(updated\)\)/);
  });

  test('both playbar menus send the track id and its source id', () => {
    const shows = src.match(/playbarSourceMenu\.show\(\{[\s\S]*?\}\);/g) || [];
    expect(shows.length).toBe(2);
    for (const show of shows) {
      expect(show).toMatch(/id: currentTrack\.id/);
      expect(show).toMatch(/sourceId: sourceBlockId\(/);
    }
  });

  test('the blocklist filter and the re-resolve use the same id', () => {
    expect(src).toMatch(/const srcId = sourceBlockId\(s\.source\);/);
    expect(src).toMatch(/const getSourceId = sourceBlockId;/);
  });
});
