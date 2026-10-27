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

const { pickStreamQuality, streamQualityCodecLabel, formatStreamQuality, isStreamQualityChange } = require('../../stream-quality');

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

// Follow-ups to #1027 (review fixes).
describe('stream quality review follow-ups', () => {
  const fs = require('fs');
  const path = require('path');
  const { streamQualityCodecLabel } = require('../../stream-quality');
  const root = path.join(__dirname, '..', '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

  test('uncompressed AIFF (music-metadata codec "PCM") is labelled AIFF, WAV stays WAV', () => {
    expect(streamQualityCodecLabel({ codec: 'PCM', container: 'aiff' })).toBe('AIFF');
    expect(streamQualityCodecLabel({ codec: 'PCM', container: 'aif' })).toBe('AIFF');
    expect(streamQualityCodecLabel({ codec: 'PCM', container: 'wav' })).toBe('WAV');
    expect(streamQualityCodecLabel({ codec: 'PCM' })).toBe('WAV');
  });

  test('the playbar title tooltip caps its width so long titles still truncate', () => {
    const app = read('src/renderer/app.js');
    const i = app.indexOf('content: streamQualityLabel,');
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i, i + 200)).toMatch(/className: 'tooltip-fill'/);
    expect(read('index.html')).toMatch(/\.tooltip-container\.tooltip-fill \{\s*max-width: 100%;/);
  });

  test('play-time stat is async (a sync stat on a network mount blocks the main process)', () => {
    const src = read('local-files/index.js');
    const start = src.indexOf('async getStreamInfo(filePath) {');
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    expect(body).toMatch(/await fs\.promises\.stat\(filePath\)/);
    expect(body).not.toMatch(/statSync/);
  });

  test('the play-time parse skips embedded covers', () => {
    const src = read('local-files/metadata-reader.js');
    const start = src.indexOf('static async getStreamInfo(filePath) {');
    expect(src.slice(start, start + 400)).toMatch(/mm\.parseFile\(filePath, \{ skipCovers: true \}\)/);
  });
});

// Amazon's measured bitrate is a median over 2 s polls, and every tier above
// 160 kbps is VBR, so it moves on almost every poll. Each accepted change
// re-creates currentTrack (memoized pages re-render, the queue is re-saved),
// so bitrate wobble within 10% of the stored value is not a change (#1092).
describe('isStreamQualityChange', () => {
  const HD = { tier: 'HD', codec: 'flac', sampleRate: 44100, bitDepth: 16, channels: 2, bitrate: 900, origin: 'measured' };

  test('the first record is a change, a missing next is not', () => {
    expect(isStreamQualityChange(undefined, HD)).toBe(true);
    expect(isStreamQualityChange(HD, null)).toBe(false);
  });

  test('VBR wobble within 10% of the stored bitrate is not a change', () => {
    expect(isStreamQualityChange(HD, { ...HD, bitrate: 950 })).toBe(false);
    expect(isStreamQualityChange(HD, { ...HD, bitrate: 820 })).toBe(false);
    expect(isStreamQualityChange(HD, { ...HD })).toBe(false);
  });

  test('a bitrate more than 10% away is', () => {
    expect(isStreamQualityChange(HD, { ...HD, bitrate: 1000 })).toBe(true);
    expect(isStreamQualityChange(HD, { ...HD, bitrate: 800 })).toBe(true);
  });

  test('any other field changing is, whatever the bitrate', () => {
    expect(isStreamQualityChange(HD, { ...HD, tier: 'Ultra HD', bitDepth: 24 })).toBe(true);
    expect(isStreamQualityChange(HD, { ...HD, sampleRate: 48000 })).toBe(true);
    // The first emit is bitrate-only; the captured init segment adds the rest.
    const bitrateOnly = { bitrate: 900, origin: 'measured' };
    expect(isStreamQualityChange(bitrateOnly, HD)).toBe(true);
  });

  test('a bitrate appearing or disappearing is a change', () => {
    const { bitrate, ...noBitrate } = HD;
    expect(bitrate).toBe(900);
    expect(isStreamQualityChange(noBitrate, HD)).toBe(true);
    expect(isStreamQualityChange(HD, noBitrate)).toBe(true);
  });
});

describe('Amazon quality updates and the queue save do not churn on every poll', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

  test('the Amazon progress handler gates on isStreamQualityChange', () => {
    const at = app.indexOf('const measuredQuality = data.streamQuality;');
    const block = app.slice(at, at + 1600);
    expect(block).toMatch(/if \(!window\.isStreamQualityChange\(existing, measuredQuality\)\) return prev;/);
    expect(block).not.toMatch(/JSON\.stringify\(existing\)/);
  });

  test('the saved-queue effect keys on the track id and saves the latest track', () => {
    // The effect moved to the queue hook (Track 2b slice 2,
    // src/renderer/hooks/use-playback-queue.js); app.js keeps only the
    // usePlaybackQueue({...}) destructure.
    const hook = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-queue.js'), 'utf8');
    expect(hook).toMatch(/\}, \[currentTrack\?\.id, currentQueue, rememberQueue, playbackContext, shuffleMode\]\);/);
    const at = hook.indexOf("await window.electron.store.set('saved_queue', fullQueue);");
    expect(hook.slice(at - 700, at)).toMatch(/const currentTrack = currentTrackRef\.current;/);
    expect(app).toContain('usePlaybackQueue({');
  });
});
