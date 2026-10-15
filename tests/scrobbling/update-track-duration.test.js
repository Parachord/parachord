/**
 * ScrobbleManager.updateTrackDuration — the Amazon poller learns the real
 * duration from the media element after onTrackStart already ran (search
 * results carry duration 0 from the row scrape). Without the patch, the
 * track never scrobbles: onProgressUpdate returns immediately on a falsy
 * duration, no matter how long it plays.
 */

const { ScrobbleManager } = require('../../scrobbler-loader');

describe('ScrobbleManager.updateTrackDuration', () => {
  test('fills a missing duration so the scrobble threshold can fire', async () => {
    const mgr = new ScrobbleManager();
    const plugin = {
      id: 'test',
      isEnabled: async () => true,
      updateNowPlaying: async () => {},
      scrobble: async () => {}
    };
    mgr.registerPlugin(plugin);

    const track = { title: 'T', artist: 'A', duration: 0 };
    await mgr.onTrackStart(track); // duration 0: now-playing sent, scrobble gated
    expect(mgr.currentTrack.duration).toBe(0);

    mgr.updateTrackDuration(225);
    expect(mgr.currentTrack.duration).toBe(225);

    await mgr.onProgressUpdate(120); // past the 50% threshold of 225s
    expect(mgr.scrobbleSubmitted).toBe(true);
  });

  test('ignores junk values and does not churn a correct duration', () => {
    const mgr = new ScrobbleManager();
    mgr.onTrackStart({ title: 'T', artist: 'A', duration: 225 });
    mgr.updateTrackDuration(null);
    mgr.updateTrackDuration(-5);
    mgr.updateTrackDuration('x');
    expect(mgr.currentTrack.duration).toBe(225);
    // A real drift (remaster with a longer tail) does update.
    mgr.updateTrackDuration(230);
    expect(mgr.currentTrack.duration).toBe(230);
  });

  test('is a no-op with no current track', () => {
    const mgr = new ScrobbleManager();
    expect(() => mgr.updateTrackDuration(200)).not.toThrow();
  });
});
