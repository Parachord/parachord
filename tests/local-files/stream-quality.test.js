/**
 * Stream quality (stream-quality.js) tests.
 *
 * The contract: a resolver that knows the technical parameters of the stream a
 * track plays through it attaches a `streamQuality` record to its own entry in
 * track.sources. Presence of the record IS the capability — resolvers that
 * can't know simply don't attach one, and the now-playing hover renders
 * exactly as before. The HUD must key off the resolver actually playing the
 * track, never "any source on the track".
 */

const { pickStreamQuality, streamQualityCodecLabel, formatStreamQuality } = require('../../stream-quality');

const FLAC_ROW = {
  codec: 'flac',
  container: 'flac',
  bitrate: 847,
  sampleRate: 44100,
  bitDepth: 16,
  channels: 2,
  origin: 'measured'
};

describe('stream-quality', () => {
  describe('pickStreamQuality', () => {
    test('returns the playing resolver record', () => {
      const track = { sources: { localfiles: { streamQuality: FLAC_ROW } } };
      expect(pickStreamQuality(track, 'localfiles')).toBe(FLAC_ROW);
    });

    test('keys off the PLAYING resolver, not any source on the track', () => {
      // A localfiles-played track with a Spotify id is streaming from disk.
      const track = {
        sources: {
          localfiles: { streamQuality: FLAC_ROW },
          spotify: { spotifyId: 'abc' }
        }
      };
      // Playing through Spotify (streaming) — Spotify provides no streamQuality,
      // so nothing renders. Not the localfiles record.
      expect(pickStreamQuality(track, 'spotify')).toBeNull();
      expect(pickStreamQuality(track, 'localfiles')).toBe(FLAC_ROW);
    });

    test('noMatch sources never report stream quality', () => {
      const track = { sources: { localfiles: { noMatch: true, streamQuality: FLAC_ROW } } };
      expect(pickStreamQuality(track, 'localfiles')).toBeNull();
    });

    test('missing resolver / missing track / no record → null', () => {
      expect(pickStreamQuality(null, 'localfiles')).toBeNull();
      expect(pickStreamQuality({ sources: {} }, 'localfiles')).toBeNull();
      expect(pickStreamQuality({ sources: { localfiles: {} } }, 'localfiles')).toBeNull();
      expect(pickStreamQuality({ sources: { localfiles: { streamQuality: 'not-an-object' } } }, 'localfiles')).toBeNull();
      // No playing resolver — a preferred source must never be substituted.
      expect(pickStreamQuality({ sources: { localfiles: { streamQuality: FLAC_ROW } } }, undefined)).toBeNull();
    });
  });

  describe('streamQualityCodecLabel', () => {
    test('maps common music-metadata codecs to display labels', () => {
      expect(streamQualityCodecLabel({ codec: 'flac' })).toBe('FLAC');
      expect(streamQualityCodecLabel({ codec: 'ALAC' })).toBe('ALAC');
      expect(streamQualityCodecLabel({ codec: 'MPEG 1 Layer 3' })).toBe('MP3');
      expect(streamQualityCodecLabel({ codec: 'AAC' })).toBe('AAC');
      expect(streamQualityCodecLabel({ codec: 'PCM' })).toBe('WAV');
    });

    test('falls back to the container when codec was never captured', () => {
      // Row indexed before the `codec` column existed — extension only.
      expect(streamQualityCodecLabel({ container: 'flac' })).toBe('FLAC');
      expect(streamQualityCodecLabel({ container: 'm4a' })).toBe('M4A');
      expect(streamQualityCodecLabel({ container: 'mp3' })).toBe('MP3');
      expect(streamQualityCodecLabel({})).toBeNull();
    });
  });

  describe('formatStreamQuality', () => {
    test('lossless: codec, sample rate, bit depth, bitrate', () => {
      expect(formatStreamQuality(FLAC_ROW)).toBe('FLAC · 44.1 kHz · 16-bit · 847 kbps');
    });

    test('hi-res: 96 kHz without a trailing .0', () => {
      expect(formatStreamQuality({ ...FLAC_ROW, sampleRate: 96000, bitDepth: 24, bitrate: 4601 }))
        .toBe('FLAC · 96 kHz · 24-bit · 4601 kbps');
    });

    test('lossy: no bit depth', () => {
      expect(formatStreamQuality({ codec: 'MPEG 1 Layer III', container: 'mp3', bitrate: 320, sampleRate: 44100 }))
        .toBe('MP3 · 44.1 kHz · 320 kbps');
    });

    test('ALAC in an m4a container is not hidden behind AAC', () => {
      expect(formatStreamQuality({ codec: 'ALAC', container: 'm4a', bitrate: 902, sampleRate: 44100, bitDepth: 16 }))
        .toBe('ALAC · 44.1 kHz · 16-bit · 902 kbps');
    });

    test('partial records render what they have', () => {
      // Old DB row: bitrate + sample rate only (container fallback for the label).
      expect(formatStreamQuality({ container: 'flac', bitrate: 847, sampleRate: 44100 }))
        .toBe('FLAC · 44.1 kHz · 847 kbps');
    });

    test('empty/invalid → empty string (renders nothing)', () => {
      expect(formatStreamQuality(null)).toBe('');
      expect(formatStreamQuality({})).toBe('');
      expect(formatStreamQuality('nope')).toBe('');
    });
  });
});
