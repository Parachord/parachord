/**
 * #1387: each plug-in says what it needs (manifest.requirement), shown on
 * the welcome tour's tile and in its panel.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const manifests = fs.readdirSync(path.join(ROOT, 'plugins-src'))
  .map((id) => ({ id, m: JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins-src', id, 'manifest.json'), 'utf8')).manifest }))
  .filter((x) => x.m);

test('every music plug-in (not a meta-service) has a requirement sentence', () => {
  for (const { id, m } of manifests) {
    if (m.type === 'meta-service') continue;
    expect([id, typeof m.requirement]).toEqual([id, 'string']);
    expect(m.requirement).toMatch(/^[A-Z][^]*\.$/);
  }
});

test('meta-services that take a key or token say so', () => {
  for (const id of ['chatgpt', 'claude', 'gemini', 'ticketmaster', 'seatgeek', 'songkick', 'bandsintown']) {
    expect(manifests.find((x) => x.id === id).m.requirement).toMatch(/^Needs your own /);
  }
});

test('the loader carries it; the tour and the panels show it', () => {
  expect(fs.readFileSync(path.join(ROOT, 'resolver-loader.js'), 'utf8')).toMatch(/requirement: typeof manifest\.requirement === 'string'/);
  const app = require('../helpers/renderer-source').appWithPages();
  expect(app).toMatch(/resolver\.requirement && React\.createElement\('p', \{\s*id: `tour-req-\$\{resolver\.id\}`/);
  expect(app).toMatch(/: React\.createElement\(Button, \{ variant: 'text', size: 'sm', className: 'mt-1', onClick: \(\) => handleAddWatchFolder\(\) \}, 'Choose folder…'\)/);
  expect(app).toMatch(/selectedResolver\.requirement && React\.createElement\('p'/);
});
