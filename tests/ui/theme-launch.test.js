/**
 * #1383 step 2: the window opens in the saved theme, and pages sit on the
 * page colour.
 *
 * A dark-mode launch flashed light: the window backdrop was always #f3f4f6,
 * and React's first render (effectiveTheme seeded 'light') stripped the
 * .dark class main.js had added. Every page but Home used bg-white, which
 * dark mode maps to the card colour, so cards lost their edges.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const html = read('index.html');
const app = read('src/renderer/app.js');

test('the window backdrop follows the theme at creation and on every change', () => {
  expect(main).toMatch(/const WINDOW_BACKGROUND = \{ light: '#f3f4f6', dark: '#161616' \}/);
  expect(main).toMatch(/backgroundColor: WINDOW_BACKGROUND\[initialTheme\]/);
  expect(main).toMatch(/--parachord-theme=\$\{initialTheme\}/);
  const setNative = main.slice(main.indexOf("ipcMain.handle('theme-set-native'"));
  expect(setNative.slice(0, 300)).toMatch(/applyWindowBackground\(\)/);
  const updated = main.slice(main.indexOf("nativeTheme.on('updated'"));
  expect(updated.slice(0, 300)).toMatch(/applyWindowBackground\(\)/);
});

test('index.html sets .dark before anything paints, and React seeds from it', () => {
  expect(preload).toMatch(/--parachord-theme=/);
  expect(preload).toMatch(/initial: __initialTheme/);
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head).toMatch(/window\.electron\.theme\.initial === 'dark'\) document\.documentElement\.classList\.add\('dark'\)/);
  expect(app).toMatch(/useState\(\(\) => \(\s*typeof document !== 'undefined' && document\.documentElement\.classList\.contains\('dark'\)/);
  expect(app).not.toMatch(/const \[effectiveTheme, setEffectiveTheme\] = useState\('light'\)/);
});

test('a theme change uses setNative\'s answer instead of asking twice', () => {
  const fn = app.slice(app.indexOf('const handleThemeChange = async'), app.indexOf('const [collectionDropHighlight'));
  expect(fn).toMatch(/const resolved = await window\.electron\?\.theme\?\.setNative\(newPref\)/);
  expect(fn).not.toMatch(/getSystem\(\)/);
});

test('page bodies use the page colour, not bg-white', () => {
  expect(html).toMatch(/\.page-bg \{ background-color: var\(--bg-primary\); \}/);
  expect(app).toMatch(/className: 'flex-1 flex flex-col overflow-hidden page-bg relative'/);
  for (const f of ['search-page.js', 'artist-page.js', 'playlist-view-page.js']) {
    const src = read(`src/renderer/components/${f}`);
    expect(src).toMatch(/page-bg/);
  }
  const search = read('src/renderer/components/search-page.js');
  expect(search).not.toMatch(/className: 'h-full overflow-y-auto bg-white'/);
});
