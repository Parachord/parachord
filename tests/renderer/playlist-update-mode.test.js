/**
 * src/renderer/lib/playlist-update-mode.js: a playlist imported from a link is
 * either a snapshot (as it was that day) or kept updated from the link. The
 * person picks when they import; playlists from before keep what they did.
 */

const {
  SERVICE_REFRESH_MS,
  playlistUpdateMode,
  isPolledHostedXspf,
  serviceRefreshDue,
  hostedListForMode,
} = require('../../src/renderer/lib/playlist-update-mode');
const { isHostedXspf } = require('../../sync-engine/auto-pull');

const xspf = (over = {}) => ({ id: 'hosted-1', sourceUrl: 'https://example.com/a.xspf', source: 'hosted-xspf', addedAt: 100, ...over });
const service = (over = {}) => ({ id: 'hosted-2', sourceUrl: 'https://open.spotify.com/playlist/x', source: 'spotify-import', addedAt: 100, ...over });
const svc = { providerImported: true };
const doc = { providerImported: false };

describe('playlistUpdateMode', () => {
  test('a playlist not imported from a link has no mode', () => {
    expect(playlistUpdateMode({ id: 'playlist-1' }, doc)).toBeNull();
  });

  test('the choice on the record wins', () => {
    expect(playlistUpdateMode(xspf({ autoUpdate: false }), doc)).toBe('snapshot');
    expect(playlistUpdateMode(service({ autoUpdate: true }), svc)).toBe('auto');
  });

  test('imports from before the choice keep what they did: hosted XSPF updated, service links snapshots', () => {
    expect(playlistUpdateMode(xspf(), doc)).toBe('auto');
    expect(playlistUpdateMode(service(), svc)).toBe('snapshot');
  });
});

describe('isPolledHostedXspf', () => {
  test('a kept-updated XSPF is polled', () => {
    expect(isPolledHostedXspf(xspf(), doc)).toBe(true);
  });

  test('a snapshot XSPF is not', () => {
    expect(isPolledHostedXspf(xspf({ autoUpdate: false }), doc)).toBe(false);
  });

  test('a service link never is, kept updated or not (its page is not an XSPF)', () => {
    expect(isPolledHostedXspf(service({ autoUpdate: true }), svc)).toBe(false);
  });
});

describe('serviceRefreshDue', () => {
  const now = 100 + SERVICE_REFRESH_MS;

  test('a kept-updated service link is due an hour after its last update', () => {
    expect(serviceRefreshDue(service({ autoUpdate: true, lastUpdated: 100 }), { ...svc, now })).toBe(true);
    expect(serviceRefreshDue(service({ autoUpdate: true, lastUpdated: 101 }), { ...svc, now })).toBe(false);
  });

  test('with no update yet, the import time counts', () => {
    expect(serviceRefreshDue(service({ autoUpdate: true }), { ...svc, now })).toBe(true);
  });

  test('a snapshot is never due', () => {
    expect(serviceRefreshDue(service({ lastUpdated: 0 }), { ...svc, now })).toBe(false);
  });

  test('a hosted XSPF is never due here (its own poller checks it)', () => {
    expect(serviceRefreshDue(xspf({ lastUpdated: 0 }), { ...doc, now })).toBe(false);
  });
});

describe('hostedListForMode', () => {
  const entry = { url: 'https://example.com/a.xspf', id: 'hosted-1', addedAt: 100 };

  test('keeping an XSPF updated puts it on the startup reload list once', () => {
    const pl = xspf({ title: 'A', creator: 'B' });
    expect(hostedListForMode([], pl, 'auto', doc)).toEqual([{ url: pl.sourceUrl, id: 'hosted-1', addedAt: 100, title: 'A', creator: 'B' }]);
    expect(hostedListForMode([entry], pl, 'auto', doc)).toEqual([entry]);
  });

  test('making an XSPF a snapshot takes it off the list', () => {
    expect(hostedListForMode([entry, { url: 'other' }], xspf(), 'snapshot', doc)).toEqual([{ url: 'other' }]);
  });

  test('a service link never goes on the list', () => {
    expect(hostedListForMode([], service(), 'auto', svc)).toEqual([]);
  });
});

describe('auto-pull treats a snapshot XSPF as not hosted', () => {
  test('autoUpdate false is not hosted', () => {
    expect(isHostedXspf(xspf({ autoUpdate: false }))).toBe(false);
    expect(isHostedXspf(xspf())).toBe(true);
  });
});
