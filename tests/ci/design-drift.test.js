/**
 * Design drift ratchet (CLAUDE.md "Design system").
 *
 * Counts the anti-patterns the 2026-11-13 design audit found in
 * src/renderer/ (hard-coded colours, Tailwind palette classes, isDark
 * ternaries, clickable divs, hidden focus, native dialogs, "...", pasted SVG
 * paths, off-scale font sizes and radii, JS hover) and compares them with
 * tests/ci/design-drift-baseline.json.
 *
 * - A count that RISES fails: the change adds new drift. Use the shared
 *   component or token instead (see CLAUDE.md "Design system").
 * - A count that FALLS fails too, so the improvement is locked in: run
 *   `npm run design-drift -- --write` and commit the baseline.
 * - A var(--name) the renderer uses that index.html doesn't define fails,
 *   beyond the ones already listed in the baseline.
 */
const { METRICS, scan, readBaseline, topFiles } = require('../../scripts/design-drift');

const result = scan();
const baseline = readBaseline();

describe('design drift ratchet', () => {
  test.each(Object.keys(METRICS))('%s does not change without a baseline update', (metric) => {
    const now = result.totals[metric];
    const was = baseline.metrics[metric];
    if (now > was) {
      const where = topFiles(result.byFile, metric).map(([f, c]) => `${c} ${f}`).join(', ');
      throw new Error(`${metric} rose from ${was} to ${now}. ${METRICS[metric]} Files with the most: ${where}.`);
    }
    if (now < was) {
      throw new Error(`${metric} fell from ${was} to ${now}. Lock it in: npm run design-drift -- --write, and commit tests/ci/design-drift-baseline.json.`);
    }
  });

  test('every CSS variable the renderer uses is defined in index.html', () => {
    const known = new Set(baseline.undefinedCssVars);
    const added = result.undefinedCssVars.filter((v) => !known.has(v));
    expect(added).toEqual([]);
    // One that is now defined (or no longer used) leaves the baseline list.
    const fixed = baseline.undefinedCssVars.filter((v) => !result.undefinedCssVars.includes(v));
    expect(fixed).toEqual([]);
  });

  test('every metric has a baseline', () => {
    expect(Object.keys(baseline.metrics).sort()).toEqual(Object.keys(METRICS).sort());
  });
});
