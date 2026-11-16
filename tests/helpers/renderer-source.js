// The renderer's page markup for source-marker tests: src/renderer/app.js
// plus the pages moved out of it into their own modules (#1451). A test that
// reads a page's markup from app.js reads this instead, so moving the page
// (verbatim) doesn't move it out of the test's sight. Each extraction PR adds
// its module here.
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');
const PAGE_MODULES = [
  'components/fresh-drops-page.js',
  'components/recommendations-page.js',
  'components/concerts-page.js',
  'components/charts-page.js',
];

function read(rel) {
  return fs.readFileSync(path.join(RENDERER, rel), 'utf8');
}

// app.js, then each moved page, one after another.
function appWithPages() {
  return [read('app.js'), ...PAGE_MODULES.map(read)].join('\n');
}

module.exports = { appWithPages, PAGE_MODULES, readRenderer: read };
