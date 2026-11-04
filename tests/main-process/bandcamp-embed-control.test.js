// The script the app runs inside Bandcamp's embed. It is a plain script so
// the mobile apps can carry a byte-for-byte copy.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../main-process/bandcamp-embed-control.js'), 'utf8');

function pageWith({ button = true, audio = true } = {}) {
  const listeners = {};
  const el = audio ? {
    src: '', paused: true, ended: false, currentTime: 0, duration: NaN, volume: 1, error: null,
    addEventListener: (name, fn) => { listeners[name] = fn; },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  } : null;
  const clicks = { n: 0 };
  const btn = button ? { click: () => { clicks.n += 1; if (el) { el.src = 'https://t4.bcbits.com/stream/a'; el.paused = false; } } } : null;
  const document = { querySelector: (sel) => (sel === 'audio' ? el : sel === '#big_play_button' ? btn : null) };
  const context = vm.createContext({ document, JSON, Number, Math });
  context.window = context;
  vm.runInContext(SOURCE, context);
  const run = (code) => vm.runInContext(code, context);
  return { run, el, clicks, fire: (name) => listeners[name] && listeners[name]() };
}
const state = (page) => JSON.parse(page.run('bcState()'));

describe('bcStart', () => {
  test('clicks the real play button, the 46x46 one', () => {
    const page = pageWith();
    expect(page.run('bcStart()')).toBe(true);
    expect(page.clicks.n).toBe(1);
  });
  test('reports a page with no button', () => {
    expect(pageWith({ button: false }).run('bcStart()')).toBe(false);
  });
});

describe('bcState', () => {
  test('before anything has loaded', () => {
    expect(state(pageWith())).toMatchObject({ audio: true, hasSrc: false, paused: true, ended: false, t: 0, dur: 0, errorCode: null });
  });
  test('a page with no audio element yet', () => {
    expect(state(pageWith({ audio: false }))).toMatchObject({ audio: false, hasSrc: false, ended: false });
  });
  test('position, duration and pause come from the element', () => {
    const page = pageWith();
    page.run('bcStart()');
    Object.assign(page.el, { currentTime: 12.34, duration: 214.3 });
    expect(state(page)).toMatchObject({ hasSrc: true, paused: false, t: 12.34, dur: 214.3 });
  });
  test('the end of the track stays ended, even if the page moves on after it', () => {
    const page = pageWith();
    page.run('bcStart()');
    page.fire('ended');
    expect(state(page).ended).toBe(true);
    page.el.ended = false;
    expect(state(page).ended).toBe(true);
  });
  test('the element moving to another stream counts as the end, and stops it', () => {
    const page = pageWith();
    page.run('bcStart()');
    expect(state(page).ended).toBe(false);
    page.el.src = 'https://t4.bcbits.com/stream/b';
    expect(state(page).ended).toBe(true);
    expect(page.el.paused).toBe(true);
  });
  test('an element error is reported', () => {
    const page = pageWith();
    page.run('bcStart()');
    page.el.error = { code: 4 };
    expect(state(page).errorCode).toBe(4);
  });
});

describe('the controls', () => {
  test('play, pause, seek and volume drive the element', () => {
    const page = pageWith();
    page.run('bcStart()');
    page.run('bcPause()');
    expect(page.el.paused).toBe(true);
    page.run('bcPlay()');
    expect(page.el.paused).toBe(false);
    page.run('bcSeek(60)');
    expect(page.el.currentTime).toBe(60);
    page.run('bcVolume(0.3)');
    expect(page.el.volume).toBe(0.3);
  });
  test('none of them throw on a page with no audio', () => {
    const page = pageWith({ audio: false });
    for (const call of ['bcPlay()', 'bcPause()', 'bcSeek(1)', 'bcVolume(1)']) {
      expect(() => page.run(call)).not.toThrow();
    }
  });
});

test('it loads under Node without a document, for the main process to read', () => {
  expect(() => require('../../main-process/bandcamp-embed-control')).not.toThrow();
});
