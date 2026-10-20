/**
 * The local-file "unsupported format" dialog. It used to tell users that the
 * built-in player only handles 16-bit FLAC at 44.1/48 kHz and to downsample
 * with ffmpeg. That was false: hi-res FLAC and 24-bit / 32-bit float WAV
 * decode fine through the local-audio: handler (parachord#792). A FLAC or WAV
 * that fails is damaged or an odd variant, so the message must not send
 * people off to throw away resolution. This extracts and runs the real source.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

const start = app.indexOf('const unsupportedAudioMessage = ');
const end = app.indexOf('\n};\n', start);
const unsupportedAudioMessage = new Function(`${app.slice(start, end + 3)}\nreturn unsupportedAudioMessage;`)();

const FALSE_LIMITS = [/16-bit/i, /44\.1/, /48 ?kHz/i, /sample_fmt/, /-ar \d/, /high sample rate/i];

describe('unsupportedAudioMessage', () => {
  test.each(['flac', 'FLAC', 'wav', 'WAV'])('%s message does not claim a bit-depth or sample-rate limit', (ext) => {
    const msg = unsupportedAudioMessage(ext);
    for (const re of FALSE_LIMITS) expect(msg).not.toMatch(re);
    expect(msg).toMatch(/could not be decoded/);
    expect(msg).toMatch(/24-bit/); // says hi-res is supported
  });

  test('no branch recommends 16-bit FLAC as the fix', () => {
    for (const ext of ['flac', 'wav', 'mp3', 'ogg', 'opus', 'm4a', 'aiff', 'wma', 'ape', 'dsf', 'xyz', '', undefined]) {
      expect(unsupportedAudioMessage(ext)).not.toMatch(/16-bit/i);
    }
  });

  test('formats with no decoder are still reported as unsupported', () => {
    for (const ext of ['aiff', 'aif', 'wma', 'alac', 'ape', 'dsf', 'dff']) {
      expect(unsupportedAudioMessage(ext)).toMatch(/not supported by the built-in player/);
    }
  });

  test('unknown extensions fall back to a generic message', () => {
    expect(unsupportedAudioMessage('xyz')).toMatch(/^This XYZ file uses an unsupported format/);
    expect(unsupportedAudioMessage(undefined)).toMatch(/^This audio file uses an unsupported format/);
  });
});
