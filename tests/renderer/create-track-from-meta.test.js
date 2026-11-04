/**
 * createTrackFromMeta: the track a dropped or pasted link becomes.
 *
 * The link's own source has to survive: it carries the service's ids, and it
 * names the track so rescoring by title and artist keeps it above the floor.
 * Without a SoundCloud sign-in it is the only SoundCloud source the track
 * gets (#1217), since SoundCloud's resolve can't search.
 */

const fs = require('fs');
const path = require('path');
const { calculateConfidence, MIN_CONFIDENCE_THRESHOLD } = require('../../sync-providers/confidence-scoring');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const start = src.indexOf('const createTrackFromMeta = (');
const end = src.indexOf('\n  };\n', start);
const { isPlaceholderAlbum } = require('../../src/renderer/lib/collection-ids');
const createTrackFromMeta = new Function('isPlaceholderAlbum', `${src.slice(start, end)}\n  };\nreturn createTrackFromMeta;`)(isPlaceholderAlbum);

describe('createTrackFromMeta', () => {
  const META = {
    title: 'Never Be Like You feat. Kai',
    artist: 'Flume',
    album: 'SoundCloud',
    soundcloudId: 242136202,
    soundcloudUrl: 'https://soundcloud.com/flume/never-be-like-you-feat-kai',
    albumArt: 'https://i1.sndcdn.com/artworks-x-t500x500.jpg',
  };

  describe('a track with no album', () => {
    test.each([[undefined], [''], ['Single']])('album %p stays empty', (album) => {
      expect(createTrackFromMeta({ ...META, album }, 'soundcloud', META.soundcloudUrl).album).toBe('');
    });
    test('a plugin naming its own service is no album', () => {
      expect(createTrackFromMeta(META, 'soundcloud', META.soundcloudUrl).album).toBe('');
    });
    test('a real album stays, even one named like another service', () => {
      expect(createTrackFromMeta({ ...META, album: 'Nothing Was the Same' }, 'soundcloud', null).album).toBe('Nothing Was the Same');
      expect(createTrackFromMeta({ ...META, album: 'YouTube' }, 'soundcloud', null).album).toBe('YouTube');
    });
    test('the id is the same one a no-album track has always had', () => {
      expect(createTrackFromMeta({ ...META, album: undefined }, 'soundcloud', null).id).toBe(createTrackFromMeta({ ...META, album: 'Single' }, 'soundcloud', null).id);
      expect(createTrackFromMeta({ ...META, album: '' }, 'soundcloud', null).id).toMatch(/-single$/);
    });
  });

  test('keeps a SoundCloud link as the track\'s SoundCloud source', () => {
    const track = createTrackFromMeta(META, 'soundcloud', META.soundcloudUrl);
    expect(track.sources.soundcloud).toMatchObject({
      soundcloudId: 242136202,
      soundcloudUrl: META.soundcloudUrl,
      title: META.title,
      artist: 'Flume',
      confidence: 1.0,
    });
  });

  test('the link\'s source stays above the floor when rescored', () => {
    const track = createTrackFromMeta(META, 'soundcloud', META.soundcloudUrl);
    const rescored = calculateConfidence({ title: track.title, artist: track.artist }, track.sources.soundcloud);
    expect(rescored).toBeGreaterThanOrEqual(MIN_CONFIDENCE_THRESHOLD);
  });

  test('metadata with no service ids adds no source', () => {
    const track = createTrackFromMeta({ title: 'x', artist: 'y' }, 'soundcloud');
    expect(track.sources).toEqual({});
  });
});
