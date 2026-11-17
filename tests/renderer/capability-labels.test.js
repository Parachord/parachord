/**
 * A plug-in capability's name in UI text comes from one helper
 * (lib/capability-labels.js), sentence case, and never shows an id.
 */
const fs = require('fs');
const path = require('path');
const { capabilityLabel, visibleCapabilities, HIDDEN_CAPABILITIES } = require('../../src/renderer/lib/capability-labels');

test('known capabilities read as words, in sentence case', () => {
  expect(capabilityLabel('albumSearch')).toBe('Album search');
  expect(capabilityLabel('urlLookup')).toBe('Link lookup');
  expect(capabilityLabel('purchase')).toBe('Purchase downloads');
});

test('internal capabilities never show as chips; the rest keep their manifest order (#1498)', () => {
  expect(visibleCapabilities({ resolve: true, widevine: true, mobile: true, html5Stream: true, search: true, playbackTelemetry: true, resolvePicks: true, stream: false }))
    .toEqual(['resolve', 'search']);
  expect(visibleCapabilities(undefined)).toEqual([]);
  expect([...HIDDEN_CAPABILITIES].sort()).toEqual(['html5Stream', 'mobile', 'playbackTelemetry', 'resolvePicks', 'widevine']);
  expect(capabilityLabel('artistImages')).toBe('Artist photos');
  expect(capabilityLabel('similarUsers')).toBe('Similar listeners');
});

test("an unknown one is spelled out, never shown as its id", () => {
  expect(capabilityLabel('someNewThing')).toBe('Some new thing');
  expect(capabilityLabel('lyrics_sync')).toBe('Lyrics sync');
});

test('Plug-in settings uses it, as the shared pill', () => {
  const app = require('../helpers/renderer-source').appWithPages();
  expect(app.split("visibleCapabilities(selectedResolver.capabilities).map((cap) =>").length - 1).toBe(1);
  expect(app).toContain("React.createElement(Badge, { key: cap, tone: 'accent' }, capabilityLabel(cap)))");
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
