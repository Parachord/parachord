/**
 * @jest-environment jsdom
 */
/**
 * An Apple Music track that ends through MusicKit JS (the web player: Windows,
 * Linux, and a Mac whose native player isn't ready) advances the queue
 * (#1672).
 *
 * musickit-web.js listened for `mediaItemDidEndPlaying`, which the MusicKit JS
 * the app loads (js-cdn.music.apple.com/musickit/v3/musickit.js, and the /v2/
 * path that serves the same bundle) never emits: the name isn't in the bundle.
 * So a track that ended just stopped, and a playlist never moved on. A natural
 * end is `playbackStateDidChange` with state 5 (PlaybackStates.ended), which
 * the SDK sets only from the media element's own `ended` event, skipped once
 * the element was cleaned up for a track change: a pause, stop, seek or skip
 * never produces it.
 */
const fs = require('fs');
const path = require('path');
const { MusicKitWeb } = require('../../musickit-web');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'musickit-web.js'), 'utf8');

// A MusicKit that records its listeners, so the test can play the SDK's
// events into musickit-web.js.
function wiredMusicKit() {
  const handlers = {};
  const musicKit = {
    playbackState: 0,
    addEventListener: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
  };
  const mk = new MusicKitWeb();
  mk.musicKit = musicKit;
  mk.setupEventListeners();
  const toState = (state) => {
    musicKit.playbackState = state;
    (handlers.playbackStateDidChange || []).forEach((fn) => fn({ state }));
  };
  return { handlers, toState };
}

let ended;
const onEnded = () => { ended += 1; };
beforeEach(() => {
  ended = 0;
  window.addEventListener('musickit-track-ended', onEnded);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  window.removeEventListener('musickit-track-ended', onEnded);
  jest.restoreAllMocks();
});

describe('a MusicKit JS track that ends advances the queue', () => {
  test('state 5 (ended) sends musickit-track-ended once', () => {
    const { toState } = wiredMusicKit();
    toState(2); // playing
    toState(5); // ended
    expect(ended).toBe(1);
  });

  // The end of a real track, as captured in #1672: only the 5 is the end.
  test('the states around a natural end send it once, and the 4 and 10 after it add nothing', () => {
    const { toState } = wiredMusicKit();
    [2, 3, 6, 3, 5, 4, 10].forEach(toState);
    expect(ended).toBe(1);
  });

  test('pause, stop, seeking, waiting, stalled and completed never send it', () => {
    const { toState } = wiredMusicKit();
    [1, 2, 3, 4, 6, 8, 9, 10].forEach(toState);
    expect(ended).toBe(0);
  });

  test('each track that ends sends it again', () => {
    const { toState } = wiredMusicKit();
    [2, 5, 4, 1, 2, 5, 4, 1, 2, 5].forEach(toState);
    expect(ended).toBe(3);
  });

  // An event the SDK doesn't have can't be the signal, and a listener kept
  // "in case" would advance twice on every end if Apple ever brought it back.
  test('nothing listens for mediaItemDidEndPlaying', () => {
    const { handlers } = wiredMusicKit();
    expect(handlers.mediaItemDidEndPlaying).toBeUndefined();
    expect(source).not.toMatch(/addEventListener\(\s*['"]mediaItemDidEndPlaying/);
  });
});
