// The native MusicKit helper keeps the Media & Apple Music permission it saw
// when it started. On 2026-11-12 it answered "denied" after the user had
// allowed Parachord in System Settings, and "authorized" once the app (and so
// the helper) restarted. authorize() now asks a restarted helper once before
// telling the user to go to System Settings again.

const EventEmitter = require('events');
const { MusicKitBridge } = require('../../musickit-bridge');

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdin = { write: () => {} };
  proc.killed = false;
  proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit('close', 0, null)); };
  return proc;
}

function makeBridge(answers) {
  const bridge = new MusicKitBridge();
  const started = [];
  bridge.start = async () => {
    const proc = fakeProcess();
    bridge.process = proc;
    bridge.isReady = true;
    started.push(proc);
    return true;
  };
  const sent = [];
  bridge.send = async (action) => { sent.push(action); return answers.shift(); };
  return { bridge, started, sent };
}

describe('MusicKitBridge.authorize after the permission changed', () => {
  test('a "denied" from the running helper is asked again of a new one', async () => {
    const { bridge, started, sent } = makeBridge([
      { authorized: false, status: 'denied', needsSystemSettings: true },
      { authorized: true, status: 'authorized' },
    ]);
    await bridge.start();
    const first = started[0];
    const result = await bridge.authorize();
    expect(result).toEqual({ authorized: true, status: 'authorized' });
    expect(sent).toEqual(['authorize', 'authorize']);
    expect(first.killed).toBe(true);
    expect(started).toHaveLength(2);
    expect(bridge.process).toBe(started[1]);
  });

  test('still denied after the restart is reported as denied, with one restart only', async () => {
    const denied = { authorized: false, status: 'denied', needsSystemSettings: true };
    const { bridge, started, sent } = makeBridge([denied, { ...denied }]);
    await bridge.start();
    await expect(bridge.authorize()).resolves.toMatchObject({ status: 'denied', needsSystemSettings: true });
    expect(sent).toEqual(['authorize', 'authorize']);
    expect(started).toHaveLength(2);
  });

  test('authorized needs no restart', async () => {
    const { bridge, started, sent } = makeBridge([{ authorized: true, status: 'authorized' }]);
    await bridge.start();
    await bridge.authorize();
    expect(sent).toEqual(['authorize']);
    expect(started).toHaveLength(1);
  });
});

describe('MusicKitBridge.stop', () => {
  test('its delayed kill never touches a helper started after it', async () => {
    jest.useFakeTimers();
    try {
      const bridge = new MusicKitBridge();
      const old = fakeProcess();
      bridge.process = old;
      bridge.stop();
      const fresh = fakeProcess();
      bridge.process = fresh;
      jest.advanceTimersByTime(600);
      expect(old.killed).toBe(true);
      expect(fresh.killed).toBe(false);
      expect(bridge.process).toBe(fresh);
    } finally {
      jest.useRealTimers();
    }
  });
});
