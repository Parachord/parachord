/**
 * vendor/tailwind.css is committed, and `npm start` / `npm run dev` load it as
 * is: only the release builds regenerate it (`prebuild:<platform>` runs
 * `build:css`). It went stale for eight months, so a class added since
 * (`text-white/85`, `font-normal`, `align-middle`, ...) did nothing when the
 * app ran from source: the Recommendations hero's "Personalized picks" line
 * rendered in the page's dark default color. This test rebuilds the CSS from
 * the same input and config and fails when the committed file differs.
 * The fix it asks for: `npm run build:css`, then commit vendor/tailwind.css.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '../..');

test('vendor/tailwind.css matches a fresh `npm run build:css` (run it and commit the result)', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-')), 'tailwind.css');
  const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss');
  // The build:css script's exact command (package.json), into a temp file.
  execFileSync(bin, ['build', '-i', 'tailwind-input.css', '-o', out, '--minify'], { cwd: root, stdio: 'pipe' });
  const fresh = fs.readFileSync(out, 'utf8');
  const committed = fs.readFileSync(path.join(root, 'vendor', 'tailwind.css'), 'utf8');
  expect(committed === fresh).toBe(true);
}, 60000);

test('the build:css script is the command this test runs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  expect(pkg.scripts['build:css']).toBe('npx tailwindcss build -i tailwind-input.css -o vendor/tailwind.css --minify');
});
