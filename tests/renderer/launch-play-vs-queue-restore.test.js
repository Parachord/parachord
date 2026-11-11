/**
 * A play at launch vs. the saved-queue restore (#1287, the desktop half of
 * parachord-mobile#557).
 *
 * Reproduced on main (2026-11-11): a cold-start parachord://play link arrived
 * at 0.36s, searched before any resolver plugin had loaded, and said "Could not
 * find"; the restore then put last session's track in the playbar at 0.88s.
 * Now:
 *   - launch-time plays (protocol links, the protocol endpoint, MCP searches)
 *     wait until the saved settings and the resolver plugins have loaded
 *     (waitForPlayReady), which comes after the restore, so the link's play
 *     replaces the restored queue like any link would;
 *   - the restore is skipped when a play has STARTED before it (mobile's
 *     QueueRestorePolicy), e.g. a click in the first second. Desktop doesn't
 *     skip for a play merely asked for: the queue saver writes the empty queue
 *     once the cache has loaded, so skipping for a request that then fails would
 *     erase the saved queue.
 */

const fs = require('fs');
const path = require('path');
const { shouldRestoreQueue } = require('../../src/renderer/lib/playback-helpers');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
const queue = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-queue.js'), 'utf8');

describe('shouldRestoreQueue', () => {
  test('restores only when nothing is playing and nothing has started', () => {
    expect(shouldRestoreQueue({ hasCurrentTrack: false, playRequested: false })).toBe(true);
    expect(shouldRestoreQueue({ hasCurrentTrack: true, playRequested: false })).toBe(false);
    expect(shouldRestoreQueue({ hasCurrentTrack: false, playRequested: true })).toBe(false);
    expect(shouldRestoreQueue({ hasCurrentTrack: true, playRequested: true })).toBe(false);
  });
});

describe('the restore', () => {
  test('is gated on the policy, with a link\'s loading placeholder not counting as a track', () => {
    expect(app).toMatch(/const liveTrack = currentTrackRef\.current;\s*const restoreQueueNow = savedRememberQueue && shouldRestoreQueue\(\{\s*hasCurrentTrack: !!liveTrack && !liveTrack\._protocolLoading,\s*playRequested: playRequestedRef\.current\s*\}\);/);
    expect(app).toMatch(/if \(restoreQueueNow\) \{\s*if \(savedQueue && Array\.isArray\(savedQueue\) && savedQueue\.length > 0\) \{/);
  });

  test('a play that starts sets the flag (handlePlay, first thing); a link request alone does not', () => {
    expect(queue).toMatch(/const playRequestedRef = React\.useRef\(false\);/);
    const start = engine.slice(engine.indexOf('const handlePlay = async (trackOrSource'));
    expect(start.slice(0, 300)).toMatch(/if \(playRequestedRef\) playRequestedRef\.current = true;/);
    const handler = app.slice(app.indexOf("console.log('🔗 Parsed protocol URL:'"), app.indexOf('// Execute the command'));
    expect(handler).not.toMatch(/playRequestedRef\.current = true/);
  });
});

describe('launch-time plays wait for the resolvers', () => {
  test('ready resolves once the cache and the resolver plugins have loaded, after the ref syncs', () => {
    const effect = app.indexOf('if (playReadyRef.current.ready || !cacheLoaded || loadedResolvers.length === 0) return;');
    expect(effect).toBeGreaterThan(-1);
    expect(app.slice(effect, effect + 200)).toMatch(/playReadyRef\.current\.ready = true;\s*playReadyRef\.current\.resolve\(\);\s*\}, \[cacheLoaded, loadedResolvers\]\);/);
    // searchResolvers reads these refs; their sync effects run first in the commit.
    expect(app.indexOf('activeResolversRef.current = activeResolvers;')).toBeLessThan(effect);
    expect(app.indexOf('loadedResolversRef.current = loadedResolvers;')).toBeLessThan(effect);
  });

  test('the wait is capped so nothing hangs on it', () => {
    expect(app).toMatch(/const waitForPlayReady = \(\) => \(playReadyRef\.current\.ready\s*\? Promise\.resolve\(\)\s*: Promise\.race\(\[playReadyRef\.current\.promise, new Promise\(r => setTimeout\(r, 15000\)\)\]\)\);/);
  });

  test('the protocol handler waits after its acknowledgement toast and before any command runs', () => {
    const handler = app.slice(app.indexOf("console.log('🔗 Parsed protocol URL:'"));
    const ack = handler.indexOf('if (ackMessage) showToast(ackMessage');
    const wait = handler.indexOf('await waitForPlayReady();');
    const sw = handler.indexOf('switch (command) {');
    expect(ack).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(ack);
    expect(sw).toBeGreaterThan(wait);
  });

  test('MCP searches wait too', () => {
    expect(app).toMatch(/search: async \(query, options = \{\}\) => \{\s*\/\/[^\n]*\n\s*await waitForPlayReady\(\);\s*const results = await searchResolvers\(query, options\);/);
  });
});
