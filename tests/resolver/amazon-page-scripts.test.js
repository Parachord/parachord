/**
 * Smoke tests for the Amazon page scripts (amazon-web-player.js).
 *
 * HOOK_SCRIPT and SCRAPE_SCRIPT serialize helpers from amazon-music-logic.js
 * with .toString() and interpolate them into template literals. A helper that
 * gains a closure over module state, or a stray backtick in the template, only
 * breaks inside the Amazon page — these tests evaluate the constructed scripts
 * against a bare DOM stub so serialization breakage fails CI. The parsing
 * behavior itself is unit-tested in amazon-music-logic.test.js
 * (pickTrackAsinFromIds, parseRowDurationSec).
 */

const webPlayer = require('../../amazon-web-player');

function bareDocument() {
  return {
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
}

describe('Amazon page scripts evaluate after serialization', () => {
  test('SCRAPE_SCRIPT evaluates against an empty page and returns its shape', () => {
    const run = new Function('document', 'location', 'return ' + webPlayer._scripts.SCRAPE_SCRIPT);
    const out = run(bareDocument(), { href: 'https://music.amazon.com/search/x/songs' });
    expect(out).toEqual(expect.objectContaining({
      href: 'https://music.amazon.com/search/x/songs',
      tracks: [],
      debug: expect.objectContaining({ anchors: 0, withAsin: 0, rejected: 0, samples: [], items: 0 })
    }));
  });

  test('SCRAPE_SCRIPT carries the serialized row helpers inside the page world', () => {
    // The script body must embed the current helper source — a rename or a
    // signature change in amazon-music-logic.js that the script was not
    // re-serialized for breaks only inside the page otherwise.
    const src = webPlayer._scripts.SCRAPE_SCRIPT;
    expect(src).toContain('function pickTrackAsinFromIds(');
    expect(src).toContain('function parseRowDurationSec(');
    // ...and the helpers must be the logic module's, byte-for-byte.
    const logic = require('../../amazon-music-logic');
    expect(src).toContain(logic.pickTrackAsinFromIds.toString());
    expect(src).toContain(logic.parseRowDurationSec.toString());
  });

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
