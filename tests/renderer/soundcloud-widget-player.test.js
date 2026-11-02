const { createSoundCloudWidgetPlayer, widgetSrc, WIDGET_ORIGIN } = require('../../src/renderer/lib/soundcloud-widget-player');

// A fake window: one iframe whose contentWindow records what we post, and a
// `message` listener we can drive as the widget would.
function fakeWindow() {
  const posted = [];
  const contentWindow = { postMessage: jest.fn((data, origin) => posted.push({ msg: JSON.parse(data), origin })) };
  let listener = null;
  const iframe = { src: '', style: {}, contentWindow, setAttribute: jest.fn() };
  const win = {
    document: { createElement: () => iframe, body: { appendChild: jest.fn() } },
    addEventListener: (type, fn) => { if (type === 'message') listener = fn; }
  };
  const fromWidget = (method, value, { origin = WIDGET_ORIGIN, source = contentWindow } = {}) =>
    listener({ origin, source, data: JSON.stringify(value === undefined ? { method } : { method, value }) });
  return { win, iframe, posted, fromWidget, methods: () => posted.map((p) => p.msg.method) };
}

const quiet = { error: () => {} };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('SoundCloud widget player', () => {
  test('widgetSrc points the widget at the permalink and asks it to autoplay', () => {
    const src = widgetSrc('https://soundcloud.com/flume/never-be-like-you-feat-kai');
    expect(src.startsWith('https://w.soundcloud.com/player/?')).toBe(true);
    const params = new URL(src).searchParams;
    expect(params.get('url')).toBe('https://soundcloud.com/flume/never-be-like-you-feat-kai');
    expect(params.get('auto_play')).toBe('true');
  });

  test('a playable track: subscribes on ready, then resolves once the position advances', async () => {
    const w = fakeWindow();
    const player = createSoundCloudWidgetPlayer({ win: w.win, log: quiet });
    const onProgress = jest.fn();
    const started = player.load('https://soundcloud.com/a/b', { onProgress });
    expect(w.iframe.src).toContain('w.soundcloud.com/player/');

    w.fromWidget('ready');
    expect(w.methods()).toEqual(expect.arrayContaining(['addEventListener', 'setVolume', 'getDuration', 'play']));
    expect(w.posted.every((p) => p.origin === WIDGET_ORIGIN)).toBe(true);
    const subscribed = w.posted.filter((p) => p.msg.method === 'addEventListener').map((p) => p.msg.value);
    expect(subscribed).toEqual(expect.arrayContaining(['playProgress', 'play', 'pause', 'finish', 'error']));

    w.fromWidget('getDuration', 237000);
    w.fromWidget('pause'); // the widget's start-up pause: not a transport event
    w.fromWidget('play');
    w.fromWidget('playProgress', { currentPosition: 0 });
    w.fromWidget('playProgress', { currentPosition: 1200 });

    await expect(started).resolves.toEqual({ durationSeconds: 237 });
    expect(onProgress).toHaveBeenCalledWith(1.2);
    expect(player.element.paused).toBe(false);
    expect(player.element.duration).toBe(237);
  });

  test('a track the widget will not play is reported unplayable after the timeout', async () => {
    const w = fakeWindow();
    const player = createSoundCloudWidgetPlayer({ win: w.win, startTimeoutMs: 5000, log: quiet });
    const started = player.load('https://soundcloud.com/odesza/a-moment-apart');
    w.fromWidget('ready'); // ...and nothing else, like the live "Play another track" case
    jest.advanceTimersByTime(5000);
    await expect(started).rejects.toMatchObject({ reason: 'unplayable' });
  });

  test('a new load supersedes the previous one, and its late messages are ignored', async () => {
    const w = fakeWindow();
    const player = createSoundCloudWidgetPlayer({ win: w.win, log: quiet });
    const firstProgress = jest.fn();
    const first = player.load('https://soundcloud.com/a/first', { onProgress: firstProgress });
    const second = player.load('https://soundcloud.com/a/second');
    await expect(first).rejects.toMatchObject({ reason: 'superseded' });
    w.fromWidget('playProgress', { currentPosition: 5000 }); // before the new document is ready
    expect(firstProgress).not.toHaveBeenCalled();
    w.fromWidget('ready');
    w.fromWidget('playProgress', { currentPosition: 300 });
    await expect(second).resolves.toBeDefined();
  });

  test('messages from another origin or another frame are ignored', async () => {
    const w = fakeWindow();
    const player = createSoundCloudWidgetPlayer({ win: w.win, startTimeoutMs: 1000, log: quiet });
    const started = player.load('https://soundcloud.com/a/b');
    w.fromWidget('ready', undefined, { origin: 'https://evil.example' });
    w.fromWidget('ready', undefined, { source: { postMessage() {} } });
    expect(w.methods()).not.toContain('play');
    jest.advanceTimersByTime(1000);
    await expect(started).rejects.toMatchObject({ reason: 'unplayable' });
  });

  test('the element facade drives the widget: volume, seek, pause, play', async () => {
    const w = fakeWindow();
    const player = createSoundCloudWidgetPlayer({ win: w.win, log: quiet });
    player.element.volume = 0.4; // before ready: remembered, sent on ready
    const started = player.load('https://soundcloud.com/a/b');
    w.fromWidget('ready');
    expect(w.posted.find((p) => p.msg.method === 'setVolume').msg.value).toBe(40);
    w.fromWidget('playProgress', { currentPosition: 100 });
    await started;

    w.posted.length = 0;
    player.element.volume = 0.25;
    player.element.currentTime = 90;
    player.element.pause();
    expect(player.element.paused).toBe(true);
    player.element.play();
    expect(w.posted.map((p) => [p.msg.method, p.msg.value])).toEqual([
      ['setVolume', 25], ['seekTo', 90000], ['pause', undefined], ['play', undefined]
    ]);
    expect(player.element.currentTime).toBe(90);
  });

  test('pause, play and finish reach the handlers once the track has started', async () => {
    const w = fakeWindow();
    const player = createSoundCloudWidgetPlayer({ win: w.win, log: quiet });
    const h = { onPause: jest.fn(), onPlay: jest.fn(), onFinish: jest.fn() };
    const started = player.load('https://soundcloud.com/a/b', h);
    w.fromWidget('ready');
    w.fromWidget('pause');
    expect(h.onPause).not.toHaveBeenCalled();
    w.fromWidget('playProgress', { currentPosition: 100 });
    await started;
    w.fromWidget('pause');
    w.fromWidget('play');
    w.fromWidget('finish');
    expect(h.onPause).toHaveBeenCalledTimes(1);
    expect(h.onPlay).toHaveBeenCalledTimes(1);
    expect(h.onFinish).toHaveBeenCalledTimes(1);
  });

  test('stop() halts: blanks the iframe, rejects a pending start, and drops handlers', async () => {
    const w = fakeWindow();
    const player = createSoundCloudWidgetPlayer({ win: w.win, log: quiet });
    const onFinish = jest.fn();
    const started = player.load('https://soundcloud.com/a/b', { onFinish });
    player.stop();
    await expect(started).rejects.toMatchObject({ reason: 'superseded' });
    expect(w.iframe.src).toBe('about:blank');
    expect(player.isActive()).toBe(false);
    w.fromWidget('ready');
    w.fromWidget('finish');
    expect(onFinish).not.toHaveBeenCalled();
  });
});
