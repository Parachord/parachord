/**
 * "View on Achordion" wherever the item has an Achordion page: tracks,
 * albums, artists, a playlist that's on ListenBrainz (Achordion keys
 * playlists on the ListenBrainz MBID, so not every playlist is there), and
 * every ListenBrainz user (each has a profile at /user/<name>).
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const { lbMbidOf } = require('../../src/renderer/lib/playlist-share');
const { playlistMenu } = require('../../src/renderer/lib/item-menus');

const MBID = '0f6b8a4c-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

test('a playlist is on Achordion when it is on ListenBrainz, saved or not', () => {
  expect(lbMbidOf({ syncedTo: { listenbrainz: { externalId: MBID } } })).toBe(MBID);
  expect(lbMbidOf({ syncedFrom: { resolver: 'listenbrainz', externalId: MBID } })).toBe(MBID);
  expect(lbMbidOf({ listenbrainzId: MBID })).toBe(MBID); // a weekly playlist
  expect(lbMbidOf({ source: 'listenbrainz', sourceUrl: `https://listenbrainz.org/playlist/${MBID}` })).toBe(MBID);
  expect(lbMbidOf({ source: 'spotify', sourceUrl: 'https://open.spotify.com/playlist/x' })).toBe(null);
  expect(lbMbidOf({ syncedTo: { spotify: { externalId: 'x' } } })).toBe(null);
  expect(playlistMenu({ id: 'p', title: 'T', listenbrainzId: MBID }, []).listenbrainzMbid).toBe(MBID);
  expect(playlistMenu({ id: 'p', title: 'T' }, []).listenbrainzMbid).toBeUndefined();
});

test('main.js offers it for each item type that has a page', () => {
  const main = read('main.js');
  // Playlists: only with the MBID; unsaved ones from other services get no link items.
  expect(main).toContain("const playlistLinkable = data.type === 'playlist' && (!!data.listenbrainzMbid || !data.isEphemeral);");
  expect(main).toContain('if (!isPlaylist || data.listenbrainzMbid) {');
  expect(main).toContain("listenbrainzMbid: isPlaylist ? (data.listenbrainzMbid || null) : undefined,");
  // A friend's now-playing track has the track's link items.
  const ft = main.slice(main.indexOf("if (data.type === 'friend-track') {"), main.indexOf("if (data.type === 'listener'"));
  expect(ft).toContain("action: 'view-on-achordion-track'");
  expect(ft).toContain("action: 'publish-smart-link'");
  // ListenBrainz friends and Listeners.
  expect(main).toMatch(/data\.friend\?\.service === 'listenbrainz'[\s\S]{0,300}action: 'view-on-achordion-user'/);
  expect(main).toMatch(/data\.listener\.service === 'listenbrainz'[\s\S]{0,300}action: 'view-on-achordion-user'/);
});

test('the renderer opens profiles and both Share menus offer it', () => {
  const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages moved out of it (#1451)
  expect(app).toContain('const achordionUserUrl = (username) => `https://achordion.xyz/user/${encodeURIComponent(username)}`;');
  expect(app).toMatch(/data\.action === 'view-on-achordion-user' && data\.username[\s\S]{0,200}achordionUserUrl\(data\.username\)/);
  expect(app).toMatch(/activeView === 'friendHistory' && currentFriend\?\.service === 'listenbrainz'/);
  expect(app).toMatch(/activeView === 'playlist-view' && selectedPlaylist && lbMbidOf\(selectedPlaylist\)/);
  expect(app).toMatch(/type: 'listener', listener: \{/);
  expect(read('src/renderer/components/cards.js')).toMatch(/key: 'view-on-achordion',[\s\S]{0,200}publishCollectionSmartLink\(albumLink\(\), \{ openInBrowser: true \}\)/);
  expect(read('src/renderer/components/playlist-view-page.js')).toMatch(/\.\.\.\(lbMbidOf\(selectedPlaylist\) \? \[\{\s*key: 'view-on-achordion'/);
});
