/**
 * @jest-environment jsdom
 *
 * #1493: an achordion.xyz link someone shared (a song, an album or a
 * playlist) opens in Parachord: dropped on the player or the queue, it routes
 * through the plug-in registry to the Achordion plug-in, which turns it into
 * tracks the app then finds on your own services.
 */
const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/achordion.axe'), 'utf8'));
const MBID = '8f0c3ba8-5d36-4cd1-9b1c-6c2b4a4e2f10';

const loader = async () => {
  const l = new ResolverLoader();
  await l.loadResolver(axe);
  return l;
};
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });

afterEach(() => { delete global.fetch; });

test('the plug-in claims its links through the registry, and says what each is', async () => {
  expect(axe.capabilities.urlLookup).toBe(true);
  const l = await loader();
  for (const [url, type] of [
    [`https://achordion.xyz/recording/${MBID}`, 'track'],
    ['https://achordion.xyz/recording/lookup?artist=Quarantine%20Angst&title=Lopped%20Off', 'track'],
    [`https://www.achordion.xyz/release-group/${MBID}`, 'album'],
    ['https://achordion.xyz/release-group/lookup?artist=A&title=B', 'album'],
    [`https://achordion.xyz/playlist/${MBID}`, 'playlist'],
  ]) {
    expect([url, l.findResolverForUrl(url)]).toEqual([url, 'achordion']);
    expect([url, l.getUrlType(url)]).toEqual([url, type]);
  }
  expect(l.findResolverForUrl('https://achordion.xyz/user/someone')).toBeNull();
});

test('a lookup link needs no request; an MBID link asks MusicBrainz', async () => {
  const l = await loader();
  global.fetch = jest.fn();
  const byName = await l.lookupUrl('https://achordion.xyz/recording/lookup?artist=Quarantine%20Angst&title=Lopped%20Off');
  expect(byName).toEqual({ resolverId: 'achordion', track: { title: 'Lopped Off', artist: 'Quarantine Angst', album: '' } });
  expect(global.fetch).not.toHaveBeenCalled();

  global.fetch = jest.fn(() => json({
    id: MBID, title: 'Lopped Off', length: 201500,
    'artist-credit': [{ name: 'Quarantine Angst', joinphrase: '' }],
    releases: [{ title: 'Post-Pardon' }],
  }));
  const byId = await l.lookupUrl(`https://achordion.xyz/recording/${MBID}`);
  expect(global.fetch.mock.calls[0][0]).toBe(`https://musicbrainz.org/ws/2/recording/${MBID}?inc=artist-credits+releases&fmt=json`);
  expect(byId.track).toEqual({ title: 'Lopped Off', artist: 'Quarantine Angst', album: 'Post-Pardon', duration: 202, mbid: MBID });
});

test('an album link becomes the release group\'s earliest official release, track by track', async () => {
  const l = await loader();
  const calls = [];
  global.fetch = jest.fn((url) => {
    calls.push(url);
    if (url.includes('/release-group/')) {
      return json({
        title: 'Post-Pardon', 'first-release-date': '2026-03-01', 'artist-credit': [{ name: 'Quarantine Angst' }],
        releases: [{ id: 'later', status: 'Official', date: '2026-05-01' }, { id: 'bootleg', status: 'Bootleg', date: '2025-01-01' }, { id: 'first', status: 'Official', date: '2026-03-01' }],
      });
    }
    return json({ media: [{ tracks: [{ title: 'One', length: 60000, recording: { id: 'r1' } }, { title: 'Two', recording: { id: 'r2' } }] }] });
  });
  const { album } = await l.lookupAlbum(`https://achordion.xyz/release-group/${MBID}`);
  expect(calls[1]).toContain('/release/first?');
  expect(album.name).toBe('Post-Pardon');
  expect(album.artist).toBe('Quarantine Angst');
  expect(album.tracks.map((t) => [t.title, t.artist, t.duration, t.trackNumber])).toEqual([
    ['One', 'Quarantine Angst', 60, 1], ['Two', 'Quarantine Angst', null, 2],
  ]);
});

test('a playlist link reads Achordion\'s public XSPF', async () => {
  const l = await loader();
  const xspf = `<?xml version="1.0"?><playlist xmlns="http://xspf.org/ns/0/"><title>Rainy Sunday</title><trackList>
    <track><title>Lopped Off</title><creator>Quarantine Angst</creator><duration>201000</duration></track>
    <track><title></title><creator>Nobody</creator></track>
  </trackList></playlist>`;
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(xspf) }));
  const { playlist } = await l.lookupPlaylist(`https://achordion.xyz/playlist/${MBID}`);
  expect(global.fetch.mock.calls[0][0]).toBe(`https://achordion.xyz/api/playlist/${MBID}/xspf`);
  expect(playlist.name).toBe('Rainy Sunday');
  expect(playlist.tracks).toEqual([{ title: 'Lopped Off', artist: 'Quarantine Angst', album: '', duration: 201 }]);
});

test('Achordion loads once: the telemetry load registers its links too', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toContain('&& !(axe.capabilities?.playbackTelemetry && axe.implementation?.init)');
});

test('the drop overlay uses the shared icons and sentence case', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/drop-zone-overlay.js'), 'utf8');
  expect(src).toContain("'Drop to play now' : 'Drop to play next'");
  expect(src).not.toMatch(/'▶'|'📋'|Play Now|Play Next/);
});
