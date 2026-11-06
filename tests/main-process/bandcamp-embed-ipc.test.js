// The main-process side of Bandcamp's hidden embed. The page is third party:
// only the main window's top frame may drive it, only fixed scripts run in
// it, and nothing it answers is trusted.
const { registerBandcampEmbedIpc, sanitizeEmbedState, POLL_MS } = require('../../main-process/ipc/bandcamp-embed');

const URL_A = 'https://bandcamp.com/EmbeddedPlayer/track=1/size=large/bgcol=333333/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/';

function setup({ stateAnswer } = {}) {
  jest.useFakeTimers();
  const handlers = new Map();
  const scripts = [];
  let answer = stateAnswer || JSON.stringify({ audio: true, hasSrc: true, paused: false, ended: false, t: 5, dur: 100, errorCode: null });
  const embedFrame = {
    url: URL_A,
    executeJavaScript: jest.fn(async (code, gesture) => {
      scripts.push({ code, gesture });
      if (code === 'bcState()') return answer;
      if (code === 'bcStart()') return true;
      return true;
    })
  };
  const mainFrame = { url: 'file:///index.html', frames: [embedFrame] };
  const webContents = { mainFrame };
  const send = jest.fn();
  registerBandcampEmbedIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    getMainWindow: () => ({ webContents, isDestroyed: () => false }),
    sendToRenderer: send,
    fetch: jest.fn(),
    controlScript: '/* control */',
    log: { log() {}, warn() {}, error() {} }
  });
  const fromApp = { sender: webContents, senderFrame: mainFrame };
  const call = (name, ...args) => handlers.get(name)(fromApp, ...args);
  const tick = async (n = 1) => { for (let i = 0; i < n; i += 1) await jest.advanceTimersByTimeAsync(POLL_MS); };
  return { handlers, scripts, send, call, tick, embedFrame, mainFrame, webContents, setAnswer: (a) => { answer = a; } };
}

afterEach(() => { jest.useRealTimers(); });

describe('who may drive it', () => {
  test('a message from anywhere but the main window top frame is refused', async () => {
    const { handlers, webContents } = setup();
    const strangers = [
      { sender: {}, senderFrame: {} },
      { sender: webContents, senderFrame: { url: 'https://bandcamp.com/EmbeddedPlayer/' } }
    ];
    for (const event of strangers) {
      await expect(handlers.get('bandcamp-embed:prepare')(event, { bandcampTrackId: 1 })).resolves.toMatchObject({ success: false });
      await expect(handlers.get('bandcamp-embed:start')(event, { token: 1, url: URL_A })).resolves.toMatchObject({ success: false });
      await expect(handlers.get('bandcamp-embed:command')(event, { token: 1, action: 'pause' })).resolves.toMatchObject({ success: false });
    }
  });
});

describe('prepare', () => {
  test('answers the embed URL for a track id', async () => {
    const { call } = setup();
    await expect(call('bandcamp-embed:prepare', { bandcampTrackId: 1 })).resolves.toEqual({ success: true, url: URL_A });
  });
  test('a track it cannot place is a refusal, not a throw', async () => {
    const { call } = setup();
    await expect(call('bandcamp-embed:prepare', { bandcampUrl: 'https://evil.example/track/x' })).resolves.toMatchObject({ success: false, reason: 'unplayable' });
    await expect(call('bandcamp-embed:prepare', null)).resolves.toMatchObject({ success: false, reason: 'unplayable' });
  });
});

describe('start', () => {
  test('refuses any URL that is not a Bandcamp track embed', async () => {
    const { call, scripts } = setup();
    await expect(call('bandcamp-embed:start', { token: 1, url: 'https://evil.example/' })).resolves.toMatchObject({ success: false });
    await expect(call('bandcamp-embed:start', { token: 1, url: 'https://bandcamp.com/EmbeddedPlayer/album=9/' })).resolves.toMatchObject({ success: false });
    expect(scripts).toEqual([]);
  });

  test('installs the control script, sets the volume, starts once with a user gesture, then polls', async () => {
    const { call, tick, scripts, send } = setup();
    await call('bandcamp-embed:start', { token: 1, url: URL_A, volume: 0.5 });
    await tick();
    const codes = scripts.map(s => s.code);
    expect(codes[0]).toBe('/* control */');
    expect(codes).toContain('bcVolume(0.5)');
    expect(codes.filter(c => c === 'bcStart()')).toHaveLength(1);
    expect(scripts.find(s => s.code === 'bcStart()').gesture).toBe(true);
    await tick(3);
    expect(scripts.filter(s => s.code === 'bcStart()')).toHaveLength(1);
    expect(send).toHaveBeenCalledWith('bandcamp-embed:state', expect.objectContaining({ token: 1, t: 5, dur: 100, paused: false }));
  });

  test('waits for the frame to arrive, and for its button', async () => {
    const { call, tick, mainFrame, embedFrame, scripts } = setup();
    mainFrame.frames = [];
    await call('bandcamp-embed:start', { token: 1, url: URL_A });
    await tick(2);
    expect(scripts).toEqual([]);
    mainFrame.frames = [embedFrame];
    embedFrame.executeJavaScript.mockImplementationOnce(async () => true) // control script
      .mockImplementationOnce(async () => false); // no button yet
    await tick(2);
    // The first try found no button, so it tried again.
    expect(embedFrame.executeJavaScript.mock.calls.filter(c => c[0] === 'bcStart()')).toHaveLength(2);
  });

  test('only drives a frame showing exactly the URL it was asked for', async () => {
    const { call, tick, embedFrame, scripts } = setup();
    embedFrame.url = 'https://bandcamp.com/EmbeddedPlayer/track=2/size=large/bgcol=333333/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/';
    await call('bandcamp-embed:start', { token: 1, url: URL_A });
    await tick(2);
    expect(scripts).toEqual([]);
  });

  test('sends a state only when it changed', async () => {
    const { call, tick, send } = setup();
    await call('bandcamp-embed:start', { token: 1, url: URL_A });
    await tick(4);
    expect(send.mock.calls.filter(c => c[0] === 'bandcamp-embed:state')).toHaveLength(1);
  });

  test('a frame that throws mid-poll is retried, not fatal', async () => {
    const { call, tick, embedFrame, send } = setup();
    await call('bandcamp-embed:start', { token: 1, url: URL_A });
    embedFrame.executeJavaScript.mockImplementationOnce(async () => { throw new Error('frame gone'); });
    await tick(4);
    expect(send).toHaveBeenCalledWith('bandcamp-embed:state', expect.objectContaining({ token: 1 }));
  });

  test('a page that re-navigates gets the control script again without restarting the track', async () => {
    const { call, tick, scripts, embedFrame, setAnswer } = setup();
    await call('bandcamp-embed:start', { token: 1, url: URL_A });
    await tick(2);
    setAnswer(undefined);
    embedFrame.executeJavaScript.mockImplementationOnce(async () => { throw new ReferenceError('bcState is not defined'); });
    await tick(2);
    expect(scripts.filter(s => s.code === '/* control */').length).toBeGreaterThan(0);
  });
});

describe('commands', () => {
  async function started() {
    const ctx = setup();
    await ctx.call('bandcamp-embed:start', { token: 1, url: URL_A });
    await ctx.tick();
    ctx.scripts.length = 0;
    return ctx;
  }

  test.each([
    ['play', undefined, 'bcPlay()'],
    ['pause', undefined, 'bcPause()'],
    ['seek', 60.5, 'bcSeek(60.5)'],
    ['volume', 0.3, 'bcVolume(0.3)']
  ])('%s runs its fixed script', async (action, value, code) => {
    const { call, scripts } = await started();
    await expect(call('bandcamp-embed:command', { token: 1, action, value })).resolves.toMatchObject({ success: true });
    expect(scripts.map(s => s.code)).toContain(code);
  });

  test('play carries a user gesture', async () => {
    const { call, scripts } = await started();
    await call('bandcamp-embed:command', { token: 1, action: 'play' });
    expect(scripts.find(s => s.code === 'bcPlay()').gesture).toBe(true);
  });

  test('nothing from the message reaches the page as code', async () => {
    const { call, scripts } = await started();
    await expect(call('bandcamp-embed:command', { token: 1, action: 'seek', value: '1);alert(1' })).resolves.toMatchObject({ success: false });
    await expect(call('bandcamp-embed:command', { token: 1, action: 'bcStart' })).resolves.toMatchObject({ success: false });
    await expect(call('bandcamp-embed:command', { token: 1, action: 'constructor' })).resolves.toMatchObject({ success: false });
    expect(scripts).toEqual([]);
  });

  test('volume is clamped, and a seek cannot go negative', async () => {
    const { call, scripts } = await started();
    await call('bandcamp-embed:command', { token: 1, action: 'volume', value: 7 });
    await call('bandcamp-embed:command', { token: 1, action: 'seek', value: -5 });
    expect(scripts.map(s => s.code)).toEqual(['bcVolume(1)', 'bcSeek(0)']);
  });

  test('a stale token drives nothing', async () => {
    const { call, scripts } = await started();
    await expect(call('bandcamp-embed:command', { token: 99, action: 'pause' })).resolves.toMatchObject({ success: false });
    expect(scripts).toEqual([]);
  });
});

describe('stop', () => {
  test('ends the polling', async () => {
    const { call, tick, scripts, send } = setup();
    await call('bandcamp-embed:start', { token: 1, url: URL_A });
    await tick();
    await call('bandcamp-embed:stop', { token: 1 });
    scripts.length = 0;
    send.mockClear();
    await tick(3);
    expect(scripts).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
  test('a stop for an old token leaves the newer play alone', async () => {
    const { call, tick, scripts } = setup();
    await call('bandcamp-embed:start', { token: 2, url: URL_A });
    await call('bandcamp-embed:stop', { token: 1 });
    await tick();
    expect(scripts.length).toBeGreaterThan(0);
  });
  test('a new start replaces the old polling', async () => {
    const { call, tick, send } = setup();
    await call('bandcamp-embed:start', { token: 1, url: URL_A });
    await call('bandcamp-embed:start', { token: 2, url: URL_A });
    await tick(2);
    const tokens = send.mock.calls.filter(c => c[0] === 'bandcamp-embed:state').map(c => c[1].token);
    expect(new Set(tokens)).toEqual(new Set([2]));
  });
});

describe('sanitizeEmbedState', () => {
  test('keeps a good answer', () => {
    expect(sanitizeEmbedState(JSON.stringify({ audio: true, hasSrc: true, paused: true, ended: true, t: 1.5, dur: 2, errorCode: 4, decodedBytes: 4096 })))
      .toEqual({ audio: true, hasSrc: true, paused: true, ended: true, t: 1.5, dur: 2, errorCode: 4, decodedBytes: 4096 });
  });
  test.each([['not json'], [null], [undefined], [42], ['null'], ['[]']])('%p is no state', (raw) => {
    expect(sanitizeEmbedState(raw)).toBeNull();
  });
  test('coerces anything odd the page sends', () => {
    expect(sanitizeEmbedState(JSON.stringify({ audio: 'yes', hasSrc: 1, paused: 'x', ended: {}, t: 'NaN', dur: -3, errorCode: 'bad', decodedBytes: 'lots', extra: '<script>' })))
      .toEqual({ audio: false, hasSrc: false, paused: true, ended: false, t: 0, dur: 0, errorCode: null, decodedBytes: null });
  });
  test('an absurd position or duration is dropped', () => {
    expect(sanitizeEmbedState(JSON.stringify({ t: 1e12, dur: 1e12 }))).toMatchObject({ t: 0, dur: 0 });
  });
  test('decoded bytes pass as a non-negative count, negative or absurd ones are dropped', () => {
    expect(sanitizeEmbedState(JSON.stringify({ decodedBytes: 80123 }))).toMatchObject({ decodedBytes: 80123 });
    expect(sanitizeEmbedState(JSON.stringify({ decodedBytes: 4096.8 }))).toMatchObject({ decodedBytes: 4097 });
    expect(sanitizeEmbedState(JSON.stringify({ decodedBytes: -1 }))).toMatchObject({ decodedBytes: null });
    expect(sanitizeEmbedState(JSON.stringify({ decodedBytes: 1e15 }))).toMatchObject({ decodedBytes: null });
    expect(sanitizeEmbedState(JSON.stringify({}))).toMatchObject({ decodedBytes: null });
  });
});
