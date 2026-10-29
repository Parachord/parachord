/**
 * src/renderer/app.js must not reference an identifier that is declared
 * nowhere in scope.
 *
 * The failure class (#1143): the playback-queue extraction moved
 * usePlaybackQueue into src/renderer/hooks/use-playback-queue.js but the
 * `require('./hooks/use-playback-queue')` line never landed in app.js. Every
 * existing gate stayed green: esbuild bundles an unresolved identifier
 * without complaint, lint ran parse-only on app.js, and jest never renders
 * Parachord. The main process booted normally, and the window stayed blank
 * with "Uncaught ReferenceError: usePlaybackQueue is not defined" visible
 * only in DevTools.
 *
 * The gate itself is eslint.config.js's no-undef block for app.js (CI's lint
 * step); this test runs that same config so a plain `npm test` catches it
 * too, and pins with a negative control that the gate still fires.
 */

const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'src', 'renderer', 'app.js');

async function undefinedRefs(source) {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(source, { filePath: APP });
  return result.messages
    .filter((m) => m.ruleId === 'no-undef' || m.fatal)
    .map((m) => `${m.line}:${m.column} ${m.message}`);
}

describe('src/renderer/app.js undefined references', () => {
  const source = fs.readFileSync(APP, 'utf8');

  test('every identifier resolves (a moved symbol came back via require)', async () => {
    expect(await undefinedRefs(source)).toEqual([]);
  });

  test('negative control: dropping an extracted hook require is flagged', async () => {
    const requireLine = "const { usePlaybackQueue } = require('./hooks/use-playback-queue');";
    expect(source).toContain(requireLine);
    const broken = source.replace(requireLine, '');
    const refs = await undefinedRefs(broken);
    expect(refs.some((r) => r.includes("'usePlaybackQueue' is not defined"))).toBe(true);
  });
});
