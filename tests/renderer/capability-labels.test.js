/**
 * A plug-in capability's name in UI text comes from one helper
 * (lib/capability-labels.js), sentence case, and never shows an id.
 */
const fs = require('fs');
const path = require('path');
const { capabilityLabel } = require('../../src/renderer/lib/capability-labels');

test('known capabilities read as words, in sentence case', () => {
  expect(capabilityLabel('albumSearch')).toBe('Album search');
  expect(capabilityLabel('urlLookup')).toBe('Link lookup');
  expect(capabilityLabel('purchase')).toBe('Purchase downloads');
});

test("an unknown one is spelled out, never shown as its id", () => {
  expect(capabilityLabel('someNewThing')).toBe('Some new thing');
  expect(capabilityLabel('lyrics_sync')).toBe('Lyrics sync');
});

test('Settings and the marketplace use it, as the shared pill', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app.split("enabled ? React.createElement(Badge, { key: cap, tone: 'accent' }, capabilityLabel(cap)) : null)").length - 1).toBe(2);
  expect(app).not.toContain("urlLookup: 'URL Lookup'");
});

test('the scrobbling services say so: Last.fm, ListenBrainz and Libre.fm declare scrobbling', () => {
  const { capabilityLabel } = require('../../src/renderer/lib/capability-labels');
  expect(capabilityLabel('scrobbling')).toBe('Scrobbling');
  for (const id of ['lastfm', 'listenbrainz', 'librefm']) {
    const m = require(`../../plugins-src/${id}/manifest.json`);
    expect([id, (m.capabilities || m.manifest.capabilities).scrobbling]).toEqual([id, true]);
  }
});
