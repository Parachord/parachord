/**
 * `npm start` launches the app through scripts/start-electron.js, not
 * electron's own launcher.
 *
 * Ctrl+C in a terminal sends SIGINT to the whole process group, the app
 * included. Electron answers a first SIGINT with its normal quit (before-quit,
 * which pauses Spotify) and dies on a second. electron's launcher forwarded
 * every SIGINT to the app, so the app got two and died partway through the
 * pause: Spotify kept playing with nothing in control (2026-11-14).
 */
const { EventEmitter } = require('events');
const { launch, FORWARD_GRACE_MS } = require('../../scripts/start-electron');

function harness() {
  const proc = new EventEmitter();
  proc.argv = ['node', 'start-electron.js', '--dev'];
  proc.exit = jest.fn();
  const child = new EventEmitter();
  child.kill = jest.fn();
  const spawnFn = jest.fn(() => child);
  launch({ spawnFn, proc, binary: '/bin/electron' });
  return { proc, child, spawnFn };
}

describe('start-electron', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('launches the app with the arguments npm passed through', () => {
    const { spawnFn } = harness();
    expect(spawnFn).toHaveBeenCalledWith('/bin/electron', ['.', '--dev'], { stdio: 'inherit' });
  });

  test('a Ctrl+C is not forwarded at once (the app got its own SIGINT)', () => {
    const { proc, child } = harness();
    proc.emit('SIGINT');
    expect(child.kill).not.toHaveBeenCalled();
  });

  test('the app quitting within the grace period means nothing is forwarded', () => {
    const { proc, child } = harness();
    proc.emit('SIGINT');
    jest.advanceTimersByTime(1000);
    child.emit('close', 0, null);
    jest.advanceTimersByTime(FORWARD_GRACE_MS);
    expect(child.kill).not.toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  test('a signal sent to the launcher alone still reaches the app after the grace period', () => {
    const { proc, child } = harness();
    proc.emit('SIGTERM');
    jest.advanceTimersByTime(FORWARD_GRACE_MS);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('the grace period outlasts the quit step (the Spotify pause budget)', () => {
    const { QUIT_PAUSE_BUDGET_MS } = require('../../main-process/quit-cleanup');
    expect(FORWARD_GRACE_MS).toBeGreaterThan(QUIT_PAUSE_BUDGET_MS);
  });

  test('an app killed by a signal exits the launcher with a failure', () => {
    const { proc, child } = harness();
    child.emit('close', null, 'SIGKILL');
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  test('npm start and npm run dev use it', () => {
    const pkg = require('../../package.json');
    expect(pkg.scripts.start).toBe('node scripts/start-electron.js');
    expect(pkg.scripts.dev).toBe('node scripts/start-electron.js --dev');
  });
});
