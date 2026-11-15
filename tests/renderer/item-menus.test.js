/**
 * lib/item-menus.js: one payload per item type for the native context menu,
 * so the same album, artist or playlist gets the same menu wherever it is
 * right-clicked.
 */
const fs = require('fs');
const path = require('path');
const { releaseMenu, artistMenu, playlistMenu } = require('../../src/renderer/lib/item-menus');
const { withCollectionState } = require('../../src/renderer/lib/menu-collection-state');

const RG = '1b022e01-4da6-387b-8658-8678046e4cef';

describe('releaseMenu', () => {
  test('the shapes pages hold all come out the same', () => {
    const fromFresh = releaseMenu({ title: 'Far In', artist: 'Helado Negro', albumArt: 'https://a', date: '2021-10-22', id: RG, releaseGroupMbid: RG });
    const fromArtistPage = releaseMenu({ title: 'Far In', artist: { name: 'Helado Negro' }, albumArt: 'https://a', date: '2021-10-22', id: RG, releaseGroupMbid: RG });
    const fromSearch = releaseMenu({ title: 'Far In', artist: 'Helado Negro', albumArt: 'https://a', 'first-release-date': '2021-10-22', id: RG, releaseGroupMbid: RG });
    expect(fromArtistPage).toEqual(fromFresh);
    expect(fromSearch).toEqual(fromFresh);
    expect(fromFresh).toMatchObject({
      type: 'release', name: 'Far In', artist: 'Helado Negro', albumArt: 'https://a', year: 2021,
      releaseGroupMbid: RG, album: { title: 'Far In', artist: 'Helado Negro', art: 'https://a', year: 2021, releaseGroupMbid: RG },
    });
  });
  test('name/image shapes (Recommendations, top albums)', () => {
    expect(releaseMenu({ name: 'X', artist: 'Y', image: 'https://i' })).toMatchObject({ name: 'X', albumArt: 'https://i', album: { art: 'https://i' } });
  });
  test('loading only while there are no tracks yet', () => {
    expect(releaseMenu({ title: 'X' }, { loading: true }).loading).toBe(true);
    expect(releaseMenu({ title: 'X' }, { loading: true, tracks: [{ title: 't' }] }).loading).toBe(false);
    expect(releaseMenu({ title: 'X' }).tracks).toEqual([]);
  });
  test('collection state still finds a saved album', () => {
    const data = withCollectionState(releaseMenu({ title: 'Far In', artist: 'Helado Negro' }), { albums: [{ id: 'x', title: 'far in', artist: 'helado negro' }] });
    expect(data.isInCollection).toBe(true);
  });
});

test('artistMenu and playlistMenu', () => {
  expect(artistMenu('Frog')).toEqual({ type: 'artist', artist: { id: null, name: 'Frog', image: null } });
  expect(playlistMenu({ id: 'p1', title: 'Mix', creator: 'me' }, [{ title: 't' }], { isEphemeral: true }))
    .toEqual({ type: 'playlist', playlistId: 'p1', name: 'Mix', creator: 'me', tracks: [{ title: 't' }], isEphemeral: true });
});

test('every album, artist and playlist menu goes through a builder', () => {
  const root = path.join(__dirname, '../..');
  const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(root, 'src/renderer/components')).map((f) => `src/renderer/components/${f}`)];
  for (const f of files.filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    expect([f, src.match(/showItemMenu\(\{\s*type: '(release|artist|playlist)'/g)]).toEqual([f, null]);
  }
});
