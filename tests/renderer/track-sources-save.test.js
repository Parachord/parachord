/**
 * The track-sources cache is saved soon after resolutions, not only on the
 * 5-minute timer (state-persistence.md, "Save Triggers").
 *
 * Seen live 2026-11-11: the same few Recommendations rows went to every
 * resolver on each short launch, because what a session resolved reached
 * disk only if it lasted five minutes. Now every write to the cache marks it
 * changed, and a debounced saver (src/renderer/lib/debounced-saver.js, tested
 * in debounced-saver.test.js) writes it 15s after a burst ends, at most 60s
 * after the first unsaved change. No save path may write the cache before it
 * has loaded from disk, or the file would be replaced by the few entries
 * resolved so far.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const lines = app.split('\n');

describe('track sources are saved soon after they change', () => {
  test('every write to a cache entry is preceded by markTrackSourcesDirty()', () => {
    const write = /trackSourcesCache\.current\[[^\]]+\](\.\w+)? = (?!=)|delete trackSourcesCache\.current\[|^\s*(entry|cachedData)\.sources = withoutStaleLocalSource\(/;
    const unmarked = [];
    lines.forEach((line, i) => {
      if (!write.test(line)) return;
      // Consecutive writes share one mark (timestamp, then resolverHash).
      let j = i - 1;
      while (j >= 0 && (lines[j].trim() === '' || write.test(lines[j]))) j--;
      if (lines[j].trim() !== 'markTrackSourcesDirty();') unmarked.push(`${i + 1}: ${line.trim()}`);
    });
    // clearResolverMisses saves the cache itself, at once.
    const clearMisses = app.slice(app.indexOf('const clearResolverMisses = (resolverId) => {'), app.indexOf('flushTrackSources();', app.indexOf('const clearResolverMisses')));
    expect(clearMisses).toMatch(/if \(trackSourcesLoadedRef\.current\) \{\s*try \{ window\.electron\?\.store\?\.set\('cache_track_sources', trackSourcesCache\.current\); \} catch \(e\) \{\}\s*\}/);
    expect(unmarked).toEqual([]);
  });

  test('the saver writes cache_track_sources, only once the cache has loaded', () => {
    const saver = app.slice(app.indexOf('trackSourcesSaverRef.current = createDebouncedSaver({'), app.indexOf('const markTrackSourcesDirty'));
    expect(saver).toMatch(/save: \(\) => window\.electron\.store\.set\('cache_track_sources', trackSourcesCache\.current\)/);
    expect(saver).toMatch(/canSave: \(\) => trackSourcesLoadedRef\.current && !!window\.electron\?\.store/);
    expect(saver).toMatch(/delayMs: TRACK_SOURCES_SAVE_DELAY_MS,\s*maxWaitMs: TRACK_SOURCES_SAVE_MAX_WAIT_MS/);
    expect(app).toMatch(/const TRACK_SOURCES_SAVE_DELAY_MS = 15 \* 1000;/);
    expect(app).toMatch(/const TRACK_SOURCES_SAVE_MAX_WAIT_MS = 60 \* 1000;/);
  });

  test('the 5-minute save skips the cache until it has loaded', () => {
    expect(app).toMatch(/if \(trackSourcesLoadedRef\.current\) \{\s*await window\.electron\.store\.set\('cache_track_sources', trackSourcesCache\.current\);\s*\}/);
  });

  test('loading marks it loaded (also with no file) and keeps entries resolved meanwhile', () => {
    const load = app.slice(app.indexOf('// Load track sources cache'), app.indexOf('// Load artist image cache'));
    expect(load).toMatch(/trackSourcesCache\.current = \{ \.\.\.Object\.fromEntries\(validEntries\), \.\.\.trackSourcesCache\.current \};/);
    // Set outside the `if (trackSourcesData)` block: a first run has no file.
    expect(load).toMatch(/\}\s*\/\/ Loaded \(or there was no file\)[^\n]*\n\s*trackSourcesLoadedRef\.current = true;/);
    // A failed big-cache read returns before reaching it.
    const hydrate = app.slice(app.indexOf('dCaches = await bigCachePromise;'), app.indexOf('// Load track sources cache'));
    expect(hydrate).toMatch(/catch \(err\) \{[\s\S]{0,120}?return;/);
  });
});
