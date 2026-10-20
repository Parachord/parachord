/**
 * Smoke tests for the Amazon page scripts (amazon-web-player.js).
 *
 * HOOK_SCRIPT serializes nothing from amazon-music-logic.js today, but the
 * script must still evaluate against a bare DOM stub — a stray backtick in
 * the template only breaks inside the Amazon page. (Search and playlist
 * import now run over captured GraphQL replayed from the page world; their
 * parsing is unit-tested in amazon-music-logic.test.js.)
 */

const webPlayer = require('../../amazon-web-player');

function bareDocument() {
  return {
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
}

describe('Amazon page scripts evaluate after serialization', () => {

  test('HOOK_SCRIPT installs its readers and returns true', () => {
    const window = { addEventListener: () => {} };
    const run = new Function('window', 'document', 'return ' + webPlayer._scripts.HOOK_SCRIPT);
    const out = run(window, bareDocument());
    expect(out).toBe(true);
    expect(typeof window.__parachordAmazonRead).toBe('function');
    expect(typeof window.__parachordAmazonClickPlay).toBe('function');
    // With no media element on the page, a read is null, not a throw.
    expect(window.__parachordAmazonRead()).toBeNull();
  });

  test('HOOK_SCRIPT read carries the audio decode counter when a media element latches', () => {
    const media = {
      tagName: 'VIDEO',
      paused: false,
      currentSrc: 'blob:https://music.amazon.com/x',
      currentTime: 10,
      duration: 200,
      ended: false,
      webkitAudioDecodedByteCount: 212500
    };
    const document = {
      querySelectorAll: (selector) => (selector === 'video, audio' ? [media] : []),
      addEventListener: () => {}
    };
    const window = { addEventListener: () => {} };
    const run = new Function('window', 'document', 'location', 'return ' + webPlayer._scripts.HOOK_SCRIPT);
    run(window, document, { href: 'https://music.amazon.com/tracks/B0ABCDEFGHI' });

    const state = window.__parachordAmazonRead();
    expect(state).toMatchObject({
      state: 'PLAYING',
      positionMs: 10000,
      durationMs: 200000,
      href: 'https://music.amazon.com/tracks/B0ABCDEFGHI',
      // playingAsin is the mini-player scrape (no links on this stub page) —
      // the /tracks/ URL above is what the main process resolves to the ASIN.
      playingAsin: null,
      audioDecodedBytes: 212500
    });
  });

  test('HOOK_SCRIPT read tolerates an element with no decode counter', () => {
    const media = {
      tagName: 'VIDEO', paused: true, currentSrc: 'blob:https://music.amazon.com/x',
      currentTime: 3, duration: 200, ended: false // no webkitAudioDecodedByteCount
    };
    const document = {
      querySelectorAll: (selector) => (selector === 'video, audio' ? [media] : []),
      addEventListener: () => {}
    };
    const window = { addEventListener: () => {} };
    const run = new Function('window', 'document', 'location', 'return ' + webPlayer._scripts.HOOK_SCRIPT);
    run(window, document, { href: 'https://music.amazon.com/tracks/B0ABCDEFGHI' });
    expect(window.__parachordAmazonRead()).toMatchObject({ audioDecodedBytes: null });
  });

  test('READ_STREAM_CAPS_SCRIPT evaluates against the capture global and base64s init bytes', () => {
    const run = new Function('window', 'btoa', 'return ' + webPlayer._scripts.READ_STREAM_CAPS_SCRIPT);
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const window = {
      __parachordStreamCaps: {
        manifests: [{ url: 'https://cdn/a.mpd', text: '<MPD/>' }],
        inits: [{ url: 'https://cdn/i.mp4', bytes: bytes.buffer }]
      }
    };
    const out = run(window, (s) => Buffer.from(s, 'binary').toString('base64'));
    expect(out.manifests).toEqual([{ url: 'https://cdn/a.mpd', text: '<MPD/>' }]);
    expect(out.inits).toEqual([
      { url: 'https://cdn/i.mp4', b64: Buffer.from([0, 1, 2, 250, 255]).toString('base64') }
    ]);
    // No capture global (hook never ran): null, not a throw.
    expect(run({}, (s) => s)).toBeNull();
  });

});

describe('setQuality validates before writing hornet\'s store', () => {
  const withController = jest.fn(async (apply) => ({
    streamingQuality: (apply && apply.streamingQuality) || 'STANDARD',
    abrEnabled: !!(apply && apply.abrEnabled)
  }));

  test('an unknown tier is rejected without touching the store', async () => {
    webPlayer.withQualityController = withController;
    const bad = await webPlayer.setQuality({ streamingQuality: 'ULTRA_HD' });
    expect(bad).toMatchObject({ success: false, reason: 'invalid' });
    expect(withController).not.toHaveBeenCalled();
  });

  test('the legacy HD value maps to the tier the modal writes', async () => {
    const ok = await webPlayer.setQuality({ streamingQuality: 'HD' });
    expect(ok.success).toBe(true);
    expect(ok.streamingQuality).toBe('BEST_AVAILABLE');
    expect(withController).toHaveBeenCalledWith({ streamingQuality: 'BEST_AVAILABLE' });
  });

  test('an abrEnabled-only change passes through without a tier', async () => {
    const ok = await webPlayer.setQuality({ abrEnabled: false });
    expect(ok.success).toBe(true);
    expect(withController).toHaveBeenCalledWith({ abrEnabled: false });
  });
});
