/**
 * The local-file gate applies off screen only (#1532). resolveTrack skips the
 * cross-resolver fill for a track with a local file so a whole library never
 * fires one search per file at once; a track on screen (a page's visible
 * row, the hovered row, the open album) resolves like any other, so it shows
 * every source up front. src/renderer/lib/enrichment-gate.js holds the rule;
 * the scheduler says why each track is being resolved.
 */

const fs = require('fs');
const path = require('path');

const { isOnScreenResolution, skipsLocalFill } = require('../../src/renderer/lib/enrichment-gate');
const { ResolutionScheduler } = require('../../resolution-scheduler.js');

const ROOT = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

// What resolveTrack does with the fill for a track whose persisted sources
// include a local file, given what the scheduler told it.
const fillsOtherPlugins = (info) => !skipsLocalFill({ hasLocalSource: true, forceEnrichment: false, onScreen: isOnScreenResolution(info) });

describe('skipsLocalFill', () => {
  test('a local track off screen skips the fill; on screen, or forced, it fills', () => {
    expect(skipsLocalFill({ hasLocalSource: true })).toBe(true);
    expect(skipsLocalFill({ hasLocalSource: true, onScreen: true })).toBe(false);
    expect(skipsLocalFill({ hasLocalSource: true, forceEnrichment: true })).toBe(false);
    expect(skipsLocalFill({ hasLocalSource: false })).toBe(false);
  });

  test('page and hover resolutions are on screen; background, queue, pool and sidebar are not', () => {
    expect(isOnScreenResolution({ contextType: 'page' })).toBe(true);
    expect(isOnScreenResolution({ contextType: 'hover' })).toBe(true);
    for (const contextType of ['background', 'queue', 'pool', 'sidebar']) {
      expect(isOnScreenResolution({ contextType })).toBe(false);
    }
    expect(isOnScreenResolution(undefined)).toBe(false);
  });
});

describe('through the scheduler', () => {
  const run = async (contextType) => {
    const scheduler = new ResolutionScheduler();
    const calls = [];
    scheduler.setResolveCallback(async (data, signal, info) => { calls.push({ data, info }); });
    scheduler.registerContext('ctx', contextType);
    scheduler.enqueue('local-1', 'ctx', { track: { id: 'local-1', title: 'Nude', sources: { localfiles: { filePath: '/m/nude.wav', confidence: 1 } } } });
    await new Promise(r => setTimeout(r, 20));
    scheduler.reset?.();
    return calls;
  };

  test('a visible local track resolves against the other plug-ins', async () => {
    const [call] = await run('page');
    expect(call.info).toEqual({ contextId: 'ctx', contextType: 'page' });
    expect(fillsOtherPlugins(call.info)).toBe(true);
  });

  test('the library-wide background pass still skips the foreground fill for local tracks', async () => {
    const [call] = await run('background');
    expect(call.info.contextType).toBe('background');
    expect(fillsOtherPlugins(call.info)).toBe(false);
  });

  test('queue look-ahead stays gated too', async () => {
    const [call] = await run('queue');
    expect(fillsOtherPlugins(call.info)).toBe(false);
  });
});

describe('app.js wiring', () => {
  test('resolveTrack applies the gate through skipsLocalFill with its onScreen option', () => {
    expect(app).toMatch(/forceEnrichment = false, onScreen = false \} = options;/);
    expect(app).toMatch(/missingResolvers\.length === 0 \|\| skipsLocalFill\(\{ hasLocalSource, forceEnrichment, onScreen \}\)/);
    expect(app).not.toMatch(/hasLocalSource && !forceEnrichment/);
  });

  test("the scheduler's callback marks page and hover resolutions on screen", () => {
    expect(app).toMatch(/setResolveCallback\(async \(trackData, signal, info\) => \{[\s\S]{0,400}onScreen: isOnScreenResolution\(info\)/);
  });

  test("the open album's tracks resolve on screen", () => {
    expect(app).toMatch(/resolveTrack\(track, artistName, \{ onScreen: true \}\)/);
  });

  test('the whole-library passes never claim to be on screen', () => {
    // Only the two calls above pass onScreen.
    const code = app.replace(/^\s*\/\/.*$/gm, '');
    expect((code.match(/onScreen: /g) || []).length).toBe(2);
    // The trickle bypasses the gate on purpose, one track per 10 seconds in
    // the background.
    expect(app).toMatch(/resolveTrack\(track, track\.artist \|\| track\.artistName \|\| 'Unknown Artist', \{ forceEnrichment: true \}\)/);
  });
});
