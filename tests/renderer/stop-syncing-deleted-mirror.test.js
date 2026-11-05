/**
 * The "was deleted on <service>" banner's Stop syncing. It used to delete only the
 * syncedTo entry. With no channel override, a playlist that still had another
 * mirror looked "not yet created" to the push loop, so the next sync could recreate
 * the playlist the person had just stopped syncing. It now uses the Sync menu's
 * path, sync:set-channel, which writes the override and drops the link.
 */

const fs = require('fs');
const path = require('path');
const { channelGateBlocksCreate } = require('../../sync-engine/playlist-push-candidate');

const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/playlist-view-page.js'), 'utf8');

function buttonBody(label) {
  const end = page.indexOf(`}, '${label}')`);
  expect(end).toBeGreaterThan(-1);
  const start = page.lastIndexOf('onClick:', end);
  return page.slice(start, end);
}

describe('Stop syncing on the deleted-mirror banner', () => {
  test('goes through sync:set-channel, turning the channel off', () => {
    expect(buttonBody('Stop syncing')).toMatch(/sync\.setChannel\(playlist\.id, providerId, false\)/);
  });

  test('leaves the record to main, and reloads it so a stale copy can\'t undo that', () => {
    const body = buttonBody('Stop syncing');
    expect(body).not.toContain('delete updatedSyncedTo');
    expect(body).not.toContain('playlists.save');
    expect(body).toContain('playlists.load()');
    expect(body).toContain('setPlaylists(');
    expect(body).toContain('setSelectedPlaylist(');
  });

  test('says so when it fails', () => {
    expect(buttonBody('Stop syncing')).toContain('showToast(');
  });

  test('an override without the provider stops the push loop creating it again', () => {
    const playlist = { id: 'spotify-x', syncedTo: { spotify: { externalId: 'sp' } } };
    expect(channelGateBlocksCreate(playlist, 'listenbrainz', ['spotify'])).toBe(true);
    expect(channelGateBlocksCreate(playlist, 'spotify', ['spotify'])).toBe(false);
  });
});
