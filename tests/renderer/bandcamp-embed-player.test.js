// The renderer half of Bandcamp's hidden embed: the adapter the playback engine
// drives. The main process does the talking to the page; this owns the iframe
// and turns reported states into the embedded-player contract.
const { createBandcampEmbedPlayer, START_TIMEOUT_MS } = require('../../src/renderer/lib/bandcamp-embed-player');

const EMBED = 'https://bandcamp.com/EmbeddedPlayer/track=1/';
const PAGE = 'https://artist.bandcamp.com/track/a-song';

function setup({ prepare, heldLoad } = {}) {
  // A real iframe reports its page only once that page has finished loading.
  // By default this one finishes straight away; heldLoad lets a test hold it.
  const loadListeners = [];
  let currentSrc = '';
  const iframe = {
    setAttribute: jest.fn(),
    style: {},
    addEventListener: (type, fn) => { if (type === 'load') loadListeners.push(fn); },
    finishLoad: () => { loadListeners.forEach((fn) => fn()); },
    get src() { return currentSrc; },
    set src(value) {
      currentSrc = value;
      if (!heldLoad) Promise.resolve().then(() => iframe.finishLoad());
    }
  };
  let onState = null;
  const bridge = {
    prepare: jest.fn(prepare || (async () => ({ success: true, url: EMBED }))),
    start: jest.fn(async () => ({ success: true })),
    command: jest.fn(async () => ({ success: true })),
    stop: jest.fn(async () => ({ success: true })),
    onState: jest.fn((fn) => { onState = fn; })
  };
  const win = {
    document: { createElement: () => iframe, body: { appendChild: jest.fn() } },
    electron: { bandcampEmbed: bridge }
  };
  const player = createBandcampEmbedPlayer({ win, log: { error() {}, warn() {} } });
  const report = (state) => onState({ audio: true, hasSrc: true, paused: false, ended: false, t: 0, dur: 0, errorCode: null, token: bridge.start.mock.calls.at(-1)?.[0].token, ...state });
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { player, bridge, iframe, report, settle, win };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function playing(handlers = {}) {
  const ctx = setup();
  const loaded = ctx.player.load(PAGE, handlers, { bandcampTrackId: 1, bandcampUrl: PAGE });
  await ctx.settle();
  ctx.report({ t: 1, dur: 200 });
  await loaded;
  return ctx;
}

describe('load', () => {
  test('asks main for the embed, points a hidden iframe at it, then starts it', async () => {
    const { player, bridge, iframe, settle } = setup();
    player.element.volume = 0.5;
    player.load(PAGE, {}, { bandcampTrackId: 1 }).catch(() => {});
    await settle();
    expect(bridge.prepare).toHaveBeenCalledWith({ bandcampUrl: PAGE, bandcampTrackId: 1 });
    expect(iframe.src).toBe(EMBED);
    expect(iframe.setAttribute).toHaveBeenCalledWith('allow', 'autoplay');
    expect(bridge.start).toHaveBeenCalledWith(expect.objectContaining({ url: EMBED, volume: 0.5 }));
    player.stop();
  });

  test('resolves only once the position has moved', async () => {
    const { player, report, settle } = setup();
    let done = false;
    const loaded = player.load(PAGE, {}, { bandcampTrackId: 1 }).then((r) => { done = true; return r; });
    await settle();
    report({ t: 0, dur: 200 });
    await settle();
    expect(done).toBe(false);
    report({ t: 0.5, dur: 200 });
    await expect(loaded).resolves.toEqual({ durationSeconds: 200 });
  });

  test('a track it cannot place is refused as unplayable', async () => {
    const { player } = setup({ prepare: async () => ({ success: false, reason: 'unplayable' }) });
    await expect(player.load(PAGE, {}, {})).rejects.toMatchObject({ reason: 'unplayable' });
  });

  test('a track that never moves is refused within the timeout', async () => {
    const { player, settle } = setup();
    const loaded = player.load(PAGE, {}, { bandcampTrackId: 1 });
    const assertion = expect(loaded).rejects.toMatchObject({ reason: 'unplayable' });
    await settle();
    await jest.advanceTimersByTimeAsync(START_TIMEOUT_MS + 1);
    await assertion;
  });

  test('main refusing to start is refused too', async () => {
    const { player, bridge } = setup();
    bridge.start.mockResolvedValueOnce({ success: false });
    await expect(player.load(PAGE, {}, { bandcampTrackId: 1 })).rejects.toMatchObject({ reason: 'unplayable' });
  });

  test('an element error before it starts is refused', async () => {
    const { player, report, settle } = setup();
    const loaded = player.load(PAGE, {}, { bandcampTrackId: 1 });
    const assertion = expect(loaded).rejects.toMatchObject({ reason: 'unplayable' });
    await settle();
    report({ errorCode: 4 });
    await assertion;
  });

  test('a newer load or stop supersedes it', async () => {
    const { player, settle } = setup();
    const first = player.load(PAGE, {}, { bandcampTrackId: 1 });
    const assertion = expect(first).rejects.toMatchObject({ reason: 'superseded' });
    await settle();
    player.load(PAGE, {}, { bandcampTrackId: 2 }).catch(() => {});
    await assertion;
    player.stop();
  });

  // #1242: replaying a track loads the same URL, so the old page keeps matching
  // it until the new one commits. Driving it then clicks the old page, reads its
  // old position as "started", and the new page never gets a click.
  test('does not drive the frame until the page it asked for has loaded', async () => {
    const { player, bridge, iframe, settle } = setup({ heldLoad: true });
    player.load(PAGE, {}, { bandcampTrackId: 1 }).catch(() => {});
    await settle();
    expect(iframe.src).toBe(EMBED);
    expect(bridge.start).not.toHaveBeenCalled();
    iframe.finishLoad();
    await settle();
    expect(bridge.start).toHaveBeenCalledTimes(1);
  });

  test('a replay with no stop first waits for the reload too', async () => {
    const { player, bridge, iframe, report, settle } = setup({ heldLoad: true });
    player.load(PAGE, {}, { bandcampTrackId: 1 }).catch(() => {});
    await settle();
    iframe.finishLoad();
    await settle();
    report({ t: 12, paused: false, dur: 200, ended: false, errorCode: null });
    bridge.start.mockClear();
    player.load(PAGE, {}, { bandcampTrackId: 1 }).catch(() => {});
    await settle();
    expect(bridge.start).not.toHaveBeenCalled();
    iframe.finishLoad();
    await settle();
    expect(bridge.start).toHaveBeenCalledTimes(1);
  });

  test('a page finishing after a newer load or a stop starts nothing', async () => {
    const { player, bridge, iframe, settle } = setup({ heldLoad: true });
    player.load(PAGE, {}, { bandcampTrackId: 1 }).catch(() => {});
    await settle();
    player.stop();
    iframe.finishLoad();
    await settle();
    expect(bridge.start).not.toHaveBeenCalled();

    player.load(PAGE, {}, { bandcampTrackId: 1 }).catch(() => {});
    await settle();
    player.load(PAGE, {}, { bandcampTrackId: 1 }).catch(() => {});
    await settle();
    iframe.finishLoad();
    await settle();
    expect(bridge.start).toHaveBeenCalledTimes(1);
  });

  test('a page that never finishes loading is reported unplayable', async () => {
    jest.useFakeTimers();
    try {
      const { player, bridge, settle } = setup({ heldLoad: true });
      const result = player.load(PAGE, {}, { bandcampTrackId: 1 });
      const rejected = expect(result).rejects.toMatchObject({ reason: 'unplayable' });
      await settle();
      jest.advanceTimersByTime(START_TIMEOUT_MS + 1);
      await rejected;
      expect(bridge.start).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('a stop during prepare never reaches the iframe or starts anything', async () => {
    let finishPrepare;
    const { player, bridge, iframe, settle } = setup({ prepare: () => new Promise((r) => { finishPrepare = r; }) });
    const first = player.load(PAGE, {}, { bandcampTrackId: 1 });
    const assertion = expect(first).rejects.toMatchObject({ reason: 'superseded' });
    player.stop();
    await assertion;
    finishPrepare({ success: true, url: EMBED });
    await settle();
    expect(iframe.src).not.toBe(EMBED);
    expect(bridge.start).not.toHaveBeenCalled();
  });
});

describe('handlers', () => {
  test('duration arrives once, progress only after it started', async () => {
    const onDuration = jest.fn();
    const onProgress = jest.fn();
    const { player, report, settle } = setup();
    const loaded = player.load(PAGE, { onDuration, onProgress }, { bandcampTrackId: 1 });
    await settle();
    report({ t: 0, dur: 200 });
    report({ t: 0, dur: 200 });
    expect(onDuration).toHaveBeenCalledTimes(1);
    expect(onDuration).toHaveBeenCalledWith(200);
    expect(onProgress).not.toHaveBeenCalled();
    report({ t: 2, dur: 200 });
    await loaded;
    report({ t: 3, dur: 200 });
    expect(onProgress).toHaveBeenLastCalledWith(3);
  });

  test('pause and play report transitions only', async () => {
    const onPause = jest.fn();
    const onPlay = jest.fn();
    const { report } = await playing({ onPause, onPlay });
    report({ t: 2, dur: 200, paused: true });
    report({ t: 2, dur: 200, paused: true });
    expect(onPause).toHaveBeenCalledTimes(1);
    report({ t: 3, dur: 200, paused: false });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  test('the end of the track finishes once', async () => {
    const onFinish = jest.fn();
    const { report } = await playing({ onFinish });
    report({ t: 200, dur: 200, ended: true, paused: true });
    report({ t: 200, dur: 200, ended: true, paused: true });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  test('a state from an older play is ignored', async () => {
    const onProgress = jest.fn();
    const { report } = await playing({ onProgress });
    onProgress.mockClear();
    report({ t: 9, dur: 200, token: -1 });
    expect(onProgress).not.toHaveBeenCalled();
  });

  test('a handler that throws does not stop the next state', async () => {
    const onProgress = jest.fn(() => { throw new Error('boom'); });
    const { report } = await playing({ onProgress });
    expect(() => report({ t: 5, dur: 200 })).not.toThrow();
  });
});

describe('the element facade', () => {
  test('reads position, duration and pause state', async () => {
    const { player, report } = await playing();
    report({ t: 12, dur: 200 });
    expect(player.element.currentTime).toBe(12);
    expect(player.element.duration).toBe(200);
    expect(player.element.paused).toBe(false);
  });
  test('duration is NaN until known', () => {
    expect(setup().player.element.duration).toBeNaN();
  });
  test('seek, volume, play and pause go to main with the play token', async () => {
    const { player, bridge } = await playing();
    const token = bridge.start.mock.calls[0][0].token;
    player.element.currentTime = 60;
    expect(player.element.currentTime).toBe(60);
    player.element.volume = 0.3;
    expect(player.element.volume).toBe(0.3);
    player.element.pause();
    expect(player.element.paused).toBe(true);
    player.element.play();
    expect(player.element.paused).toBe(false);
    expect(bridge.command.mock.calls.map(c => c[0])).toEqual([
      { token, action: 'seek', value: 60 },
      { token, action: 'volume', value: 0.3 },
      { token, action: 'pause' },
      { token, action: 'play' }
    ]);
  });
  test('volume is clamped and junk is ignored', () => {
    const { player } = setup();
    player.element.volume = 5;
    expect(player.element.volume).toBe(1);
    player.element.volume = NaN;
    expect(player.element.volume).toBe(1);
  });
  test('nothing is sent while nothing is loaded', () => {
    const { player, bridge } = setup();
    player.element.currentTime = 5;
    player.element.pause();
    player.element.play();
    expect(bridge.command).not.toHaveBeenCalled();
  });
  test('a rejected command is swallowed', async () => {
    const { player, bridge, settle } = await playing();
    bridge.command.mockRejectedValueOnce(new Error('gone'));
    player.element.pause();
    await settle();
  });
});

describe('stop', () => {
  test('blanks the iframe and tells main, so leaving a track halts it', async () => {
    const { player, bridge, iframe } = await playing();
    const token = bridge.start.mock.calls[0][0].token;
    player.stop();
    expect(iframe.src).toBe('about:blank');
    expect(bridge.stop).toHaveBeenCalledWith({ token });
    expect(player.isActive()).toBe(false);
  });
  test('is a no-op on an idle player', () => {
    const { player, bridge } = setup();
    player.stop();
    expect(bridge.stop).not.toHaveBeenCalled();
  });
  test('without the bridge a load is simply refused', async () => {
    const iframe = { setAttribute() {}, style: {}, src: '', addEventListener() {} };
    const player = createBandcampEmbedPlayer({ win: { document: { createElement: () => iframe, body: { appendChild() {} } } }, log: { error() {}, warn() {} } });
    await expect(player.load(PAGE, {}, {})).rejects.toMatchObject({ reason: 'unplayable' });
  });
});
