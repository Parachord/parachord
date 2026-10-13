/**
 * Stream-quality pipeline tests — the playback-engine side of the
 * stream-quality contract (stream-quality.js).
 *
 * localfiles is the one resolver today whose engine can report exact stream
 * parameters: the file is on disk, so the parameters are PARSED AT PLAY TIME
 * (localFiles:stream-info IPC → LocalFilesService.getStreamInfo →
 * MetadataReader.getStreamInfo), not persisted in the scan DB. The renderer
 * backfills the result onto the playing track's localfiles source record and
 * the now-playing title hover renders it. These tests cover the parse layer
 * against real (hand-crafted) audio files and the mtime cache; the renderer
 * backfill is covered by the pure contract tests in stream-quality.test.js.
 *
 * No DB access here: getStreamInfo never touches better-sqlite3 (which is
 * built for Electron's ABI and can't load under jest's Node).
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const LocalFilesService = require('../../local-files/index');
const { formatStreamQuality } = require('../../stream-quality');

/** Minimal WAV: 16-bit stereo 44.1 kHz PCM, 0.1s of silence. */
function makeWav() {
  const sampleRate = 44100, bits = 16, ch = 2, frames = sampleRate / 10;
  const data = Buffer.alloc(frames * ch * bits / 8);
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(ch, 22); hdr.writeUInt32LE(sampleRate, 24);
  hdr.writeUInt32LE(sampleRate * ch * bits / 8, 28); hdr.writeUInt16LE(ch * bits / 8, 32);
  hdr.writeUInt16LE(bits, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  return Buffer.concat([hdr, data]);
}

/** Minimal FLAC: fLaC magic + STREAMINFO (44.1 kHz / 16-bit / 2ch / 1s) + padding. */
function makeFlac() {
  const sampleRate = 44100, bits = 16, ch = 2, totalSamples = 44100;
  const si = Buffer.alloc(34);
  si.writeUInt16BE(4096, 0);  // min blocksize
  si.writeUInt16BE(4096, 2);   // max blocksize
  // STREAMINFO bytes 10+: 20 bits sampleRate | 3 bits (ch-1) | 5 bits (bits-1) | 36 bits totalSamples
  si[10] = (sampleRate >> 12) & 0xFF;
  si[11] = (sampleRate >> 4) & 0xFF;
  si[12] = ((sampleRate & 0xF) << 4) | ((ch - 1) << 1) | ((bits - 1) >> 4);
  si[13] = (((bits - 1) & 0xF) << 4) | (Math.floor(totalSamples / 0x100000000) & 0xF);
  si.writeUInt32BE(totalSamples >>> 0, 14);
  const header = Buffer.from([0x66, 0x4C, 0x61, 0x43]); // 'fLaC'
  const blockHdr = Buffer.from([0x80, 0x00, 0x00, 34]); // last-block flag + STREAMINFO, len 34
  return Buffer.concat([header, blockHdr, si, Buffer.alloc(8192, 0)]);
}

/** Minimal MP3: a few MPEG-1 Layer III frames, 128 kbps CBR, 44.1 kHz. */
function makeMp3() {
  const frame = Buffer.alloc(417);
  frame[0] = 0xFF; frame[1] = 0xFB; frame[2] = 0x90; frame[3] = 0x00;
  return Buffer.concat(new Array(8).fill(frame));
}

function tmpFile(name, buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-pipeline-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

describe('Stream quality pipeline (local files playback engine)', () => {
  describe('getStreamInfo', () => {
    test('WAV: codec, sample rate, bit depth, channels, kbps-normalized bitrate', async () => {
      const file = tmpFile('a.wav', makeWav());
      const service = new LocalFilesService(os.tmpdir());
      const info = await service.getStreamInfo(file);
      expect(info).toEqual({
        codec: 'PCM',
        bitrate: 1411,      // 1411200 bps → kbps, normalized once at capture
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        container: 'wav'
      });
      expect(formatStreamQuality(info)).toBe('WAV · 44.1 kHz · 16-bit · 1411 kbps');
    });

    test('FLAC: lossless with bit depth', async () => {
      const file = tmpFile('a.flac', makeFlac());
      const service = new LocalFilesService(os.tmpdir());
      const info = await service.getStreamInfo(file);
      expect(info.codec).toBe('FLAC');
      expect(info.sampleRate).toBe(44100);
      expect(info.bitDepth).toBe(16);
      expect(info.channels).toBe(2);
      expect(info.container).toBe('flac');
      expect(formatStreamQuality(info)).toBe('FLAC · 44.1 kHz · 16-bit · 66 kbps');
    });

    test('MP3: no bit depth (lossy)', async () => {
      const file = tmpFile('a.mp3', makeMp3());
      const service = new LocalFilesService(os.tmpdir());
      const info = await service.getStreamInfo(file);
      expect(info.codec).toBe('MPEG 1 Layer 3');
      expect(info.bitrate).toBe(128);
      expect(info.sampleRate).toBe(44100);
      expect(info.bitDepth).toBeUndefined();
      expect(formatStreamQuality(info)).toBe('MP3 · 44.1 kHz · 128 kbps');
    });

    test('missing/unreadable file → null (HUD renders nothing, play path errors separately)', async () => {
      const service = new LocalFilesService(os.tmpdir());
      expect(await service.getStreamInfo(null)).toBeNull();
      expect(await service.getStreamInfo(path.join(os.tmpdir(), 'nope-does-not-exist.flac'))).toBeNull();
    });

    test('caches by path+mtime: replays are free, a changed file re-parses', async () => {
      const file = tmpFile('a.wav', makeWav());
      const service = new LocalFilesService(os.tmpdir());
      const first = await service.getStreamInfo(file);
      const second = await service.getStreamInfo(file);
      expect(second).toBe(first); // cache hit — same object identity
      // Bump mtime without changing bytes: the cache key no longer matches, so
      // the file re-parses (fresh object, identical values).
      const later = new Date(Date.now() + 5000);
      fs.utimesSync(file, later, later);
      const third = await service.getStreamInfo(file);
      expect(third).not.toBe(first);
      expect(third).toEqual(first);
      // A different path is its own cache entry.
      const flac = tmpFile('b.flac', makeFlac());
      const flacInfo = await service.getStreamInfo(flac);
      expect(flacInfo.codec).toBe('FLAC');
      expect(flacInfo).not.toEqual(first);
    });
  });
});
